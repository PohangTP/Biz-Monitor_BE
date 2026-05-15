@echo off
chcp 65001 > nul
setlocal EnableDelayedExpansion

echo.
echo ================================================
echo   PMS 부서 사업 관리 시스템 - 설치 스크립트
echo ================================================
echo.

:: ── 관리자 권한 확인 ──────────────────────────────
net session > nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] 관리자 권한으로 실행해 주세요.
    echo        이 파일을 우클릭 -^> "관리자 권한으로 실행"
    pause & exit /b 1
)

set "ROOT=%~dp0"
cd /d "%ROOT%"

:: ── 1. Python 확인 ────────────────────────────────
echo [1/5] Python 확인 중...
python --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [오류] Python이 설치되어 있지 않습니다.
    echo        https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하세요.
    pause & exit /b 1
)
for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo        Python %PY_VER% 확인됨

:: ── 2. 가상환경 생성 및 패키지 설치 ─────────────────
echo.
echo [2/5] 가상환경 설정 중...
if exist venv (
    echo        기존 venv 폴더 감지 — 재사용합니다.
) else (
    python -m venv venv
    echo        venv 생성 완료
)

echo        패키지 설치 중 (잠시 기다려 주세요)...
venv\Scripts\pip.exe install -r requirements.txt -q
if %errorlevel% neq 0 (
    echo [오류] 패키지 설치 실패. 인터넷 연결을 확인하세요.
    pause & exit /b 1
)
echo        패키지 설치 완료

:: ── 3. .env 설정 ──────────────────────────────────
echo.
echo [3/5] 환경 변수 설정...
if exist .env (
    echo        .env 파일이 이미 존재합니다. 기존 설정을 유지합니다.
    echo        (변경이 필요하면 .env 파일을 직접 수정하세요)
) else (
    copy .env.example .env > nul
    echo.
    echo        ** DB 연결 정보를 입력하세요 **
    echo        형식: mysql+pymysql://사용자:비밀번호@호스트:3306/DB명
    echo        예시: mysql+pymysql://root:1234@localhost:3306/pms_db
    echo.
    set /p DB_URL="        DB_URL 입력: "
    echo DB_URL=!DB_URL!> .env
    echo.>> .env
    echo # 서버 포트 (기본값 사용 시 주석 유지)>> .env
    echo # BACKEND_PORT=8000>> .env
    echo # FRONTEND_PORT=5500>> .env
    echo        .env 파일 생성 완료
)

:: ── 4. DB 연결 테스트 ─────────────────────────────
echo.
echo [4/5] DB 연결 테스트...
venv\Scripts\python.exe -c "
import os, sys
from dotenv import load_dotenv
load_dotenv()
url = os.environ.get('DB_URL','')
if not url:
    print('  [오류] DB_URL이 설정되지 않았습니다.')
    sys.exit(1)
try:
    import sqlalchemy
    engine = sqlalchemy.create_engine(url)
    with engine.connect() as c:
        c.execute(sqlalchemy.text('SELECT 1'))
    print('  DB 연결 성공')
except Exception as e:
    print(f'  [오류] DB 연결 실패: {e}')
    print('  .env 파일의 DB_URL을 확인하세요.')
    sys.exit(1)
"
if %errorlevel% neq 0 (
    echo.
    echo        .env 파일을 열어 DB_URL을 수정한 뒤 install.bat을 다시 실행하세요.
    pause & exit /b 1
)

:: ── 5. 작업 스케줄러 등록 ────────────────────────
echo.
echo [5/5] Windows 시작 시 자동 실행 등록...
set "TASK_NAME=PMS_FastAPI_Server"
schtasks /delete /tn "%TASK_NAME%" /f > nul 2>&1
schtasks /create /tn "%TASK_NAME%" /tr "cmd.exe /c \"%ROOT%start-server.bat\"" /sc ONLOGON /ru "%USERNAME%" /rl HIGHEST /f > nul
if %errorlevel% equ 0 (
    echo        작업 스케줄러 등록 완료
) else (
    echo        [경고] 작업 스케줄러 등록 실패 — 수동으로 start-server.bat을 실행하세요.
)

:: ── 완료 ──────────────────────────────────────────
echo.
echo ================================================
echo   설치 완료!
echo ================================================
echo.
echo   서버 시작:  start-server.bat 실행
echo   프론트엔드: http://[이 PC의 IP]:5500
echo   백엔드 API: http://[이 PC의 IP]:8000
echo   API 명세서: http://[이 PC의 IP]:8000/docs
echo.
echo   PC 재시작 시 자동으로 서버가 실행됩니다.
echo.

set /p START_NOW="지금 바로 서버를 시작할까요? (Y/N): "
if /i "!START_NOW!"=="Y" (
    start "" "%ROOT%start-server.bat"
)

pause
