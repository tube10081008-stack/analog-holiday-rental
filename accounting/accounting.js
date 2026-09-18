/**
 * 한세진의 회계 노트 — 프런트엔드
 *
 * 독일어 노트에서 검증된 '단계 진행형' 흐름을 그대로 씁니다.
 *   도입(왜 생긴 장치인가) → 준비운동(되짚기) → 핵심(판서로 보기)
 *   → 거래 해부(세진이 하나를 끝까지) → 확인문제 하나씩 → 요약표
 * 각 단계에서 다음으로 넘어가야만 그 다음이 보입니다.
 *
 * 독일어와 다른 점 두 가지:
 *   ① 발음 듣기가 없습니다. 한국어로 배우는 과목이라 읽어줄 게 없습니다.
 *   ② 도감이 '계정과목 도감'입니다. 계정과목은 낱말이자 자리(자산·부채·자본·수익·비용)라서,
 *      종류별로 모으는 것보다 **재무제표 어디에 앉는지**로 모아 보는 게 실제로 더 쓸모 있습니다.
 */

const $ = (s) => document.querySelector(s);
const KEY_STORE = 'ah-acct-key';
let adminKey = sessionStorage.getItem(KEY_STORE) || '';
let L = null;               // 현재 레슨
let step = 0;
let cards = [], cardIdx = 0, flipped = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * 최소 마크다운 (## 소제목, **강조**, 판서 블록)
 *
 * 판서는 자리 맞춤이 곧 내용이라 — 회계는 특히 그렇습니다, 숫자 자릿수가 어긋나면
 * 표가 아니라 글자 더미가 됩니다 — 다른 치환이 안쪽 공백을 건드리지 않도록
 * 먼저 들어내고 자리표시자로 바꿔둔 뒤 마지막에 되돌립니다.
 */
function md(t) {
  const boards = [];
  let s = esc(t).replace(/```(?:판서|board)?\r?\n([\s\S]*?)```/g, (_, b) => {
    boards.push(b.replace(/\s+$/, ''));
    return ` B${boards.length - 1} `;
  });
  s = s.replace(/^#{2,4}\s*(.+)$/gm, '<h4>$1</h4>')
       .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return s.replace(/ B(\d+) /g, (_, i) => board(boards[i]));
}

/** 판서 한 덩이 — 이미 escape된 문자열을 받습니다 */
const board = (text) =>
  `<div class="board-wrap"><pre class="board">${String(text).replace(/\s+$/, '')}</pre></div>`;

/**
 * 판서는 줄바꿈하면 정렬이 깨지므로 좁은 화면에서 가로로 넘칩니다.
 * 넘치는 판서에만 '옆으로 밀어보세요' 표시를 달아줍니다 — 오른쪽 주석이 잘려서
 * 안 보이는 걸 모르고 지나치는 게 가장 나쁩니다.
 */
function markScrollableBoards() {
  document.querySelectorAll('.board-wrap').forEach((el) => {
    const over = el.scrollWidth > el.clientWidth + 2;
    el.classList.toggle('scrollable', over);
    if (over && !el.dataset.hinted) {
      el.dataset.hinted = '1';
      el.addEventListener('scroll', () => {
        el.classList.toggle('at-end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
      }, { passive: true });
    }
  });
}

async function api(qs, options = {}) {
  const sep = qs.includes('?') ? '&' : '?';
  const res = await fetch(`/api/school${qs}${sep}course=accounting`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({ ok: false, message: '응답을 읽지 못했습니다.' }));
  if (res.status === 401) { sessionStorage.removeItem(KEY_STORE); location.reload(); throw new Error('인증 만료'); }
  if (!data.ok) throw new Error(data.message || '요청이 실패했습니다.');
  return data;
}
const post = (body) => api('', { method: 'POST', body: JSON.stringify({ ...body, course: 'accounting' }) });

/* ── 로그인 ── */
$('#enterBtn').addEventListener('click', enter);
$('#keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });

async function enter() {
  const v = $('#keyInput').value.trim();
  if (!v) return;
  adminKey = v;
  $('#gateError').hidden = true;
  $('#enterBtn').disabled = true; $('#enterBtn').textContent = '펼치는 중…';
  try {
    await api('?action=gaps');
    sessionStorage.setItem(KEY_STORE, v);
    $('#gate').hidden = true; $('#app').hidden = false;
    loadTab('today');
  } catch (err) {
    $('#gateError').textContent = err.message; $('#gateError').hidden = false;
  } finally {
    $('#enterBtn').disabled = false; $('#enterBtn').textContent = '노트 펼치기';
  }
}

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    loadTab(b.dataset.tab);
  }));

async function loadTab(tab) {
  $('#view').innerHTML = `<div class="loading">불러오는 중…</div>`;
  try {
    if (tab === 'today') await renderToday();
    else if (tab === 'map') await renderMap();
    else if (tab === 'review') await renderReview();
    else if (tab === 'collection') await renderCollection();
    else if (tab === 'notebook') await renderNotebook();
    else if (tab === 'together') await renderTogether();
    else await renderGaps();
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p class="prose">${esc(err.message)}</p>
      <button class="btn-ghost" onclick="location.reload()">다시 시도</button></div>`;
  }
}

function renderStats(s, xp) {
  $('#statStrip').innerHTML = `
    <div class="stat"><b>${s?.done ?? 0}<span style="font-size:11px;color:var(--faint)">/${s?.total ?? 69}</span></b><span>수료</span></div>
    <div class="stat"><b>${s?.cards ?? 0}</b><span>카드</span></div>
    <div class="stat"><b>${s?.activeDays7 ?? 0}/7</b><span>출석</span></div>`;
  const badge = $('#dueBadge');
  if (s?.due > 0) { badge.textContent = s.due; badge.hidden = false; } else badge.hidden = true;
  if (xp) renderXp(xp);
}

/** '내 노트' 탭에 아직 안 쓴 과제 수를 뱃지로 */
function renderNbBadge(n) {
  const b = $('#nbBadge');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.hidden = false; } else b.hidden = true;
}

function renderXp(xp) {
  $('#xpBar').hidden = false;
  $('#xpLevel').textContent = xp.level;
  $('#xpFill').style.width = `${xp.progress}%`;
  $('#xpText').textContent = `${xp.intoLevel} / ${xp.needForNext}`;
}

function xpToast(amount, label) {
  if (!amount) return;
  document.querySelector('.xp-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'xp-toast';
  el.innerHTML = `<b>+${amount} XP</b><span>${esc(label)}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 1800);
  setTimeout(() => el.remove(), 2300);
}

const sejinHead = (sub) => `
  <div class="lena">
    <div class="lena-face">📊</div>
    <div><div class="lena-name">한세진</div><div class="lena-role">${esc(sub)}</div></div>
  </div>`;

function stepDots(total, cur) {
  return `<div class="steps">${Array.from({ length: total }, (_, i) =>
    `<div class="step-dot ${i < cur ? 'done' : i === cur ? 'on' : ''}"></div>`).join('')}</div>`;
}

/* ═══ 오늘 수업 ═══ */
let pendingTasks = [];

async function renderToday() {
  const d = await api('?action=today');
  L = d.lesson; step = L.step || 0;
  pendingTasks = d.notebookPending || [];
  ME = d.me || ME;
  partnerCount = d.partnerCount || 0;
  renderNbBadge(pendingTasks.length);
  renderWho();
  renderTgBadge(d.unseenNotes || 0);
  renderStats(d.stats, d.xp);
  $('#chapterLabel').textContent = L.subTitle || L.title;
  drawStep();
}

/** 📓 지난 장에서 낸 쓰기 과제 회수 — 진도를 막지 않고 물어만 봅니다 */
function pendingBanner() {
  if (!pendingTasks.length || step !== 0) return '';
  const t = pendingTasks[0];
  return `
    <div class="nb-recall" data-task="${esc(t.id)}">
      <div class="nb-recall-head">
        <span class="nb-icon">${esc(t.icon || '📓')}</span>
        <span>노트 ${esc(t.sec)} · ${esc(t.label || '')}
          ${t.daysAgo > 0 ? `<i>${t.daysAgo}일 전에 낸 과제예요</i>` : ''}</span>
      </div>
      <p class="nb-spec">${esc(t.spec)}</p>
      ${t.target > 1 ? `<div class="nb-prog">${
        Array.from({ length: t.target }, (_, i) =>
          `<i class="${i < t.done ? 'on' : ''}"></i>`).join('')} <span>${t.done}/${t.target}</span></div>` : ''}
      <div class="nb-acts">
        <button class="btn-nb-done" data-act="done">✍️ ${t.target > 1 ? '한 번 더 썼어요' : '썼어요'}</button>
        <button class="btn-nb-skip" data-act="skip">이건 접을게요</button>
      </div>
    </div>`;
}

function wirePending() {
  const box = document.querySelector('.nb-recall');
  if (!box) return;
  box.addEventListener('click', async (e) => {
    const act = e.target.dataset?.act;
    if (!act) return;
    const taskId = box.dataset.task;
    box.querySelectorAll('button').forEach(b => (b.disabled = true));
    try {
      if (act === 'skip') {
        await post({ action: 'notebook-skip', taskId });
        pendingTasks = pendingTasks.slice(1);
      } else {
        const r = await post({ action: 'notebook-done', taskId });
        if (r.xpGained) xpToast(r.xpGained, '노트 과제 완료');
        if (r.xp) renderXp(r.xp);
        if (r.closed) pendingTasks = pendingTasks.slice(1);
        else pendingTasks[0] = { ...pendingTasks[0], done: r.done };
      }
      renderNbBadge(pendingTasks.length);
      drawStep();
    } catch (err) {
      box.querySelectorAll('button').forEach(b => (b.disabled = false));
      console.error(err);
    }
  });
}

/**
 * 📖 용어 각주 — 계정과목을 모르면 문제 자체를 못 읽습니다.
 * 독일어의 낱말 각주와 같은 장치인데, 발음 대신 '어느 자리에 앉는지'가 붙습니다.
 */
function glossStrip(gloss) {
  if (!Array.isArray(gloss) || !gloss.length) return '';
  return `<div class="gloss">
    <span class="gloss-lab">용어</span>
    ${gloss.slice(0, 10).map(g => `
      <span class="gloss-chip">
        <b>${esc(g.w)}</b><span>${esc(g.ko)}</span>
      </span>`).join('')}
  </div>`;
}

/**
 * 단계 구성을 레슨 내용에서 만듭니다.
 * 없는 단계는 건너뛰므로, 생성이 일부 빠진 레슨도 그대로 열립니다.
 */
function buildSteps() {
  const s = [{ kind: 'intro' }];
  if (L?.warmup?.length) s.push({ kind: 'warmup' });
  s.push({ kind: 'concept' });
  if (L?.walkthrough?.steps?.length) s.push({ kind: 'walkthrough' });
  for (let i = 0; i < (L?.problemCount || 0); i++) s.push({ kind: 'problem', idx: i });
  s.push({ kind: 'summary' });
  return s;
}
const totalSteps = () => buildSteps().length;
const conceptStep = () => Math.max(0, buildSteps().findIndex(s => s.kind === 'concept'));

const LEVEL_BADGE = {
  easy:    { label: '몸풀기', hint: '방금 함께 본 것과 거의 같은 형태예요' },
  trap:    { label: '함정 있음', hint: '초보가 잘 걸리는 지점을 하나 심어뒀어요' },
  connect: { label: '연결하기', hint: '앞서 배운 것과 이어지는 문제예요' },
};

/** 단계를 그린 뒤 넘치는 판서에 스크롤 표시를 답니다 */
function drawStep() {
  renderStep();
  markScrollableBoards();
  wirePending();
}

function renderStep() {
  const steps = buildSteps();
  const cur = steps[Math.min(step, steps.length - 1)] || steps[0];
  const dots = stepDots(steps.length, step);
  const nextLabel = (i) => {
    const nx = steps[i + 1];
    if (!nx) return '다음 →';
    return { warmup: '준비운동부터 할까요 →', concept: '그래서 어떻게 하는 건가요 →',
      walkthrough: '거래 하나 해부해봐요 →', problem: '이해했어요, 문제 주세요 →',
      summary: '정리하러 가기 →' }[nx.kind] || '다음 →';
  };

  // 도입
  if (cur.kind === 'intro') {
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">${esc(L.unit)} · ${esc(L.subTitle || '')}</p>
        <h2>${esc(L.title)}</h2>
        ${pendingBanner()}
        ${sejinHead('오늘은 이 이야기부터 시작해볼게요')}
        <div class="prose">${md(L.intro)}</div>
        ${stuckBtn('intro')}
        <button class="btn-primary" style="margin-top:20px" id="next">${nextLabel(step)}</button>
      </div>`;
    wireStuck('intro');
    $('#next').addEventListener('click', () => goStep(step + 1));
    return;
  }

  // 준비운동
  if (cur.kind === 'warmup') {
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">준비운동 · 먼저 되짚을 것</p>
        ${sejinHead('오늘 쓰려면 이게 먼저 서 있어야 해요')}
        ${L.warmup.map((w, i) => `
          <div class="warm-item">
            <div class="warm-head"><span class="warm-no">${i + 1}</span>${esc(w.concept)}</div>
            <div class="prose">${md(w.refresher)}</div>
            ${w.why ? `<p class="warm-why">↳ ${esc(w.why)}</p>` : ''}
          </div>`).join('')}
        ${stuckBtn('warmup')}
        <button class="btn-primary" style="margin-top:20px" id="next">${nextLabel(step)}</button>
        <button class="btn-ghost" id="back">도입 다시 읽기</button>
      </div>`;
    wireStuck('warmup');
    $('#next').addEventListener('click', () => goStep(step + 1));
    $('#back').addEventListener('click', () => goStep(step - 1));
    return;
  }

  // 핵심
  if (cur.kind === 'concept') {
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">핵심 · 표로 보기</p>
        ${sejinHead('말로 풀면 안 보여요. 표로 놓고 볼게요')}
        <div class="prose">${md(L.concept)}</div>
        ${stuckBtn('concept')}
        <button class="btn-primary" style="margin-top:20px" id="next">${nextLabel(step)}</button>
        <button class="btn-ghost" id="back">앞으로 돌아가기</button>
      </div>`;
    wireStuck('concept');
    $('#next').addEventListener('click', () => goStep(step + 1));
    $('#back').addEventListener('click', () => goStep(Math.max(0, step - 1)));
    return;
  }

  // 거래 해부
  if (cur.kind === 'walkthrough') {
    const w = L.walkthrough;
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">거래 해부 · 제가 먼저 해볼게요</p>
        ${sejinHead('규칙만으론 안 붙어요. 거래 하나를 끝까지 가봐요')}
        <div class="q-box">${md(w.problem || '')}</div>
        ${glossStrip(w.gloss)}
        <ol class="wt-steps">
          ${(w.steps || []).map(s => `
            <li>
              <div class="wt-what">${md(s.what || '')}</div>
              ${s.board ? board(esc(s.board)) : ''}
              ${s.why ? `<div class="wt-why"><span>왜?</span>${md(s.why)}</div>` : ''}
            </li>`).join('')}
        </ol>
        ${w.recap ? `<div class="wt-recap"><span class="lab">결국 하는 일</span><div class="prose">${md(w.recap)}</div></div>` : ''}
        ${stuckBtn('walkthrough')}
        <button class="btn-primary" style="margin-top:20px" id="next">${nextLabel(step)}</button>
        <button class="btn-ghost" id="back">핵심 다시 보기</button>
      </div>`;
    wireStuck('walkthrough');
    $('#next').addEventListener('click', () => goStep(step + 1));
    $('#back').addEventListener('click', () => goStep(conceptStep()));
    return;
  }

  // 확인 문제
  if (cur.kind === 'problem') {
    const pIdx = cur.idx;
    const p = L.problems[pIdx];
    const lv = LEVEL_BADGE[p.level] || LEVEL_BADGE.trap;
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">확인 문제 ${pIdx + 1} / ${L.problemCount}
          <span class="lv-tag lv-${esc(p.level || 'trap')}">${lv.label}</span></p>
        ${sejinHead(lv.hint)}
        <div class="q-box">${md(p.question)}</div>
        ${glossStrip(p.gloss)}
        <textarea id="ans" rows="5" placeholder="분개는 '차변 계정 금액 / 대변 계정 금액'처럼 쓰면 돼요.&#10;왜 그렇게 정했는지도 함께 써주면 어디서 갈렸는지 더 정확히 볼 수 있어요"></textarea>
        <div class="uml-row">
          ${['차변', '대변', '/'].map(c =>
            `<button class="uml" data-ch="${esc(c)}">${esc(c)}</button>`).join('')}
          <button class="uml" id="commaBtn" title="숫자에 세 자리 쉼표를 찍습니다">,000 정리</button>
          <span class="uml-hint">분개 입력 도우미</span>
        </div>
        <button class="btn-primary" style="margin-top:14px" id="submit">답 제출하기</button>
        ${p.hint ? `<button class="btn-ghost" id="hintBtn">💡 막혔어요, 힌트 주세요</button>
          <div class="hint-box" id="hintBox" hidden>${md(p.hint)}</div>` : ''}
        <p class="hint" id="hint"></p>
      </div>`;
    $('#submit').addEventListener('click', () => submitAnswer(pIdx));
    // 분개 입력 도우미 — 커서 위치에 삽입합니다
    document.querySelectorAll('.uml[data-ch]').forEach(b => b.addEventListener('click', () => {
      const t = $('#ans'); const s = t.selectionStart ?? t.value.length;
      const ins = b.dataset.ch === '/' ? ' / ' : `${b.dataset.ch} `;
      t.value = t.value.slice(0, s) + ins + t.value.slice(t.selectionEnd ?? s);
      t.focus(); t.selectionStart = t.selectionEnd = s + ins.length;
    }));
    // 쉼표 정리 — 회계에서 자릿수가 어긋나면 본인도 못 읽습니다
    $('#commaBtn').addEventListener('click', () => {
      const t = $('#ans');
      t.value = t.value.replace(/\d{4,}/g, (n) => Number(n).toLocaleString('ko-KR'));
      t.focus();
    });
    if (p.hint) $('#hintBtn').addEventListener('click', () => {
      $('#hintBox').hidden = false; $('#hintBtn').remove();
    });
    return;
  }

  // 요약
  const rows = (L.summary || []).map(s => `
    <tr><td>${esc(s.term)}</td><td>${esc(s.meaning)}</td><td>${esc(s.caution || '')}</td></tr>`).join('');

  $('#view').innerHTML = `
    <div class="card fade-in">
      ${dots}
      <p class="card-eyebrow">정리 · 오늘 배운 것</p>
      ${sejinHead('한 표로 묶어둘게요')}
      ${rows ? `<table class="sum-table">
        <thead><tr><th>항목</th><th>쓰임</th><th>주의</th></tr></thead>
        <tbody>${rows}</tbody></table>` : ''}
      ${L.aside ? `<div class="aside-box">
        <span class="lab">🌱 곁가지 이야기</span>
        <div class="prose">${md(L.aside)}</div></div>` : ''}
      <button class="btn-primary" style="margin-top:20px" id="done">이 장 마치기</button>
      <button class="btn-ghost" id="back">핵심 다시 보기</button>
      <p class="hint" id="hint"></p>
    </div>`;
  $('#done').addEventListener('click', completeLesson);
  $('#back').addEventListener('click', () => goStep(conceptStep()));
}

/* ═══ 🙋 "여기가 이해 안 돼요" ═══ */
const deepenLog = {};

const stuckBtn = (section) => `
  <button class="btn-stuck" id="stuckBtn">🙋 여기가 이해가 안 돼요</button>
  <div class="stuck-panel" id="stuckPanel" hidden>
    <p class="hint" style="margin:0 0 8px">어느 부분이 막혔는지 적어주면 그 지점만 콕 집어 다시 설명해요.
      비워두고 눌러도 괜찮아요 — 흔히 막히는 곳부터 풀어드릴게요.</p>
    <textarea id="stuckQ" rows="2" placeholder="예: 받은 돈인데 왜 부채인지 모르겠어요"></textarea>
    <button class="btn-primary" id="stuckGo" style="margin-top:8px">다시 설명해주세요</button>
  </div>
  <div id="deepenOut"></div>`;

function wireStuck(section) {
  const btn = $('#stuckBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    $('#stuckPanel').hidden = false; btn.remove(); $('#stuckQ').focus();
  });
  $('#stuckPanel').addEventListener('click', (e) => {
    if (e.target.id === 'stuckGo') askDeepen(section);
  });
}

async function askDeepen(section) {
  const go = $('#stuckGo');
  const question = $('#stuckQ').value.trim();
  go.disabled = true; go.textContent = '세진이 다시 생각하는 중…';
  try {
    const d = await post({ action: 'deepen', lessonId: L.id, section, question,
      askedBefore: deepenLog[section] || [] });
    if (d.parseError) { go.disabled = false; go.textContent = '다시 시도'; return; }
    (deepenLog[section] ||= []).push(d.approach || '(접근 미기재)');

    const box = document.createElement('div');
    box.className = 'deepen-box fade-in';
    box.innerHTML = `
      ${d.approach ? `<span class="lab">🔄 ${esc(d.approach)}</span>` : ''}
      <div class="prose">${md(d.explanation)}</div>
      ${d.check ? `<div class="deepen-check"><span>스스로 확인</span>${md(d.check)}</div>` : ''}`;
    $('#deepenOut').appendChild(box);
    markScrollableBoards();

    $('#stuckQ').value = '';
    go.disabled = false; go.textContent = '아직 모르겠어요, 다르게 설명해주세요';
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    go.disabled = false; go.textContent = '다시 시도';
    console.error(err);
  }
}

async function goStep(s) {
  step = s;
  drawStep();
  window.scrollTo(0, 0);
  post({ action: 'step', lessonId: L.id, step: s }).catch(() => {});
}

async function submitAnswer(pIdx) {
  const answer = $('#ans').value.trim();
  if (!answer) { $('#hint').textContent = '아무거나 좋으니 일단 써보세요. 틀려도 괜찮아요!'; return; }
  const btn = $('#submit');
  btn.disabled = true; btn.textContent = '세진이 보는 중…';
  try {
    const d = await post({ action: 'answer', lessonId: L.id, problemIndex: pIdx, answer, step });
    if (d.parseError) { $('#hint').textContent = d.message; btn.disabled = false; btn.textContent = '다시 제출'; return; }
    if (d.xp) renderXp(d.xp);
    if (d.xpGained) xpToast(d.xpGained, '정답!');
    drawFeedback(pIdx, answer, d);
  } catch (err) {
    $('#hint').textContent = err.message;
    btn.disabled = false; btn.textContent = '답 제출하기';
  }
}

function drawFeedback(pIdx, myAnswer, d) {
  const g = d.graded;
  const mark = g.correct ? '✅' : g.partial ? '🟡' : '💭';
  const cls = g.correct ? 'v-ok' : g.partial ? 'v-part' : 'v-no';
  const text = g.correct ? '정확해요' : g.partial ? '거의 왔어요' : '여기서 갈렸네요';
  const isLast = pIdx + 1 >= L.problemCount;

  $('#view').innerHTML = `
    <div class="card fade-in">
      ${stepDots(totalSteps(), step)}
      <p class="card-eyebrow">확인 문제 ${pIdx + 1} · 피드백</p>
      <div class="verdict">
        <span class="verdict-mark">${mark}</span>
        <span class="verdict-text ${cls}">${text}</span>
      </div>
      ${sejinHead('같이 짚어볼게요')}
      <div class="prose">${md(g.feedback)}</div>
      <div class="answer-box"><span class="lab">내가 쓴 답</span>${esc(myAnswer)}</div>
      ${g.corrected ? `<div class="answer-box corrected"><span class="lab">고친 형태</span>${esc(g.corrected)}</div>` : ''}
      <div class="answer-box"><span class="lab">정답</span>${esc(d.answer)}</div>
      ${d.notebookPointer ? `
        <div class="nb-pointer">
          <span class="nb-lab">📓 노트 ${esc(d.notebookPointer.sec)} 를 펴보세요</span>
          <p>${esc(d.notebookPointer.title)} — 직접 쓰신 페이지예요.
            ${d.notebookPointer.matchedGap ? '오늘 장이 아니라 그때 정리해둔 곳에 답이 있어요.' : '거기 쓰신 걸 다시 보는 게 새 설명을 읽는 것보다 잘 붙습니다.'}</p>
        </div>` : ''}
      ${g.gapConcept ? `
        <div class="gap-box">
          <span class="lab">🔧 여기 아래가 조금 흔들려요 — ${esc(g.gapConcept)}</span>
          <div class="prose">${md(g.gapPatch || '')}</div>
          <p class="hint" style="margin-top:8px">'약한 곳' 탭에 기록해뒀어요. 다음에 이게 또 나오면 미리 짚고 갈게요.</p>
        </div>` : ''}
      ${peerBlock(d)}
      <button class="btn-primary" style="margin-top:20px" id="next">
        ${isLast ? '정리하러 가기 →' : '다음 문제 →'}</button>
    </div>`;
  $('#next').addEventListener('click', () => goStep(step + 1));
  wirePeer(d);
  markScrollableBoards();
}

/* ═══ 🤝 친구 답 비교 — 내가 제출한 뒤에만 열립니다 ═══ */
function peerBlock(d) {
  if (!partnerCount) return '';
  if (!d.peers?.length) {
    return `<div class="peer-wait">🤝 함께 공부하는 사람이 아직 이 문제를 안 풀었어요.
      풀고 나면 여기서 답을 맞춰볼 수 있습니다.</div>`;
  }
  return `<div class="peer-box">
    <span class="peer-lab">🤝 이 사람은 이렇게 풀었어요</span>
    ${d.peers.map(p => `
      <div class="peer-row" data-peer="${p.userId}">
        <div class="peer-head">
          <b>${esc(p.name)}</b>
          <span class="peer-mark ${p.correct ? 'ok' : 'no'}">${p.correct ? '정답' : '틀림'}</span>
        </div>
        <div class="peer-answer">${esc(p.answer)}</div>
        <button class="btn-peer" data-to="${p.userId}">✍️ 이 답에 설명 남기기</button>
        <div class="peer-form" hidden>
          <p class="hint" style="margin:0 0 7px">가르치는 쪽이 더 배웁니다.
            어디가 갈렸는지 한두 문장으로 적어주세요.
            <b>세진이 먼저 확인하고</b> 맞으면 전달돼요.</p>
          <textarea rows="3" placeholder="예: 아직 서비스를 제공하기 전이라 매출이 아니라 선수금이에요"></textarea>
          <button class="btn-primary btn-peer-send" style="margin-top:8px">보내기</button>
          <div class="peer-result"></div>
        </div>
      </div>`).join('')}
  </div>`;
}

function wirePeer(d) {
  document.querySelectorAll('.btn-peer').forEach(btn => btn.addEventListener('click', () => {
    btn.nextElementSibling.hidden = false;
    btn.remove();
  }));
  document.querySelectorAll('.peer-form').forEach(form => {
    const send = form.querySelector('.btn-peer-send');
    send.addEventListener('click', async () => {
      const row = form.closest('.peer-row');
      const text = form.querySelector('textarea').value.trim();
      const out = form.querySelector('.peer-result');
      if (!text) { out.innerHTML = `<p class="hint">설명을 적어주세요.</p>`; return; }
      send.disabled = true; send.textContent = '세진이 확인하는 중…';
      try {
        const peer = (d.peers || []).find(p => String(p.userId) === row.dataset.peer);
        const r = await post({ action: 'explain-peer', toUser: Number(row.dataset.peer),
          chapterNo: d.chapterNo, problemIndex: d.problemIndex,
          peerAnswer: peer?.answer || '', text });
        if (r.xp) renderXp(r.xp);
        if (r.xpGained) xpToast(r.xpGained, '설명해주기');
        out.innerHTML = r.delivered
          ? `<div class="peer-ok">✅ 전달했어요.
               ${r.lenaNote ? `<span>세진: ${esc(r.lenaNote)}</span>` : ''}</div>`
          : `<div class="peer-no">🔄 이건 아직 안 보냈어요.
               ${r.lenaNote ? `<span>세진: ${esc(r.lenaNote)}</span>` : ''}
               <span class="hint">틀린 설명이 그대로 가면 상대가 오답을 굳히게 돼서요. 고쳐서 다시 보내보세요.</span></div>`;
        send.disabled = false;
        send.textContent = r.delivered ? '다시 보내기' : '고쳐서 다시 보내기';
      } catch (err) {
        out.innerHTML = `<p class="hint">${esc(err.message)}</p>`;
        send.disabled = false; send.textContent = '보내기';
      }
    });
  });
}

async function completeLesson() {
  const btn = $('#done');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const d = await post({ action: 'complete', lessonId: L.id });
    if (d.xpGained) xpToast(d.xpGained, '장 수료!');
    $('#view').innerHTML = `
      <div class="card fade-in center">
        <div class="done-mark">🎉</div>
        <h2>수고하셨어요</h2>
        <p class="prose" style="margin-top:10px">이 장을 마쳤어요.
          ${d.cardsAdded ? `복습 카드 <b>${d.cardsAdded}장</b>이 도감에 들어왔습니다.` : ''}</p>
        ${(d.notebookTasks || []).length ? `
          <div class="nb-issued">
            <span class="nb-lab">📓 노트에 쓸 것</span>
            ${d.notebookTasks.map(t => `
              <div class="nb-issued-row">
                <span class="nb-icon">${esc(t.icon || '·')}</span>
                <span class="nb-issued-spec">${esc(t.spec)}
                  ${t.target > 1 ? `<i>${t.target}회</i>` : ''}</span>
              </div>`).join('')}
            <p class="hint" style="margin-top:9px">노트 상단에 <b>${esc(d.notebookTasks[0].sec)}</b> 라고 적어두세요.
              교재·앱·노트가 같은 번호로 묶입니다.</p>
          </div>` : ''}
        <p class="hint">잊을 만할 때 '복습' 탭에서 다시 물어볼게요.</p>
        <button class="btn-primary" style="margin-top:18px" id="nextCh">다음 장으로 →</button>
      </div>`;
    renderStats(d.stats, d.xp);
    $('#nextCh').addEventListener('click', () => loadTab('today'));
  } catch (err) {
    btn.disabled = false; btn.textContent = '이 장 마치기';
    $('#hint').textContent = err.message;
  }
}

/* ═══ 목차 ═══ */
async function renderMap() {
  const d = await api('?action=map');
  renderStats(d.stats, d.xp);
  const byUnit = {};
  d.chapters.forEach(c => (byUnit[c.unit] ||= []).push(c));

  // 단계별 진도 — 시험 등급이 아니라 "지금 뭘 할 수 있게 됐나"입니다
  const ORDER = ['입문', '기본', '실전', '적용'];
  const lv = d.stats?.levels || {};
  const lvBar = ORDER.filter(k => lv[k]).map(k => `
    <div class="goethe-chip"><b>${esc(k)}</b><span>${lv[k].done}/${lv[k].total}</span></div>`).join('');

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">차례 · 교재 목차</p>
      <p class="hint">윤정용, <i>직장인이여 회계하라</i> 순서 그대로입니다.
        아무 장이나 눌러서 그리로 갈 수 있어요.</p>
      ${lvBar ? `<div class="goethe-row">${lvBar}</div>
        <p class="hint">단계는 진도 감각용이에요. 시험이 아니라 "지금 뭘 읽을 수 있나"입니다 🙂</p>` : ''}
      ${d.units.map(u => byUnit[u] ? `
        <div class="unit-head">${esc(u)}</div>
        ${byUnit[u].map(c => `
          <button class="ch-row ${c.done ? 'done' : ''} ${c.current ? 'cur' : ''}" data-ch="${c.no}">
            <span class="ch-sec">${esc(c.sec)}</span>
            <span class="ch-body">
              <span class="ch-ko">${esc(c.title)}</span>
            </span>
            <span class="ch-g">${esc(c.level || '')}</span>
            <span class="ch-mark">${c.done ? '✓' : c.current ? '▶' : ''}</span>
          </button>`).join('')}` : '').join('')}
    </div>`;
  document.querySelectorAll('.ch-row').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('이 장으로 이동할까요? 진행 중이던 장은 마친 것으로 처리됩니다.')) return;
    await post({ action: 'jump', chapterNo: Number(b.dataset.ch) });
    document.querySelector('.tabs button[data-tab="today"]').click();
  }));
}

