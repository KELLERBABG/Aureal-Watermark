# scripts/build-all.ps1 - Build complete release artifacts for Aureal Watermark
$ErrorActionPreference = "Stop"

function Assert-LastExit([string]$step) {
    if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE" }
}

$pkgVersion = (Get-Content "package.json" -Raw | ConvertFrom-Json).version
$zipName = "aureal-watermark-v$pkgVersion-universal.zip"

$nodeExe = (node -p "process.execPath" | Out-String).Trim()
Assert-LastExit "Resolving node executable"
if ((Split-Path $nodeExe -Leaf) -notmatch '^node(\.exe)?$') {
    throw "SEA build needs a standard Node.js executable, but this process runs $nodeExe. Install Node.js >= 18 and build from it."
}

Write-Host "1. Bundling dist/cli.cjs..."
node scripts/bundle.js
Assert-LastExit "Bundle"

Write-Host "2. Copying to dist/aureal-watermark.cjs..."
Copy-Item "dist/cli.cjs" -Destination "dist/aureal-watermark.cjs" -Force

Write-Host "3. Generating sea-config.json..."
Set-Content -Path "dist/sea-config.json" -Value '{"main":"dist/cli.cjs","output":"dist/sea-prep.blob","disableExperimentalSEAWarning":true}'

Write-Host "4. Generating SEA blob..."
node --experimental-sea-config dist/sea-config.json
Assert-LastExit "SEA blob"

Write-Host "5. Copying $nodeExe to dist/aureal-watermark.exe..."
Copy-Item $nodeExe -Destination "dist/aureal-watermark.exe" -Force

Write-Host "5.5. Installing rcedit for PE stamping..."
npm.cmd install --no-save --no-package-lock --no-audit --no-fund rcedit
Assert-LastExit "Install rcedit"

Write-Host "5.6. Stamping official Aureal icon and PE metadata with rcedit..."
node scripts/stamp-icon.cjs
Assert-LastExit "Stamp icon"

Write-Host "6. Injecting SEA blob with postject..."
npx.cmd --yes postject dist/aureal-watermark.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
Assert-LastExit "Postject"

Write-Host "7. Verifying aureal-watermark.exe..."
& .\dist\aureal-watermark.exe --help
Assert-LastExit "Executable smoke test"

Write-Host "8. Building universal zip bundle..."
$zipPath = "dist/$zipName"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$tempZipDir = Join-Path $env:TEMP "aureal-watermark-v$pkgVersion-universal"
if (Test-Path $tempZipDir) { Remove-Item $tempZipDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempZipDir | Out-Null

Copy-Item "dist/aureal-watermark.cjs" -Destination (Join-Path $tempZipDir "aureal-watermark.cjs")
Copy-Item "site" -Destination (Join-Path $tempZipDir "site") -Recurse
Copy-Item "_redirects" -Destination (Join-Path $tempZipDir "_redirects")
Copy-Item "README.md" -Destination (Join-Path $tempZipDir "README.md")
Copy-Item "LICENSE.md" -Destination (Join-Path $tempZipDir "LICENSE.md")
Copy-Item "assets" -Destination (Join-Path $tempZipDir "assets") -Recurse

Compress-Archive -Path "$tempZipDir\*" -DestinationPath $zipPath -Force
Remove-Item $tempZipDir -Recurse -Force

Write-Host "Build complete! Artifacts in dist/:"
Get-ChildItem dist/
