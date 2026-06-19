# Antigravity Usage Log Dashboard Launcher

Write-Host "=============================================" -ForegroundColor Green
Write-Host "       ANTIGRAVITY AGENT USAGE LOG" -ForegroundColor Yellow
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Starting Flask dashboard backend server..."
Write-Host "Press Ctrl+C in this terminal to stop the server."
Write-Host ""
Write-Host "Launching web browser to http://127.0.0.1:5000..." -ForegroundColor Cyan

# Wait 1 second and open browser
Start-Sleep -Seconds 1
Start-Process "http://127.0.0.1:5000"

# Start Flask
python app.py