/* ═══ 복습 ═══ */
let cardTiers = {};
let wroteThis = false;   // 이번 카드를 노트에 손으로 썼는지
let ME = null;           // 지금 로그인한 사람
let partnerCount = 0;

function renderWho() {
  const el = $('#whoami');
  if (el && ME?.name) el.textContent = `· ${ME.name}`;
}
function renderTgBadge(n) {
  const b = $('#tgBadge');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.hidden = false; } else b.hidden = true;
}
async function renderReview() {
  const d = await api('?action=review');
  renderStats(d.stats, d.xp);
  cards = d.cards; cardIdx = 0; flipped = false; wroteThis = false; cardTiers = d.tiers || {};
  if (!cards.length) {
    $('#view').innerHTML = `
      <div class="card fade-in center">
        <div class="done-mark">☕</div>
        <h2>지금은 복습할 카드가 없어요</h2>
        <p class="hint">장을 마치면 카드가 쌓이고, 잊을 만한 때가 되면 여기 나타납니다.</p>
      </div>`;
    return;
  }
  drawCard();
}

const KIND_LABEL = { account: '계정과목', equation: '등식·계산식', rule: '회계 규칙', term: '용어' };
/** 재무제표 어디에 앉는 계정인지 — 색으로 구분합니다 */
const SIDE_CLASS = {
  자산: 's-asset', 부채: 's-liab', 자본: 's-equity', 수익: 's-rev', 비용: 's-exp',
};
const SIDE_WHERE = {
  자산: '재무상태표 왼쪽', 부채: '재무상태표 오른쪽 위', 자본: '재무상태표 오른쪽 아래',
  수익: '손익계산서 +', 비용: '손익계산서 −',
};

