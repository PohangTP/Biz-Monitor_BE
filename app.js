// v5 iframe HTML은 별도 파일(project-frame.html)로 추출됨
// ── 인증 키만 sessionStorage로 라우팅 (브라우저 종료 시 자동 로그아웃) ──
// 새로고침/Ctrl+F5는 같은 세션이라 sessionStorage가 유지되어 로그인 상태 유지됨.
(function(){
  const AUTH_KEYS = new Set(['pms_user', 'user_name', 'user_team_name']);
  const origGet    = localStorage.getItem.bind(localStorage);
  const origSet    = localStorage.setItem.bind(localStorage);
  const origRemove = localStorage.removeItem.bind(localStorage);

  // 기존에 localStorage에 남아있던 인증 키들을 sessionStorage로 한 번 이전
  AUTH_KEYS.forEach(k => {
    const v = origGet(k);
    if (v !== null) {
      sessionStorage.setItem(k, v);
      origRemove(k);
    }
  });

  localStorage.getItem = function(key) {
    return AUTH_KEYS.has(key) ? sessionStorage.getItem(key) : origGet(key);
  };
  localStorage.setItem = function(key, value) {
    if (AUTH_KEYS.has(key)) sessionStorage.setItem(key, value);
    else origSet(key, value);
  };
  localStorage.removeItem = function(key) {
    if (AUTH_KEYS.has(key)) sessionStorage.removeItem(key);
    else origRemove(key);
  };
})();

(function(){
  var t=localStorage.getItem('pms-theme')||'light';
  document.body.classList.add('theme-'+t);  // dark도 명시적으로 theme-dark 클래스 부여
  var b=parseInt(localStorage.getItem('pms-brightness')||'100');
  if(b!==100) document.body.style.filter='brightness('+b+'%)';
})();

let currentUser = null;

// API_BASE — hostname은 자동 감지, 포트는 config.js의 PMS_CONFIG.backendPort를 사용
const API_BASE = (() => {
  const port = (window.PMS_CONFIG && window.PMS_CONFIG.backendPort) || 8000;
  const host = location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') return `http://localhost:${port}`;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
})();

// 1. 기존 가짜 데이터 대신 사용할 빈 전역 변수 준비
let PROJECTS_LIST = [];

// 2. DB 데이터를 가져와서 진짜 화면에 뿌려주는 함수
//    role별 사업 가시 범위:
//      sysadmin / admin(부서장)  → 모든 팀의 사업 (/projects)
//      leader (팀장)             → 본인 팀 사업만 (/teams/{team}/projects)
//      member (팀원)             → 모든 사업 fetch 후 권한(granted) 필터로 화면 단계에서 제한
async function fetchProjectsFromDB() {
  try {
    if (!currentUser) return; // 🚀 [핵심 추가] 로그인 안 했으면 바로 종료!
    const role = currentUser.role || 'member';
    const myTeam = (currentUser.dept || localStorage.getItem('user_team_name') || '').trim();
    const url = (role === 'leader' && myTeam)
      ? `${API_BASE}/teams/${encodeURIComponent(myTeam)}/projects`
      : `${API_BASE}/projects`;
    const response = await fetch(url);
    let dbData = await response.json();

    // member: 본인에게 권한 부여된 사업만 필터 (사이드바·대시보드·관리 화면 모두에 자동 반영)
    if (role === 'member') {
      const myUsername = currentUser.gwId || currentUser.username;
      if (myUsername) {
        try {
          const r = await fetch(`${API_BASE}/users/${encodeURIComponent(myUsername)}/projects`);
          const grantedIds = r.ok ? new Set((await r.json()).map(String)) : new Set();
          dbData = dbData.filter(p => grantedIds.has(String(p.id)));
        } catch { /* keep dbData as-is on error */ }
      }
    }

    // 서버에서 가져온 데이터를 진짜 홈페이지 전역 변수에 덮어씌웁니다.
    PROJECTS_LIST = dbData;

    // 💡 핵심: 임시 박스가 아니라, 기존 홈페이지의 진짜 UI 그리기 함수들을 다시 실행합니다!
    if (typeof renderLeaderBizNav === 'function') renderLeaderBizNav();
    if (typeof renderLeaderOverview === 'function') renderLeaderOverview();
    if (typeof renderProjects === 'function') renderProjects(PROJECTS_LIST);
    if (typeof refreshPermBadges === 'function') refreshPermBadges();
    if (typeof renderOverviewStats === 'function') renderOverviewStats();
    
  } catch (error) {
    console.error("서버 통신 에러:", error);
    showToast('DB 연동 실패 ❌');
  }
}

const PROJ_TABS = [
  { tab:'tab-dashboard',   icon:'🏠', name:'종합 대시보드' },
  { tab:'tab-wbs',         icon:'🌿', name:'WBS' },
  { tab:'tab-todo-list',   icon:'☑️', name:'ToDo List' },
  { tab:'tab-list',        icon:'📋', name:'리스크 목록' },
  { tab:'tab-resp',        icon:'🛡️', name:'대응 전략' },
  { tab:'tab-budget',      icon:'💰', name:'예산 관리' },
  { tab:'tab-personnel',   icon:'👤', name:'인력관리' },
  { tab:'tab-deliverable', icon:'📦', name:'산출물' },
];

// 열려있는 프로젝트 ID 추적
let openProjId = { leader: null, member: null };
let activeProjTab = { leader: null, member: null };  // 펼친 사업 안에서 현재 활성 서브 탭 (refreshAllProjectViews용)
let activeProjId = { leader: null, member: null };

function toggleProjGroup(projId, role) {
  const toggle = document.getElementById((role==='leader'?'lpt-':'mpt-') + projId);
  const items  = document.getElementById((role==='leader'?'lpi-':'mpi-') + projId);
  if (!toggle || !items) return;

  const isOpen = toggle.classList.contains('open');
  // 다른 프로젝트 닫기
  PROJECTS_LIST.forEach(p => {
    if (p.id !== projId) {
      const ot = document.getElementById((role==='leader'?'lpt-':'mpt-') + p.id);
      const oi = document.getElementById((role==='leader'?'lpi-':'mpi-') + p.id);
      if (ot) ot.classList.remove('open');
      if (oi) oi.classList.remove('open');
    }
  });
  toggle.classList.toggle('open', !isOpen);
  items.classList.toggle('open', !isOpen);
  openProjId[role] = isOpen ? null : projId;

  // 첫 클릭 시 종합 대시보드 자동 열기
  if (!isOpen) {
    const firstItem = document.getElementById((role==='leader'?'lpitem-':'mpitem-') + projId + '-tab-dashboard');
    if (firstItem) openProjTab(projId, 'tab-dashboard', firstItem, role);
  }
}

// PROJ_TABS에서 파생 — `${icon} ${name}` 형태의 표시 라벨
const PROJ_TAB_LABELS = Object.fromEntries(PROJ_TABS.map(t => [t.tab, `${t.icon} ${t.name}`]));

function openProjTab(projId, tabId, el, role) {
  try {
    if (el) {
      // 수행 사업 sub-item 클릭 시 .nav-item active도 해제
      const page = document.getElementById(`page-${role}`);
      if (page) page.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const container = el.closest('.nav-proj-items') || el.closest('.nav-sub-items');
      if (container) container.querySelectorAll('.nav-proj-item, .nav-sub-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
    }

    const proj = (typeof PROJECTS_LIST !== 'undefined' ? PROJECTS_LIST : []).find(p => String(p.id) === String(projId));
    if (!proj) {
      console.warn('[openProjTab] 프로젝트를 찾을 수 없음:', projId);
      return;
    }
    activeProjId[role] = projId;
    activeProjTab[role] = tabId;

    // 페이지 활성화
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`page-${role}`)?.classList.add('active');

    // 다른 .ltab/.mtab 끄고 #ltab-project / #mtab-project 켜기 (.active 클래스로)
    const prefix = role === 'leader' ? 'l' : 'm';
    document.querySelectorAll(`.${prefix}tab`).forEach(t => {
      t.classList.remove('active');
      t.style.display = '';
    });
    const panel = document.getElementById(`${prefix}tab-project`);
    if (!panel) return;
    panel.classList.add('active');

    // 헤더
    const titleEl = document.getElementById(role + '-project-title');
    const subEl   = document.getElementById(role + '-project-sub');
    if (titleEl) titleEl.textContent = PROJ_TAB_LABELS[tabId] || '🏠 종합 대시보드';
    if (subEl)   subEl.textContent   = proj.name;

    // payload 준비
    let safePartners = [];
    try { safePartners = typeof proj.partners === 'string' ? JSON.parse(proj.partners) : (proj.partners || []); } catch(e) {}
    const payload = {
      type: 'setProjectId',
      projId,
      isNew: false,
      projName:    proj.name,
      projIcon:    proj.icon,
      status:      proj.status,
      startDate:   proj.startDate || proj.start_date,
      endDate:     proj.endDate   || proj.end_date,
      desc:        proj.desc      || proj.description || '',
      agency:      proj.agency    || '',
      host:        proj.host      || '',
      localGov:    proj.localGov  || proj.local_gov || '',
      teamName:    proj.team_name || '',
      pmName:      proj.pm_name   || '',
      totalBudget: Number(proj.totalBudget || proj.total_budget || 0),
      partners:    safePartners,
    };

    const frame   = document.getElementById(`${role}-project-frame`);
    const loading = document.getElementById(`${role}-iframe-loading`);
    if (!frame) {
      console.error(`[openProjTab] iframe ${role}-project-frame을 찾을 수 없음`);
      return;
    }

    // 이미 로드된 iframe만 즉시 표시. 첫 로드 시에는 load 이벤트 후 표시(아래 분기)
    if (frame.dataset.v5Loaded === '1') {
      frame.style.display = 'block';
    }
    frame.style.position = 'absolute';
    frame.style.top      = '0';
    frame.style.left     = '0';
    frame.style.width    = '100%';
    frame.style.height   = '100%';
    frame.style.border   = 'none';

    const applyTeamNameInFrame = () => {
      try {
        const doc = frame.contentDocument || frame.contentWindow?.document;
        const hdTeam = doc?.getElementById('hd-team');
        if (!hdTeam) return;
        hdTeam.contentEditable = 'false';
        hdTeam.style.cursor = 'default';
        hdTeam.title = '담당 팀';
        hdTeam.removeAttribute('onfocus');
        hdTeam.removeAttribute('onblur');
        hdTeam.textContent = payload.teamName || '미배정';
      } catch (e) {
        console.warn('[openProjTab] hd-team 갱신 실패:', e);
      }
    };

    const sendMessages = () => {
      if (loading) loading.style.display = 'none';
      try {
        // 현재 부모 테마 동기화 (iframe이 처음 로드되었을 수도 있으므로 명시적으로 전달)
        frame.contentWindow?.postMessage({ type: 'setTheme', theme: currentTheme }, '*');
        frame.contentWindow?.postMessage({ type: 'switchTab', tab: tabId || 'tab-dashboard' }, '*');
        frame.contentWindow?.postMessage(payload, '*');
      } catch (e) {
        console.error('[openProjTab] postMessage 실패:', e);
      }
      // V5가 setProjectId를 처리한 뒤(헤더 갱신 후) 팀명 주입
      setTimeout(applyTeamNameInFrame, 200);
    };

    if (frame.dataset.v5Loaded === '1') {
      sendMessages();
    } else {
      // 첫 로드: project-frame.html을 fetch해서 srcdoc으로 주입
      // (src=로 두면 일부 환경에서 load 이벤트 타이밍 이슈가 있어 srcdoc 패턴 유지)
      frame.style.display = 'none';
      if (loading) loading.style.display = 'flex';
      frame.addEventListener('load', () => {
        frame.dataset.v5Loaded = '1';
        frame.style.display = 'block';
        sendMessages();
      }, { once: true });
      // cache: 'no-store' — Live Server·브라우저 캐시 무효화 (변경 즉시 반영)
      fetch('project-frame.html', { cache: 'no-store' })
        .then(r => r.text())
        .then(html => { frame.srcdoc = html; })
        .catch(err => {
          console.error('[openProjTab] project-frame.html fetch 실패:', err);
          if (loading) loading.innerHTML = '<div style="color:var(--danger);padding:40px;text-align:center">⚠️ 프로젝트 화면을 불러오지 못했습니다</div>';
        });
    }
  } catch (error) {
    console.error('[openProjTab] 실행 에러:', error);
  }
}

// localStorage에서 권한 불러오기
function loadPermissions() {
  try { return JSON.parse(localStorage.getItem('projectPermissions') || '{}'); }
  catch(e) { return {}; }
}

function savePermsToDisk(perms) {
  localStorage.setItem('projectPermissions', JSON.stringify(perms));
}

function loadPermLog() {
  try { return JSON.parse(localStorage.getItem('permLog') || '[]'); }
  catch(e) { return []; }
}

function savePermLog(log) {
  localStorage.setItem('permLog', JSON.stringify(log.slice(-20)));
}

// 권한 뱃지 업데이트
function refreshPermBadges() {
  const perms = loadPermissions();
  ['김민수','이지현','박성호','최수연','정태양'].forEach(name => {
    const el = document.getElementById('perm-count-' + name);
    if (!el) return;
    const count = (perms[name] || []).length;
    if (count > 0) {
      el.className = 'perm-badge-count';
      el.textContent = count + '개 사업';
    } else {
      el.className = 'perm-badge-none';
      el.textContent = '미배정';
    }
  });
}

// ── 팀원 수행사업 사이드바 렌더링 (권한 기반) ──
function renderMemberProjectMenu() {
  const container = document.getElementById('member-biz-items');
  if (!container) return;
  const perms   = loadPermissions();
  const granted = new Set(perms[currentUser.name] || []);
  // 팀원에게 배정된 프로젝트만 필터
  const myProjects = PROJECTS_LIST.filter(p => granted.has(p.id));

  if (myProjects.length === 0) {
    container.innerHTML = '<div class="nav-sub-no-access">⛔ 배정된 사업이 없습니다<br><span style="font-size:10px">팀장에게 권한을 요청하세요</span></div>';
    return;
  }

  container.innerHTML = myProjects.map(proj => `
    <div class="nav-proj-group" id="mpg-${proj.id}">
      <div class="nav-proj-toggle" id="mpt-${proj.id}"
           onclick="toggleProjGroup('${proj.id}','member')">
        <span class="proj-icon">${proj.icon}</span>
        <span class="proj-name">${proj.name}</span>
        <span class="nav-proj-status ${proj.ps}">${proj.status}</span>
        <span class="proj-arrow">▼</span>
      </div>
      <div class="nav-proj-items" id="mpi-${proj.id}">
        ${PROJ_TABS.map(t => `
          <div class="nav-proj-item" id="mpitem-${proj.id}-${t.tab}"
               onclick="openProjTab('${proj.id}','${t.tab}',this,'member')">
            <span class="pi">${t.icon}</span>${t.name}
          </div>`).join('')}
      </div>
    </div>
  `).join('');
}

// 팀장 수행사업 메뉴도 초기 렌더
function renderLeaderBizNav() {
  const container = document.getElementById('leader-biz-items');
  if (!container) return;
  container.innerHTML = PROJECTS_LIST.map(proj => `
    <div class="nav-proj-group" id="lpg-${proj.id}">
      <div class="nav-proj-toggle" id="lpt-${proj.id}"
           onclick="toggleProjGroup('${proj.id}','leader')">
        <span class="proj-icon">${proj.icon}</span>
        <span class="proj-name">${proj.name}</span>
        <span class="nav-proj-status ${proj.ps}">${proj.status}</span>
        <span class="proj-arrow">▼</span>
      </div>
      <div class="nav-proj-items" id="lpi-${proj.id}">
        ${PROJ_TABS.map(t => `
          <div class="nav-proj-item" id="lpitem-${proj.id}-${t.tab}"
               onclick="openProjTab('${proj.id}','${t.tab}',this,'leader')">
            <span class="pi">${t.icon}</span>${t.name}
          </div>`).join('')}
      </div>
    </div>
  `).join('');
}

// ── 권한 모달 열기 ──
let permModalTarget = null;
let permModalState = {};

// 🚀 [수정] DB 연동형 권한설정 모달 열기
async function openPermModal(name, dept, initial, username) {
  // 1. 기존 변수와 DB 통신용 변수 세팅
  permModalTarget = name;           // 로그 등 화면 UI용
  currentPermUsername = username;   // DB 통신용 (반드시 필요함!)

  // 2. 모달 기본 프로필 정보 채우기
  document.getElementById('perm-modal-ava').textContent = initial;
  document.getElementById('perm-modal-name').textContent = name;
  document.getElementById('perm-modal-dept').textContent = dept;
  document.getElementById('perm-modal-count').textContent = '...'; // 로딩 표시

  // 3. 먼저 모달을 띄워 로딩감을 줍니다.
  document.getElementById('perm-modal').classList.add('open');

  try {
    // 4. 권한 부여 대상 팀원의 팀 사업 목록을 사용 (caller가 dept 인자로 넘겨줌)
    //    sysadmin/admin이 다른 팀 팀원에게 권한 설정할 때도 그 팀원이 속한 팀의 사업이 노출되어야 함
    const targetTeam = (dept || '').trim() || localStorage.getItem('user_team_name') || '';
    const projUrl = targetTeam
      ? `${API_BASE}/teams/${encodeURIComponent(targetTeam)}/projects`
      : `${API_BASE}/projects`;

    // 5. DB에서 '권한 부여 대상이 될 사업 목록'과 '해당 유저의 현재 권한'을 동시에 가져옵니다.
    const [projRes, userProjRes] = await Promise.all([
      fetch(projUrl),
      fetch(`${API_BASE}/users/${encodeURIComponent(username)}/projects`)
    ]);

    const teamProjects = await projRes.json();
    const userProjects = await userProjRes.json();

    // 6. 🌟 [핵심] 선생님의 기존 로직(renderPermProjectList)을 그대로 쓰기 위한 상태 동기화!
    // DB에서 가져온 프로젝트 목록을 전역 변수에 덮어씌웁니다.
    window.PROJECTS_LIST = teamProjects; 
    
    // 모달 상태(체크 여부) 객체를 DB 데이터 기준으로 새로 만듭니다.
    permModalState = {};
    teamProjects.forEach(p => { 
      permModalState[p.id] = userProjects.includes(p.id); 
    });

    // 7. 카운트 갱신 및 기존 렌더링 함수 호출
    document.getElementById('perm-modal-count').textContent = userProjects.length;
    
    if (typeof renderPermProjectList === 'function') {
      renderPermProjectList(); // 선생님이 만들어두신 예쁜 리스트 그리기 함수가 그대로 작동합니다!
    }

  } catch (err) {
    console.error("권한 데이터 로드 에러:", err);
    document.getElementById('perm-modal-count').textContent = '오류';
  }

  // 8. 활동 로그 (이 부분은 추후 DB화하기 전까지 기존 선생님의 로컬 로직을 그대로 유지합니다)
  try {
    const log = loadPermLog().filter(l => l.member === name).reverse().slice(0,5);
    const logEl = document.getElementById('perm-activity-log');
    if (logEl) {
      logEl.innerHTML = log.length
        ? log.map(l => `<div>● ${l.time} — ${l.action}</div>`).join('')
        : '<div style="color:var(--text3)">변경 이력이 없습니다.</div>';
    }
  } catch (e) {
    console.warn("로그 로드 건너뜀", e);
  }
}

function renderPermProjectList() {
  const list = document.getElementById('perm-project-list');
  list.innerHTML = PROJECTS_LIST.map(p => `
    <div class="perm-project-item ${permModalState[p.id] ? 'granted' : ''}"
         id="perm-item-${p.id}" onclick="togglePermItem('${p.id}')">
      <div class="perm-project-left">
        <span class="perm-project-icon">${p.icon}</span>
        <div>
          <div class="perm-project-name">${p.name}</div>
          <div class="perm-project-status">
            <span class="badge ${p.statusClass}" style="font-size:10px">${p.status}</span>
          </div>
        </div>
      </div>
      <div class="perm-toggle ${permModalState[p.id] ? 'on' : ''}" id="ptoggle-${p.id}"></div>
    </div>
  `).join('');
  updatePermCount();
}

function togglePermItem(projectId) {
  permModalState[projectId] = !permModalState[projectId];
  const item = document.getElementById('perm-item-' + projectId);
  const tog = document.getElementById('ptoggle-' + projectId);
  item.classList.toggle('granted', permModalState[projectId]);
  tog.classList.toggle('on', permModalState[projectId]);
  updatePermCount();
}

function updatePermCount() {
  const count = Object.values(permModalState).filter(Boolean).length;
  document.getElementById('perm-modal-count').textContent = count;
}

function closePermModal() {
  document.getElementById('perm-modal').classList.remove('open');
  permModalTarget = null;
}

async function savePermissions() {
  if (!permModalTarget || !currentPermUsername) return;
  const afterArr = Object.keys(permModalState).filter(k => permModalState[k]);
  const afterSet = new Set(afterArr);

  try {
    // 1) DB로 sync 요청 (요청 목록과 기존을 비교해 추가/삭제, rate=0/role=참여연구원 디폴트로 신규 행 생성)
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(currentPermUsername)}/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_ids: afterArr }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 권한 저장 실패: ${err.detail || '서버 오류'}`);
      return;
    }

    // 2) 활동 로그 (이름 기반 localStorage — 추후 DB 마이그레이션 예정)
    const beforeMap = loadPermissions();
    const before = new Set(beforeMap[permModalTarget] || []);
    const log = loadPermLog();
    const now = new Date().toLocaleString('ko-KR', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    [...afterSet].filter(k => !before.has(k)).forEach(k => {
      const proj = PROJECTS_LIST.find(p => p.id === k);
      log.push({ member: permModalTarget, time: now, action: `'${proj?.name}' 접근 권한 부여` });
    });
    [...before].filter(k => !afterSet.has(k)).forEach(k => {
      const proj = PROJECTS_LIST.find(p => p.id === k);
      log.push({ member: permModalTarget, time: now, action: `'${proj?.name}' 접근 권한 제거` });
    });
    savePermLog(log);

    // 3) localStorage 캐시 동기화 — refreshPermBadges/renderMemberProjectMenu 등 read 경로가 아직 캐시 의존이라 유지
    beforeMap[permModalTarget] = afterArr;
    savePermsToDisk(beforeMap);

    refreshPermBadges();
    closePermModal();
    showToast(afterArr.length > 0
      ? `✅ ${permModalTarget}님에게 ${afterArr.length}개 사업 권한을 설정했습니다`
      : `🔒 ${permModalTarget}님의 수행사업 권한을 모두 제거했습니다`
    );
  } catch (err) {
    console.error('[savePermissions] 실패:', err);
    showToast('❌ 서버 연결 오류');
  }
}

// 모달 backdrop 클릭 닫기
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('perm-modal').addEventListener('click', function(e) {
    if (e.target === this) closePermModal();
  });
  refreshPermBadges();
});

/* ══════════════════════════════════════
   테마 시스템 JavaScript
══════════════════════════════════════ */
// ── 부서 사업 관리 시스템 테마 동기화 (pms-theme 공유) ──
const THEMES=[
  {id:'dark',   name:'다크',    desc:'기본 다크',   colors:['#0a0e1a','#111827','#3b82f6','#10b981']},
  {id:'light',  name:'라이트',  desc:'밝은 화면',   colors:['#f0f4f8','#ffffff','#2563eb','#059669']},
  {id:'navy',   name:'네이비',  desc:'딥 블루',     colors:['#0d1b2a','#1b2a3d','#38bdf8','#34d399']},
  {id:'slate',  name:'슬레이트',desc:'뉴트럴 다크', colors:['#1c1f26','#242830','#818cf8','#4ade80']},
  {id:'emerald',name:'에메랄드',desc:'그린 라이트', colors:['#f0fdf4','#ffffff','#059669','#0d9488']},
  {id:'rose',   name:'로즈',    desc:'레드 라이트', colors:['#fff1f2','#ffffff','#e11d48','#db2777']},
];
let currentTheme=localStorage.getItem('pms-theme')||'light';
let currentBrightness=parseInt(localStorage.getItem('pms-brightness')||'100');

function applyTheme(themeId,save=true){
  THEMES.forEach(t=>document.body.classList.remove('theme-'+t.id));
  document.body.classList.add('theme-'+themeId);  // dark도 명시적으로 theme-dark 클래스 부여
  currentTheme=themeId;
  if(save) localStorage.setItem('pms-theme',themeId);
  document.querySelectorAll('.theme-card').forEach(c=>{
    c.classList.toggle('active',c.dataset.theme===themeId);
  });
  // 모든 사업 iframe에도 테마 동기화
  document.querySelectorAll('iframe').forEach(f => {
    try { f.contentWindow?.postMessage({ type: 'setTheme', theme: themeId }, '*'); } catch(e){}
  });
}
function applyBrightness(val){
  currentBrightness=parseInt(val);
  document.body.style.filter=val==100?'':`brightness(${val}%)`;
  const el=document.getElementById('ts-brightness-val');
  if(el) el.textContent=val+'%';
  localStorage.setItem('pms-brightness',val);
}
function renderThemeGrid(){
  const grid=document.getElementById('ts-theme-grid');
  if(!grid) return;
  grid.innerHTML=THEMES.map(t=>{
    const [c1,c2,c3,c4]=t.colors;
    return `<div class="theme-card ${currentTheme===t.id?'active':''}" data-theme="${t.id}" onclick="applyTheme('${t.id}')">
      <div class="theme-swatch">
        <div style="background:${c1};border-radius:3px 0 0 0"></div>
        <div style="background:${c2};border-radius:0 3px 0 0"></div>
        <div style="background:${c3};border-radius:0 0 0 3px"></div>
        <div style="background:${c4};border-radius:0 0 3px 0"></div>
      </div>
      <div><div class="theme-name">${t.name}</div><div class="theme-desc">${t.desc}</div></div>
    </div>`;
  }).join('');
}
function tsToggleThemePanel(){
  const overlay=document.getElementById('ts-theme-overlay');
  const isOpen=overlay.classList.contains('open');
  if(!isOpen){
    renderThemeGrid();
    const slider=document.getElementById('ts-brightness-slider');
    if(slider){slider.value=currentBrightness;const bv=document.getElementById('ts-brightness-val');if(bv)bv.textContent=currentBrightness+'%';}
  }
  overlay.classList.toggle('open',!isOpen);
}
function tsHandleOverlayClick(e){
  if(e.target===document.getElementById('ts-theme-overlay')) tsToggleThemePanel();
}
function resetTheme(){
  applyTheme('light');applyBrightness(100);
  const s=document.getElementById('ts-brightness-slider');if(s)s.value=100;
  const v=document.getElementById('ts-brightness-val');if(v)v.textContent='100%';
}



/* ══════════════════════════════════════
   수행사업 추가/삭제 기능
══════════════════════════════════════ */
let newProjIcon   = '📁';
let newProjStatus = { status:'진행중', ps:'ps-active' };

function openAddProjModal() {
  newProjIcon   = '📁';
  newProjStatus = { status:'진행중', ps:'ps-active' };
  _partners = [];
  // 기본 기관 유형 미리 추가
  addPartner('전담기관');
  addPartner('지자체');
  addPartner('주관기관');
  addPartner('참여기관');
  // 기본 탭으로 리셋
  document.querySelectorAll('.modal-tab-panel').forEach((p,i) => p.classList.toggle('on', i===0));
  document.querySelectorAll('.modal-tab-btn').forEach((b,i) => b.classList.toggle('on', i===0));
  // 필드 초기화
  ['new-proj-name','new-proj-desc','new-proj-start','new-proj-end',
   'new-proj-agency','new-proj-host','new-proj-local',
   'new-proj-gov','new-proj-local-fund','new-proj-etc-fund'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  const disp = document.getElementById('new-proj-total-display');
  if(disp) disp.textContent = '0 원';
  ['ratio-gov','ratio-local','ratio-etc'].forEach(id => {
    const el = document.getElementById(id);
    if(el) { el.style.width='0%'; el.textContent=''; }
  });
  renderPartners();
  document.querySelectorAll('.proj-icon-opt').forEach((el,i) => el.classList.toggle('selected', i===0));
  // 상태 그리드 동적 렌더 (PROJECT_STATUSES 기반)
  renderStatusOptions('add-status-grid', newProjStatus.status, 'selectProjStatus');

  // 담당 팀 드롭다운 채우기 — 내 팀이 기본 선택
  populateNewProjTeamOptions();

  document.getElementById('add-proj-modal').classList.add('open');
}

async function populateNewProjTeamOptions() {
  const sel = document.getElementById('new-proj-team');
  if (!sel) return;
  const myTeamName = localStorage.getItem('user_team_name') || '';
  try {
    const res = await fetch(`${API_BASE}/teams`);
    if (!res.ok) return;
    const teams = await res.json();
    sel.innerHTML = '<option value="">팀을 선택해주세요</option>' +
      teams.map(t => `<option value="${t.name}" ${t.name === myTeamName ? 'selected' : ''}>${t.name}</option>`).join('');
  } catch (err) {
    console.error('[populateNewProjTeamOptions] 팀 목록 조회 실패:', err);
  }
}

async function populateEditProjTeamOptions(currentTeamName) {
  const sel = document.getElementById('edit-proj-team');
  if (!sel) return;
  try {
    const res = await fetch(`${API_BASE}/teams`);
    if (!res.ok) return;
    const teams = await res.json();
    sel.innerHTML = '<option value="">팀을 선택해주세요</option>' +
      teams.map(t => `<option value="${t.name}" ${t.name === currentTeamName ? 'selected' : ''}>${t.name}</option>`).join('');
  } catch (err) {
    console.error('[populateEditProjTeamOptions] 팀 목록 조회 실패:', err);
  }
}
function closeAddProjModal() {
  document.getElementById('add-proj-modal').classList.remove('open');
}
function selectProjIcon(el) {
  document.querySelectorAll('.proj-icon-opt').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  newProjIcon = el.dataset.icon;
}
function selectProjStatus(el) {
  document.querySelectorAll('.proj-status-opt').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  newProjStatus = { status: el.dataset.status, ps: el.dataset.ps };
}

async function saveNewProject() {
  flushPartnerInputs(); // 입력 중인 기관 정보 먼저 저장
  const name = document.getElementById('new-proj-name').value.trim();
  if (!name) { showToast('⚠️ 사업명을 입력하세요'); return; }

  // 담당 팀 드롭다운 값 사용 (없으면 내 팀으로 폴백)
  const selectedTeam = document.getElementById('new-proj-team')?.value?.trim() || '';
  const myTeamName   = localStorage.getItem('user_team_name') || '';
  const teamName = selectedTeam || myTeamName;
  if (!teamName || teamName === '미배정') {
    showToast('⚠️ 담당 팀을 선택해주세요.');
    return;
  }

  const gov   = parseInt(document.getElementById('new-proj-gov')?.value)       || 0;
  const local = parseInt(document.getElementById('new-proj-local-fund')?.value) || 0;
  const etc   = parseInt(document.getElementById('new-proj-etc-fund')?.value)   || 0;
  
  const newProj = {
    id:       'proj-' + Date.now(),
    name,
    icon:     newProjIcon,
    status:   newProjStatus.status,
    ps:       newProjStatus.ps,
    progress: 0,
    startDate:  document.getElementById('new-proj-start').value  || null,
    endDate:    document.getElementById('new-proj-end').value    || null,
    desc:       document.getElementById('new-proj-desc').value.trim() || '',
    agency:     _partners.filter(p=>p.type==='전담기관').map(p=>p.val).filter(Boolean).join(', '),
    host:       _partners.filter(p=>p.type==='주관기관').map(p=>p.val).filter(Boolean).join(', '),
    localGov:  _partners.filter(p=>p.type==='지자체').map(p=>p.val).filter(Boolean).join(', '),
    partners:  _partners.filter(p=>p.type==='참여기관').map(p=>p.val).filter(Boolean),
    orgs:      _partners.filter(p=>p.val).map(p=>({type:p.type, name:p.val})),
    govFund:   gov,
    localFund: local,
    etcFund:   etc,
    totalBudget: gov + local + etc,
    createdAt: new Date().toISOString(),
  };

  // 예산 관리에도 자동 반영 (기존 로직 그대로 유지)
  if(gov + local + etc > 0) {
    const budgets = loadBudgetData();
    budgets[newProj.id] = { total: newProj.totalBudget, govFund: gov, localFund: local };
    saveBudgetData(budgets);
  }

  // ================================================================
  // 🚀 [핵심 변경 구간] 기존 로컬 저장을 지우고 진짜 DB로 전송합니다!
  // ================================================================
  try {
    const response = await fetch(`${API_BASE}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: newProj.id,
        name: newProj.name,
        icon: newProj.icon || "📊",
        status: newProj.status || "",
        progress: newProj.progress || 0,
        startDate: newProj.startDate,
        endDate: newProj.endDate,
        desc: newProj.desc,
        agency: newProj.agency,
        host: newProj.host,
        localGov: newProj.localGov,
        partners: newProj.partners || [],
        govFund: newProj.govFund,
        localFund: newProj.localFund,
        etcFund: newProj.etcFund,
        totalBudget: newProj.totalBudget,
        createdAt: newProj.createdAt,
        team_name: teamName
      })
    });

    if (response.ok) {
      // 1. 신규 사업 플래그 저장 (기존 로직 유지)
      localStorage.setItem('v4-is-new-proj-' + newProj.id, '1');

      // 2. DB 저장이 끝났으니 최신 DB 목록을 다시 불러와 전역 변수를 갱신합니다.
      await fetchProjectsFromDB(); 

      // 3. 기존 화면 갱신 및 모달 닫기 로직 실행
      if (typeof refreshAllProjectViews === 'function') refreshAllProjectViews();
      closeAddProjModal();

      setTimeout(() => toggleProjGroup(newProj.id, 'leader'), 100);
      showToast(`📂 '${name}' 사업이 DB에 안전하게 추가됐습니다! 🚀`);
    } else {
      const errData = await response.json();
      showToast(`저장 실패 ❌: ${errData.detail || '데이터 확인'}`);
    }
  } catch (error) {
    console.error("서버 전송 에러:", error);
    showToast('서버 연결 오류 ❌ 백엔드가 켜져있는지 확인하세요.');
  }
}

