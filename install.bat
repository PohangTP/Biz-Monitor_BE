@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo ================================================
echo   PMS Install Script
echo ================================================
echo.

:: Check admin privileges
net session > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Run as Administrator.
    echo         Right-click this file - Run as administrator
    pause & exit /b 1
)

:: ── 1. Python ────────────────────────────────────
echo [1/5] Checking Python...
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    echo         https://www.python.org/downloads/
    echo         Install Python 3.12.3 and re-run this script.
    pause & exit /b 1
)
python --version
echo.

:: ── 2. venv + packages ───────────────────────────
echo [2/5] Setting up virtual environment...
if not exist venv (
    python -m venv venv
    echo venv created.
)
echo Installing packages...
venv\Scripts\pip.exe install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo [ERROR] Package install failed. Check internet connection.
    pause & exit /b 1
)
echo Packages OK.
echo.

:: ── 3. .env ──────────────────────────────────────
echo [3/5] Environment setup...
if exist .env (
    echo .env already exists - keeping current settings.
) else (
    echo Enter DB connection info:
    echo   Format : mysql+pymysql://user:password@host:3306/dbname
    echo   Example: mysql+pymysql://root:1234@localhost:3306/pms_db
    echo.
    set /p "DB_INPUT=DB_URL: "
    venv\Scripts\python.exe -c "import sys; open('.env','w').write('DB_URL='+sys.argv[1]+'\n# BACKEND_PORT=8000\n# FRONTEND_PORT=5500\n')" "%DB_INPUT%"
    echo .env created.
)
echo.

:: ── 4. DB test ───────────────────────────────────
echo [4/5] Testing DB connection...
venv\Scripts\python.exe install_check.py
if %errorlevel% neq 0 (
    echo [ERROR] DB connection failed. Edit .env and re-run.
    pause & exit /b 1
)
echo.

:: ── 5. Auto-start ────────────────────────────────
echo [5/5] Registering auto-start on login...
schtasks /delete /tn "PMS_FastAPI_Server" /f > nul 2>&1
schtasks /create /tn "PMS_FastAPI_Server" /tr "cmd.exe /c \"%~dp0start-server.bat\"" /sc ONLOGON /ru "%USERNAME%" /rl HIGHEST /f > nul
if %errorlevel% equ 0 (
    echo Auto-start registered.
) else (
    echo [WARN] Auto-start failed - run start-server.bat manually.
)
echo.

echo ================================================
echo   Install complete!
echo   Run start-server.bat to start servers.
echo   Frontend : http://[THIS PC IP]:5500
echo   Backend  : http://[THIS PC IP]:8000/docs
echo ================================================
echo.

set /p "GO=Start server now? (Y/N): "
if /i "%GO%"=="Y" start "" "%~dp0start-server.bat"

pause
