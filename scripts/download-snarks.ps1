# Download all 10,000 zkSNARKs from zilkroad.com (art\1.png … art\10000.png) into a folder.
# Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\download-snarks.ps1 -Dir "C:\Users\<you>\Documents\ART"
# Re-run it to fill any that failed (files already there are skipped).
# Then zip the folder and upload the zip (art.zip) to the repo: the make-sheet workflow
# turns it into public/snarks.png.
param([string]$Dir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ART'))
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force $Dir | Out-Null
$headers = @{ 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'; 'Referer' = 'https://zilkroad.com/' }
Write-Host "Saving to $Dir"
$failed = @()
foreach ($n in 1..10000) {
  $f = Join-Path $Dir "$n.png"
  if (Test-Path $f) { continue }
  try {
    Invoke-WebRequest "https://zilkroad.com/api/art/$n" -Headers $headers -OutFile $f -UseBasicParsing
    if ($n -eq 1) { Write-Host "OK: saved $f ($((Get-Item $f).Length) bytes)" }
  } catch {
    $failed += $n; Write-Host "#$n failed: $($_.Exception.Message)"; Remove-Item $f -ErrorAction SilentlyContinue
  }
  if ($n % 100 -eq 0) { Write-Host "$n / 10000 (failed so far: $($failed.Count))" }
}
Write-Host "Done. Files in $Dir. Failed: $($failed.Count) $($failed -join ', ')"
