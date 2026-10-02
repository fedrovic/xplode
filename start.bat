@echo off
title XPLODE Server
cd /d "%~dp0"

echo ==================================================
echo   XPLODE - starting your website server...
echo.
echo   Your site will open at http://localhost:3000
echo   Always use that address. Do NOT use
echo   localhost/mywebsite - that is an old copy.
echo.
echo   Keep this window OPEN while using the site.
echo   Close it (or press Ctrl+C) to stop the server.
echo ==================================================

set PORT=3000
start "" "http://localhost:3000"
node server.js

echo.
echo Server stopped.
pause
