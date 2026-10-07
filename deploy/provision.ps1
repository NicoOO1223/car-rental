# Provisions (or updates) one customer stack from its manifest, end to end.
#
#   .\deploy\provision.ps1 -Stack acme -AdminEmail owner@acme.example `
#       -StripeSecretKey sk_live_... -StripePublishableKey pk_live_...
#
# The stack is described by deploy/stacks/<slug>.json (no secrets). Everything
# here is idempotent: running it again on a finished stack changes nothing
# except what changed in the manifest or the code.
#
# What it does, in order:
#   1. Shared registry (deploy/shared.bicep) and the stack's own resource
#      group, Postgres, backup storage and Container Apps environment.
#   2. Generates the stack's secrets once and keeps them in deploy/.stacks/<slug>/
#      (gitignored) and in the stack's Container App secrets, never in the repo.
#   3. Builds the images locally (ACR Tasks is not available on trial
#      subscriptions) and creates/updates the Container Apps: the backend,
#      the staff frontend and, when the manifest has "storefront": {"enabled":
#      true}, the public storefront plus the scheduled job that expires unpaid
#      holds.
#   4. Registers the Stripe webhook endpoint with the customer's own key.
#   5. Creates the GitHub Environment stack-<slug> that the release pipeline
#      deploys through, with its OIDC login and just the Azure roles it needs.
#   6. Sets up the first administrator and the business profile (the backend does
#      this on start, from the values set here), then smoke-tests the stack.
#
# Prerequisites: az CLI logged in (az login), containerapp extension, gh CLI
# logged in, Docker running, Git Bash (for the smoke test).

param(
    [Parameter(Mandatory = $true)][string]$Stack,
    # The first administrator. Required for a new stack; ignored once the
    # stack has one.
    [string]$AdminEmail = "",
    # The customer's own Stripe keys. Empty leaves card payment off (cash
    # still works) until they are given on a later run.
    [string]$StripeSecretKey = "",
    [string]$StripePublishableKey = "",
    [string]$SentryDsn = "",
    # Cloudflare Turnstile (the bot check on the public storefront): the public
    # site key for the browser and the secret key for the backend. Empty leaves
    # what is already set alone; a production backend refuses to take online
    # bookings without the secret.
    [string]$TurnstileSiteKey = "",
    [string]$TurnstileSecretKey = "",
    # Switch the running app to the DML-only database role once it exists.
    [switch]$UseAppRole,
    # Print every step without changing anything.
    [switch]$DryRun,
    # Reuse this image tag instead of building the current commit.
    [string]$ImageTag = ""
)

# Native tools (az, docker, gh) write warnings and progress to stderr, which
# PowerShell turns into errors under "Stop". Their exit codes are checked
# explicitly instead, and cmdlets are still made to stop on error.
$ErrorActionPreference = "Continue"
$PSDefaultParameterValues["*:ErrorAction"] = "Stop"
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path

function Invoke-Checked {
    param([ScriptBlock]$Command, [string]$Description)
    if ($DryRun) { Write-Host "[dry-run] $Description" -ForegroundColor DarkGray; return }
    # Native tools (docker, az) write progress to stderr, which PowerShell
    # would treat as a failure under "Stop". Their exit code is what counts.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { & $Command } finally { $ErrorActionPreference = $previous }
    if ($LASTEXITCODE -ne 0) { throw "FAILED: $Description (exit code $LASTEXITCODE)" }
}

function Write-Step([string]$Text) { Write-Host "== $Text ==" -ForegroundColor Cyan }

# --- manifests ----------------------------------------------------------------

$manifestPath = "$PSScriptRoot\stacks\$Stack.json"
if (-not (Test-Path $manifestPath)) { throw "No manifest at $manifestPath" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if ($manifest.slug -ne $Stack) { throw "The manifest's slug '$($manifest.slug)' does not match -Stack '$Stack'" }

$shared = Get-Content "$PSScriptRoot\shared.json" -Raw | ConvertFrom-Json

$rg = $manifest.resourceGroup
$region = $manifest.region
$minReplicas = [int]$manifest.backendMinReplicas
$envName = "stack-$Stack"

# The public storefront is optional per stack.
$storefrontEnabled = [bool]($manifest.storefront -and $manifest.storefront.enabled)
$storefrontMinReplicas = if ($manifest.storefront -and $null -ne $manifest.storefront.minReplicas) { [int]$manifest.storefront.minReplicas } else { 0 }

# A stack normally gets its own Container Apps environment. "sharedEnvironmentStack"
# is a stopgap for a subscription capped at one environment (in total, or per
# region) — this stack's app names then get a per-stack prefix, since Container
# Apps ingress needs a name unique across the whole environment they join, not
# only within this stack's own resource group. Its database and backups are
# still entirely its own either way.
$sharedEnvironmentStack = $manifest.sharedEnvironmentStack
$appPrefix = if ($sharedEnvironmentStack) { "car-rental-$Stack" } else { "car-rental" }
$backendApp = "$appPrefix-backend"
$frontendApp = "$appPrefix-frontend"
$storefrontApp = "$appPrefix-storefront"
$sweeperJob = "$appPrefix-sweeper"

# --- per-stack secrets, generated once and kept outside the repo ---------------

$stateDir = "$PSScriptRoot\.stacks\$Stack"
if (-not $DryRun) { New-Item -ItemType Directory -Force -Path $stateDir | Out-Null }

function Get-StackValue {
    # Reads a cached value, or makes one with $Generate and caches it. A stack
    # created before manifests existed keeps its secrets in deploy/.<name>.
    param([string]$Name, [ScriptBlock]$Generate)
    $file = "$stateDir\$Name"
    if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
    $legacy = "$PSScriptRoot\.$Name"
    if ($manifest.legacySecrets -and (Test-Path $legacy)) {
        $value = (Get-Content $legacy -Raw).Trim()
    } else {
        $value = & $Generate
    }
    if (-not $DryRun) { Set-Content -Path $file -Value $value -NoNewline }
    return $value
}

function New-RandomText([int]$Length, [string]$Alphabet) {
    -join (1..$Length | ForEach-Object { $Alphabet[(Get-Random -Maximum $Alphabet.Length)] })
}
$alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

$suffix = Get-StackValue "suffix" { New-RandomText 6 "abcdefghijklmnopqrstuvwxyz0123456789" }
$pgPassword = Get-StackValue "pgpassword" { New-RandomText 24 $alnum }
$appPassword = Get-StackValue "apppassword" { New-RandomText 24 $alnum }
$secretKey = Get-StackValue "secretkey" {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}
# A stack created before manifests existed keeps its Stripe and Sentry values in
# the local dev env files, as bootstrap.ps1 read them.
function Get-EnvFileValue([string]$Path, [string]$Key) {
    if (-not (Test-Path $Path)) { return "" }
    $line = Get-Content $Path | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -split "=", 2)[1].Trim()
}
if ($manifest.legacySecrets) {
    if (-not $StripeSecretKey) { $StripeSecretKey = Get-EnvFileValue "$repoRoot\backend\.env" "STRIPE_SECRET_KEY" }
    if (-not $StripePublishableKey) { $StripePublishableKey = Get-EnvFileValue "$repoRoot\frontend\.env.local" "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" }
    if (-not $SentryDsn) { $SentryDsn = Get-EnvFileValue "$repoRoot\backend\.env" "SENTRY_DSN" }
}

