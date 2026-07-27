/**
 * 클로이의 수학 노트 — 프런트엔드
 *
 * 수학은 한 번에 하나씩 주고받아야 해서 '단계 진행형'입니다.
 *   step 0: 도입(이야기) → 1: 개념(직관·비유) → 2~n: 확인문제 하나씩 → 마지막: 요약표
 * 각 단계에서 다음으로 넘어가야만 그 다음이 보입니다.
 */

const $ = (s) => document.querySelector(s);
const KEY_STORE = 'ah-math-key';
let adminKey = sessionStorage.getItem(KEY_STORE) || '';
let L = null;               // 현재 레슨
let step = 0;
let cards = [], cardIdx = 0, flipped = false;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 최소 마크다운 (## 소제목, **강조**) */
const md = (t) => esc(t)
  .replace(/^#{2,4}\s*(.+)$/gm, '<h4>$1</h4>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

async function api(qs, options = {}) {
  const sep = qs.includes('?') ? '&' : '?';
  const res = await fetch(`/api/school${qs}${sep}course=math`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({ ok: false, message: '응답을 읽지 못했습니다.' }));
  if (res.status === 401) { sessionStorage.removeItem(KEY_STORE); location.reload(); throw new Error('인증 만료'); }
  if (!data.ok) throw new Error(data.message || '요청이 실패했습니다.');
  return data;
}
const post = (body) => api('', { method: 'POST', body: JSON.stringify({ ...body, course: 'math' }) });

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
    else await renderGaps();
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p class="prose">${esc(err.message)}</p>
      <button class="btn-ghost" onclick="location.reload()">다시 시도</button></div>`;
  }
}

function renderStats(s, xp) {
  $('#statStrip').innerHTML = `
    <div class="stat"><b>${s?.done ?? 0}<span style="font-size:11px;color:var(--faint)">/${s?.total ?? 51}</span></b><span>수료</span></div>
    <div class="stat"><b>${s?.cards ?? 0}</b><span>공식</span></div>
    <div class="stat"><b>${s?.activeDays7 ?? 0}/7</b><span>출석</span></div>`;
  const badge = $('#dueBadge');
  if (s?.due > 0) { badge.textContent = s.due; badge.hidden = false; } else badge.hidden = true;
  if (xp) renderXp(xp);
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

const chloeHead = (sub) => `
  <div class="chloe">
    <div class="chloe-face">🌙</div>
    <div><div class="chloe-name">클로이</div><div class="chloe-role">${esc(sub)}</div></div>
  </div>`;

function stepDots(total, cur) {
  return `<div class="steps">${Array.from({ length: total }, (_, i) =>
    `<div class="step-dot ${i < cur ? 'done' : i === cur ? 'on' : ''}"></div>`).join('')}</div>`;
}

/* ═══ 오늘 수업 ═══ */
async function renderToday() {
  const d = await api('?action=today');
  L = d.lesson; step = L.step || 0;
  renderStats(d.stats, d.xp);
  $('#chapterLabel').textContent = `${String(L.chapterNo).padStart(2, '0')} ${L.title}`;
  drawStep();
}

/** 총 단계 = 도입 + 개념 + 문제수 + 요약 */
const totalSteps = () => 2 + (L?.problemCount || 0) + 1;

function drawStep() {
  const n = totalSteps();
  const dots = stepDots(n, step);

  // 0: 도입
  if (step === 0) {
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">${esc(L.unit)} · ${String(L.chapterNo).padStart(2, '0')}강</p>
        <h2>${esc(L.title)}</h2>
        ${chloeHead('오늘은 이 이야기부터 시작해볼게요')}
        <div class="prose">${md(L.intro)}</div>
        <button class="btn-primary" style="margin-top:20px" id="next">그래서 어떻게 됐나요 →</button>
      </div>`;
    $('#next').addEventListener('click', () => goStep(1));
    return;
  }

  // 1: 개념
  if (step === 1) {
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">개념 · 직관으로 먼저</p>
        ${chloeHead('비유로 한번 잡아볼게요')}
        <div class="prose">${md(L.concept)}</div>
        <button class="btn-primary" style="margin-top:20px" id="next">이해했어요, 문제 주세요 →</button>
        <button class="btn-ghost" id="back">다시 도입부터 읽기</button>
      </div>`;
    $('#next').addEventListener('click', () => goStep(2));
    $('#back').addEventListener('click', () => goStep(0));
    return;
  }

  // 2 ~ (2+문제수-1): 확인 문제
  const pIdx = step - 2;
  if (pIdx < L.problemCount) {
    const p = L.problems[pIdx];
    $('#view').innerHTML = `
      <div class="card fade-in">
        ${dots}
        <p class="card-eyebrow">확인 문제 ${pIdx + 1} / ${L.problemCount}</p>
        ${chloeHead('틀려도 괜찮아요. 어디서 헷갈리는지가 더 중요한 정보예요')}
        <div class="q-box">${md(p.question)}</div>
        <textarea id="ans" rows="4" placeholder="풀이 과정도 함께 써주면 어디서 갈렸는지 더 정확히 볼 수 있어요"></textarea>
        <button class="btn-primary" style="margin-top:14px" id="submit">답 제출하기</button>
        <p class="hint" id="hint"></p>
      </div>`;
    $('#submit').addEventListener('click', () => submitAnswer(pIdx));
    return;
  }

  // 마지막: 요약
  const rows = (L.summary || []).map(s => `
    <tr><td>${esc(s.term)}</td><td>${esc(s.meaning)}</td><td>${esc(s.caution || '')}</td></tr>`).join('');
  const forms = (L.formulas || []).map(f => `
    <div class="formula"><b>${esc(f.title)}</b>
      <div class="body">${esc(f.body)}</div>
      <div class="note">${esc(f.note || '')}</div></div>`).join('');

  $('#view').innerHTML = `
    <div class="card fade-in">
      ${dots}
      <p class="card-eyebrow">정리 · 오늘 배운 것</p>
      ${chloeHead('한 표로 묶어둘게요')}
      ${rows ? `<table class="sum-table">
        <thead><tr><th>용어</th><th>뜻</th><th>주의</th></tr></thead>
        <tbody>${rows}</tbody></table>` : ''}
      ${forms ? `<p class="card-eyebrow" style="margin-top:20px">기억해둘 것</p>${forms}
        <p class="hint">이 항목들은 복습 카드로 저장돼서, 잊을 만할 때 다시 물어봐요.</p>` : ''}
      <button class="btn-primary" style="margin-top:20px" id="done">이 챕터 마치기</button>
      <button class="btn-ghost" id="back">개념 다시 보기</button>
      <p class="hint" id="hint"></p>
    </div>`;
  $('#done').addEventListener('click', completeLesson);
  $('#back').addEventListener('click', () => goStep(1));
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
  btn.disabled = true; btn.textContent = '클로이가 보는 중…';
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
  const text = g.correct ? '정확해요!' : g.partial ? '거의 왔어요' : '여기서 갈렸네요';
  const isLast = pIdx + 1 >= L.problemCount;

  $('#view').innerHTML = `
    <div class="card fade-in">
      ${stepDots(totalSteps(), step)}
      <p class="card-eyebrow">확인 문제 ${pIdx + 1} · 피드백</p>
      <div class="verdict">
        <span class="verdict-mark">${mark}</span>
        <span class="verdict-text ${cls}">${text}</span>
      </div>
      ${chloeHead('같이 짚어볼게요')}
      <div class="prose">${md(g.feedback)}</div>
      <div class="answer-box"><span class="lab">내가 쓴 답</span>${esc(myAnswer)}</div>
      <div class="answer-box" style="margin-top:8px"><span class="lab">정답</span>${esc(d.answer)}</div>
      ${g.gapConcept ? `
        <div class="gap-box">
          <span class="lab">🔧 여기 아래가 조금 흔들려요 — ${esc(g.gapConcept)}</span>
          <p>${esc(g.gapPatch || '')}</p>
          <p class="hint" style="margin-top:8px">이 부분은 '약한 곳' 탭에 기록해뒀어요. 나중에 이 개념이 또 나오면 미리 짚고 갈게요.</p>
        </div>` : ''}
      <button class="btn-primary" style="margin-top:20px" id="next">
        ${isLast ? '정리하러 가기 →' : '다음 문제 →'}</button>
    </div>`;
  $('#next').addEventListener('click', () => goStep(step + 1));
}

async function completeLesson() {
  const btn = $('#done');
  btn.disabled = true; btn.textContent = '저장 중…';
  try {
    const d = await post({ action: 'complete', lessonId: L.id });
    if (d.xp) renderXp(d.xp);
    xpToast(d.xpGained, `${L.title} 수료!`);
    $('#view').innerHTML = `
      <div class="card fade-in" style="text-align:center;padding:40px 24px">
        <div style="font-size:44px">🌙</div>
        <h2 style="margin-top:14px">${esc(L.title)}, 끝!</h2>
        <p class="hint" style="font-size:14px">
          ${d.cardsAdded ? `공식 ${d.cardsAdded}개를 복습 카드에 넣어뒀어요.<br/>` : ''}
          오늘도 수고했어요. 다음 강의는 준비되면 언제든 열어주세요.
        </p>
        <button class="btn-primary" style="margin-top:22px" onclick="location.reload()">다음 강의 열기</button>
      </div>`;
  } catch (err) {
    $('#hint').textContent = err.message;
    btn.disabled = false; btn.textContent = '이 챕터 마치기';
  }
}

/* ═══ 목차 ═══ */
async function renderMap() {
  const d = await api('?action=map');
  renderStats(d.stats, d.xp);
  const byUnit = {};
  d.chapters.forEach(c => (byUnit[c.unit] ||= []).push(c));

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">CURRICULUM</p>
      <h2>공통수학 51강</h2>
      <p class="hint">이광연 《개념 있는 수학자: 공통수학 편》의 목차를 따릅니다.
        시험이 없으니 순서를 건너뛰어도 괜찮아요 — 궁금한 곳을 눌러 바로 가셔도 됩니다.</p>
    </div>
    ${Object.entries(byUnit).map(([unit, list]) => `
      <div class="unit-head">${esc(unit)}
        <span class="cnt">${list.filter(c => c.done).length} / ${list.length}</span></div>
      ${list.map(c => `
        <div class="chap-row ${c.done ? 'done' : ''} ${c.current ? 'current' : ''}" data-chap="${c.no}">
          <span class="chap-no">${String(c.no).padStart(2, '0')}</span>
          <span class="chap-title">${esc(c.title)}</span>
          <span class="chap-mark">${c.done ? '✅' : c.current ? '📍' : ''}</span>
        </div>`).join('')}
    `).join('')}`;

  document.querySelectorAll('[data-chap]').forEach(el =>
    el.addEventListener('click', async () => {
      const no = Number(el.dataset.chap);
      if (!confirm(`${no}강으로 이동할까요? 진행 중인 수업은 닫힙니다.`)) return;
      await post({ action: 'jump', chapterNo: no });
      document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === 'today'));
      loadTab('today');
    }));
}