/* ══════════════════════════════════════
   프로젝트 통합 렌더링 (수행사업 ↔ 대시보드 ↔ 프로젝트탭 연동)
══════════════════════════════════════ */

// 통합 프로젝트 상태 정의 — 모든 상태 매핑은 이 배열 한 곳에서 파생
// 새 상태 추가/이름 변경은 여기만 수정하면 PROJ_STYLE / 뱃지 / ps-class / 모달 옵션이 모두 갱신됨
// selectable=true 인 상태만 사업 추가/수정 모달의 선택 그리드에 노출
const PROJECT_STATUSES = [
  { id:'진행중',   ps:'ps-active', badge:'badge-blue',   fill:'progress-blue',  border:'var(--accent)',  color:'var(--accent)',  icon:'🏃', selectorIcon:'🟢', selectable:true },
  { id:'검토중',   ps:'ps-review', badge:'badge-gold',   fill:'progress-gold',  border:'var(--gold)',    color:'var(--gold)',    icon:'🔍', selectorIcon:'🟡', selectable:true },
  { id:'완료임박', ps:'ps-done',   badge:'badge-green',  fill:'progress-green', border:'var(--success)', color:'var(--success)', icon:'🎉', selectorIcon:'🔵', selectable:true },
  { id:'지연',     ps:'ps-delay',  badge:'badge-red',    fill:'progress-red',   border:'var(--danger)',  color:'var(--danger)',  icon:'⚠️', selectorIcon:'🔴', selectable:true },
  { id:'완료',     ps:'ps-done',   badge:'badge-gray',   fill:'progress-blue',  border:'var(--text3)',   color:'var(--text3)',   icon:'🏆' },
  { id:'계획중',   ps:'ps-review', badge:'badge-purple', fill:'progress-blue',  border:'var(--leader)',  color:'var(--leader)',  icon:'📋' },
];

// id → 상태 객체 (기존 PROJ_STYLE 호환)
const PROJ_STYLE = Object.fromEntries(PROJECT_STATUSES.map(s => [s.id, s]));

function getProjStatus(id) { return PROJ_STYLE[id] || PROJ_STYLE['진행중']; }
function getStatusBadge(id) { return getProjStatus(id).badge; }
function getStatusPs(id)    { return getProjStatus(id).ps; }

// 사업 추가/수정 모달의 상태 선택 그리드를 동적으로 채움
function renderStatusOptions(containerId, currentStatus, onclickFnName) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = PROJECT_STATUSES
    .filter(s => s.selectable)
    .map(s => `<div class="proj-status-opt${s.id === currentStatus ? ' selected' : ''}"
                    data-status="${s.id}" data-ps="${s.ps}"
                    onclick="${onclickFnName}(this)"><span>${s.selectorIcon}</span> ${s.id}</div>`)
    .join('');
}

// ── 대시보드 상단 통계 카드 (전체 팀원 / 진행 중 프로젝트) ──
async function renderOverviewStats() {
  // 진행 중 프로젝트 (PROJECTS_LIST 기반)
  const total  = PROJECTS_LIST.length;
  const active = PROJECTS_LIST.filter(p => p.status === '진행중').length;
  const projCountEl = document.getElementById('dash-active-proj-count');
  const projSubEl   = document.getElementById('dash-active-proj-sub');
  if (projCountEl) projCountEl.textContent = active;
  if (projSubEl)   projSubEl.textContent   = `전체 ${total}건 중`;

  // 전체 팀원 (현재 사용자의 팀 인원수)
  const teamCountEl = document.getElementById('dash-team-count');
  const teamSubEl   = document.getElementById('dash-team-sub');
  if (!teamCountEl) return;
  const myTeamName = localStorage.getItem('user_team_name');
  if (!myTeamName || myTeamName === '미배정') {
    teamCountEl.textContent = 0;
    if (teamSubEl) teamSubEl.textContent = '소속 팀 없음';
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/teams/${encodeURIComponent(myTeamName)}/users`);
    if (res.ok) {
      const users = await res.json();
      teamCountEl.textContent = users.length;
      if (teamSubEl) teamSubEl.textContent = `${myTeamName} 전체`;
    }
  } catch (err) {
    console.error('[renderOverviewStats] 팀원 수 조회 실패:', err);
  }
}

// ── 대시보드 주간 업무 완료량 차트 ──
async function renderWeeklyChart() {
  const container = document.getElementById('weekly-chart-bars');
  const totalEl   = document.getElementById('weekly-chart-total');
  if (!container) return;

  const actor = localStorage.getItem('actor_username') || '';
  try {
    const res = await fetch(`${API_BASE}/dashboard/weekly-completion?actor_username=${encodeURIComponent(actor)}`);
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();

    const { days, counts, total, week_start, week_end } = data;
    const maxCount = Math.max(...counts, 1);
    const MAX_BAR_H = 100; // px (chart-placeholder height 160px 중 bar 영역)

    // 오늘 요일 강조 (0=월 기준)
    const todayDow = (new Date().getDay() + 6) % 7; // JS 0=일 → 0=월로 변환

    container.innerHTML = days.map((label, i) => {
      const h    = Math.max(Math.round((counts[i] / maxCount) * MAX_BAR_H), counts[i] > 0 ? 8 : 4);
      const isToday = (i === todayDow);
      const countLabel = counts[i] > 0
        ? `<div style="font-size:10px;font-weight:700;color:var(--accent);margin-bottom:2px">${counts[i]}</div>`
        : `<div style="font-size:10px;color:var(--text3);margin-bottom:2px">-</div>`;
      return `
        <div class="bar-wrap" title="${label}요일: ${counts[i]}건 완료">
          ${countLabel}
          <div class="bar" style="height:${h}px;${isToday ? 'opacity:1;box-shadow:0 0 0 2px var(--accent)' : ''}"></div>
          <div class="bar-label" style="${isToday ? 'color:var(--accent);font-weight:700' : ''}">${label}</div>
        </div>`;
    }).join('');

    if (totalEl) {
      const fmt = d => d.slice(5).replace('-', '/');
      totalEl.textContent = `이번주 ${total}건 완료 (${fmt(week_start)}~${fmt(week_end)})`;
    }
  } catch (e) {
    console.error('[renderWeeklyChart]', e);
    container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;color:var(--text3);font-size:13px">데이터를 불러올 수 없습니다</div>';
  }
}

// ── 대시보드 프로젝트 진행현황 렌더 ──
function renderDashboardProjects() {
  const tbody = document.getElementById('dash-proj-tbody');
  if (!tbody) return;
  const list = PROJECTS_LIST;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text3);padding:20px">등록된 수행사업이 없습니다</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(p => {
    const s = PROJ_STYLE[p.status] || PROJ_STYLE['진행중'];
    const prog = p.progress || 0;
    return `<tr onclick="openProjTab('${p.id}','tab-dashboard',document.getElementById('lpt-${p.id}')||document.createElement('div'),'leader')" style="cursor:pointer">
      <td style="color:var(--text);font-weight:500">${p.icon} ${p.name}</td>
      <td><span class="badge ${s.badge}">${p.status}</span></td>
      <td style="min-width:120px">
        <div class="progress-bar"><div class="progress-fill ${s.fill}" style="width:${prog}%"></div></div>
        <div style="font-size:10px;color:var(--text3);margin-top:3px">${prog}%</div>
      </td>
    </tr>`;
  }).join('');
}

// ── 프로젝트 관리 탭 렌더 ──
function renderProjectsTab() {
  renderTrashPanel();
  // 통계
  const statsGrid = document.getElementById('proj-stats-grid');
  if (statsGrid) {
    const total    = PROJECTS_LIST.length;
    const active   = PROJECTS_LIST.filter(p=>p.status==='진행중').length;
    const review   = PROJECTS_LIST.filter(p=>p.status==='검토중').length;
    const delayed  = PROJECTS_LIST.filter(p=>p.status==='지연').length;
    const nearDone = PROJECTS_LIST.filter(p=>p.status==='완료임박').length;
    const done     = PROJECTS_LIST.filter(p=>p.status==='완료').length;
    const planning = PROJECTS_LIST.filter(p=>p.status==='계획중').length;

    const colCount = planning > 0 ? 7 : 6;
    statsGrid.style.gridTemplateColumns = `repeat(${colCount}, 1fr)`;
    statsGrid.innerHTML = `
      <div class="stat-card accent-blue">
        <div class="stat-label">전체</div>
        <div class="stat-value">${total}</div>
        <div class="stat-icon">📁</div>
      </div>
      <div class="stat-card accent-blue">
        <div class="stat-label">진행중</div>
        <div class="stat-value">${active}</div>
        <div class="stat-icon">🏃</div>
      </div>
      <div class="stat-card accent-gold">
        <div class="stat-label">검토중</div>
        <div class="stat-value">${review}</div>
        <div class="stat-icon">🔍</div>
      </div>
      <div class="stat-card" style="border-left:3px solid var(--danger)">
        <div class="stat-label">지연</div>
        <div class="stat-value" style="color:var(--danger)">${delayed}</div>
        <div class="stat-icon">⚠️</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label">완료임박</div>
        <div class="stat-value">${nearDone}</div>
        <div class="stat-icon">🎉</div>
      </div>
      <div class="stat-card accent-purple">
        <div class="stat-label">완료</div>
        <div class="stat-value">${done}</div>
        <div class="stat-icon">🏆</div>
      </div>
      ${planning > 0 ? `<div class="stat-card" style="border-left:3px solid var(--leader)">
        <div class="stat-label">계획중</div>
        <div class="stat-value" style="color:var(--leader)">${planning}</div>
        <div class="stat-icon">📋</div>
      </div>` : ''}`;
  }

  // 카드 그리드
  const cardsGrid = document.getElementById('proj-cards-grid');
  if (!cardsGrid) return;
  if (!PROJECTS_LIST.length) {
    cardsGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text3)">
      <div style="font-size:40px;margin-bottom:12px">📂</div>
      <div style="font-size:15px;font-weight:600;margin-bottom:6px">등록된 수행사업이 없습니다</div>
      <div style="font-size:13px">상단 + 사업 추가 버튼으로 새 사업을 등록하세요</div>
    </div>`;
    return;
  }
  cardsGrid.innerHTML = PROJECTS_LIST.map(p => {
    const s = PROJ_STYLE[p.status] || PROJ_STYLE['진행중'];
    const prog = p.progress || 0;
    // DB에서 넘어오는 end_date도 함께 확인하도록 변수를 하나 거쳐갑니다.
    const rawEnd = p.endDate || p.end_date || p.enddate;
    const end  = rawEnd ? `마감: ${rawEnd}` : '마감일 미설정';
    return `
      <div class="proj-card-wrap"
           draggable="true"
           data-proj-id="${p.id}"
           ondragstart="onProjDragStart(event,'${p.id}')"
           ondragover="onProjDragOver(event)"
           ondragleave="onProjDragLeave(event)"
           ondrop="onProjDrop(event,'${p.id}')"
           ondragend="onProjDragEnd(event)">
      <div class="card" style="margin-bottom:0;border-top:3px solid ${s.border};cursor:pointer;transition:transform .15s,box-shadow .15s;height:100%"
           onclick="openProjTab('${p.id}','tab-dashboard',document.getElementById('lpt-${p.id}')||document.createElement('div'),'leader')"
           onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.15)'"
           onmouseout="this.style.transform='';this.style.boxShadow=''">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <select onclick="event.stopPropagation()"
                  onchange="event.stopPropagation();changeProjectStatus('${p.id}',this.value)"
                  style="border:none;background:transparent;font-size:12px;font-weight:700;color:${s.color};cursor:pointer;padding:2px 4px;border-radius:6px;font-family:'Noto Sans KR',sans-serif;outline:none;appearance:none;-webkit-appearance:none">
            <option value="진행중"  ${p.status==='진행중'?'selected':''} style="color:#1e293b">🏃 진행중</option>
            <option value="검토중"  ${p.status==='검토중'?'selected':''} style="color:#1e293b">🔍 검토중</option>
            <option value="완료임박" ${p.status==='완료임박'?'selected':''} style="color:#1e293b">🎉 완료임박</option>
            <option value="지연"    ${p.status==='지연'?'selected':''} style="color:#1e293b">⚠️ 지연</option>
            <option value="완료"    ${p.status==='완료'?'selected':''} style="color:#1e293b">🏆 완료</option>
            <option value="계획중"  ${p.status==='계획중'?'selected':''} style="color:#1e293b">📋 계획중</option>
          </select>
          <div style="display:flex;gap:4px">
            <button onclick="event.stopPropagation();openEditProjModal('${p.id}')"
                    style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;transition:all .15s"
                    onmouseover="this.style.color='var(--accent)';this.style.background='rgba(59,130,246,0.1)'"
                    onmouseout="this.style.color='var(--text3)';this.style.background='none'"
                    title="편집">✏️</button>
            <button onclick="event.stopPropagation();trashProject('${p.id}')"
                    style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;transition:all .15s"
                    onmouseover="this.style.color='var(--danger)';this.style.background='rgba(239,68,68,0.1)'"
                    onmouseout="this.style.color='var(--text3)';this.style.background='none'"
                    title="삭제">🗑️</button>
          </div>
        </div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px">${p.icon} ${p.name}</div>
        ${p.desc ? `<div style="font-size:12px;color:var(--text2);margin-bottom:10px;line-height:1.5">${p.desc}</div>` : ''}
        <div style="margin:10px 0">
          <div class="progress-bar" style="height:7px">
            <div class="progress-fill ${s.fill}" style="width:${prog}%"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text2);margin-top:4px">
            <span>${prog}% 완료</span>
            <span style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation();editProgress('${p.id}')">수정</span>
          </div>
        </div>
        <div style="font-size:12px;color:var(--text3);margin-bottom:${(p.agency||p.host||p.totalBudget)?'8px':'0'}">${end}</div>
        ${p.agency||p.host ? `<div style="font-size:11px;color:var(--text2);margin-top:6px;line-height:1.7;border-top:1px solid var(--border);padding-top:8px">
          ${p.agency?`<div>🏛️ <b>전담:</b> ${p.agency}</div>`:''}
          ${p.host?`<div>🏢 <b>주관:</b> ${p.host}</div>`:''}
          ${p.localGov?`<div>🏙️ <b>지자체:</b> ${p.localGov}</div>`:''}
          ${p.partners?.length?`<div>🤝 <b>참여:</b> ${p.partners.join(', ')}</div>`:''}
        </div>` : ''}
        ${p.totalBudget>0 ? `<div style="font-size:11px;margin-top:8px;padding:8px 10px;background:rgba(59,130,246,0.06);border-radius:8px;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="color:var(--text2)">총 예산</span>
            <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent)">${p.totalBudget.toLocaleString('ko-KR')}원</span>
          </div>
          <div style="display:flex;gap:10px;color:var(--text3);font-size:10px">
            ${p.govFund?`<span>국비 ${p.govFund.toLocaleString('ko-KR')}</span>`:''}
            ${p.localFund?`<span>지방비 ${p.localFund.toLocaleString('ko-KR')}</span>`:''}
            ${p.etcFund?`<span>기타 ${p.etcFund.toLocaleString('ko-KR')}</span>`:''}
          </div>
        </div>` : ''}
      </div>
      </div>`;
  }).join('');
}

// 진행률 수정
function editProgress(projId) {
  const proj = PROJECTS_LIST.find(p=>p.id===projId);
  if (!proj) return;
  const val = prompt(`'${proj.name}' 진행률 입력 (0~100):`, proj.progress || 0);
  if (val === null) return;
  const num = Math.min(100, Math.max(0, parseInt(val)||0));
  proj.progress = num;
  saveProjectsList(PROJECTS_LIST);
  refreshAllProjectViews();
  showToast(`📊 진행률이 ${num}%로 업데이트됐습니다`);
}

// 🚀 [정리 완료] 프로젝트 관리 리스트 전용 삭제 함수
async function trashProject(id) {
  // 1. 인자로 넘어온 ID가 없으면 바로 차단
  if (!id || id === 'undefined' || id === 'null') {
    showToast("❌ 삭제할 프로젝트 ID가 올바르지 않습니다.");
    return;
  }

  console.log("🗑️ 삭제 시도 ID:", id);

  // 2. 목록에서 해당 프로젝트 찾기
  const proj = PROJECTS_LIST.find(p => String(p.id) === String(id));
  if (!proj) {
    showToast("❌ 삭제할 프로젝트를 찾을 수 없습니다.");
    return;
  }

  // 3. 사용자 확인
  if (!confirm(`'${proj.name}' 사업을 영구히 삭제하시겠습니까?`)) return;

  // 4. DB 삭제 요청
  try {
    const response = await fetch(`${API_BASE}/projects/${id}`, {
      method: 'DELETE',
    });

    if (response.ok) {
      showToast("✅ 사업이 성공적으로 삭제되었습니다.");
      
      // 목록 새로고침 및 화면 갱신
      await fetchProjectsFromDB();

      if (typeof renderTrash === 'function') renderTrash();
      if (typeof refreshAllProjectViews === 'function') refreshAllProjectViews();
    } else {
      const err = await response.json();
      showToast('삭제 실패: ' + (err.error || '서버 오류'));
    }
  } catch (error) {
    console.error("삭제 에러:", error);
    showToast("❌ 서버 연결 오류 (백엔드 서버 확인 필요)");
  }
}

// ♻️ 휴지통 목록을 화면에 그리는 함수
function renderTrash() {
  const trash = JSON.parse(localStorage.getItem('TRASH_LIST') || '[]');
  const panel = document.getElementById('trash-panel');
  if (!panel) return;

  if (trash.length === 0) {
    panel.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--text3)">휴지통이 비어 있습니다.</td></tr>';
    return;
  }

  panel.innerHTML = trash.map(p => `
    <tr>
      <td style="padding-left:14px; text-align:left;">${p.name}</td>
      <td><span class="badge ${p.ps || 'ps-active'}">${p.status || '진행중'}</span></td>
      <td style="font-size:11px;color:var(--text2)">${p.deletedAt}</td>
      <td>
        <button class="btn-sm" onclick="restoreProject('${p.id}')" style="background:var(--accent);color:white;padding:2px 6px;cursor:pointer;">복구</button>
      </td>
    </tr>
  `).join('');
}

// 페이지 로드 시 휴지통 그리기 실행
window.addEventListener('DOMContentLoaded', renderTrash);

// ── 전체 프로젝트 뷰 일괄 갱신 ──
function refreshAllProjectViews() {
  renderDashboardProjects();
  renderProjectsTab();
  renderLeaderBizNav();
  renderMemberProjectMenu();
  // 사이드바 사업 그룹의 펼친 상태 복원 — innerHTML 재생성으로 닫힌 것을 다시 열어줌
  ['leader', 'member'].forEach(role => {
    const projId = openProjId[role];
    if (!projId) return;
    const togglePrefix = (role === 'leader' ? 'lpt-' : 'mpt-');
    const itemsPrefix  = (role === 'leader' ? 'lpi-' : 'mpi-');
    const toggle = document.getElementById(togglePrefix + projId);
    const items  = document.getElementById(itemsPrefix + projId);
    if (toggle) toggle.classList.add('open');
    if (items)  items.classList.add('open');
    // 활성 서브 탭(WBS 등)도 active 표시 복원
    const activeTab = activeProjTab[role];
    if (activeTab) {
      const sub = document.getElementById((role === 'leader' ? 'lpitem-' : 'mpitem-') + projId + '-' + activeTab);
      if (sub) sub.classList.add('active');
    }
  });
}


/* ══════════════════════════════════════
   사업비 관리
══════════════════════════════════════ */
// 사업비 데이터 구조: { projId, total, govFund, localFund, executed }
function loadBudgetData() {
  try { return JSON.parse(localStorage.getItem('budget-data') || '{}'); } catch(e) { return {}; }
}
function saveBudgetData(d) { localStorage.setItem('budget-data', JSON.stringify(d)); }

// 집행 내역(localStorage exec-data)도 2.5에서 제거됨 — 사용처 없음

function fmt(n) {
  return Number(n||0).toLocaleString('ko-KR');
}

// 각 사업의 budget_data(JSON 문자열)에서 items/execs 파싱
function _parseProjectBudget(p) {
  if (!p || !p.budget_data) return { items: [], execs: [] };
  try {
    const d = typeof p.budget_data === 'string' ? JSON.parse(p.budget_data) : p.budget_data;
    return {
      items: Array.isArray(d.items) ? d.items : [],
      execs: Array.isArray(d.execs) ? d.execs : [],
    };
  } catch { return { items: [], execs: [] }; }
}

