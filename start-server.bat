@echo off
cd /d "%~dp0"

set BACKEND_PORT=8000
set FRONTEND_PORT=5500

for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="BACKEND_PORT"  set BACKEND_PORT=%%B
    if /i "%%A"=="FRONTEND_PORT" set FRONTEND_PORT=%%B
)

echo [PMS] Starting servers...
echo   Frontend : http://0.0.0.0:%FRONTEND_PORT%
echo   Backend  : http://0.0.0.0:%BACKEND_PORT%
echo.

start "PMS-Frontend" /min "%~dp0venv\Scripts\python.exe" -m http.server %FRONTEND_PORT% --directory "%~dp0."

call "%~dp0venv\Scripts\activate.bat"
uvicorn main:app --host 0.0.0.0 --port %BACKEND_PORT%
