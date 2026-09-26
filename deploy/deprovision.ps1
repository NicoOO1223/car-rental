# Removes a customer stack: its resource group (database, backups, apps), its
# GitHub Environment and its CI federated credentials. The shared registry is
# never touched. This is destructive and cannot be undone, and it deletes the
# stack's database and backups, so it asks you to type the stack's name.
#
#   .\deploy\deprovision.ps1 -Stack acme
#
# The canary stack is refused: every release goes through it first.

param(
    [Parameter(Mandatory = $true)][string]$Stack,
    # Also delete the stack's local secrets in deploy/.stacks/<slug>/.
    [switch]$DeleteLocalSecrets,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$manifestPath = "$PSScriptRoot\stacks\$Stack.json"
if (-not (Test-Path $manifestPath)) { throw "No manifest at $manifestPath" }
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$shared = Get-Content "$PSScriptRoot\shared.json" -Raw | ConvertFrom-Json

if ($manifest.canary) { throw "Refusing to remove '$Stack': it is the canary stack every release goes through. Move the canary role to another stack first." }

$rg = $manifest.resourceGroup
$envName = "stack-$Stack"

if ($rg -eq $shared.resourceGroup) { throw "The manifest points at the shared resource group. Refusing." }

Write-Host "This will permanently delete:" -ForegroundColor Yellow
Write-Host "  - resource group $rg (its database, backups and apps)"
Write-Host "  - GitHub environment $envName and its variables and secrets"
Write-Host "  - the CI federated credentials for $envName"
Write-Host "The stack's manifest (deploy/stacks/$Stack.json) is kept; delete it yourself when you are sure."

if (-not $DryRun) {
    $typed = Read-Host "Type the stack name ($Stack) to confirm"
    if ($typed -ne $Stack) { throw "Not confirmed. Nothing was deleted." }
}

function Invoke-Step([string]$Text, [ScriptBlock]$Command) {
    if ($DryRun) { Write-Host "[dry-run] $Text" -ForegroundColor DarkGray; return }
    Write-Host $Text
    & $Command
}

Invoke-Step "delete resource group $rg" { az group delete --name $rg --yes }

$repo = if ($DryRun) { "<owner/repo>" } else { (gh repo view --json nameWithOwner --jq .nameWithOwner).Trim() }
Invoke-Step "delete GitHub environment $envName" { gh api -X DELETE "repos/$repo/environments/$envName" }

foreach ($name in @("github-$envName", "github-$envName-immutable-id")) {
    Invoke-Step "delete federated credential $name" {
        az ad app federated-credential delete --id $shared.ciAppId --federated-credential-id $name 2>$null
    }
}

if ($DeleteLocalSecrets) {
    Invoke-Step "delete deploy/.stacks/$Stack" { Remove-Item -Recurse -Force "$PSScriptRoot\.stacks\$Stack" -ErrorAction SilentlyContinue }
}

Write-Host "Done." -ForegroundColor Green