// readonly 사업비 관리 — 각 사업의 '예산 관리' 탭 입력값(budget_data)을 합산
function renderBudgetMgmt() {
  const tbody = document.getElementById('budget-tbody');
  if (!tbody) return;

  // 사업별 합산 계산
  const stats = PROJECTS_LIST.map(p => {
    const { items, execs } = _parseProjectBudget(p);
    const gov   = items.reduce((s, i) => s + Number(i.gb_budget || 0), 0);
    const local = items.reduce((s, i) => s + Number(i.lb_budget || 0), 0);
    const etc   = Number(p.etc_fund || 0);  // 자부담은 사업 자체 컬럼 사용
    const total = gov + local + etc;
    const exec  = execs.reduce((s, e) => s + Number(e.amount || 0), 0);
    return { p, gov, local, etc, total, exec };
  });

  // ── 1. 행(readonly) ──
  tbody.innerHTML = stats.map(s => {
    const rem = s.total - s.exec;
    const rt = s.total > 0 ? Math.round(s.exec / s.total * 100) : 0;
    const color = rt >= 80 ? 'var(--danger)' : rt >= 50 ? 'var(--gold)' : 'var(--success)';
    const monoCell = (val, c) => `<td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600;padding:6px 14px;color:${c||'var(--text)'}">${fmt(val)}</td>`;
    return `<tr>
      <td style="font-weight:600;color:var(--text);padding:6px 14px">${s.p.icon || '📁'} ${escapeHtml(s.p.name)}</td>
      <td><span class="badge ${getStatusBadge(s.p.status)}">${escapeHtml(s.p.status || '')}</span></td>
      ${monoCell(s.total)}
      ${monoCell(s.gov)}
      ${monoCell(s.local)}
      ${monoCell(s.etc)}
      ${monoCell(s.exec, 'var(--accent)')}
      ${monoCell(rem, rem<0?'var(--danger)':'var(--text)')}
      <td>
        <div class="progress-bar" style="width:80px;margin:0 auto">
          <div class="progress-fill" style="width:${rt}%;background:${color}"></div>
        </div>
        <div style="font-size:11px;text-align:center;color:${color};margin-top:2px;font-weight:600">${rt}%</div>
      </td>
    </tr>`;
  }).join('');

  if (stats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text3)">표시할 사업이 없습니다.</td></tr>';
  }

  // ── 2. 합계 ──
  const sumGov   = stats.reduce((s, x) => s + x.gov,   0);
  const sumLoc   = stats.reduce((s, x) => s + x.local, 0);
  const sumEtc   = stats.reduce((s, x) => s + x.etc,   0);
  const sumTotal = sumGov + sumLoc + sumEtc;
  const sumExec  = stats.reduce((s, x) => s + x.exec,  0);
  const sumRem   = sumTotal - sumExec;
  const sumRate  = sumTotal > 0 ? Math.round(sumExec / sumTotal * 100) : 0;

  // tfoot 합계
  const tfoot = document.getElementById('budget-tfoot');
  if (tfoot) tfoot.innerHTML = `<tr style="background:var(--surface2);font-weight:700">
    <td colspan="2" style="padding:10px 14px;color:var(--text)">합 계</td>
    <td style="font-family:'DM Mono',monospace;text-align:right;padding:10px 10px">${fmt(sumTotal)}</td>
    <td style="font-family:'DM Mono',monospace;text-align:right;padding:10px 10px">${fmt(sumGov)}</td>
    <td style="font-family:'DM Mono',monospace;text-align:right;padding:10px 10px">${fmt(sumLoc)}</td>
    <td style="font-family:'DM Mono',monospace;text-align:right;padding:10px 10px">${fmt(sumEtc)}</td>
    <td style="font-family:'DM Mono',monospace;text-align:right;padding:10px 10px;color:var(--accent)">${fmt(sumExec)}</td>
    <td style="font-family:'DM Mono',monospace;text-align:right;padding:10px 10px">${fmt(sumRem)}</td>
    <td></td>
  </tr>`;

  // ── 3. 상단 KPI — 권한별 사업 합산
  // PROJECTS_LIST가 이미 role별로 필터링되어 있어(sysadmin/admin=전체, leader=본인 팀, member=권한 부여된 사업만)
  // 자연스럽게 "내가 볼 수 있는 사업의 합산"이 표시된다.
  const role = (currentUser && currentUser.role) || 'member';
  const scopeLabel = role === 'sysadmin' || role === 'admin'
    ? '전체 사업'
    : role === 'leader'
      ? '우리 팀 사업'
      : '권한 부여된 사업';
  const projCount = stats.length;

  const kpiGrid = document.getElementById('budget-kpi-grid');
  if (kpiGrid) kpiGrid.innerHTML = `
    <div class="stat-card accent-blue">
      <div class="stat-label">총 예산 <span style="font-size:10px;color:var(--text3)">· ${escapeHtml(scopeLabel)} ${projCount}건</span></div>
      <div class="stat-value" style="font-size:20px">${fmt(sumTotal)}<span class="stat-unit">원</span></div>
      <div class="stat-icon">💰</div>
    </div>
    <div class="stat-card accent-green"><div class="stat-label">총 집행액</div><div class="stat-value" style="font-size:20px">${fmt(sumExec)}<span class="stat-unit">원</span></div><div class="stat-icon">📤</div></div>
    <div class="stat-card accent-gold"><div class="stat-label">잔액</div><div class="stat-value" style="font-size:20px">${fmt(sumRem)}<span class="stat-unit">원</span></div><div class="stat-icon">💵</div></div>
    <div class="stat-card accent-purple"><div class="stat-label">집행률</div><div class="stat-value">${sumRate}<span class="stat-unit">%</span></div><div class="stat-change ${sumRate>80?'down':'up'}">${sumRate>80?'⚠ 집행 주의':'정상 범위'}</div><div class="stat-icon">📊</div></div>`;
}

// 💡 [수정] 표 안의 예산 셀 수정 시, 총 예산도 자동 계산하여 DB에 함께 저장!
async function updateBudget(projId, field, value) {
  const safeNum = (val) => Number(String(val ?? 0).replace(/,/g, '')) || 0;
  const numericValue = safeNum(value);

  let backendField = field;
  if (field === 'total') backendField = 'totalBudget';

  const updateData = {};
  updateData[backendField] = numericValue;

  // 🚀 [핵심 추가] 국비, 지방비, 자부담 중 하나를 수정했다면, 총 예산(totalBudget)도 같이 묶어서 보냅니다!
  const targetProj = PROJECTS_LIST.find(p => p.id === projId);
  if (targetProj) {
    let gov = safeNum(targetProj.gov_fund ?? targetProj.govFund);
    let loc = safeNum(targetProj.local_fund ?? targetProj.localFund);
    let etc = safeNum(targetProj.etc_fund ?? targetProj.etcFund); // 자부담

    // 방금 수정한 최신 값으로 교체
    if (field === 'govFund') gov = numericValue;
    if (field === 'localFund') loc = numericValue;
    if (field === 'etcFund') etc = numericValue; // 자부담(etc)

    // 새로운 총합계를 updateData 꾸러미에 추가
    updateData['totalBudget'] = gov + loc + etc;
  }

  try {
    const res = await fetch(`${API_BASE}/projects/${projId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    });

    if (res.ok) {
      showToast('💾 예산이 DB에 저장되었습니다');
      await fetchProjectsFromDB(); 
      if (typeof renderBudgetMgmt === 'function') renderBudgetMgmt();
      if (typeof updateSummaryCards === 'function') updateSummaryCards();
    } else {
      showToast('❌ 서버 저장에 실패했습니다');
    }
  } catch (e) {
    console.error("예산 업데이트 오류:", e);
    showToast('❌ 서버 연결 오류');
  }
}

// 사업비 관리 페이지의 (구) 집행 내역 추가/목록 카드 + 관련 함수는 2.5에서 제거됐다.
// 집행 내역은 이제 각 사업의 '예산 관리 → 집행 내역' 탭에서만 관리되며,
// 데이터는 Project.budget_data JSON에 저장된다.

function exportBudgetData() {
  const data = { projects: PROJECTS_LIST, budgets: loadBudgetData(), execs: [] };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '사업비_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  showToast('📥 사업비 데이터를 내보냈습니다');
}

/* ══════════════════════════════════════
   참여인력 관리
══════════════════════════════════════ */

// ── 참여인력 관리 (DB 연동) ──
const PERSONNEL_ROLES = ['총괄책임자', '실무책임자', '참여연구원'];

// 캐시: 화면 그리는 데 필요한 데이터
let _assignments = [];        // 현재 팀의 모든 UserProject 행
let _teamUsers   = [];        // 현재 팀의 모든 사용자 (id, username, name)

function _isActiveToday(start, end) {
  const today = new Date().toISOString().slice(0, 10);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

async function fetchTeamAssignments() {
  const team = localStorage.getItem('user_team_name');
  if (!team || team === '미배정') {
    _assignments = [];
    _teamUsers = [];
    return;
  }
  try {
    const [aRes, uRes] = await Promise.all([
      fetch(`${API_BASE}/teams/${encodeURIComponent(team)}/assignments`),
      fetch(`${API_BASE}/teams/${encodeURIComponent(team)}/users`),
    ]);
    _assignments = aRes.ok ? await aRes.json() : [];
    _teamUsers   = uRes.ok ? await uRes.json() : [];
  } catch (e) {
    console.error('[fetchTeamAssignments] 실패:', e);
    _assignments = [];
    _teamUsers = [];
  }
}

async function renderPersonnelMgmt() {
  await fetchTeamAssignments();

  // 활성 행 + 사용자별 현재 합계 + 사업별 평균 산출
  const memberTotal = {};
  _teamUsers.forEach(u => { memberTotal[u.id] = 0; });
  let activeRateSum = 0, activeRateCount = 0;
  const projectStats = {}; // projectId → { sum, count }
  _assignments.forEach(a => {
    if (a.is_active) {
      const r = Number(a.rate || 0);
      memberTotal[a.user_id] = (memberTotal[a.user_id] || 0) + r;
      activeRateSum += r;
      activeRateCount++;
      if (!projectStats[a.project_id]) projectStats[a.project_id] = { sum: 0, count: 0 };
      projectStats[a.project_id].sum   += r;
      projectStats[a.project_id].count += 1;
    }
  });
  const overloaded = _teamUsers.filter(u => (memberTotal[u.id] || 0) > 100).length;
  const teamAvg = activeRateCount > 0 ? (activeRateSum / activeRateCount) : 0;

  // KPI 카드 — 팀 평균 / 참여 팀원 / 과부하 인원 (3개)
  const kpi = document.getElementById('personnel-kpi-grid');
  if (kpi) {
    // 4칸 그리드 → 3칸으로 조정
    kpi.classList.remove('stats-grid-4');
    kpi.style.gridTemplateColumns = 'repeat(3, 1fr)';
    kpi.innerHTML = `
      <div class="stat-card accent-blue">
        <div class="stat-label">팀 전체 평균 참여율</div>
        <div class="stat-value">${teamAvg.toFixed(1)}<span class="stat-unit">%</span></div>
        <div class="stat-change">활성 배정 ${activeRateCount}건 평균</div>
        <div class="stat-icon">📊</div>
      </div>
      <div class="stat-card accent-green">
        <div class="stat-label">참여 팀원</div>
        <div class="stat-value">${_teamUsers.filter(u => memberTotal[u.id] > 0).length}<span class="stat-unit">명</span></div>
        <div class="stat-icon">👤</div>
      </div>
      <div class="stat-card ${overloaded > 0 ? 'accent-purple' : 'accent-green'}">
        <div class="stat-label">과부하 인원</div>
        <div class="stat-value" style="color:${overloaded > 0 ? 'var(--danger)' : 'var(--success)'}">${overloaded}<span class="stat-unit">명</span></div>
        <div class="stat-change ${overloaded ? 'down' : 'up'}">${overloaded ? '⚠ 100% 초과' : '정상'}</div>
        <div class="stat-icon">⚡</div>
      </div>`;
  }

  // 사업별 카드 — 그 사업에 속한 참여 행을 표 형태로
  const cardsEl = document.getElementById('personnel-proj-cards');
  if (cardsEl) {
    if (PROJECTS_LIST.length === 0) {
      cardsEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">등록된 수행사업이 없습니다</div>';
    } else {
      cardsEl.innerHTML = PROJECTS_LIST.map(p => {
        const projAssignments = _assignments.filter(a => a.project_id === p.id);
        const ps = projectStats[p.id];
        const projAvg = ps && ps.count > 0 ? (ps.sum / ps.count) : null;
        const projAvgBadge = projAvg !== null
          ? `<span class="badge badge-blue" style="font-size:11px;font-family:'DM Mono',monospace">평균 ${projAvg.toFixed(1)}% (활성 ${ps.count}건)</span>`
          : `<span class="badge badge-gray" style="font-size:11px">활성 배정 없음</span>`;
        const rowsHtml = projAssignments.length === 0
          ? `<tr><td colspan="6" style="text-align:center;padding:18px;color:var(--text3)">배정된 인력이 없습니다</td></tr>`
          : projAssignments.map(a => {
              return `<tr style="${a.is_active ? '' : 'opacity:0.55'}">
                <td style="font-weight:500">${escapeHtml(a.user_name || '')}</td>
                <td>
                  <select class="form-input" style="padding:4px 6px;font-size:12px"
                          onchange="updateAssignmentField(${a.id},'role',this.value)">
                    ${PERSONNEL_ROLES.map(r => `<option value="${r}"${a.role === r ? ' selected' : ''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td>
                  <input class="form-input" type="number" min="0" max="100" step="0.1"
                         value="${Number(a.rate)}" placeholder="0"
                         style="width:70px;padding:4px 6px;font-size:12px;font-family:'DM Mono',monospace;text-align:right"
                         onchange="updateAssignmentField(${a.id},'rate',this.value)">
                </td>
                <td>
                  <input class="form-input" type="date"
                         value="${a.start_date || ''}"
                         style="padding:4px 6px;font-size:11px"
                         onchange="updateAssignmentField(${a.id},'start_date',this.value)">
                </td>
                <td>
                  <input class="form-input" type="date"
                         value="${a.end_date || ''}"
                         style="padding:4px 6px;font-size:11px"
                         onchange="updateAssignmentField(${a.id},'end_date',this.value)">
                </td>
                <td>
                  <button class="btn-sm btn-sm-danger" style="padding:3px 8px;font-size:11px"
                          onclick="deleteAssignment(${a.id})">삭제</button>
                </td>
              </tr>`;
            }).join('');
        return `<div class="card" style="margin-bottom:16px">
          <div class="card-header" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="card-title">${p.icon || '📁'} ${escapeHtml(p.name)}</span>
            <span class="badge ${p.ps === 'ps-active' ? 'badge-blue' : p.ps === 'ps-delay' ? 'badge-red' : p.ps === 'ps-done' ? 'badge-green' : 'badge-gold'}">${p.status || ''}</span>
            <span style="margin-left:auto">${projAvgBadge}</span>
          </div>
          <div style="overflow-x:auto">
            <table class="data-table">
              <thead><tr>
                <th style="text-align:left;padding-left:14px">이름</th>
                <th>역할</th>
                <th>참여율 (%)</th>
                <th>시작일</th>
                <th>종료일</th>
                <th>관리</th>
              </tr></thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>`;
      }).join('');
    }
  }

  // 전체 요약 테이블 — 사용자별 현재 참여율 합계 (활성 행만)
  const sumTbody = document.getElementById('personnel-summary-tbody');
  if (sumTbody) {
    sumTbody.innerHTML = _teamUsers.map(u => {
      const total = memberTotal[u.id] || 0;
      const activeCnt = _assignments.filter(a => a.user_id === u.id && a.is_active).length;
      const status = total > 100 ? '🔴 과부하'
                  : total >= 80 ? '🟡 주의'
                  : total > 0   ? '🟢 정상'
                                : '⚪ 미배정';
      return `<tr>
        <td style="font-weight:600;color:var(--text)">${escapeHtml(u.name)}</td>
        <td>${escapeHtml(u.team_name || '')}</td>
        <td style="text-align:center">
          <span style="cursor:pointer;color:var(--accent);text-decoration:underline;font-weight:600"
                onclick="showAssignmentsPopup(event, ${u.id})">${activeCnt}개</span>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="progress-bar" style="width:100px;height:7px">
              <div class="progress-fill ${total > 100 ? 'progress-red' : total >= 80 ? 'progress-gold' : 'progress-blue'}" style="width:${Math.min(100, total)}%"></div>
            </div>
            <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:13px;color:${total > 100 ? 'var(--danger)' : total >= 80 ? 'var(--gold)' : 'var(--text)'}">${total.toFixed(1)}%</span>
          </div>
        </td>
        <td>${status}</td>
      </tr>`;
    }).join('');
  }
}

// HTML 이스케이프
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── 인력 배정 모달 ──
function openAddPersonnelModal() {
  populatePersonnelModalSelects();
  ['ap-rate'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['ap-start','ap-end'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('ap-role').value = '참여연구원';
  document.getElementById('add-personnel-modal').classList.add('open');
}

function closeAddPersonnelModal() {
  document.getElementById('add-personnel-modal').classList.remove('open');
}

function populatePersonnelModalSelects() {
  // 사업 옵션 (PROJECTS_LIST는 GET /projects의 결과 — 모든 사업 포함)
  const projSel = document.getElementById('ap-project');
  if (projSel) {
    projSel.innerHTML = '<option value="">사업을 선택하세요</option>' +
      PROJECTS_LIST.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.icon || '📁')} ${escapeHtml(p.name)}</option>`).join('');
  }
  // 팀원 옵션 (현재 팀의 사용자)
  const userSel = document.getElementById('ap-user');
  if (userSel) {
    userSel.innerHTML = '<option value="">팀원을 선택하세요</option>' +
      _teamUsers.map(u => `<option value="${u.id}">${escapeHtml(u.name)}</option>`).join('');
  }
}

async function updateAssignmentField(id, field, rawValue) {
  let value;
  if (field === 'rate') {
    value = parseFloat(rawValue) || 0;
    if (value < 0 || value > 100) {
      showToast('⚠️ 참여율은 0~100 사이여야 합니다');
      await renderPersonnelMgmt();
      return;
    }
  } else if (field === 'start_date' || field === 'end_date') {
    value = rawValue || null;
  } else {
    value = rawValue;
  }

  // 변경 전에 projectId 확보 — 양방향 동기화 알림용
  const projId = (_assignments.find(a => a.id === id) || {}).project_id;

  try {
    const res = await fetch(`${API_BASE}/assignments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 저장 실패: ${err.detail || '서버 오류'}`);
      await renderPersonnelMgmt();
      return;
    }
    showToast('✅ 저장되었습니다');
    await renderPersonnelMgmt();
    notifyIframePersonnelChanged(projId);
  } catch (e) {
    console.error('[updateAssignmentField] 실패:', e);
    showToast('❌ 서버 연결 오류');
    await renderPersonnelMgmt();
  }
}

// ── 참여 사업 수 클릭 시 팝업 ──
function closeAssignmentsPopup() {
  const ex = document.getElementById('assignments-popup');
  if (ex) ex.remove();
}

// 팀원 행의 "수행사업 권한" 셀 클릭 시 — 그 팀원의 사업별 역할/참여율 팝업
async function showUserRolesPopup(event, username) {
  event.stopPropagation();
  closeAssignmentsPopup();

  let assignments = [];
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(username)}/assignments`);
    assignments = res.ok ? await res.json() : [];
  } catch { assignments = []; }

  const popup = document.createElement('div');
  popup.id = 'assignments-popup';
  popup.style.cssText = [
    'position:fixed','z-index:9999','background:var(--surface)','border:1px solid var(--border)',
    'border-radius:10px','padding:12px 14px','box-shadow:0 8px 24px rgba(0,0,0,0.18)',
    'min-width:280px','max-width:380px','font-size:12px',
    `left:${event.clientX}px`, `top:${event.clientY}px`,
  ].join(';');

  if (assignments.length === 0) {
    popup.innerHTML = `<div style="color:var(--text3);text-align:center;padding:8px">권한 부여된 사업이 없습니다</div>`;
  } else {
    const items = assignments.map(a => {
      // 사업 이름/아이콘은 API 응답을 우선 사용 (member의 PROJECTS_LIST는 본인 권한 사업만 담고 있어 lookup 실패할 수 있음)
      const icon = a.project_icon || '📁';
      const name = a.project_name || a.project_id;
      const dim  = a.is_active ? '' : 'opacity:0.55;';
      return `<div style="padding:6px 0;border-bottom:1px dashed var(--border);display:flex;justify-content:space-between;gap:10px;align-items:center;${dim}">
        <span style="color:var(--text);flex:1;min-width:0">${icon} ${escapeHtml(name)}</span>
        <span style="font-size:11px;color:var(--text2);white-space:nowrap">${escapeHtml(a.role || '-')}</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);white-space:nowrap;min-width:48px;text-align:right">${Number(a.rate).toFixed(1)}%</span>
      </div>`;
    }).join('');
    popup.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:var(--text);font-size:13px">사업별 역할 (${assignments.length}건)</div>
      <div>${items}</div>
    `;
  }

  popup.addEventListener('mouseleave', closeAssignmentsPopup);
  document.body.appendChild(popup);

  const rect = popup.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8)  popup.style.left = (window.innerWidth - rect.width  - 8) + 'px';
  if (rect.bottom > window.innerHeight - 8) popup.style.top  = (window.innerHeight - rect.height - 8) + 'px';
}

function showAssignmentsPopup(event, userId) {
  event.stopPropagation();
  closeAssignmentsPopup();

  const user = _teamUsers.find(u => u.id === userId);
  const userName = user ? user.name : '';
  const myAssignments = _assignments.filter(a => a.user_id === userId && a.is_active);

  const popup = document.createElement('div');
  popup.id = 'assignments-popup';
  popup.style.cssText = [
    'position:fixed', 'z-index:9999',
    'background:var(--surface)', 'border:1px solid var(--border)', 'border-radius:10px',
    'padding:12px 14px', 'box-shadow:0 8px 24px rgba(0,0,0,0.18)',
    'min-width:240px', 'max-width:340px', 'font-size:12px',
    `left:${event.clientX}px`, `top:${event.clientY}px`,
  ].join(';');

  if (myAssignments.length === 0) {
    popup.innerHTML = `<div style="color:var(--text3);text-align:center;padding:8px">참여 중인 사업 없음</div>`;
  } else {
    const items = myAssignments.map(a => {
      const proj = PROJECTS_LIST.find(p => String(p.id) === String(a.project_id));
      const icon = proj?.icon || '📁';
      const name = proj?.name || a.project_id;
      return `<div style="padding:6px 0;border-bottom:1px dashed var(--border);display:flex;justify-content:space-between;gap:10px;align-items:center">
        <span style="color:var(--text)">${icon} ${escapeHtml(name)}</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);white-space:nowrap">${Number(a.rate).toFixed(1)}%</span>
      </div>`;
    }).join('');
    popup.innerHTML = `
      <div style="font-weight:700;margin-bottom:6px;color:var(--text);font-size:13px">${escapeHtml(userName)} · 참여 사업 ${myAssignments.length}개</div>
      <div>${items}</div>
    `;
  }

  popup.addEventListener('mouseleave', closeAssignmentsPopup);
  document.body.appendChild(popup);

  // 화면 밖으로 벗어나지 않게 위치 보정
  const rect = popup.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (rect.right > vw - 8)  popup.style.left = (vw - rect.width  - 8) + 'px';
  if (rect.bottom > vh - 8) popup.style.top  = (vh - rect.height - 8) + 'px';
}

async function savePersonnelAssignment() {
  const projectId = document.getElementById('ap-project').value;
  const userId    = parseInt(document.getElementById('ap-user').value, 10);
  const role      = document.getElementById('ap-role').value;
  const rate      = parseFloat(document.getElementById('ap-rate').value) || 0;
  let startDate = document.getElementById('ap-start').value || null;
  let endDate   = document.getElementById('ap-end').value   || null;

  if (!projectId)            { showToast('⚠️ 사업을 선택하세요'); return; }
  if (!userId || isNaN(userId)) { showToast('⚠️ 팀원을 선택하세요'); return; }
  if (rate < 0 || rate > 100)   { showToast('⚠️ 참여율은 0~100 사이여야 합니다'); return; }

  // 시작일/종료일이 비어 있으면 해당 사업의 시작일/종료일을 기본값으로 채움
  if (!startDate || !endDate) {
    const proj = PROJECTS_LIST.find(p => String(p.id) === String(projectId));
    if (proj) {
      const toISO = (s) => {
        if (!s) return null;
        const nums = String(s).replace(/[^0-9]/g, '');
        if (nums.length === 8) return `${nums.slice(0,4)}-${nums.slice(4,6)}-${nums.slice(6,8)}`;
        const parts = String(s).split(/[\s./-]+/).filter(Boolean);
        if (parts.length === 3) {
          const y = parts[0].length === 2 ? '20' + parts[0] : parts[0];
          return `${y}-${parts[1].padStart(2,'0')}-${parts[2].substring(0,2).padStart(2,'0')}`;
        }
        return null;
      };
      if (!startDate) startDate = toISO(proj.startDate || proj.start_date || proj.startdate);
      if (!endDate)   endDate   = toISO(proj.endDate   || proj.end_date   || proj.enddate);
    }
  }

  if (startDate && endDate && startDate > endDate) {
    showToast('⚠️ 시작일이 종료일보다 늦을 수 없습니다'); return;
  }

  const btn = document.getElementById('ap-save-btn');
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, project_id: projectId, rate, role, start_date: startDate, end_date: endDate }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 저장 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    showToast(`✅ 참여 정보가 저장되었습니다`);
    closeAddPersonnelModal();
    await renderPersonnelMgmt();
    notifyIframePersonnelChanged(projectId);
  } catch (e) {
    console.error('[savePersonnelAssignment] 실패:', e);
    showToast('❌ 서버 연결 오류');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteAssignment(id) {
  if (!confirm('이 참여 정보를 삭제하시겠습니까?')) return;
  // 삭제 전 projectId 확보 — DELETE 후엔 캐시에 없을 수 있음
  const projId = (_assignments.find(a => a.id === id) || {}).project_id;
  try {
    const res = await fetch(`${API_BASE}/assignments/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 삭제 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    showToast('🗑️ 삭제 완료');
    await renderPersonnelMgmt();
    notifyIframePersonnelChanged(projId);
  } catch (e) {
    console.error('[deleteAssignment] 실패:', e);
    showToast('❌ 서버 연결 오류');
  }
}

// 사이드바 '참여인력 관리' 변경 → 열려있는 사업 iframe에 반영 알림 (양방향 동기화)
// 무한루프 방지: iframe은 자기 변경 시 'personnelChanged'를 부모로 보내고,
// 부모 → iframe은 'personnelChangedExternal' 이라는 다른 type을 사용하므로 서로 다시 트리거되지 않음.
function notifyIframePersonnelChanged(projId) {
  if (!projId) return;
  const frames = document.querySelectorAll('iframe[id$="-project-frame"]');
  frames.forEach(f => {
    try { f.contentWindow?.postMessage({ type: 'personnelChangedExternal', projId }, '*'); }
    catch (e) { /* iframe not loaded yet — ignore */ }
  });
}


/* ══════════════════════════════════════
   보고서 워크플로우 (위→아래 요청)
   /reports API 연동, 파일 업로드 포함
══════════════════════════════════════ */
const REPORT_STATUS_BADGE = {
  '요청': '<span class="badge badge-blue">요청</span>',
  '제출': '<span class="badge badge-gold">제출</span>',
  '승인': '<span class="badge badge-green">승인</span>',
  '반려': '<span class="badge badge-red">반려</span>',
};

function _myUsername() {
  return (currentUser && (currentUser.gwId || currentUser.username)) || '';
}

function _fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function _fmtReportDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }); }
  catch { return iso; }
}

async function fetchReports(view) {
  const username = _myUsername();
  if (!username) return [];
  try {
    const r = await fetch(`${API_BASE}/reports?username=${encodeURIComponent(username)}&role_view=${encodeURIComponent(view)}`);
    return r.ok ? await r.json() : [];
  } catch (e) { console.error('[fetchReports]', e); return []; }
}

