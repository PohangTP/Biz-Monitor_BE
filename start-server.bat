@echo off
:: PMS 서버 자동 시작 스크립트
:: - FastAPI (uvicorn) : 백엔드 API 서버
:: - Python http.server : 프론트엔드 정적 파일 서버
:: Windows 시작 시 자동 실행 등록: register-task.bat 실행

cd /d "%~dp0"

:: .env에서 포트값 읽기
set BACKEND_PORT=8000
set FRONTEND_PORT=5500
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%A"=="BACKEND_PORT"  set BACKEND_PORT=%%B
    if /i "%%A"=="FRONTEND_PORT" set FRONTEND_PORT=%%B
)

echo [PMS] 서버를 시작합니다...
echo   - 프론트엔드 : http://0.0.0.0:%FRONTEND_PORT%
echo   - 백엔드 API : http://0.0.0.0:%BACKEND_PORT%
echo.

:: 1) 프론트엔드 — Python 내장 HTTP 서버 (백그라운드)
start "PMS-Frontend" /min "%~dp0venv\Scripts\python.exe" -m http.server %FRONTEND_PORT% --directory "%~dp0"

:: 2) 백엔드 — uvicorn (포그라운드, 창 닫으면 종료)
call "%~dp0venv\Scripts\activate.bat"
uvicorn main:app --host 0.0.0.0 --port %BACKEND_PORT%
