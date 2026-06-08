$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "OpenClaw Agent Gateway"
$env:PATH = "$env:APPDATA\npm;C:\Program Files\nodejs;$env:PATH"

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Test-CgnatIPv4 {
    param([string] $Ip)
    $parts = $Ip -split "\."
    if ($parts.Count -ne 4) {
        return $false
    }
    $octets = @()
    foreach ($part in $parts) {
        $value = 0
        if (-not [int]::TryParse($part, [ref] $value)) {
            return $false
        }
        if ($value -lt 0 -or $value -gt 255) {
            return $false
        }
        $octets += $value
    }
    return ($octets[0] -eq 100 -and $octets[1] -ge 64 -and $octets[1] -le 127)
}

function Get-OpenClawMeshIPv4 {
    $configuredMeshIp = $env:OPENCLAW_MESH_IP
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { Test-CgnatIPv4 $_.IPAddress } |
        Select-Object -ExpandProperty IPAddress)

    if ($configuredMeshIp -and (Test-CgnatIPv4 $configuredMeshIp)) {
        if ($addresses -contains $configuredMeshIp) {
            return $configuredMeshIp
        }
        if ($addresses.Count -eq 0) {
            return $configuredMeshIp
        }
    }
    if ($addresses.Count -gt 0) {
        return $addresses[0]
    }
    return $null
}

if (-not $isAdmin) {
    Write-Host "Requesting administrator privileges for OpenClaw Agent Gateway..."
    Start-Process -FilePath "PowerShell.exe" -Verb RunAs -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        "`"$PSCommandPath`""
    )
    exit
}

if (-not (Get-Command openclaw -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "ERROR: openclaw was not found on PATH." -ForegroundColor Red
    Write-Host "Expected it in $env:APPDATA\npm or from your Node.js npm global install."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Host ""
    Write-Host "ERROR: node.exe was not found on PATH." -ForegroundColor Red
    Write-Host "Expected Node.js at C:\Program Files\nodejs or on PATH."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

$stateDir = Join-Path $env:USERPROFILE ".openclaw"
$portProxyOwnerPath = Join-Path $stateDir "openclaw-clickstart-portproxy-owner.txt"
$loopbackProxyPidPath = Join-Path $stateDir "openclaw-clickstart-loopback-proxy.pid"
$loopbackProxyScriptPath = Join-Path $PSScriptRoot "openclaw-loopback-proxy.js"
$runId = [guid]::NewGuid().ToString()
New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
Set-Content -Path $portProxyOwnerPath -Value $runId -Encoding ASCII

if (-not (Test-Path -LiteralPath $loopbackProxyScriptPath)) {
    Write-Host ""
    Write-Host "ERROR: loopback proxy helper was not found:" -ForegroundColor Red
    Write-Host $loopbackProxyScriptPath
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}

Write-Host "OpenClaw Agent Gateway" -ForegroundColor Cyan
Write-Host "======================"
Write-Host ""
Write-Host "This elevated PowerShell window is the running Gateway session."
Write-Host "Leave it open. Closing this window stops remote access from the phone."
Write-Host ""
Write-Host "Stopping the background Scheduled Task first to avoid port 18789 collisions..."

& openclaw gateway stop *> $null
& schtasks /End /TN "OpenClaw Gateway" *> $null
& netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=18789 *> $null
if (Test-Path -LiteralPath $loopbackProxyPidPath) {
    try {
        $oldPid = [int]((Get-Content -Raw -LiteralPath $loopbackProxyPidPath).Trim())
        Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    } catch {
    }
    Remove-Item -LiteralPath $loopbackProxyPidPath -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 3

$meshIp = Get-OpenClawMeshIPv4
if (-not $meshIp) {
    Write-Host ""
    Write-Host "ERROR: Could not detect a NordVPN Meshnet/Tailnet IPv4 address." -ForegroundColor Red
    Write-Host "Start NordVPN Meshnet, or set OPENCLAW_MESH_IP before running this launcher."
    Write-Host ""
    Read-Host "Press Enter to close"
    exit 1
}
& openclaw config set gateway.remote.url "ws://$($meshIp):18789" *> $null
$loopbackProxyJob = Start-Job -Name "OpenClawLoopbackProxyStarter" -ArgumentList $meshIp, $portProxyOwnerPath, $runId, $loopbackProxyPidPath, $loopbackProxyScriptPath, $nodeCommand.Source -ScriptBlock {
    param([string] $MeshIp, [string] $OwnerPath, [string] $RunId, [string] $PidPath, [string] $ProxyScriptPath, [string] $NodePath)
    Start-Sleep -Seconds 6
    try {
        $currentOwner = (Get-Content -Raw -Path $OwnerPath -ErrorAction Stop).Trim()
        if ($currentOwner -ne $RunId) {
            return
        }
    } catch {
        return
    }
    $process = Start-Process -FilePath $NodePath -ArgumentList @($ProxyScriptPath, $MeshIp, "18789", $OwnerPath, $RunId) -WindowStyle Hidden -PassThru
    Set-Content -Path $PidPath -Value $process.Id -Encoding ASCII
}

Write-Host ""
Write-Host "Phone:"
Write-Host "  1. Keep NordVPN Meshnet running on this PC and on the phone."
Write-Host "  2. Open the OpenClaw Tunnel app."
Write-Host "  3. Tap `"Start & Open Agent`"."
Write-Host ""
Write-Host "Phone agent URL:"
Write-Host "  http://127.0.0.1:18789/"
Write-Host ""
Write-Host "Telegram:"
Write-Host "  Message your OpenClaw Telegram bot directly."
Write-Host ""
Write-Host "Local compatibility:"
Write-Host "  A local TCP proxy will forward 127.0.0.1:18789 to $($meshIp):18789 after startup."
Write-Host "  This fixes local channel helpers that expect localhost."
Write-Host ""
Write-Host "Starter prompt to paste:"
Write-Host "  Confirm you are my OpenClaw agent running on my PC. Tell me your current model, available tools, and whether Telegram/control UI access is working. Then wait for my next instruction."
Write-Host ""
Write-Host "Starting foreground Gateway on the Meshnet/tailnet interface, port 18789..."
Write-Host ""

& openclaw gateway run --force --bind tailnet --port 18789 --compact

if ($loopbackProxyJob) {
    Receive-Job -Job $loopbackProxyJob -ErrorAction SilentlyContinue | Out-Null
    Remove-Job -Job $loopbackProxyJob -Force -ErrorAction SilentlyContinue
}
try {
    $currentOwner = (Get-Content -Raw -Path $portProxyOwnerPath -ErrorAction Stop).Trim()
    if ($currentOwner -eq $runId) {
        & netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=18789 *> $null
        if (Test-Path -LiteralPath $loopbackProxyPidPath) {
            try {
                $proxyPid = [int]((Get-Content -Raw -LiteralPath $loopbackProxyPidPath).Trim())
                Stop-Process -Id $proxyPid -Force -ErrorAction SilentlyContinue
            } catch {
            }
            Remove-Item -LiteralPath $loopbackProxyPidPath -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -Path $portProxyOwnerPath -Force -ErrorAction SilentlyContinue
    }
} catch {
}

Write-Host ""
Write-Host "OpenClaw Gateway stopped or exited." -ForegroundColor Yellow
Write-Host "Check the messages above for the reason."
Read-Host "Press Enter to close"