function _filesHtml(rep) {
  if (!rep.files || rep.files.length === 0) {
    return '<div style="font-size:11px;color:var(--text3);padding:4px 0">첨부 파일 없음</div>';
  }
  return rep.files.map(f =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0">
       <span>📎</span>
       <a href="${API_BASE}${f.download_url}" target="_blank" download="${escapeHtml(f.original_filename)}"
          style="color:var(--accent);text-decoration:underline">${escapeHtml(f.original_filename)}</a>
       <span style="color:var(--text3)">(${_fmtBytes(f.file_size)})</span>
     </div>`
  ).join('');
}

function _reportItemHtml(rep, mode) {
  // mode: 'received' (내가 받은 — 제출/첨부) | 'sent' (내가 요청 — 승인/반려)
  const due = rep.due_date ? `📅 ${rep.due_date}까지` : '';
  const peer = mode === 'received' ? `요청자: ${escapeHtml(rep.requester_name)}` : `대상자: ${escapeHtml(rep.target_name)}`;
  const created = _fmtReportDate(rep.created_at);
  const submitted = rep.submitted_at ? `· 제출 ${_fmtReportDate(rep.submitted_at)}` : '';
  const reviewed = rep.reviewed_at ? `· 검토 ${_fmtReportDate(rep.reviewed_at)}` : '';
  const rejectInfo = rep.status === '반려' && rep.reject_reason
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:6px 10px;border-radius:6px;font-size:11px;margin-top:6px">반려 사유: ${escapeHtml(rep.reject_reason)}</div>`
    : '';

  let actions = '';
  if (mode === 'received' && (rep.status === '요청' || rep.status === '반려')) {
    actions = `
      <label class="btn-sm" style="background:var(--surface2);border:1px solid var(--border);padding:4px 10px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:4px">
        📎 파일 첨부
        <input type="file" style="display:none" onchange="uploadReportFile(${rep.id}, this)">
      </label>
      <button class="btn-sm btn-sm-primary" style="padding:4px 10px;font-size:11px"
              onclick="submitReport(${rep.id})">제출</button>`;
  } else if (mode === 'sent' && rep.status === '제출') {
    actions = `
      <button class="btn-sm btn-sm-primary" style="padding:4px 10px;font-size:11px"
              onclick="approveReport(${rep.id})">승인</button>
      <button class="btn-sm" style="padding:4px 10px;font-size:11px;background:#fee2e2;border:1px solid #fecaca;color:#b91c1c"
              onclick="toggleRejectForm(${rep.id})">반려</button>`;
  }
  if (mode === 'sent') {
    actions += ` <button class="btn-sm" style="padding:4px 10px;font-size:11px;background:transparent;border:1px solid var(--border);color:var(--text3)"
                         onclick="deleteReport(${rep.id})">삭제</button>`;
  }

  // 반려 사유 인라인 입력 폼 — 기본은 숨겨져 있고 toggleRejectForm으로 펼침
  const rejectFormHtml = (mode === 'sent' && rep.status === '제출') ? `
    <div id="reject-form-${rep.id}" style="display:none;margin-top:8px;padding:10px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
      <div style="font-size:11px;color:#b91c1c;font-weight:600;margin-bottom:6px">반려 사유를 입력하세요</div>
      <textarea id="reject-reason-${rep.id}" rows="2" placeholder="예: 첨부된 자료가 누락되어 다시 제출 부탁드립니다."
                style="width:100%;border:1px solid var(--border);border-radius:6px;padding:6px 8px;font-size:12px;font-family:inherit;resize:vertical;outline:none"></textarea>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
        <button class="btn-sm" style="padding:4px 10px;font-size:11px;background:transparent;border:1px solid var(--border);color:var(--text3)"
                onclick="toggleRejectForm(${rep.id})">취소</button>
        <button class="btn-sm" style="padding:4px 10px;font-size:11px;background:#dc2626;border:1px solid #dc2626;color:#fff"
                onclick="confirmReject(${rep.id})">반려 확정</button>
      </div>
    </div>` : '';

  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px">
          ${REPORT_STATUS_BADGE[rep.status] || ''}
          <strong style="font-size:13px">${escapeHtml(rep.title)}</strong>
        </div>
        <div style="font-size:11px;color:var(--text3);text-align:right">${peer}<br>요청 ${created} ${submitted} ${reviewed}</div>
      </div>
      ${rep.description ? `<div style="font-size:12px;color:var(--text2);margin:4px 0 8px">${escapeHtml(rep.description)}</div>` : ''}
      ${due ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">${due}</div>` : ''}
      <div style="background:var(--surface2);border-radius:6px;padding:6px 10px;margin:6px 0">
        ${_filesHtml(rep)}
      </div>
      ${rejectInfo}
      ${rejectFormHtml}
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">${actions}</div>
    </div>`;
}

async function renderReportsLeader() {
  const isMember = currentUser && currentUser.role === 'member';

  // 페이지 설명 문구 — member는 받은 보고서 전용 표현으로
  const descEl = document.getElementById('reports-page-desc');
  if (descEl) {
    descEl.textContent = isMember
      ? '상위 권한자가 요청한 보고서를 확인하고 파일을 첨부해 제출하세요.'
      : '받은 보고서를 검토·승인하고 하위 권한자에게 새 보고서를 요청하세요.';
  }

  const recvEl = document.getElementById('reports-received-list');
  const sentEl = document.getElementById('reports-sent-list');
  if (recvEl) recvEl.innerHTML = '<div style="font-size:12px;color:var(--text3)">불러오는 중…</div>';
  if (sentEl) sentEl.innerHTML = '<div style="font-size:12px;color:var(--text3)">불러오는 중…</div>';

  // member는 받은 보고서만 fetch (요청 카드는 CSS로 숨겨져 있음)
  const fetchPromises = isMember
    ? [fetchReports('target'), Promise.resolve([])]
    : [fetchReports('target'), fetchReports('requester')];
  const [received, sent] = await Promise.all(fetchPromises);

  if (recvEl) {
    recvEl.innerHTML = received.length === 0
      ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">받은 보고서가 없습니다</div>'
      : received.map(r => _reportItemHtml(r, 'received')).join('');
  }
  if (sentEl && !isMember) {
    sentEl.innerHTML = sent.length === 0
      ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">요청한 보고서가 없습니다</div>'
      : sent.map(r => _reportItemHtml(r, 'sent')).join('');
  }
  // 대상자 드롭다운 채우기 (member는 의미 없지만 form 자체가 숨겨짐)
  if (!isMember) await populateReportTargetSelect();
}

async function renderReportsMember() {
  const recvEl = document.getElementById('reports-received-list-m');
  if (recvEl) recvEl.innerHTML = '<div style="font-size:12px;color:var(--text3)">불러오는 중…</div>';
  const received = await fetchReports('target');
  if (recvEl) {
    recvEl.innerHTML = received.length === 0
      ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">받은 보고서가 없습니다</div>'
      : received.map(r => _reportItemHtml(r, 'received')).join('');
  }
}

const _ROLE_RANK_FRONT = { sysadmin: 4, admin: 3, leader: 2, member: 1 };

// role enum → 한글 라벨 매핑 (UI 표시용)
const ROLE_KOR = { sysadmin: '관리자', admin: '부서장', leader: '팀장', member: '팀원' };

async function populateReportTargetSelect() {
  const sel = document.getElementById('rep-req-target');
  if (!sel) return;
  const myRank = _ROLE_RANK_FRONT[(currentUser && currentUser.role) || 'member'] || 0;
  if (myRank <= 1) {
    sel.innerHTML = '<option value="">하위 권한자가 없습니다</option>';
    return;
  }
  try {
    const r = await fetch(`${API_BASE}/users`);
    const users = r.ok ? await r.json() : [];
    const subordinates = users.filter(u => {
      const ur = _ROLE_RANK_FRONT[u.role || 'member'] || 0;
      return ur < myRank && u.username !== _myUsername();
    });
    sel.innerHTML = '<option value="">대상자를 선택하세요</option>' +
      subordinates.map(u => {
        const roleKor = ROLE_KOR[u.role] || u.role;
        return `<option value="${escapeHtml(u.username)}">${escapeHtml(u.name)} (${escapeHtml(u.team_name || '미배정')} · ${escapeHtml(roleKor)})</option>`;
      }).join('');
  } catch (e) {
    console.error('[populateReportTargetSelect]', e);
    sel.innerHTML = '<option value="">목록을 불러올 수 없습니다</option>';
  }
}

async function submitReportRequest() {
  const title  = document.getElementById('rep-req-title').value.trim();
  const target = document.getElementById('rep-req-target').value;
  const desc   = document.getElementById('rep-req-desc').value.trim();
  const due    = document.getElementById('rep-req-due').value;
  if (!title)  { showToast('⚠️ 제목을 입력하세요'); return; }
  if (!target) { showToast('⚠️ 대상자를 선택하세요'); return; }
  try {
    const r = await fetch(`${API_BASE}/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requester_username: _myUsername(),
        target_username: target,
        title, description: desc, due_date: due || null,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 요청 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    showToast('📩 보고서 요청을 발송했습니다');
    document.getElementById('rep-req-title').value = '';
    document.getElementById('rep-req-desc').value = '';
    document.getElementById('rep-req-due').value = '';
    document.getElementById('rep-req-target').value = '';
    renderReportsLeader();
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}

async function uploadReportFile(reportId, inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('actor_username', _myUsername());
  try {
    const r = await fetch(`${API_BASE}/reports/${reportId}/files`, { method: 'POST', body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 업로드 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    showToast('📎 파일이 첨부됐습니다');
    // 현재 활성 탭에 따라 적절한 렌더 함수 호출
    if (document.getElementById('ltab-reports')?.classList.contains('active')) renderReportsLeader();
    else if (document.getElementById('mtab-reports')?.classList.contains('active')) renderReportsMember();
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
  inputEl.value = '';
}

async function _putReportStatus(reportId, status, rejectReason) {
  try {
    const r = await fetch(`${API_BASE}/reports/${reportId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor_username: _myUsername(),
        status,
        reject_reason: rejectReason || null,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 처리 실패: ' + (err.detail || '서버 오류'));
      return false;
    }
    return true;
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); return false; }
}

async function submitReport(reportId) {
  if (!confirm('보고서를 제출하시겠습니까?\n첨부 파일이 있는지 확인해주세요.')) return;
  if (await _putReportStatus(reportId, '제출')) {
    showToast('✅ 보고서를 제출했습니다');
    if (document.getElementById('ltab-reports')?.classList.contains('active')) renderReportsLeader();
    else renderReportsMember();
  }
}

async function approveReport(reportId) {
  if (!confirm('이 보고서를 승인하시겠습니까?')) return;
  if (await _putReportStatus(reportId, '승인')) {
    showToast('✅ 승인되었습니다');
    renderReportsLeader();
  }
}

function toggleRejectForm(reportId) {
  const form = document.getElementById(`reject-form-${reportId}`);
  if (!form) return;
  const wasHidden = form.style.display === 'none';
  form.style.display = wasHidden ? '' : 'none';
  if (wasHidden) {
    const ta = document.getElementById(`reject-reason-${reportId}`);
    if (ta) setTimeout(() => ta.focus(), 50);
  }
}

async function confirmReject(reportId) {
  const ta = document.getElementById(`reject-reason-${reportId}`);
  const reason = (ta && ta.value || '').trim();
  if (!reason) { showToast('⚠️ 반려 사유를 입력하세요'); if (ta) ta.focus(); return; }
  if (await _putReportStatus(reportId, '반려', reason)) {
    showToast('반려 처리되었습니다');
    renderReportsLeader();
  }
}

async function deleteReport(reportId) {
  if (!confirm('이 보고서를 삭제하시겠습니까? (첨부 파일도 함께 삭제됩니다)')) return;
  try {
    const r = await fetch(`${API_BASE}/reports/${reportId}?actor_username=${encodeURIComponent(_myUsername())}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 삭제 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    showToast('🗑 삭제됐습니다');
    renderReportsLeader();
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}


/* ══════════════════════════════════════
   공지사항 (DB 연동) — 모두 작성/조회 가능, 작성자만 수정/삭제
   가시 범위: sysadmin/admin이 작성하면 전체 팀 공개, leader/member는 본인 팀만 노출
══════════════════════════════════════ */
const GLOBAL_NOTICE_ROLES_FRONT = new Set(['sysadmin', 'admin']);

// 팀명에 이미 "팀"이 들어있으면 suffix 생략 (예: "AI융합산업팀" + "팀" → "AI융합산업팀 팀" 중복 방지)
function _teamLabel(name) {
  const s = String(name || '').trim();
  if (!s) return '팀';
  return s.endsWith('팀') ? s : (s + ' 팀');
}
function _teamBoardLabel(name) {
  const s = String(name || '').trim();
  if (!s) return '팀 게시판';
  return s.endsWith('팀') ? (s + ' 게시판') : (s + ' 팀 게시판');
}

function _isNoticeNew(iso) {
  if (!iso) return false;
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
    return diff < 3;
  } catch { return false; }
}

async function _fetchNotices() {
  try {
    const me = encodeURIComponent(_myUsername() || '');
    const r = await fetch(`${API_BASE}/notices?viewer_username=${me}`);
    return r.ok ? await r.json() : [];
  } catch (e) { console.error('[fetchNotices]', e); return []; }
}

function _noticeFilesHtml(n) {
  if (!n.files || n.files.length === 0) return '';
  return `<div style="background:var(--surface2);border-radius:6px;padding:6px 10px;margin:6px 0">
    ${n.files.map(f =>
      `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0">
         <span>📎</span>
         <a href="${API_BASE}${f.download_url}" target="_blank" download="${escapeHtml(f.original_filename)}"
            style="color:var(--accent);text-decoration:underline">${escapeHtml(f.original_filename)}</a>
         <span style="color:var(--text3)">(${_fmtBytes(f.file_size)})</span>
       </div>`
    ).join('')}
  </div>`;
}

function _noticeScopeBadge(n) {
  // target_team_name이 NULL이면 전체 공지, 값 있으면 그 팀 공지
  if (!n.target_team_name) {
    return '<span class="badge badge-purple" style="font-size:10px">전체</span>';
  }
  return `<span class="badge badge-blue" style="font-size:10px">${escapeHtml(n.target_team_name)}</span>`;
}

function _noticeItemHtml(n) {
  const dateOnly = (n.created_at || '').slice(0, 10);
  const isNew = _isNoticeNew(n.created_at);
  const importantBadge = n.important ? '<span class="badge badge-red" style="font-size:10px">중요</span>' : '';
  const scopeBadge = _noticeScopeBadge(n);
  const newBadge = isNew ? '<span class="notice-new">NEW</span>' : '';
  const isMine = currentUser && (n.creator_username === (currentUser.gwId || currentUser.username));
  const canDelete = isMine || (currentUser && currentUser.role === 'sysadmin');
  const delBtn = canDelete
    ? `<button class="btn-sm" style="padding:2px 8px;font-size:11px;background:transparent;border:1px solid var(--border);color:var(--text3)" onclick="deleteNotice(${n.id})">삭제</button>`
    : '';
  const creatorRoleKor = ROLE_KOR[n.creator_role] || '';
  return `
    <div class="notice-item">
      <div class="notice-title-row">
        ${importantBadge}
        ${scopeBadge}
        <span class="notice-title">${escapeHtml(n.title)}</span>
        ${newBadge}
        <span style="margin-left:auto">${delBtn}</span>
      </div>
      ${n.content ? `<div style="font-size:12px;color:var(--text2);margin:4px 0 6px;white-space:pre-wrap">${escapeHtml(n.content)}</div>` : ''}
      ${_noticeFilesHtml(n)}
      <div class="notice-meta">${escapeHtml(n.creator_name || '익명')}${creatorRoleKor ? ` (${creatorRoleKor})` : ''} · ${escapeHtml(dateOnly)}</div>
    </div>`;
}

// 작성자 role에 따라 게시 대상 드롭다운 채우기
// - sysadmin/admin: "전체" + 모든 팀
// - leader/member:  "전체" + 본인 팀
async function _populateNoticeScopeSelect(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const sel = document.getElementById('notice-new-scope' + sx);
  if (!sel) return;
  const role = (currentUser && currentUser.role) || 'member';
  const myTeam = (currentUser && currentUser.dept) || '';
  const isGlobal = GLOBAL_NOTICE_ROLES_FRONT.has(role);

  let teams = [];
  if (isGlobal) {
    try {
      const r = await fetch(`${API_BASE}/teams`);
      teams = r.ok ? await r.json() : [];
    } catch (e) { console.error('[notice scope] teams fetch 실패:', e); }
  }

  const opts = ['<option value="all">📢 전체 (모든 팀)</option>'];
  if (isGlobal) {
    teams.forEach(t => {
      opts.push(`<option value="${t.id}">${escapeHtml(_teamLabel(t.name))}</option>`);
    });
  } else {
    // leader/member는 본인 팀만 — team_id를 모르면 "본인 팀"이라는 표시로 폴백
    if (currentUser && currentUser.team_id) {
      opts.push(`<option value="${currentUser.team_id}" selected>${escapeHtml(_teamLabel(myTeam || '본인 팀'))}</option>`);
    } else {
      // team_id가 없으면 "본인 팀"을 빈 문자열(scope=auto)로 보내 백엔드가 자동 판정
      opts.push(`<option value="" selected>${escapeHtml(_teamLabel(myTeam || '본인 팀'))}</option>`);
    }
  }
  sel.innerHTML = opts.join('');

  // 기본 선택: sysadmin/admin은 "전체", leader/member는 본인 팀(이미 selected)
  if (isGlobal) sel.value = 'all';
}

async function renderNoticesLeader() {
  await _populateNoticeScopeSelect('');
  const list = document.getElementById('notice-list');
  if (list) list.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:12px">불러오는 중…</div>';
  const notices = await _fetchNotices();
  if (list) {
    list.innerHTML = notices.length === 0
      ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">등록된 공지가 없습니다</div>'
      : notices.map(_noticeItemHtml).join('');
  }
}

async function renderNoticesMember() {
  await _populateNoticeScopeSelect('m');
  const list = document.getElementById('notice-list-m');
  if (list) list.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:12px">불러오는 중…</div>';
  const notices = await _fetchNotices();
  if (list) {
    list.innerHTML = notices.length === 0
      ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">등록된 공지가 없습니다</div>'
      : notices.map(_noticeItemHtml).join('');
  }
}

async function submitNotice(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const title     = document.getElementById('notice-new-title'     + sx).value.trim();
  const content   = document.getElementById('notice-new-content'   + sx).value.trim();
  const important = document.getElementById('notice-new-important' + sx).checked;
  const scopeEl   = document.getElementById('notice-new-scope'     + sx);
  const target_scope = scopeEl ? (scopeEl.value || '') : '';
  const fileInput = document.getElementById('notice-new-files'     + sx);
  const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  if (!title) { showToast('⚠️ 제목을 입력하세요'); return; }
  try {
    // 1) 공지 생성
    const r = await fetch(`${API_BASE}/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor_username: _myUsername(),
        title, content, important,
        target_scope,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 게시 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    const created = await r.json();

    // 2) 첨부 파일 일괄 업로드
    let uploadedCount = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('actor_username', _myUsername());
      try {
        const ur = await fetch(`${API_BASE}/notices/${created.id}/files`, { method: 'POST', body: fd });
        if (ur.ok) uploadedCount++;
        else console.warn('[submitNotice] 파일 업로드 실패:', f.name);
      } catch (e) { console.error('[submitNotice] 업로드 오류:', f.name, e); }
    }

    showToast(files.length
      ? `📢 공지 게시됨 (파일 ${uploadedCount}/${files.length}개 첨부)`
      : '📢 공지를 게시했습니다');
    document.getElementById('notice-new-title'     + sx).value   = '';
    document.getElementById('notice-new-content'   + sx).value   = '';
    document.getElementById('notice-new-important' + sx).checked = false;
    if (fileInput) fileInput.value = '';
    if (suffix === 'm') renderNoticesMember(); else renderNoticesLeader();
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}

async function deleteNotice(noticeId) {
  if (!confirm('이 공지를 삭제하시겠습니까?')) return;
  try {
    const r = await fetch(`${API_BASE}/notices/${noticeId}?actor_username=${encodeURIComponent(_myUsername())}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 삭제 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    showToast('🗑 삭제됐습니다');
    if (document.getElementById('ltab-notices')?.classList.contains('active')) renderNoticesLeader();
    else renderNoticesMember();
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}


/* ══════════════════════════════════════
   게시판 (DB 연동) — 전체/팀별로 분리
   /board/posts API — 작성자 role 기준 viewer 필터링, 작성자만 삭제
   suffix: '' (leader page) 또는 'm' (member page)
══════════════════════════════════════ */
const BOARD_GLOBAL_ROLES_FRONT = new Set(['sysadmin', 'admin']);

async function _fetchBoardPosts() {
  try {
    const me = encodeURIComponent(_myUsername() || '');
    const r = await fetch(`${API_BASE}/board/posts?viewer_username=${me}`);
    return r.ok ? await r.json() : [];
  } catch (e) { console.error('[fetchBoardPosts]', e); return []; }
}

// 작성자 role 기준 게시 대상 select 채우기 (공지 패턴과 동일)
async function _populateBoardScopeSelect(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const sel = document.getElementById('board-new-scope' + sx);
  if (!sel) return;
  const role = (currentUser && currentUser.role) || 'member';
  const myTeam = (currentUser && currentUser.dept) || '';
  const isGlobal = BOARD_GLOBAL_ROLES_FRONT.has(role);

  let teams = [];
  if (isGlobal) {
    try {
      const r = await fetch(`${API_BASE}/teams`);
      teams = r.ok ? await r.json() : [];
    } catch (e) { console.error('[board scope] teams fetch 실패:', e); }
  }

  const opts = ['<option value="all">📢 전체 게시판</option>'];
  if (isGlobal) {
    teams.forEach(t => opts.push(`<option value="${t.id}">${escapeHtml(_teamBoardLabel(t.name))}</option>`));
  } else {
    if (currentUser && currentUser.team_id) {
      opts.push(`<option value="${currentUser.team_id}" selected>${escapeHtml(_teamBoardLabel(myTeam || '본인 팀'))}</option>`);
    } else {
      opts.push(`<option value="" selected>${escapeHtml(_teamBoardLabel(myTeam || '본인 팀'))}</option>`);
    }
  }
  sel.innerHTML = opts.join('');
  if (isGlobal) sel.value = 'all';
}

// 글 목록 필터 select 채우기 — viewer가 볼 수 있는 scope만
async function _populateBoardFilterSelect(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const sel = document.getElementById('board-filter-scope' + sx);
  if (!sel) return;
  const role = (currentUser && currentUser.role) || 'member';
  const isGlobal = BOARD_GLOBAL_ROLES_FRONT.has(role);

  let teams = [];
  if (isGlobal) {
    try {
      const r = await fetch(`${API_BASE}/teams`);
      teams = r.ok ? await r.json() : [];
    } catch {}
  }

  const opts = ['<option value="all">전체 보기 (모든 게시판)</option>',
                '<option value="global">📢 전체 게시판만</option>'];
  if (isGlobal) {
    teams.forEach(t => opts.push(`<option value="${t.id}">${escapeHtml(_teamBoardLabel(t.name))}</option>`));
  } else if (currentUser && currentUser.team_id) {
    const myTeam = currentUser.dept || '본인 팀';
    opts.push(`<option value="${currentUser.team_id}">${escapeHtml(_teamBoardLabel(myTeam))}</option>`);
  }
  // 현재 선택값 유지
  const prev = sel.value;
  sel.innerHTML = opts.join('');
  if (prev) sel.value = prev;
}

function _boardScopeBadge(post) {
  if (!post.target_team_name) return '<span class="badge badge-purple" style="font-size:10px">전체</span>';
  return `<span class="badge badge-blue" style="font-size:10px">${escapeHtml(post.target_team_name)}</span>`;
}

function _boardFilesHtml(post) {
  if (!post.files || post.files.length === 0) {
    return '<div style="font-size:11px;color:var(--text3);padding:4px 0">첨부 파일 없음</div>';
  }
  return post.files.map(f =>
    `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0">
       <span>📎</span>
       <a href="${API_BASE}${f.download_url}" target="_blank" download="${escapeHtml(f.original_filename)}"
          style="color:var(--accent);text-decoration:underline">${escapeHtml(f.original_filename)}</a>
       <span style="color:var(--text3)">(${_fmtBytes(f.file_size)})</span>
     </div>`
  ).join('');
}

function _boardPostHtml(post) {
  const dateStr = _fmtReportDate(post.created_at);
  const isMine = currentUser && (post.author_username === (currentUser.gwId || currentUser.username));
  const canDelete = isMine || (currentUser && currentUser.role === 'sysadmin');
  const authorRoleKor = ROLE_KOR[post.author_role] || '';
  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px">
          ${_boardScopeBadge(post)}
          <strong style="font-size:14px">${escapeHtml(post.title)}</strong>
        </div>
        <div style="font-size:11px;color:var(--text3);text-align:right">
          ${escapeHtml(post.author_name || '익명')}${authorRoleKor ? ` (${authorRoleKor})` : ''} · ${escapeHtml(dateStr)} · 조회 ${post.view_count || 0}
        </div>
      </div>
      ${post.content ? `<div style="font-size:12px;color:var(--text2);margin:4px 0 8px;white-space:pre-wrap">${escapeHtml(post.content)}</div>` : ''}
      <div style="background:var(--surface2);border-radius:6px;padding:6px 10px;margin:6px 0">
        ${_boardFilesHtml(post)}
      </div>
      ${canDelete ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
        <button class="btn-sm" style="padding:4px 10px;font-size:11px;background:#fee2e2;border:1px solid #fecaca;color:#b91c1c" onclick="deleteBoardPost(${post.id})">삭제</button>
      </div>` : ''}
    </div>`;
}

async function renderBoard(suffix) {
  const sx = suffix ? '-' + suffix : '';
  await _populateBoardScopeSelect(suffix || '');
  await _populateBoardFilterSelect(suffix || '');
  const list = document.getElementById('board-list' + sx);
  if (list) list.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:12px">불러오는 중…</div>';
  const posts = await _fetchBoardPosts();

  // 필터 적용 — "all" = 전부, "global" = target_team_id가 NULL인 것만, "<id>" = 그 팀 글만
  const filterEl = document.getElementById('board-filter-scope' + sx);
  const filter = filterEl ? filterEl.value : 'all';
  const filtered = posts.filter(p => {
    if (filter === 'all') return true;
    if (filter === 'global') return p.target_team_id == null;
    return String(p.target_team_id) === String(filter);
  });

  if (list) {
    list.innerHTML = filtered.length === 0
      ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">표시할 글이 없습니다</div>'
      : filtered.map(_boardPostHtml).join('');
  }
}

async function submitBoardPost(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const title   = document.getElementById('board-new-title' + sx).value.trim();
  const content = document.getElementById('board-new-content' + sx).value.trim();
  const scopeEl = document.getElementById('board-new-scope' + sx);
  const target_scope = scopeEl ? (scopeEl.value || '') : '';
  const fileInput = document.getElementById('board-new-files' + sx);
  const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  if (!title) { showToast('⚠️ 제목을 입력하세요'); return; }
  try {
    // 1) 게시글 생성
    const r = await fetch(`${API_BASE}/board/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor_username: _myUsername(),
        title, content,
        target_scope,
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 게시 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    const created = await r.json();

    // 2) 선택한 파일들을 순차 업로드
    let uploadedCount = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('actor_username', _myUsername());
      try {
        const ur = await fetch(`${API_BASE}/board/posts/${created.id}/files`, { method: 'POST', body: fd });
        if (ur.ok) uploadedCount++;
        else console.warn('[submitBoardPost] 파일 업로드 실패:', f.name, await ur.text());
      } catch (e) { console.error('[submitBoardPost] 업로드 오류:', f.name, e); }
    }

    showToast(files.length
      ? `📋 게시글 등록됨 (파일 ${uploadedCount}/${files.length}개 첨부)`
      : '📋 게시글이 등록됐습니다');
    document.getElementById('board-new-title' + sx).value = '';
    document.getElementById('board-new-content' + sx).value = '';
    if (fileInput) fileInput.value = '';
    const preview = document.getElementById('board-new-files-preview' + sx);
    if (preview) preview.textContent = '';
    renderBoard(suffix || '');
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}

async function deleteBoardPost(postId) {
  if (!confirm('이 게시글을 삭제하시겠습니까? (첨부 파일도 함께 삭제됩니다)')) return;
  try {
    const r = await fetch(`${API_BASE}/board/posts/${postId}?actor_username=${encodeURIComponent(_myUsername())}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 삭제 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    showToast('🗑 삭제됐습니다');
    if (document.getElementById('ltab-board')?.classList.contains('active')) renderBoard('');
    else renderBoard('m');
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}

/* ══════════════════════════════════════════
   건의사항 게시판 (FeedbackPost)
   - 모든 role: 작성
   - admin/sysadmin: 전체 목록 조회
   - 그 외: 본인 제출 목록만 조회
══════════════════════════════════════════ */
async function _fetchFeedbackPosts() {
  try {
    const me = encodeURIComponent(_myUsername() || '');
    const r = await fetch(`${API_BASE}/feedback/posts?viewer_username=${me}`);
    return r.ok ? await r.json() : [];
  } catch (e) { console.error('[fetchFeedbackPosts]', e); return []; }
}

function _feedbackFilesHtml(post) {
  if (!post.files || post.files.length === 0) {
    return '<div style="font-size:11px;color:var(--text3);padding:4px 0">첨부 파일 없음</div>';
  }
  return post.files.map(f => {
    const isImg = /\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(f.original_filename);
    const dlUrl = `${API_BASE}${f.download_url}`;
    return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;padding:2px 0">
      <span>${isImg ? '🖼' : '📎'}</span>
      <a href="${dlUrl}" target="_blank" download="${escapeHtml(f.original_filename)}"
         style="color:var(--accent);text-decoration:underline">${escapeHtml(f.original_filename)}</a>
      <span style="color:var(--text3)">(${_fmtBytes(f.file_size)})</span>
    </div>
    ${isImg ? `<div style="margin:4px 0 2px"><a href="${dlUrl}" target="_blank"><img src="${dlUrl}" alt="${escapeHtml(f.original_filename)}" loading="lazy" style="max-width:240px;max-height:160px;border-radius:6px;border:1px solid var(--border)"></a></div>` : ''}`;
  }).join('');
}

function _feedbackPostHtml(post) {
  const dateStr = _fmtReportDate(post.created_at);
  const isMine = currentUser && (post.author_username === (currentUser.gwId || currentUser.username));
  const isAdmin = currentUser && BOARD_GLOBAL_ROLES_FRONT.has(currentUser.role);
  const canDelete = isMine || isAdmin;
  const authorRoleKor = ROLE_KOR[post.author_role] || '';
  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--surface)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px">
        <strong style="font-size:14px">${escapeHtml(post.title)}</strong>
        <div style="font-size:11px;color:var(--text3);text-align:right;white-space:nowrap">
          ${escapeHtml(post.author_name || '익명')}${authorRoleKor ? ` (${authorRoleKor})` : ''} · ${escapeHtml(dateStr)}
        </div>
      </div>
      ${post.content ? `<div style="font-size:12px;color:var(--text2);margin:4px 0 8px;white-space:pre-wrap">${escapeHtml(post.content)}</div>` : ''}
      <div style="background:var(--surface2);border-radius:6px;padding:6px 10px;margin:6px 0">
        ${_feedbackFilesHtml(post)}
      </div>
      ${canDelete ? `<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
        <button class="btn-sm" style="padding:4px 10px;font-size:11px;background:#fee2e2;border:1px solid #fecaca;color:#b91c1c" onclick="deleteFeedbackPost(${post.id})">삭제</button>
      </div>` : ''}
    </div>`;
}

async function renderFeedback(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const isAdmin = currentUser && BOARD_GLOBAL_ROLES_FRONT.has(currentUser.role);

  // 목록 영역 가시성 + 타이틀
  const listWrap = document.getElementById('feedback-list-wrap' + sx);
  const listTitle = document.getElementById('feedback-list-title' + sx);
  if (listTitle) listTitle.textContent = isAdmin ? '전체 건의사항' : '내 건의사항';
  if (listWrap) listWrap.style.display = '';   // 모두에게 표시 (본인 것만 보이거나 전체 보이거나)

  const list = document.getElementById('feedback-list' + sx);
  if (!list) return;
  list.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:12px">불러오는 중…</div>';
  const posts = await _fetchFeedbackPosts();
  list.innerHTML = posts.length === 0
    ? '<div style="font-size:12px;color:var(--text3);padding:12px;text-align:center">제출된 건의사항이 없습니다</div>'
    : posts.map(_feedbackPostHtml).join('');
}

async function submitFeedbackPost(suffix) {
  const sx = suffix ? '-' + suffix : '';
  const title   = document.getElementById('feedback-new-title' + sx)?.value.trim();
  const content = document.getElementById('feedback-new-content' + sx)?.value.trim();
  const fileInput = document.getElementById('feedback-new-files' + sx);
  const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
  if (!title) { showToast('⚠️ 제목을 입력하세요'); return; }
  try {
    const r = await fetch(`${API_BASE}/feedback/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor_username: _myUsername(), title, content }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 제출 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    const created = await r.json();
    let uploadedCount = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('actor_username', _myUsername());
      try {
        const ur = await fetch(`${API_BASE}/feedback/posts/${created.id}/files`, { method: 'POST', body: fd });
        if (ur.ok) uploadedCount++;
        else console.warn('[submitFeedbackPost] 파일 업로드 실패:', f.name, await ur.text());
      } catch (e) { console.error('[submitFeedbackPost] 업로드 오류:', f.name, e); }
    }
    showToast(files.length
      ? `💬 건의사항 제출됨 (파일 ${uploadedCount}/${files.length}개 첨부)`
      : '💬 건의사항이 제출됐습니다');
    if (document.getElementById('feedback-new-title' + sx)) document.getElementById('feedback-new-title' + sx).value = '';
    if (document.getElementById('feedback-new-content' + sx)) document.getElementById('feedback-new-content' + sx).value = '';
    if (fileInput) fileInput.value = '';
    renderFeedback(suffix || '');
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}

async function deleteFeedbackPost(postId) {
  if (!confirm('이 건의사항을 삭제하시겠습니까? (첨부 파일도 함께 삭제됩니다)')) return;
  try {
    const r = await fetch(`${API_BASE}/feedback/posts/${postId}?actor_username=${encodeURIComponent(_myUsername())}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 삭제 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    showToast('🗑 삭제됐습니다');
    if (document.getElementById('ltab-feedback')?.classList.contains('active')) renderFeedback('');
    else if (document.getElementById('mtab-feedback')?.classList.contains('active')) renderFeedback('m');
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}


/* ══════════════════════════════════════
   iframe → team-system 예산 동기화
   사업별 예산 관리에서 변경되면 사업비 관리 페이지의 합산 자동 갱신
══════════════════════════════════════ */
window.addEventListener('message', (e) => {
  const { type, projId, summary } = e.data || {};
  if(type === 'budgetUpdated' && projId) {
    // 사업비 관리 탭이 열려있으면 PROJECTS_LIST를 새로 fetch해서 합산 갱신
    const tab = document.getElementById('ltab-budget-mgmt');
    if(tab && tab.classList.contains('active')) {
      fetchProjectsFromDB().then(() => renderBudgetMgmt()).catch(() => {});
    }
  }
  if(type === 'personnelChanged') {
    // iframe 인력관리에서 변경 → 사이드바 참여인력 관리 자동 갱신
    const tab = document.getElementById('ltab-personnel-mgmt');
    if(tab && tab.classList.contains('active') && typeof renderPersonnelMgmt === 'function') {
      renderPersonnelMgmt();
    }
  }
  // (Phase 3-A) iframe WBS 변경 → Project.progress 갱신 + 사이드바 진행율 카드 재렌더
  if(type === 'wbsChanged' && projId) {
    fetchProjectsFromDB().then(() => {
      if (typeof refreshAllProjectViews === 'function') refreshAllProjectViews();
    }).catch(() => {});
  }
  // (Phase 3-A) iframe ToDo의 '팀장 보고' → 사이드바 '주요 업무보고 관리' 갱신
  if(type === 'taskReported') {
    const tab = document.getElementById('ltab-tasks');
    if(tab && tab.classList.contains('active') && typeof renderTasksTab === 'function') {
      renderTasksTab();
    }
  }
  // iframe 내부에서 프로젝트 필드 수정 (예: 사업 담당자) → PROJECTS_LIST 캐시 갱신
  if(type === 'projectUpdated' && projId && e.data.field) {
    const p = PROJECTS_LIST.find(x => x.id === projId);
    if (p) {
      p[e.data.field] = e.data.value;
    }
  }
  // (Phase 3-B) iframe 내부 탭 전환 → 부모 사이드바의 nav-proj-item active 동기화
  if(type === 'iframeTabChanged' && projId && e.data.tab) {
    const tabId = e.data.tab;
    ['leader', 'member'].forEach(role => {
      const itemPrefix = (role === 'leader' ? 'lpitem-' : 'mpitem-');
      // 현재 사업의 모든 sub-item에서 active 제거 후 해당 탭만 추가
      const container = document.getElementById((role === 'leader' ? 'lpi-' : 'mpi-') + projId);
      if (!container) return;
      container.querySelectorAll('.nav-proj-item').forEach(i => i.classList.remove('active'));
      const target = document.getElementById(itemPrefix + projId + '-' + tabId);
      if (target) target.classList.add('active');
    });
    // activeProjTab 추적 변수 갱신 (refreshAllProjectViews 복원용)
    if (typeof activeProjTab !== 'undefined') {
      ['leader','member'].forEach(r => { if (activeProjId[r] === projId) activeProjTab[r] = tabId; });
    }
  }
});


function changeProjectStatus(projId, newStatus) {
  const proj = PROJECTS_LIST.find(p=>p.id===projId);
  if(!proj) return;
  proj.status = newStatus;
  proj.ps     = getStatusPs(newStatus);
  saveProjectsList(PROJECTS_LIST);
  refreshAllProjectViews();
  showToast(`📋 '${proj.name}' 상태가 '${newStatus}'로 변경됐습니다`);
}


/* ── 모달 탭 전환 ── */
function switchModalTab(panelId, btn) {
  document.querySelectorAll('.modal-tab-panel').forEach(p => p.classList.remove('on'));
  document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('on'));
  document.getElementById(panelId).classList.add('on');
  btn.classList.add('on');
}

/* ── 기관 목록 관리 ── */
const ORG_TYPES = [
  { value:'전담기관', label:'🏛️ 전담기관', color:'#7c3aed' },
  { value:'지자체',   label:'🏙️ 지자체',   color:'#0891b2' },
  { value:'주관기관', label:'🏢 주관기관', color:'#2563eb' },
  { value:'참여기관', label:'🤝 참여기관', color:'#059669' },
];

let _partners = [];
let _partnerSeq = 0;

const PARTNER_PLACEHOLDER = {
  '전담기관': '예) 포항테크노파크, NIPA',
  '주관기관': '예) 영진기술 주식회사',
  '지자체':   '예) 경상북도 포항시',
  '참여기관': '예) 포항공과대학교',
};

// DOM에서 현재 입력값 저장 (렌더 전 항상 호출)
function flushPartnerInputs() {
  _partners.forEach(p => {
    const el = document.getElementById('pinp-' + p.id);
    if (el) p.val = el.value;
  });
}

function addPartner(type='참여기관', val='') {
  flushPartnerInputs();
  const id = 'partner-' + (++_partnerSeq);
  _partners.push({ id, type, val });
  renderPartners();
  setTimeout(() => {
    const el = document.getElementById('pinp-' + id);
    if (el) el.focus();
  }, 50);
}

function removePartner(id) {
  flushPartnerInputs();
  _partners = _partners.filter(p => p.id !== id);
  renderPartners();
}

function updatePartner(id, val) {
  const p = _partners.find(x => x.id === id);
  if (p) p.val = val;
}

function updatePartnerType(id, type) {
  flushPartnerInputs();
  const p = _partners.find(x => x.id === id);
  if (p) { p.type = type; renderPartners(); }
}

function renderPartners() {
  const list = document.getElementById('partner-list');
  if (!list) return;

  list.innerHTML = '';

  if (_partners.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;padding:20px;color:var(--text3);font-size:13px;border:1px dashed var(--border);border-radius:10px';
    empty.textContent = '기관이 없습니다. 위 + 기관 추가 버튼을 클릭하세요';
    list.appendChild(empty);
    return;
  }

  _partners.forEach(p => {
    const ot = ORG_TYPES.find(o => o.value === p.type) || ORG_TYPES[3];

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;padding:10px 12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)';

    // 기관 유형 select
    const sel = document.createElement('select');
    sel.style.cssText = `border:1px solid ${ot.color}20;background:${ot.color}12;font-size:12px;font-weight:700;color:${ot.color};cursor:pointer;padding:3px 6px;border-radius:6px;font-family:'Noto Sans KR',sans-serif;outline:none;min-width:88px`;
    ORG_TYPES.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (p.type === o.value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => updatePartnerType(p.id, sel.value));
    row.appendChild(sel);

    // 기관명 input
    const inp = document.createElement('input');
    inp.className = 'form-input';
    inp.id = 'pinp-' + p.id;
    inp.style.cssText = 'flex:1;padding:8px 10px';
    inp.placeholder = PARTNER_PLACEHOLDER[p.type] || PARTNER_PLACEHOLDER['참여기관'];
    inp.value = p.val || '';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => updatePartner(p.id, inp.value));
    row.appendChild(inp);

    // 삭제 버튼
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.style.cssText = 'background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:all .15s;flex-shrink:0;line-height:1';
    del.addEventListener('mouseover', () => { del.style.color = 'var(--danger)'; del.style.background = 'rgba(239,68,68,0.1)'; });
    del.addEventListener('mouseout',  () => { del.style.color = 'var(--text3)'; del.style.background = 'none'; });
    del.addEventListener('click', () => removePartner(p.id));
    row.appendChild(del);

    list.appendChild(row);
  });
}

/* ── 예산 합계 + 비율 바 ── */
function calcTotalBudget() {
  const gov   = parseInt(document.getElementById('new-proj-gov')?.value)      || 0;
  const local = parseInt(document.getElementById('new-proj-local-fund')?.value) || 0;
  const etc   = parseInt(document.getElementById('new-proj-etc-fund')?.value) || 0;
  const total = gov + local + etc;
  const disp  = document.getElementById('new-proj-total-display');
  if (disp) disp.textContent = total.toLocaleString('ko-KR') + ' 원';

  const govPct   = total > 0 ? Math.round(gov/total*100)   : 0;
  const localPct = total > 0 ? Math.round(local/total*100) : 0;
  const etcPct   = total > 0 ? 100 - govPct - localPct     : 0;

  const rg = document.getElementById('ratio-gov');
  const rl = document.getElementById('ratio-local');
  const re = document.getElementById('ratio-etc');
  if (rg) { rg.style.width = govPct+'%';   rg.textContent   = govPct>8   ? govPct+'%'   : ''; }
  if (rl) { rl.style.width = localPct+'%'; rl.textContent   = localPct>8 ? localPct+'%' : ''; }
  if (re) { re.style.width = etcPct+'%';   re.textContent   = etcPct>8   ? etcPct+'%'   : ''; }
}


/* ══════════════════════════════════════
   수행사업 편집 모달
══════════════════════════════════════ */
let _editProjId   = null;
let _editProjIcon = '📁';
let _editProjStatus = { status:'진행중', ps:'ps-active' };
let _editPartners = [];

function openEditProjModal(projId) {
  // 프로젝트 찾기 (형식 무관하게 비교하기 위해 == 사용)
  const p = PROJECTS_LIST.find(x => x.id == projId);

  if (!p) {
    console.error("❌ 프로젝트를 찾을 수 없음. 입력된 ID:", projId);
    console.log("📂 현재 목록(PROJECTS_LIST):", PROJECTS_LIST);
    showToast("프로젝트 정보를 불러올 수 없습니다.");
    return;
  }

  // 현재 수정 중인 프로젝트 ID 저장 (saveEditProject가 참조)
  _editProjId = projId;

  // 전역 상태 변수 업데이트
  _editProjIcon = p.icon || '📁';
  _editProjStatus = { status: p.status || '진행중', ps: p.ps || 'ps-active' };
  _editPartners = [];

  // 3. 기본 텍스트 필드 채우기
  document.getElementById('edit-proj-name').value = p.name || '';
  document.getElementById('edit-proj-desc').value = p.desc || '';

  // 날짜 형식 변환 로직 (기존 유지)
  const rawStart = p.startDate || p.start_date || p.startdate || '';
  const rawEnd = p.endDate || p.end_date || p.enddate || '';

  const formatToISO = (dateStr) => {
    if (!dateStr) return '';
    const nums = dateStr.replace(/[^0-9]/g, '');
    if (nums.length === 8) {
      return `${nums.substring(0, 4)}-${nums.substring(4, 6)}-${nums.substring(6, 8)}`;
    }
    const parts = dateStr.split(/[\s./-]+/).filter(Boolean);
    if (parts.length === 3) {
      const y = parts[0].length === 2 ? '20' + parts[0] : parts[0];
      const m = parts[1].padStart(2, '0');
      const d = parts[2].substring(0, 2).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return dateStr;
  };

  const finalStart = formatToISO(rawStart);
  const finalEnd = formatToISO(rawEnd);

  // 날짜 필드 주입
  const startInput = document.getElementById('edit-proj-start');
  const endInput = document.getElementById('edit-proj-end');
  if (startInput) startInput.value = finalStart;
  if (endInput) endInput.value = finalEnd;

  // 4. 예산 정보 채우기
  document.getElementById('edit-proj-gov').value = p.govFund || p.gov_fund || '';
  document.getElementById('edit-proj-local-fund').value = p.localFund || p.local_fund || '';
  document.getElementById('edit-proj-etc-fund').value = p.etcFund || p.etc_fund || '';

  // 담당 팀 드롭다운 채우기 — 현재 사업의 팀 선택
  populateEditProjTeamOptions(p.team_name || '');

  // 기관 정보 파싱 (기존 유지)
  if (p.agency) p.agency.split(',').map(v => v.trim()).filter(Boolean).forEach(v => _editPartners.push({ id: 'ep-' + Date.now() + Math.random(), type: '전담기관', val: v }));
  if (p.host) p.host.split(',').map(v => v.trim()).filter(Boolean).forEach(v => _editPartners.push({ id: 'ep-' + Date.now() + Math.random(), type: '주관기관', val: v }));
  if (p.localGov) p.localGov.split(',').map(v => v.trim()).filter(Boolean).forEach(v => _editPartners.push({ id: 'ep-' + Date.now() + Math.random(), type: '지자체', val: v }));
  if (p.partners) p.partners.forEach(v => v && _editPartners.push({ id: 'ep-' + Date.now() + Math.random(), type: '참여기관', val: v }));

  // UI 초기화
  document.querySelectorAll('#edit-proj-modal .modal-tab-panel').forEach((x, i) => x.classList.toggle('on', i === 0));
  document.querySelectorAll('#edit-proj-modal .modal-tab-btn').forEach((x, i) => x.classList.toggle('on', i === 0));
  calcEditBudget();
  
  // 아이콘 및 상태 그리드 선택 상태 표시
  document.querySelectorAll('#edit-proj-icon-grid .proj-icon-opt').forEach(el => el.classList.toggle('selected', el.dataset.icon === _editProjIcon));
  // 상태 그리드 동적 렌더 (PROJECT_STATUSES 기반, 현재 상태 selected)
  renderStatusOptions('edit-status-grid', _editProjStatus.status, 'selectEditStatus');
  
  renderEditPartners();
  
  // 모달 열기
  document.getElementById('edit-proj-modal').classList.add('open');
}

function closeEditProjModal() {
  document.getElementById('edit-proj-modal').classList.remove('open');
  _editProjId = null;
}

function selectEditProjIcon(el) {
  document.querySelectorAll('#edit-proj-icon-grid .proj-icon-opt').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  _editProjIcon = el.dataset.icon;
}

function selectEditStatus(el) {
  document.querySelectorAll('#edit-status-grid .proj-status-opt').forEach(e=>e.classList.remove('selected'));
  el.classList.add('selected');
  _editProjStatus = { status: el.dataset.status, ps: el.dataset.ps };
}

function addEditPartner(type='참여기관', val='') {
  flushEditPartnerInputs();
  const id = 'ep-' + Date.now();
  _editPartners.push({ id, type, val });
  renderEditPartners();
  setTimeout(()=>{ const el=document.getElementById('epinp-'+id); if(el) el.focus(); },50);
}

function removeEditPartner(id) {
  flushEditPartnerInputs();
  _editPartners = _editPartners.filter(p=>p.id!==id);
  renderEditPartners();
}

function flushEditPartnerInputs() {
  _editPartners.forEach(p=>{
    const el=document.getElementById('epinp-'+p.id);
    if(el) p.val=el.value;
  });
}

function updateEditPartner(id, val) {
  const p=_editPartners.find(x=>x.id===id); if(p) p.val=val;
}

function updateEditPartnerType(id, type) {
  flushEditPartnerInputs();
  const p=_editPartners.find(x=>x.id===id); if(p){p.type=type;renderEditPartners();}
}

function renderEditPartners() {
  const list=document.getElementById('edit-partner-list'); if(!list) return;
  if(!_editPartners.length){
    list.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;border:1px dashed var(--border);border-radius:10px">기관이 없습니다</div>`;
    return;
  }
  list.innerHTML=_editPartners.map(p=>{
    const ot=ORG_TYPES.find(o=>o.value===p.type)||ORG_TYPES[3];
    return `<div style="display:flex;gap:8px;align-items:center;padding:10px 12px;background:var(--surface2);border-radius:10px;border:1px solid var(--border)">
      <select onchange="updateEditPartnerType('${p.id}',this.value)"
              style="border:none;background:transparent;font-size:12px;font-weight:700;color:${ot.color};cursor:pointer;padding:3px 6px;border-radius:6px;font-family:'Noto Sans KR',sans-serif;outline:none;min-width:88px;border:1px solid ${ot.color}20;background:${ot.color}12">
        ${ORG_TYPES.map(o=>`<option value="${o.value}" ${p.type===o.value?'selected':''}>${o.label}</option>`).join('')}
      </select>
      <input class="form-input" id="epinp-${p.id}" style="flex:1;padding:8px 10px"
             value="${p.val}"
             oninput="updateEditPartner('${p.id}',this.value)">
      <button onclick="removeEditPartner('${p.id}')"
              style="background:none;border:none;color:var(--text3);font-size:18px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:all .15s;flex-shrink:0;line-height:1"
              onmouseover="this.style.color='var(--danger)'"
              onmouseout="this.style.color='var(--text3)'">✕</button>
    </div>`;
  }).join('');
}

function calcEditBudget() {
  const gov  = parseInt(document.getElementById('edit-proj-gov')?.value)||0;
  const loc  = parseInt(document.getElementById('edit-proj-local-fund')?.value)||0;
  const etc  = parseInt(document.getElementById('edit-proj-etc-fund')?.value)||0;
  const disp = document.getElementById('edit-proj-total-display');
  if(disp) disp.textContent = (gov+loc+etc).toLocaleString('ko-KR') + ' 원';
}

function parseFund(value) {
  if (!value) return 0;
  // 문자로 바꾼 뒤 콤마를 모두 지우고 정수로 변환합니다.
  return parseInt(String(value).replace(/,/g, ''), 10) || 0;
}

async function saveEditProject() {
  flushEditPartnerInputs();
  const name = document.getElementById('edit-proj-name').value.trim();
  if(!name) { showToast('⚠️ 사업명을 입력하세요'); return; }

  const teamName = document.getElementById('edit-proj-team')?.value?.trim() || '';
  if (!teamName) { showToast('⚠️ 담당 팀을 선택해주세요.'); return; }

  const gov  = parseInt(document.getElementById('edit-proj-gov')?.value)||0;
  const loc  = parseInt(document.getElementById('edit-proj-local-fund')?.value)||0;
  const etc  = parseInt(document.getElementById('edit-proj-etc-fund')?.value)||0;

  const proj = PROJECTS_LIST.find(p=>p.id===_editProjId);
  if(!proj) return;

  // 💡 2. 먼저 로컬 변수(proj)에 수정된 값들을 담습니다.
  const updatedData = {
    name,
    icon:       _editProjIcon,
    status:     _editProjStatus.status,
    ps:         _editProjStatus.ps,
    startDate:  document.getElementById('edit-proj-start').value  || null,
    endDate:    document.getElementById('edit-proj-end').value    || null,
    desc:       document.getElementById('edit-proj-desc').value.trim(),
    team_name:  teamName,
    agency:     _editPartners.filter(p=>p.type==='전담기관').map(p=>p.val).filter(Boolean).join(', '),
    host:       _editPartners.filter(p=>p.type==='주관기관').map(p=>p.val).filter(Boolean).join(', '),
    localGov:   _editPartners.filter(p=>p.type==='지자체').map(p=>p.val).filter(Boolean).join(', '),
    partners:   _editPartners.filter(p=>p.type==='참여기관').map(p=>p.val).filter(Boolean),
    orgs:       _editPartners.filter(p=>p.val).map(p=>({type:p.type,name:p.val})),
    govFund: parseFund(document.getElementById('edit-proj-gov').value),
    localFund: parseFund(document.getElementById('edit-proj-local-fund').value),
    etcFund: parseFund(document.getElementById('edit-proj-etc-fund').value),
  
    // 총 사업비는 국비+지방비+기타를 합쳐서 바로 보내는 것이 가장 안전합니다!
    totalBudget: parseFund(document.getElementById('edit-proj-gov').value) +
                 parseFund(document.getElementById('edit-proj-local-fund').value) +
                parseFund(document.getElementById('edit-proj-etc-fund').value)
  };

  // 사업비 관리 동기화 (기존 로직 유지)
  if(gov+loc+etc > 0){
    const budgets = loadBudgetData();
    budgets[proj.id] = { total: gov+loc+etc, govFund: gov, localFund: loc };
    saveBudgetData(budgets);
  }

  // ================================================================
  // 🚀 [핵심 변경] 로컬 저장을 지우고 백엔드 DB의 해당 ID를 수정(PUT)합니다.
  // ================================================================
  try {
    const response = await fetch(`${API_BASE}/projects/${proj.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedData)
    });

    if (response.ok) {
      // 3. DB 수정이 성공하면 최신 목록을 다시 불러와 화면을 갱신합니다.
      await fetchProjectsFromDB(); 
      
      if (typeof refreshAllProjectViews === 'function') refreshAllProjectViews();
      closeEditProjModal();
      showToast(`✅ '${name}' 정보가 DB에 실시간 반영됐습니다!`);
    } else {
      showToast('수정 실패 ❌ 서버 에러가 발생했습니다.');
    }
  } catch (error) {
    console.error("서버 수정 에러:", error);
    showToast('서버 연결 오류 ❌');
  }
}

// 편집 모달 backdrop 닫기
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('edit-proj-modal').addEventListener('click', function(e){
    if(e.target===this) closeEditProjModal();
  });
});


/* ══════════════════════════════════════
   팀원 생성 기능
══════════════════════════════════════ */

function updateMemberField(gwId, field, value) {
  const m = MEMBER_LIST.find(x=>x.gwId===gwId);
  if(!m) return;
  m[field] = value;
  saveMemberList(MEMBER_LIST);
  // 팀명 변경 시 MEMBER_DEPT 동기화
  if(field==='dept') { MEMBER_DEPT[m.name] = value; }
  showToast(`✅ '${m.name}' ${field==='dept'?'팀명':'담당업무'}이 변경됐습니다`);
}

// (Phase 3-A) updateUserStatus — User.status 컬럼 폐기에 따라 함수 제거됨

// 팀원 행에서 담당 업무(`pos`) 즉시 저장 — PATCH /users/{username}/pos
async function updateUserPos(username, newPos) {
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(username)}/pos`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pos: newPos || '' }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 저장 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    showToast('✅ 담당 업무가 저장되었습니다');
  } catch (err) {
    console.error('[updateUserPos] 실패:', err);
    showToast('❌ 서버 연결 오류');
  }
}

// sysadmin 전용: 사용자 role 변경 — PUT /users/{username}/role?actor=sysadmin
async function changeUserRole(username, newRole) {
  if (!currentUser || currentUser.role !== 'sysadmin') {
    showToast('❌ 권한이 없습니다');
    if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();
    return;
  }
  const myUsername = currentUser.gwId || currentUser.username;
  if (username === myUsername && newRole !== 'sysadmin') {
    showToast('⚠️ 본인의 sysadmin 권한은 변경할 수 없습니다');
    if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();
    return;
  }
  try {
    const url = `${API_BASE}/users/${encodeURIComponent(username)}/role?actor=${encodeURIComponent(myUsername)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ role 변경 실패: ${err.detail || '서버 오류'}`);
      if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();
      return;
    }
    showToast(`✅ ${username}의 권한이 변경되었습니다`);
    if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();
  } catch (err) {
    console.error('[changeUserRole] 실패:', err);
    showToast('❌ 서버 연결 오류');
    if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();
  }
}

function renderMembersTable(users, opts) {
  opts = opts || {};
  const tbodyId = opts.tbodyId || 'members-tbody';
  const readonly = !!opts.readonly;
  const tbody = document.getElementById(tbodyId);
  if(!tbody) return;

  // (권한 로직이 있다면 그대로 사용, 없다면 빈 객체로 에러 방지)
  const perms = typeof loadPermissions === 'function' ? loadPermissions() : {};

  const colspan = readonly ? 7 : 9;
  // DB에서 가져온 유저가 없으면 안내 문구 출력
  if (!users || users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;padding:24px;color:var(--text3)">팀원이 없습니다.</td></tr>`;
    if (!readonly) updateMemberCount(0);
    return;
  }

  const ROLE_OPTIONS = [
    { value:'sysadmin', label:'관리자' },
    { value:'admin',    label:'부서장' },
    { value:'leader',   label:'팀장' },
    { value:'member',   label:'팀원' },
  ];
  const myUsername = (currentUser && (currentUser.gwId || currentUser.username)) || null;

  // 배열을 돌면서 HTML 생성
  tbody.innerHTML = users.map(u => {
    // 1. DB 데이터 매핑
    const initial = u.name.charAt(0);
    const dept = u.team_name || '-';
    const pos  = u.pos || '';
    const userRole = u.role || 'member';
    const isSelf = (myUsername && u.username === myUsername);

    // 2. 미구현 기능 프레임 (기본값 설정)
    const progress = 0; // 나중에 DB에서 가져올 값

    // 3. UI 로직
    const pCount = (perms[u.name] || []).length;

    // pCount > 0이면 클릭 시 사업별 역할/참여율 팝업 노출
    const pBadge = pCount > 0
      ? `<span class="perm-badge-count" id="perm-count-${u.username}"
              onclick="showUserRolesPopup(event,'${u.username}')"
              style="cursor:pointer">${pCount}개 사업</span>`
      : `<span class="perm-badge-none" id="perm-count-${u.username}">미배정</span>`;

    const fillColor = progress>=80?'progress-green':progress>=60?'progress-blue':progress>=40?'progress-gold':'progress-red';
    const warn = progress<40?' ⚠':'';

    // role 드롭다운 (sysadmin만 보임)
    const roleSelect = `<select class="form-input" style="font-size:12px;padding:4px 6px;min-width:80px"
                               onchange="changeUserRole('${u.username}', this.value)">
      ${ROLE_OPTIONS.map(o => `<option value="${o.value}"${userRole===o.value?' selected':''}>${o.label}</option>`).join('')}
    </select>`;

    // 4. HTML 조립 — readonly(멤버 뷰)는 6컬럼, 일반은 8컬럼 (상태 컬럼 제거)
    if (readonly) {
      // 담당업무: 본인 행은 편집 가능, 그 외는 텍스트
      const posCell = isSelf
        ? `<input class="form-input" type="text" placeholder="담당 업무 입력"
                  style="font-size:12px;padding:4px 8px;min-width:160px"
                  value="${pos.replace(/"/g,'&quot;')}"
                  onchange="updateUserPos('${u.username}', this.value)">`
        : (pos ? pos.replace(/</g,'&lt;') : '<span style="color:var(--text3)">-</span>');

      // 권한: granted_project_ids 길이 사용 (DB 기준). 1개 이상이면 클릭 시 사업별 역할/참여율 팝업
      const grantedIds = Array.isArray(u.granted_project_ids) ? u.granted_project_ids : [];
      const permsCell = grantedIds.length > 0
        ? `<span onclick="showUserRolesPopup(event,'${u.username}')"
                 style="font-size:12px;color:var(--accent);cursor:pointer;text-decoration:underline;font-weight:600">${grantedIds.length}개 사업</span>`
        : `<span style="font-size:12px;color:var(--text3)">미배정</span>`;

      return `<tr>
        <td><strong style="color:var(--text)">${u.name}</strong></td>
        <td><span style="font-family:'DM Mono',monospace;font-size:12px">${u.username||'-'}</span></td>
        <td>${dept}</td>
        <td>${posCell}</td>
        <td>
          <div class="progress-bar" style="width:80px"><div class="progress-fill ${fillColor}" style="width:${progress}%"></div></div>
          <span style="font-size:11px;color:${progress<40?'var(--danger)':'var(--text2)'}">${progress}%${warn}</span>
        </td>
        <td>${permsCell}</td>
      </tr>`;
    }

    // member는 자기 행만 담당업무 편집 가능. 그 외(leader/admin/sysadmin)는 모두 편집 가능
    const isMemberRole = (currentUser && currentUser.role === 'member');
    const posCell = (isMemberRole && !isSelf)
      ? `<span style="font-size:12px;color:var(--text2)">${pos ? pos.replace(/</g,'&lt;') : '-'}</span>`
      : `<input class="form-input" type="text" placeholder="담당 업무 입력"
                style="font-size:12px;padding:4px 8px;min-width:160px"
                value="${pos.replace(/"/g, '&quot;')}"
                onchange="updateUserPos('${u.username}', this.value)">`;

    return `<tr>
      <td><strong style="color:var(--text)">${u.name}</strong></td>
      <td><span style="font-family:'DM Mono',monospace;font-size:12px">${u.username||'-'}</span></td>

      <td>${dept}</td>
      <td class="sysadmin-only">${roleSelect}</td>
      <td>${posCell}</td>

      <td>
        <div class="progress-bar" style="width:80px"><div class="progress-fill ${fillColor}" style="width:${progress}%"></div></div>
        <span style="font-size:11px;color:${progress<40?'var(--danger)':'var(--text2)'}">${progress}%${warn}</span>
      </td>

      <td id="perm-cell-${u.username}">
        <button class="btn-sm btn-sm-ghost leader-only-action" style="font-size:12px"
                onclick="openPermModal('${u.name}','${dept}','${initial}','${u.username}')">
          🔐 권한설정
        </button>
        ${pBadge}
      </td>

      <td style="display:flex;gap:4px" class="leader-only-action">
        <button class="btn-sm btn-sm-ghost" onclick="openAssignModal('${u.name}')">업무 배정</button>
        <button class="btn-sm btn-sm-danger" style="padding:6px 8px" onclick="deleteMember('${u.username}','${u.name}')">✕</button>
      </td>
    </tr>`;
  }).join('');

  // 5. 카운트 업데이트 (readonly에서는 leader 페이지의 카운트는 건드리지 않음)
  if (!readonly) updateMemberCount(users.length);

  // 6. 참여인력 동기화 (선생님 코드 유지)
  if (typeof TEAM_MEMBERS !== 'undefined') {
    TEAM_MEMBERS.length = 0;
    users.forEach(u => { 
      TEAM_MEMBERS.push(u.name); 
      if (typeof MEMBER_DEPT !== 'undefined') MEMBER_DEPT[u.name] = u.team_name; 
    });
  }
}

// 🚀 [보조 함수] 카운트 업데이트 로직
function updateMemberCount(count) {
  const countEl = document.querySelector('#ltab-members .card-title');
  if(countEl && countEl.textContent.includes('팀원 목록')) {
    countEl.textContent = `팀원 목록 (${count}명)`;
  }
}

function openCreateMemberModal() {
  ['cm-name','cm-gw','cm-email','cm-role','cm-pw'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('create-member-modal').classList.add('open');
}

function quickCreateMember() {
  const name = document.getElementById('quick-member-name')?.value.trim();
  const gwId = document.getElementById('quick-member-gw')?.value.trim();
  const dept = document.getElementById('quick-member-dept')?.value;
  if(!name||!gwId){ showToast('⚠️ 이름과 그룹웨어 아이디를 입력하세요'); return; }
  if(MEMBER_LIST.find(m=>m.gwId===gwId)){ showToast('⚠️ 이미 존재하는 아이디입니다'); return; }
  MEMBER_LIST.push({ name, gwId, dept, role:'', progress:0, status:'활동중', statusClass:'badge-green' });
  saveMemberList(MEMBER_LIST);
  renderMembersTable();
  document.getElementById('quick-member-name').value='';
  document.getElementById('quick-member-gw').value='';
  showToast(`'${name}' (${gwId}) 팀원이 생성됐습니다`);
}

function createMember() {
  const name  = document.getElementById('cm-name')?.value.trim();
  const gwId  = document.getElementById('cm-gw')?.value.trim();
  const email = document.getElementById('cm-email')?.value.trim();
  const dept  = document.getElementById('cm-dept')?.value;
  const role  = document.getElementById('cm-role')?.value.trim();
  if(!name||!gwId){ showToast('⚠️ 이름과 그룹웨어 아이디를 입력하세요'); return; }
  if(MEMBER_LIST.find(m=>m.gwId===gwId)){ showToast('⚠️ 이미 존재하는 아이디입니다'); return; }
  MEMBER_LIST.push({ name, gwId, email, dept, role, progress:0, status:'활동중', statusClass:'badge-green' });
  saveMemberList(MEMBER_LIST);
  renderMembersTable();
  document.getElementById('create-member-modal').classList.remove('open');
  showToast(`✅ '${name}' (${gwId}) 팀원이 생성됐습니다`);
}

async function deleteMember(username, name) {
  const label = name || username;
  if (!confirm(`'${label}' 팀원을 삭제하시겠습니까?\n관련 권한 및 사업 매핑도 함께 정리됩니다.`)) return;
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(username)}`, {
      method: 'DELETE'
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 삭제 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    showToast(`🗑️ '${label}' 팀원이 삭제됐습니다`);
    // 목록 즉시 갱신 (현재 로그인 사용자의 팀 기준 필터링)
    if (typeof fetchMembersFromDB === 'function') await fetchMembersFromDB();
  } catch (e) {
    console.error('팀원 삭제 에러:', e);
    showToast('❌ 서버 연결 오류 (백엔드 확인 필요)');
  }
}

// ==========================================
// 🚀 [1] 퀵 생성 로직 (화면 내 생성 버튼)
// ==========================================
async function quickCreateMember() {
  const name = document.getElementById('quick-member-name').value.trim();
  const gwId = document.getElementById('quick-member-gw').value.trim();
  const dept = document.getElementById('quick-member-dept').value;

  // 1. 필수값 체크
  if (!name || !gwId) {
    alert("이름과 그룹웨어 아이디를 입력해주세요.");
    return;
  }

  // 2. DB로 보낼 데이터 포장 (빈칸 및 1234 고정 조건 반영)
  const payload = {
    name: name,
    username: gwId,
    team_name: dept,
    email: "",         // 공란
    pos: "",           // 담당 업무 공란 (백엔드 스키마에 따라 pos 또는 task)
    password: "1234",  // 퀵 생성은 무조건 1234
    role: "member"
  };

  // 3. 통신 함수 호출
  const success = await saveMemberToDB(payload);
  
  // 4. 성공 시 입력칸 비우기
  if (success) {
    document.getElementById('quick-member-name').value = '';
    document.getElementById('quick-member-gw').value = '';
  }
}


// ==========================================
// 🚀 [2] 모달 창 생성 로직 (알려주신 코드 포함)
// ==========================================
function openCreateMemberModal() {
  ['cm-name','cm-gw','cm-email','cm-role','cm-pw'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.value = '';
  });

  // 팀 드롭다운을 최신 DB 목록으로 채우고, 내 팀을 기본 선택
  if (typeof refreshTeamDropdowns === 'function') {
    refreshTeamDropdowns();
  }
  const myTeamName = localStorage.getItem('user_team_name') || '';
  const dept = document.getElementById('cm-dept');
  if (dept && myTeamName) {
    // refreshTeamDropdowns가 비동기일 수 있어 다음 틱에 한 번 더 시도
    const trySetDept = () => {
      const opt = Array.from(dept.options).find(o => o.value === myTeamName);
      if (opt) dept.value = myTeamName;
    };
    trySetDept();
    setTimeout(trySetDept, 200);
  }

  document.getElementById('create-member-modal').classList.add('open');
}

function closeCreateMemberModal() {
  document.getElementById('create-member-modal').classList.remove('open');
}

async function saveDetailedMember() {
  const name = document.getElementById('cm-name').value.trim();
  const gwId = document.getElementById('cm-gw').value.trim();
  const dept = document.getElementById('cm-dept').value;
  const email = document.getElementById('cm-email').value.trim();
  const roleTask = document.getElementById('cm-role').value.trim();
  const pw = document.getElementById('cm-pw').value.trim();

  // 1. 필수값 체크
  if (!name || !gwId || !dept) {
    alert("이름, 그룹웨어 아이디, 팀명은 필수 입력 사항입니다.");
    return;
  }

  // 2. DB로 보낼 데이터 포장 (조건 완벽 반영)
  const payload = {
    name: name,
    username: gwId,
    team_name: dept,
    email: email,      // 입력 안 했으면 자연스럽게 공란("")으로 전송됨
    pos: roleTask,     // 입력 안 했으면 공란("")
    password: pw !== "" ? pw : "1234", // 🔥 입력값이 있으면 그 값, 비었으면 "1234"
    role: "member"
  };

  // 3. 통신 함수 호출
  const success = await saveMemberToDB(payload);
  
  if (success) {
    closeCreateMemberModal();
  }
}


// ==========================================
// 🚀 [3] DB 통신 (POST 요청 - 공통 사용)
// ==========================================
async function saveMemberToDB(userData) {
  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });

    if (res.ok) {
      // 팀원 목록 즉시 갱신 (현재 로그인 사용자의 팀 기준으로 필터링되어 다시 그려짐)
      if (typeof fetchMembersFromDB === 'function') {
        await fetchMembersFromDB();
      }
      showToast(`✅ [${userData.name}] 팀원이 성공적으로 생성되었습니다.`);
      return true;
    } else {
      alert("생성 실패: 이미 존재하는 아이디이거나 서버 오류입니다.");
      return false;
    }
  } catch (err) {
    console.error("생성 통신 에러:", err);
    alert("서버와 연결할 수 없습니다.");
    return false;
  }
}

/* ══════════════════════════════════════
   팀 관리
══════════════════════════════════════ */

// ==========================================
// 🚀 [1] DB에서 팀 목록 가져와서 화면에 뿌리기
// ==========================================
async function fetchTeamsFromDB() {
  try {
    const res = await fetch(`${API_BASE}/teams`);
    if (res.ok) {
      const teams = await res.json();
      renderTeamList(teams);
    }
  } catch (err) {
    console.error("팀 목록 로드 실패:", err);
  }
}

// 🚀 [수정] 팀 목록 그리기 (입력창 + 삭제 버튼 형태)
function renderTeamList(teams) {
  const listContainer = document.getElementById('team-list');
  if (!listContainer) return;

  listContainer.innerHTML = ''; 
  // 기존의 가로 나열(wrap)을 세로 나열(column)로 강제 변경
  listContainer.style.flexDirection = 'column'; 

  teams.forEach(team => {
    // 1. 한 줄을 감싸는 박스 생성
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '8px';
    row.style.alignItems = 'center';
    row.style.width = '100%';

    // 2. 바 형태의 입력창 생성
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input';
    input.value = team.name;
    input.style.flex = '1'; // 가로 공간 꽉 채우기

    // 🔥 [핵심 이벤트] 입력창에서 마우스가 빠져나갔을 때 (blur) 수정 실행
    input.addEventListener('blur', () => {
      const newName = input.value.trim();
      // 이름이 비어있지 않고, 기존 이름과 다를 때만 DB 수정 요청
      if (newName && newName !== team.name) {
        updateTeamName(team.id, newName, team.name);
      } else {
        input.value = team.name; // 빈칸으로 두면 원래 이름으로 원복
      }
    });

    // 엔터키를 쳐도 blur(포커스 해제)가 되도록 설정
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });

    // 3. 우측 '삭제' 버튼 생성
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-sm-ghost';
    delBtn.style.color = 'var(--danger)';
    delBtn.style.minWidth = '50px';
    delBtn.innerText = '삭제';
    delBtn.onclick = () => deleteTeam(team.name); // 기존 삭제 함수 재활용

    // 4. 조립해서 화면에 넣기
    row.appendChild(input);
    row.appendChild(delBtn);
    listContainer.appendChild(row);
  });
}

async function updateTeamName(teamId, newName, oldName) {
  try {
    const res = await fetch(`${API_BASE}/teams/${teamId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });

    if (res.ok) {
      showToast(`'${oldName}'이(가) '${newName}'(으)로 변경되었습니다.`);
      
      const targetOld = (oldName || '').trim();

      // 🔥 [불도저 업데이트] 내 팀인지 따지지 않고, 화면의 옛날 이름을 모조리 찾아서 바꿉니다!
      
      // 1. 부서장 사이드바 확인 및 변경
      const leaderDeptEl = document.getElementById('leader-udept');
      if (leaderDeptEl && leaderDeptEl.textContent.trim() === targetOld) {
        leaderDeptEl.textContent = newName; 
      }

      // 2. 팀원 사이드바 확인 및 변경
      const memberDeptEl = document.getElementById('member-udpet');
      if (memberDeptEl && memberDeptEl.textContent.trim() === targetOld) {
        memberDeptEl.textContent = newName; 
      }

      // 3. 설정 창 드롭다운 변경
      const settingsDeptEl = document.getElementById('settings-dept');
      if (settingsDeptEl && settingsDeptEl.value.trim() === targetOld) {
        settingsDeptEl.value = newName; 
      }

      // 4. 로컬 스토리지도 만약 옛날 이름으로 되어 있다면 덮어씌우기
      if (localStorage.getItem('user_team_name') === targetOld) {
        localStorage.setItem('user_team_name', newName);
      }
      try {
        let userStr = localStorage.getItem('pms_user');
        if (userStr) {
          let user = JSON.parse(userStr);
          if (user.dept === targetOld) user.dept = newName;
          if (user.team_name === targetOld) user.team_name = newName;
          localStorage.setItem('pms_user', JSON.stringify(user));
        }
      } catch (e) {}

      // 5. 표 갱신
      fetchTeamsFromDB(); 
      if (typeof refreshTeamDropdowns === 'function') refreshTeamDropdowns();
      
    } else {
      const errData = await res.json(); 
      showToast(`❌ 수정 실패: ${errData.detail || '오류 발생'}`);
      fetchTeamsFromDB(); 
    }
  } catch (err) {
    console.error("팀명 수정 에러:", err);
    showToast("❌ 서버와 연결할 수 없습니다.");
    fetchTeamsFromDB(); 
  }
}

// ==========================================
// 🚀 [2] 새로운 팀 추가하기 (DB 저장)
// ==========================================
async function addTeam() {
  const input = document.getElementById('new-team-name');
  const teamName = input.value.trim();

  if (!teamName) {
    showToast("❌ 추가할 팀명을 입력해주세요.");
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/teams`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: teamName })
    });

    if (res.ok) {
      showToast(`✅ [${teamName}] 팀이 추가되었습니다.`);
      input.value = ''; // 입력창 비우기
      fetchTeamsFromDB(); // 목록 새로고침
    } else {
      const errData = await res.json();
      showToast(`❌ 실패: ${errData.detail || "오류 발생"}`);
    }
  } catch (err) {
    console.error("팀 추가 통신 에러:", err);
    showToast("❌ 서버와 연결할 수 없습니다.");
  }
}

// 🚀 [수정] 진짜 DB 연동 팀 삭제 기능
async function deleteTeam(name) {
  // 1. 확인 팝업 (관계형 DB의 특성에 맞게 문구 수정)
  if(!confirm(`'${name}'을 삭제하시겠습니까?\n해당 팀에 소속된 팀원들의 소속 정보는 초기화(미배정)됩니다.`)) return;

  try {
    // 2. 서버로 DELETE 통신 보내기 (URL에 팀 이름을 실어서 보냅니다)
    const res = await fetch(`${API_BASE}/teams/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });

    if (res.ok) {
      // 3. 성공 시: 로컬 변수(TEAMS)를 수정하는 대신 DB에서 목록을 새로 긁어옵니다.
      showToast(`🗑️ '${name}'이 삭제됐습니다`);
      fetchTeamsFromDB(); 
      
      // 만약 드롭다운(select 박스)을 업데이트하는 함수가 있다면 호출합니다.
      if (typeof refreshTeamDropdowns === 'function') refreshTeamDropdowns();
    } else {
      const errData = await res.json();
      showToast(`❌ 삭제 실패: ${errData.detail || '오류 발생'}`);
    }
  } catch (err) {
    console.error("팀 삭제 에러:", err);
    showToast("❌ 서버와 연결할 수 없습니다.");
  }
}

// 🚀 [수정] DB 연동형 드롭다운(select) 업데이트 함수
async function refreshTeamDropdowns() {
  try {
    // 1. DB에서 최신 팀 목록을 가져옵니다.
    const res = await fetch(`${API_BASE}/teams`);
    if (!res.ok) return;
    const teams = await res.json();

    // 2. 업데이트할 드롭다운(select) 요소들의 ID 목록
    // (선생님이 작성하셨던 모달창과 퀵 생성창의 select ID들입니다)
    const dropdownIds = ['quick-member-dept', 'cm-dept', 'reg-dept'];

    // 3. 각각의 드롭다운을 최신화합니다.
    dropdownIds.forEach(id => {
      const selectEl = document.getElementById(id);
      if (!selectEl) return;

      // 기존에 사용자가 선택해둔 값을 기억해둡니다 (목록이 바뀌어도 선택 유지)
      const currentValue = selectEl.value;

      // 기존 목록 비우기
      selectEl.innerHTML = '';

      // DB에서 가져온 팀 이름으로 옵션(<option>) 채우기
      teams.forEach(team => {
        const option = document.createElement('option');
        option.value = team.name;
        option.textContent = team.name;
        selectEl.appendChild(option);
      });

      // 기억해둔 기존 선택값이 새 목록에도 있다면 그대로 선택 상태 유지
      if (teams.some(t => t.name === currentValue)) {
        selectEl.value = currentValue;
      }
    });
  } catch (err) {
    console.error("드롭다운 업데이트 에러:", err);
  }
}


function saveMemberPos(pos) {
  currentUser.pos = pos;
  const mpos = document.getElementById('member-upos');
  if(mpos) mpos.textContent = pos;
  showToast('직책이 저장됐습니다 ✅');
}


/* ══════════════════════════════════════
   주요 업무보고 관리 (DB 기반)
══════════════════════════════════════ */

// 비정기 업무 — DB에서 조회 (이전엔 localStorage였음)
let TASK_LIST   = [];
let _taskFilter = 'all';

async function fetchTasksFromDB() {
  try {
    const role = (currentUser && currentUser.role) || 'member';
    const myUsername = currentUser?.gwId || currentUser?.username;
    const myTeam = (currentUser?.dept || localStorage.getItem('user_team_name') || '').trim();

    let url;
    if (role === 'sysadmin' || role === 'admin') {
      url = `${API_BASE}/tasks`;            // 전체
    } else if (role === 'leader' && myTeam) {
      url = `${API_BASE}/tasks?team_name=${encodeURIComponent(myTeam)}`;
    } else if (myUsername) {
      url = `${API_BASE}/tasks?assignee_username=${encodeURIComponent(myUsername)}`;
    } else {
      TASK_LIST = []; return;
    }
    const r = await fetch(url);
    TASK_LIST = r.ok ? await r.json() : [];
  } catch (e) {
    console.error('[fetchTasksFromDB] 실패:', e);
    TASK_LIST = [];
  }
}

const PRIO_MAP = {
  high: { label:'🔴 높음', badge:'badge-red'  },
  med:  { label:'🟡 보통', badge:'badge-gold' },
  low:  { label:'🟢 낮음', badge:'badge-green'},
};
const STATUS_MAP = {
  '진행중': 'badge-blue',
  '완료':   'badge-green',
  '지연':   'badge-red',
  '대기':   'badge-gray',
};

async function renderTasksTab() {
  // 담당자 드롭다운 — role에 따라 다르게 채움
  const sel = document.getElementById('new-task-assignee');
  if (sel) {
    const myRole     = currentUser?.role || 'member';
    const myUsername = currentUser?.gwId || currentUser?.username;
    const myName     = currentUser?.name || myUsername || '본인';
    if (myRole === 'member') {
      // 팀원: 본인 한 명만 (개인 업무 추가)
      sel.innerHTML = `<option value="${myUsername}">${escapeHtml(myName)} (본인)</option>`;
      sel.disabled = true;
    } else {
      // leader/admin/sysadmin: 팀 전체 멤버 노출 + 본인도 추가 가능
      sel.disabled = false;
      const myTeam = (currentUser?.dept || localStorage.getItem('user_team_name') || '').trim();
      if (myTeam) {
        try {
          const r = await fetch(`${API_BASE}/teams/${encodeURIComponent(myTeam)}/users`);
          const users = r.ok ? await r.json() : [];
          sel.innerHTML = users.map(u => {
            const lbl = (u.username === myUsername) ? `${escapeHtml(u.name)} (본인)` : escapeHtml(u.name);
            return `<option value="${u.username}">${lbl}</option>`;
          }).join('');
        } catch (e) { sel.innerHTML = ''; }
      }
    }
  }

  await fetchTasksFromDB();
  renderTaskTable();
}

function renderTaskTable() {
  const tbody = document.getElementById('leader-task-body');
  if(!tbody) return;

  const today = new Date().toISOString().slice(0,10);
  let list = [...TASK_LIST];

  // 마감 지난 진행중 → 자동 지연 표시 (DB 응답은 due_date 키 사용)
  list.forEach(t => {
    const due = t.due_date || t.due;
    if(t.status==='진행중' && due && due < today) t._overdue = true;
    else t._overdue = false;
  });

  if(_taskFilter !== 'all') {
    list = list.filter(t => _taskFilter==='지연'
      ? (t.status==='지연'||t._overdue)
      : t.status===_taskFilter);
  }

  // 뱃지 카운트
  const countEl = document.getElementById('task-count-badge');
  if(countEl) countEl.textContent = `(${list.length}/${TASK_LIST.length}건)`;

  if(!list.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3)">
      ${_taskFilter==='all'?'등록된 업무가 없습니다':'해당 상태의 업무가 없습니다'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(t => {
    const prio = PRIO_MAP[t.priority] || PRIO_MAP.med;
    const isOverdue = t._overdue || (t.status==='지연');
    const statusBadge = STATUS_MAP[t.status] || 'badge-gray';
    const displayStatus = t._overdue && t.status==='진행중' ? '지연' : t.status;
    const displayBadge  = t._overdue && t.status==='진행중' ? 'badge-red' : statusBadge;
    const dueStyle = isOverdue ? `color:var(--danger);font-weight:600` : '';

    let actionBtn = '';
    if(t.status === '완료') {
      actionBtn = `<button class="btn-sm btn-sm-ghost" style="padding:6px 10px" onclick="setTaskStatus('${t.id}','진행중')">되돌리기</button>`;
    } else {
      actionBtn = `<button class="btn-sm btn-sm-primary" style="padding:6px 10px" onclick="setTaskStatus('${t.id}','완료')">완료처리</button>`;
    }

    const assignee = t.assignee_name || t.assignee || '-';
    const due = t.due_date || t.due || '-';
    return `<tr>
      <td style="font-weight:600;color:var(--text);padding-left:14px">
        ${t._fromReport ? `<span style="font-size:10px;background:rgba(59,130,246,0.12);color:var(--accent);padding:1px 6px;border-radius:4px;margin-right:5px;font-weight:700">📥 보고</span>` : ''}
        ${escapeHtml(t.title)}
      </td>
      <td>${escapeHtml(assignee)}</td>
      <td style="font-family:'DM Mono',monospace;font-size:12px;${dueStyle}">${due}</td>
      <td><span class="badge ${prio.badge}">${prio.label}</span></td>
      <td><span class="badge ${displayBadge}">${displayStatus}</span></td>
      <td style="display:flex;gap:4px">
        ${actionBtn}
        <button class="btn-sm btn-sm-danger leader-only-action" style="padding:6px 8px" onclick="deleteTask(${t.id})">✕</button>
      </td>
    </tr>`;
  }).join('');

  updateTaskBadge(); // 통합 뱃지 업데이트
}

function filterTasks(filter, btn) {
  _taskFilter = filter;
  document.querySelectorAll('#ltab-tasks .tab-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  renderTaskTable();
}

async function addLeaderTask() {
  const title    = document.getElementById('new-task-title')?.value.trim();
  const assigneeUsername = document.getElementById('new-task-assignee')?.value;
  const due      = document.getElementById('new-task-due')?.value || null;
  const priority = document.getElementById('new-task-priority')?.value || 'med';
  if (!title)            { showToast('⚠️ 업무명을 입력하세요'); return; }
  if (!assigneeUsername) { showToast('⚠️ 담당자를 선택하세요'); return; }

  try {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, assignee_username: assigneeUsername,
        requester_username: currentUser?.gwId || currentUser?.username || null,
        due_date: due, priority,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 추가 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    document.getElementById('new-task-title').value = '';
    document.getElementById('new-task-due').value   = '';
    await fetchTasksFromDB();
    renderTaskTable();
    showToast(`✅ '${title}' 업무가 추가됐습니다`);
  } catch (e) {
    console.error('[addLeaderTask] 실패:', e);
    showToast('❌ 서버 연결 오류');
  }
}

async function setTaskStatus(id, status) {
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 상태 변경 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    await fetchTasksFromDB();
    renderTaskTable();
    showToast(status==='완료' ? '✅ 완료 처리됐습니다' : '↩ 진행중으로 변경됐습니다');
  } catch (e) {
    console.error('[setTaskStatus] 실패:', e);
    showToast('❌ 서버 연결 오류');
  }
}

async function deleteTask(id) {
  const t = TASK_LIST.find(x => x.id === id);
  if (!t) return;
  if (!confirm(`'${t.title}' 업무를 삭제하시겠습니까?`)) return;
  try {
    const res = await fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 삭제 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    await fetchTasksFromDB();
    renderTaskTable();
    showToast('🗑️ 업무가 삭제됐습니다');
  } catch (e) {
    console.error('[deleteTask] 실패:', e);
    showToast('❌ 서버 연결 오류');
  }
}


/* ══════════════════════════════════════
   프로젝트 휴지통 (삭제 복구)
══════════════════════════════════════ */
function loadTrash()      { try { return JSON.parse(localStorage.getItem('proj-trash')||'[]'); } catch(e){return[];} }
function saveTrash(list)  { localStorage.setItem('proj-trash', JSON.stringify(list.slice(0,20))); } // 최대 20개

// 복구
function restoreProject(projId) {
  const trash = loadTrash();
  const proj  = trash.find(p=>p.id===projId);
  if(!proj) { showToast('⚠️ 복구할 수 없습니다 (이미 복구되었거나 만료됨)'); return; }

  // 목록 복원
  const { deletedAt, ...restProj } = proj;
  PROJECTS_LIST.push(restProj);
  saveProjectsList(PROJECTS_LIST);

  // 휴지통에서 제거
  saveTrash(trash.filter(p=>p.id!==projId));

  refreshAllProjectViews();
  renderTrashPanel();
  showToast(`✅ '${proj.name}' 사업이 복구됐습니다`);
}

// 휴지통 영구 삭제
function permanentDelete(projId) {
  const trash = loadTrash();
  const proj  = trash.find(p=>p.id===projId);
  if(!proj) return;
  if(!confirm(`'${proj.name}'을 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
  saveTrash(trash.filter(p=>p.id!==projId));
  renderTrashPanel();
  showToast(`🗑️ 영구 삭제됐습니다`);
}

function renderTrashPanel() {
  const el = document.getElementById('trash-panel');
  if(!el) return;
  const trash = loadTrash();
  if(!trash.length) {
    el.innerHTML = `<div style="text-align:center;padding:32px;color:var(--text3);font-size:13px">
      <div style="font-size:32px;margin-bottom:8px">🗑️</div>휴지통이 비어있습니다
    </div>`;
    return;
  }
  el.innerHTML = trash.map(p => {
    const deleted = new Date(p.deletedAt);
    const dateStr = `${deleted.getMonth()+1}/${deleted.getDate()} ${deleted.getHours()}:${String(deleted.getMinutes()).padStart(2,'0')}`;
    return `<tr>
      <td style="font-weight:600;color:var(--text);padding-left:14px">${p.icon} ${p.name}</td>
      <td><span class="badge ${getStatusBadge(p.status)}">${p.status}</span></td>
      <td style="font-size:12px;color:var(--text2)">${dateStr} 삭제</td>
      <td style="display:flex;gap:6px">
        <button class="btn-sm btn-sm-primary" style="padding:5px 12px" onclick="restoreProject('${p.id}')">↩ 복구</button>
        <button class="btn-sm btn-sm-danger"  style="padding:5px 10px" onclick="permanentDelete('${p.id}')">✕</button>
      </td>
    </tr>`;
  }).join('');
}

/* ── 되돌리기 토스트 ── */
let _undoTimer = null;
let _undoFn    = null;   // 클로저 직접 보관

function showUndoToast(msg, undoFn) {
  const existing = document.getElementById('undo-toast');
  if(existing) existing.remove();
  clearTimeout(_undoTimer);
  _undoFn = undoFn;      // 함수 참조를 전역에 보관

  const el = document.createElement('div');
  el.id = 'undo-toast';
  el.style.cssText = `position:fixed;bottom:80px;right:24px;z-index:300;
    background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--danger);
    border-radius:12px;padding:12px 16px;font-size:13px;font-weight:500;
    display:flex;align-items:center;gap:12px;
    box-shadow:0 8px 32px rgba(0,0,0,0.25);animation:slideInRight .3s ease;
    max-width:340px;`;
  el.innerHTML = `
    <span style="flex:1">${msg}</span>
    <button id="undo-btn"
            style="background:var(--danger);color:#fff;border:none;border-radius:8px;
                   padding:5px 12px;font-size:12px;font-weight:700;cursor:pointer;
                   font-family:'Noto Sans KR',sans-serif;white-space:nowrap">
      ↩ 되돌리기
    </button>
    <div id="undo-progress" style="position:absolute;bottom:0;left:0;height:3px;
         background:var(--danger);border-radius:0 0 0 12px;width:100%;
         transition:width 8s linear"></div>`;
  document.body.appendChild(el);

  // 버튼 이벤트 직접 바인딩
  document.getElementById('undo-btn').addEventListener('click', () => {
    if(_undoFn) { _undoFn(); _undoFn = null; }
    el.remove();
    clearTimeout(_undoTimer);
  });

  // 프로그레스 바
  requestAnimationFrame(() => {
    const bar = document.getElementById('undo-progress');
    if(bar) setTimeout(()=>bar.style.width='0%', 50);
  });

  _undoTimer = setTimeout(() => { el.remove(); _undoFn = null; }, 8000);
}


/* ══════════════════════════════════════
   프로젝트 카드 드래그앤드롭
══════════════════════════════════════ */
let _dragProjId   = null;
let _dragOverId   = null;

function onProjDragStart(e, projId) {
  _dragProjId = projId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', projId);
  setTimeout(() => {
    const el = document.querySelector(`.proj-card-wrap[data-proj-id="${projId}"]`);
    if(el) el.classList.add('dragging');
  }, 0);
}

function onProjDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const wrap = e.currentTarget;
  const targetId = wrap.dataset.projId;
  if(targetId === _dragProjId) return;
  if(targetId !== _dragOverId) {
    // 이전 drag-over 해제
    document.querySelectorAll('.proj-card-wrap.drag-over')
      .forEach(el => el.classList.remove('drag-over'));
    wrap.classList.add('drag-over');
    _dragOverId = targetId;
  }
}

function onProjDragLeave(e) {
  // 자식 요소로 이동할 때 무시
  if(e.currentTarget.contains(e.relatedTarget)) return;
  e.currentTarget.classList.remove('drag-over');
  if(_dragOverId === e.currentTarget.dataset.projId) _dragOverId = null;
}

function onProjDrop(e, targetId) {
  e.preventDefault();
  document.querySelectorAll('.proj-card-wrap.drag-over').forEach(el=>el.classList.remove('drag-over'));
  if(!_dragProjId || _dragProjId === targetId) return;

  const fromIdx = PROJECTS_LIST.findIndex(p=>p.id===_dragProjId);
  const toIdx   = PROJECTS_LIST.findIndex(p=>p.id===targetId);
  if(fromIdx < 0 || toIdx < 0) return;

  // 배열에서 이동
  const [moved] = PROJECTS_LIST.splice(fromIdx, 1);
  PROJECTS_LIST.splice(toIdx, 0, moved);
  saveProjectsList(PROJECTS_LIST);

  // 전체 뷰 갱신 (카드 + 사이드바)
  refreshAllProjectViews();
}

function onProjDragEnd(e) {
  document.querySelectorAll('.proj-card-wrap.dragging, .proj-card-wrap.drag-over')
    .forEach(el => { el.classList.remove('dragging'); el.classList.remove('drag-over'); });
  _dragProjId = null;
  _dragOverId = null;
}


/* ══════════════════════════════════════
   팀장 보고 수신 — Phase 3-A부터 백엔드가 Task 테이블에 직접 insert.
   사이드바 '주요 업무보고 관리'는 fetchTasksFromDB로 자동 동기화됨.
══════════════════════════════════════ */
function updateTaskBadge() {
  const count = (TASK_LIST || []).filter(t => t.status === '진행중').length;
  document.querySelectorAll('#page-leader .nav-item').forEach(el => {
    if(el.textContent.includes('주요 업무보고 관리')) {
      let badge = el.querySelector('.nav-badge');
      if (count > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className='nav-badge'; el.appendChild(badge); }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    }
  });
}

// 더미 — 더 이상 필요 없지만 외부 호출 호환을 위해 빈 함수로 남김
function syncReportedTasks() { /* no-op (Task는 이제 DB 직접 insert) */ }


// ==========================================
// 🚀 [이것만 남기세요!] DB 연동 로그인 요청 (doLogin)
// ==========================================
async function doLogin() {
  const gw  = document.getElementById('login-gw')?.value.trim();
  const pw  = document.getElementById('login-pw')?.value;
  const err = document.getElementById('login-error');
  
  if(!gw || !pw) { 
    if(err) { err.textContent='아이디와 비밀번호를 입력하세요'; err.style.display='block'; } 
    return; 
  }

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: gw, password: pw })
    });

    if (res.ok) {
      const userData = await res.json();
      if(err) err.style.display = 'none';
      
      // ✅ 검문 통과 시, 우리가 만든 완벽한 화면 전환 함수로 바통 터치!
      loginUser(userData); 
    } else {
      if(err) { err.textContent='아이디 또는 비밀번호가 올바르지 않습니다'; err.style.display='block'; }
    }
  } catch (e) {
    if(err) { err.textContent='서버 연결에 실패했습니다.'; err.style.display='block'; }
    console.error("로그인 에러:", e);
  }
}

function quickLogin(role) {
  const defaults = {
    admin:  { name:'부서장', gwId:'admin',  dept:'경영기획부', role:'admin',  pw:'1234', pos:'부서장' },
    leader: { name:'홍길동', gwId:'leader', dept:'개발팀',   role:'leader', pw:'1234', pos:'팀장' },
    member: { name:'김민수', gwId:'member', dept:'개발팀',   role:'member', pw:'1234', pos:'' },
  };
  loginUser(defaults[role]);
}

function goToLogin() {
  document.getElementById('login-gw').value = '';
  document.getElementById('login-pw').value = '';
  const err = document.getElementById('login-error');
  if(err) err.style.display = 'none';
  showPage('page-login');
}

// ==========================================
// 🚀 2. 로그아웃: 찌꺼기 데이터 박멸 및 새로고침
// ==========================================
function goToLogout() {
  // 인증 관련 정보 일괄 삭제 (프록시 덕분에 sessionStorage에서 지워짐)
  AUTH_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
  currentUser = null;

  // 🔥 찌꺼기 없이 가장 깨끗한 로그인 화면으로 가기 위해 즉시 새로고침!
  window.location.reload();
}

// 사용자 계정 저장/로드
function loadUserAccounts() {
  try { return JSON.parse(localStorage.getItem('user-accounts') || '[]'); } catch(e) { return []; }
}
function saveUserAccount(user) {
  const users = loadUserAccounts();
  const existing = users.findIndex(u => u.gwId === user.gwId);
  if(existing >= 0) users[existing] = user;
  else users.push(user);
  localStorage.setItem('user-accounts', JSON.stringify(users));
}


/* ══════════════════════════════════════
   지연 업무 대시보드 연동
══════════════════════════════════════ */


// goToDelayedTasks → openTaskPopup('delay')로 대체


/* ══════════════════════════════════════
   업무 팝업 (완료/지연)
══════════════════════════════════════ */
function getWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=일, 1=월
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return {
    start: mon.toISOString().slice(0,10),
    end:   sun.toISOString().slice(0,10),
  };
}

function renderDelayedTasks() {
  const today = new Date().toISOString().slice(0,10);
  const delayed = TASK_LIST.filter(t => t.status !== '완료' && t.due && t.due < today);

  const countEl  = document.getElementById('dash-delay-count');
  const changeEl = document.getElementById('dash-delay-change');
  if(countEl)  countEl.innerHTML = `${delayed.length}<span class="stat-unit">건</span>`;
  if(changeEl) {
    if(!delayed.length) { changeEl.textContent='✅ 지연 없음'; changeEl.className='stat-change up'; }
    else { changeEl.textContent=`⚠ 클릭하여 확인`; changeEl.className='stat-change down'; }
  }

  // 이번주 완료 업무 카드도 업데이트
  const { start, end } = getWeekRange();
  const weekDone = TASK_LIST.filter(t => t.status === '완료' && t.due >= start && t.due <= end);
  const wCountEl = document.getElementById('dash-week-count');
  if(wCountEl) wCountEl.innerHTML = `${weekDone.length}<span class="stat-unit">건</span>`;
  const wChangeEl = document.getElementById('dash-week-change');
  if(wChangeEl) wChangeEl.textContent = weekDone.length > 0 ? `↑ 클릭하여 확인` : '이번주 완료 없음';
}


/* ══════════════════════════════════════
   KPI 카드 호버 툴팁 + 클릭 이동
══════════════════════════════════════ */
let _hoverTimer = null;

function getWeekRange() {
  const now = new Date(), day = now.getDay();
  const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { start: mon.toISOString().slice(0,10), end: sun.toISOString().slice(0,10) };
}

function showTaskHover(type, card) {
  clearTimeout(_hoverTimer);
  _hoverTimer = setTimeout(() => {
    const today = new Date().toISOString().slice(0,10);
    let tasks = [], title = '', color = '';
    if(type === 'delay') {
      tasks = TASK_LIST.filter(t => t.status !== '완료' && t.due && t.due < today);
      title = '⚠️ 지연 업무'; color = 'var(--danger)';
    } else {
      const { start, end } = getWeekRange();
      tasks = TASK_LIST.filter(t => t.status === '완료' && t.due >= start && t.due <= end);
      title = '✅ 이번주 완료'; color = 'var(--success)';
    }
    let existing = document.getElementById('task-hover-tooltip');
    if(existing) existing.remove();
    const tip = document.createElement('div');
    tip.id = 'task-hover-tooltip';
    tip.style.cssText = 'position:fixed;z-index:500;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 8px 32px rgba(0,0,0,0.2);min-width:260px;max-width:320px;font-size:12px;pointer-events:none;';
    const rect = card.getBoundingClientRect();
    tip.style.left = Math.min(rect.left, window.innerWidth - 340) + 'px';
    tip.style.top  = (rect.bottom + 8) + 'px';
    const rows = tasks.slice(0,5).map(t => {
      const diff = type==='delay' && t.due ? Math.floor((new Date()-new Date(t.due))/86400000) : null;
      return `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
        <span style="color:var(--text);font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-right:8px">${t.title}</span>
        <span style="color:${type==='delay'?'var(--danger)':'var(--text2)'};font-size:11px;flex-shrink:0;font-family:'DM Mono',monospace">${diff!==null?diff+'일 초과':t.due||'-'}</span>
      </div>`;
    }).join('');
    const more  = tasks.length > 5 ? `<div style="text-align:center;color:var(--text3);margin-top:5px;font-size:11px">+${tasks.length-5}건 더 있음</div>` : '';
    const empty = tasks.length === 0 ? `<div style="text-align:center;color:var(--text3);padding:8px 0">${type==='delay'?'지연 없음 ✅':'이번주 완료 없음'}</div>` : '';
    tip.innerHTML = `<div style="font-weight:700;color:${color};margin-bottom:8px;font-size:13px">${title} ${tasks.length}건</div>${rows}${empty}${more}
      <div style="margin-top:8px;text-align:center;color:var(--text3);font-size:11px;border-top:1px solid var(--border);padding-top:7px">클릭 → 주요 업무보고 관리로 이동</div>`;
    document.body.appendChild(tip);
  }, 200);
}

function hideTaskHover() {
  clearTimeout(_hoverTimer);
  const t = document.getElementById('task-hover-tooltip');
  if(t) t.remove();
}

function openTaskTab(type) {
  hideTaskHover();
  const navItem = [...document.querySelectorAll('#page-leader .nav-item')].find(el=>el.textContent.includes('업무보고'));
  switchLeaderTab('tasks', navItem);
  setTimeout(() => {
    const label = type==='delay' ? '지연' : '완료';
    const btn = [...document.querySelectorAll('#ltab-tasks .tab-btn')].find(b=>b.textContent.trim()===label);
    if(btn) filterTasks(type==='delay'?'지연':'완료', btn);
  }, 100);
}

function toggleSubMenu(id) {
  const toggle = document.getElementById(id + '-toggle');
  const items = document.getElementById(id + '-items');
  const isOpen = toggle.classList.contains('open');
  toggle.classList.toggle('open', !isOpen);
  items.classList.toggle('open', !isOpen);
}

// 💡 전역 변수로 현재 로그인한 유저 정보를 들고 있습니다.
let CURRENT_USER = null;
let selectedRole = 'member'; // 회원가입 시 기본 역할

function selectRole(role) {
    selectedRole = role;
    // UI 테두리 업데이트
    document.querySelectorAll('.role-btn').forEach(btn => btn.style.border = '1px solid var(--border)');
    const targetBtn = document.getElementById('role-' + role + '-btn');
    if(targetBtn) targetBtn.style.border = '2px solid var(--accent)';
}

// ── 1. 회원가입 처리 ──
async function doRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const username = document.getElementById('reg-empno').value.trim();
    const teamName = document.getElementById('reg-dept').value.trim();
    const pw1 = document.getElementById('reg-pw').value;
    const pw2 = document.getElementById('reg-pw2').value;

    if (!name || !username || !teamName || !pw1) {
        alert("모든 항목을 입력해주세요.");
        return;
    }
    if (pw1 !== pw2) {
        alert("비밀번호가 일치하지 않습니다.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: username,
                password: pw1,
                name: name,
                team_name: teamName,
                role: selectedRole
            })
        });

        if (res.ok) {
            alert("가입이 완료되었습니다! 로그인 화면으로 이동합니다.");
            goToLogin(); // 화면 전환 함수 호출
        } else {
            const errorData = await res.json();
            alert(errorData.detail || "회원가입에 실패했습니다.");
        }
    } catch (e) {
        alert("서버 통신 오류가 발생했습니다.");
    }
}

