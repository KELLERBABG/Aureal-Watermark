# scripts/build-all.ps1 - Build complete release artifacts for Aureal Watermark
$ErrorActionPreference = "Stop"

Write-Host "1. Bundling dist/cli.cjs..."
node scripts/bundle.js

Write-Host "2. Copying to dist/aureal-watermark.cjs..."
Copy-Item "dist/cli.cjs" -Destination "dist/aureal-watermark.cjs" -Force

Write-Host "3. Generating sea-config.json..."
Set-Content -Path "sea-config.json" -Value '{"main":"dist/cli.cjs","output":"dist/sea-prep.blob","disableExperimentalSEAWarning":true}'

Write-Host "4. Generating SEA blob..."
node --experimental-sea-config sea-config.json

Write-Host "5. Copying node.exe to dist/aureal-watermark.exe..."
$nodePath = (Get-Command node).Source
Copy-Item $nodePath -Destination "dist/aureal-watermark.exe" -Force

Write-Host "5.5. Stamping official Aureal icon and PE metadata with rcedit..."
node scripts/stamp-icon.cjs

Write-Host "6. Injecting SEA blob with postject..."
npx.cmd --yes postject dist/aureal-watermark.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

Write-Host "7. Verifying aureal-watermark.exe..."
& .\dist\aureal-watermark.exe --help

Write-Host "8. Building universal zip bundle..."
$zipPath = "dist/aureal-watermark-v0.2.4-universal.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$tempZipDir = Join-Path $env:TEMP "aureal-watermark-v0.2.4-universal"
if (Test-Path $tempZipDir) { Remove-Item $tempZipDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempZipDir | Out-Null

Copy-Item "dist/aureal-watermark.cjs" -Destination (Join-Path $tempZipDir "aureal-watermark.cjs")
Copy-Item "studio.html" -Destination (Join-Path $tempZipDir "studio.html")
Copy-Item "verifier.html" -Destination (Join-Path $tempZipDir "verifier.html")
Copy-Item "pricing.html" -Destination (Join-Path $tempZipDir "pricing.html")
Copy-Item "docs.html" -Destination (Join-Path $tempZipDir "docs.html")
Copy-Item "index.html" -Destination (Join-Path $tempZipDir "index.html")
Copy-Item "README.md" -Destination (Join-Path $tempZipDir "README.md")
Copy-Item "LICENSE.md" -Destination (Join-Path $tempZipDir "LICENSE.md")
Copy-Item "assets" -Destination (Join-Path $tempZipDir "assets") -Recurse
Copy-Item "demo" -Destination (Join-Path $tempZipDir "demo") -Recurse

Compress-Archive -Path "$tempZipDir\*" -DestinationPath $zipPath -Force
Remove-Item $tempZipDir -Recurse -Force

Write-Host "Build complete! Artifacts in dist/:"
Get-ChildItem dist/
