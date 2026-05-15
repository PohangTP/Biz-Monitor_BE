# -*- coding: utf-8 -*-
import os, sys, subprocess, ctypes
from pathlib import Path

ROOT = Path(__file__).parent
os.chdir(ROOT)

def title(msg):
    print("\n" + "=" * 50)
    print(f"  {msg}")
    print("=" * 50)

def step(n, msg):
    print(f"\n[{n}/5] {msg}")

def ok(msg="Done."):
    print(f"      OK: {msg}")

def err(msg):
    print(f"\n  [ERROR] {msg}")

# ── 관리자 권한 확인 ──────────────────────────────
def is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except:
        return False

title("PMS Install")
print(f"  경로: {ROOT}")

if not is_admin():
    err("관리자 권한이 필요합니다.")
    print("         install.bat 을 우클릭 → 관리자 권한으로 실행 하세요.")
    sys.exit(1)

# ── 1. Python 버전 확인 ───────────────────────────
step(1, "Python 확인...")
v = sys.version_info
print(f"      Python {v.major}.{v.minor}.{v.micro}")
if v.major < 3 or (v.major == 3 and v.minor < 10):
    err("Python 3.10 이상이 필요합니다.")
    sys.exit(1)
ok()

# ── 2. venv + 패키지 설치 ────────────────────────
step(2, "가상환경 설정...")
venv_dir = ROOT / "venv"
python_exe = venv_dir / "Scripts" / "python.exe"
pip_exe    = venv_dir / "Scripts" / "pip.exe"

if not venv_dir.exists():
    print("      venv 생성 중...")
    subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
    ok("venv 생성 완료")
else:
    ok("기존 venv 재사용")

print("      패키지 설치 중 (잠시 기다려 주세요)...")
result = subprocess.run([str(pip_exe), "install", "-r", "requirements.txt", "-q"])
if result.returncode != 0:
    err("패키지 설치 실패. 인터넷 연결을 확인하세요.")
    sys.exit(1)
ok("패키지 설치 완료")

# ── 3. .env 설정 ──────────────────────────────────
step(3, ".env 설정...")
env_file = ROOT / ".env"

if env_file.exists():
    ok(".env 파일이 이미 있습니다. 기존 설정 유지.")
else:
    print()
    print("      DB 연결 정보를 입력하세요.")
    print("      형식  : mysql+pymysql://사용자:비밀번호@호스트:3306/DB명")
    print("      예시  : mysql+pymysql://root:1234@localhost:3306/pms_db")
    print()
    db_url = input("      DB_URL: ").strip()
    if not db_url:
        err("DB_URL을 입력해야 합니다.")
        sys.exit(1)
    env_file.write_text(
        f"DB_URL={db_url}\n"
        "# BACKEND_PORT=8000\n"
        "# FRONTEND_PORT=5500\n",
        encoding="utf-8"
    )
    ok(".env 파일 생성 완료")

# ── 4. DB 연결 테스트 ─────────────────────────────
step(4, "DB 연결 테스트...")
result = subprocess.run([str(python_exe), str(ROOT / "install_check.py")])
if result.returncode != 0:
    err(".env 파일의 DB_URL을 확인하고 다시 실행하세요.")
    sys.exit(1)

# ── 5. 작업 스케줄러 등록 ────────────────────────
step(5, "PC 시작 시 자동 실행 등록...")
bat_path = str(ROOT / "start-server.bat")
result = subprocess.run([
    "schtasks", "/create",
    "/tn", "PMS_FastAPI_Server",
    "/tr", f'cmd.exe /c "{bat_path}"',
    "/sc", "ONLOGON",
    "/rl", "HIGHEST",
    "/f"
], capture_output=True)
if result.returncode == 0:
    ok("자동 실행 등록 완료")
else:
    print("      [주의] 등록 실패 — start-server.bat 을 수동으로 실행하세요.")

# ── 완료 ──────────────────────────────────────────
title("설치 완료!")
print("  서버 시작  : start-server.bat 실행")
print("  프론트엔드 : http://[이 PC의 IP]:5500")
print("  백엔드 API : http://[이 PC의 IP]:8000/docs")
print()
ans = input("  지금 바로 서버를 시작할까요? (Y/N): ").strip().upper()
if ans == "Y":
    subprocess.Popen([str(ROOT / "start-server.bat")], shell=True)
