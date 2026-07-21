@echo off
chcp 65001 >nul

cd /d "%~dp0"
node scripts/migrate-db-to-md.js

echo.
echo   Done! Refresh Obsidian to see updated knowledge.
echo.
pause
