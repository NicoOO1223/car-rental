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
#      subscriptions) and creates/updates the two Container Apps.
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

if (-not $DryRun) {
    $deployJson = az deployment group create --resource-group $rg --template-file "$PSScriptRoot\main.bicep" `
        --parameters uniqueSuffix=$suffix postgresAdminPassword=$pgPassword backupPrincipalObjectId=$ciSpObjectId location=$region `
        --query properties.outputs --output json
    if ($LASTEXITCODE -ne 0) { throw "FAILED: stack infrastructure deployment" }
    $infra = $deployJson | ConvertFrom-Json
    $containerAppsEnvId = $infra.containerAppsEnvId.value
    $postgresFqdn = $infra.postgresServerFqdn.value
    $postgresDb = $infra.postgresDbName.value
    $backupAccount = $infra.backupStorageAccountName.value
} else {
    Write-Host "[dry-run] deploy main.bicep" -ForegroundColor DarkGray
    $containerAppsEnvId = "<env id>"; $postgresFqdn = "<postgres>"; $postgresDb = "car_rental"; $backupAccount = "<backup account>"
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

# --- 3. the backend ------------------------------------------------------------------

function Set-BackendProbes {
    # The az containerapp create/update flags cannot set health probes, so
    # this reads the app, adds them and applies the result as YAML.
    #  - Startup: gives migrations plus boot up to 150s before liveness starts.
    #  - Liveness: /health restarts a hung process, without touching the database.
    #  - Readiness: /ready keeps a revision that cannot reach the database out of traffic.
    $app = az containerapp show --name car-rental-backend --resource-group $rg --output json | ConvertFrom-Json
    $container = $app.properties.template.containers[0]
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
    az containerapp update --name car-rental-backend --resource-group $rg --yaml $yamlPath --output none
    if ($LASTEXITCODE -ne 0) { throw "FAILED: set backend probes" }
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
if (-not $DryRun) { az containerapp show --name car-rental-backend --resource-group $rg --output none 2>$null; $exists = ($LASTEXITCODE -eq 0) }

if (-not $exists) {
    # The image cannot be pulled until the app's identity has AcrPull, so the
    # app is created from a public placeholder and switched to the real image
    # once the role and registry are wired up.
    Invoke-Checked {
        az containerapp create --name car-rental-backend --resource-group $rg --environment $containerAppsEnvId `
            --image "mcr.microsoft.com/k8se/quickstart:latest" --target-port 8000 --ingress external `
            --min-replicas $minReplicas --max-replicas 1 --cpu 0.25 --memory 0.5Gi --system-assigned --output none
    } "create backend container app"
}
if (-not $DryRun) { Grant-AcrPull "car-rental-backend" }

$firstAdmin = [bool]$AdminEmail
$isNew = -not $exists

# On an existing stack a value that was not given is left as it is, so
# re-running never wipes a key that was set earlier. A new app needs every
# secret to exist (empty is fine) before its settings can refer to them.
# The database login of an existing stack is only changed on request
# (-UseAppRole): it may already be on the DML-only role.
$secretArgs = @("migration-database-url=$migrationDatabaseUrl", "secret-key=$secretKey")
if ($isNew -or $UseAppRole) { $secretArgs += "database-url=$databaseUrl" }
$existingSecrets = @()
if ($exists -and -not $DryRun) { $existingSecrets = @(az containerapp secret list --name car-rental-backend --resource-group $rg --query "[].name" -o tsv) }

# Container Apps refuses an empty secret, so an optional secret with no value
# simply does not exist, and the setting that would refer to it is left out.
# An existing one is kept as it is unless a new value is given.
$optionalSecrets = @(
    @{ Name = "stripe-secret-key";     Value = $StripeSecretKey; Env = "STRIPE_SECRET_KEY" },
    @{ Name = "stripe-webhook-secret"; Value = $webhookSecret;   Env = "STRIPE_WEBHOOK_SECRET" },
    @{ Name = "sentry-dsn";            Value = $SentryDsn;       Env = "SENTRY_DSN" }
)
$optionalEnv = @()
foreach ($secret in $optionalSecrets) {
    if ($secret.Value) { $secretArgs += "$($secret.Name)=$($secret.Value)" }
    if ($secret.Value -or ($existingSecrets -contains $secret.Name)) { $optionalEnv += "$($secret.Env)=secretref:$($secret.Name)" }
}
if ($firstAdmin) { $secretArgs += "initial-admin-password=$adminPassword" }
Invoke-Checked { az containerapp secret set --name car-rental-backend --resource-group $rg --secrets @secretArgs --output none } "set backend secrets"

$businessB64 = ""
if ($manifest.business) {
    $businessB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(($manifest.business | ConvertTo-Json -Compress)))
}

$backendEnv = @(
    "DATABASE_URL=secretref:database-url", "MIGRATION_DATABASE_URL=secretref:migration-database-url",
    "SECRET_KEY=secretref:secret-key", "ENVIRONMENT=production"
)
$backendEnv += $optionalEnv
if ($firstAdmin) {
    $backendEnv += @("INITIAL_ADMIN_EMAIL=$AdminEmail", "INITIAL_ADMIN_PASSWORD=secretref:initial-admin-password", "STACK_BUSINESS_B64=$businessB64")
}
# A new stack's CORS is pointed at the real frontend below; until it exists
# nothing is allowed. An existing stack keeps serving with what it has.
$corsPending = if ($isNew) { @("CORS_ORIGINS=https://pending.invalid") } else { @() }
Invoke-Checked {
    az containerapp update --name car-rental-backend --resource-group $rg --image $backendImage `
        --min-replicas $minReplicas --set-env-vars @backendEnv @corsPending --output none
} "deploy backend image and settings"
if (-not $DryRun) { Set-BackendProbes }

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

$backendFqdn = if ($DryRun) { "<backend fqdn>" } else { az containerapp show --name car-rental-backend --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv }
$apiUrl = "https://$backendFqdn"

# --- 4. the frontend -----------------------------------------------------------------

Write-Step "Frontend"
$frontendImage = "$acrLoginServer/frontend:$ImageTag"
$fexists = $false
if (-not $DryRun) { az containerapp show --name car-rental-frontend --resource-group $rg --output none 2>$null; $fexists = ($LASTEXITCODE -eq 0) }
if (-not $fexists) {
    Invoke-Checked {
        az containerapp create --name car-rental-frontend --resource-group $rg --environment $containerAppsEnvId `
            --image "mcr.microsoft.com/k8se/quickstart:latest" --target-port 3000 --ingress external `
            --min-replicas 0 --max-replicas 1 --cpu 0.25 --memory 0.5Gi --system-assigned --output none
    } "create frontend container app"
}
if (-not $DryRun) { Grant-AcrPull "car-rental-frontend" }

# The frontend reads these when it runs, so the same image serves every stack.
# The environment variables are given a value even when empty on a new app,
# so the setting exists; on an existing one an empty value is left alone.
$frontendEnv = @("API_URL=$apiUrl")
if (-not $fexists -or $StripePublishableKey) { $frontendEnv += "STRIPE_PUBLISHABLE_KEY=$StripePublishableKey" }
if (-not $fexists -or $SentryDsn) { $frontendEnv += "SENTRY_DSN=$SentryDsn" }
Invoke-Checked {
    az containerapp update --name car-rental-frontend --resource-group $rg --image $frontendImage `
        --set-env-vars @frontendEnv --output none
} "deploy frontend image and settings"

$frontendFqdn = if ($DryRun) { "<frontend fqdn>" } else { az containerapp show --name car-rental-frontend --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv }
$frontendUrl = "https://$frontendFqdn"

Invoke-Checked {
    az containerapp update --name car-rental-backend --resource-group $rg --set-env-vars "CORS_ORIGINS=$frontendUrl" --output none
} "point the backend's CORS at the frontend"

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
    az containerapp secret set --name car-rental-backend --resource-group $rg --secrets "stripe-webhook-secret=$webhookSecret" --output none
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
    SENTRY_DSN = $SentryDsn; BUSINESS_NAME = [string]$manifest.business.name
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
# come from the role main.bicep assigns.)
if (-not $DryRun) {
    $rgId = az group show --name $rg --query id -o tsv
    $storageId = az storage account show --name $backupAccount --resource-group $rg --query id -o tsv
    foreach ($assignment in @(
            @{ Role = "Container Apps Contributor"; Scope = $rgId },
            @{ Role = "AcrPush"; Scope = $acrId },
            @{ Role = "Storage Blob Data Contributor"; Scope = $storageId })) {
        az role assignment create --assignee-object-id $ciSpObjectId --assignee-principal-type ServicePrincipal `
            --role $assignment.Role --scope $assignment.Scope --output none 2>$null
    }
}

# --- 7. least-privilege database role ------------------------------------------------------

Write-Step "Database role"
if (-not $DryRun -and ($isNew -or $UseAppRole) -and -not $appRoleDone) {
    az containerapp exec --name car-rental-backend --resource-group $rg --command "python create_app_role.py $appPassword"
    if ($LASTEXITCODE -eq 0) {
        Set-Content -Path "$stateDir\approle" -Value "done" -NoNewline
        az containerapp secret set --name car-rental-backend --resource-group $rg `
            --secrets "database-url=postgresql+psycopg://carrental_app:${appPassword}@${postgresFqdn}:5432/${postgresDb}?sslmode=require" --output none
    } else {
        Write-Host "Could not create the app role automatically. Run once by hand, then re-run with -UseAppRole:" -ForegroundColor Yellow
        Write-Host "  az containerapp exec --name car-rental-backend --resource-group $rg --command `"python create_app_role.py $appPassword`""
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
    Write-Host "[dry-run] bash deploy/smoke-test.sh $apiUrl $frontendUrl '$expectedName'" -ForegroundColor DarkGray
} else {
    # Git's bash, not the bash.exe Windows ships (which starts WSL).
    $gitBash = @("$env:ProgramFiles\Git\bin\bash.exe", "${env:ProgramFiles(x86)}\Git\bin\bash.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $gitBash) { throw "Git Bash was not found. Install Git for Windows to run the smoke test." }
    & $gitBash "$PSScriptRoot/smoke-test.sh" $apiUrl $frontendUrl $expectedName
    if ($LASTEXITCODE -ne 0) { throw "FAILED: smoke test" }
}

if ($firstAdmin -and -not $DryRun) {
    # The password only had to reach the first start. Take it out of the app.
    az containerapp update --name car-rental-backend --resource-group $rg `
        --remove-env-vars INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD STACK_BUSINESS_B64 --output none
    az containerapp secret remove --name car-rental-backend --resource-group $rg --secret-names initial-admin-password --output none
}

if (-not $DryRun) {
    @{ slug = $Stack; resourceGroup = $rg; backendUrl = $apiUrl; frontendUrl = $frontendUrl; postgresHost = $postgresFqdn } |
        ConvertTo-Json | Set-Content "$stateDir\outputs.json"
}

Write-Host ""
Write-Host "== Done: $Stack ==" -ForegroundColor Green
Write-Host "Frontend: $frontendUrl"
Write-Host "Backend:  $apiUrl"
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
