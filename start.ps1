# Start the Gridcast web app on Windows without Docker.
#
#   powershell -ExecutionPolicy Bypass -File .\start.ps1           # http://127.0.0.1:8000
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -NoLive   # skip live weekend updates
#   powershell -ExecutionPolicy Bypass -File .\start.ps1 -Port 8080
#
# Needs uv (Python) and Node.js. The script tells you how to install whichever is missing.
param(
    [int]$Port = 8000,
    [switch]$NoLive
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Need($cmd, $how) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "`n'$cmd' is not installed." -ForegroundColor Red
        Write-Host "Install it with:`n  $how`nthen open a new terminal and run this script again.`n"
        exit 1
    }
}
Need "uv" 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
Need "npm" "winget install OpenJS.NodeJS.LTS   (or download the LTS installer from https://nodejs.org)"

# 1. Front end: install packages once, rebuild when the source is newer than the last build.
$dist = Join-Path $PSScriptRoot "web\dist\index.html"
$newestSrc = (Get-ChildItem -Recurse -File web\src, web\index.html | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
if (-not (Test-Path $dist) -or (Get-Item $dist).LastWriteTime -lt $newestSrc) {
    Push-Location web
    if (-not (Test-Path node_modules)) {
        Write-Host "Installing front-end packages..."
        npm ci --no-audit --no-fund
        if ($LASTEXITCODE) { Pop-Location; exit $LASTEXITCODE }
    }
    Write-Host "Building the front end..."
    npm run build
    if ($LASTEXITCODE) { Pop-Location; exit $LASTEXITCODE }
    Pop-Location
}

# 2. Python environment (first run downloads Python 3.13 and the packages).
Write-Host "Preparing the Python environment..."
uv sync --no-dev
if ($LASTEXITCODE) { exit $LASTEXITCODE }

# 3. Start the server; open the browser once it answers.
if ($NoLive) { $env:F1QP_LIVE_INTERVAL = "0" }
$url = "http://127.0.0.1:$Port"
Start-Job -ScriptBlock {
    param($u)
    for ($i = 0; $i -lt 120; $i++) {
        try { Invoke-WebRequest "$u/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process $u; break } catch { Start-Sleep 1 }
    }
} -ArgumentList $url | Out-Null
Write-Host "`nStarting Gridcast at $url (first start computes the predictions, ~10 s). Press Ctrl+C to stop.`n" -ForegroundColor Green
uv run --no-dev f1qp-serve --port $Port
