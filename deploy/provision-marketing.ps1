# Provisions (or updates) the marketing site: one Container App, its image, its email
# sending, its custom domain and the GitHub Environment the release workflow deploys through.
#
#   .\deploy\provision-marketing.ps1 -DryRun                      # see every step, change nothing
#   .\deploy\provision-marketing.ps1 -Staging                     # a noindex staging site with placeholders
#   .\deploy\provision-marketing.ps1 -TurnstileSiteKey 0x4AAA... -TurnstileSecretKey 0x4BBB...
#
# The site is NOT a customer stack: no manifest, no canary, no customer data, no database. Its
# settings are in deploy/marketing.json (no secrets), its secrets are generated once and kept in
# deploy/.marketing/ (gitignored) and in the app's own secrets. Everything is idempotent: running
# it again changes only what differs.
#
# What it does, in order:
#   1. The site's own resource group, and the shared registry (deploy/shared.bicep) it pulls from.
#   2. marketing.bicep phase 1: the pull identity and its role on the registry.
#   3. Email (when marketing.json has a mail domain): the same two-pass flow as a customer stack
#      (deploy/email.bicep): DNS records first, link the verified domain after.
#   4. Builds and pushes the image, then marketing.bicep phase 2: the Container App, joined to the
#      Container Apps environment of the canary stack (a subscription can be capped at one).
#   5. A custom domain with a managed certificate, once marketing.json names one.
#   6. The GitHub Environment "marketing", its OIDC login and the two Azure roles it needs.
#   7. A smoke test of the live site.
#
# Refuses a real deployment while marketing.json still holds placeholder contact details: use
# -Staging to deploy a noindex site with them anyway (the site is never indexable while the brand
# in marketing/content/brand.ts is a placeholder, whatever this says).
#
# Prerequisites: az CLI logged in (az login), containerapp extension, gh CLI logged in, Docker running.

param(
    # Public Cloudflare Turnstile site key and secret key for the demo form. Empty leaves what the
    # app already has; without the secret a production site refuses to send the form.
    [string]$TurnstileSiteKey = "",
    [string]$TurnstileSecretKey = "",
    # Reuse this image tag instead of building the current commit.
    [string]$ImageTag = "",
    # Switch the Content-Security-Policy from report-only to enforcing (after a clean week of reports).
    [switch]$EnforceCsp,
    # Deploy even though the contact details are placeholders (a noindex staging site).
    [switch]$Staging,
    # Print every step without changing anything.
    [switch]$DryRun
)

# Native tools (az, docker, gh) write warnings and progress to stderr, which PowerShell turns into
# errors under "Stop". Their exit codes are checked explicitly instead.
$ErrorActionPreference = "Continue"
$PSDefaultParameterValues["*:ErrorAction"] = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Invoke-Checked {
    param([ScriptBlock]$Command, [string]$Description)
    if ($DryRun) { Write-Host "[dry-run] $Description" -ForegroundColor DarkGray; return }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $Command } finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0) { throw "FAILED: $Description (exit code $LASTEXITCODE)" }
}

function Write-Step([string]$Text) { Write-Host "== $Text ==" -ForegroundColor Cyan }

# --- configuration ------------------------------------------------------------------------

$config = Get-Content "$PSScriptRoot\marketing.json" -Raw | ConvertFrom-Json
$shared = Get-Content "$PSScriptRoot\shared.json" -Raw | ConvertFrom-Json

$rg = [string]$config.resourceGroup
$region = [string]$config.region
$appName = [string]$config.appName
$minReplicas = [int]$config.minReplicas
$siteDomain = ([string]$config.siteDomain).Trim().ToLowerInvariant()
$notifyAddress = [string]$config.notifyAddress
$envName = "marketing"

$placeholders = @()
if ($notifyAddress -match "@example\.(com|org|net|invalid)$" -or $notifyAddress -eq "TODO") { $placeholders += "notifyAddress ($notifyAddress)" }
if (-not $siteDomain) { $placeholders += "siteDomain (the site would be served at the default azurecontainerapps.io address)" }

if ($placeholders -and -not $Staging -and -not $DryRun) {
    throw "deploy/marketing.json still has placeholders: $($placeholders -join '; '). Fill them in, or use -Staging to deploy a noindex staging site."
}
if ($placeholders) { Write-Host "Placeholders in marketing.json (allowed here): $($placeholders -join '; ')" -ForegroundColor Yellow }

