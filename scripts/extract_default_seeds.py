"""
extract_default_seeds.py (1회용)

project-frame.html의 WBS_DATA / TODO_DATA / RISKS / RESP를
default_seeds.json으로 추출.

실행: py scripts/extract_default_seeds.py
"""
import os, sys, re, json

HERE = os.path.dirname(os.path.abspath(__file__))
FRAME_PATH = os.path.join(HERE, "..", "project-frame.html")
OUT_PATH   = os.path.join(HERE, "..", "default_seeds.json")

with open(FRAME_PATH, "r", encoding="utf-8") as f:
    html = f.read()

def extract_by_marker(html, start_marker):
    """`let NAME = ...;` 형태에서 = 다음 첫 [ 또는 { 부터 매칭되는 닫는 괄호까지."""
    i = html.find(start_marker)
    if i < 0:
        raise RuntimeError(f"marker not found: {start_marker}")
    # marker 다음 '=' 위치 → 첫 [ or { 까지
    p = html.index("=", i) + 1
    while p < len(html) and html[p].isspace():
        p += 1
    open_ch = html[p]
    close_ch = "]" if open_ch == "[" else "}"
    depth = 0
    quote = None
    j = p
    while j < len(html):
        c = html[j]
        if quote:
            if c == "\\":
                j += 2
                continue
            if c == quote:
                quote = None
            j += 1
            continue
        if c in ('"', "'", "`"):
            quote = c
            j += 1
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                j += 1
                break
        j += 1
    return html[p:j]

def js_to_json(src):
    """
    JS 객체 리터럴 → JSON.
    - 키에 쿼트 없는 식별자에 따옴표 추가: {key:val} → {"key":val}
    - 작은따옴표 → 큰따옴표
    - trailing 콤마 제거
    문자열 안의 콜론/콤마/괄호는 건드리지 않도록 토큰별 처리.
    """
    out = []
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        # 문자열 (single 또는 double quote) — 그대로 두되 single을 double로 바꾸고 내부 escape 보존
        if c == "'":
            # closing single quote 찾기 (escape \' 처리)
            j = i + 1
            buf = ['"']
            while j < n:
                if src[j] == "\\":
                    buf.append(src[j])
                    if j + 1 < n:
                        buf.append(src[j+1])
                        j += 2
                        continue
                if src[j] == "'":
                    buf.append('"')
                    j += 1
                    break
                # 이미 안에 있던 " 는 escape
                if src[j] == '"':
                    buf.append('\\"')
                else:
                    buf.append(src[j])
                j += 1
            out.append("".join(buf))
            i = j
            continue
        if c == '"':
            j = i + 1
            buf = ['"']
            while j < n:
                if src[j] == "\\":
                    buf.append(src[j])
                    if j + 1 < n:
                        buf.append(src[j+1])
                        j += 2
                        continue
                if src[j] == '"':
                    buf.append('"')
                    j += 1
                    break
                buf.append(src[j])
                j += 1
            out.append("".join(buf))
            i = j
            continue
        # 주석 //... 또는 /* ... */
        if c == "/" and i + 1 < n and src[i+1] == "/":
            j = src.find("\n", i)
            if j < 0: j = n
            i = j
            continue
        if c == "/" and i + 1 < n and src[i+1] == "*":
            j = src.find("*/", i + 2)
            if j < 0: j = n
            else: j += 2
            i = j
            continue
        out.append(c)
        i += 1
    s = "".join(out)
    # 키에 따옴표 추가: { key: ... 또는 , key: ...
    s = re.sub(r'([{\s,])([A-Za-z_$][A-Za-z0-9_$]*)\s*:', r'\1"\2":', s)
    # trailing comma 제거 (JSON은 허용 안 함)
    s = re.sub(r',(\s*[}\]])', r'\1', s)
    return s

print("[extract] reading project-frame.html ...")
wbs_src   = extract_by_marker(html, "let WBS_DATA")
todo_src  = extract_by_marker(html, "let TODO_DATA")
risks_src = extract_by_marker(html, "let RISKS")
resp_src  = extract_by_marker(html, "let RESP=")

seeds = {}
for name, src in [("wbs", wbs_src), ("todos", todo_src), ("risks", risks_src), ("resp", resp_src)]:
    json_src = js_to_json(src)
    try:
        seeds[name] = json.loads(json_src)
    except Exception as e:
        # 디버그용 — 어디서 깨졌는지 보기
        snippet_at = e.pos if hasattr(e, "pos") else 0
        print(f"\n[FAIL] {name}: {e}")
        print(f"context near pos {snippet_at}: ...{json_src[max(0,snippet_at-80):snippet_at+80]}...")
        sys.exit(1)

with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(seeds, f, ensure_ascii=False, indent=2)

print(f"OK: wbs={len(seeds['wbs'])} items, "
      f"todos groups={len(seeds['todos'])}, "
      f"risks={len(seeds['risks'])}, "
      f"resp={len(seeds['resp'])}")
print(f"-> {os.path.abspath(OUT_PATH)}")
