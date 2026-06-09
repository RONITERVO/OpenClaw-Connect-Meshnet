param(
    [int] $Port = 18890
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "OpenClaw Automator"
$env:PATH = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:PATH"

function Test-HttpOk {
    param([string] $Url)
    try {
        $response = Invoke-RestMethod -Uri $Url -TimeoutSec 2
        return [bool] $response.ok
    } catch {
        return $false
    }
}

function Get-PortOwnerIds {
    param([int] $TargetPort)
    @(Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -and $_.OwningProcess -ne $PID } |
        Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-PortOwners {
    param([int] $TargetPort)
    $ownerIds = @(Get-PortOwnerIds -TargetPort $TargetPort)
    foreach ($ownerId in $ownerIds) {
        try {
            $process = Get-Process -Id $ownerId -ErrorAction Stop
            Write-Host "Stopping existing Automator listener on port $TargetPort (PID $ownerId, $($process.ProcessName))..."
            Stop-Process -Id $ownerId -Force -ErrorAction Stop
        } catch {
            Write-Host "WARNING: Could not stop PID $ownerId on port ${TargetPort}: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

function Wait-PortFree {
    param([int] $TargetPort)
    for ($i = 0; $i -lt 30; $i++) {
        if (-not (Get-PortOwnerIds -TargetPort $TargetPort)) {
            return $true
        }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: node.exe was not found. Install Node.js or add it to PATH." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: openclaw was not found. Install OpenClaw or add npm global tools to PATH." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$appDir = Join-Path $PSScriptRoot "automator"
$serverPath = Join-Path $appDir "server.mjs"
if (-not (Test-Path -LiteralPath $serverPath)) {
    Write-Host "ERROR: Automator server was not found: $serverPath" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$stateDir = Join-Path $env:USERPROFILE ".openclaw\automator"
$pidPath = Join-Path $stateDir "server.pid"
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null

$healthUrl = "http://127.0.0.1:$Port/api/health"
$appUrl = "http://127.0.0.1:$Port/"

Stop-PortOwners -TargetPort $Port

if (Test-Path -LiteralPath $pidPath) {
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

if (-not (Wait-PortFree -TargetPort $Port)) {
    Write-Host "ERROR: Port $Port is still in use. Close the owning process and try again." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$env:OPENCLAW_AUTOMATOR_PORT = [string] $Port
$process = Start-Process -FilePath "node.exe" -ArgumentList @($serverPath) -WorkingDirectory $appDir -WindowStyle Hidden -PassThru
Set-Content -Path $pidPath -Value $process.Id -Encoding ASCII

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 300
    if (Test-HttpOk $healthUrl) {
        $ready = $true
        break
    }
}
if (-not $ready) {
    Write-Host "ERROR: OpenClaw Automator did not start on $appUrl" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "OpenClaw Automator is running:"
Write-Host "  $appUrl"
Write-Host ""
Write-Host "Opening browser..."
Start-Process $appUrl