// ==========================================
// 🚀 [2단계 적용] 통합 프로필 업데이트 함수
// ==========================================
function applyUser() {
  if (!currentUser) return;

  // sysadmin 전용 컬럼 보이기/숨기기 (CSS .sysadmin-only)
  document.body.classList.toggle('is-sysadmin', currentUser.role === 'sysadmin');
  // member 전용 — leader 페이지에서 cross-page 진입 시 '내 페이지로' 버튼 노출
  document.body.classList.toggle('is-member', currentUser.role === 'member');

  const roleMap = { 'sysadmin': '관리자', 'admin': '부서장', 'leader': '팀장', 'member': '팀원' };
  const roleKor = roleMap[currentUser.role] || '팀원';

  // 1. 역할 배지 업데이트 (leader, member 모두 칠해줌)
  const roleBadges = ['leader-role-badge', 'member-role-badge', 'sidebar-role-badge'];
  roleBadges.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = roleKor;
      el.className = `brand-role ${currentUser.role}-role`;
    }
  });

  // 2. 프로필 정보 업데이트 (leader, member 둘 다 찾아서 데이터 꽂아줌)
  const prefixes = ['leader', 'member', 'admin'];
  prefixes.forEach(prefix => {
    const ava = document.getElementById(`${prefix}-ava`);
    const uname = document.getElementById(`${prefix}-uname`);
    const udept = document.getElementById(`${prefix}-udept`);
    const upos = document.getElementById(`${prefix}-upos`);

    if (ava) {
      ava.className = `user-avatar ${currentUser.role}-avatar`;
      applyAvatar(ava, currentUser.profile_image_url, currentUser.name);
    }
    if (uname) uname.textContent = currentUser.name;
    if (udept) udept.textContent = currentUser.dept || '-';
    if (upos)  upos.textContent  = currentUser.pos || '';
  });
}

