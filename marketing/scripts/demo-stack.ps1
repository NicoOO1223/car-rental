<#
.SYNOPSIS
  An isolated, throwaway stack with the fictional demo business, for the
  marketing screenshots. It never touches the dev stack (8000 / 3000 / 3002).

.DESCRIPTION
  Own database      car_rental_marketing_demo, on the Postgres container that docker compose runs
  Backend           http://localhost:8010
  Staff panel       http://localhost:3010
  Booking site      http://localhost:3012

  The panel and booking site are built from COPIES of frontend/ and storefront/ in
  marketing/.demo-stack/, because two `next` servers cannot share one .next folder
  with the dev servers. Errors and email are switched off (no Sentry, no Stripe, no
  email provider), so nothing here can report or send anything.

.EXAMPLE
  .\marketing\scripts\demo-stack.ps1 up          # create, seed, build, start
  .\marketing\scripts\demo-stack.ps1 reseed      # drop the demo database and seed it again
  .\marketing\scripts\demo-stack.ps1 status
  .\marketing\scripts\demo-stack.ps1 down        # stop the servers (keeps the database)
  .\marketing\scripts\demo-stack.ps1 destroy     # stop and drop the database and the copies
#>
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet("up", "down", "reseed", "status", "destroy")]
    [string]$Action,
    [switch]$Rebuild
)

# Native tools (npm, alembic) write progress and warnings to stderr; that is not a failure.
# Every native call below checks its exit code explicitly and throws.
$ErrorActionPreference = "Continue"

$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$work = Join-Path $repo "marketing\.demo-stack"
$backend = Join-Path $repo "backend"
$python = Join-Path $backend ".venv\Scripts\python.exe"
$db = "car_rental_marketing_demo"
$ports = @{ backend = 8010; panel = 3010; storefront = 3012 }
$pidDir = Join-Path $work "pids"

# Refuse to ever be pointed at the dev ports.
foreach ($p in 8000, 3000, 3001, 3002) {
    if ($ports.Values -contains $p) { throw "Port $p belongs to the dev stack." }
}

function Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

function Invoke-Psql($sql) {
    docker exec car-rental-postgres psql -U car_rental -d postgres -qtc $sql
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $sql" }
}

function Set-DemoEnvironment {
    # Process-level only; nothing is written to .env files.
    $env:DATABASE_URL = "postgresql+psycopg://car_rental:car_rental_dev@localhost:5432/$db"
    $env:SECRET_KEY = "demo-only-secret-not-used-anywhere-else"
    $env:ENVIRONMENT = "development"
    $env:SENTRY_DSN = ""
    $env:STRIPE_SECRET_KEY = ""
    $env:STRIPE_WEBHOOK_SECRET = ""
    $env:EMAIL_CONNECTION_STRING = ""
    $env:EMAIL_FROM_ADDRESS = ""
    $env:CORS_ORIGINS = "http://localhost:$($ports.panel),http://127.0.0.1:$($ports.panel),http://localhost:$($ports.storefront),http://127.0.0.1:$($ports.storefront)"
    $env:STOREFRONT_URL = "http://localhost:$($ports.storefront)"
}