# Shared by the backend and the staff web app. The web app calls the API from its
# own server, so the API would see every staff member at one address; with this
# secret the web app can say who the visitor is (see backend/app/services/client_ip.py).
$proxySecret = Get-StackValue "proxysecret" {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$webhookSecret = if (Test-Path "$stateDir\webhooksecret") { (Get-Content "$stateDir\webhooksecret" -Raw).Trim() } else { "" }
$adminPassword = Get-StackValue "adminpassword" { New-RandomText 20 "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789" }

Write-Host "Stack:          $Stack  (resource group $rg, $region)"
Write-Host "Shared registry: $($shared.registryName) in $($shared.resourceGroup)"
if ($DryRun) { Write-Host "DRY RUN: nothing below is executed." -ForegroundColor Yellow }

# --- 1. shared registry and the stack's infrastructure ---------------------------

Write-Step "Shared registry"
Invoke-Checked { az group create --name $shared.resourceGroup --location $shared.region --output none } "create shared resource group"
Invoke-Checked {
    az deployment group create --resource-group $shared.resourceGroup --template-file "$PSScriptRoot\shared.bicep" `
        --parameters registryName=$($shared.registryName) location=$($shared.region) --output none
} "deploy shared registry"
$acrName = $shared.registryName
$acrId = if ($DryRun) { "<acr id>" } else { az acr show --name $acrName --resource-group $shared.resourceGroup --query id -o tsv }
$acrLoginServer = if ($DryRun) { "$acrName.azurecr.io" } else { az acr show --name $acrName --resource-group $shared.resourceGroup --query loginServer -o tsv }

Write-Step "Stack infrastructure"
Invoke-Checked { az group create --name $rg --location $region --output none } "create resource group"

$ciSpObjectId = if ($DryRun) { "<ci sp>" } else { az ad sp show --id $shared.ciAppId --query id -o tsv }

$existingEnvId = ""
if ($sharedEnvironmentStack) {
    $otherManifestPath = "$PSScriptRoot\stacks\$sharedEnvironmentStack.json"
    if (-not (Test-Path $otherManifestPath)) { throw "sharedEnvironmentStack '$sharedEnvironmentStack' has no manifest at $otherManifestPath" }
    $otherManifest = Get-Content $otherManifestPath -Raw | ConvertFrom-Json
    $existingEnvId = if ($DryRun) { "<shared env id>" } else { az containerapp env show --name car-rental-env --resource-group $otherManifest.resourceGroup --query id -o tsv }
}

if (-not $DryRun) {
    $bicepParams = @("uniqueSuffix=$suffix", "postgresAdminPassword=$pgPassword", "backupPrincipalObjectId=$ciSpObjectId", "location=$region")
    if ($existingEnvId) { $bicepParams += "existingContainerAppsEnvironmentId=$existingEnvId" }
    $deployJson = az deployment group create --resource-group $rg --template-file "$PSScriptRoot\main.bicep" `
        --parameters @bicepParams `
        --query properties.outputs --output json
    if ($LASTEXITCODE -ne 0) { throw "FAILED: stack infrastructure deployment" }
    $infra = $deployJson | ConvertFrom-Json
    $containerAppsEnvId = $infra.containerAppsEnvId.value
    $postgresFqdn = $infra.postgresServerFqdn.value
    $postgresDb = $infra.postgresDbName.value
    $backupAccount = $infra.backupStorageAccountName.value
    $photoAccount = $infra.photoStorageAccountName.value
} else {
    Write-Host "[dry-run] deploy main.bicep" -ForegroundColor DarkGray
    $containerAppsEnvId = "<env id>"; $postgresFqdn = "<postgres>"; $postgresDb = "car_rental"; $backupAccount = "<backup account>"; $photoAccount = "<photo account>"
}

$migrationDatabaseUrl = "postgresql+psycopg://carrentaladmin:${pgPassword}@${postgresFqdn}:5432/${postgresDb}?sslmode=require"
$appRoleDone = Test-Path "$stateDir\approle"
if ($UseAppRole -or $appRoleDone) {
    $databaseUrl = "postgresql+psycopg://carrental_app:${appPassword}@${postgresFqdn}:5432/${postgresDb}?sslmode=require"
} else {
    $databaseUrl = $migrationDatabaseUrl
}

# --- 2. images -----------------------------------------------------------------------

if (-not $ImageTag) {
    $sha = (git -C $repoRoot rev-parse --short=12 HEAD).Trim()
    $ImageTag = "provision-$sha"
}

Write-Step "Images ($ImageTag)"
Invoke-Checked { az acr login --name $acrName } "az acr login"
Invoke-Checked { docker build -t "$acrLoginServer/backend:$ImageTag" -f "$repoRoot\backend\Dockerfile" "$repoRoot\backend" } "build backend image"
Invoke-Checked { docker push "$acrLoginServer/backend:$ImageTag" } "push backend image"
# One frontend image for every stack: nothing stack-specific is baked in.
Invoke-Checked { docker build -t "$acrLoginServer/frontend:$ImageTag" -f "$repoRoot\frontend\Dockerfile" "$repoRoot\frontend" } "build frontend image"
Invoke-Checked { docker push "$acrLoginServer/frontend:$ImageTag" } "push frontend image"
if ($storefrontEnabled) {
    # Built from the repository root: the storefront imports the shared/ folder.
    Invoke-Checked { docker build -t "$acrLoginServer/storefront:$ImageTag" -f "$repoRoot\storefront\Dockerfile" $repoRoot } "build storefront image"
    Invoke-Checked { docker push "$acrLoginServer/storefront:$ImageTag" } "push storefront image"
}

# --- 3. the backend ------------------------------------------------------------------

function Get-ContainerTemplate([bool]$IsJob, [string]$Name) {
    # Reads back a Container App (or job)'s own template right after changing
    # it. Azure's control plane can in principle still be applying that
    # change a moment later, so this waits for provisioningState to settle
    # rather than failing on that, though in practice the read has always
    # come back correct on the first try.
    $lastState = "<no response>"
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $resource = if ($IsJob) {
            az containerapp job show --name $Name --resource-group $rg --output json | ConvertFrom-Json
        } else {
            az containerapp show --name $Name --resource-group $rg --output json | ConvertFrom-Json
        }
        $lastState = $resource.properties.provisioningState
        $count = $resource.properties.template.containers.Count
        Write-Host "  (${Name}: attempt $attempt, provisioningState=$lastState, containers=$count)"
        if ($lastState -eq "Succeeded" -and $count -gt 0) { return $resource }
        Start-Sleep -Seconds 5
    }
    throw "FAILED: $Name did not settle (last provisioningState: $lastState) after several attempts to read it back"
}

function Set-BackendProbes([string]$App) {
    # The az containerapp create/update flags cannot set health probes, so
    # this reads the app, adds them and applies the result as YAML.
    #  - Startup: gives migrations plus boot up to 150s before liveness starts.
    #  - Liveness: /health restarts a hung process, without touching the database.
    #  - Readiness: /ready keeps a revision that cannot reach the database out of traffic.
    # Deliberately not "$app": PowerShell variable names are case-insensitive,
    # so that would be the very same variable as the $App parameter above —
    # assigning it here would silently coerce this object back to a string
    # (retaining $App's declared [string] type), corrupting it.
    $current = Get-ContainerTemplate $false $App
    $container = $current.properties.template.containers[0]
    $probes = @(
        @{ type = "Startup";   httpGet = @{ path = "/health"; port = 8000 }; periodSeconds = 5;  failureThreshold = 30 },
        @{ type = "Liveness";  httpGet = @{ path = "/health"; port = 8000 }; periodSeconds = 30; failureThreshold = 3; timeoutSeconds = 5 },
        @{ type = "Readiness"; httpGet = @{ path = "/ready";  port = 8000 }; periodSeconds = 10; failureThreshold = 3; timeoutSeconds = 5 }
    )
    $container | Add-Member -NotePropertyName probes -NotePropertyValue $probes -Force
    $yamlPath = Join-Path $env:TEMP "backend-probes-$Stack.yaml"
    $json = @{ properties = @{ template = @{ containers = @($container) } } } | ConvertTo-Json -Depth 20
    # No byte-order mark: the YAML parser in the CLI rejects one.
    [System.IO.File]::WriteAllText($yamlPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    az containerapp update --name $App --resource-group $rg --yaml $yamlPath --output none
    if ($LASTEXITCODE -ne 0) { throw "FAILED: set backend probes" }
}

function Set-SweeperCommand([string]$JobName, [string]$Image, [string[]]$EnvVars) {
    # `az containerapp job update --command --args` mis-parses an argument
    # that starts with "-" (here, "-m") as a stray option and fails with
    # "unrecognized arguments", so the command, args and env are set together
    # as YAML instead, the same way Set-BackendProbes sets probes.
    $job = Get-ContainerTemplate $true $JobName
    $container = $job.properties.template.containers[0]
    $container.image = $Image
    $container | Add-Member -NotePropertyName command -NotePropertyValue @("python") -Force
    $container | Add-Member -NotePropertyName args -NotePropertyValue @("-m", "app.jobs.expire_holds") -Force
    $container.env = @($EnvVars | ForEach-Object {
        $name, $value = $_ -split "=", 2
        if ($value -like "secretref:*") { @{ name = $name; secretRef = $value.Substring(10) } }
        else { @{ name = $name; value = $value } }
    })
    $yamlPath = Join-Path $env:TEMP "sweeper-$Stack.yaml"
    $json = @{ properties = @{ template = @{ containers = @($container) } } } | ConvertTo-Json -Depth 20
    # No byte-order mark: the YAML parser in the CLI rejects one.
    [System.IO.File]::WriteAllText($yamlPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    az containerapp job update --name $JobName --resource-group $rg --yaml $yamlPath --output none
    if ($LASTEXITCODE -ne 0) { throw "FAILED: set sweeper command" }
}

function Grant-AcrPull([string]$App) {
    # Idempotent safety net in case the create-time role assignment did not take.
    $principal = az containerapp show --name $App --resource-group $rg --query identity.principalId -o tsv
    az role assignment create --assignee $principal --role AcrPull --scope $acrId --output none 2>$null
    az containerapp registry set --name $App --resource-group $rg --server $acrLoginServer --identity system --output none
    if ($LASTEXITCODE -ne 0) { throw "FAILED: set $App registry identity" }
}

Write-Step "Backend"
$backendImage = "$acrLoginServer/backend:$ImageTag"
$exists = $false
if (-not $DryRun) { az containerapp show --name $backendApp --resource-group $rg --output none 2>$null; $exists = ($LASTEXITCODE -eq 0) }

if (-not $exists) {
    # The image cannot be pulled until the app's identity has AcrPull, so the
    # app is created from a public placeholder and switched to the real image
    # once the role and registry are wired up.
    Invoke-Checked {
        az containerapp create --name $backendApp --resource-group $rg --environment $containerAppsEnvId `
            --image "mcr.microsoft.com/k8se/quickstart:latest" --target-port 8000 --ingress external `
            --min-replicas $minReplicas --max-replicas 1 --cpu 0.25 --memory 0.5Gi --system-assigned --output none
    } "create backend container app"
}
if (-not $DryRun) { Grant-AcrPull $backendApp }

# The backend reads and writes condition photos itself (see
# app/services/photo_storage.py), unlike the backup storage account above,
# which only CI's service principal ever touches — so this role goes to the
# backend Container App's own identity instead of $ciSpObjectId.
if (-not $DryRun) {
    $backendPrincipalId = az containerapp show --name $backendApp --resource-group $rg --query identity.principalId -o tsv
    $photoStorageId = az storage account show --name $photoAccount --resource-group $rg --query id -o tsv
    az role assignment create --assignee-object-id $backendPrincipalId --assignee-principal-type ServicePrincipal `
        --role "Storage Blob Data Contributor" --scope $photoStorageId --output none 2>$null
} else {
    Write-Host "[dry-run] grant the backend access to photo storage" -ForegroundColor DarkGray
}

$firstAdmin = [bool]$AdminEmail
$isNew = -not $exists

# On an existing stack a value that was not given is left as it is, so
# re-running never wipes a key that was set earlier. A new app needs every
# secret to exist (empty is fine) before its settings can refer to them.
# The database login of an existing stack is only changed on request
# (-UseAppRole): it may already be on the DML-only role.
$secretArgs = @("migration-database-url=$migrationDatabaseUrl", "secret-key=$secretKey", "trusted-proxy-secret=$proxySecret")
if ($isNew -or $UseAppRole) { $secretArgs += "database-url=$databaseUrl" }
$existingSecrets = @()
if ($exists -and -not $DryRun) { $existingSecrets = @(az containerapp secret list --name $backendApp --resource-group $rg --query "[].name" -o tsv) }

# Container Apps refuses an empty secret, so an optional secret with no value
# simply does not exist, and the setting that would refer to it is left out.
# An existing one is kept as it is unless a new value is given.
$optionalSecrets = @(
    @{ Name = "stripe-secret-key";     Value = $StripeSecretKey; Env = "STRIPE_SECRET_KEY" },
    @{ Name = "stripe-webhook-secret"; Value = $webhookSecret;   Env = "STRIPE_WEBHOOK_SECRET" },
    @{ Name = "sentry-dsn";            Value = $SentryDsn;       Env = "SENTRY_DSN" },
    @{ Name = "turnstile-secret-key";  Value = $TurnstileSecretKey; Env = "TURNSTILE_SECRET_KEY" }
)
$optionalEnv = @()
foreach ($secret in $optionalSecrets) {
    if ($secret.Value) { $secretArgs += "$($secret.Name)=$($secret.Value)" }
    if ($secret.Value -or ($existingSecrets -contains $secret.Name)) { $optionalEnv += "$($secret.Env)=secretref:$($secret.Name)" }
}
# --- email -------------------------------------------------------------------------------
# Renters get a confirmation, a cancellation notice and a receipt by email, sent
# through Azure Communication Services from the business's own domain (the
# manifest's "email" block). Email stays off on a stack until its domain is
# verified, so this is safe to run before the DNS records are in place.
$emailEnabled = [bool]($manifest.email -and $manifest.email.domain)
# "azureManaged": true (and no "domain") sends from Azure's own <random>.azurecomm.net:
# no DNS records and nothing to verify, for testing. Such mail may land in a spam folder.
$emailManaged = [bool]($manifest.email -and $manifest.email.azureManaged -and -not $manifest.email.domain)
if ($emailManaged) {
    Write-Step "Email (Azure-managed test domain)"
    $emailServiceName = "car-rental-$Stack-email"
    $commServiceName = "car-rental-$Stack-comm"
    $emailDisplayName = if ($manifest.email.fromName) { [string]$manifest.email.fromName } else { [string]$manifest.business.name }
    $emailApi = "2023-04-01"

    function Deploy-ManagedEmail([bool]$Link) {
        $linkValue = if ($Link) { "true" } else { "false" }
        az deployment group create --resource-group $rg --template-file "$PSScriptRoot\email.bicep" `
            --parameters emailServiceName=$emailServiceName communicationServiceName=$commServiceName `
            azureManaged=true domainName=azure-managed senderUsername=donotreply "senderDisplayName=$emailDisplayName" linkDomain=$linkValue --output none
    }

    Invoke-Checked { Deploy-ManagedEmail $false } "create the email service and its Azure-managed domain"
    Invoke-Checked { Deploy-ManagedEmail $true } "link the domain to the sending service"

    if ($DryRun) {
        Write-Host "[dry-run] read the managed sender domain and the connection string, store them on the backend" -ForegroundColor DarkGray
    } else {
        $subscriptionId = az account show --query id -o tsv
        $senderDomain = az rest --method get --uri "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg/providers/Microsoft.Communication/emailServices/$emailServiceName/domains/AzureManagedDomain?api-version=$emailApi" --query properties.mailFromSenderDomain -o tsv
        if (-not $senderDomain) { throw "FAILED: read the Azure-managed sender domain" }
        $emailFrom = "donotreply@$senderDomain"
        $emailConnection = az rest --method post --uri "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg/providers/Microsoft.Communication/communicationServices/$commServiceName/listKeys?api-version=$emailApi" --query primaryConnectionString -o tsv
        if (-not $emailConnection) { throw "FAILED: read the email service's connection string" }

        $secretArgs += "email-connection-string=$emailConnection"
        $optionalEnv += @("EMAIL_CONNECTION_STRING=secretref:email-connection-string", "EMAIL_FROM_ADDRESS=$emailFrom")
        Write-Host "Email is on: mail is sent from $emailFrom (an Azure-managed test domain; it may land in spam)."
    }
} elseif ($emailEnabled) {
    Write-Step "Email"
    $emailDomain = ([string]$manifest.email.domain).ToLowerInvariant()
    $emailUser = if ($manifest.email.fromUsername) { [string]$manifest.email.fromUsername } else { "bookings" }
    $emailFrom = "$emailUser@$emailDomain"
    $emailServiceName = "car-rental-$Stack-email"
    $commServiceName = "car-rental-$Stack-comm"
    $emailDisplayName = if ($manifest.email.fromName) { [string]$manifest.email.fromName } else { [string]$manifest.business.name }
    $emailApi = "2023-04-01"

    function Deploy-Email([bool]$Link) {
        $linkValue = if ($Link) { "true" } else { "false" }
        az deployment group create --resource-group $rg --template-file "$PSScriptRoot\email.bicep" `
            --parameters emailServiceName=$emailServiceName communicationServiceName=$commServiceName `
            domainName=$emailDomain senderUsername=$emailUser "senderDisplayName=$emailDisplayName" linkDomain=$linkValue --output none
    }

    Invoke-Checked { Deploy-Email $false } "create the email service and domain"

    if ($DryRun) {
        Write-Host "[dry-run] read the domain's DNS records, verify them, link the domain, store the connection string" -ForegroundColor DarkGray
    } else {
        $subscriptionId = az account show --query id -o tsv
        $domainUri = "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg/providers/Microsoft.Communication/emailServices/$emailServiceName/domains/${emailDomain}"
        $verificationTypes = @("Domain", "SPF", "DKIM", "DKIM2")

        function Get-DomainState { az rest --method get --uri "${domainUri}?api-version=$emailApi" --query properties -o json | ConvertFrom-Json }
        function Test-AllVerified($state) { -not ($verificationTypes | Where-Object { $state.verificationStates.$_.status -ne "Verified" }) }

        $domainState = Get-DomainState

        if (-not (Test-AllVerified $domainState)) {
            $untouched = -not ($verificationTypes | Where-Object { $domainState.verificationStates.$_.status -ne "NotStarted" })

            Write-Host ""
            Write-Host "Add these DNS records at the provider that manages $emailDomain :" -ForegroundColor Yellow
            foreach ($type in $verificationTypes) {
                $record = $domainState.verificationRecords.$type
                if ($record) { Write-Host ("  {0,-6} {1,-6} name={2}  value={3}  ttl={4}" -f $type, $record.type, $record.name, $record.value, $record.ttl) }
            }
            Write-Host ""

            if ($untouched) {
                Write-Host "Once they are added, run this script again: it will then ask Azure to verify them." -ForegroundColor Yellow
            } else {
                # The records have been looked at before; ask Azure to check them now.
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
            $emailConnection = az rest --method post --uri "https://management.azure.com/subscriptions/$subscriptionId/resourceGroups/$rg/providers/Microsoft.Communication/communicationServices/$commServiceName/listKeys?api-version=$emailApi" --query primaryConnectionString -o tsv
            if (-not $emailConnection) { throw "FAILED: read the email service's connection string" }

            $secretArgs += "email-connection-string=$emailConnection"
            $optionalEnv += @("EMAIL_CONNECTION_STRING=secretref:email-connection-string", "EMAIL_FROM_ADDRESS=$emailFrom")
            Write-Host "Email is on: mail is sent from $emailFrom."
        } else {
            Write-Host "Email stays off until the domain is verified. The stack works without it." -ForegroundColor Yellow
        }
    }
}

if ($firstAdmin) { $secretArgs += "initial-admin-password=$adminPassword" }
Invoke-Checked { az containerapp secret set --name $backendApp --resource-group $rg --secrets @secretArgs --output none } "set backend secrets"

$businessB64 = ""
if ($manifest.business) {
    # URL-safe and unpadded: a "=" in the value broke az CLI's --set-env-vars
    # parsing (it expects exactly one KEY=VALUE separator) the first time this
    # path actually ran, on the first stack with a real business profile.
    $businessB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($manifest.business | ConvertTo-Json -Compress))).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

$backendEnv = @(
    "DATABASE_URL=secretref:database-url", "MIGRATION_DATABASE_URL=secretref:migration-database-url",
    "SECRET_KEY=secretref:secret-key", "TRUSTED_PROXY_SECRET=secretref:trusted-proxy-secret", "ENVIRONMENT=production",
    # Not a secret — the backend authenticates to it with its own managed
    # identity (granted above), the same way it already does for ACR.
    "AZURE_STORAGE_ACCOUNT_URL=https://$photoAccount.blob.core.windows.net"
)
$backendEnv += $optionalEnv
if ($firstAdmin) {
    $backendEnv += @("INITIAL_ADMIN_EMAIL=$AdminEmail", "INITIAL_ADMIN_PASSWORD=secretref:initial-admin-password", "STACK_BUSINESS_B64=$businessB64")
}
# A new stack's CORS is pointed at the real frontend below; until it exists
# nothing is allowed. An existing stack keeps serving with what it has.
$corsPending = if ($isNew) { @("CORS_ORIGINS=https://pending.invalid") } else { @() }
Invoke-Checked {
    az containerapp update --name $backendApp --resource-group $rg --image $backendImage `
        --min-replicas $minReplicas --set-env-vars @backendEnv @corsPending --output none
} "deploy backend image and settings"
if (-not $DryRun) { Set-BackendProbes -App $backendApp }

if ($manifest.alertEmail) {
    Write-Step "Monitoring alerts"
    $pgName = $postgresFqdn.Split(".")[0]
    Invoke-Checked {
        az deployment group create --resource-group $rg --template-file "$PSScriptRoot\alerts.bicep" `
            --parameters alertEmail=$($manifest.alertEmail) postgresServerName=$pgName --output none
    } "deploy alerts"
} else {
    Write-Host "No alertEmail in the manifest: monitoring alerts skipped." -ForegroundColor Yellow
}

