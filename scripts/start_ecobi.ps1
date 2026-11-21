<#
.SYNOPSIS
    Script de inicialização do EcoBI Intelligence para PowerShell no Windows.
.DESCRIPTION
    Configura variáveis de ambiente locais, valida diretórios e inicia o EcoBI Launcher.
.PARAMETER Port
    Porta HTTP do servidor (padrão: 8000).
.PARAMETER NoBrowser
    Desativa abertura automática do navegador.
.PARAMETER CheckOnly
    Apenas valida o ambiente e encerra sem subir o servidor.
.PARAMETER AutoApprove
    Autoriza instalação automática do Ollama e download do modelo configurado sem prompt interativo.
#>

param (
    [ValidateRange(1, 65535)]
    [int]$Port = 8000,
    [switch]$NoBrowser,
    [switch]$CheckOnly,
    [switch]$AutoApprove
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RootDir

Write-Host "=======================================================" -ForegroundColor DarkGreen
Write-Host " EcoBI Intelligence — Release Piloto Windows" -ForegroundColor Green
Write-Host " Raiz do Projeto: $RootDir" -ForegroundColor Gray
Write-Host "=======================================================" -ForegroundColor DarkGreen
Write-Host "Preparando ambiente..." -ForegroundColor Cyan

# PowerShell 5.1 treats stderr from native executables as terminating errors when ErrorActionPreference=Stop.
$ErrorActionPreference = "Continue"

function Resolve-EcoBIPythonLauncher {
    $pyCommand = Get-Command py -ErrorAction SilentlyContinue
    if ($pyCommand) {
        $pyVersion = & $pyCommand.Source -3 --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $pyVersion -match 'Python (\d+\.\d+)' -and [version]$Matches[1] -ge [version]'3.11') {
            return @{ Exe = $pyCommand.Source; Prefix = @('-3') }
        }
        $py311Version = & $pyCommand.Source -3.11 --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $py311Version -match 'Python (\d+\.\d+)' -and [version]$Matches[1] -ge [version]'3.11') {
            return @{ Exe = $pyCommand.Source; Prefix = @('-3.11') }
        }
    }
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        $pythonVersion = & $pythonCommand.Source --version 2>&1 | Out-String
        if ($LASTEXITCODE -eq 0 -and $pythonVersion -match 'Python (\d+\.\d+)' -and [version]$Matches[1] -ge [version]'3.11') {
            return @{ Exe = $pythonCommand.Source; Prefix = @() }
        }
    }
    throw "Python 3.11+ is required to prepare the local .venv. Install Python for this Windows user and retry."
}

Write-Host "Verificando dependencias Python..." -ForegroundColor Cyan
$VenvPython = "$RootDir\.venv\Scripts\python.exe"
if (-not (Test-Path $VenvPython)) {
    $ResolvedPython = Resolve-EcoBIPythonLauncher
    & $ResolvedPython.Exe @($ResolvedPython.Prefix + @('-m', 'venv', "$RootDir\.venv"))
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $VenvPython)) { throw "Unable to create the project-local Python environment." }
}

$PythonExe = $VenvPython
& $PythonExe -c "import sys; exec('try:\n import fastapi, uvicorn, pandas, numpy, sklearn, openpyxl, multipart, psutil, httpx\nexcept Exception:\n sys.exit(1)')" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installing declared dependencies into the project-local .venv..." -ForegroundColor Yellow
    & $PythonExe -m pip install --disable-pip-version-check --no-input -r "$RootDir\requirements.txt"
    if ($LASTEXITCODE -ne 0) { throw "Python dependencies could not be prepared in .venv; no global packages were changed." }
}

Write-Host "Runtime Python detectado: $PythonExe" -ForegroundColor Cyan
Write-Host "Preparando runtime..." -ForegroundColor Cyan
$ArgsList = @("scripts\ecobi_launcher.py", "--host", "127.0.0.1", "--port", $Port)
if ($NoBrowser) { $ArgsList += "--no-browser" }
if ($CheckOnly) { $ArgsList += "--check-only" }
if ($AutoApprove) { $ArgsList += "--auto-approve" }

& $PythonExe $ArgsList
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
