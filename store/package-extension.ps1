# Builds dist/ui-recorder-<version>.zip for upload to the Chrome Web Store.
#
#   powershell -ExecutionPolicy Bypass -File store\package-extension.ps1
#
# The zip contains ONLY the files the extension needs at runtime. It deliberately leaves out
# sample/ (saved pages that contain access tokens), store/ (listing assets + tooling), README,
# git data and anything else that must not be published.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version

$include = @('manifest.json', 'background.js', 'drive-upload.js', 'offscreen.html', 'offscreen.js', 'content', 'popup', 'review', 'icons')

$dist = Join-Path $root 'dist'
$stage = Join-Path $dist 'stage'
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

foreach ($item in $include) {
    $source = Join-Path $root $item
    if (-not (Test-Path $source)) { throw "Missing required file or folder: $item" }
    Copy-Item $source -Destination $stage -Recurse
}

# tar.exe (built into Windows 10+) writes a zip with correct forward-slash paths; Compress-Archive in
# Windows PowerShell 5.1 does not, which can make the store reject the package.
$zip = Join-Path $dist "ui-recorder-$version.zip"
& tar.exe -a -c -f $zip -C $stage @include
if ($LASTEXITCODE -ne 0) { throw 'tar.exe failed to create the zip' }
Remove-Item $stage -Recurse -Force

Write-Host ''
Write-Host "Created $zip" -ForegroundColor Green
Write-Host ('  size: {0:N0} KB' -f ((Get-Item $zip).Length / 1KB))
Write-Host '  contents:'
& tar.exe -tf $zip | ForEach-Object { Write-Host "    $_" }

# ---- things worth fixing before you upload ----
$problems = @()
if ($manifest.oauth2 -and $manifest.oauth2.client_id -like 'YOUR_OAUTH_CLIENT_ID*') {
    $problems += 'manifest.json still has the placeholder oauth2.client_id. Either put your real Google OAuth client ID there, or delete the "oauth2" block and the "identity" permission to ship without Google Drive.'
}
if ($manifest.description.Length -gt 132) { $problems += "manifest description is $($manifest.description.Length) chars; the store limit is 132." }
if ($manifest.version -eq '0.1.0') { $problems += 'version is still 0.1.0 - consider 1.0.0 for the first public release.' }
if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'Before you upload:' -ForegroundColor Yellow
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
