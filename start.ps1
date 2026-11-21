[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$CheckOnly,
    [switch]$AutoApprove
)

$ErrorActionPreference = "Stop"
$Launcher = Join-Path $PSScriptRoot "scripts\start_ecobi.ps1"
if (-not (Test-Path -LiteralPath $Launcher -PathType Leaf)) {
    throw "EcoBI launcher not found: $Launcher"
}

$Arguments = @{ Port = $Port }
if ($NoBrowser) { $Arguments.NoBrowser = $true }
if ($CheckOnly) { $Arguments.CheckOnly = $true }
if ($AutoApprove) { $Arguments.AutoApprove = $true }
& $Launcher @Arguments
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
