@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ================================================
echo   PMS - Install Script
echo ================================================
echo.

:: Check admin privileges
net session > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Please run as Administrator.
    echo         Right-click this file and select "Run as administrator"
    pause & exit /b 1
)

:: ── 1. Python check ──────────────────────────────
echo [1/5] Checking Python...
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found.
    echo         Install Python 3.12.3 from https://www.python.org/downloads/
    pause & exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo        Python %PY_VER% OK

:: ── 2. venv + packages ───────────────────────────
echo.
echo [2/5] Setting up virtual environment...
if exist venv (
    echo        Existing venv found - reusing.
) else (
    python -m venv venv
    echo        venv created.
)

echo        Installing packages (please wait)...
venv\Scripts\pip.exe install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo [ERROR] Package install failed. Check your internet connection.
    pause & exit /b 1
)
echo        Packages installed.

:: ── 3. .env setup ────────────────────────────────
echo.
echo [3/5] Environment variables...
if exist .env (
    echo        .env already exists - keeping existing settings.
    echo        (Edit .env directly if you need to change settings)
) else (
    copy .env.example .env > nul
    echo.
    echo        ** Enter your DB connection string **
    echo        Format : mysql+pymysql://user:password@host:3306/dbname
    echo        Example: mysql+pymysql://root:1234@localhost:3306/pms_db
    echo.
    set /p DB_URL="        DB_URL: "
    (
        echo DB_URL=!DB_URL!
        echo.
        echo # BACKEND_PORT=8000
        echo # FRONTEND_PORT=5500
    ) > .env
    echo        .env created.
)

:: ── 4. DB connection test ─────────────────────────
echo.
echo [4/5] Testing DB connection...
venv\Scripts\python.exe -c "
import os, sys
from dotenv import load_dotenv
load_dotenv()
url = os.environ.get('DB_URL','')
if not url:
    print('  [ERROR] DB_URL is not set.')
    sys.exit(1)
try:
    import sqlalchemy
    engine = sqlalchemy.create_engine(url)
    with engine.connect() as c:
        c.execute(sqlalchemy.text('SELECT 1'))
    print('  DB connection OK')
except Exception as e:
    print(f'  [ERROR] DB connection failed: {e}')
    print('  Check DB_URL in your .env file.')
    sys.exit(1)
"
if %errorlevel% neq 0 (
    echo.
    echo        Edit .env and fix DB_URL, then run install.bat again.
    pause & exit /b 1
)

:: ── 5. Task Scheduler ─────────────────────────────
echo.
echo [5/5] Registering auto-start on login...
set "TASK_NAME=PMS_FastAPI_Server"
schtasks /delete /tn "%TASK_NAME%" /f > nul 2>&1
schtasks /create /tn "%TASK_NAME%" /tr "cmd.exe /c \"%~dp0start-server.bat\"" /sc ONLOGON /ru "%USERNAME%" /rl HIGHEST /f > nul
if %errorlevel% equ 0 (
    echo        Auto-start registered.
) else (
    echo        [WARN] Registration failed - run start-server.bat manually.
)

:: ── Done ──────────────────────────────────────────
echo.
echo ================================================
echo   Installation complete!
echo ================================================
echo.
echo   Start server : run start-server.bat
echo   Frontend     : http://[THIS PC IP]:5500
echo   Backend API  : http://[THIS PC IP]:8000
echo   API Docs     : http://[THIS PC IP]:8000/docs
echo.

set /p START_NOW="Start server now? (Y/N): "
if /i "!START_NOW!"=="Y" (
    start "" "%~dp0start-server.bat"
)

pause
