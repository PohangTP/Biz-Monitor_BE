import os
import bcrypt
import shutil
import uuid as _uuid
from pathlib import Path
from fastapi import FastAPI, Depends, UploadFile, File, Form
from fastapi import Body
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import json
from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Table, BigInteger, Numeric, DateTime, Text, Boolean, and_, or_
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, date, timedelta
from dotenv import load_dotenv

# 서버 시동 명령어 (터미널에서 실행하세요!):
# uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# 1. .env 로드 → MySQL 연결 설정 (DB 비밀번호 등은 .env 파일에 두고 git에서 제외)
load_dotenv()
DB_URL = os.environ.get("DB_URL")
if not DB_URL:
    raise RuntimeError(
        "환경변수 DB_URL이 설정되지 않았습니다. .env 파일을 만들고 DB_URL=... 을 추가하세요. "
        "예시는 .env.example 참고."
    )

engine = create_engine(DB_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 🚀 유저-사업 참여 정보 (한 사람이 같은 사업에 여러 기간 행 보유 가능)
class UserProject(Base):
    __tablename__ = "user_projects"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    project_id = Column(String(50), ForeignKey("projects.id"), nullable=False, index=True)
    rate       = Column(Numeric(5, 2), default=0)                          # 참여율 % (소수점 2자리)
    role       = Column(String(20), nullable=False, default="참여연구원")  # 총괄책임자/실무책임자/참여연구원
    start_date = Column(String(20), nullable=True)                         # "2026-01-01"
    end_date   = Column(String(20), nullable=True)                         # "2026-12-31"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user    = relationship("User",    back_populates="project_assignments")
    project = relationship("Project", back_populates="user_assignments")

# ==========================================
# 2. [업그레이드 됨!] 데이터베이스 테이블 설계도
# ==========================================
class Team(Base):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False)
    users = relationship("User", back_populates="team")
    projects = relationship("Project", back_populates="team")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True)
    password = Column(String(100))  # 👈 비밀번호 추가!
    name = Column(String(50))
    team_id = Column(Integer, ForeignKey("teams.id"))
    role = Column(String(20), default="member")
    # 🚀 [추가] 이메일과 담당 업무 컬럼을 추가합니다.
    email = Column(String(100), nullable=True) # 선택 입력이므로 nullable=True
    pos = Column(String(100), nullable=True)   # 담당 업무 (Position)
    # 🚀 [신규 추가] 직책(팀장, 선임 등)을 저장할 진짜 전용 공간!
    job_title = Column(String, default="")
    # 프로필 이미지 — 상대 경로 (예: profile/12/abc_avatar.png). 없으면 NULL → 텍스트 이니셜 fallback
    profile_image = Column(String(500), nullable=True)
    # 가입 일시 — 대시보드 활동 피드용. 기존 사용자는 NULL (피드에서 제외)
    created_at = Column(DateTime, nullable=True, default=datetime.utcnow)
    team = relationship("Team", back_populates="users")
    project_assignments = relationship("UserProject", back_populates="user", cascade="all, delete-orphan")

