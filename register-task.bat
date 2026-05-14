@echo off
:: PMS 서버 자동 시작 — Windows 작업 스케줄러 등록
:: 관리자 권한으로 실행하세요 (우클릭 → 관리자 권한으로 실행)

:: 현재 스크립트 폴더를 기준으로 start-server.bat 경로 설정
set "SCRIPT_PATH=%~dp0start-server.bat"
set "TASK_NAME=PMS_FastAPI_Server"

echo [PMS] 작업 스케줄러에 자동 시작 작업을 등록합니다...
echo 작업 이름: %TASK_NAME%
echo 스크립트:  %SCRIPT_PATH%
echo.

:: 기존 작업이 있으면 삭제
schtasks /delete /tn "%TASK_NAME%" /f 2>nul

:: 로그온 시 자동 실행으로 등록 (현재 사용자, 창 숨김)
schtasks /create ^
  /tn "%TASK_NAME%" ^
  /tr "cmd.exe /c \"%SCRIPT_PATH%\"" ^
  /sc ONLOGON ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

if %errorlevel% equ 0 (
    echo.
    echo [완료] 작업 스케줄러 등록 성공!
    echo PC를 재시작하면 로그인 시 FastAPI 서버가 자동으로 실행됩니다.
) else (
    echo.
    echo [오류] 등록 실패. 관리자 권한으로 다시 실행하세요.
)

pause
