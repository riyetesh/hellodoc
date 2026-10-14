@echo off
setlocal enabledelayedexpansion

echo ================================================
echo   HelloDoc Platform - Starting All Services
echo ================================================
echo.

set PYTHON_FOUND=0
set NODE_FOUND=0
set NPM_FOUND=0

:: Check if Python is available
where python >nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_FOUND=1
    echo [OK] Python found
) else (
    echo [!] Python not found - symptom prediction disabled
)

:: Check if Node is available
where node >nul 2>&1
if %errorlevel% equ 0 (
    set NODE_FOUND=1
    echo [OK] Node.js found
) else (
    echo [!] Node.js not found - auth features disabled
)

:: Check if npm is available
where npm >nul 2>&1
if %errorlevel% equ 0 (
    set NPM_FOUND=1
    echo [OK] npm found
) else (
    echo [!] npm not found - chatbot disabled
)

echo.
echo ================================================
echo   Starting Services
echo ================================================
echo.

if %PYTHON_FOUND% equ 1 (
    echo [1/3] Starting Flask prediction service (port 5001)...
    start /B "Flask" cmd /c "python Algo/main.py"
    echo      ^> Running in background
) else (
    echo [SKIP] Flask - Python not available
)

echo.

if %NODE_FOUND% equ 1 (
    echo [2/3] Starting Node.js backend (port 5000)...
    start /B "Backend" cmd /c "node backend/server.js"
    echo      ^> Running in background
) else (
    echo [SKIP] Backend - Node.js not available
)

echo.

if %NPM_FOUND% equ 1 (
    echo [3/3] Starting Chatbot (port 5173)...
    start /B "Chatbot" cmd /c "cd chatbot && npm run dev -- --host"
    echo      ^> Running in background
) else (
    echo [SKIP] Chatbot - npm not available
)

echo.
echo ================================================
echo   Services Started
echo ================================================
echo.
echo Access the application at:
echo   ^> Main App:  http://localhost:5000
echo   ^> Chatbot:   http://localhost:5173
echo.
echo Leave this window open while using the app.
echo Close this window to stop all services.
echo.
pause
endlocal