function drawCard() {
  const c = cards[cardIdx];
  if (!c) { renderReview(); return; }
  const t = cardTiers[c.tier] || {};
  $('#view').innerHTML = `
    <div class="card fade-in">
      <div class="card-top">
        <span class="kind-tag">${esc(KIND_LABEL[c.kind] || c.kind)}</span>
        <span class="tier-tag" style="color:${esc(t.color || '#8FA3B8')}">${esc(t.label || c.tier)}</span>
        <span class="card-count">${cardIdx + 1} / ${cards.length}</span>
      </div>
      <div class="flash ${flipped ? 'flipped' : ''}" id="flash">
        <div class="flash-front">
          ${c.kind === 'account' ? `<span class="genus-slot ${flipped ? esc(SIDE_CLASS[c.side] || '') : 'unknown'}">${flipped ? esc(c.side || '') : '?'}</span>` : ''}
          <div class="flash-word">${esc(c.front)}</div>
          ${flipped ? `<div class="flash-back">${esc(c.back)}</div>
            ${c.side ? `<div class="flash-read">${esc(SIDE_WHERE[c.side] || '')}</div>` : ''}
            ${c.note ? `<div class="flash-note">${esc(c.note)}</div>` : ''}` : ''}
        </div>
      </div>
      ${!flipped
        ? `<div class="write-cue">
             <b>✍️ 노트에 먼저 써보세요.</b>
             <span>쓰지 않고 뒤집으면 인출 연습이 아니라 그냥 읽기가 됩니다.
               ${c.kind === 'account' ? '자산·부채·자본·수익·비용 중 어디인지도 함께 적어보세요.' : ''}</span>
           </div>
           <button class="btn-primary" id="flip">썼어요, 뒤집기</button>
           <button class="btn-ghost" id="flipOnly">머릿속으로만 떠올렸어요</button>`
        : `${wroteThis ? `<div class="wrote-badge">✍️ 노트에 쓰고 맞히면 다음 복습이 더 멀어집니다</div>` : ''}
           <div class="quality-row">
             <button class="q-btn q-again" data-q="0">다시<span>또 잊었어요</span></button>
             <button class="q-btn q-hard"  data-q="1">힘겹게<span>겨우 떠올림</span></button>
             <button class="q-btn q-good"  data-q="2">무난히<span>떠올랐어요</span></button>
             <button class="q-btn q-easy"  data-q="3">쉽게<span>바로 나왔어요</span></button>
           </div>`}
    </div>`;
  if (!flipped) {
    $('#flip').addEventListener('click', () => { wroteThis = true; flipped = true; drawCard(); });
    $('#flipOnly').addEventListener('click', () => { wroteThis = false; flipped = true; drawCard(); });
  } else {
    document.querySelectorAll('.q-btn').forEach(b =>
      b.addEventListener('click', () => gradeCard(Number(b.dataset.q))));
  }
}

