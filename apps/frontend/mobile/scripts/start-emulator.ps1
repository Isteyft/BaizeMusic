$ErrorActionPreference = "Stop"

$defaultSdk = "C:\Users\Administrator\AppData\Local\Android\Sdk"
$defaultAvdHome = "C:\Users\Administrator\.android\avd"
$defaultAvdName = "Medium_Phone_API_36.1"

$sdkRoot = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { $defaultSdk }
$avdHome = if ($env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME } else { $defaultAvdHome }
$avdName = if ($env:BAIZE_ANDROID_AVD) { $env:BAIZE_ANDROID_AVD } else { $defaultAvdName }

$env:ANDROID_SDK_ROOT = $sdkRoot
$env:ANDROID_AVD_HOME = $avdHome

$emulatorExe = Join-Path $sdkRoot "emulator\emulator.exe"
$adbExe = Join-Path $sdkRoot "platform-tools\adb.exe"

if (-not (Test-Path $emulatorExe)) {
  throw "emulator.exe not found: $emulatorExe"
}
if (-not (Test-Path $adbExe)) {
  throw "adb.exe not found: $adbExe"
}

$running = & $adbExe devices | Select-String -Pattern "^emulator-\d+\s+device" -Quiet
if ($running) {
  Write-Host "Android emulator is already running."
  exit 0
}

Write-Host "Starting emulator $avdName ..."
Start-Process -FilePath $emulatorExe -ArgumentList @(
  "@$avdName",
  "-no-snapshot-load",
  "-gpu",
  "swiftshader_indirect"
) | Out-Null

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 2
  $ready = & $adbExe devices | Select-String -Pattern "^emulator-\d+\s+device" -Quiet
  if ($ready) {
    Write-Host "Emulator is ready."
    exit 0
  }
}

throw "Emulator failed to start within 90s."