$backendFqdn = if ($DryRun) { "<backend fqdn>" } else { az containerapp show --name $backendApp --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv }
$apiUrl = "https://$backendFqdn"

# --- 4. the frontend -----------------------------------------------------------------

Write-Step "Frontend"
$frontendImage = "$acrLoginServer/frontend:$ImageTag"
$fexists = $false
if (-not $DryRun) { az containerapp show --name $frontendApp --resource-group $rg --output none 2>$null; $fexists = ($LASTEXITCODE -eq 0) }
if (-not $fexists) {
    Invoke-Checked {
        az containerapp create --name $frontendApp --resource-group $rg --environment $containerAppsEnvId `
            --image "mcr.microsoft.com/k8se/quickstart:latest" --target-port 3000 --ingress external `
            --min-replicas 0 --max-replicas 1 --cpu 0.25 --memory 0.5Gi --system-assigned --output none
    } "create frontend container app"
}
if (-not $DryRun) { Grant-AcrPull $frontendApp }

# The frontend reads these when it runs, so the same image serves every stack.
# The environment variables are given a value even when empty on a new app,
# so the setting exists; on an existing one an empty value is left alone.
# The proxy secret is a Container App secret on the frontend too, not a plain
# setting, so it never shows in the app's configuration.
Invoke-Checked {
    az containerapp secret set --name $frontendApp --resource-group $rg --secrets "trusted-proxy-secret=$proxySecret" --output none
} "set frontend secrets"
$frontendEnv = @("API_URL=$apiUrl", "TRUSTED_PROXY_SECRET=secretref:trusted-proxy-secret")
if (-not $fexists -or $StripePublishableKey) { $frontendEnv += "STRIPE_PUBLISHABLE_KEY=$StripePublishableKey" }
if (-not $fexists -or $SentryDsn) { $frontendEnv += "SENTRY_DSN=$SentryDsn" }
Invoke-Checked {
    az containerapp update --name $frontendApp --resource-group $rg --image $frontendImage `
        --set-env-vars @frontendEnv --output none
} "deploy frontend image and settings"

$frontendFqdn = if ($DryRun) { "<frontend fqdn>" } else { az containerapp show --name $frontendApp --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv }
$frontendUrl = "https://$frontendFqdn"

# --- 4b. the public storefront and the hold sweeper ---------------------------------------

$storefrontUrl = ""
if ($storefrontEnabled) {
    Write-Step "Storefront"
    $storefrontImage = "$acrLoginServer/storefront:$ImageTag"
    $sexists = $false
    if (-not $DryRun) { az containerapp show --name $storefrontApp --resource-group $rg --output none 2>$null; $sexists = ($LASTEXITCODE -eq 0) }
    if (-not $sexists) {
        Invoke-Checked {
            az containerapp create --name $storefrontApp --resource-group $rg --environment $containerAppsEnvId `
                --image "mcr.microsoft.com/k8se/quickstart:latest" --target-port 3000 --ingress external `
                --min-replicas $storefrontMinReplicas --max-replicas 2 --cpu 0.25 --memory 0.5Gi --system-assigned --output none
        } "create storefront container app"
    }
    if (-not $DryRun) { Grant-AcrPull $storefrontApp }

    # Its own address is part of its settings, so it is read first and the
    # settings are applied together with the real image.
    $storefrontFqdn = if ($DryRun) { "<storefront fqdn>" } else { az containerapp show --name $storefrontApp --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv }
    $storefrontUrl = "https://$storefrontFqdn"

    $storefrontEnv = @("API_URL=$apiUrl", "STOREFRONT_URL=$storefrontUrl")
    if (-not $sexists -or $StripePublishableKey) { $storefrontEnv += "STRIPE_PUBLISHABLE_KEY=$StripePublishableKey" }
    if (-not $sexists -or $TurnstileSiteKey) { $storefrontEnv += "TURNSTILE_SITE_KEY=$TurnstileSiteKey" }
    if (-not $sexists -or $SentryDsn) { $storefrontEnv += "SENTRY_DSN=$SentryDsn" }
    Invoke-Checked {
        az containerapp update --name $storefrontApp --resource-group $rg --image $storefrontImage `
            --min-replicas $storefrontMinReplicas --set-env-vars @storefrontEnv --output none
    } "deploy storefront image and settings"

    Write-Step "Hold sweeper"
    # A scheduled job on the backend image that expires unpaid holds every five
    # minutes. It bypasses the image entrypoint (no migrations, no server) by
    # giving its own command.
    $jobExists = $false
    if (-not $DryRun) { az containerapp job show --name $sweeperJob --resource-group $rg --output none 2>$null; $jobExists = ($LASTEXITCODE -eq 0) }
    if (-not $jobExists) {
        Invoke-Checked {
            az containerapp job create --name $sweeperJob --resource-group $rg --environment $containerAppsEnvId `
                --trigger-type Schedule --cron-expression "*/5 * * * *" --replica-timeout 300 --replica-retry-limit 0 `
                --replica-completion-count 1 --parallelism 1 --image "mcr.microsoft.com/k8se/quickstart-jobs:latest" `
                --cpu 0.25 --memory 0.5Gi --mi-system-assigned --output none
        } "create sweeper job"
    }
    if (-not $DryRun) {
        $jobPrincipal = az containerapp job show --name $sweeperJob --resource-group $rg --query identity.principalId -o tsv
        az role assignment create --assignee $jobPrincipal --role AcrPull --scope $acrId --output none 2>$null
        az containerapp job registry set --name $sweeperJob --resource-group $rg --server $acrLoginServer --identity system --output none
        if ($LASTEXITCODE -ne 0) { throw "FAILED: set sweeper registry identity" }
    }

    # The job sees the same database and payment settings as the backend. The
    # Stripe key of an existing stack is read back from the backend when it was
    # not given again.
    $sweeperStripeKey = $StripeSecretKey
    if (-not $sweeperStripeKey -and -not $DryRun -and ($existingSecrets -contains "stripe-secret-key")) {
        $sweeperStripeKey = (az containerapp secret show --name $backendApp --resource-group $rg --secret-name stripe-secret-key --query value -o tsv)
    }
    $jobSecrets = @("database-url=$databaseUrl", "secret-key=$secretKey")
    $jobEnv = @("DATABASE_URL=secretref:database-url", "SECRET_KEY=secretref:secret-key", "ENVIRONMENT=production")
    if ($sweeperStripeKey) {
        $jobSecrets += "stripe-secret-key=$sweeperStripeKey"
        $jobEnv += "STRIPE_SECRET_KEY=secretref:stripe-secret-key"
    }
    Invoke-Checked { az containerapp job secret set --name $sweeperJob --resource-group $rg --secrets @jobSecrets --output none } "set sweeper secrets"
    if (-not $DryRun) { Set-SweeperCommand -JobName $sweeperJob -Image $backendImage -EnvVars $jobEnv } else { Write-Host "[dry-run] set sweeper image, command and env" -ForegroundColor DarkGray }
}

# The backend answers the staff app and, when there is one, the storefront.
$corsOrigins = if ($storefrontUrl) { "$frontendUrl,$storefrontUrl" } else { $frontendUrl }
# STOREFRONT_URL is what links in emails (view or manage a booking, the privacy page)
# point to; without a storefront the emails simply have no such links.
$backendUrlSettings = @("CORS_ORIGINS=$corsOrigins")
if ($storefrontUrl) { $backendUrlSettings += "STOREFRONT_URL=$storefrontUrl" }
Invoke-Checked {
    az containerapp update --name $backendApp --resource-group $rg --set-env-vars @backendUrlSettings --output none
} "point the backend CORS and email links at the frontends"

# --- 5. Stripe webhook ---------------------------------------------------------------

Write-Step "Stripe webhook"
if ($manifest.legacySecrets) {
    Write-Host "This stack's webhook was registered by hand before manifests existed; left as it is."
} elseif (-not $StripeSecretKey) {
    Write-Host "No Stripe key given: card payment stays off. Re-run with -StripeSecretKey and -StripePublishableKey." -ForegroundColor Yellow
} elseif ($webhookSecret) {
    Write-Host "Webhook already registered for this stack."
} elseif ($DryRun) {
    Write-Host "[dry-run] create the Stripe webhook endpoint at $apiUrl/api/stripe/webhook" -ForegroundColor DarkGray
} else {
    $auth = @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${StripeSecretKey}:")) }
    $body = "url=$([uri]::EscapeDataString("$apiUrl/api/stripe/webhook"))" +
        "&description=car-rental-$Stack" +
        "&enabled_events[]=payment_intent.succeeded&enabled_events[]=payment_intent.processing" +
        "&enabled_events[]=payment_intent.payment_failed&enabled_events[]=payment_intent.canceled" +
        "&enabled_events[]=payment_intent.amount_capturable_updated"
    $endpoint = Invoke-RestMethod -Method Post -Uri "https://api.stripe.com/v1/webhook_endpoints" -Headers $auth -Body $body `
        -ContentType "application/x-www-form-urlencoded"
    # Stripe shows the signing secret only when the endpoint is created.
    $webhookSecret = $endpoint.secret
    Set-Content -Path "$stateDir\webhooksecret" -Value $webhookSecret -NoNewline
    az containerapp secret set --name $backendApp --resource-group $rg --secrets "stripe-webhook-secret=$webhookSecret" --output none
    Write-Host "Registered $($endpoint.url)"
}

# --- 6. GitHub Environment, OIDC login and roles ----------------------------------------

Write-Step "GitHub Environment $envName"
$repo = if ($DryRun) { "<owner/repo>" } else { (gh repo view --json nameWithOwner --jq .nameWithOwner).Trim() }
$subscriptionId = if ($DryRun) { "<subscription>" } else { az account show --query id -o tsv }
$tenantId = if ($DryRun) { "<tenant>" } else { az account show --query tenantId -o tsv }

Invoke-Checked { gh api -X PUT "repos/$repo/environments/$envName" --silent } "create GitHub environment $envName"

$vars = @{
    RESOURCE_GROUP = $rg; ACR_NAME = $acrName; ACR_LOGIN_SERVER = $acrLoginServer
    POSTGRES_HOST = $postgresFqdn; POSTGRES_DB_NAME = $postgresDb; POSTGRES_ADMIN_USER = "carrentaladmin"
    BACKUP_STORAGE_ACCOUNT = $backupAccount; BACKUP_CONTAINER_NAME = "pg-backups"
    API_URL = $apiUrl; FRONTEND_URL = $frontendUrl; STRIPE_PUBLISHABLE_KEY = $StripePublishableKey
    STOREFRONT_URL = $storefrontUrl; TURNSTILE_SITE_KEY = $TurnstileSiteKey
    SENTRY_DSN = $SentryDsn; BUSINESS_NAME = [string]$manifest.business.name
    # Only a stack sharing another one's environment needs this — the release
    # pipeline's deploy-stack action otherwise assumes the plain "car-rental-"
    # names every other stack uses.
    APP_PREFIX = if ($sharedEnvironmentStack) { $appPrefix } else { "" }
}
foreach ($name in $vars.Keys) {
    # GitHub refuses an empty value; a variable that is not set reads as empty anyway.
    if (-not "$($vars[$name])") { continue }
    Invoke-Checked { gh variable set $name --env $envName --body "$($vars[$name])" } "set variable $name"
}
$envSecrets = @{
    AZURE_CLIENT_ID = $shared.ciAppId; AZURE_TENANT_ID = $tenantId; AZURE_SUBSCRIPTION_ID = $subscriptionId
    POSTGRES_ADMIN_PASSWORD = $pgPassword
}
foreach ($name in $envSecrets.Keys) {
    Invoke-Checked { gh secret set $name --env $envName --body "$($envSecrets[$name])" } "set secret $name"
}

# The pipeline logs in to Azure as the CI app; a job that runs in an
# environment presents an environment subject, so each stack needs its own
# federated credential (in both of GitHub's subject forms).
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
} else {
    Write-Host "[dry-run] create federated credentials for environment $envName" -ForegroundColor DarkGray
}