async function gradeCard(quality) {
  const c = cards[cardIdx];
  document.querySelectorAll('.q-btn').forEach(b => (b.disabled = true));
  try {
    const d = await post({ action: 'review', cardId: c.id, quality, wrote: wroteThis });
    if (d.xp) renderXp(d.xp);
    if (d.xpGained) xpToast(d.xpGained, d.promoted ? '카드 승급!' : '복습 완료');
    // 승급과 '며칠 벌었는지'를 한 장으로 합칩니다. 따로 띄우면 다음 카드까지 2초 넘게 기다려야 해서요
    const lines = [];
    if (d.promoted) {
      const tier = cardTiers[d.tierAfter] || {};
      lines.push(`🎖 <b>${esc(c.front)}</b> — ${esc(tier.label || d.tierAfter)}(으)로 올라갔어요`);
    }
    // ✍️ 손으로 써서 실제로 며칠을 벌었는지 — 이게 진짜 보상입니다
    if (d.daysGained > 0) {
      lines.push(`✍️ 노트에 쓴 덕분에 다음 복습이 <b>${d.daysGained}일</b> 더 멀어졌어요`);
    }
    if (lines.length) {
      $('#view').insertAdjacentHTML('afterbegin',
        `<div class="promo-toast ${d.daysGained > 0 ? 'wrote' : ''}">${lines.join('<br/>')}
         ${d.nextInDays ? `<span>${d.nextInDays}일 뒤에 다시 물어볼게요</span>` : ''}</div>`);
      await new Promise(r => setTimeout(r, d.daysGained > 0 ? 1500 : 1100));
    }
  } catch (err) { console.error(err); }
  cardIdx++; flipped = false; wroteThis = false;
  if (cardIdx >= cards.length) renderReview(); else drawCard();
}

