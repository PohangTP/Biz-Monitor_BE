from fastapi import FastAPI, Depends
from fastapi import Body
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, ForeignKey, Table
from sqlalchemy.orm import declarative_base, sessionmaker, relationship, Session
from pydantic import BaseModel
from typing import Optional

# 서버 시동 명령어 (터미널에서 실행하세요!):
# uvicorn main:app --host 0.0.0.0 -- port 8000 --reload

# 1. MySQL 연결 설정 (본인 비밀번호로 꼭 변경하세요!)
DB_URL = "mysql+pymysql://root:root@localhost:3306/pms_db" 

engine = create_engine(DB_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 🚀 [추가] 1. 유저와 프로젝트를 연결하는 '다리' 테이블
user_projects = Table(
    'user_projects', Base.metadata,
    Column('user_id', Integer, ForeignKey('users.id')),
    # 프로젝트 id가 문자열(String)이라면 String, 숫자라면 Integer로 맞춰주세요!
    Column('project_id', String(50), ForeignKey('projects.id')) 
)

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
    team = relationship("Team", back_populates="users")
    projects = relationship("Project", secondary=user_projects, back_populates="users")

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
    
    # 🔥 사업비 컬럼: 중복 제거 및 Integer(숫자)로 완벽 통일!
    gov_fund = Column(Integer, default=0)
    local_fund = Column(Integer, default=0)
    etc_fund = Column(Integer, default=0)
    total_budget = Column(Integer, default=0)
    
    created_at = Column(String(50), nullable=True)
    
    team_id = Column(Integer, ForeignKey("teams.id"))
    team = relationship("Team", back_populates="projects")    
    users = relationship("User", secondary=user_projects, back_populates="projects")
    
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
    
    # 🔥 사업비 규칙: 중복 제거 및 int(숫자)로 통일!
    govFund: Optional[int] = 0
    localFund: Optional[int] = 0
    etcFund: Optional[int] = 0
    totalBudget: Optional[int] = 0
    
    createdAt: Optional[str] = ""
    
# ==========================================
# [추가] 집행 내역 데이터베이스 테이블
# ==========================================
class Execution(Base):
    __tablename__ = "executions"
    id = Column(String(50), primary_key=True, index=True)
    project_id = Column(String(50), index=True) # 어떤 사업에 속한 내역인지 연결
    item = Column(String(100), nullable=False)  # 항목명
    date = Column(String(20), nullable=True)    # 집행 일자
    amount = Column(Integer, default=0)         # 집행 금액

# ==========================================
# [추가] 집행 내역 검증 규칙 (Pydantic 스키마)
# ==========================================
class ExecutionCreate(BaseModel):
    id: str
    projId: str
    item: str
    date: str
    amount: int

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
app = FastAPI(title="부서 사업 관리 백엔드")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/projects")
def get_projects(db: Session = Depends(get_db)):
    return db.query(Project).all()

# 🚀 [수정] 전체 조회가 아닌, '우리 팀' 프로젝트만 조회하는 API
@app.get("/teams/{team_name}/projects")
def get_team_projects(team_name: str, db: Session = Depends(get_db)):
    # 1. 팀을 찾습니다.
    team = db.query(Team).filter(Team.name == team_name).first()
    if not team:
        return [] # 팀이 없으면 빈 목록 반환
    
    # 2. 해당 팀에 속한 프로젝트만 반환합니다.
    return [{"id": p.id, "name": p.name} for p in team.projects]

# 🚀 [추가 확인] ProjectCreate 모델에 team_name이 들어갈 자리가 있어야 합니다!
# (기존 ProjectCreate 클래스 맨 아래에 아래 한 줄을 꼭 추가해 주세요)
# team_name: str 

@app.post("/projects")
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
    return {"message": f"'{project.name}' 프로젝트가 {project.team_name}에 성공적으로 저장되었습니다!"}

@app.put("/projects/{project_id}")
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
        db_key = field_mapping.get(key, key) # 매핑된 이름이 있으면 그걸 쓰고, 없으면 그대로 씀
        if hasattr(db_project, db_key):
            setattr(db_project, db_key, value)
            
    db.commit() # 변경사항 저장 도장 쾅!
    return {"message": f"'{project_id}' 프로젝트가 성공적으로 수정되었습니다!"}

# ==========================================
# [수정] 프로젝트 삭제 API (관련된 집행 내역도 함께 삭제!)
# ==========================================
@app.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    # 1. 🚀 [핵심 추가] 이 프로젝트에 속한 '집행 내역'들을 먼저 찾아내서 싹 지웁니다!
    db.query(Execution).filter(Execution.project_id == project_id).delete()
    
    # 2. 그런 다음 '프로젝트' 본체를 찾아서 지웁니다.
    db_project = db.query(Project).filter(Project.id == project_id).first()
    if db_project:
        db.delete(db_project)
        
    # 3. 변경사항을 한 번에 DB에 저장(도장 쾅!)
    db.commit()
    
    return {"message": "프로젝트와 관련된 모든 내역이 삭제되었습니다."}

# ==========================================
# [추가] 집행 내역 관련 API
# ==========================================
@app.get("/executions")
def get_executions(db: Session = Depends(get_db)):
    return db.query(Execution).all()

@app.post("/executions")
def create_execution(exec_data: ExecutionCreate, db: Session = Depends(get_db)):
    db_exec = Execution(
        id=exec_data.id,
        project_id=exec_data.projId, # 프론트엔드의 projId를 DB의 project_id에 맞춤
        item=exec_data.item,
        date=exec_data.date,
        amount=exec_data.amount
    )
    db.add(db_exec)
    db.commit()
    return {"message": "success"}

@app.delete("/executions/{exec_id}")
def delete_execution(exec_id: str, db: Session = Depends(get_db)):
    db_exec = db.query(Execution).filter(Execution.id == exec_id).first()
    if db_exec:
        db.delete(db_exec)
        db.commit()
    return {"message": "deleted"}

from fastapi import HTTPException

# ==========================================
# [추가] 인증(Auth) 관련 API
# ==========================================
@app.post("/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
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

    # 3. 유저 생성 (비밀번호는 추후 보안을 위해 해싱해야 하지만, 현재는 직관적으로 문자열 저장)
    new_user = User(
        username=req.username,
        password=req.password,
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

@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or user.password != req.password:
        raise HTTPException(status_code=401, detail="아이디 또는 비밀번호가 틀렸습니다.")

    # 🚀 [수정] 로그인 성공 시 사용자의 이름, 아이디, 팀명을 함께 반환합니다.
    return {
        "message": "로그인 성공",
        "user": {
            "name": user.name,
            "username": user.username,
            "team_name": user.team.name if user.team else "미배정",
            "role": user.role
        }
    }
    
# 🚀 [추가] 팀 생성 시 사용할 데이터 모델
class TeamCreate(BaseModel):
    name: str

# 🚀 [추가] 1. 전체 팀 목록 조회 API
@app.get("/teams")
def get_teams(db: Session = Depends(get_db)):
    teams = db.query(Team).all()
    # 팀 ID와 이름을 리스트로 반환합니다.
    return [{"id": t.id, "name": t.name} for t in teams]

# 🚀 [추가] 2. 신규 팀 추가 API
@app.post("/teams")
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
@app.delete("/teams/{team_name}")
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

@app.put("/teams/{team_id}")
def update_team(team_id: int, req: TeamUpdate, db: Session = Depends(get_db)):
    # 1. 수정할 팀을 찾습니다.
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="팀을 찾을 수 없습니다.")
    
    # 2. 혹시 바꾸려는 이름이 이미 다른 팀이 쓰고 있는 이름인지 확인합니다.
    existing = db.query(Team).filter(Team.name == req.name, Team.id != team_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="이미 존재하는 팀명입니다.")
    
    # 3. 이름을 변경하고 저장합니다.
    team.name = req.name
    db.commit()
    
    return {"message": "팀명 수정 완료"}

# 🚀 [추가] 유저(팀원) 목록 조회 API
@app.get("/users")
def get_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    
    result = []
    for u in users:
        result.append({
            "id": u.id,
            "name": u.name,
            "username": u.username,
            # 관계 설정된 팀 객체가 있으면 팀 이름을, 없으면 '미배정'을 반환
            "team_name": u.team.name if u.team else "미배정", 
            "pos": u.pos if u.pos else "",
            "role": u.role
        })
    return result

# 🚀 [추가] 특정 팀의 소속 유저만 가져오는 API
@app.get("/teams/{team_name}/users")
def get_users_by_team(team_name: str, db: Session = Depends(get_db)):
    # 1. 해당 팀을 먼저 찾습니다.
    team = db.query(Team).filter(Team.name == team_name).first()
    if not team:
        raise HTTPException(status_code=404, detail="팀을 찾을 수 없습니다.")
    
    # 2. 해당 팀에 속한 유저만 가져옵니다.
    users = db.query(User).filter(User.team_id == team.id).all()
    
    result = []
    for u in users:
        result.append({
            "id": u.id,
            "name": u.name,
            "username": u.username,
            "team_name": team.name, 
            "pos": u.pos if u.pos else "",
            "role": u.role
        })
    return result