// 아바타 헬퍼 — profile_image_url이 있으면 이미지로, 없으면 이니셜 텍스트로
function applyAvatar(el, profileImageUrl, displayName) {
  if (!el) return;
  if (profileImageUrl) {
    const url = profileImageUrl.startsWith('http') ? profileImageUrl : (API_BASE + profileImageUrl);
    el.style.backgroundImage   = `url("${url}")`;
    el.style.backgroundSize    = 'cover';
    el.style.backgroundPosition= 'center';
    el.style.backgroundColor   = 'transparent';
    el.textContent = '';  // 이니셜 비워서 이미지 위에 글자 안 겹치게
  } else {
    el.style.backgroundImage = '';
    el.style.backgroundColor = '';
    el.textContent = (displayName && displayName.charAt(0)) || '👤';
  }
}

// (Phase 3-A) 대시보드 팀원 현황 — role별 가시범위 + 2열 카드 + 담당업무 + 프로필 이미지
async function renderOverviewTeamList() {
  const el = document.getElementById('overview-team-list');
  if (!el) return;
  if (!currentUser) {
    el.innerHTML = '<div class="activity-empty" style="grid-column:1/-1">로그인이 필요합니다</div>';
    return;
  }
  const role  = currentUser.role || 'member';
  const team  = currentUser.dept || currentUser.team_name || '';
  const isGlobal = role === 'sysadmin' || role === 'admin';
  const url = isGlobal
    ? `${API_BASE}/users`
    : `${API_BASE}/teams/${encodeURIComponent(team)}/users`;
  try {
    const r = await fetch(url);
    if (!r.ok) {
      el.innerHTML = '<div class="activity-empty" style="grid-column:1/-1">불러오기 실패</div>';
      return;
    }
    const users = await r.json();
    if (!Array.isArray(users) || users.length === 0) {
      el.innerHTML = '<div class="activity-empty" style="grid-column:1/-1">팀원이 없습니다</div>';
      return;
    }
    // 2열 카드 — 이름 / 담당업무 + 프로필 이미지
    el.innerHTML = users.map(u => {
      const name = (u.name || u.username || '').replace(/</g, '&lt;');
      const pos  = (u.pos || '').replace(/</g, '&lt;');
      const initial = (u.name || u.username || '?').charAt(0);
      const imgUrl = u.profile_image_url ? (u.profile_image_url.startsWith('http') ? u.profile_image_url : API_BASE + u.profile_image_url) : '';
      const avaStyle = imgUrl
        ? `background-image:url('${imgUrl}');background-size:cover;background-position:center;color:transparent`
        : 'background:rgba(59,130,246,0.15);color:var(--accent)';
      return `
        <div class="team-card">
          <div class="user-avatar" style="${avaStyle}">${imgUrl ? '' : initial}</div>
          <div style="min-width:0;flex:1">
            <div class="team-card-name">${name}</div>
            <div class="team-card-pos">${pos || '<span style="color:var(--text3)">담당 업무 미입력</span>'}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('[renderOverviewTeamList]', e);
    el.innerHTML = '<div class="activity-empty" style="grid-column:1/-1">서버 연결 오류</div>';
  }
}

// (Phase 3-A) 대시보드 최근 활동 — /activities union 엔드포인트 호출
async function renderActivityFeed() {
  const el = document.getElementById('activity-feed-list');
  if (!el) return;
  if (!currentUser) {
    el.innerHTML = '<div class="activity-empty">로그인이 필요합니다</div>';
    return;
  }
  const username = currentUser.gwId || currentUser.username || '';
  try {
    const r = await fetch(`${API_BASE}/activities?viewer_username=${encodeURIComponent(username)}&limit=10`);
    if (!r.ok) {
      el.innerHTML = '<div class="activity-empty">불러오기 실패</div>';
      return;
    }
    const items = await r.json();
    if (!Array.isArray(items) || items.length === 0) {
      el.innerHTML = '<div class="activity-empty">최근 활동이 없습니다</div>';
      return;
    }
    const ICONS = {
      report_submitted: '📄', report_승인: '✅', report_반려: '⚠️',
      notice_created: '📢', board_post: '📝',
      user_registered: '👤', task_completed: '✅', todo_reported: '📤',
    };
    const COLORS = {
      report_submitted: 'rgba(16,185,129,0.15)',
      report_승인:      'rgba(16,185,129,0.15)',
      report_반려:      'rgba(245,158,11,0.15)',
      notice_created:   'rgba(59,130,246,0.15)',
      board_post:       'rgba(139,92,246,0.15)',
      user_registered:  'rgba(245,158,11,0.15)',
      task_completed:   'rgba(16,185,129,0.15)',
      todo_reported:    'rgba(59,130,246,0.15)',
    };
    el.innerHTML = items.map(it => {
      const icon = ICONS[it.kind] || '🔔';
      const bg   = COLORS[it.kind] || 'rgba(100,100,100,0.1)';
      const text = (it.text || '').replace(/</g, '&lt;');
      return `
        <div class="activity-item">
          <div class="activity-dot" style="background:${bg};flex-shrink:0;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:14px">${icon}</div>
          <div class="activity-content" style="min-width:0;flex:1">
            <div class="activity-text">${text}</div>
            <div class="activity-time">${formatRelativeTime(it.when)}</div>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('[renderActivityFeed]', e);
    el.innerHTML = '<div class="activity-empty">서버 연결 오류</div>';
  }
}

// 헬퍼: 상대시간 포맷 (예: "10분 전", "2시간 전", "어제", "5월 3일")
function formatRelativeTime(isoStr) {
  if (!isoStr) return '';
  try {
    const t = new Date(isoStr).getTime();
    if (isNaN(t)) return '';
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return '방금 전';
    if (diff < 3600) return `${Math.floor(diff/60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff/3600)}시간 전`;
    if (diff < 86400 * 2) return '어제';
    if (diff < 86400 * 7) return `${Math.floor(diff/86400)}일 전`;
    const d = new Date(isoStr);
    return `${d.getMonth()+1}월 ${d.getDate()}일`;
  } catch (e) {
    return '';
  }
}

async function uploadMyProfileImage(inputEl) {
  const file = inputEl.files && inputEl.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('⚠️ 이미지 파일만 업로드 가능합니다'); inputEl.value=''; return; }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('actor_username', _myUsername());
  try {
    const r = await fetch(`${API_BASE}/users/${encodeURIComponent(_myUsername())}/profile-image`, {
      method: 'POST', body: fd,
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 업로드 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    const data = await r.json();
    // currentUser와 localStorage에 반영 → applyUser로 모든 화면 갱신
    if (currentUser) {
      currentUser.profile_image = data.profile_image;
      currentUser.profile_image_url = data.profile_image_url;
      try { localStorage.setItem('pms_user', JSON.stringify(currentUser)); } catch {}
    }
    applyUser();
    initUserProfile();
    showToast('📷 프로필 이미지가 변경됐습니다');
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
  inputEl.value = '';
}

async function deleteMyProfileImage() {
  if (!confirm('프로필 이미지를 제거하시겠습니까?')) return;
  try {
    const r = await fetch(`${API_BASE}/users/${encodeURIComponent(_myUsername())}/profile-image?actor_username=${encodeURIComponent(_myUsername())}`, {
      method: 'DELETE',
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      showToast('❌ 제거 실패: ' + (err.detail || '서버 오류'));
      return;
    }
    if (currentUser) {
      currentUser.profile_image = '';
      currentUser.profile_image_url = '';
      try { localStorage.setItem('pms_user', JSON.stringify(currentUser)); } catch {}
    }
    applyUser();
    initUserProfile();
    showToast('🗑 프로필 이미지가 제거됐습니다');
  } catch (e) { console.error(e); showToast('❌ 서버 연결 오류'); }
}

// ==========================================
// 🚀 [3단계 적용] 자동 로그인 시 화면 이동
// ==========================================
// 인증 관련 localStorage 키들 (로그아웃 시 일괄 삭제)
const AUTH_STORAGE_KEYS = ['pms_user', 'user_name', 'user_team_name'];

function checkLogin() {
  // 인증 키는 sessionStorage 라우팅됨 — 브라우저 종료 시 자동 사라지므로
  // 별도 플래그 체크 없이 그냥 읽으면 된다. 새로고침/Ctrl+F5는 sessionStorage 유지.
  const savedUser = localStorage.getItem('pms_user');

  if (savedUser) {
    try {
      currentUser = JSON.parse(savedUser);
      applyUser(); // 정보 꽂기

      // 모든 role을 page-leader로 통합 — member는 동일 UI에서 권한 기반 필터/제한 적용
      {
        showPage('page-leader');
        // 페이지 로드 후 대시보드 탭 자동 활성화
        setTimeout(() => {
          const overviewNavItem = document.querySelector('#page-leader .nav-item.active');
          if (overviewNavItem) {
            switchLeaderTab('overview', overviewNavItem);
          }
        }, 100);
      }
      
      if (typeof fetchProjectsFromDB === 'function') fetchProjectsFromDB();
    } catch (e) {
      console.error("데이터 파싱 오류:", e);
      goToLogout();
    }
  } else {
    showPage('page-login'); 
  }
}

function loginUser(responseData) {
  // 🚀 [핵심 해결책] 백엔드에서 데이터가 { message, user: {...} } 형태로 오면
  // 안쪽에 있는 user 객체를 꺼내고, 아니면 그냥 받은 데이터를 씁니다.
  const user = responseData.user ? responseData.user : responseData;

  // 1-1. 백엔드에서 넘어온 팀명을 안전하게 찾습니다.
  const teamName = user.team_name || user.team || user.dept || '미배정';

  // 1-2. 데이터 세팅 및 저장 — 프로필 이미지/team_id도 포함해야 새로고침/재로그인 후 아바타 유지됨
  currentUser = {
    name: user.name,
    dept: teamName,
    pos:  user.pos  || '',
    role: user.role || 'member',
    gwId: user.username || user.gwId,
    username: user.username || user.gwId,
    team_id: user.team_id || null,
    job_title: user.job_title || '',
    status: user.status || '정상',
    email: user.email || '',
    profile_image: user.profile_image || '',
    profile_image_url: user.profile_image_url || '',
  };
  localStorage.setItem('pms_user', JSON.stringify(currentUser));

  // 1-3. 팀원 목록 조회에서 바로 쓸 수 있도록 따로 저장
  localStorage.setItem('user_name', currentUser.name);
  localStorage.setItem('user_team_name', currentUser.dept);

  // 2. 환영 팝업 띄우기
  if (typeof showToast === 'function') {
    showToast(`👋 ${currentUser.name}님, 환영합니다`);
  }

  // 3. 새로고침
  setTimeout(() => {
    window.location.reload();
  }, 300);
}

if(currentUser) {
  // 환영 인사
  if (typeof showToast === 'function') showToast(`👋 ${currentUser.name}님, 환영합니다`);
  
  // DB에서 사업 정보 즉시 로딩
  if (typeof fetchProjectsFromDB === 'function') fetchProjectsFromDB();
}

// ==========================================
// 🚀 3. 화면이 다 그려진 후 초기화 시작 (가장 중요!)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 웹페이지 HTML이 100% 다 그려지고 나면 이 부분이 실행됩니다.
  checkLogin();
});

// ==========================================
// 🚀 화면 전환 함수 (레이아웃 깨짐 및 왼쪽 쏠림 완벽 해결!)
// ==========================================
function showPage(pageId) {
  // 1. 모든 화면을 찾아 '활성화(active)' 상태를 끕니다.
  document.querySelectorAll('.page').forEach(page => {
    page.classList.remove('active');
    
    // 🔥 [핵심] 강제로 주입되었던 찌꺼기 스타일을 지워서 원래의 예쁜 CSS(가운데 정렬)로 되돌립니다.
    page.style.display = ''; 
  });
  
  // 2. 우리가 이동하려는 화면에만 '활성화(active)' 클래스를 붙여줍니다.
  const targetPage = document.getElementById(pageId);
  if (targetPage) {
    targetPage.classList.add('active');
  } else {
    console.error("🚨 화면을 찾을 수 없습니다:", pageId);
  }
}

function goRegister() { refreshTeamDropdowns(); showPage('page-register'); }
function goToLoginPage() { goToLogin(); }

// ── LEADER TABS ──
function switchLeaderTab(tab, navEl) {
  document.querySelectorAll('.ltab').forEach(t => {
    t.classList.remove('active');
    t.style.display = '';
  });
  const el = document.getElementById('ltab-'+tab);
  if (el) el.classList.add('active');
  document.querySelectorAll('#page-leader .nav-sub-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('#page-leader .nav-proj-item').forEach(i => i.classList.remove('active'));
  if (navEl) {
    document.querySelectorAll('#page-leader .nav-item').forEach(n => n.classList.remove('active'));
    navEl.classList.add('active');
  }
  if (tab === 'members')         { fetchMembersFromDB(); renderMembersTable(); refreshTeamDropdowns(); }
  if (tab === 'tasks')           renderTasksTab();
  if (tab === 'settings')        { initUserProfile(); fetchTeamsFromDB(); refreshTeamDropdowns(); }
  if (tab === 'projects')        renderProjectsTab();
  if (tab === 'overview')        { renderDashboardProjects(); renderDelayedTasks(); renderOverviewStats(); renderOverviewTeamList(); renderActivityFeed(); renderWeeklyChart(); }
  if (tab === 'budget-mgmt')     {
    // 최신 budget_data를 PROJECTS_LIST에 반영 후 readonly 합산 표시
    fetchProjectsFromDB().then(() => renderBudgetMgmt()).catch(() => renderBudgetMgmt());
  }
  if (tab === 'personnel-mgmt')  renderPersonnelMgmt();
  if (tab === 'reports')         renderReportsLeader();
  if (tab === 'notices')         renderNoticesLeader();
  if (tab === 'board')           renderBoard('');
  if (tab === 'feedback')        renderFeedback('');
}

// member가 leader 페이지에 있는 공유 탭(팀원/프로젝트/사업비/참여인력)으로 cross-page 전환
function switchToSharedTab(tab) {
  showPage('page-leader');
  // 해당 leader 탭의 nav-item을 찾아 active 처리
  const navEl = document.querySelector(`#page-leader .nav-item[onclick*="switchLeaderTab('${tab}'"]`);
  switchLeaderTab(tab, navEl);
}

// member가 본인 페이지로 복귀
function returnToMemberPage() {
  showPage('page-member');
}

// ── MEMBER TABS ──
function switchMemberTab(tab, navEl) {
  document.querySelectorAll('.mtab').forEach(t => {
    t.classList.remove('active');
    t.style.display = '';
  });
  const mel = document.getElementById('mtab-'+tab);
  if (mel) mel.classList.add('active');
  // Clear sub-item / proj-item active states
  document.querySelectorAll('#page-member .nav-sub-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('#page-member .nav-proj-item').forEach(i => i.classList.remove('active'));
  if (navEl) {
    document.querySelectorAll('#page-member .nav-item').forEach(n => n.classList.remove('active'));
    navEl.classList.add('active');
  }
  // 팀원 관리 — 본인 팀원만, readonly 뷰
  if (tab === 'members')         renderMemberMembers();
  if (tab === 'projects')        renderMemberProjects();
  if (tab === 'budget-mgmt')     renderMemberBudget();
  if (tab === 'personnel-mgmt')  renderMemberPersonnel();
  if (tab === 'reports')         renderReportsMember();
  if (tab === 'notices')         renderNoticesMember();
  if (tab === 'board')           renderBoard('m');
  if (tab === 'feedback')        renderFeedback('m');
}

// ── MEMBER 페이지 readonly 렌더 함수 ──
function renderMemberMembers() {
  fetchMembersFromDB({ tbodyId: 'm-members-tbody', readonly: true });
}

// 로그인 사용자에게 권한 부여된 사업 ID 목록을 DB에서 조회
async function _fetchMyGrantedProjectIds() {
  if (!currentUser) return [];
  const myUsername = currentUser.gwId || currentUser.username;
  if (!myUsername) return [];
  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(myUsername)}/projects`);
    return res.ok ? await res.json() : [];
  } catch { return []; }
}

async function renderMemberProjects() {
  const grid = document.getElementById('m-projects-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="padding:20px;color:var(--text3)">불러오는 중...</div>';

  const grantedIds = new Set((await _fetchMyGrantedProjectIds()).map(String));
  const myProjects = (PROJECTS_LIST || []).filter(p => grantedIds.has(String(p.id)));

  if (myProjects.length === 0) {
    grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">권한이 부여된 사업이 없습니다. 팀장에게 문의하세요.</div>';
    return;
  }

  grid.innerHTML = myProjects.map(p => {
    const s = getProjStatus(p.status);
    const start = p.start_date || p.startDate || '';
    const end   = p.end_date   || p.endDate   || '';
    const totalBudget = (Number(p.gov_fund) || 0) + (Number(p.local_fund) || 0) + (Number(p.etc_fund) || 0);
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-header" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="card-title">${p.icon || '📁'} ${escapeHtml(p.name)}</span>
        <span class="badge ${s.badge}">${escapeHtml(p.status || '')}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--text2)">${escapeHtml(p.team_name || '')}</span>
      </div>
      <div style="padding:12px 16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;font-size:12px">
        <div><div style="color:var(--text2)">기간</div><div style="font-weight:600">${start || '-'} ~ ${end || '-'}</div></div>
        <div><div style="color:var(--text2)">총 예산</div><div style="font-family:'DM Mono',monospace;font-weight:600">${totalBudget.toLocaleString('ko-KR')} 원</div></div>
        <div><div style="color:var(--text2)">진행률</div><div style="font-weight:600">${Number(p.progress) || 0}%</div></div>
      </div>
    </div>`;
  }).join('');
}

async function renderMemberBudget() {
  const tbody = document.getElementById('m-budget-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">불러오는 중...</td></tr>';

  const grantedIds = new Set((await _fetchMyGrantedProjectIds()).map(String));
  const myProjects = (PROJECTS_LIST || []).filter(p => grantedIds.has(String(p.id)));

  if (myProjects.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:30px;color:var(--text3)">권한이 부여된 사업이 없습니다.</td></tr>';
    return;
  }

  const fmt = n => (Number(n) || 0).toLocaleString('ko-KR');
  tbody.innerHTML = myProjects.map(p => {
    const s = getProjStatus(p.status);
    const gov = Number(p.gov_fund)   || 0;
    const loc = Number(p.local_fund) || 0;
    const etc = Number(p.etc_fund)   || 0;
    const total = gov + loc + etc;
    return `<tr>
      <td style="font-weight:600;color:var(--text);padding-left:14px">${p.icon || '📁'} ${escapeHtml(p.name)}</td>
      <td><span class="badge ${s.badge}">${escapeHtml(p.status || '')}</span></td>
      <td style="text-align:right;font-family:'DM Mono',monospace;font-weight:600">${fmt(total)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace">${fmt(gov)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace">${fmt(loc)}</td>
      <td style="text-align:right;font-family:'DM Mono',monospace">${fmt(etc)}</td>
    </tr>`;
  }).join('');
}

async function renderMemberPersonnel() {
  const wrap = document.getElementById('m-personnel-cards');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:20px;color:var(--text3)">불러오는 중...</div>';

  const grantedIds = new Set((await _fetchMyGrantedProjectIds()).map(String));
  const myProjects = (PROJECTS_LIST || []).filter(p => grantedIds.has(String(p.id)));

  if (myProjects.length === 0) {
    wrap.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text3)">권한이 부여된 사업이 없습니다.</div>';
    return;
  }

  // 각 사업별 참여인력(assignments) 병렬 fetch
  const assignmentsByProj = {};
  await Promise.all(myProjects.map(async p => {
    try {
      const r = await fetch(`${API_BASE}/projects/${encodeURIComponent(p.id)}/assignments`);
      assignmentsByProj[p.id] = r.ok ? await r.json() : [];
    } catch { assignmentsByProj[p.id] = []; }
  }));

  wrap.innerHTML = myProjects.map(p => {
    const rows = (assignmentsByProj[p.id] || []);
    const activeRows = rows.filter(a => a.is_active);
    const rowsHtml = activeRows.length === 0
      ? `<tr><td colspan="5" style="text-align:center;padding:14px;color:var(--text3)">활성 배정 없음</td></tr>`
      : activeRows.map(a => `<tr>
          <td style="font-weight:500">${escapeHtml(a.user_name || '')}</td>
          <td>${escapeHtml(a.role || '')}</td>
          <td style="font-family:'DM Mono',monospace;font-weight:600">${Number(a.rate).toFixed(1)}%</td>
          <td style="font-size:11px;color:var(--text2)">${a.start_date || '—'}</td>
          <td style="font-size:11px;color:var(--text2)">${a.end_date || '—'}</td>
        </tr>`).join('');
    const s = getProjStatus(p.status);
    return `<div class="card" style="margin-bottom:14px">
      <div class="card-header" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="card-title">${p.icon || '📁'} ${escapeHtml(p.name)}</span>
        <span class="badge ${s.badge}">${escapeHtml(p.status || '')}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--text2)">활성 ${activeRows.length}명</span>
      </div>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th style="text-align:left;padding-left:14px">이름</th>
            <th>역할</th><th>참여율</th><th>시작일</th><th>종료일</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

// ── TASK TOGGLE ──
function toggleTask(el) {
  el.classList.toggle('done');
  const titleEl = el.parentElement.querySelector('.task-title');
  if (titleEl) titleEl.classList.toggle('done-text');
  if (el.classList.contains('done')) showToast('업무를 완료로 표시했습니다 ✅');
}

// addLeaderTask → tasks_js에 통합

// ── 업무 배정 모달 (Task DB 연동) ──
let _assignTargetUsername = null;

async function openAssignModal(name) {
  _assignTargetUsername = null;
  document.getElementById('assign-target').textContent = name;

  // 1) username 찾기 — 현재 렌더된 팀원 목록에서 이름으로 매칭
  //    (renderMembersTable가 채운 _teamUsers 또는 fetch)
  try {
    const role = (currentUser && currentUser.role) || 'member';
    const myTeam = (currentUser?.dept || localStorage.getItem('user_team_name') || '').trim();
    const url = (role === 'sysadmin' || role === 'admin')
      ? `${API_BASE}/users`
      : `${API_BASE}/teams/${encodeURIComponent(myTeam)}/users`;
    const r = await fetch(url);
    const users = r.ok ? await r.json() : [];
    const u = users.find(x => x.name === name);
    if (u) _assignTargetUsername = u.username;
  } catch (e) { console.warn('[openAssignModal] 사용자 조회 실패:', e); }

  // 2) 폼 초기화
  document.getElementById('assign-username').value = _assignTargetUsername || '';
  document.getElementById('assign-title').value = '';
  document.getElementById('assign-due').value = '';
  document.getElementById('assign-priority').value = 'med';
  document.getElementById('assign-desc').value = '';

  // 3) 사업 드롭다운 — 현재 PROJECTS_LIST 기준
  const projSel = document.getElementById('assign-project');
  if (projSel) {
    projSel.innerHTML = '<option value="">— 미지정 —</option>' +
      (PROJECTS_LIST || []).map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.icon || '📁')} ${escapeHtml(p.name)}</option>`).join('');
  }

  document.getElementById('assign-modal').classList.add('open');
}

function closeModal() { document.getElementById('assign-modal').classList.remove('open'); }

async function doAssign() {
  const title    = document.getElementById('assign-title').value.trim();
  const username = document.getElementById('assign-username').value || _assignTargetUsername;
  const due      = document.getElementById('assign-due').value || null;
  const priority = document.getElementById('assign-priority').value || 'med';
  const desc     = document.getElementById('assign-desc').value || null;
  const projId   = document.getElementById('assign-project').value || null;

  if (!title)    { showToast('⚠️ 업무명을 입력하세요'); return; }
  if (!username) { showToast('⚠️ 담당자를 찾을 수 없습니다'); return; }

  const requesterUsername = currentUser?.gwId || currentUser?.username || null;

  try {
    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        assignee_username:  username,
        requester_username: requesterUsername,
        description: desc,
        project_id:  projId,
        due_date:    due,
        priority,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(`❌ 배정 실패: ${err.detail || '서버 오류'}`);
      return;
    }
    closeModal();
    showToast(`📋 '${title}' 업무를 배정했습니다`);
    // 주요 업무보고 관리 탭이 열려있으면 즉시 갱신
    if (document.getElementById('ltab-tasks')?.classList.contains('active')) {
      if (typeof renderTaskTable === 'function') renderTaskTable();
    }
  } catch (e) {
    console.error('[doAssign] 실패:', e);
    showToast('❌ 서버 연결 오류');
  }
}

// 설정 탭을 열 때 실행할 프로필 초기화 함수
function initUserProfile() {
  // 1. 로컬 스토리지에서 기본 정보 가져오기
  const name = localStorage.getItem('user_name');
  
  // 🚀 [추가] 직책 정보를 가져오기 위해 pms_user 객체를 꺼냅니다.
  let user = {};
  try {
    user = JSON.parse(localStorage.getItem('pms_user') || '{}');
  } catch (e) {
    console.warn("유저 정보 파싱 에러", e);
  }

  // 2. 이름 및 아바타 세팅 — 프로필 이미지가 있으면 그걸로 표시, 없으면 이니셜
  if (name) {
    const nameEl = document.getElementById('settings-name');
    if (nameEl) nameEl.value = name;

    const avaEl = document.getElementById('settings-ava');
    if (avaEl) applyAvatar(avaEl, currentUser && currentUser.profile_image_url, name);
  }

  // 🚀 3. [추가] 직책 세팅 (담당 업무는 제외)
  const jobTitleEl = document.getElementById('settings-job-title');
  if (jobTitleEl) {
    jobTitleEl.value = user.job_title || ''; // DB/로컬에 값이 없으면 빈칸으로 둠
  }

  // 4. 팀 드롭다운 세팅 (이 함수가 실행되면서 내 소속 팀이 자동으로 선택됩니다!)
  if (typeof loadTeamDropdownForSettings === 'function') {
    loadTeamDropdownForSettings();
  }
}

// ── TOAST ──
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.style.display = 'flex';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.style.display='none', 3000);
}