/* ═══ 계정과목 도감 ═══ */
const SIDE_ORDER = ['자산', '부채', '자본', '수익', '비용'];

async function renderCollection() {
  const d = await api('?action=collection');
  renderStats(d.stats, d.xp);
  const kinds = d.kinds || {};
  const sides = d.sides || {};
  if (!d.total) {
    $('#view').innerHTML = `
      <div class="card fade-in center">
        <div class="done-mark">📒</div>
        <h2>도감이 아직 비어 있어요</h2>
        <p class="hint">장을 마칠 때마다 계정과목과 등식이 한 장씩 들어옵니다.</p>
      </div>`;
    return;
  }
  const chip = (c) => {
    const t = d.tiers?.[c.tier] || {};
    return `<div class="col-card tier-${esc(c.tier)}" title="${esc(c.back)}">
      ${c.side ? `<span class="genus-dot ${esc(SIDE_CLASS[c.side] || '')}">${esc(c.side)}</span>` : ''}
      <span class="col-front">${esc(c.front)}</span>
      <span class="col-tier" style="color:${esc(t.color || '#8FA3B8')}">${esc(t.label || c.tier)}</span>
    </div>`;
  };
  // 계정과목은 '어디에 앉는지'로 모아 보는 게 실제로 더 자주 쓰입니다.
  // 나머지(등식·규칙·용어)는 종류별로.
  const hasSides = SIDE_ORDER.some(s => sides[s]?.length);

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">계정과목 도감</p>
      <p class="hint">모은 카드 ${d.total}장. 복습을 거듭할수록 등급이 올라갑니다.</p>
      ${hasSides ? `
        <p class="hint" style="margin-top:2px">계정과목은 <b>재무제표 어디에 앉는지</b>로 묶어뒀어요.
          이름을 외우는 것보다 자리를 아는 게 훨씬 오래 갑니다.</p>
        ${SIDE_ORDER.filter(s => sides[s]?.length).map(s => `
          <div class="unit-head side-head ${esc(SIDE_CLASS[s])}">${esc(s)}
            <span class="unit-sub">${esc(SIDE_WHERE[s])}</span>
            <span class="unit-n">${sides[s].length}</span></div>
          <div class="col-grid">${sides[s].map(chip).join('')}</div>`).join('')}` : ''}
      ${Object.entries(kinds).filter(([k]) => k !== 'account').map(([kind, list]) => `
        <div class="unit-head">${esc(KIND_LABEL[kind] || kind)} <span class="unit-n">${list.length}</span></div>
        <div class="col-grid">${list.map(chip).join('')}</div>`).join('')}
      ${(kinds.account || []).some(c => !c.side) ? `
        <div class="unit-head">자리 미정 계정 <span class="unit-n">${kinds.account.filter(c => !c.side).length}</span></div>
        <div class="col-grid">${kinds.account.filter(c => !c.side).map(chip).join('')}</div>` : ''}
    </div>`;
}

/* ═══ 약한 곳 ═══ */
async function renderGaps() {
  const d = await api('?action=gaps');
  renderStats(d.stats, null);
  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">약한 곳</p>
      <p class="hint">틀린 답에서 세진이 짚어낸 것들이에요. 이게 쌓이면 다음 수업 설명에 자동으로 녹아듭니다.</p>
      ${d.gaps.length ? d.gaps.map(g => `
        <div class="gap-row">
          <span class="gap-times">${g.times}회</span>
          <span class="gap-name">${esc(g.concept)}</span>
        </div>`).join('')
        : `<div class="empty">아직 기록된 약점이 없어요.<br/>문제를 풀다 보면 여기가 채워집니다.</div>`}
    </div>`;
}

