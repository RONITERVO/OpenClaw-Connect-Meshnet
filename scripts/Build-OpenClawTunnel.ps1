param(
    [string] $SdkRoot = $env:ANDROID_HOME,
    [string] $BuildToolsVersion = "",
    [string] $OutputApk = "",
    [switch] $Install,
    [string] $AdbSerial = "",
    [int] $VersionCode = 5,
    [string] $VersionName = "1.4"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $repoRoot "android"
if (-not $SdkRoot) {
    $SdkRoot = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not $OutputApk) {
    $OutputApk = Join-Path $repoRoot "dist\OpenClawTunnel-debug.apk"
}

function Get-LatestAndroidPlatform {
    $platformRoot = Join-Path $SdkRoot "platforms"
    $platform = Get-ChildItem -Directory -LiteralPath $platformRoot -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^android-\d+$" } |
        Sort-Object { [int]($_.Name -replace "^android-", "") } -Descending |
        Select-Object -First 1
    if (-not $platform) {
        throw "No Android SDK platform found under $platformRoot"
    }
    return $platform.FullName
}

function Get-BuildToolsDir {
    $buildToolsRoot = Join-Path $SdkRoot "build-tools"
    if ($BuildToolsVersion) {
        $candidate = Join-Path $buildToolsRoot $BuildToolsVersion
        if (-not (Test-Path -LiteralPath $candidate)) {
            throw "Requested Android build-tools version not found: $BuildToolsVersion"
        }
        return $candidate
    }
    $tools = Get-ChildItem -Directory -LiteralPath $buildToolsRoot -ErrorAction SilentlyContinue |
        Sort-Object { [version]$_.Name } -Descending |
        Select-Object -First 1
    if (-not $tools) {
        throw "No Android SDK build-tools found under $buildToolsRoot"
    }
    return $tools.FullName
}

function Get-Tool {
    param(
        [string] $BuildToolsDir,
        [string] $Name
    )
    $candidates = @(
        (Join-Path $BuildToolsDir "$Name.exe"),
        (Join-Path $BuildToolsDir "$Name.bat"),
        (Join-Path $BuildToolsDir $Name)
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }
    throw "Android build tool not found: $Name"
}

function Reset-Directory {
    param([string] $Path)
    if (Test-Path -LiteralPath $Path) {
        $resolvedRepo = (Resolve-Path -LiteralPath $repoRoot).Path
        $resolvedPath = (Resolve-Path -LiteralPath $Path).Path
        if (-not $resolvedPath.StartsWith($resolvedRepo, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to remove directory outside repo: $resolvedPath"
        }
        Remove-Item -Recurse -Force -LiteralPath $Path
    }
    New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

$platformDir = Get-LatestAndroidPlatform
$androidJar = Join-Path $platformDir "android.jar"
$buildToolsDir = Get-BuildToolsDir
$aapt2 = Get-Tool $buildToolsDir "aapt2"
$d8 = Get-Tool $buildToolsDir "d8"
$zipalign = Get-Tool $buildToolsDir "zipalign"
$apksigner = Get-Tool $buildToolsDir "apksigner"

$buildDir = Join-Path $repoRoot "build"
$genDir = Join-Path $buildDir "gen"
$classesDir = Join-Path $buildDir "classes"
$dexDir = Join-Path $buildDir "dex"
$distDir = Split-Path -Parent $OutputApk

Reset-Directory $buildDir
New-Item -ItemType Directory -Force -Path $genDir, $classesDir, $dexDir, $distDir | Out-Null

$compiledRes = Join-Path $buildDir "compiled-res.zip"
$baseApk = Join-Path $buildDir "base-unsigned.apk"
$withDexApk = Join-Path $buildDir "with-dex-unsigned.apk"
$alignedApk = Join-Path $buildDir "aligned-unsigned.apk"
$classesJar = Join-Path $buildDir "classes.jar"
$keystore = Join-Path $buildDir "debug.keystore"

& $aapt2 compile --dir (Join-Path $androidDir "res") -o $compiledRes
& $aapt2 link -I $androidJar --manifest (Join-Path $androidDir "AndroidManifest.xml") --java $genDir --min-sdk-version 23 --target-sdk-version 36 --version-code $VersionCode --version-name $VersionName -o $baseApk $compiledRes

$javaFiles = @(
    Get-ChildItem -Recurse -LiteralPath (Join-Path $androidDir "src") -Filter "*.java" |
        Select-Object -ExpandProperty FullName
    Get-ChildItem -Recurse -LiteralPath $genDir -Filter "*.java" |
        Select-Object -ExpandProperty FullName
)

& javac -source 8 -target 8 -encoding UTF-8 -bootclasspath $androidJar -d $classesDir $javaFiles
& jar cf $classesJar -C $classesDir .
& $d8 --classpath $androidJar --min-api 23 --output $dexDir $classesJar

Copy-Item -Force -LiteralPath $baseApk -Destination $withDexApk
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($withDexApk, "Update")
try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $zip,
        (Join-Path $dexDir "classes.dex"),
        "classes.dex",
        [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
} finally {
    $zip.Dispose()
}

& $zipalign -p -f 4 $withDexApk $alignedApk
& keytool -genkeypair -v -keystore $keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" -noprompt | Out-Null
& $apksigner sign --ks $keystore --ks-pass pass:android --key-pass pass:android --out $OutputApk $alignedApk

Write-Host "Built $OutputApk"

if ($Install) {
    $adbArgs = @()
    if ($AdbSerial) {
        $adbArgs += @("-s", $AdbSerial)
    }
    $adbArgs += @("install", "-r", $OutputApk)
    & adb @adbArgs
}
