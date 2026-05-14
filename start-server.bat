@echo off
:: PMS FastAPI 서버 자동 시작 스크립트
:: Windows 시작 시 자동 실행 등록: register-task.bat 실행

cd /d "%~dp0"

:: .env에서 BACKEND_PORT 읽기 (없으면 8000 기본값)
set BACKEND_PORT=8000
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="BACKEND_PORT" set BACKEND_PORT=%%B
)

:: 가상환경 활성화 후 uvicorn 실행
echo [PMS] FastAPI 서버를 포트 %BACKEND_PORT%에서 시작합니다...
call "%~dp0venv\Scripts\activate.bat"
uvicorn main:app --host 0.0.0.0 --port %BACKEND_PORT%