/* ═══ 📓 내 노트 — 앱이 종이 노트의 색인이 됩니다 ═══ */
async function renderNotebook() {
  const d = await api('?action=notebook');
  renderStats(d.stats, d.xp);
  if (!d.pages.length) {
    $('#view').innerHTML = `
      <div class="card fade-in center">
        <div class="done-mark">📓</div>
        <h2>아직 노트에 쓸 것이 없어요</h2>
        <p class="hint">장을 마칠 때마다 손으로 쓸 과제가 여기 쌓입니다.<br/>
          분개와 재무제표는 손으로 그려봐야 구조가 몸에 들어옵니다.</p>
      </div>`;
    return;
  }
  const { open = 0, done = 0 } = d.notebookStats || {};
  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">내 노트</p>
      <p class="hint">앱은 노트를 읽지 않아요. 대신 <b>무엇이 적혀 있어야 하는지</b>를 알고 있습니다.
        페이지 번호는 교재 목차 번호와 같아요 — 노트 상단에 그 번호만 적어두세요.</p>
      ${d.pages.map(p => {
        // 접은 과제는 분모에서 뺍니다 — 안 하기로 한 걸 '남은 것'으로 세면 안 되니까요
        const live = p.tasks.filter(t => t.status !== 'skipped');
        const total = live.reduce((a, t) => a + t.target, 0);
        const did = live.reduce((a, t) => a + t.done, 0);
        const allDone = p.tasks.every(t => t.status !== 'open');
        return `
        <div class="nb-page ${allDone ? 'done' : ''}">
          <div class="nb-page-head">
            <span class="nb-sec">${esc(p.sec)}</span>
            <span class="nb-title">${esc(p.title)}</span>
            <span class="nb-count">${total ? `${did}/${total}` : '접음'}</span>
          </div>
          ${p.tasks.map(t => `
            <div class="nb-task ${t.status}">
              <span class="nb-icon">${esc(t.icon || '·')}</span>
              <span class="nb-task-spec">${esc(t.spec)}</span>
              <span class="nb-task-n">${t.status === 'skipped' ? '접음'
                : t.target > 1 ? `${t.done}/${t.target}` : (t.done ? '✓' : '─')}</span>
            </div>`).join('')}
        </div>`;
      }).join('')}
      <p class="hint" style="margin-top:14px">쓴 것 ${done || 0}개 · 남은 것 ${open || 0}개.
        진도를 막지는 않아요. 안 써도 다음 장으로 갈 수 있습니다.</p>
    </div>`;
}

/* ═══ 🤝 함께 ═══ */
async function renderTogether() {
  const d = await api('?action=together');
  renderStats(d.stats, d.xp);
  ME = d.me || ME; renderWho(); renderTgBadge(0);
  const chapName = (no) => {
    const c = (d.chapters || []).find(x => x.no === no);
    return c ? `${c.sec} ${c.title}` : `${no}장`;
  };
  const ago = (t) => {
    if (!t) return '아직';
    const h = Math.floor((Date.now() - new Date(t)) / 3600000);
    if (h < 1) return '방금';
    if (h < 24) return `${h}시간 전`;
    return `${Math.floor(h / 24)}일 전`;
  };

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">함께</p>

      ${d.partners.length ? `
        <div class="unit-head">지금 어디쯤</div>
        <div class="tg-row me">
          <span class="tg-name">${esc(d.me.name)} <i>나</i></span>
          <span class="tg-ch">${esc(chapName(d.me.chapterIndex + 1))}</span>
          <span class="tg-done">${d.stats?.done ?? 0}장</span>
        </div>
        ${d.partners.map(p => `
          <div class="tg-row">
            <span class="tg-name">${esc(p.name)}</span>
            <span class="tg-ch">${esc(chapName(p.chapterIndex + 1))}</span>
            <span class="tg-done">${p.doneCount}장</span>
            <span class="tg-seen">${esc(ago(p.lastSeen))}</span>
          </div>`).join('')}
        <p class="hint">진도는 각자예요. 다만 <b>같은 장을 풀면</b> 문제를 낸 뒤에
          서로 답을 볼 수 있습니다. 먼저 열리면 베끼게 되니까 제출 전에는 안 보여요.</p>
      ` : `
        <div class="empty" style="margin-bottom:6px">아직 같이 공부하는 사람이 없어요.</div>
        ${d.me.isOwner ? `<p class="hint">아래에서 초대하면 함께 볼 수 있습니다.</p>`
                       : `<p class="hint">주인이 초대하면 여기에 나타납니다.</p>`}
      `}

      ${d.inbox.length ? `
        <div class="unit-head" style="margin-top:20px">받은 설명</div>
        ${d.inbox.map(n => `
          <div class="note-in">
            <div class="note-head"><b>${esc(n.from)}</b>
              <span>${esc(chapName(n.chapterNo))} · ${n.problemIndex + 1}번</span></div>
            <div class="note-text">${esc(n.text)}</div>
            ${n.teacherNote ? `<div class="note-lena">📊 세진: ${esc(n.teacherNote)}</div>` : ''}
          </div>`).join('')}` : ''}

      ${d.outbox.length ? `
        <div class="unit-head" style="margin-top:20px">내가 보낸 설명</div>
        ${d.outbox.map(n => `
          <div class="note-out ${n.verdict === 'ok' ? '' : 'held'}">
            <div class="note-head"><b>→ ${esc(n.to)}</b>
              <span>${esc(chapName(n.chapterNo))} · ${n.problemIndex + 1}번</span>
              <span class="note-verdict ${n.verdict === 'ok' ? 'ok' : 'no'}">
                ${n.verdict === 'ok' ? '전달됨' : '보류'}</span></div>
            <div class="note-text">${esc(n.text)}</div>
            ${n.teacherNote ? `<div class="note-lena">📊 세진: ${esc(n.teacherNote)}</div>` : ''}
          </div>`).join('')}` : ''}

      ${d.me.isOwner ? `
        <div class="unit-head" style="margin-top:22px">초대</div>
        <div class="invite-row">
          <input class="field" id="inviteName" placeholder="이름" maxlength="12" />
          <button class="btn-primary" id="inviteBtn">초대 키 만들기</button>
        </div>
        <div id="inviteOut"></div>
        <p class="hint">만들어진 키를 전해주세요.
          그 키를 넣고 들어오면 <b>자기 진도로</b> 시작합니다.
          이 키는 회계 교실 전용이에요.</p>` : ''}
    </div>`;

  if (d.me.isOwner) {
    $('#inviteBtn').addEventListener('click', async () => {
      const name = $('#inviteName').value.trim();
      const btn = $('#inviteBtn');
      btn.disabled = true; btn.textContent = '만드는 중…';
      try {
        const r = await post({ action: 'invite', name });
        $('#inviteOut').innerHTML = `
          <div class="invite-key">
            <span class="lab">${esc(r.user.name)} 님의 키</span>
            <code>${esc(r.user.key)}</code>
            <button class="btn-ghost" id="copyKey">복사</button>
          </div>`;
        $('#copyKey').addEventListener('click', () => {
          navigator.clipboard?.writeText(r.user.key);
          $('#copyKey').textContent = '복사됨';
        });
        $('#inviteName').value = '';
      } catch (err) {
        $('#inviteOut').innerHTML = `<p class="hint">${esc(err.message)}</p>`;
      } finally {
        btn.disabled = false; btn.textContent = '초대 키 만들기';
      }
    });
  }
}