/* ═══ 복습 ═══ */
async function renderReview() {
  const d = await api('?action=review');
  cards = d.cards || []; cardIdx = 0; flipped = false;
  renderStats(d.stats, d.xp);
  if (!cards.length) {
    $('#view').innerHTML = `<div class="empty">지금 복습할 공식이 없어요.<br/>
      챕터를 마치면 기억해둘 것들이 카드로 쌓입니다.</div>`;
    return;
  }
  drawCard();
}

function drawCard() {
  if (cardIdx >= cards.length) {
    $('#view').innerHTML = `<div class="empty">오늘 복습 끝! 🌙<br/>잊을 만할 때 다시 물어볼게요.</div>`;
    return;
  }
  const c = cards[cardIdx];
  $('#view').innerHTML = `
    <p class="hint" style="text-align:center;margin-bottom:10px">${cardIdx + 1} / ${cards.length} · ${c.chapter_no}강</p>
    <div class="card flash fade-in" id="flash">
      <div>
        <div class="t">${esc(c.title)}</div>
        ${flipped ? `<div class="b">${esc(c.body)}</div>
          ${c.note ? `<div class="n">${esc(c.note)}</div>` : ''}`
        : `<div class="flip-hint">탭하면 내용이 보여요</div>`}
      </div>
    </div>
    ${flipped ? `
      <div class="quality-row">
        <div class="q-btn" data-q="0"><b>😵</b>모르겠음</div>
        <div class="q-btn" data-q="1"><b>😐</b>어려움</div>
        <div class="q-btn" data-q="2"><b>🙂</b>보통</div>
        <div class="q-btn" data-q="3"><b>😎</b>쉬움</div>
      </div>` : ''}`;

  $('#flash').addEventListener('click', () => { if (!flipped) { flipped = true; drawCard(); } });
  document.querySelectorAll('.q-btn').forEach(b =>
    b.addEventListener('click', async () => {
      await post({ action: 'review', cardId: c.id, quality: Number(b.dataset.q) });
      cardIdx++; flipped = false; drawCard();
    }));
}

/* ═══ 약한 곳 ═══ */
async function renderGaps() {
  const d = await api('?action=gaps');
  renderStats(d.stats, null);
  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">WEAK SPOTS</p>
      <h2>아래가 흔들리는 곳</h2>
      <p class="hint">문제를 틀렸을 때 원인이 이 챕터가 아니라 더 아래(중학 개념)에 있으면
        클로이가 여기에 기록해둡니다. 부끄러운 목록이 아니라 <b>지도</b>예요 —
        어디를 메우면 위가 편해지는지 알려주는.</p>
    </div>
    ${d.gaps.length ? d.gaps.map(g => `
      <div class="card gap-item" style="margin-bottom:8px;padding:13px 16px">
        <span class="gap-times">${g.times}</span>
        <div style="flex:1"><div style="font-size:14.5px">${esc(g.concept)}</div>
          <div class="hint" style="margin:0">${g.times}번 걸렸어요</div></div>
      </div>`).join('')
    : `<div class="empty">아직 기록된 약점이 없어요.<br/>좋은 신호입니다 🌙</div>`}`;
}

if (adminKey) { $('#keyInput').value = adminKey; enter(); }
