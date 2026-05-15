"""
default_seeds.py
신규 사업 생성 시 시드로 들어가는 기본 데이터들을 default_seeds.json에서 로드.
"""
import json, os

_SEED_PATH = os.path.join(os.path.dirname(__file__), "default_seeds.json")
with open(_SEED_PATH, "r", encoding="utf-8") as f:
    _SEEDS = json.load(f)

DEFAULT_WBS_ITEMS    = _SEEDS["wbs"]      # list of dicts
DEFAULT_TODOS_BY_WBS = _SEEDS["todos"]    # {wbsId: [...todos...]}
DEFAULT_RISKS        = _SEEDS["risks"]    # list of risk dicts
DEFAULT_RESPONSES    = _SEEDS["resp"]     # {riskId: {...response...}}