# The Container Apps environment to join: the canary stack's (a subscription can be capped at one).
$envStackPath = "$PSScriptRoot\stacks\$($config.environmentStack).json"
if (-not (Test-Path $envStackPath)) { throw "environmentStack '$($config.environmentStack)' has no manifest at $envStackPath" }
$envStack = Get-Content $envStackPath -Raw | ConvertFrom-Json

# --- secrets, generated once and kept outside the repo -------------------------------------

$stateDir = "$PSScriptRoot\.marketing"
if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null }

function Get-StateValue([string]$Name, [ScriptBlock]$Generate) {
    $file = "$stateDir\$Name"
    if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
    $value = & $Generate
    if (-not $DryRun) { Set-Content -Path $file -Value $value -NoNewline }
    return $value
}

$formSecret = Get-StateValue "formsecret" {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

# --- 1. resource group and the shared registry ---------------------------------------------------

Write-Step "Resource group and registry"
Invoke-Checked { az group create --name $rg --location $region --output none } "create resource group $rg"
$acrName = [string]$shared.registryName
$acrLoginServer = if ($DryRun) { "$acrName.azurecr.io" } else { az acr show --name $acrName --resource-group $shared.resourceGroup --query loginServer -o tsv }
$acrId = if ($DryRun) { "<acr id>" } else { az acr show --name $acrName --resource-group $shared.resourceGroup --query id -o tsv }
if (-not $DryRun -and -not $acrLoginServer) { throw "The shared registry $acrName does not exist yet: run deploy/provision.ps1 for any stack first." }

$environmentId = if ($DryRun) { "<environment id>" } else { az containerapp env show --name car-rental-env --resource-group $envStack.resourceGroup --query id -o tsv }
if (-not $DryRun -and -not $environmentId) { throw "The Container Apps environment of stack '$($config.environmentStack)' was not found." }

# --- 2. phase 1: the pull identity ------------------------------------------------------------------

Write-Step "Pull identity (phase 1)"
$appExists = $false
if (-not $DryRun) { az containerapp show --name $appName --resource-group $rg --output none 2>$null; $appExists = ($LASTEXITCODE -eq 0) }

$baseParams = @(
    "location=$region", "appName=$appName", "containerAppsEnvironmentId=$environmentId",
    "registryName=$acrName", "registryResourceGroup=$($shared.resourceGroup)", "notifyAddress=$notifyAddress", "minReplicas=$minReplicas"
)
Invoke-Checked {
    az deployment group create --resource-group $rg --template-file "$PSScriptRoot\marketing.bicep" `
        --parameters @baseParams deployApp=false --output none
} "deploy marketing.bicep phase 1 (identity and registry role)"

if (-not $appExists -and -not $DryRun) {
    # A new role assignment can take a minute to take effect, and the app pulls its image the moment it exists.
    Write-Host "Waiting for the registry role to take effect (a new identity)..."
    Start-Sleep -Seconds 60
}

# --- 3. email -----------------------------------------------------------------------------------------

$mailDomain = ([string]$config.mail.domain).Trim().ToLowerInvariant()
$mailFrom = ""
$acsConnection = ""

if ($mailDomain) {
    Write-Step "Email"
    $mailUser = if ($config.mail.fromUsername) { [string]$config.mail.fromUsername } else { "hello" }
    $mailFrom = "$mailUser@$mailDomain"
    $mailDisplay = if ($config.mail.fromName) { [string]$config.mail.fromName } else { "Demo requests" }
    $emailServiceName = "$appName-email"
    $commServiceName = "$appName-comm"
    $emailApi = "2023-04-01"

    function Deploy-Email([bool]$Link) {
        $linkValue = if ($Link) { "true" } else { "false" }
        az deployment group create --resource-group $rg --template-file "$PSScriptRoot\email.bicep" `
            --parameters emailServiceName=$emailServiceName communicationServiceName=$commServiceName `
            domainName=$mailDomain senderUsername=$mailUser "senderDisplayName=$mailDisplay" linkDomain=$linkValue --output none
    }

    Invoke-Checked { Deploy-Email $false } "create the email service and domain"

    if ($DryRun) {
        Write-Host "[dry-run] read the domain's DNS records, verify them, link the domain, read the connection string" -ForegroundColor DarkGray
    } else {
        $subscriptionId = az account show --query id -o tsv
        $domainUri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg/providers/Microsoft.Communication/emailServices/$emailServiceName/domains/${mailDomain}"
        $verificationTypes = @("Domain", "SPF", "DKIM", "DKIM2")

        function Get-DomainState { az rest --method get --uri "${domainUri}?api-version=$emailApi" --query properties -o json | ConvertFrom-Json }
        function Test-AllVerified($state) { -not ($verificationTypes | Where-Object { $state.verificationStates.$_.status -ne "Verified" }) }

        $domainState = Get-DomainState

        if (-not (Test-AllVerified $domainState)) {
            $untouched = -not ($verificationTypes | Where-Object { $domainState.verificationStates.$_.status -ne "NotStarted" })

            Write-Host ""
            Write-Host "Add these DNS records at the provider that manages $mailDomain :" -ForegroundColor Yellow
            foreach ($type in $verificationTypes) {
                $record = $domainState.verificationRecords.$type
                if ($record) { Write-Host ("  {0,-6} {1,-6} name={2}  value={3}  ttl={4}" -f $type, $record.type, $record.name, $record.value, $record.ttl) }
            }
            Write-Host ""

            if ($untouched) {
                Write-Host "Once they are added, run this script again: it will then ask Azure to verify them." -ForegroundColor Yellow
            } else {
                foreach ($type in $verificationTypes) {
                    $status = $domainState.verificationStates.$type.status
                    if ($status -in @("NotStarted", "VerificationFailed")) {
                        $bodyFile = New-TemporaryFile
                        Set-Content -Path $bodyFile -Value (@{ verificationType = $type } | ConvertTo-Json -Compress) -Encoding ascii
                        az rest --method post --uri "${domainUri}/initiateVerification?api-version=$emailApi" --body "@$bodyFile" --output none 2>$null
                        Remove-Item $bodyFile -ErrorAction SilentlyContinue
                    }
                }

                Write-Host "Waiting for Azure to verify the records (up to 3 minutes)..."
                for ($i = 0; $i -lt 12 -and -not (Test-AllVerified $domainState); $i++) {
                    Start-Sleep -Seconds 15
                    $domainState = Get-DomainState
                }
            }
        }

        if (Test-AllVerified $domainState) {
            Invoke-Checked { Deploy-Email $true } "link the domain to the sending service"
            $acsConnection = az rest --method post --uri "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg/providers/Microsoft.Communication/communicationServices/$commServiceName/listKeys?api-version=$emailApi" --query primaryConnectionString -o tsv
            if (-not $acsConnection) { throw "FAILED: read the email service's connection string" }
            Write-Host "Email is on: mail is sent from $mailFrom."
        } else {
            $mailFrom = ""
            Write-Host "Email stays off until the domain is verified: the form will tell visitors to write instead." -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "No mail domain in marketing.json: the form will tell visitors to write instead of sending." -ForegroundColor Yellow
}

# --- 4. the image and phase 2: the app ------------------------------------------------------------------

Write-Step "Image"
if (-not $ImageTag) {
    $sha = if ($DryRun) { "<commit>" } else { (git -C $repoRoot rev-parse --short=12 HEAD).Trim() }
    $ImageTag = "provision-$sha"
}
$siteUrl = if ($siteDomain) { "https://$siteDomain" } else { "" }
# Canonical links, robots.txt and the noindex tag are baked into the pages when the image is built.
$indexable = if ($config.indexable) { "true" } else { "" }
Invoke-Checked { az acr login --name $acrName } "az acr login"
Invoke-Checked {
    docker build -t "$acrLoginServer/marketing:$ImageTag" -f "$repoRoot\marketing\Dockerfile" `
        --build-arg "SITE_URL=$siteUrl" --build-arg "SITE_INDEXABLE=$indexable" $repoRoot
} "build the marketing image"
Invoke-Checked { docker push "$acrLoginServer/marketing:$ImageTag" } "push the marketing image"

Write-Step "Container App (phase 2)"

# Secrets not given this time keep their current value: the template replaces the whole list.
function Get-ExistingSecret([string]$Name) {
    if (-not $appExists -or $DryRun) { return "" }
    $value = az containerapp secret show --name $appName --resource-group $rg --secret-name $Name --query value -o tsv 2>$null
    return "$value".Trim()
}
$turnstileSecret = if ($TurnstileSecretKey) { $TurnstileSecretKey } else { Get-ExistingSecret "turnstile-secret-key" }
$acsConnectionToUse = if ($acsConnection) { $acsConnection } else { Get-ExistingSecret "acs-connection-string" }
$mailFromToUse = $mailFrom
if (-not $mailFromToUse -and $acsConnectionToUse -and $mailDomain) { $mailFromToUse = "$([string]$config.mail.fromUsername)@$mailDomain" }

if (-not $turnstileSecret -and -not $Staging -and -not $DryRun) {
    Write-Host "No Turnstile secret key: the form will refuse to send in production until one is given (-TurnstileSecretKey)." -ForegroundColor Yellow
}

$appParams = $baseParams + @(
    "deployApp=true", "image=$acrLoginServer/marketing:$ImageTag", "siteUrl=$siteUrl",
    "cspEnforce=$(if ($EnforceCsp) { 'true' } else { 'false' })",
    "formSecret=$formSecret", "mailFromAddress=$mailFromToUse"
)
$siteKey = if ($TurnstileSiteKey) { $TurnstileSiteKey } else { "" }
if ($siteKey) { $appParams += "turnstileSiteKey=$siteKey" }
if ($turnstileSecret) { $appParams += "turnstileSecretKey=$turnstileSecret" }
if ($acsConnectionToUse) { $appParams += "acsConnectionString=$acsConnectionToUse" }

$appFqdn = "<app fqdn>"
if (-not $DryRun) {
    $outputs = az deployment group create --resource-group $rg --template-file "$PSScriptRoot\marketing.bicep" `
        --parameters @appParams --query properties.outputs --output json
    if ($LASTEXITCODE -ne 0) { throw "FAILED: deploy marketing.bicep phase 2 (the app)" }
    $appFqdn = ($outputs | ConvertFrom-Json).appFqdn.value
} else {
    Write-Host "[dry-run] deploy marketing.bicep phase 2 (the app) with image $acrLoginServer/marketing:$ImageTag" -ForegroundColor DarkGray
}

# --- 5. custom domain -------------------------------------------------------------------------------------

Write-Step "Custom domain"
if (-not $siteDomain) {
    Write-Host "No siteDomain in marketing.json: the site is served at https://$appFqdn (noindex). Set it once the name is chosen." -ForegroundColor Yellow
} elseif ($DryRun) {
    Write-Host "[dry-run] add hostname $siteDomain, print the DNS records, bind a managed certificate" -ForegroundColor DarkGray
} else {
    $verificationId = az containerapp show --name $appName --resource-group $rg --query properties.customDomainVerificationId -o tsv
    $hostnames = az containerapp hostname list --name $appName --resource-group $rg --query "[].name" -o tsv
    Write-Host ""
    Write-Host "DNS records for $siteDomain (at the provider that manages the domain):" -ForegroundColor Yellow
    Write-Host "  CNAME  $siteDomain  ->  $appFqdn      (for an apex domain use an ALIAS/ANAME, or a www. name that redirects)"
    Write-Host "  TXT    asuid.$siteDomain  =  $verificationId"
    Write-Host ""

    if ($hostnames -notcontains $siteDomain) {
        az containerapp hostname add --name $appName --resource-group $rg --hostname $siteDomain --output none 2>$null
    }
    az containerapp hostname bind --name $appName --resource-group $rg --hostname $siteDomain --environment car-rental-env --validation-method CNAME --output none
    if ($LASTEXITCODE -ne 0) {
        Write-Host "The certificate could not be created yet (the DNS records are probably not visible). Add them and run this script again." -ForegroundColor Yellow
    } else {
        Write-Host "https://$siteDomain is served with a managed certificate."
    }
}

# --- 6. GitHub Environment, OIDC login and roles -----------------------------------------------------------------

Write-Step "GitHub Environment $envName"
$repo = if ($DryRun) { "<owner/repo>" } else { (gh repo view --json nameWithOwner --jq .nameWithOwner).Trim() }
$subscriptionIdGh = if ($DryRun) { "<subscription>" } else { az account show --query id -o tsv }
$tenantId = if ($DryRun) { "<tenant>" } else { az account show --query tenantId -o tsv }
$ciSpObjectId = if ($DryRun) { "<ci sp>" } else { az ad sp show --id $shared.ciAppId --query id -o tsv }

Invoke-Checked { gh api -X PUT "repos/$repo/environments/$envName" --silent } "create GitHub environment $envName"

$vars = @{
    RESOURCE_GROUP = $rg; APP_NAME = $appName; ACR_NAME = $acrName; ACR_LOGIN_SERVER = $acrLoginServer
    SITE_URL = $siteUrl; SITE_INDEXABLE = $indexable
}
foreach ($name in $vars.Keys) {
    if (-not "$($vars[$name])") { continue }
    Invoke-Checked { gh variable set $name --env $envName --body "$($vars[$name])" } "set variable $name"
}
$envSecrets = @{ AZURE_CLIENT_ID = $shared.ciAppId; AZURE_TENANT_ID = $tenantId; AZURE_SUBSCRIPTION_ID = $subscriptionIdGh }
foreach ($name in $envSecrets.Keys) {
    Invoke-Checked { gh secret set $name --env $envName --body "$($envSecrets[$name])" } "set secret $name"
}

# A job in an environment presents an environment subject, so the environment needs its own federated
# credential (in both of GitHub's subject forms), on the CI app the stacks already use.
if (-not $DryRun) {
    $info = gh api "repos/$repo" | ConvertFrom-Json
    $subjects = @{
        "github-$envName" = "repo:${repo}:environment:$envName"
        "github-$envName-immutable-id" = "repo:$($info.owner.login)@$($info.owner.id)/$($info.name)@$($info.id):environment:$envName"
    }
    $existing = az ad app federated-credential list --id $shared.ciAppId --query "[].name" -o tsv
    foreach ($name in $subjects.Keys) {
        if ($existing -contains $name) { continue }
        $credential = @{ name = $name; issuer = "https://token.actions.githubusercontent.com"; subject = $subjects[$name]; audiences = @("api://AzureADTokenExchange") } | ConvertTo-Json -Compress
        $path = Join-Path $env:TEMP "$name.json"
        Set-Content -Path $path -Value $credential
        az ad app federated-credential create --id $shared.ciAppId --parameters $path --output none
        if ($LASTEXITCODE -ne 0) { throw "FAILED: federated credential $name" }
    }

    # Only what the release needs: update this one app, and push images to the shared registry.
    $rgId = az group show --name $rg --query id -o tsv
    foreach ($assignment in @(@{ Role = "Container Apps Contributor"; Scope = $rgId }, @{ Role = "AcrPush"; Scope = $acrId })) {
        az role assignment create --assignee-object-id $ciSpObjectId --assignee-principal-type ServicePrincipal `
            --role $assignment.Role --scope $assignment.Scope --output none 2>$null
    }
} else {
    Write-Host "[dry-run] create federated credentials and the two role assignments for environment $envName" -ForegroundColor DarkGray
}

# --- 7. smoke test -------------------------------------------------------------------------------------------------

Write-Step "Smoke test"
if ($DryRun) {
    Write-Host "[dry-run] GET https://$appFqdn/health, /, /screens/dashboard-800.webp and /api/demo/session" -ForegroundColor DarkGray
} else {
    $base = "https://$appFqdn"
    $failures = @()
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        $failures = @()
        # A site scaled to zero needs a few seconds to wake.
        foreach ($path in @("/health", "/", "/demo", "/screens/dashboard-800.webp", "/api/demo/session")) {
            try { $r = Invoke-WebRequest "$base$path" -UseBasicParsing -TimeoutSec 20; if ($r.StatusCode -ne 200) { $failures += "$path -> $($r.StatusCode)" } }
            catch { $failures += "$path -> $($_.Exception.Message)" }
        }
        if (-not $failures) { break }
        Start-Sleep -Seconds 10
    }
    if ($failures) { throw "FAILED: smoke test: $($failures -join '; ')" }
    Write-Host "The site answers: $base"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
if (-not $DryRun) { Write-Host "Site: https://$appFqdn" }
