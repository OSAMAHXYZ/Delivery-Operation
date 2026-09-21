@echo off
echo ========================================
echo   Toyota Queue + Lease Calculator - Full Setup
echo ========================================
echo.

echo Starting App Server (API + Web + WebSocket)...
start "App Server" cmd /k "node server.js"

echo.
echo ========================================
echo   Servers Started Successfully!
echo ========================================
echo.
echo 🌐 Web App (Local): http://localhost:8000/
echo 🌐 Promoter Queue (Local): http://localhost:8000/promoter-queue.html
echo 🌐 Web App (Network): http://YOUR-LAN-IP:8000/
echo 📡 WebSocket: ws://YOUR-LAN-IP:8000
echo.
echo 📱 To access from tablet:
echo    1. Make sure tablet is on the same Wi-Fi network
echo    2. Open browser on tablet and go to:
echo       http://YOUR-LAN-IP:8000/
echo.
echo 🔐 Admin Password: 1234
echo.
echo Press any key to close this window...
pause > nul
