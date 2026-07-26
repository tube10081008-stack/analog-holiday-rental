/**
 * 陈老师 중국어 학당 — 프런트엔드
 * 오늘의 수업(대화·핵심표현·발음·작문) / 복습(SRS 플래시카드) / 기록
 *
 * 듣기와 말하기는 브라우저 내장 기능을 씁니다 (추가 비용 0):
 *   - 듣기: SpeechSynthesis (zh-CN)
 *   - 말하기: SpeechRecognition (zh-CN) — Chrome/Edge, HTTPS 필요
 */

const $ = (s) => document.querySelector(s);
const KEY_STORE = 'ah-chinese-key';
let adminKey = sessionStorage.getItem(KEY_STORE) || '';
let today = null;
let cards = [], cardIdx = 0, flipped = false;
let speechHeard = '';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── 중국어 TTS ── */
let zhVoice = null;
function loadVoice() {
  const vs = speechSynthesis.getVoices();
  zhVoice = vs.find(v => /^zh[-_]CN/i.test(v.lang)) || vs.find(v => /^zh/i.test(v.lang)) || null;
}
loadVoice();
speechSynthesis.onvoiceschanged = loadVoice;

function speak(text, rate = 0.85) {
  if (!text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-CN';
  u.rate = rate;
  if (zhVoice) u.voice = zhVoice;
  speechSynthesis.speak(u);
}
window.__speak = speak;

async function api(qs, options = {}) {
  const sep = qs.includes('?') ? '&' : '?';
  const res = await fetch(`/api/school${qs}${sep}course=chinese`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({ ok: false, message: '응답을 읽지 못했습니다.' }));
  if (res.status === 401) { sessionStorage.removeItem(KEY_STORE); location.reload(); throw new Error('인증 만료'); }
  if (!data.ok) throw new Error(data.message || '요청이 실패했습니다.');
  return data;
}
const post = (body) => api('', { method: 'POST', body: JSON.stringify({ ...body, course: 'chinese' }) });

/* ── 로그인 ── */
$('#enterBtn').addEventListener('click', enter);
$('#keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });

async function enter() {
  const v = $('#keyInput').value.trim();
  if (!v) return;
  adminKey = v;
  $('#gateError').hidden = true;
  $('#enterBtn').disabled = true; $('#enterBtn').textContent = '확인 중…';
  try {
    await api('?action=history');
    sessionStorage.setItem(KEY_STORE, v);
    $('#gate').hidden = true; $('#app').hidden = false;
    loadTab('today');
  } catch (err) {
    $('#gateError').textContent = err.message; $('#gateError').hidden = false;
  } finally {
    $('#enterBtn').disabled = false; $('#enterBtn').textContent = '교실 들어가기';
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
    else if (tab === 'review') await renderReview();
    else await renderHistory();
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p class="block-body">${esc(err.message)}</p>
      <button class="btn-ghost" onclick="location.reload()">다시 시도</button></div>`;
  }
}

const LEVEL_NAME = { 1: '입문 · 생활 회화', 2: '초급 · 실전 대응', 3: '중급 · 비즈니스' };

function renderStats(s, cs, level) {
  $('#levelLabel').textContent = LEVEL_NAME[level] || '중국어 학당';
  $('#statStrip').innerHTML = `
    <div class="stat"><b>${s?.done ?? 0}</b><span>수업</span></div>
    <div class="stat"><b>${s?.avgScore ?? '—'}</b><span>평균</span></div>
    <div class="stat"><b>${cs?.total ?? 0}</b><span>단어</span></div>
    <div class="stat"><b>${s?.activeDays7 ?? 0}/7</b><span>출석</span></div>`;
  const badge = $('#dueBadge');
  if (cs?.due > 0) { badge.textContent = cs.due; badge.hidden = false; }
  else badge.hidden = true;
}

/* ═══ 오늘의 수업 ═══ */
async function renderToday() {
  const d = await api('?action=today');
  today = d; speechHeard = '';
  renderStats(d.stats, d.cardStats, d.profile.level);
  const S = d.session;

  const dlg = (S.dialogue || []).map(l => `
    <div class="line">
      <span class="spk">${esc(l.speaker || 'A')}</span>
      <div class="line-body">
        <div class="hz">${esc(l.hanzi)}</div>
        <div class="py">${esc(l.pinyin)}</div>
        <div class="ko">${esc(l.ko)}</div>
      </div>
      <button class="speak-btn" onclick="__speak('${esc(l.hanzi).replace(/'/g, "\\'")}')">🔊</button>
    </div>`).join('');

  const focus = (S.focus || []).map(f => `
    <div class="focus-item">
      <div class="focus-top">
        <span class="hz">${esc(f.hanzi)}</span>
        <span class="py">${esc(f.pinyin)}</span>
        <button class="speak-btn" onclick="__speak('${esc(f.hanzi).replace(/'/g, "\\'")}')">🔊</button>
      </div>
      <div class="focus-mean">${esc(f.meaning).replace(/⚠️/g, '<span class="warn">⚠️</span>')}</div>
      ${f.example ? `<div class="focus-ex"><span class="hz">${esc(f.example)}</span><br/>
        <span class="py">${esc(f.examplePinyin || '')}</span><br/>${esc(f.exampleMeaning || '')}</div>` : ''}
    </div>`).join('');

  const sl = S.speakLine || {};
  const canSpeak = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">今天的场景 · 오늘의 장면</p>
      <h2>${esc(S.sceneCn)}<span class="ko">${esc(S.scene)}</span></h2>
      ${d.priorFocus ? `<p class="hint">📌 지난 수업 지적: ${esc(d.priorFocus)}</p>` : ''}
      <div class="dialogue">${dlg}</div>
      <button class="btn-ghost" onclick="__speak(${JSON.stringify((S.dialogue || []).map(l => l.hanzi).join('。')).replace(/"/g, '&quot;')}, 0.8)">전체 듣기 ▶</button>
    </div>

    <div class="card fade-in">
      <p class="card-eyebrow">重点表达 · 핵심 표현</p>
      ${focus}
    </div>

    ${sl.hanzi ? `
    <div class="card fade-in">
      <p class="card-eyebrow">发音练习 · 발음 연습</p>
      <div class="speak-box">
        <div class="hz">${esc(sl.hanzi)}</div>
        <div class="py">${esc(sl.pinyin)}</div>
        <div class="ko" style="margin-top:6px">${esc(sl.meaning || '')}</div>
        ${sl.tonePoint ? `<p class="hint">🎯 ${esc(sl.tonePoint)}</p>` : ''}
        <button class="speak-btn" style="width:auto;padding:6px 14px;border-radius:999px;margin-top:10px"
          onclick="__speak('${esc(sl.hanzi).replace(/'/g, "\\'")}', 0.7)">🔊 천천히 듣기</button>
        ${canSpeak ? `
          <div class="mic-btn" id="micBtn">🎤</div>
          <p class="hint" id="micHint">눌러서 따라 읽어보세요</p>
          <div class="heard" id="heard"></div>`
        : `<p class="hint" style="margin-top:14px">이 브라우저는 음성 인식을 지원하지 않습니다.<br/>Chrome에서 열면 발음 채점을 받을 수 있어요.</p>`}
      </div>
    </div>` : ''}

    <div class="card fade-in">
      <p class="card-eyebrow">作业 · 오늘의 과제</p>
      <div class="block-body">${esc(S.task)}</div>
      <div class="field-label">답안 (중국어로 작성)</div>
      <textarea id="answer" rows="7" placeholder="여기에 중국어로 작성하세요. 병음이 아니라 한자로 쓰는 연습이 중요합니다.">${esc(S.draft || '')}</textarea>
      <p class="hint">한자 입력이 어려우면 병음으로 쓰셔도 됩니다. 다만 한자로 쓰는 편이 훨씬 빨리 늡니다.</p>
      <button id="submitBtn" class="btn-primary" style="margin-top:16px">제출하고 채점받기</button>
      <button id="skipBtn" class="btn-ghost">오늘은 건너뛰기</button>
      <p class="hint" id="submitHint"></p>
    </div>

    <div class="card fade-in">
      <p class="card-eyebrow">难度 · 레벨 조정</p>
      <p class="hint" style="margin:0 0 4px">너무 쉽거나 어려우면 언제든 바꾸세요.</p>
      <div class="level-row">
        ${[1, 2, 3].map(lv => `<button class="level-btn ${d.profile.level === lv ? 'on' : ''}" data-level="${lv}">
          ${['입문', '초급', '중급'][lv - 1]}<span>${['HSK 1~2', 'HSK 3~4', 'HSK 5+'][lv - 1]}</span></button>`).join('')}
      </div>
    </div>`;

  $('#submitBtn').addEventListener('click', submit);
  $('#skipBtn').addEventListener('click', skip);
  if (canSpeak && sl.hanzi) setupMic(sl.hanzi);
  document.querySelectorAll('[data-level]').forEach(b =>
    b.addEventListener('click', async () => {
      if (!confirm('레벨을 바꾸면 현재 수업이 초기화됩니다. 계속할까요?')) return;
      await post({ action: 'setLevel', level: Number(b.dataset.level) });
      await post({ action: 'skip' });
      loadTab('today');
    }));
}