# Only what CI needs, on this stack: update its apps, push to the shared
# registry, and write to its backup storage. (Firewall rules for the backup job
# come from the role main.bicep assigns.) A Container App and a Container Apps
# *job* are different resource types with separate built-in roles — "Container
# Apps Contributor" alone cannot see the sweeper job at all (az reports it as
# "does not exist" rather than a permission error), which is why deploy-stack
# needs the Jobs role too, on any stack that has a storefront.
if (-not $DryRun) {
    $rgId = az group show --name $rg --query id -o tsv
    $storageId = az storage account show --name $backupAccount --resource-group $rg --query id -o tsv
    $roles = @(
        @{ Role = "Container Apps Contributor"; Scope = $rgId },
        @{ Role = "AcrPush"; Scope = $acrId },
        @{ Role = "Storage Blob Data Contributor"; Scope = $storageId }
    )
    if ($storefrontEnabled) { $roles += @{ Role = "Container Apps Jobs Contributor"; Scope = $rgId } }
    foreach ($assignment in $roles) {
        az role assignment create --assignee-object-id $ciSpObjectId --assignee-principal-type ServicePrincipal `
            --role $assignment.Role --scope $assignment.Scope --output none 2>$null
    }
}

# --- 7. least-privilege database role ------------------------------------------------------

Write-Step "Database role"
if (-not $DryRun -and ($isNew -or $UseAppRole) -and -not $appRoleDone) {
    az containerapp exec --name $backendApp --resource-group $rg --command "python create_app_role.py $appPassword"
    if ($LASTEXITCODE -eq 0) {
        Set-Content -Path "$stateDir\approle" -Value "done" -NoNewline
        az containerapp secret set --name $backendApp --resource-group $rg `
            --secrets "database-url=postgresql+psycopg://carrental_app:${appPassword}@${postgresFqdn}:5432/${postgresDb}?sslmode=require" --output none
    } else {
        Write-Host "Could not create the app role automatically. Run once by hand, then re-run with -UseAppRole:" -ForegroundColor Yellow
        Write-Host "  az containerapp exec --name $backendApp --resource-group $rg --command `"python create_app_role.py $appPassword`""
    }
} elseif ($DryRun) {
    Write-Host "[dry-run] create the DML-only database role and switch the app to it" -ForegroundColor DarkGray
} elseif ($isNew -or $UseAppRole) {
    Write-Host "Already using the DML-only role."
} else {
    Write-Host "Existing stack: its database login is left as it is (pass -UseAppRole to switch it)."
}

# --- 8. smoke test, then remove the one-time admin password ------------------------------------

Write-Step "Smoke test"
$expectedName = [string]$manifest.business.name
if ($DryRun) {
    Write-Host "[dry-run] bash deploy/smoke-test.sh $apiUrl $frontendUrl '$expectedName' $storefrontUrl" -ForegroundColor DarkGray
} else {
    # Git's bash, not the bash.exe Windows ships (which starts WSL).
    $gitBash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $gitBash) { throw "Git Bash was not found. Install Git for Windows to run the smoke test." }
    # PowerShell's call operator silently drops an empty-string argument to a
    # native command instead of passing it through, which shifts every
    # argument after it one place to the left — smoke-test.sh would read the
    # storefront's address as the expected business name. A stack with no
    # business name set (like the operator's own) hits this on every run, so
    # a placeholder stands in for "no value" and smoke-test.sh turns it back
    # into empty.
    $expectedNameArg = if ($expectedName) { $expectedName } else { "-" }
    $storefrontUrlArg = if ($storefrontUrl) { $storefrontUrl } else { "-" }
    & $gitBash "$PSScriptRoot/smoke-test.sh" $apiUrl $frontendUrl $expectedNameArg $storefrontUrlArg
    if ($LASTEXITCODE -ne 0) { throw "FAILED: smoke test" }
}

if ($firstAdmin -and -not $DryRun) {
    # The password only had to reach the first start. Take it out of the app.
    az containerapp update --name $backendApp --resource-group $rg `
        --remove-env-vars INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD STACK_BUSINESS_B64 --output none
    az containerapp secret remove --name $backendApp --resource-group $rg --secret-names initial-admin-password --output none
}

if (-not $DryRun) {
    @{ slug = $Stack; resourceGroup = $rg; backendUrl = $apiUrl; frontendUrl = $frontendUrl; storefrontUrl = $storefrontUrl; postgresHost = $postgresFqdn } |
        ConvertTo-Json | Set-Content "$stateDir\outputs.json"
}

Write-Host ""
Write-Host "== Done: $Stack ==" -ForegroundColor Green
Write-Host "Frontend: $frontendUrl"
Write-Host "Backend:  $apiUrl"
if ($storefrontUrl) { Write-Host "Storefront: $storefrontUrl" }
if ($firstAdmin) {
    Write-Host ""
    Write-Host "First administrator (shown once, kept in deploy/.stacks/$Stack/adminpassword):" -ForegroundColor Yellow
    Write-Host "  $AdminEmail"
    Write-Host "  $adminPassword"
}
if (-not $StripeSecretKey) {
    Write-Host ""
    Write-Host "Card payment is off until the customer's Stripe keys are given (-StripeSecretKey, -StripePublishableKey)." -ForegroundColor Yellow
}