function Test-Port($port) {
    [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

function Stop-Demo {
    foreach ($name in $ports.Keys) {
        $file = Join-Path $pidDir "$name.pid"

        if (Test-Path $file) {
            $id = [int](Get-Content $file)
            # Kill the tree: `npm` and `uvicorn` start children.
            cmd /c "taskkill /PID $id /T /F >nul 2>&1"
            $global:LASTEXITCODE = 0
            Remove-Item $file -Force
        }

        # Anything still listening on OUR port (never a dev port).
        $conn = Get-NetTCPConnection -LocalPort $ports[$name] -State Listen -ErrorAction SilentlyContinue
        if ($conn) { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
}

function Copy-App($name) {
    Step "Copying $name (read-only copy of the source; node_modules included)"
    $target = Join-Path $work $name
    # /MIR keeps the copy identical to the source; .next and .env files are not copied.
    robocopy (Join-Path $repo $name) $target /MIR /XD .next .turbo test-results playwright-report /XF .env .env.local tsconfig.tsbuildinfo /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $name ($LASTEXITCODE)" }
    $global:LASTEXITCODE = 0
}

function Start-Hidden($name, $file, $arguments, $workingDirectory) {
    $logs = Join-Path $work "logs"
    New-Item -ItemType Directory -Force $logs | Out-Null
    $process = Start-Process -FilePath $file -ArgumentList $arguments -WorkingDirectory $workingDirectory `
        -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logs "$name.log") -RedirectStandardError (Join-Path $logs "$name.err.log")
    Set-Content (Join-Path $pidDir "$name.pid") $process.Id
}

function Wait-Url($url, $seconds = 120) {
    $until = (Get-Date).AddSeconds($seconds)

    while ((Get-Date) -lt $until) {
        try {
            $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5
            if ($r.StatusCode -lt 500) { return }
        } catch { Start-Sleep -Seconds 2 }
    }

    throw "$url did not come up in $seconds s; see $work\logs"
}

New-Item -ItemType Directory -Force $work, $pidDir | Out-Null

switch ($Action) {
    "status" {
        foreach ($name in $ports.Keys) {
            "{0,-11} :{1}  {2}" -f $name, $ports[$name], $(if (Test-Port $ports[$name]) { "listening" } else { "down" })
        }
        $exists = docker exec car-rental-postgres psql -U car_rental -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'"
        "database    $db  $(if ($exists -match '1') { 'exists' } else { 'missing' })"
    }

    "down" { Step "Stopping the demo servers"; Stop-Demo }

    "destroy" {
        Step "Stopping and removing the demo stack"
        Stop-Demo
        Invoke-Psql "DROP DATABASE IF EXISTS $db WITH (FORCE)"
        Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
    }

    { $_ -in "up", "reseed" } {
        Set-DemoEnvironment
        Stop-Demo

        if ($Action -eq "reseed" -or -not (docker exec car-rental-postgres psql -U car_rental -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'") -match "1") {
            Step "Creating a fresh database $db"
            Invoke-Psql "DROP DATABASE IF EXISTS $db WITH (FORCE)"
            Invoke-Psql "CREATE DATABASE $db"
            Push-Location $backend
            try {
                Step "Migrating"
                & $python -m alembic upgrade head | Select-Object -Last 1
                if ($LASTEXITCODE -ne 0) { throw "alembic failed" }
                Step "Seeding the fictional business"
                & $python seed_marketing_demo.py
                if ($LASTEXITCODE -ne 0) { throw "the seed failed" }
            } finally { Pop-Location }
        }

        Step "Starting the backend on :$($ports.backend)"
        Start-Hidden "backend" $python @("-m", "uvicorn", "app.main:app", "--port", "$($ports.backend)") $backend
        Wait-Url "http://localhost:$($ports.backend)/health" 60

        New-Item -ItemType Directory -Force (Join-Path $work "shared") | Out-Null
        robocopy (Join-Path $repo "shared") (Join-Path $work "shared") /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
        $global:LASTEXITCODE = 0

        foreach ($app in "frontend", "storefront") {
            $dir = Join-Path $work $app
            if ($Rebuild -or -not (Test-Path (Join-Path $dir ".next\BUILD_ID"))) {
                Copy-App $app
                Step "Building $app"
                Push-Location $dir
                try {
                    $env:API_URL = "http://localhost:$($ports.backend)"
                    $env:NEXT_PUBLIC_API_URL = $env:API_URL
                    $env:STOREFRONT_URL = "http://localhost:$($ports.storefront)"
                    $env:NEXT_TELEMETRY_DISABLED = "1"
                    npm run build
                    if ($LASTEXITCODE -ne 0) { throw "$app build failed" }
                } finally { Pop-Location }
            }
        }

        $env:API_URL = "http://localhost:$($ports.backend)"
        $env:NEXT_PUBLIC_API_URL = $env:API_URL
        $env:SENTRY_DSN = ""
        $env:NEXT_PUBLIC_SENTRY_DSN = ""
        $env:STRIPE_PUBLISHABLE_KEY = ""
        $env:NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = ""
        $env:TURNSTILE_SITE_KEY = ""
        $env:CSP_ENFORCE = "false"

        Step "Starting the staff panel on :$($ports.panel)"
        Start-Hidden "panel" "npx.cmd" @("next", "start", "-p", "$($ports.panel)") (Join-Path $work "frontend")
        Step "Starting the booking site on :$($ports.storefront)"
        Start-Hidden "storefront" "npx.cmd" @("next", "start", "-p", "$($ports.storefront)") (Join-Path $work "storefront")

        Wait-Url "http://localhost:$($ports.panel)/login" 120
        Wait-Url "http://localhost:$($ports.storefront)/en" 120

        Write-Host ""
        Write-Host "Demo stack is up." -ForegroundColor Green
        Write-Host "  Panel       http://localhost:$($ports.panel)   (demo.admin@example.com / demo-password-1)"
        Write-Host "  Booking     http://localhost:$($ports.storefront)/en"
        Write-Host "  API         http://localhost:$($ports.backend)"
    }
}
