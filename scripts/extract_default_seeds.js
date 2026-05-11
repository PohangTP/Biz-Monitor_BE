/**
 * extract_default_seeds.js (1회용)
 *
 * project-frame.html에 하드코딩된 WBS_DATA / TODO_DATA / RISKS / RESP 를
 * default_seeds.json 으로 추출한다.
 *
 * 실행: node scripts/extract_default_seeds.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRAME_PATH = path.join(__dirname, '..', 'project-frame.html');
const OUT_PATH   = path.join(__dirname, '..', 'default_seeds.json');

const html = fs.readFileSync(FRAME_PATH, 'utf-8');

// "let X = ...;" 또는 "let X={...};" / "let X=[...];" 형태를 찾아 evaluation 가능한 JS로 추출
function extractDecl(html, name) {
  // let NAME=...
  const re = new RegExp(`let\\s+${name}\\s*=\\s*([\\s\\S]*?);\\s*\\n(?=\\s*(?://|let|const|function|var|\\}))`);
  const m = html.match(re);
  if (!m) throw new Error(`couldn't find: ${name}`);
  return m[1];
}

// 더 단순한 접근: 알려진 시작 줄에서 첫 닫는 괄호까지 잡기
function extractByLineMarker(html, startMarker) {
  const i = html.indexOf(startMarker);
  if (i < 0) throw new Error(`marker not found: ${startMarker}`);
  // marker 다음 첫 "=" 다음의 [ 또는 { 시작
  let p = html.indexOf('=', i) + 1;
  while (p < html.length && /\s/.test(html[p])) p++;
  const open = html[p];
  const close = open === '[' ? ']' : '}';
  let depth = 0, q = null;
  let j = p;
  for (; j < html.length; j++) {
    const c = html[j];
    if (q) {
      if (c === '\\') { j++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) { j++; break; }
    }
  }
  return html.slice(p, j);
}

// vm.runInNewContext 로 객체 리터럴 평가
function evalLiteral(src) {
  return vm.runInNewContext(`(${src})`, {});
}

const wbsSrc   = extractByLineMarker(html, 'let WBS_DATA');
const todoSrc  = extractByLineMarker(html, 'let TODO_DATA');
const risksSrc = extractByLineMarker(html, 'let RISKS');
const respSrc  = extractByLineMarker(html, 'let RESP=');

const seeds = {
  wbs:   evalLiteral(wbsSrc),
  todos: evalLiteral(todoSrc),
  risks: evalLiteral(risksSrc),
  resp:  evalLiteral(respSrc),
};

fs.writeFileSync(OUT_PATH, JSON.stringify(seeds, null, 2), 'utf-8');

console.log(`OK: wbs=${seeds.wbs.length} items, todos groups=${Object.keys(seeds.todos).length}, ` +
            `risks=${seeds.risks.length}, resp=${Object.keys(seeds.resp).length}`);
console.log(`-> ${OUT_PATH}`);