/* ── 음성 인식 ── */
function setupMic(target) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $('#micBtn'), hint = $('#micHint'), out = $('#heard');
  btn.addEventListener('click', () => {
    const rec = new SR();
    rec.lang = 'zh-CN'; rec.interimResults = false; rec.maxAlternatives = 3;
    btn.classList.add('listening'); hint.textContent = '듣고 있어요… 또박또박 말해보세요';
    out.textContent = '';

    rec.onresult = (e) => {
      const heard = e.results[0][0].transcript.replace(/[，。！？\s]/g, '');
      const want = target.replace(/[，。！？\s]/g, '');
      speechHeard = heard;
      const ok = heard === want;
      // 글자 단위 일치율 (음성인식은 성조를 구분하지 못하므로 참고치입니다)
      const hit = [...want].filter((c, i) => heard[i] === c).length;
      const rate = Math.round((hit / want.length) * 100);
      out.className = `heard ${ok ? 'ok' : 'no'}`;
      out.innerHTML = ok
        ? `✅ ${esc(heard)}<br/><span style="font-size:12px">정확합니다!</span>`
        : `${esc(heard)}<br/><span style="font-size:12px;color:var(--dim)">일치율 ${rate}% — 제출하면 선생님이 원인을 짚어줍니다</span>`;
      hint.textContent = '다시 눌러 재시도할 수 있어요';
    };
    rec.onerror = (e) => { hint.textContent = e.error === 'not-allowed' ? '마이크 권한을 허용해 주세요' : '인식에 실패했어요. 다시 시도해 주세요'; };
    rec.onend = () => btn.classList.remove('listening');
    try { rec.start(); } catch { btn.classList.remove('listening'); }
  });
}