// ── MODAL CLOSE ON BACKDROP ──
document.getElementById('assign-modal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ── 3. 프론트엔드에서 백엔드 DB로 새 프로젝트 저장하기 (POST) ──
async function addNewProjectToDB(projectId, projectName, projectIcon) {
  
  // 🚀 [추가] 1. 브라우저에 저장된 로그인 유저의 팀 이름을 꺼내옵니다.
  const myTeamName = localStorage.getItem('user_team_name');
  
  // 방어 코드: 팀 정보가 없으면 생성을 중단합니다.
  if (!myTeamName || myTeamName === "미배정") {
    showToast("❌ 팀 정보가 없어 프로젝트를 생성할 수 없습니다.");
    return false;
  }

  // 백엔드로 보낼 데이터 꾸러미를 만듭니다.
  const newProjectData = {
    id: projectId,
    name: projectName,
    icon: projectIcon,
    team_name: myTeamName // 👈 🚀 [추가] 2. 파이썬이 찾을 수 있게 내 팀 이름을 쏙 넣어줍니다!
  };

  try {
    const response = await fetch(`${API_BASE}/projects`, {
      method: 'POST', // 서버에 데이터를 '저장'해달라는 신호
      headers: {
        'Content-Type': 'application/json', // 우리가 보내는 데이터가 JSON 형식임을 알려줌
      },
      body: JSON.stringify(newProjectData) // 꾸러미를 문자열로 포장해서 전송
    });

    if (response.ok) {
      const result = await response.json();
      console.log("🔥 서버 저장 성공:", result);
      
      // 🚀 [수정] 성공 알림창에도 어느 팀에 생성되었는지 보여주면 훨씬 친절합니다.
      showToast(`'${projectName}'이(가) ${myTeamName}에 안전하게 저장되었습니다! 💾`);
      
      // 저장이 끝난 후, 화면을 최신 상태로 갱신하기 위해 목록을 다시 불러옵니다.
      fetchProjectsFromDB(); 
      return true; // 🚀 UI 제어를 위해 성공 신호를 반환합니다.
    } else {
      // 🚀 [수정] 실패 시 백엔드가 보내주는 구체적인 에러 메시지를 띄워줍니다.
      const errData = await response.json();
      showToast(`저장 실패 ❌: ${errData.detail || '데이터 형식을 확인하세요.'}`);
      return false;
    }
  } catch (error) {
    console.error("서버 통신 에러:", error);
    showToast('서버 연결 실패 ❌');
    return false;
  }
}

async function fetchMembersFromDB(opts) {
  opts = opts || {};
  try {
    const role = (currentUser && currentUser.role) || 'member';

    // sysadmin / admin(부서장) → 전체 사용자 조회 (단, opts.readonly 모드면 본인 팀만)
    if (!opts.readonly && (role === 'sysadmin' || role === 'admin')) {
      const res = await fetch(`${API_BASE}/users`);
      if (res.ok) {
        const users = await res.json();
        renderMembersTable(users, opts);
      }
      return;
    }

    // leader / member / readonly 뷰 → 본인 팀원만
    let myTeamName = localStorage.getItem('user_team_name');
    if (!myTeamName) {
      const settingsDeptEl = document.getElementById('settings-dept');
      myTeamName = settingsDeptEl ? settingsDeptEl.value.trim() : "";
    }
    if (!myTeamName || myTeamName === "미배정") {
      if (!opts.readonly) showToast("❌ 소속 팀 정보가 없습니다. 관리자에게 문의하세요.");
      renderMembersTable([], opts);
      return;
    }

    const res = await fetch(`${API_BASE}/teams/${encodeURIComponent(myTeamName)}/users`);
    if (res.ok) {
      const users = await res.json();
      // readonly 뷰에서 정확한 권한 카운트/팝업을 위해 사용자별 granted 사업 ID 병행 fetch
      if (opts.readonly && users.length > 0) {
        await Promise.all(users.map(async u => {
          try {
            const r = await fetch(`${API_BASE}/users/${encodeURIComponent(u.username)}/projects`);
            u.granted_project_ids = r.ok ? await r.json() : [];
          } catch { u.granted_project_ids = []; }
        }));
      }
      renderMembersTable(users, opts);
    }
  } catch (err) {
    console.error("팀원 목록 로드 에러:", err);
  }
}

// ==========================================
// 🚀 1. 설정창 드롭다운에 DB 팀 목록 채우기
// (페이지가 처음 켜질 때 호출해 주시면 됩니다!)
// ==========================================
async function loadTeamDropdownForSettings() {
  const selectEl = document.getElementById('settings-dept');
  if (!selectEl) return;

  try {
    const res = await fetch(`${API_BASE}/teams`);
    if (res.ok) {
      const teams = await res.json();
      
      // 로컬 스토리지에 저장된 현재 내 팀 이름
      const currentTeam = (localStorage.getItem('user_team_name') || '').trim();

      // DB의 팀 목록을 바탕으로 <option> 태그들을 만들어 넣습니다.
      selectEl.innerHTML = '<option value="">팀을 선택해주세요</option>' + 
        teams.map(t => {
          // 내 팀과 이름이 같으면 'selected' 속성을 주어 미리 선택되게 합니다.
          const isSelected = (t.name === currentTeam) ? 'selected' : '';
          return `<option value="${t.name}" ${isSelected}>${t.name}</option>`;
        }).join('');
    }
  } catch (err) {
    console.error('설정창 팀 목록 로드 에러:', err);
  }
}

// ==========================================
// 🚀 설정칸: 내 소속 팀(드롭다운) 변경 시 즉시 동기화
// ==========================================
async function changeMyTeam(newTeamName) {
  if (!newTeamName) return;

  // 💡 아까 로그인 아이디 찾으셨던 키값('username')을 그대로 사용하세요!
  let user = JSON.parse(localStorage.getItem('pms_user') || '{}');
  const myUsername = user.gwId; 
  
  // 💡 [참고] 만약 시스템상 gwId가 저장된 방식이 다르다면 아래 주석을 참고해 수정하세요!
  // - pms_user 객체 안에 있다면: 
  //   myUsername = JSON.parse(localStorage.getItem('pms_user') || '{}').gwId;
  // - 자바스크립트 전역 변수라면: 
  //   myUsername = gwId;

  if (!myUsername) {
    showToast('⚠️ 유저 정보를 찾을 수 없습니다. (gwId 확인 필요)');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(myUsername)}/team`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_name: newTeamName })
    });

    if (res.ok) {
      // 백엔드에서 변경된 team_id까지 무사히 받아옵니다.
      const data = await res.json();
      showToast(`소속 팀이 '${newTeamName}'(으)로 변경되었습니다.`);
      
      // 2. 로컬 스토리지에 새 팀 이름과 ID 덮어씌우기
      localStorage.setItem('user_team_name', newTeamName);
      try {
        let userStr = localStorage.getItem('pms_user');
        if (userStr) {
          let user = JSON.parse(userStr);
          user.dept = newTeamName;
          if (user.team_name !== undefined) user.team_name = newTeamName;
          if (user.team_id !== undefined) user.team_id = data.team_id; // team_id 갱신
          localStorage.setItem('pms_user', JSON.stringify(user));
        }
      } catch (e) {
        console.warn("로컬 스토리지 갱신 중 에러 무시:", e);
      }

      // 3. 새로고침 없이 사이드바 즉시 업데이트! (권한별 ID 완벽 적용)
      const leaderDeptEl = document.getElementById('leader-udept');
      if (leaderDeptEl) leaderDeptEl.textContent = newTeamName; 

      const memberDeptEl = document.getElementById('member-udpet');
      if (memberDeptEl) memberDeptEl.textContent = newTeamName; 

      // 4. 팀원 목록이나 프로젝트 목록 표가 켜져있다면 다시 불러오기
      if (typeof fetchProjectsFromDB === 'function') fetchProjectsFromDB();
      if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();

    } else {
      const errData = await res.json();
      showToast(`❌ 팀 변경 실패: ${errData.detail || '오류'}`);
    }
  } catch (err) {
    console.error("팀 변경 에러:", err);
    showToast("❌ 서버와 연결할 수 없습니다.");
  }
}

// ==========================================
// 🚀 설정칸 직책(드롭다운) 변경 시 DB 즉시 저장
// ==========================================
async function changeMyJobTitle(newJobTitle) {
  if (!newJobTitle) return;

  // 💡 아까 로그인 아이디 찾으셨던 키값('username')을 그대로 사용하세요!
  let user = JSON.parse(localStorage.getItem('pms_user') || '{}');
  const myUsername = user.gwId; 
  
  if (!myUsername) {
    showToast('⚠️ 유저 정보를 찾을 수 없습니다.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/users/${encodeURIComponent(myUsername)}/job-title`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_title: newJobTitle })
    });

    if (res.ok) {
      showToast(`직책이 '${newJobTitle}'(으)로 변경되었습니다.`);
      
      // 로컬 스토리지의 pms_user 정보도 최신화
      let user = JSON.parse(localStorage.getItem('pms_user') || '{}');
      user.job_title = newJobTitle; 
      localStorage.setItem('pms_user', JSON.stringify(user));

      // 팀원 목록 탭에 즉시 반영하기 위해 새로고침
      if (typeof fetchMembersFromDB === 'function') fetchMembersFromDB();

    } else {
      showToast("❌ 직책 저장 실패: 서버 오류");
    }
  } catch (err) {
    console.error("직책 업데이트 에러:", err);
    showToast("❌ 서버와 연결할 수 없습니다.");
  }
}