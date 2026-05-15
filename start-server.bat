@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set BACKEND_PORT=8000
set FRONTEND_PORT=5500

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    set "_k=%%A"
    set "_k=!_k: =!"
    if not "!_k:~0,1!"=="#" (
        if /i "!_k!"=="BACKEND_PORT"  set BACKEND_PORT=%%B
        if /i "!_k!"=="FRONTEND_PORT" set FRONTEND_PORT=%%B
    )
)

:: trailing backslash 제거 (python --directory 인자 오류 방지)
set "DIR=%~dp0"
if "!DIR:~-1!"=="\" set "DIR=!DIR:~0,-1!"

echo [PMS] Starting servers...
echo   Frontend : http://0.0.0.0:%FRONTEND_PORT%
echo   Backend  : http://0.0.0.0:%BACKEND_PORT%
echo.

start "PMS-Frontend" /min "!DIR!\venv\Scripts\python.exe" -m http.server %FRONTEND_PORT% --directory "!DIR!"

call "!DIR!\venv\Scripts\activate.bat"
uvicorn main:app --host 0.0.0.0 --port %BACKEND_PORT%