async function submit() {
  const answer = $('#answer').value.trim();
  if (answer.length < 5) { $('#submitHint').textContent = '답안을 입력해 주세요.'; return; }
  const btn = $('#submitBtn');
  btn.disabled = true; btn.textContent = '陈老师가 채점 중…';
  $('#submitHint').textContent = '꼼꼼히 보느라 30초쯤 걸립니다.';
  try {
    const d = await post({ action: 'submit', sessionId: today.session.id, answer, speechHeard });
    if (d.parseError) {
      $('#submitHint').textContent = d.message;
      btn.disabled = false; btn.textContent = '다시 제출'; return;
    }
    renderResult(d);
  } catch (err) {
    $('#submitHint').textContent = err.message;
    btn.disabled = false; btn.textContent = '제출하고 채점받기';
  }
}

async function skip() {
  if (!confirm('오늘 수업을 건너뛸까요?')) return;
  await post({ action: 'skip' });
  loadTab('today');
}

const SCORE_LABEL = { accuracy: '정확성', tone: '성조·발음', naturalness: '자연스러움', communication: '소통력' };

function renderResult(d) {
  const e = d.evaluation;
  renderStats(d.stats, d.cardStats, today.profile.level);
  const sc = e.scores || {};

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">评价 · 채점 결과</p>
      <div class="score-hero">
        <b>${e.overall}</b><span>/ 100</span>
        ${e.estimatedHSK ? `<div><span class="hsk-chip">추정 수준 · ${esc(e.estimatedHSK)}</span></div>` : ''}
      </div>
      <div class="score-grid">
        ${Object.entries(SCORE_LABEL).map(([k, label]) => {
          const v = sc[k]; if (v == null) return '';
          return `<div class="score-tile"><div class="n">${label}</div><div class="v">${v}</div>
            <div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div></div>`;
        }).join('')}
      </div>

      ${e.priorCheck && e.priorCheck.applied !== null ? `
        <div class="block"><div class="block-title">🔁 지난 지적 ${e.priorCheck.applied ? '고쳤음 ✅' : '아직 ❌'}</div>
        <div class="block-body">${esc(e.priorCheck.comment || '')}</div></div>` : ''}

      ${e.corrections?.length ? `
        <div class="block"><div class="block-title">✍️ 첨삭</div>
        ${e.corrections.map(c => `<div class="fix">
          <div class="bad">${esc(c.original)}</div>
          <div class="good">→ ${esc(c.fixed)}</div>
          <div class="why">${esc(c.why)}</div></div>`).join('')}</div>` : ''}

      ${e.koreanTrap ? `
        <div class="block"><div class="block-title">🇰🇷 한국어 간섭 발견</div>
        <div class="trap">${esc(e.koreanTrap)}</div></div>` : ''}

      ${e.betterExpression?.length ? `
        <div class="block"><div class="block-title">💡 더 자연스러운 표현</div>
        ${e.betterExpression.map(b => `<div class="fix">
          <div class="good hz">${esc(b.hanzi)}</div>
          <div class="py">${esc(b.pinyin || '')}</div>
          <div class="why">${esc(b.note || '')}</div>
          <button class="speak-btn" style="width:auto;padding:4px 12px;border-radius:999px;margin-top:6px"
            onclick="__speak('${esc(b.hanzi).replace(/'/g, "\\'")}')">🔊</button>
        </div>`).join('')}</div>` : ''}

      ${e.pronunciation?.comment ? `
        <div class="block"><div class="block-title">🎤 발음</div>
        <div class="block-body">${e.pronunciation.score != null ? `<b>${e.pronunciation.score}점</b> — ` : ''}${esc(e.pronunciation.comment)}</div></div>` : ''}

      ${e.nextFocus ? `
        <div class="block"><div class="block-title">📌 다음까지 반드시 고칠 것</div>
        <div class="block-body">${esc(e.nextFocus)}</div></div>` : ''}

      <div class="block"><div class="block-title">💬 陈老师</div>
      <div class="block-body">${esc(e.teacherComment || '')}</div></div>

      ${d.cardsAdded ? `<p class="hint" style="margin-top:14px">📇 새 단어 ${d.cardsAdded}개가 복습 카드에 추가되었습니다.</p>` : ''}
      <button class="btn-primary" style="margin-top:16px" onclick="location.reload()">다음 수업 받기</button>
    </div>`;
}

/* ═══ 복습 (SRS 플래시카드) ═══ */
async function renderReview() {
  const d = await api('?action=review');
  cards = d.cards || []; cardIdx = 0; flipped = false;
  renderStats(null, d.stats, today?.profile?.level);
  if (!cards.length) {
    $('#view').innerHTML = `<div class="empty">🎉 오늘 복습할 카드가 없습니다.<br/>
      새 단어는 수업을 마치면 자동으로 쌓입니다.<br/><br/>
      <span style="font-size:12px">전체 ${d.stats?.total ?? 0}개 · 숙성 ${d.stats?.mature ?? 0}개</span></div>`;
    return;
  }
  drawCard();
}

function drawCard() {
  if (cardIdx >= cards.length) {
    $('#view').innerHTML = `<div class="empty">✅ 오늘의 복습을 모두 마쳤습니다.<br/>내일 또 만나요!</div>`;
    loadTab('review');
    return;
  }
  const c = cards[cardIdx];
  $('#view').innerHTML = `
    <p class="hint" style="text-align:center;margin-bottom:10px">${cardIdx + 1} / ${cards.length}</p>
    <div class="card flash fade-in" id="flashCard">
      <div>
        <div class="hz">${esc(c.hanzi)}</div>
        ${flipped ? `
          <div class="py">${esc(c.pinyin)}</div>
          <div class="mean">${esc(c.meaning).replace(/⚠️/g, '<span class="warn">⚠️</span>')}</div>
          ${c.example ? `<div class="ex"><span class="hz" style="font-size:16px">${esc(c.example)}</span><br/>
            <span class="py">${esc(c.example_pinyin || '')}</span><br/>${esc(c.example_meaning || '')}</div>` : ''}`
        : `<div class="flip-hint">탭하면 뜻이 보입니다</div>`}
      </div>
    </div>
    <button class="btn-ghost" onclick="__speak('${esc(c.hanzi).replace(/'/g, "\\'")}')">🔊 발음 듣기</button>
    ${flipped ? `
      <div class="quality-row">
        <div class="q-btn" data-q="0"><b>😵</b>모르겠음</div>
        <div class="q-btn" data-q="1"><b>😐</b>어려움</div>
        <div class="q-btn" data-q="2"><b>🙂</b>보통</div>
        <div class="q-btn" data-q="3"><b>😎</b>쉬움</div>
      </div>
      <p class="hint" style="text-align:center">솔직하게 고를수록 복습 주기가 정확해집니다.</p>`
    : ''}`;

  $('#flashCard').addEventListener('click', () => { if (!flipped) { flipped = true; drawCard(); } });
  document.querySelectorAll('.q-btn').forEach(b =>
    b.addEventListener('click', async () => {
      await post({ action: 'review', cardId: c.id, quality: Number(b.dataset.q) });
      cardIdx++; flipped = false; drawCard();
    }));
}

/* ═══ 기록 ═══ */
async function renderHistory() {
  const d = await api('?action=history');
  renderStats(d.stats, null, today?.profile?.level);
  if (!d.history.length) {
    $('#view').innerHTML = `<div class="empty">아직 마친 수업이 없습니다.<br/>첫 수업부터 시작해 보세요.</div>`;
    return;
  }
  $('#view').innerHTML = `<div class="fade-in">
    ${d.stats?.avgTone != null ? `<div class="card"><p class="card-eyebrow">성조 정확도 추이</p>
      <div class="score-hero"><b>${d.stats.avgTone}</b><span>/ 100 평균</span></div>
      <p class="hint" style="text-align:center">한국인이 가장 오래 고생하는 영역입니다. 천천히 올리면 됩니다.</p></div>` : ''}
    ${d.history.map(h => {
      const dt = new Date(h.submitted_at);
      const ev = h.evaluation || {};
      return `<div class="card hist-item" style="margin-bottom:9px;padding:13px 15px">
        <span class="hist-score">${h.score ?? '—'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--hanzi);font-size:15px">${esc(h.scene_cn)}</div>
          <div class="hist-date" style="margin-top:2px">${esc(String(ev.nextFocus || '').slice(0, 50))}</div>
        </div>
        <span class="hist-date">${dt.getMonth() + 1}/${dt.getDate()}</span>
      </div>`;
    }).join('')}
  </div>`;
}

if (adminKey) { $('#keyInput').value = adminKey; enter(); }
