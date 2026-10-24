param(
    [ValidateSet('preview', 'firebase')][string]$Variant = 'preview',
    [switch]$Verify,
    [switch]$DeviceTests
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME 'bin/java.exe'))) {
    $studioJdk = 'C:/Program Files/Android/Android Studio/jbr'
    if (Test-Path -LiteralPath $studioJdk) { $env:JAVA_HOME = $studioJdk }
}
if (-not $env:ANDROID_HOME -or -not (Test-Path -LiteralPath $env:ANDROID_HOME)) {
    $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
    if (Test-Path -LiteralPath $sdkRoot) { $env:ANDROID_HOME = $sdkRoot }
}
$variantTitle = (Get-Culture).TextInfo.ToTitleCase($Variant)
$tasks = @(':app:assemble{0}Debug' -f $variantTitle)
if ($Verify) { $tasks += @((':app:test{0}DebugUnitTest' -f $variantTitle), (':app:lint{0}Debug' -f $variantTitle)) }
if ($DeviceTests) { $tasks += ':app:connected' + $variantTitle + 'DebugAndroidTest' }
Push-Location $projectRoot
try {
    & ./gradlew.bat @tasks --console=plain
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output "APK: $projectRoot/app/build/outputs/apk/$Variant/debug/app-$Variant-debug.apk"
} finally { Pop-Location }
