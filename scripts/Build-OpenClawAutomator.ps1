param(
    [string] $OutputZip = "",
    [switch] $OpenFolder
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$distDir = Join-Path $repoRoot "dist"
$stageDir = Join-Path $repoRoot "build\OpenClawAutomator"
if (-not $OutputZip) {
    $OutputZip = Join-Path $distDir "OpenClawAutomator-win.zip"
}

if (Test-Path -LiteralPath $stageDir) {
    $resolvedRepo = (Resolve-Path -LiteralPath $repoRoot).Path
    $resolvedStage = (Resolve-Path -LiteralPath $stageDir).Path
    if (-not $resolvedStage.StartsWith($resolvedRepo, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside repo: $resolvedStage"
    }
    Remove-Item -Recurse -Force -LiteralPath $stageDir
}

New-Item -ItemType Directory -Force -Path $stageDir, $distDir | Out-Null

Copy-Item -Recurse -Force -LiteralPath (Join-Path $repoRoot "automator") -Destination (Join-Path $stageDir "automator")
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "Start-OpenClaw-Automator.cmd") -Destination $stageDir
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "Start-OpenClaw-Automator.ps1") -Destination $stageDir
Copy-Item -Force -LiteralPath (Join-Path $repoRoot "README.md") -Destination $stageDir

if (Test-Path -LiteralPath $OutputZip) {
    Remove-Item -Force -LiteralPath $OutputZip
}

Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $OutputZip -Force
Write-Host "Built $OutputZip"

if ($OpenFolder) {
    Start-Process (Split-Path -Parent $OutputZip)
}
