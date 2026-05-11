"""
WBS ID 컨벤션 정상화 (1회용)
- level=1 항목의 wbsId가 "N.0" → "N"
- 시드 파일(default_seeds.json) + 기존 사업 DB 모두 변환
- todos_data의 키는 stable id(예: 'w-1_1', 'org-1')라서 변경 불필요
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 1) default_seeds.json 변환
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_PATH = os.path.join(HERE, "default_seeds.json")

with open(SEED_PATH, "r", encoding="utf-8") as f:
    seeds = json.load(f)

n_changed = 0
for w in seeds.get("wbs", []):
    if w.get("level") == 1:
        wid = w.get("wbsId", "")
        if wid.endswith(".0"):
            new = wid[:-2]
            print(f"[seed] {wid} -> {new}  ({w.get('name')})")
            w["wbsId"] = new
            n_changed += 1

with open(SEED_PATH, "w", encoding="utf-8") as f:
    json.dump(seeds, f, ensure_ascii=False, indent=2)
print(f"default_seeds.json: {n_changed}개 항목 변환")

# 2) DB의 모든 사업에 동일 변환 + 진행률 재계산
import main  # 모델·DB 로드
from main import SessionLocal, Project, _recalc_project_progress

db = SessionLocal()
try:
    projs = db.query(Project).all()
    n_proj_changed = 0
    n_recalc = 0
    for p in projs:
        if not p.wbs_data:
            continue
        try:
            d = json.loads(p.wbs_data)
            items = d if isinstance(d, list) else (d.get("items") or [])
        except Exception:
            continue
        if not items:
            continue
        changed = False
        for w in items:
            if w.get("level") == 1:
                wid = w.get("wbsId", "")
                if wid.endswith(".0"):
                    w["wbsId"] = wid[:-2]
                    changed = True
        if changed:
            p.wbs_data = json.dumps(items, ensure_ascii=False)
            n_proj_changed += 1
            print(f"[db] {p.id} ({p.name}): wbsId 변환")
        # 진행률 재계산 — wbs_data 변경됐든 아니든 모두 (progress_pct 갱신)
        _recalc_project_progress(db, p.id)
        n_recalc += 1
    db.commit()
    print(f"DB: {n_proj_changed}개 사업 wbsId 변환, {n_recalc}개 진행률 재계산")
finally:
    db.close()
