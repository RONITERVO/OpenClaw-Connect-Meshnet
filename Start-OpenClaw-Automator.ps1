param(
    [int] $Port = 18890
)

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "OpenClaw Automator"
$env:PATH = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:PATH"

function Test-AutomatorHealth {
    param([int] $TargetPort)
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$TargetPort/api/health" -TimeoutSec 2
        return ([bool] $response.ok -and [string] $response.app -eq "OpenClaw Automator")
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

function Get-ProcessCommandLine {
    param([int] $ProcessId)
    try {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
        return [string] $process.CommandLine
    } catch {
        return ""
    }
}

function Test-AutomatorProcess {
    param(
        [int] $ProcessId,
        [string] $ExpectedServerPath
    )
    $commandLine = (Get-ProcessCommandLine -ProcessId $ProcessId).ToLowerInvariant()
    if (-not $commandLine) {
        return $false
    }
    $expected = $ExpectedServerPath.ToLowerInvariant()
    return ($commandLine.Contains($expected) -or
        $commandLine.Contains("automator/server.mjs") -or
        $commandLine.Contains("automator\server.mjs"))
}

function Stop-AutomatorProcessElevated {
    param(
        [int] $ProcessId,
        [string] $ExpectedServerPath
    )
    $escapedPath = $ExpectedServerPath.Replace("'", "''")
    $script = @"
`$processId = $ProcessId
`$expectedServerPath = '$escapedPath'.ToLowerInvariant()
`$process = Get-CimInstance Win32_Process -Filter "ProcessId = `$processId" -ErrorAction SilentlyContinue
if (-not `$process) { exit 0 }
`$commandLine = ([string] `$process.CommandLine).ToLowerInvariant()
if (-not (`$commandLine.Contains(`$expectedServerPath) -or `$commandLine.Contains('automator/server.mjs') -or `$commandLine.Contains('automator\server.mjs'))) {
    Write-Error "PID `$processId is not an OpenClaw Automator server."
    exit 2
}
Stop-Process -Id `$processId -Force -ErrorAction Stop
"@
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($script))
    Write-Host "Requesting administrator permission to stop existing Automator PID $ProcessId..."
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encoded) -Verb RunAs -Wait -PassThru
    return ($process.ExitCode -eq 0)
}

function Stop-AutomatorPortOwners {
    param(
        [int] $TargetPort,
        [string] $ExpectedServerPath
    )
    $ownerIds = @(Get-PortOwnerIds -TargetPort $TargetPort)
    $blocked = @()
    foreach ($ownerId in $ownerIds) {
        if (-not (Test-AutomatorProcess -ProcessId $ownerId -ExpectedServerPath $ExpectedServerPath)) {
            $commandLine = Get-ProcessCommandLine -ProcessId $ownerId
            $blocked += [pscustomobject]@{
                ProcessId = $ownerId
                CommandLine = $commandLine
            }
            continue
        }
        try {
            $process = Get-Process -Id $ownerId -ErrorAction Stop
            Write-Host "Stopping existing Automator listener on port $TargetPort (PID $ownerId, $($process.ProcessName))..."
            Stop-Process -Id $ownerId -Force -ErrorAction Stop
        } catch {
            Write-Host "WARNING: Could not stop PID $ownerId on port ${TargetPort}: $($_.Exception.Message)" -ForegroundColor Yellow
            if (-not (Stop-AutomatorProcessElevated -ProcessId $ownerId -ExpectedServerPath $ExpectedServerPath)) {
                throw "Could not stop existing Automator listener PID $ownerId. Close it manually or rerun this launcher as administrator."
            }
        }
    }
    return $blocked
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

function Find-AvailableAutomatorPort {
    param(
        [int] $StartPort,
        [int] $MaxAttempts = 50
    )
    for ($offset = 0; $offset -lt $MaxAttempts; $offset++) {
        $candidate = $StartPort + $offset
        if ($candidate -gt 65535) {
            break
        }
        if (-not (Get-PortOwnerIds -TargetPort $candidate)) {
            return $candidate
        }
    }
    throw "Could not find a free Automator port starting at $StartPort."
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

if (Test-AutomatorHealth -TargetPort $Port) {
    Write-Host "OpenClaw Automator is already running:"
    Write-Host "  $appUrl"
    Write-Host ""
    Write-Host "Opening browser..."
    Start-Process $appUrl
    exit 0
}

$blockedOwners = @(Stop-AutomatorPortOwners -TargetPort $Port -ExpectedServerPath $serverPath)
if ($blockedOwners.Count -gt 0) {
    $originalPort = $Port
    $Port = Find-AvailableAutomatorPort -StartPort ($Port + 1)
    Write-Host "Port $originalPort is in use by a process that could not be verified as OpenClaw Automator." -ForegroundColor Yellow
    foreach ($owner in $blockedOwners) {
        Write-Host "  PID $($owner.ProcessId): $($owner.CommandLine)"
    }
    Write-Host "Starting OpenClaw Automator on port $Port instead."
    $healthUrl = "http://127.0.0.1:$Port/api/health"
    $appUrl = "http://127.0.0.1:$Port/"
}

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
    if (Test-AutomatorHealth -TargetPort $Port) {
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