class Project(Base):
    __tablename__ = "projects"
    id = Column(String(50), primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    icon = Column(String(10))
    status = Column(String(20))
    progress = Column(Integer, default=0)
    
    start_date = Column(String(50), nullable=True)
    end_date = Column(String(50), nullable=True)
    desc = Column(String(500), nullable=True)
    agency = Column(String(100), nullable=True)
    host = Column(String(100), nullable=True)
    local_gov = Column(String(100), nullable=True)
    partners = Column(String(2000), nullable=True)  # 참여기관 (콤마 구분 문자열)
    pm_name = Column(String(100), nullable=True)    # 사업 담당자 (종합 대시보드 hd-pm)
    
    # 🔥 사업비 컬럼: 중복 제거 및 Integer(숫자)로 완벽 통일!
    gov_fund = Column(BigInteger, default=0)
    local_fund = Column(BigInteger, default=0)
    etc_fund = Column(BigInteger, default=0)
    total_budget = Column(BigInteger, default=0)

    # 사업별 예산 상세(BUDGET_ITEMS)·집행(EXEC_DATA) JSON — 이전엔 iframe 내부 localStorage였음
    budget_data = Column(Text, nullable=True)
    # 사업별 담당자 연락처 (Partner 기관별 contact list) JSON
    contacts_data = Column(Text, nullable=True)
    # WBS / TODO JSON — Phase 3-A. 예산과 동일한 bulk 패턴
    wbs_data    = Column(Text, nullable=True)
    todos_data  = Column(Text, nullable=True)
    # 리스크 / 대응 / 산출물 JSON — Phase 3-A에서 컬럼 추가 + 신규 사업 시드, 화면 연동은 Phase 3-B
    risks_data        = Column(Text, nullable=True)
    resp_data         = Column(Text, nullable=True)
    deliverables_data = Column(Text, nullable=True)

    created_at = Column(String(50), nullable=True)
    
    team_id = Column(Integer, ForeignKey("teams.id"))
    team = relationship("Team", back_populates="projects")
    user_assignments = relationship("UserProject", back_populates="project", cascade="all, delete-orphan")

# Project.wbs_data / todos_data 컬럼은 폐기 (deprecated) — Phase 3-A에서 별도 테이블(Wbs/Todo)로 전환됨.
# 컬럼 자체는 ALTER DROP하기보단 NULL로 두고 향후 정리.

# ==========================================
# WBS — 사업별 작업 분할 (계층 구조)
# ==========================================
class Wbs(Base):
    __tablename__ = "wbs_items"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    project_id  = Column(String(50), ForeignKey("projects.id"), nullable=False, index=True)
    wbs_id      = Column(String(50))           # 계층 코드 "1.1.1"
    level       = Column(Integer, default=1)
    name        = Column(String(300), nullable=False)
    color       = Column(String(20), nullable=True)
    start_date  = Column(String(20), nullable=True)
    end_date    = Column(String(20), nullable=True)
    status      = Column(String(20), default="notstart")   # notstart / progress / done
    assignee    = Column(String(100), nullable=True)
    manual_pct  = Column(Integer, nullable=True)            # 수동 진행율 override
    position    = Column(Integer, default=0)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", foreign_keys=[project_id])

# ==========================================
# ToDo — 사업별 To-Do (WBS 항목별 또는 사용자 정의 대분류)
# ==========================================
class Todo(Base):
    __tablename__ = "todos"
    id              = Column(Integer, primary_key=True, autoincrement=True)
    project_id      = Column(String(50), ForeignKey("projects.id"), nullable=False, index=True)
    wbs_id          = Column(Integer, ForeignKey("wbs_items.id"), nullable=True, index=True)
    custom_group    = Column(String(150), nullable=True)   # WBS 무관 사용자 정의 대분류
    title           = Column(String(500), nullable=False)
    done            = Column(Boolean, default=False)
    priority        = Column(String(10), default="med")    # high / med / low
    assignee        = Column(String(100), nullable=True)
    due_date        = Column(String(20), nullable=True)
    tag             = Column(String(50), nullable=True)
    linked_risk_id  = Column(String(20), nullable=True)    # 리스크 ID "T-01" 등 (Phase 3-B 연결용)
    position        = Column(Integer, default=0)
    reported_at     = Column(DateTime, nullable=True)
    reported_task_id= Column(Integer, ForeignKey("tasks.id"), nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project", foreign_keys=[project_id])
    wbs     = relationship("Wbs",     foreign_keys=[wbs_id])
    task    = relationship("Task",    foreign_keys=[reported_task_id])

# ==========================================
# 비정기 업무(Task) — 부서장/팀장이 팀원에게 배정하는 단발성 업무
# ==========================================
class Task(Base):
    __tablename__ = "tasks"
    id           = Column(Integer, primary_key=True, index=True)
    title        = Column(String(200), nullable=False)
    description  = Column(String(1000), nullable=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # 배정한 사람
    assignee_id  = Column(Integer, ForeignKey("users.id"), nullable=False) # 담당자
    project_id   = Column(String(50), ForeignKey("projects.id"), nullable=True)  # 연관 사업(선택)
    due_date     = Column(String(20), nullable=True)
    priority     = Column(String(10), default="med")  # high / med / low
    status       = Column(String(20), default="진행중")  # 진행중 / 완료 / 지연
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    requester = relationship("User", foreign_keys=[requester_id])
    assignee  = relationship("User", foreign_keys=[assignee_id])
    project   = relationship("Project", foreign_keys=[project_id])

# ==========================================
# 보고서(Report) — 부서장→팀장→팀원 위→아래 요청 워크플로우
# ==========================================
class Report(Base):
    __tablename__ = "reports"
    id            = Column(Integer, primary_key=True, index=True)
    requester_id  = Column(Integer, ForeignKey("users.id"), nullable=False)  # 요청자(위)
    target_id     = Column(Integer, ForeignKey("users.id"), nullable=False)  # 대상자(아래)
    title         = Column(String(200), nullable=False)
    description   = Column(String(2000), nullable=True)
    due_date      = Column(String(20), nullable=True)
    status        = Column(String(20), default="요청")   # 요청 / 제출 / 승인 / 반려
    reject_reason = Column(String(1000), nullable=True)
    submitted_at  = Column(DateTime, nullable=True)
    reviewed_at   = Column(DateTime, nullable=True)
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    requester = relationship("User", foreign_keys=[requester_id])
    target    = relationship("User", foreign_keys=[target_id])
    files     = relationship("ReportFile", back_populates="report", cascade="all, delete-orphan")

class ReportFile(Base):
    __tablename__ = "report_files"
    id                = Column(Integer, primary_key=True, index=True)
    report_id         = Column(Integer, ForeignKey("reports.id"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_path       = Column(String(500), nullable=False)
    file_size         = Column(BigInteger, default=0)
    uploaded_by       = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at       = Column(DateTime, default=datetime.utcnow)

    report   = relationship("Report", back_populates="files")
    uploader = relationship("User", foreign_keys=[uploaded_by])

# ==========================================
# 공지사항(Notice) — 팀장/부서장/관리자가 게시, 모두 조회
# ==========================================
class Notice(Base):
    __tablename__ = "notices"
    id          = Column(Integer, primary_key=True, index=True)
    title       = Column(String(200), nullable=False)
    content     = Column(Text, nullable=True)
    important   = Column(Boolean, default=False)
    created_by  = Column(Integer, ForeignKey("users.id"), nullable=True)
    # target_team_id NULL = 전체 공지 (모든 팀에 표시), 값 있음 = 그 팀에만 표시
    # sysadmin/admin이 작성하면 NULL, leader/member가 작성하면 본인 팀 ID
    target_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    view_count  = Column(Integer, default=0)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    creator     = relationship("User", foreign_keys=[created_by])
    target_team = relationship("Team", foreign_keys=[target_team_id])
    files       = relationship("NoticeFile", back_populates="notice", cascade="all, delete-orphan")

class NoticeFile(Base):
    __tablename__ = "notice_files"
    id                = Column(Integer, primary_key=True, index=True)
    notice_id         = Column(Integer, ForeignKey("notices.id"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_path       = Column(String(500), nullable=False)
    file_size         = Column(BigInteger, default=0)
    uploaded_by       = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at       = Column(DateTime, default=datetime.utcnow)

    notice   = relationship("Notice", back_populates="files")
    uploader = relationship("User", foreign_keys=[uploaded_by])

# ==========================================
# 게시판(BoardPost) — 모든 role 작성/조회, 작성자만 삭제, 파일 첨부 가능
# ==========================================
class BoardPost(Base):
    __tablename__ = "board_posts"
    id          = Column(Integer, primary_key=True, index=True)
    title       = Column(String(200), nullable=False)
    content     = Column(Text, nullable=True)
    author_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    # target_team_id NULL = 전체 게시판, 값 있음 = 그 팀 게시판
    target_team_id = Column(Integer, ForeignKey("teams.id"), nullable=True)
    view_count  = Column(Integer, default=0)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    author      = relationship("User", foreign_keys=[author_id])
    target_team = relationship("Team", foreign_keys=[target_team_id])
    files       = relationship("BoardFile", back_populates="post", cascade="all, delete-orphan")

class BoardFile(Base):
    __tablename__ = "board_files"
    id                = Column(Integer, primary_key=True, index=True)
    post_id           = Column(Integer, ForeignKey("board_posts.id"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_path       = Column(String(500), nullable=False)
    file_size         = Column(BigInteger, default=0)
    uploaded_by       = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at       = Column(DateTime, default=datetime.utcnow)

    post     = relationship("BoardPost", back_populates="files")
    uploader = relationship("User", foreign_keys=[uploaded_by])

# ==========================================
# 건의사항(FeedbackPost) — 모든 role 작성, 관리자만 전체 조회
# ==========================================
class FeedbackPost(Base):
    __tablename__ = "feedback_posts"
    id          = Column(Integer, primary_key=True, index=True)
    title       = Column(String(200), nullable=False)
    content     = Column(Text, nullable=True)
    author_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    author  = relationship("User", foreign_keys=[author_id])
    files   = relationship("FeedbackFile", back_populates="post", cascade="all, delete-orphan")

class FeedbackFile(Base):
    __tablename__ = "feedback_files"
    id                = Column(Integer, primary_key=True, index=True)
    post_id           = Column(Integer, ForeignKey("feedback_posts.id"), nullable=False, index=True)
    original_filename = Column(String(255), nullable=False)
    stored_path       = Column(String(500), nullable=False)
    file_size         = Column(BigInteger, default=0)
    uploaded_by       = Column(Integer, ForeignKey("users.id"), nullable=False)
    uploaded_at       = Column(DateTime, default=datetime.utcnow)

    post     = relationship("FeedbackPost", back_populates="files")
    uploader = relationship("User", foreign_keys=[uploaded_by])

# ==========================================
# [추가] 로그인 및 회원가입 스키마
# ==========================================
class RegisterRequest(BaseModel):
    username: str
    password: str
    name: str
    team_name: str
    role: str
    # 🚀 [추가] 선택 입력 항목들을 추가합니다. 기본값을 빈 문자열("")로 설정합니다.
    email: Optional[str] = ""
    pos: Optional[str] = ""

class LoginRequest(BaseModel):
    username: str
    password: str

# ==========================================
# 3. 데이터 검증 규칙 (Pydantic 스키마)
# ==========================================
class ProjectCreate(BaseModel):
    # 🔴 [필수 항목] 기본값이 없는 항목들을 맨 위에 배치합니다!
    id: str
    name: str
    team_name: str # 👈 프론트에서 넘어오는 팀 이름
    
    # 🔵 [선택 항목] 기본값이 있는 항목들을 그 아래에 배치합니다!
    icon: Optional[str] = "📊"
    status: Optional[str] = ""
    progress: Optional[int] = 0
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    desc: Optional[str] = ""
    agency: Optional[str] = ""
    host: Optional[str] = ""
    localGov: Optional[str] = ""
    partners: Optional[list] = []  # 참여기관 배열
    
    # 🔥 사업비 규칙: 중복 제거 및 int(숫자)로 통일!
    govFund: Optional[int] = 0
    localFund: Optional[int] = 0
    etcFund: Optional[int] = 0
    totalBudget: Optional[int] = 0
    
    createdAt: Optional[str] = ""
    
# Execution 테이블/스키마는 2.5 사업비 합산 개편에서 제거됐다.
# 집행 내역은 각 사업의 budget_data(JSON)에서 항목별로 관리됨 — /projects/{id}/budget 참조.

# 🚀 1. 유저 팀 변경을 위한 데이터 모델
class UserTeamUpdate(BaseModel):
    team_name: str

# 🚀 직책 업데이트용 데이터 모델
class UserJobTitleUpdate(BaseModel):
    job_title: str

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ==========================================
# 4. 서버 실행 및 API 통로 만들기
# ==========================================
Base.metadata.create_all(bind=engine) # 지웠던 테이블을 16칸짜리로 새로 만듭니다!

# ==========================================
# 5. DB 마이그레이션 헬퍼 — 모델만 바꿔도 실DB가 자동으로 따라오게
# ==========================================
def _migrate_schema():
    """
    Phase 3-A에서 추가/제거된 컬럼들을 실제 DB에도 반영한다.
    create_all()은 누락된 *테이블*만 만들고 *컬럼*은 안 만지므로 수동 ALTER가 필요.
    매 시작마다 실행돼도 안전 (INFORMATION_SCHEMA로 사전 체크)
    """
    from sqlalchemy import text
    with engine.begin() as conn:
        # DB 이름 (FROM information_schema 쿼리에서 사용)
        db_name_row = conn.execute(text("SELECT DATABASE()")).fetchone()
        db_name = db_name_row[0] if db_name_row else None
        if not db_name:
            return

        def has_column(table, col):
            r = conn.execute(text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_schema=:s AND table_name=:t AND column_name=:c"
            ), {"s": db_name, "t": table, "c": col}).fetchone()
            return bool(r)

        # 1) projects.wbs_data / todos_data / risks_data / resp_data / deliverables_data 모두 추가 보장
        for col in ("wbs_data", "todos_data", "risks_data", "resp_data", "deliverables_data"):
            if not has_column("projects", col):
                conn.execute(text(f"ALTER TABLE projects ADD COLUMN {col} LONGTEXT NULL"))
                print(f"[migrate] ADD projects.{col}")
            else:
                # 이미 있으면 LONGTEXT로 확장 (기존 Text 한계 회피)
                try:
                    conn.execute(text(f"ALTER TABLE projects MODIFY COLUMN {col} LONGTEXT NULL"))
                except Exception:
                    pass

        # 1.5) projects.pm_name (사업 담당자) 추가
        if not has_column("projects", "pm_name"):
            conn.execute(text("ALTER TABLE projects ADD COLUMN pm_name VARCHAR(100) NULL"))
            print("[migrate] ADD projects.pm_name")

        # 3) users.status 컬럼 제거 (Phase 3-A 결정)
        if has_column("users", "status"):
            conn.execute(text("ALTER TABLE users DROP COLUMN status"))
            print("[migrate] DROP users.status")

        # 4) users.created_at — 이미 있어도 무방
        if not has_column("users", "created_at"):
            conn.execute(text("ALTER TABLE users ADD COLUMN created_at DATETIME NULL"))
            print("[migrate] ADD users.created_at")

try:
    _migrate_schema()
except Exception as e:
    print(f"[migrate] WARN: {e}")

# ==========================================
# Pydantic Response 모델 (Swagger 문서용)
# ==========================================

class FileOut(BaseModel):
    id: int
    original_filename: str
    stored_path: str
    file_size: Optional[int] = None
    uploaded_at: Optional[str] = None
    download_url: str

class UserOut(BaseModel):
    id: int
    username: str
    name: str
    role: str
    team_name: str
    pos: str
    email: str
    job_title: str
    profile_image: str
    profile_image_url: str

class LoginOut(BaseModel):
    id: int
    username: str
    name: str
    role: str
    team_name: str
    pos: str
    email: str
    job_title: str
    profile_image: str
    profile_image_url: str

class TeamOut(BaseModel):
    id: int
    name: str

class ProjectOut(BaseModel):
    id: str
    name: str
    icon: Optional[str] = None
    status: Optional[str] = None
    progress: int
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    desc: Optional[str] = None
    agency: Optional[str] = None
    host: Optional[str] = None
    local_gov: Optional[str] = None
    partners: List[str] = []
    pm_name: Optional[str] = None
    gov_fund: Optional[int] = None
    local_fund: Optional[int] = None
    etc_fund: Optional[int] = None
    total_budget: Optional[int] = None
    team_name: Optional[str] = None

class TaskOut(BaseModel):
    id: int
    title: str
    description: str
    requester_id: Optional[int] = None
    requester_name: Optional[str] = None
    requester_username: Optional[str] = None
    assignee_id: Optional[int] = None
    assignee_name: Optional[str] = None
    assignee_username: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    project_icon: Optional[str] = None
    due_date: Optional[str] = None
    priority: str
    status: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class AssignmentOut(BaseModel):
    id: int
    user_id: int
    user_name: Optional[str] = None
    username: Optional[str] = None
    project_id: str
    project_name: Optional[str] = None
    project_icon: Optional[str] = None
    rate: float
    role: str
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class ReportOut(BaseModel):
    id: int
    requester_id: int
    requester_name: str
    requester_username: str
    target_id: int
    target_name: str
    target_username: str
    title: str
    description: str
    due_date: str
    status: str
    reject_reason: str
    submitted_at: Optional[str] = None
    reviewed_at: Optional[str] = None
    created_at: Optional[str] = None
    files: List[FileOut] = []

class NoticeOut(BaseModel):
    id: int
    title: str
    content: str
    important: bool
    created_by: int
    creator_name: str
    creator_username: str
    creator_role: str
    target_team_id: Optional[int] = None
    target_team_name: Optional[str] = None
    view_count: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    files: List[FileOut] = []

class BoardPostOut(BaseModel):
    id: int
    title: str
    content: str
    author_id: int
    author_name: str
    author_username: str
    author_role: str
    target_team_id: Optional[int] = None
    target_team_name: Optional[str] = None
    view_count: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    files: List[FileOut] = []

class FeedbackFileOut(BaseModel):
    id: int
    original_filename: str
    file_size: Optional[int] = None
    download_url: str

class FeedbackPostOut(BaseModel):
    id: int
    title: str
    content: str
    author_id: int
    author_name: str
    author_username: str
    author_role: str
    created_at: Optional[str] = None
    files: List[FeedbackFileOut] = []

# ==========================================

app = FastAPI(
    title="PMS 사업 관리 시스템 API",
    description=(
        "부서 사업 관리 플랫폼 백엔드 API.\n\n"
        "**인증**: 현재 `actor_username` 쿼리 파라미터/바디로 호출자를 식별합니다. "
        "외부망 배포 전 JWT 토큰 기반으로 교체 예정.\n\n"
        "**역할**: `sysadmin` > `admin` > `leader` > `member`"
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def _serialize_project(p: Project) -> dict:
    """Project ORM 객체 → dict (모든 컬럼 + team_name + partners 배열)"""
    d = {c.name: getattr(p, c.name) for c in p.__table__.columns}
    d["team_name"] = p.team.name if p.team else None
    d["partners"] = [s.strip() for s in (p.partners or "").split(",") if s.strip()]
    return d

@app.get("/projects", tags=["projects"], summary="전체 사업 목록 조회", response_model=List[ProjectOut])
def get_projects(db: Session = Depends(get_db)):
    return [_serialize_project(p) for p in db.query(Project).all()]

# '우리 팀' 프로젝트만 조회. 응답 형태는 /projects와 동일 (프론트가 그대로 사용)
@app.get("/teams/{team_name}/projects", tags=["projects"], summary="특정 팀의 사업 목록 조회", response_model=List[ProjectOut])
def get_team_projects(team_name: str, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.name == team_name).first()
    if not team:
        return []
    return [_serialize_project(p) for p in team.projects]

# 🚀 [추가 확인] ProjectCreate 모델에 team_name이 들어갈 자리가 있어야 합니다!
# (기존 ProjectCreate 클래스 맨 아래에 아래 한 줄을 꼭 추가해 주세요)
# team_name: str 

def _seed_default_project_data(db: Session, project_id: str):
    """
    신규 사업 생성 직후 호출 — 디폴트 시드 (WBS 146개 + ToDo + Risks 16개 + Resp 5개)를
    Project의 JSON 컬럼 (wbs_data / todos_data / risks_data / resp_data)에 그대로 직렬화.
    실패해도 사업 생성 자체는 막지 않도록 try/except로 감싼다.
    """
    try:
        from default_seeds import (
            DEFAULT_WBS_ITEMS, DEFAULT_TODOS_BY_WBS,
            DEFAULT_RISKS, DEFAULT_RESPONSES,
        )
    except Exception as e:
        print(f"[seed] default_seeds import failed: {e}")
        return

    proj = db.query(Project).filter(Project.id == project_id).one_or_none()
    if proj is None:
        return

    proj.wbs_data   = json.dumps(DEFAULT_WBS_ITEMS,    ensure_ascii=False)
    proj.todos_data = json.dumps(DEFAULT_TODOS_BY_WBS, ensure_ascii=False)
    proj.risks_data = json.dumps(DEFAULT_RISKS,        ensure_ascii=False)
    proj.resp_data  = json.dumps(DEFAULT_RESPONSES,    ensure_ascii=False)
    db.commit()

    # WBS 평균 → Project.progress 반영
    _recalc_project_progress(db, project_id); db.commit()

    n_todos = sum(len(v) for v in DEFAULT_TODOS_BY_WBS.values() if isinstance(v, list))
    print(f"[seed] {project_id}: wbs={len(DEFAULT_WBS_ITEMS)}, todos={n_todos}, "
          f"risks={len(DEFAULT_RISKS)}, resp={len(DEFAULT_RESPONSES)}")


@app.post("/projects", tags=["projects"], summary="신규 사업 생성")
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    # 1. 프론트엔드에서 넘어온 팀 이름으로 DB에서 실제 팀을 찾습니다.
    team = db.query(Team).filter(Team.name == project.team_name).first()

    if not team:
        raise HTTPException(status_code=404, detail=f"'{project.team_name}' 팀을 찾을 수 없습니다.")

    # 2. 새 프로젝트 생성 (선생님의 기존 상세 정보 + 팀 ID 연결)
    new_project = Project(
        id=project.id,
        name=project.name,
        icon=project.icon,
        status=project.status,
        progress=project.progress,
        start_date=project.startDate,
        end_date=project.endDate,
        desc=project.desc,
        agency=project.agency,
        host=project.host,
        local_gov=project.localGov,
        partners=', '.join(v for v in (project.partners or []) if v),
        gov_fund=project.govFund,
        local_fund=project.localFund,
        etc_fund=project.etcFund,
        total_budget=project.totalBudget,
        created_at=project.createdAt,

        # 🚀 [핵심 추가] 찾은 팀의 고유 ID를 프로젝트에 꼬리표로 달아줍니다!
        team_id=team.id
    )

    db.add(new_project)
    db.commit()

    # 3. 디폴트 시드 — WBS/ToDo/리스크/대응을 신규 사업에 자동 등록
    try:
        _seed_default_project_data(db, new_project.id)
    except Exception as e:
        # 시드 실패 시에도 사업은 살려둠 (수동 보강 가능)
        print(f"[seed] failed for {new_project.id}: {e}")

    return {"message": f"'{project.name}' 프로젝트가 {project.team_name}에 성공적으로 저장되었습니다!"}

@app.put("/projects/{project_id}", tags=["projects"], summary="사업 정보 수정")
def update_project(project_id: str, project_data: dict = Body(...), db: Session = Depends(get_db)):
    # 1. DB에서 수정할 프로젝트를 ID로 찾습니다.
    db_project = db.query(Project).filter(Project.id == project_id).first()
    
    if not db_project:
        return {"error": "프로젝트를 찾을 수 없습니다."}
    
    # 2. 프론트엔드의 이름(카멜케이스)을 파이썬 DB의 이름(스네이크케이스)으로 연결하는 맵
    field_mapping = {
        "startDate": "start_date", "endDate": "end_date",
        "localGov": "local_gov", "govFund": "gov_fund",
        "localFund": "local_fund", "etcFund": "etc_fund",
        "totalBudget": "total_budget", "createdAt": "created_at"
    }

    # 3. 프론트엔드에서 넘어온 새로운 값으로 DB의 칸을 덮어씁니다.
    for key, value in project_data.items():
        # 담당 팀 변경: team_name → team_id 변환
        if key == "team_name":
            if not value:
                continue
            team = db.query(Team).filter(Team.name == value).first()
            if not team:
                raise HTTPException(status_code=404, detail=f"'{value}' 팀을 찾을 수 없습니다.")
            db_project.team_id = team.id
            continue
        # 참여기관 배열 → 콤마 문자열 변환
        if key == "partners":
            if isinstance(value, list):
                db_project.partners = ', '.join(v for v in value if v)
            elif isinstance(value, str):
                db_project.partners = value
            continue
        db_key = field_mapping.get(key, key) # 매핑된 이름이 있으면 그걸 쓰고, 없으면 그대로 씀
        if hasattr(db_project, db_key):
            setattr(db_project, db_key, value)
            
    db.commit() # 변경사항 저장 도장 쾅!
    return {"message": f"'{project_id}' 프로젝트가 성공적으로 수정되었습니다!"}

# ==========================================
# 프로젝트 삭제 API
# (구) executions 테이블 제거 후 — Project.budget_data(JSON)는 Project 삭제와 함께 자연 소멸
# ==========================================
@app.delete("/projects/{project_id}", tags=["projects"], summary="사업 삭제")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if db_project:
        db.delete(db_project)
    db.commit()
    
    return {"message": "프로젝트와 관련된 모든 내역이 삭제되었습니다."}

# /executions API는 2.5에서 제거됐다. 집행 내역은 /projects/{id}/budget의 budget_data JSON 안에서 관리됨.

from fastapi import HTTPException

# ==========================================
# [추가] 인증(Auth) 관련 API
# ==========================================
# User.role 4종 — 회원가입 가능한 role(leader/member)과 sysadmin이 승격할 수 있는 전체 role
# sysadmin = 시스템 관리자, admin = 부서장, leader = 팀장, member = 팀원
ALLOWED_REGISTER_ROLES   = {"leader", "member"}
ALLOWED_USER_ROLES       = {"sysadmin", "admin", "leader", "member"}
ADMIN_ROLES   = {"sysadmin", "admin"}                      # 전역 공지/게시판/건의 관리 권한
PROJECT_ROLES = {"총괄책임자", "실무책임자", "참여연구원"}   # 사업 참여 역할

def _require_sysadmin(actor_username: str, db: Session) -> User:
    """sysadmin 권한 검증. 임시 인증 — 외부망 배포 직전에 토큰 기반으로 교체 예정"""
    if not actor_username:
        raise HTTPException(status_code=401, detail="actor가 필요합니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor or actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="시스템 관리자만 수행할 수 있는 작업입니다.")
    return actor

@app.post("/auth/register", tags=["auth"], summary="회원가입 (leader/member만 가능)")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    # 0. role 화이트리스트 — 회원가입은 leader/member만 (sysadmin/admin은 관리자가 승격)
    if req.role not in ALLOWED_REGISTER_ROLES:
        raise HTTPException(status_code=400, detail=f"role은 {sorted(ALLOWED_REGISTER_ROLES)} 중 하나여야 합니다.")

    # 1. 아이디 중복 체크
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="이미 존재하는 아이디입니다.")

    # 2. 팀(부서) 확인 및 자동 생성
    team = db.query(Team).filter(Team.name == req.team_name).first()
    if not team:
        team = Team(name=req.team_name)
        db.add(team)
        db.commit()
        db.refresh(team)

    # 3. 유저 생성 — 비밀번호는 bcrypt로 해싱 (DB에는 평문이 저장되지 않음)
    password_hash = bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    new_user = User(
        username=req.username,
        password=password_hash,
        name=req.name,
        team_id=team.id,
        role=req.role,
        # 🚀 [추가] 전달받은 이메일과 담당 업무를 DB 모델에 넣어줍니다.
        email=req.email,
        pos=req.pos
    )
    db.add(new_user)
    db.commit()
    return {"message": "회원가입 성공"}

@app.post("/auth/login", tags=["auth"], summary="로그인")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")

    # bcrypt 해시 검증. 기존 평문 비밀번호로 저장된 계정은 더 이상 로그인 불가
    # (option C — 빈 DB 가정. 필요 시 회원가입으로 신규 생성).
    try:
        ok = bcrypt.checkpw(req.password.encode("utf-8"), user.password.encode("utf-8"))
    except (ValueError, AttributeError):
        # password 컬럼에 평문이 들어있으면 bcrypt가 ValueError를 냄 → 로그인 거부
        ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")

    # 🚀 [수정] 로그인 성공 시 사용자 정보 전체 반환 (profile_image 포함 — 로그아웃/로그인 후에도 아바타 유지)
    return {
        "message": "로그인 성공",
        "user": {
            "name": user.name,
            "username": user.username,
            "team_name": user.team.name if user.team else "미배정",
            "team_id": user.team_id,
            "role": user.role,
            "email": user.email or "",
            "pos": user.pos or "",
            "job_title": user.job_title or "",
            "profile_image": user.profile_image or "",
            "profile_image_url": (f"/files/{user.profile_image}" if user.profile_image else ""),
        }
    }

# ==========================================
# 사업 권한 부여 (팀장 → 팀원의 사업 접근 권한)
# ==========================================
class PermissionsRequest(BaseModel):
    project_ids: List[str]

@app.post("/users/{username}/permissions", tags=["users"], summary="사용자 사업 접근 권한 부여")
def grant_permissions(username: str, req: PermissionsRequest, db: Session = Depends(get_db)):
    """팀원에게 사업 권한 부여 (sync 방식 — 요청 목록에 없는 기존 권한은 제거)"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    requested = set(req.project_ids)
    existing = db.query(UserProject).filter(UserProject.user_id == user.id).all()
    existing_proj_ids = {a.project_id for a in existing}

    # 1) 삭제: 기존 권한 중 요청 목록에 없는 것
    for a in existing:
        if a.project_id not in requested:
            db.delete(a)

    # 2) 추가: 요청 목록 중 기존에 없는 것 (rate=0, role='참여연구원' 디폴트)
    added = 0
    for pid in requested - existing_proj_ids:
        if not db.query(Project).filter(Project.id == pid).first():
            continue  # 존재하지 않는 사업은 무시
        db.add(UserProject(
            user_id=user.id,
            project_id=pid,
            rate=0,
            role="참여연구원",
        ))
        added += 1

    db.commit()
    return {
        "message": "권한 업데이트 완료",
        "added": added,
        "removed": len(existing_proj_ids - requested),
        "total": len(requested),
    }

@app.delete("/users/{username}/permissions/{project_id}", tags=["users"], summary="사용자 사업 접근 권한 해제")
def revoke_permission(username: str, project_id: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다.")

    rows = db.query(UserProject).filter(
        UserProject.user_id == user.id,
        UserProject.project_id == project_id,
    ).all()
    for r in rows:
        db.delete(r)
    db.commit()
    return {"message": "권한 해제 완료", "deleted": len(rows)}

# ==========================================
# 사용자 role 변경 (admin 전용)
# ==========================================
class RoleChangeRequest(BaseModel):
    role: str

@app.put("/users/{username}/role", tags=["users"], summary="사용자 시스템 역할 변경 (sysadmin 전용)")
def change_user_role(
    username: str,
    req: RoleChangeRequest,
    actor: str = "",
    db: Session = Depends(get_db),
):
    """sysadmin이 다른 사용자의 role을 변경. actor는 query param으로 호출자 username."""
    actor_user = _require_sysadmin(actor, db)

    if req.role not in ALLOWED_USER_ROLES:
        raise HTTPException(status_code=400, detail=f"role은 {sorted(ALLOWED_USER_ROLES)} 중 하나여야 합니다.")

    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="대상 사용자를 찾을 수 없습니다.")

    # sysadmin이 자기 자신을 강등하는 것 방지 (시스템 잠김 방지)
    if target.username == actor_user.username and req.role != "sysadmin":
        raise HTTPException(status_code=400, detail="본인의 sysadmin 권한은 변경할 수 없습니다.")

    target.role = req.role
    db.commit()
    return {"message": f"{username}의 role이 {req.role}로 변경되었습니다.", "username": username, "role": req.role}

# 🚀 [추가] 팀 생성 시 사용할 데이터 모델
class TeamCreate(BaseModel):
    name: str

# 🚀 [추가] 1. 전체 팀 목록 조회 API
@app.get("/teams", tags=["teams"], summary="전체 팀 목록 조회", response_model=List[TeamOut])
def get_teams(db: Session = Depends(get_db)):
    teams = db.query(Team).all()
    # 팀 ID와 이름을 리스트로 반환합니다.
    return [{"id": t.id, "name": t.name} for t in teams]

# 🚀 [추가] 2. 신규 팀 추가 API
@app.post("/teams", tags=["teams"], summary="팀 생성")
def create_team(req: TeamCreate, db: Session = Depends(get_db)):
    # 중복 팀명 체크
    existing = db.query(Team).filter(Team.name == req.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 팀명입니다.")
    
    new_team = Team(name=req.name)
    db.add(new_team)
    db.commit()
    db.refresh(new_team)
    return {"message": "팀 추가 성공", "id": new_team.id, "name": new_team.name}

# 🚀 [추가] 3. 팀 삭제 API
@app.delete("/teams/{team_name}", tags=["teams"], summary="팀 삭제")
def delete_team(team_name: str, db: Session = Depends(get_db)):
    # 1. 지울 팀을 DB에서 찾습니다.
    team = db.query(Team).filter(Team.name == team_name).first()
    
    if not team:
        raise HTTPException(status_code=404, detail="팀을 찾을 수 없습니다.")
    
    # 2. [핵심] 이 팀에 속한 팀원들의 소속을 해제합니다 (팀_id = None)
    # 이렇게 해야 DB 에러 없이 팀이 깔끔하게 지워집니다.
    for user in team.users:
        user.team_id = None
        
    # 3. 팀을 삭제합니다.
    db.delete(team)
    db.commit()
    
    return {"message": f"'{team_name}' 삭제 완료"}

# 🚀 [추가] 4. 팀명 수정 API (PUT)
class TeamUpdate(BaseModel):
    name: str

@app.put("/teams/{team_id}", tags=["teams"], summary="팀 이름 수정")
def update_team(team_id: int, req: TeamUpdate, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="팀을 찾을 수 없습니다.")
    
    old_name = team.name 
    
    existing = db.query(Team).filter(Team.name == req.name, Team.id != team_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 팀명입니다.")
    
    team.name = req.name

    # 🚀 [강제 업데이트] 예전 팀명을 가진 유저들의 소속을 새 이름으로 덮어씌웁니다.
    try:
        # 💡 주의: users 테이블의 소속팀 속성 이름이 'team_name'이 아니라 'dept'라면 
        # 아래 코드의 User.team_name을 User.dept로, "team_name"을 "dept"로 바꿔주세요!
        db.query(User).filter(User.team_name == old_name).update(
            {"team_name": req.name}, 
            synchronize_session=False  # 👈 SQLAlchemy 튕김 방지용 핵심 옵션!
        )
    except Exception as e:
        print("유저 정보 업데이트 에러:", e)

    db.commit()
    
    return {"message": "팀명 및 소속 팀원 정보 수정 완료"}

def _serialize_user(u: User, team_name_override: str = None) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "username": u.username,
        "team_name": team_name_override if team_name_override is not None else (u.team.name if u.team else "미배정"),
        "pos": u.pos if u.pos else "",
        "role": u.role,
        "email": u.email or "",
        "job_title": u.job_title or "",
        "profile_image": u.profile_image or "",
        "profile_image_url": (f"/files/{u.profile_image}" if u.profile_image else ""),
    }

# 🚀 [추가] 유저(팀원) 목록 조회 API
@app.get("/users", tags=["users"], summary="전체 사용자 목록 조회", response_model=List[UserOut])
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return [_serialize_user(u) for u in users]

# 🚀 [추가] 특정 팀의 소속 유저만 가져오는 API
@app.get("/teams/{team_name}/users", tags=["users"], summary="특정 팀 소속 사용자 목록 조회", response_model=List[UserOut])
def get_users_by_team(team_name: str, db: Session = Depends(get_db)):
    team = db.query(Team).filter(Team.name == team_name).first()
    if not team:
        raise HTTPException(status_code=404, detail="팀을 찾을 수 없습니다.")
    users = db.query(User).filter(User.team_id == team.id).all()
    return [_serialize_user(u, team_name_override=team.name) for u in users]

@app.put("/users/{username}/team", tags=["users"], summary="사용자 소속 팀 변경")
def update_user_team(username: str, req: UserTeamUpdate, db: Session = Depends(get_db)):
    # 1. 내 유저 정보를 찾습니다.
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    
    # 2. 🚀 내가 선택한 새 팀의 정보(ID)를 teams 테이블에서 찾아옵니다!
    team = db.query(Team).filter(Team.name == req.team_name).first()
    if not team:
        raise HTTPException(status_code=404, detail="선택한 팀이 DB에 존재하지 않습니다.")
    
    # 3. 🚀 유저 정보에 새 팀의 이름과 ID를 모두 갈아 끼웁니다!
    user.team_name = team.name
    user.team_id = team.id  # 선생님 말씀대로 team_id도 완벽하게 업데이트!
    
    db.commit()
    
    # 프론트엔드에 성공했다는 메시지와 함께 바뀐 ID도 혹시 몰라 보내줍니다.
    return {"message": "소속 팀이 변경되었습니다.", "team_name": team.name, "team_id": team.id}

# 🚀 직책 업데이트 API
@app.put("/users/{username}/job-title", tags=["users"], summary="사용자 직책 수정")
def update_user_job_title(username: str, req: UserJobTitleUpdate, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")

    user.job_title = req.job_title
    db.commit()

    return {"message": f"{username}님의 직책이 저장되었습니다."}

class UserPosUpdate(BaseModel):
    pos: str

@app.patch("/users/{username}/pos", tags=["users"], summary="사용자 담당 업무(pos) 수정")
def update_user_pos(username: str, req: UserPosUpdate, db: Session = Depends(get_db)):
    """팀원의 '담당 업무'(메모성 텍스트) 업데이트"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    user.pos = req.pos
    db.commit()
    return {"message": f"{username}님의 담당 업무가 저장되었습니다.", "pos": user.pos}

# (Phase 3-A) /users/{username}/status 엔드포인트 + ALLOWED_USER_STATUSES 제거됨
# User.status 컬럼 자체가 삭제되어 상태 셀렉트 UI 폐기됨

# 🚀 팀원 삭제 API
@app.delete("/users/{username}", tags=["users"], summary="사용자 삭제")
def delete_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")

    # cascade="all, delete-orphan" 설정 덕분에 project_assignments 행도 자동 삭제됨
    db.delete(user)
    db.commit()
    return {"message": f"'{username}' 삭제 완료"}


# ==========================================
# 사업별 예산 상세(BUDGET_ITEMS·EXEC_DATA) API — 이전 iframe 내부 localStorage 대체
# ==========================================
@app.get("/projects/{project_id}/budget", tags=["projects"], summary="사업 예산 조회")
def get_project_budget(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if not p.budget_data:
        return {"items": [], "execs": []}
    try:
        return json.loads(p.budget_data)
    except Exception:
        return {"items": [], "execs": []}

@app.put("/projects/{project_id}/budget", tags=["projects"], summary="사업 예산 저장")
def save_project_budget(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = payload.get("items", [])
    execs = payload.get("execs", [])
    p.budget_data = json.dumps({"items": items, "execs": execs}, ensure_ascii=False)
    db.commit()
    return {"ok": True, "items_count": len(items), "execs_count": len(execs)}

# ==========================================
# 사업별 담당자 연락처 (partner contacts) JSON
# ==========================================
@app.get("/projects/{project_id}/contacts", tags=["projects"], summary="사업 담당자 연락처 조회")
def get_project_contacts(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if not p.contacts_data:
        return {"items": []}
    try:
        return json.loads(p.contacts_data)
    except Exception:
        return {"items": []}

@app.put("/projects/{project_id}/contacts", tags=["projects"], summary="사업 담당자 연락처 저장")
def save_project_contacts(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = payload.get("items", [])
    p.contacts_data = json.dumps({"items": items}, ensure_ascii=False)
    db.commit()
    return {"ok": True, "items_count": len(items)}

# ==========================================
# WBS · ToDo · 리스크 · 대응 — JSON blob 패턴 (예산·연락처와 동일)
# ==========================================
WBS_STATUSES = {"notstart", "progress", "done"}

def _calc_subtree_pct(item: dict, items: list, todos_data: dict) -> int:
    """
    단일 WBS 항목의 진행률 — ToDo 완료 기반 + subtree roll-up.
    - hold:    progress_pct freeze (재계산 안 함)
    - done:    100%
    - manualPct 있으면 그 값
    - 그 외: subtree(자기 + wbsId가 자신의 코드+'.'로 시작하는 모든 자손)의 todo 합산 비율
    """
    status = (item.get("status") or "").lower()
    if status == "hold":
        # hold 동안은 마지막 계산값을 그대로 보존
        fp = item.get("progress_pct")
        try: return int(fp) if fp is not None else 0
        except: return 0
    if status == "done":
        return 100
    mp = item.get("manualPct")
    if mp is not None and mp != "":
        try: return max(0, min(100, int(mp)))
        except: pass

    wbs_code = item.get("wbsId", "")
    if not wbs_code:
        return 0
    prefix = wbs_code + "."
    total = 0
    done  = 0
    for w in items:
        code = w.get("wbsId", "") or ""
        if code != wbs_code and not code.startswith(prefix):
            continue
        wid = w.get("id")
        ts = todos_data.get(wid, []) if isinstance(todos_data, dict) else []
        if isinstance(ts, list):
            for t in ts:
                total += 1
                if t.get("done"):
                    done += 1
    return int(round(done / total * 100)) if total > 0 else 0

def _recalc_project_progress(db: Session, project_id: str):
    """
    WBS·ToDo 변경 직후 호출 — todo 완료 기반 진행률을 모든 항목에 반영하고
    Project.progress = 사업 전체 todo 완료 비율.
    """
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p: return

    items = []
    if p.wbs_data:
        try:
            d = json.loads(p.wbs_data)
            items = d if isinstance(d, list) else (d.get("items") or [])
        except Exception:
            items = []
    todos_data = {}
    if p.todos_data:
        try:
            d = json.loads(p.todos_data)
            todos_data = d if isinstance(d, dict) else {}
        except Exception:
            todos_data = {}

    # 1) 각 WBS 항목의 progress_pct 갱신 (hold는 보존)
    for w in items:
        if (w.get("status") or "").lower() == "hold":
            # progress_pct가 없는 경우만 0 초기화
            if w.get("progress_pct") is None:
                w["progress_pct"] = 0
            continue
        w["progress_pct"] = _calc_subtree_pct(w, items, todos_data)
    p.wbs_data = json.dumps(items, ensure_ascii=False)

    # 2) Project.progress = 사업 전체 todo 완료 비율 (custom group cg::* 제외)
    total = 0; done = 0
    if isinstance(todos_data, dict):
        # WBS 항목 id로 키된 todos만 합산 (cg::xxx 사용자 정의 그룹은 사업 진행률에서 제외)
        wbs_ids = {w.get("id") for w in items}
        for key, ts in todos_data.items():
            if key not in wbs_ids:
                continue
            if not isinstance(ts, list):
                continue
            for t in ts:
                total += 1
                if t.get("done"):
                    done += 1
    p.progress = int(round(done / total * 100)) if total > 0 else 0

# WBS — bulk GET/PUT
@app.get("/projects/{project_id}/wbs", tags=["projects"], summary="사업 WBS 목록 조회")
def get_project_wbs(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if not p.wbs_data:
        return {"items": []}
    try:
        d = json.loads(p.wbs_data)
        if isinstance(d, list):
            return {"items": d}
        return d
    except Exception:
        return {"items": []}

@app.put("/projects/{project_id}/wbs", tags=["projects"], summary="사업 WBS 저장")
def save_project_wbs(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = payload.get("items", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items는 배열이어야 합니다.")
    p.wbs_data = json.dumps(items, ensure_ascii=False)
    # 진행율 자동 갱신
    _recalc_project_progress(db, project_id)
    db.commit()
    return {"ok": True, "items_count": len(items), "progress": p.progress}

# ToDo — bulk GET/PUT (객체 형태: {wbsId: [todos], ...} 또는 평면 배열 모두 지원)
@app.get("/projects/{project_id}/todos", tags=["projects"], summary="사업 ToDo 목록 조회")
def get_project_todos(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    if not p.todos_data:
        return {"data": {}}
    try:
        return {"data": json.loads(p.todos_data)}
    except Exception:
        return {"data": {}}

@app.put("/projects/{project_id}/todos", tags=["projects"], summary="사업 ToDo 저장")
def save_project_todos(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    data = payload.get("data", {})
    p.todos_data = json.dumps(data, ensure_ascii=False)
    # ToDo 변경은 WBS 진행률에 영향 → Project.progress + 각 WBS의 progress_pct 자동 갱신
    _recalc_project_progress(db, project_id)
    db.commit()
    # 그룹 개수와 ToDo 총 개수
    if isinstance(data, dict):
        n_groups = len(data)
        n_todos  = sum(len(v) for v in data.values() if isinstance(v, list))
    elif isinstance(data, list):
        n_groups = 1
        n_todos  = len(data)
    else:
        n_groups = 0; n_todos = 0
    return {"ok": True, "groups": n_groups, "todos": n_todos, "progress": p.progress}

# ToDo 팀장 보고 — Task 테이블에 자동 등록
class TodoReportRequest(BaseModel):
    actor_username: str
    todo_title: str
    todo_priority: Optional[str] = "med"
    todo_due_date: Optional[str] = None

@app.post("/projects/{project_id}/todos/report-task", tags=["projects"], summary="ToDo 항목을 업무(Task)로 보고")
def report_todo_to_task(project_id: str, req: TodoReportRequest, db: Session = Depends(get_db)):
    """ToDo의 '팀장 보고' 버튼이 호출. 백엔드는 Task 테이블에 신규 row insert.
    todo 자체의 _reported 상태는 frontend가 todos JSON 안에 마킹 후 PUT /projects/{id}/todos로 저장."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="요청자를 찾을 수 없습니다.")
    # 사업의 팀장 찾기 — 팀 + role='leader' 첫번째. 없으면 admin → sysadmin
    leader = None
    if project.team_id:
        leader = db.query(User).filter(User.team_id == project.team_id, User.role == "leader").first()
    if not leader:
        leader = (db.query(User).filter(User.role == "admin").first()
                  or db.query(User).filter(User.role == "sysadmin").first())
    if not leader:
        raise HTTPException(status_code=400, detail="보고할 팀장을 찾을 수 없습니다.")
    new_task = Task(
        title=f"[{project.name}] {req.todo_title}",
        description=f"ToDo 자동 보고 — 작성자 {actor.name}",
        requester_id=actor.id,
        assignee_id=leader.id,
        project_id=project_id,
        due_date=req.todo_due_date or None,
        priority=req.todo_priority or "med",
        status="진행중",
    )
    db.add(new_task); db.commit(); db.refresh(new_task)
    return {
        "task_id": new_task.id,
        "task": {
            "id":           new_task.id,
            "title":        new_task.title,
            "assignee_id":  new_task.assignee_id,
            "assignee":     leader.name,
            "requester_id": new_task.requester_id,
            "requester":    actor.name,
            "project_id":   project_id,
            "status":       new_task.status,
        }
    }

# 리스크 / 대응 — bulk GET/PUT (Phase 3-A에서 신규 사업 시드만, 화면 연동은 Phase 3-B)
@app.get("/projects/{project_id}/risks", tags=["projects"], summary="사업 리스크 목록 조회")
def get_project_risks(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    risks = []
    if p.risks_data:
        try: risks = json.loads(p.risks_data)
        except: risks = []
    return {"items": risks if isinstance(risks, list) else []}

@app.put("/projects/{project_id}/risks", tags=["projects"], summary="사업 리스크 저장")
def save_project_risks(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = payload.get("items", [])
    p.risks_data = json.dumps(items, ensure_ascii=False)
    db.commit()
    return {"ok": True, "items_count": len(items)}

@app.get("/projects/{project_id}/responses", tags=["projects"], summary="사업 리스크 대응 조회")
def get_project_responses(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    resp = {}
    if p.resp_data:
        try: resp = json.loads(p.resp_data)
        except: resp = {}
    return {"data": resp if isinstance(resp, dict) else {}}

@app.put("/projects/{project_id}/responses", tags=["projects"], summary="사업 리스크 대응 저장")
def save_project_responses(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    data = payload.get("data", {})
    p.resp_data = json.dumps(data, ensure_ascii=False)
    db.commit()
    return {"ok": True, "count": len(data) if isinstance(data, dict) else 0}

# ==========================================
# 산출물(Deliverables) API — JSON blob + 파일 업로드 (uploads/deliverables/{project_id}/)
# 각 산출물 항목 shape:
#   {id, name, type, wbsId, dueDate, reviewer, status, note,
#    file_path?, original_filename?, file_size?}
# ==========================================
def _get_deliverables_items(p: Project) -> list:
    if not p.deliverables_data:
        return []
    try:
        d = json.loads(p.deliverables_data)
        if isinstance(d, list): return d
        if isinstance(d, dict): return d.get("items") or []
    except Exception:
        pass
    return []

@app.get("/projects/{project_id}/deliverables", tags=["projects"], summary="사업 산출물 목록 조회")
def get_project_deliverables(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    return {"items": _get_deliverables_items(p)}

@app.put("/projects/{project_id}/deliverables", tags=["projects"], summary="사업 산출물 저장")
def save_project_deliverables(project_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    """산출물 메타데이터 일괄 저장. 파일 자체는 POST .../file 로 별도 업로드."""
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = payload.get("items", [])
    if not isinstance(items, list):
        raise HTTPException(status_code=400, detail="items는 배열이어야 합니다.")
    # 보안: client가 보낸 file_path는 그대로 신뢰 (서버 자체가 발급한 경로이므로)
    # 단, 외부 절대 경로 등 비정상 값은 보존 X
    cleaned = []
    for it in items:
        if not isinstance(it, dict):
            continue
        clean = dict(it)
        fp = clean.get("file_path")
        if fp and (".." in fp or fp.startswith("/") or fp.startswith("\\")):
            clean["file_path"] = ""
        cleaned.append(clean)
    p.deliverables_data = json.dumps(cleaned, ensure_ascii=False)
    db.commit()
    return {"ok": True, "items_count": len(cleaned)}

@app.post("/projects/{project_id}/deliverables/{deliv_id}/file", tags=["projects"], summary="산출물 파일 업로드")
async def upload_deliverable_file(
    project_id: str,
    deliv_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """산출물 파일 업로드. uploads/deliverables/{project_id}/ 에 저장하고
    deliverables_data JSON의 해당 항목에 file_path/original_filename/file_size를 갱신."""
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = _get_deliverables_items(p)
    target_idx = next((i for i, it in enumerate(items) if str(it.get("id")) == str(deliv_id)), -1)
    if target_idx < 0:
        raise HTTPException(status_code=404, detail=f"산출물 항목을 찾을 수 없습니다: {deliv_id}")
    # 기존 파일이 있으면 삭제
    prev = items[target_idx].get("file_path")
    if prev:
        try: (UPLOAD_ROOT / prev).unlink(missing_ok=True)
        except Exception: pass
    # 새 파일 저장 (uploads/deliverables/{project_id}/{filename})
    rel_path, size = _save_upload(file, "deliverables", project_id)
    # 50MB 초과 차단
    if size > 50 * 1024 * 1024:
        try: (UPLOAD_ROOT / rel_path).unlink(missing_ok=True)
        except Exception: pass
        raise HTTPException(status_code=400, detail="파일은 최대 50MB까지 업로드 가능합니다.")
    # DB 갱신
    items[target_idx]["file_path"]         = rel_path
    items[target_idx]["original_filename"] = file.filename or ""
    items[target_idx]["file_size"]         = size
    p.deliverables_data = json.dumps(items, ensure_ascii=False)
    db.commit()
    return {
        "ok": True,
        "file_path": rel_path,
        "file_url":  f"/files/{rel_path}",
        "original_filename": file.filename or "",
        "file_size": size,
    }

@app.get("/projects/{project_id}/deliverables/{deliv_id}/download", tags=["projects"], summary="산출물 파일 다운로드")
def download_deliverable_file(project_id: str, deliv_id: str, db: Session = Depends(get_db)):
    """산출물 파일 다운로드 — Content-Disposition: attachment 헤더로 강제 다운로드 + 원본 파일명 복원."""
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = _get_deliverables_items(p)
    target = next((it for it in items if str(it.get("id")) == str(deliv_id)), None)
    if not target or not target.get("file_path"):
        raise HTTPException(status_code=404, detail="파일이 없습니다.")
    file_full = UPLOAD_ROOT / target["file_path"]
    if not file_full.exists():
        raise HTTPException(status_code=404, detail="저장된 파일을 찾을 수 없습니다.")
    return FileResponse(
        path=str(file_full),
        media_type="application/octet-stream",
        filename=target.get("original_filename") or "file",
    )

@app.delete("/projects/{project_id}/deliverables/{deliv_id}/file", tags=["projects"], summary="산출물 파일 삭제")
def delete_deliverable_file(project_id: str, deliv_id: str, db: Session = Depends(get_db)):
    """산출물 파일만 삭제 (메타는 유지). file_path/original_filename/file_size를 비움."""
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    items = _get_deliverables_items(p)
    target = next((it for it in items if str(it.get("id")) == str(deliv_id)), None)
    if not target:
        raise HTTPException(status_code=404, detail=f"산출물 항목을 찾을 수 없습니다: {deliv_id}")
    fp = target.get("file_path")
    if fp:
        try: (UPLOAD_ROOT / fp).unlink(missing_ok=True)
        except Exception: pass
    target["file_path"] = ""
    target["original_filename"] = ""
    target["file_size"] = 0
    p.deliverables_data = json.dumps(items, ensure_ascii=False)
    db.commit()
    return {"ok": True}

# ==========================================
# 비정기 업무(Task) API — 부서장/팀장 → 팀원 단발성 업무 배정
# ==========================================
ALLOWED_TASK_PRIORITIES = {"high", "med", "low"}
ALLOWED_TASK_STATUSES   = {"진행중", "완료", "지연"}

class TaskCreate(BaseModel):
    title: str
    assignee_username: str
    requester_username: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = "med"
    status: Optional[str] = "진행중"

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[str] = None
    due_date: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None

def _serialize_task(t: Task) -> dict:
    return {
        "id":           t.id,
        "title":        t.title,
        "description":  t.description or "",
        "requester_id":   t.requester_id,
        "requester_name": t.requester.name if t.requester else None,
        "requester_username": t.requester.username if t.requester else None,
        "assignee_id":   t.assignee_id,
        "assignee_name": t.assignee.name if t.assignee else None,
        "assignee_username": t.assignee.username if t.assignee else None,
        "project_id":    t.project_id,
        "project_name":  t.project.name if t.project else None,
        "project_icon":  t.project.icon if t.project else None,
        "due_date":      t.due_date,
        "priority":      t.priority or "med",
        "status":        t.status or "진행중",
        "created_at":    t.created_at.isoformat() if t.created_at else None,
        "updated_at":    t.updated_at.isoformat() if t.updated_at else None,
    }

@app.post("/tasks", tags=["tasks"], summary="업무 생성")
def create_task(req: TaskCreate, db: Session = Depends(get_db)):
    if req.priority and req.priority not in ALLOWED_TASK_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority는 {sorted(ALLOWED_TASK_PRIORITIES)} 중 하나여야 합니다.")
    if req.status and req.status not in ALLOWED_TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"status는 {sorted(ALLOWED_TASK_STATUSES)} 중 하나여야 합니다.")
    assignee = db.query(User).filter(User.username == req.assignee_username).first()
    if not assignee:
        raise HTTPException(status_code=404, detail="담당자(assignee)를 찾을 수 없습니다.")
    requester = None
    if req.requester_username:
        requester = db.query(User).filter(User.username == req.requester_username).first()
    if req.project_id and not db.query(Project).filter(Project.id == req.project_id).first():
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    t = Task(
        title=req.title,
        description=req.description,
        requester_id=requester.id if requester else None,
        assignee_id=assignee.id,
        project_id=req.project_id,
        due_date=req.due_date,
        priority=req.priority or "med",
        status=req.status or "진행중",
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return _serialize_task(t)

@app.get("/tasks", tags=["tasks"], summary="업무 목록 조회 (팀/담당자 필터)", response_model=List[TaskOut])
def list_tasks(team_name: Optional[str] = None, assignee_username: Optional[str] = None, db: Session = Depends(get_db)):
    """team_name 지정 시 그 팀에 속한 사용자가 담당자인 task만, assignee_username 지정 시 그 사용자의 task만."""
    q = db.query(Task)
    if assignee_username:
        user = db.query(User).filter(User.username == assignee_username).first()
        if not user:
            return []
        q = q.filter(Task.assignee_id == user.id)
    elif team_name:
        team = db.query(Team).filter(Team.name == team_name).first()
        if not team:
            return []
        user_ids = [u.id for u in team.users]
        if not user_ids:
            return []
        q = q.filter(Task.assignee_id.in_(user_ids))
    rows = q.order_by(Task.created_at.desc()).all()
    return [_serialize_task(t) for t in rows]

@app.put("/tasks/{task_id}", tags=["tasks"], summary="업무 수정")
def update_task(task_id: int, req: TaskUpdate, db: Session = Depends(get_db)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="업무를 찾을 수 없습니다.")
    if req.priority is not None:
        if req.priority not in ALLOWED_TASK_PRIORITIES:
            raise HTTPException(status_code=400, detail=f"priority는 {sorted(ALLOWED_TASK_PRIORITIES)} 중 하나여야 합니다.")
        t.priority = req.priority
    if req.status is not None:
        if req.status not in ALLOWED_TASK_STATUSES:
            raise HTTPException(status_code=400, detail=f"status는 {sorted(ALLOWED_TASK_STATUSES)} 중 하나여야 합니다.")
        t.status = req.status
    if req.title is not None:       t.title = req.title
    if req.description is not None: t.description = req.description
    if req.project_id is not None:  t.project_id = req.project_id or None
    if req.due_date is not None:    t.due_date = req.due_date or None
    db.commit()
    db.refresh(t)
    return _serialize_task(t)

@app.delete("/tasks/{task_id}", tags=["tasks"], summary="업무 삭제")
def delete_task(task_id: int, db: Session = Depends(get_db)):
    t = db.query(Task).filter(Task.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="업무를 찾을 수 없습니다.")
    db.delete(t)
    db.commit()
    return {"message": "업무가 삭제되었습니다.", "id": task_id}

# ==========================================
# 🚀 사업 참여인력 (UserProject) API
# ==========================================

class AssignmentCreate(BaseModel):
    user_id:    int
    project_id: str
    rate:       float = 0.0
    role:       str   = "참여연구원"
    start_date: Optional[str] = None
    end_date:   Optional[str] = None

class AssignmentUpdate(BaseModel):
    rate:       Optional[float] = None
    role:       Optional[str]   = None
    start_date: Optional[str]   = None
    end_date:   Optional[str]   = None

def _parse_date(s: Optional[str]) -> Optional[date]:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"날짜 형식이 올바르지 않습니다(YYYY-MM-DD): {s}")

def _is_active_today(start: Optional[str], end: Optional[str]) -> bool:
    today = date.today()
    s = _parse_date(start)
    e = _parse_date(end)
    if s and today < s: return False
    if e and today > e: return False
    return True

def _serialize_assignment(a: UserProject) -> dict:
    return {
        "id":           a.id,
        "user_id":      a.user_id,
        "user_name":    a.user.name if a.user else None,
        "username":     a.user.username if a.user else None,
        "project_id":   a.project_id,
        "project_name": a.project.name if a.project else None,
        "project_icon": a.project.icon if a.project else None,
        "rate":         float(a.rate) if a.rate is not None else 0.0,
        "role":         a.role,
        "start_date":   a.start_date,
        "end_date":     a.end_date,
        "is_active":    _is_active_today(a.start_date, a.end_date),
        "created_at":   a.created_at.isoformat() if a.created_at else None,
        "updated_at":   a.updated_at.isoformat() if a.updated_at else None,
    }

# NOTE: 이전엔 `_resolve_overlaps`가 같은 (user, project)에 대해 겹치는 행을 자동 삭제·단축했지만,
# 사용자가 참여기간을 분리하기 위해 "추가" 클릭 시 default 기간이 기존 행과 100% 겹쳐 기존 행이
# silent 하게 삭제되는 버그가 있었다. 사용자가 분할을 직접 관리할 수 있도록 자동 해결을 제거.
# 같은 사용자에 대해 겹치는 행은 허용하되, 완전 동일한 행(user/project/start/end가 모두 같음)만 차단.

def _has_exact_duplicate(db: Session, user_id: int, project_id: str,
                          start_date: Optional[str], end_date: Optional[str],
                          exclude_id: Optional[int] = None) -> bool:
    """완전히 똑같은 (user, project, start, end) 행이 이미 있는지 검사 — 의미 없는 중복 차단용."""
    q = db.query(UserProject).filter(
        UserProject.user_id == user_id,
        UserProject.project_id == project_id,
        UserProject.start_date == start_date,
        UserProject.end_date == end_date,
    )
    if exclude_id is not None:
        q = q.filter(UserProject.id != exclude_id)
    return q.first() is not None

@app.post("/assignments", tags=["assignments"], summary="사업 참여자 등록")
def create_assignment(req: AssignmentCreate, db: Session = Depends(get_db)):
    if req.role not in PROJECT_ROLES:
        raise HTTPException(status_code=400, detail=f"role은 {PROJECT_ROLES} 중 하나여야 합니다.")
    if not db.query(User).filter(User.id == req.user_id).first():
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    if not db.query(Project).filter(Project.id == req.project_id).first():
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")

    new_start = _parse_date(req.start_date)
    new_end   = _parse_date(req.end_date)
    if new_start and new_end and new_start > new_end:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦을 수 없습니다.")

    a = UserProject(
        user_id=req.user_id,
        project_id=req.project_id,
        rate=req.rate,
        role=req.role,
        start_date=req.start_date,
        end_date=req.end_date,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _serialize_assignment(a)

@app.put("/assignments/{assignment_id}", tags=["assignments"], summary="사업 참여자 정보 수정")
def update_assignment(assignment_id: int, req: AssignmentUpdate, db: Session = Depends(get_db)):
    a = db.query(UserProject).filter(UserProject.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="참여 정보를 찾을 수 없습니다.")

    if req.role is not None:
        if req.role not in PROJECT_ROLES:
            raise HTTPException(status_code=400, detail=f"role은 {PROJECT_ROLES} 중 하나여야 합니다.")
        a.role = req.role
    if req.rate is not None:
        a.rate = req.rate

    # 날짜가 변경되면 다시 겹침 검사
    new_start_str = req.start_date if req.start_date is not None else a.start_date
    new_end_str   = req.end_date   if req.end_date   is not None else a.end_date
    new_start = _parse_date(new_start_str)
    new_end   = _parse_date(new_end_str)
    if new_start and new_end and new_start > new_end:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦을 수 없습니다.")

    if req.start_date is not None or req.end_date is not None:
        # 자동 overlap 해결 제거 — 사용자가 직접 기간을 관리. 같은 사용자에 대한 겹침 행은 허용.
        a.start_date = new_start_str
        a.end_date   = new_end_str

    db.commit()
    db.refresh(a)
    return _serialize_assignment(a)

@app.delete("/assignments/{assignment_id}", tags=["assignments"], summary="사업 참여자 삭제")
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)):
    a = db.query(UserProject).filter(UserProject.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="참여 정보를 찾을 수 없습니다.")
    db.delete(a)
    db.commit()
    return {"message": f"참여 정보 {assignment_id} 삭제 완료"}

@app.get("/projects/{project_id}/assignments", tags=["assignments"], summary="사업 참여자 목록 조회", response_model=List[AssignmentOut])
def list_project_assignments(project_id: str, db: Session = Depends(get_db)):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다.")
    rows = db.query(UserProject).filter(UserProject.project_id == project_id).order_by(UserProject.start_date).all()
    return [_serialize_assignment(r) for r in rows]

@app.get("/users/{username}/assignments", tags=["users"], summary="사용자 사업 참여 이력 조회", response_model=List[AssignmentOut])
def list_user_assignments(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    rows = db.query(UserProject).filter(UserProject.user_id == user.id).order_by(UserProject.start_date).all()
    return [_serialize_assignment(r) for r in rows]

@app.get("/users/{username}/projects", tags=["users"], summary="사용자 권한 사업 ID 목록 조회")
def list_user_project_ids(username: str, db: Session = Depends(get_db)):
    """사용자가 권한 부여받은 사업 ID 목록 (권한설정 모달의 토글 상태 채우기용)"""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    rows = db.query(UserProject.project_id).filter(UserProject.user_id == user.id).distinct().all()
    return [r[0] for r in rows]

@app.get("/teams/{team_name}/assignments", tags=["teams"], summary="팀 전체 사업 참여 이력 조회", response_model=List[AssignmentOut])
def list_team_assignments(team_name: str, db: Session = Depends(get_db)):
    """팀 전체 멤버의 모든 참여 행을 한 번에 조회 (인력 관리 화면용)."""
    team = db.query(Team).filter(Team.name == team_name).first()
    if not team:
        raise HTTPException(status_code=404, detail="팀을 찾을 수 없습니다.")
    user_ids = [u.id for u in team.users]
    if not user_ids:
        return []
    rows = db.query(UserProject).filter(UserProject.user_id.in_(user_ids)).order_by(UserProject.user_id, UserProject.start_date).all()
    return [_serialize_assignment(r) for r in rows]

@app.get("/users/{username}/current-rate", tags=["users"], summary="사용자 현재 참여율 조회")
def get_user_current_rate(username: str, db: Session = Depends(get_db)):
    """오늘 기준 활성 행들의 rate 합계 — '현재 참여율'."""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    rows = db.query(UserProject).filter(UserProject.user_id == user.id).all()
    total = sum(float(r.rate or 0) for r in rows if _is_active_today(r.start_date, r.end_date))
    active_rows = [_serialize_assignment(r) for r in rows if _is_active_today(r.start_date, r.end_date)]
    return {"username": username, "total_rate": total, "active_assignments": active_rows}

# ==========================================
# 파일 업로드 인프라 — uploads/{type}/{id}/{filename}
# 보고서(2.2) / 게시판(2.4) / 프로필(2.7)에서 공통 사용
# ==========================================
UPLOAD_ROOT = Path(__file__).parent / "uploads"
UPLOAD_ROOT.mkdir(exist_ok=True)
for sub in ("reports", "board", "profile", "notices", "deliverables"):
    (UPLOAD_ROOT / sub).mkdir(exist_ok=True)

# 정적 파일 서빙 — /files/reports/123/foo.pdf
app.mount("/files", StaticFiles(directory=str(UPLOAD_ROOT)), name="files")

def _save_upload(file: UploadFile, kind: str, owner_id) -> tuple[str, int]:
    """업로드 파일을 uploads/{kind}/{owner_id}/{uuid}_{원본} 으로 저장.
    반환: (relative_path, file_size). relative_path는 DB에 저장하고 다운로드 시 사용.
    """
    if kind not in ("reports", "board", "profile", "notices", "deliverables"):
        raise HTTPException(status_code=400, detail=f"지원하지 않는 업로드 종류: {kind}")
    folder = UPLOAD_ROOT / kind / str(owner_id)
    folder.mkdir(parents=True, exist_ok=True)
    # 원본 파일명 보존 + UUID prefix로 충돌 방지
    safe_name = (file.filename or "file").replace("/", "_").replace("\\", "_")
    stored_name = f"{_uuid.uuid4().hex[:12]}_{safe_name}"
    target = folder / stored_name
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    size = target.stat().st_size
    rel = f"{kind}/{owner_id}/{stored_name}"
    return rel, size

# ==========================================
# 보고서(Report) — 위→아래 요청 워크플로우 + 파일 업로드
# ==========================================
ROLE_RANK = {"sysadmin": 4, "admin": 3, "leader": 2, "member": 1}

def _serialize_report(r: Report, db: Session = None) -> dict:
    return {
        "id": r.id,
        "requester_id": r.requester_id,
        "requester_name": r.requester.name if r.requester else "",
        "requester_username": r.requester.username if r.requester else "",
        "target_id": r.target_id,
        "target_name": r.target.name if r.target else "",
        "target_username": r.target.username if r.target else "",
        "title": r.title,
        "description": r.description or "",
        "due_date": r.due_date or "",
        "status": r.status,
        "reject_reason": r.reject_reason or "",
        "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
        "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "files": [{
            "id": f.id,
            "original_filename": f.original_filename,
            "stored_path": f.stored_path,
            "file_size": f.file_size,
            "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
            "download_url": f"/files/{f.stored_path}",
        } for f in (r.files or [])],
    }

class ReportCreate(BaseModel):
    requester_username: str
    target_username: str
    title: str
    description: Optional[str] = ""
    due_date: Optional[str] = None

class ReportUpdate(BaseModel):
    actor_username: str  # 호출자 — 권한 검증용
    status: Optional[str] = None        # '제출' / '승인' / '반려'
    reject_reason: Optional[str] = None

@app.post("/reports", tags=["reports"], summary="보고서 요청 생성 (위→아래)")
def create_report(req: ReportCreate, db: Session = Depends(get_db)):
    requester = db.query(User).filter(User.username == req.requester_username).first()
    target    = db.query(User).filter(User.username == req.target_username).first()
    if not requester:
        raise HTTPException(status_code=404, detail="요청자를 찾을 수 없습니다.")
    if not target:
        raise HTTPException(status_code=404, detail="대상자를 찾을 수 없습니다.")
    rr = ROLE_RANK.get(requester.role or "member", 0)
    tr = ROLE_RANK.get(target.role    or "member", 0)
    if rr <= tr:
        raise HTTPException(status_code=403, detail="보고서는 상위 권한자만 하위 권한자에게 요청할 수 있습니다.")
    r = Report(
        requester_id=requester.id,
        target_id=target.id,
        title=req.title,
        description=req.description or "",
        due_date=req.due_date,
        status="요청",
    )
    db.add(r); db.commit(); db.refresh(r)
    return _serialize_report(r)

@app.get("/reports", tags=["reports"], summary="보고서 목록 조회 (요청자/대상자/전체)", response_model=List[ReportOut])
def list_reports(username: str, role_view: str = "all", db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    q = db.query(Report)
    if role_view == "requester":
        q = q.filter(Report.requester_id == user.id)
    elif role_view == "target":
        q = q.filter(Report.target_id == user.id)
    else:
        q = q.filter(or_(Report.requester_id == user.id, Report.target_id == user.id))
    rows = q.order_by(Report.created_at.desc()).all()
    return [_serialize_report(r) for r in rows]

@app.get("/reports/{report_id}", tags=["reports"], summary="보고서 상세 조회", response_model=ReportOut)
def get_report(report_id: int, db: Session = Depends(get_db)):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")
    return _serialize_report(r)

@app.put("/reports/{report_id}", tags=["reports"], summary="보고서 상태 변경 (제출/승인/반려)")
def update_report(report_id: int, req: ReportUpdate, db: Session = Depends(get_db)):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    new_status = (req.status or "").strip()
    if new_status == "제출":
        if actor.id != r.target_id:
            raise HTTPException(status_code=403, detail="대상자만 제출할 수 있습니다.")
        r.status = "제출"
        r.submitted_at = datetime.utcnow()
    elif new_status in ("승인", "반려"):
        if actor.id != r.requester_id:
            raise HTTPException(status_code=403, detail="요청자만 승인·반려할 수 있습니다.")
        r.status = new_status
        r.reviewed_at = datetime.utcnow()
        if new_status == "반려":
            r.reject_reason = req.reject_reason or ""
    elif new_status:
        raise HTTPException(status_code=400, detail=f"알 수 없는 상태값: {new_status}")
    db.commit(); db.refresh(r)
    return _serialize_report(r)

@app.delete("/reports/{report_id}", tags=["reports"], summary="보고서 삭제 (요청자 또는 sysadmin)")
def delete_report(report_id: int, actor_username: str, db: Session = Depends(get_db)):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != r.requester_id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="요청자 또는 sysadmin만 삭제할 수 있습니다.")
    # 첨부 파일도 디스크에서 삭제
    for f in r.files:
        try:
            (UPLOAD_ROOT / f.stored_path).unlink(missing_ok=True)
        except Exception:
            pass
    db.delete(r); db.commit()
    return {"ok": True}

@app.post("/reports/{report_id}/files", tags=["reports"], summary="보고서 파일 첨부")
async def upload_report_file(
    report_id: int,
    file: UploadFile = File(...),
    actor_username: str = Form(...),
    db: Session = Depends(get_db),
):
    """파일 업로드 — 대상자(target)만 가능."""
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="보고서를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != r.target_id:
        raise HTTPException(status_code=403, detail="대상자만 파일을 첨부할 수 있습니다.")
    rel_path, size = _save_upload(file, "reports", r.id)
    rf = ReportFile(
        report_id=r.id,
        original_filename=file.filename or "file",
        stored_path=rel_path,
        file_size=size,
        uploaded_by=actor.id,
    )
    db.add(rf); db.commit(); db.refresh(rf)
    return {
        "id": rf.id,
        "original_filename": rf.original_filename,
        "stored_path": rf.stored_path,
        "file_size": rf.file_size,
        "download_url": f"/files/{rf.stored_path}",
    }

@app.delete("/reports/{report_id}/files/{file_id}", tags=["reports"], summary="보고서 첨부파일 삭제")
def delete_report_file(report_id: int, file_id: int, actor_username: str, db: Session = Depends(get_db)):
    rf = db.query(ReportFile).filter(ReportFile.id == file_id, ReportFile.report_id == report_id).first()
    if not rf:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    r = db.query(Report).filter(Report.id == report_id).first()
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor or not r:
        raise HTTPException(status_code=404, detail="호출자/보고서를 찾을 수 없습니다.")
    if actor.id != rf.uploaded_by and actor.id != r.requester_id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    try:
        (UPLOAD_ROOT / rf.stored_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(rf); db.commit()
    return {"ok": True}

# ==========================================
# 공지사항(Notice) CRUD — 모든 role 작성/조회, 작성자만 수정/삭제, 파일 첨부 가능
# 가시성: sysadmin/admin → 전체 공개 (target_team_id=NULL)
#         leader/member  → 본인 팀만 (target_team_id=내 팀 ID)
# 조회 시 viewer가 sysadmin/admin이면 전체, 그 외엔 본인 팀 + NULL(전체) 공지만
# ==========================================

def _serialize_notice(n: Notice) -> dict:
    return {
        "id": n.id,
        "title": n.title,
        "content": n.content or "",
        "important": bool(n.important),
        "created_by": n.created_by,
        "creator_name": n.creator.name if n.creator else "",
        "creator_username": n.creator.username if n.creator else "",
        "creator_role": n.creator.role if n.creator else "",
        "target_team_id": n.target_team_id,
        "target_team_name": n.target_team.name if n.target_team else None,  # NULL = 전체
        "view_count": n.view_count or 0,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        "files": [{
            "id": f.id,
            "original_filename": f.original_filename,
            "stored_path": f.stored_path,
            "file_size": f.file_size,
            "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
            "download_url": f"/files/{f.stored_path}",
        } for f in (n.files or [])],
    }

class NoticeCreate(BaseModel):
    actor_username: str
    title: str
    content: Optional[str] = ""
    important: Optional[bool] = False
    # 게시 대상: None(누락) = 본인 팀(leader/member) 또는 전체(admin/sysadmin) 자동 결정
    # "all" = 전체 공지, 숫자 = 특정 팀 ID
    target_scope: Optional[str] = None  # "all" 또는 team_id 문자열

class NoticeUpdate(BaseModel):
    actor_username: str
    title: Optional[str] = None
    content: Optional[str] = None
    important: Optional[bool] = None

@app.get("/notices", tags=["notices"], summary="공지사항 목록 조회 (role/팀 기반 필터링)", response_model=List[NoticeOut])
def list_notices(viewer_username: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Notice)
    if viewer_username:
        viewer = db.query(User).filter(User.username == viewer_username).first()
        if viewer and viewer.role not in ADMIN_ROLES:
            # 본인 팀 공지 + 전체 공지(target_team_id IS NULL)만
            my_team = viewer.team_id
            q = q.filter(or_(Notice.target_team_id == None, Notice.target_team_id == my_team))
    rows = q.order_by(Notice.important.desc(), Notice.created_at.desc()).all()
    return [_serialize_notice(n) for n in rows]

@app.get("/notices/{notice_id}", tags=["notices"], summary="공지사항 상세 조회 (조회수 증가)", response_model=NoticeOut)
def get_notice(notice_id: int, db: Session = Depends(get_db)):
    n = db.query(Notice).filter(Notice.id == notice_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다.")
    n.view_count = (n.view_count or 0) + 1
    db.commit(); db.refresh(n)
    return _serialize_notice(n)

@app.post("/notices", tags=["notices"], summary="공지사항 작성")
def create_notice(req: NoticeCreate, db: Session = Depends(get_db)):
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="작성자를 찾을 수 없습니다.")
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="제목은 필수입니다.")

    # 게시 대상 결정 + 권한 검증
    # - target_scope == "all"     → 전체 공지 (target_team_id=NULL)
    # - target_scope == "<숫자>"  → 특정 팀 공지
    # - target_scope == None      → 자동: sysadmin/admin → 전체, leader/member → 본인 팀
    # 권한:
    # - sysadmin/admin: 전체 + 모든 팀에 게시 가능
    # - leader/member:  전체 + 본인 팀에만 게시 가능
    target_team = None
    scope = (req.target_scope or "").strip()
    if scope == "":
        # 자동 결정
        target_team = None if (actor.role in ADMIN_ROLES) else actor.team_id
    elif scope == "all":
        target_team = None
    else:
        try:
            tid = int(scope)
        except ValueError:
            raise HTTPException(status_code=400, detail="잘못된 게시 대상입니다.")
        if not db.query(Team).filter(Team.id == tid).first():
            raise HTTPException(status_code=404, detail="대상 팀을 찾을 수 없습니다.")
        # leader/member는 본인 팀에만
        if actor.role not in ADMIN_ROLES and tid != actor.team_id:
            raise HTTPException(status_code=403, detail="다른 팀에 공지를 게시할 권한이 없습니다.")
        target_team = tid

    n = Notice(
        title=req.title.strip(),
        content=(req.content or "").strip(),
        important=bool(req.important),
        created_by=actor.id,
        target_team_id=target_team,
    )
    db.add(n); db.commit(); db.refresh(n)
    return _serialize_notice(n)

@app.put("/notices/{notice_id}", tags=["notices"], summary="공지사항 수정")
def update_notice(notice_id: int, req: NoticeUpdate, db: Session = Depends(get_db)):
    n = db.query(Notice).filter(Notice.id == notice_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != n.created_by and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="작성자 또는 sysadmin만 수정할 수 있습니다.")
    if req.title is not None:     n.title = req.title.strip()
    if req.content is not None:   n.content = req.content
    if req.important is not None: n.important = bool(req.important)
    db.commit(); db.refresh(n)
    return _serialize_notice(n)

@app.delete("/notices/{notice_id}", tags=["notices"], summary="공지사항 삭제")
def delete_notice(notice_id: int, actor_username: str, db: Session = Depends(get_db)):
    n = db.query(Notice).filter(Notice.id == notice_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != n.created_by and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="작성자 또는 sysadmin만 삭제할 수 있습니다.")
    # 첨부 파일도 디스크에서 삭제
    for f in n.files:
        try: (UPLOAD_ROOT / f.stored_path).unlink(missing_ok=True)
        except Exception: pass
    db.delete(n); db.commit()
    return {"ok": True}

@app.post("/notices/{notice_id}/files", tags=["notices"], summary="공지사항 파일 첨부")
async def upload_notice_file(
    notice_id: int,
    file: UploadFile = File(...),
    actor_username: str = Form(...),
    db: Session = Depends(get_db),
):
    """공지 첨부 — 작성자 또는 sysadmin만."""
    n = db.query(Notice).filter(Notice.id == notice_id).first()
    if not n:
        raise HTTPException(status_code=404, detail="공지를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != n.created_by and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="작성자 또는 sysadmin만 첨부할 수 있습니다.")
    rel_path, size = _save_upload(file, "notices", n.id)
    nf = NoticeFile(
        notice_id=n.id,
        original_filename=file.filename or "file",
        stored_path=rel_path,
        file_size=size,
        uploaded_by=actor.id,
    )
    db.add(nf); db.commit(); db.refresh(nf)
    return {
        "id": nf.id,
        "original_filename": nf.original_filename,
        "stored_path": nf.stored_path,
        "file_size": nf.file_size,
        "download_url": f"/files/{nf.stored_path}",
    }

# ==========================================
# 게시판(BoardPost) CRUD — 누구나 작성/조회, 파일 첨부, 작성자만 삭제
# ==========================================
def _serialize_board_post(p: BoardPost) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "content": p.content or "",
        "author_id": p.author_id,
        "author_name": p.author.name if p.author else "",
        "author_username": p.author.username if p.author else "",
        "author_role": p.author.role if p.author else "",
        "target_team_id": p.target_team_id,
        "target_team_name": p.target_team.name if p.target_team else None,  # NULL = 전체
        "view_count": p.view_count or 0,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
        "files": [{
            "id": f.id,
            "original_filename": f.original_filename,
            "stored_path": f.stored_path,
            "file_size": f.file_size,
            "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
            "download_url": f"/files/{f.stored_path}",
        } for f in (p.files or [])],
    }

class BoardPostCreate(BaseModel):
    actor_username: str
    title: str
    content: Optional[str] = ""
    target_scope: Optional[str] = None  # "all", "<team_id>", 또는 None(자동)

class BoardPostUpdate(BaseModel):
    actor_username: str
    title: Optional[str] = None
    content: Optional[str] = None

# 게시판 가시 범위 — 공지와 동일: sysadmin/admin은 전체, 그 외엔 본인 팀 + 전체 게시판

@app.get("/board/posts", tags=["board"], summary="게시판 글 목록 조회 (role/팀 기반 필터링)", response_model=List[BoardPostOut])
def list_board_posts(viewer_username: Optional[str] = None, db: Session = Depends(get_db)):
    """게시판 글 목록 — viewer의 role/팀에 따라 필터링.
    sysadmin/admin → 모든 글, leader/member → 전체 게시판 + 본인 팀 게시판"""
    q = db.query(BoardPost)
    if viewer_username:
        viewer = db.query(User).filter(User.username == viewer_username).first()
        if viewer and viewer.role not in ADMIN_ROLES:
            my_team = viewer.team_id
            q = q.filter(or_(BoardPost.target_team_id == None, BoardPost.target_team_id == my_team))
    rows = q.order_by(BoardPost.created_at.desc()).all()
    return [_serialize_board_post(p) for p in rows]

@app.get("/board/posts/{post_id}", tags=["board"], summary="게시판 글 상세 조회 (조회수 증가)", response_model=BoardPostOut)
def get_board_post(post_id: int, db: Session = Depends(get_db)):
    p = db.query(BoardPost).filter(BoardPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    p.view_count = (p.view_count or 0) + 1
    db.commit(); db.refresh(p)
    return _serialize_board_post(p)

@app.post("/board/posts", tags=["board"], summary="게시판 글 작성")
def create_board_post(req: BoardPostCreate, db: Session = Depends(get_db)):
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="작성자를 찾을 수 없습니다.")
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="제목은 필수입니다.")

    # 게시 대상 결정 (공지와 동일 패턴)
    target_team = None
    scope = (req.target_scope or "").strip()
    if scope == "":
        target_team = None if (actor.role in ADMIN_ROLES) else actor.team_id
    elif scope == "all":
        target_team = None
    else:
        try:
            tid = int(scope)
        except ValueError:
            raise HTTPException(status_code=400, detail="잘못된 게시 대상입니다.")
        if not db.query(Team).filter(Team.id == tid).first():
            raise HTTPException(status_code=404, detail="대상 팀을 찾을 수 없습니다.")
        if actor.role not in ADMIN_ROLES and tid != actor.team_id:
            raise HTTPException(status_code=403, detail="다른 팀 게시판에 글을 게시할 권한이 없습니다.")
        target_team = tid

    p = BoardPost(
        title=req.title.strip(),
        content=(req.content or "").strip(),
        author_id=actor.id,
        target_team_id=target_team,
    )
    db.add(p); db.commit(); db.refresh(p)
    return _serialize_board_post(p)

@app.put("/board/posts/{post_id}", tags=["board"], summary="게시판 글 수정")
def update_board_post(post_id: int, req: BoardPostUpdate, db: Session = Depends(get_db)):
    p = db.query(BoardPost).filter(BoardPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != p.author_id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="작성자 또는 sysadmin만 수정할 수 있습니다.")
    if req.title is not None:   p.title = req.title.strip()
    if req.content is not None: p.content = req.content
    db.commit(); db.refresh(p)
    return _serialize_board_post(p)

@app.delete("/board/posts/{post_id}", tags=["board"], summary="게시판 글 삭제")
def delete_board_post(post_id: int, actor_username: str, db: Session = Depends(get_db)):
    p = db.query(BoardPost).filter(BoardPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != p.author_id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="작성자 또는 sysadmin만 삭제할 수 있습니다.")
    for f in p.files:
        try:
            (UPLOAD_ROOT / f.stored_path).unlink(missing_ok=True)
        except Exception:
            pass
    db.delete(p); db.commit()
    return {"ok": True}

@app.post("/board/posts/{post_id}/files", tags=["board"], summary="게시판 글 파일 첨부")
async def upload_board_file(
    post_id: int,
    file: UploadFile = File(...),
    actor_username: str = Form(...),
    db: Session = Depends(get_db),
):
    p = db.query(BoardPost).filter(BoardPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="게시글을 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    rel_path, size = _save_upload(file, "board", p.id)
    bf = BoardFile(
        post_id=p.id,
        original_filename=file.filename or "file",
        stored_path=rel_path,
        file_size=size,
        uploaded_by=actor.id,
    )
    db.add(bf); db.commit(); db.refresh(bf)
    return {
        "id": bf.id,
        "original_filename": bf.original_filename,
        "stored_path": bf.stored_path,
        "file_size": bf.file_size,
        "download_url": f"/files/{bf.stored_path}",
    }

@app.delete("/board/posts/{post_id}/files/{file_id}", tags=["board"], summary="게시판 글 첨부파일 삭제")
def delete_board_file(post_id: int, file_id: int, actor_username: str, db: Session = Depends(get_db)):
    bf = db.query(BoardFile).filter(BoardFile.id == file_id, BoardFile.post_id == post_id).first()
    if not bf:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    p = db.query(BoardPost).filter(BoardPost.id == post_id).first()
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor or not p:
        raise HTTPException(status_code=404, detail="호출자/게시글을 찾을 수 없습니다.")
    if actor.id != bf.uploaded_by and actor.id != p.author_id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="삭제 권한이 없습니다.")
    try:
        (UPLOAD_ROOT / bf.stored_path).unlink(missing_ok=True)
    except Exception:
        pass
    db.delete(bf); db.commit()
    return {"ok": True}

# ==========================================
# 건의사항(FeedbackPost) CRUD — 모든 role 작성, 관리자만 전체 조회
# ==========================================
class FeedbackPostCreate(BaseModel):
    actor_username: str
    title: str
    content: Optional[str] = None

def _serialize_feedback_post(p: FeedbackPost) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "content": p.content or "",
        "author_id": p.author_id,
        "author_name": p.author.name if p.author else "",
        "author_username": p.author.username if p.author else "",
        "author_role": p.author.role if p.author else "",
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "files": [{
            "id": f.id,
            "original_filename": f.original_filename,
            "file_size": f.file_size,
            "download_url": f"/files/{f.stored_path}",
        } for f in (p.files or [])],
    }


@app.get("/feedback/posts", tags=["feedback"], summary="건의사항 목록 조회 (admin: 전체, 그 외: 본인만)", response_model=List[FeedbackPostOut])
def list_feedback_posts(viewer_username: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(FeedbackPost)
    if viewer_username:
        viewer = db.query(User).filter(User.username == viewer_username).first()
        if viewer and viewer.role not in ADMIN_ROLES:
            q = q.filter(FeedbackPost.author_id == viewer.id)
    rows = q.order_by(FeedbackPost.created_at.desc()).all()
    return [_serialize_feedback_post(p) for p in rows]

@app.post("/feedback/posts", tags=["feedback"], summary="건의사항 작성")
def create_feedback_post(req: FeedbackPostCreate, db: Session = Depends(get_db)):
    actor = db.query(User).filter(User.username == req.actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="작성자를 찾을 수 없습니다.")
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="제목은 필수입니다.")
    p = FeedbackPost(
        title=req.title.strip(),
        content=(req.content or "").strip(),
        author_id=actor.id,
    )
    db.add(p); db.commit(); db.refresh(p)
    return _serialize_feedback_post(p)

@app.delete("/feedback/posts/{post_id}", tags=["feedback"], summary="건의사항 삭제 (작성자 또는 admin)")
def delete_feedback_post(post_id: int, actor_username: str, db: Session = Depends(get_db)):
    p = db.query(FeedbackPost).filter(FeedbackPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="건의사항을 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != p.author_id and actor.role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="작성자 또는 관리자만 삭제할 수 있습니다.")
    for f in p.files:
        try:
            (UPLOAD_ROOT / f.stored_path).unlink(missing_ok=True)
        except Exception:
            pass
    db.delete(p); db.commit()
    return {"ok": True}

@app.post("/feedback/posts/{post_id}/files", tags=["feedback"], summary="건의사항 파일 첨부")
async def upload_feedback_file(
    post_id: int,
    file: UploadFile = File(...),
    actor_username: str = Form(...),
    db: Session = Depends(get_db),
):
    p = db.query(FeedbackPost).filter(FeedbackPost.id == post_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="건의사항을 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    rel_path, size = _save_upload(file, "feedback", p.id)
    ff = FeedbackFile(
        post_id=p.id,
        original_filename=file.filename or "file",
        stored_path=rel_path,
        file_size=size,
        uploaded_by=actor.id,
    )
    db.add(ff); db.commit(); db.refresh(ff)
    return {
        "id": ff.id,
        "original_filename": ff.original_filename,
        "stored_path": ff.stored_path,
        "file_size": ff.file_size,
        "download_url": f"/files/{ff.stored_path}",
    }

# ==========================================
# 프로필 이미지 업로드 — 본인만, uploads/profile/{user_id}/
# ==========================================
@app.post("/users/{username}/profile-image", tags=["users"], summary="프로필 이미지 업로드")
async def upload_profile_image(
    username: str,
    file: UploadFile = File(...),
    actor_username: str = Form(...),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != user.id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="본인 또는 sysadmin만 변경할 수 있습니다.")
    # 컨텐츠 타입 검증 (이미지만, jpg/png/gif/webp)
    ALLOWED_IMG = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}
    if (file.content_type or "") not in ALLOWED_IMG:
        raise HTTPException(status_code=400, detail="jpg/png/gif/webp 이미지만 업로드 가능합니다.")
    # 기존 파일 삭제
    if user.profile_image:
        try: (UPLOAD_ROOT / user.profile_image).unlink(missing_ok=True)
        except Exception: pass
    rel_path, size = _save_upload(file, "profile", user.id)
    # 5MB 초과면 즉시 삭제하고 에러
    if size > 5 * 1024 * 1024:
        try: (UPLOAD_ROOT / rel_path).unlink(missing_ok=True)
        except Exception: pass
        raise HTTPException(status_code=400, detail="이미지는 최대 5MB까지 업로드 가능합니다.")
    user.profile_image = rel_path
    db.commit(); db.refresh(user)
    return {
        "username": user.username,
        "profile_image": user.profile_image,
        "profile_image_url": f"/files/{user.profile_image}",
        "file_size": size,
    }

@app.delete("/users/{username}/profile-image", tags=["users"], summary="프로필 이미지 삭제")
def delete_profile_image(username: str, actor_username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="유저를 찾을 수 없습니다.")
    actor = db.query(User).filter(User.username == actor_username).first()
    if not actor:
        raise HTTPException(status_code=404, detail="호출자를 찾을 수 없습니다.")
    if actor.id != user.id and actor.role != "sysadmin":
        raise HTTPException(status_code=403, detail="본인 또는 sysadmin만 변경할 수 있습니다.")
    if user.profile_image:
        try: (UPLOAD_ROOT / user.profile_image).unlink(missing_ok=True)
        except Exception: pass
        user.profile_image = None
        db.commit()
    return {"ok": True}


# ==========================================
# 대시보드 최근 활동 — 5종 활동을 union해서 시간순으로 반환
# ==========================================
@app.get("/activities", tags=["activities"], summary="활동 피드 조회 (role-aware)")
def list_activities(viewer_username: str = "", limit: int = 20, db: Session = Depends(get_db)):
    """
    role-aware activity feed:
    - sysadmin/admin → 모든 팀의 활동
    - leader/member → 본인 팀 + 전체 공지/게시판 + 본인 등장 항목
    """
    viewer = None
    if viewer_username:
        viewer = db.query(User).filter(User.username == viewer_username).first()
    is_global = bool(viewer and viewer.role in ("sysadmin", "admin"))
    viewer_team_id = viewer.team_id if viewer else None
    items = []

    def add(when, kind, text, actor=None, team_id=None, link=None):
        if when is None:
            return
        items.append({
            "when":  when.isoformat() if hasattr(when, "isoformat") else str(when),
            "_when_dt": when,    # 정렬용 (응답 직전 제거)
            "kind":  kind,
            "text":  text,
            "actor": actor or "",
            "team_id": team_id,
            "link":  link or "",
        })

    # 1) 보고서 제출/승인/반려
    try:
        for r in db.query(Report).all():
            target = r.target
            if r.submitted_at:
                add(r.submitted_at, "report_submitted",
                    f"[보고서 제출] {target.name if target else ''} → '{r.title}'",
                    actor=target.name if target else "", team_id=target.team_id if target else None,
                    link=f"report:{r.id}")
            if r.reviewed_at and r.status in ("승인", "반려"):
                req = r.requester
                add(r.reviewed_at, f"report_{r.status}",
                    f"[보고서 {r.status}] {req.name if req else ''}: '{r.title}'",
                    actor=req.name if req else "", team_id=target.team_id if target else None,
                    link=f"report:{r.id}")
    except Exception as e:
        print(f"[activities] reports fetch failed: {e}")

    # 2) 공지 등록
    try:
        for n in db.query(Notice).all():
            creator = n.creator
            add(n.created_at, "notice_created",
                f"[공지] '{n.title}'" + (" (중요)" if n.important else ""),
                actor=creator.name if creator else "", team_id=n.target_team_id,
                link=f"notice:{n.id}")
    except Exception as e:
        print(f"[activities] notices fetch failed: {e}")

    # 3) 게시판 글
    try:
        for b in db.query(BoardPost).all():
            author = b.author if hasattr(b, "author") else None
            add(b.created_at, "board_post",
                f"[게시판] '{b.title}'",
                actor=author.name if author else "", team_id=getattr(b, "target_team_id", None),
                link=f"board:{b.id}")
    except Exception as e:
        print(f"[activities] board fetch failed: {e}")

    # 4) 신규 회원 가입 — created_at IS NOT NULL 인 사람만
    try:
        for u in db.query(User).filter(User.created_at.isnot(None)).all():
            add(u.created_at, "user_registered",
                f"[신규 가입] {u.name}",
                actor=u.name or "", team_id=u.team_id,
                link=f"user:{u.username}")
    except Exception as e:
        print(f"[activities] users fetch failed: {e}")

    # 5) 업무 완료 — Task.updated_at + status='완료'
    try:
        for t in db.query(Task).filter(Task.status == "완료").all():
            assignee = t.assignee
            add(t.updated_at, "task_completed",
                f"[업무 완료] {assignee.name if assignee else ''}: '{t.title}'",
                actor=assignee.name if assignee else "",
                team_id=assignee.team_id if assignee else None,
                link=f"task:{t.id}")
    except Exception as e:
        print(f"[activities] tasks fetch failed: {e}")

    # 6) ToDo 팀장 보고 — Task로 자동 등록되므로 위 5)에 이미 포함됨 (생략)

    # role 필터
    if not is_global and viewer is not None:
        items = [i for i in items
                 if (i["team_id"] is None) or (i["team_id"] == viewer_team_id)]

    # 정렬: 최신순. None 는 맨 뒤로
    items.sort(key=lambda i: i["_when_dt"] or datetime.min, reverse=True)
    items = items[:max(1, min(int(limit or 20), 100))]
    # 정렬용 임시 필드 제거
    for it in items:
        it.pop("_when_dt", None)
    return items
