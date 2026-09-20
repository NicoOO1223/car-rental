# One-time bootstrap for the car-rental prototype on Azure Container Apps.
# Re-running this script is safe (each step is idempotent / update-in-place)
# except that it will NOT regenerate a new random resource-name suffix or
# Postgres password once deploy/.suffix and deploy/.pgpassword exist.
#
# Prerequisites: az CLI logged in (az login), containerapp extension
# installed, docker logged in / running, this script run from the repo's
# deploy/ folder or with $repoRoot pointed at the repo root.

function Invoke-Checked {
    # Runs a native command and stops the script on a non-zero exit code.
    # Needed because $ErrorActionPreference doesn't apply to native exe
    # exit codes, only to PowerShell's own error stream.
    param([ScriptBlock]$Command, [string]$Description)
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "FAILED: $Description (exit code $LASTEXITCODE)"
    }
}

$repoRoot = Resolve-Path "$PSScriptRoot\.."
$rg = "car-rental-rg"
$location = "swedencentral"

# --- one-time random values, cached locally so re-runs are idempotent ---
$suffixFile = "$PSScriptRoot\.suffix"
if (Test-Path $suffixFile) {
    $suffix = Get-Content $suffixFile -Raw
} else {
    $suffix = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
    Set-Content -Path $suffixFile -Value $suffix -NoNewline
}

$pgPasswordFile = "$PSScriptRoot\.pgpassword"
if (Test-Path $pgPasswordFile) {
    $pgPassword = Get-Content $pgPasswordFile -Raw
} else {
    $pgPassword = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    Set-Content -Path $pgPasswordFile -Value $pgPassword -NoNewline
}

# --- pull secrets already sitting in local dev env files ---
function Get-EnvValue($path, $key) {
    if (-not (Test-Path $path)) { return "" }
    $line = Get-Content $path | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
    if (-not $line) { return "" }
    return ($line -split "=", 2)[1].Trim()
}

$stripeSecretKey = Get-EnvValue "$repoRoot\backend\.env" "STRIPE_SECRET_KEY"
$stripePublishableKey = Get-EnvValue "$repoRoot\frontend\.env.local" "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
$backendSentryDsn = Get-EnvValue "$repoRoot\backend\.env" "SENTRY_DSN"
$frontendSentryDsn = Get-EnvValue "$repoRoot\frontend\.env.local" "NEXT_PUBLIC_SENTRY_DSN"

Write-Host "== Resource group ==" -ForegroundColor Cyan
Invoke-Checked { az group create --name $rg --location $location --output none } "create resource group"

Write-Host "== Deploying static infrastructure (ACR, Log Analytics, Container Apps env, Postgres) ==" -ForegroundColor Cyan
$deployJson = az deployment group create `
    --resource-group $rg `
    --template-file "$PSScriptRoot\main.bicep" `
    --parameters uniqueSuffix=$suffix postgresAdminPassword=$pgPassword `
    --query properties.outputs `
    --output json
if ($LASTEXITCODE -ne 0) { throw "FAILED: bicep deployment" }
$deployOutput = $deployJson | ConvertFrom-Json

$acrName = $deployOutput.acrName.value
$acrLoginServer = $deployOutput.acrLoginServer.value
$containerAppsEnvId = $deployOutput.containerAppsEnvId.value
$postgresFqdn = $deployOutput.postgresServerFqdn.value
$postgresDbName = $deployOutput.postgresDbName.value
$backupStorageAccountName = $deployOutput.backupStorageAccountName.value

$databaseUrl = "postgresql+psycopg://carrentaladmin:${pgPassword}@${postgresFqdn}:5432/${postgresDbName}?sslmode=require"

Write-Host "ACR: $acrLoginServer"
Write-Host "Postgres: $postgresFqdn"
Write-Host "Backup storage account: $backupStorageAccountName"

Write-Host "== Logging in to ACR (for local docker build/push) ==" -ForegroundColor Cyan
# ACR Tasks (az acr build's remote build) requires a support request on
# brand-new trial subscriptions, so images are built locally with Docker
# and pushed directly instead — no ACR Tasks involved.
Invoke-Checked { az acr login --name $acrName } "az acr login"

Write-Host "== Building backend image locally and pushing to ACR ==" -ForegroundColor Cyan
Invoke-Checked { docker build -t "$acrLoginServer/backend:latest" -f "$repoRoot\backend\Dockerfile" "$repoRoot\backend" } "docker build backend"
Invoke-Checked { docker push "$acrLoginServer/backend:latest" } "docker push backend"

Write-Host "== Creating/updating backend Container App ==" -ForegroundColor Cyan
az containerapp show --name car-rental-backend --resource-group $rg --output none 2>$null
$backendExisted = ($LASTEXITCODE -eq 0)

if (-not $backendExisted) {
    # --registry-identity system makes the CLI create the system-assigned
    # identity, grant it AcrPull on the registry, and wire up the registry
    # config all before attempting to pull the image for the first
    # revision — passing --image alone with --system-assigned tries to
    # pull before any identity/role exists and fails.
    Invoke-Checked {
        az containerapp create `
            --name car-rental-backend `
            --resource-group $rg `
            --environment $containerAppsEnvId `
            --image "$acrLoginServer/backend:latest" `
            --target-port 8000 `
            --ingress external `
            --min-replicas 0 --max-replicas 1 `
            --cpu 0.25 --memory 0.5Gi `
            --system-assigned `
            --registry-server $acrLoginServer `
            --registry-identity system `
            --output none
    } "create backend container app"
} else {
    Invoke-Checked { az containerapp update --name car-rental-backend --resource-group $rg --image "$acrLoginServer/backend:latest" --output none } "update backend image"
}

# Idempotent safety net in case the create-time role assignment above
# didn't take (e.g. on a re-run against an already-existing app).
$backendPrincipalId = az containerapp show --name car-rental-backend --resource-group $rg --query identity.principalId -o tsv
$acrId = az acr show --name $acrName --query id -o tsv
az role assignment create --assignee $backendPrincipalId --role AcrPull --scope $acrId --output none 2>$null
Invoke-Checked { az containerapp registry set --name car-rental-backend --resource-group $rg --server $acrLoginServer --identity system --output none } "set backend registry identity"

Invoke-Checked {
    az containerapp secret set --name car-rental-backend --resource-group $rg `
        --secrets database-url="$databaseUrl" stripe-secret-key="$stripeSecretKey" sentry-dsn="$backendSentryDsn" --output none
} "set backend secrets"

