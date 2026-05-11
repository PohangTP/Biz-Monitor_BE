"""
backfill_default_seeds.py (1회용)

Phase 3-A 이전에 생성된 기존 사업들에 디폴트 시드 데이터를 채워넣는다.
- wbs_data / todos_data / risks_data / resp_data 가 NULL 인 사업만 대상.
- 이미 데이터가 있는 사업은 건드리지 않는다 (사용자가 편집한 데이터 보존).
- WBS 시드를 채우면 Project.progress 도 자동으로 평균치로 갱신됨.

실행: venv/Scripts/python.exe scripts/backfill_default_seeds.py
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main  # 모델·DB 연결 로드 (마이그레이션도 자동 실행)
from main import SessionLocal, Project, _recalc_project_progress
from default_seeds import (
    DEFAULT_WBS_ITEMS, DEFAULT_TODOS_BY_WBS,
    DEFAULT_RISKS, DEFAULT_RESPONSES,
)

WBS_JSON   = json.dumps(DEFAULT_WBS_ITEMS,    ensure_ascii=False)
TODOS_JSON = json.dumps(DEFAULT_TODOS_BY_WBS, ensure_ascii=False)
RISKS_JSON = json.dumps(DEFAULT_RISKS,        ensure_ascii=False)
RESP_JSON  = json.dumps(DEFAULT_RESPONSES,    ensure_ascii=False)

db = SessionLocal()
try:
    projects = db.query(Project).all()
    print(f"=== 사업 총 {len(projects)}개 검사 ===")
    n_wbs = n_todos = n_risks = n_resp = n_progress = 0
    for p in projects:
        changed = False
        if not p.wbs_data:
            p.wbs_data = WBS_JSON; n_wbs += 1; changed = True
        if not p.todos_data:
            p.todos_data = TODOS_JSON; n_todos += 1; changed = True
        if not p.risks_data:
            p.risks_data = RISKS_JSON; n_risks += 1; changed = True
        if not p.resp_data:
            p.resp_data = RESP_JSON; n_resp += 1; changed = True
        if changed:
            print(f"  [{p.id}] {p.name}: 시드 채움")

    db.commit()

    # 진행율 갱신 — WBS가 새로 채워진 사업에 대해
    if n_wbs > 0:
        for p in projects:
            try:
                _recalc_project_progress(db, p.id)
                n_progress += 1
            except Exception as e:
                print(f"  [{p.id}] progress 갱신 실패: {e}")
        db.commit()

    print()
    print(f"WBS  채움: {n_wbs}개")
    print(f"ToDo 채움: {n_todos}개")
    print(f"Risk 채움: {n_risks}개")
    print(f"Resp 채움: {n_resp}개")
    print(f"Progress 갱신: {n_progress}개")
finally:
    db.close()
