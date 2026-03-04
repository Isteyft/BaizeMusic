$ErrorActionPreference = "Stop"

$androidDir = Join-Path $PSScriptRoot "..\android"

if (-not (Test-Path $androidDir)) {
  throw "Android project directory not found: $androidDir"
}

$env:NODE_ENV = "production"
$env:EXPO_NO_METRO_WORKSPACE_ROOT = "1"

Write-Host "Building Android release APK..."
Push-Location $androidDir
try {
  & .\gradlew clean assembleRelease
}
finally {
  Pop-Location
}
