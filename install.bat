@echo off
cd /d "%~dp0"
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo Python not found. Install from https://www.python.org/downloads/
    pause
    exit /b 1
)
python "%~dp0install.py"
pause