Invoke-Checked {
    az containerapp update --name car-rental-backend --resource-group $rg `
        --set-env-vars DATABASE_URL=secretref:database-url STRIPE_SECRET_KEY=secretref:stripe-secret-key SENTRY_DSN=secretref:sentry-dsn CORS_ORIGINS="http://localhost:3000" `
        --output none
} "set backend env vars"

$backendFqdn = az containerapp show --name car-rental-backend --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv
Write-Host "Backend URL: https://$backendFqdn"

Write-Host "== Building frontend image locally (baking in the backend URL) and pushing to ACR ==" -ForegroundColor Cyan
Invoke-Checked {
    docker build -t "$acrLoginServer/frontend:latest" -f "$repoRoot\frontend\Dockerfile" `
        --build-arg NEXT_PUBLIC_API_URL="https://$backendFqdn" `
        --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="$stripePublishableKey" `
        --build-arg NEXT_PUBLIC_SENTRY_DSN="$frontendSentryDsn" `
        "$repoRoot\frontend"
} "docker build frontend"
Invoke-Checked { docker push "$acrLoginServer/frontend:latest" } "docker push frontend"

Write-Host "== Creating/updating frontend Container App ==" -ForegroundColor Cyan
az containerapp show --name car-rental-frontend --resource-group $rg --output none 2>$null
$frontendExisted = ($LASTEXITCODE -eq 0)

if (-not $frontendExisted) {
    Invoke-Checked {
        az containerapp create `
            --name car-rental-frontend `
            --resource-group $rg `
            --environment $containerAppsEnvId `
            --image "$acrLoginServer/frontend:latest" `
            --target-port 3000 `
            --ingress external `
            --min-replicas 0 --max-replicas 1 `
            --cpu 0.25 --memory 0.5Gi `
            --system-assigned `
            --registry-server $acrLoginServer `
            --registry-identity system `
            --output none
    } "create frontend container app"
} else {
    Invoke-Checked { az containerapp update --name car-rental-frontend --resource-group $rg --image "$acrLoginServer/frontend:latest" --output none } "update frontend image"
}

$frontendPrincipalId = az containerapp show --name car-rental-frontend --resource-group $rg --query identity.principalId -o tsv
az role assignment create --assignee $frontendPrincipalId --role AcrPull --scope $acrId --output none 2>$null
Invoke-Checked { az containerapp registry set --name car-rental-frontend --resource-group $rg --server $acrLoginServer --identity system --output none } "set frontend registry identity"

$frontendFqdn = az containerapp show --name car-rental-frontend --resource-group $rg --query properties.configuration.ingress.fqdn -o tsv
Write-Host "Frontend URL: https://$frontendFqdn"

Write-Host "== Pointing backend's CORS at the real frontend URL ==" -ForegroundColor Cyan
Invoke-Checked {
    az containerapp update --name car-rental-backend --resource-group $rg `
        --set-env-vars DATABASE_URL=secretref:database-url STRIPE_SECRET_KEY=secretref:stripe-secret-key SENTRY_DSN=secretref:sentry-dsn CORS_ORIGINS="https://$frontendFqdn" `
        --output none
} "update backend CORS"

Write-Host ""
Write-Host "== Done ==" -ForegroundColor Green
Write-Host "Frontend: https://$frontendFqdn"
Write-Host "Backend:  https://$backendFqdn"
Write-Host ""
Write-Host "Next: wake the backend and seed demo data with:"
Write-Host "  curl https://$backendFqdn/health"
Write-Host "  az containerapp exec --name car-rental-backend --resource-group $rg --command `"python seed.py`""
Write-Host ""
Write-Host "One-time manual step for scheduled DB backups (bicep can't grant" -ForegroundColor Yellow
Write-Host "this since the GitHub OIDC service principal isn't bicep-managed)." -ForegroundColor Yellow
Write-Host "Lets db-backup.yml write blobs with 'az storage blob upload --auth-mode login'" -ForegroundColor Yellow
Write-Host "instead of a long-lived storage account key:" -ForegroundColor Yellow
Write-Host "  az role assignment create --assignee <AZURE_CLIENT_ID's objectId> \`""
Write-Host "    --role `"Storage Blob Data Contributor`" --scope <backup storage account resource ID>"
Write-Host "See deploy/BACKUP_RESTORE.md for the full setup checklist."

# Save non-secret outputs for the GitHub Actions workflow to reference.
@{
    resourceGroup = $rg
    acrName = $acrName
    acrLoginServer = $acrLoginServer
    backendFqdn = $backendFqdn
    frontendFqdn = $frontendFqdn
    postgresServerFqdn = $postgresFqdn
    postgresDbName = $postgresDbName
    backupStorageAccountName = $backupStorageAccountName
} | ConvertTo-Json | Set-Content "$PSScriptRoot\outputs.json"
