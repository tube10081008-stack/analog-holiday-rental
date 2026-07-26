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
    else if (tab === 'stage') await renderStages();
    else if (tab === 'collection') await renderCollection();
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

/* ── XP · 레벨 ── */
function renderXp(xp) {
  if (!xp) return;
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

const TIER_META = {
  new:      { label: '신규',   cls: 'tier-new' },
  learning: { label: '학습중', cls: 'tier-learning' },
  mature:   { label: '숙성',   cls: 'tier-mature' },
  master:   { label: '마스터', cls: 'tier-master' },
};
const tierBadge = (t) => `<span class="tier-badge ${TIER_META[t]?.cls || ''}">${TIER_META[t]?.label || t}</span>`;

/* ═══ 오늘의 수업 ═══ */
async function renderToday() {
  const d = await api('?action=today');
  today = d; speechHeard = '';
  renderStats(d.stats, d.cardStats, d.profile.level);
  if (d.xp) renderXp(d.xp);
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
  if (d.xp) renderXp(d.xp);
  if (d.lessonXp) xpToast(d.lessonXp, '수업 통과');
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
      ${d.lessonXp ? `<p class="hint">🎮 +${d.lessonXp} XP 획득</p>` : ''}
      ${d.xpEarnedNote ? `<p class="hint">🎮 ${esc(d.xpEarnedNote)}</p>` : ''}
      <button class="btn-primary" style="margin-top:16px" onclick="location.reload()">다음 수업 받기</button>
    </div>`;
}

/* ═══ 복습 (SRS 플래시카드) ═══ */
async function renderReview() {
  const d = await api('?action=review');
  cards = d.cards || []; cardIdx = 0; flipped = false;
  renderStats(null, d.stats, today?.profile?.level);
  renderXp(d.xp);
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
        ${c.tier ? `<div style="margin-bottom:10px">${tierBadge(c.tier)}</div>` : ''}
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
      const r = await post({ action: 'review', cardId: c.id, quality: Number(b.dataset.q) });
      if (r.xp) renderXp(r.xp);
      if (r.result?.promoted) xpToast(r.result.xpGained, `${r.result.hanzi} → ${TIER_META[r.result.promoted.to].label} 승급!`);
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

/* ═══ ⚔️ 실전 스테이지 ═══ */
let stageState = null;

async function renderStages() {
  const d = await api('?action=stages');
  renderXp(d.xp);
  $('#levelLabel').textContent = LEVEL_NAME[d.level] || '중국어 학당';
  const cells = d.stages.map((s, i) => {
    const stars = '★'.repeat(s.stars) + '☆'.repeat(3 - s.stars);
    return `<div class="stage-cell ${s.unlocked ? (s.stars ? 'cleared' : '') : 'locked'}"
      ${s.unlocked ? `data-stage="${s.sceneIndex}"` : ''}>
      <div class="stage-no">STAGE ${String(i + 1).padStart(2, '0')}</div>
      <div class="stage-cn">${esc(s.cn)}</div>
      <div class="stage-ko">${esc(s.ko)}</div>
      ${s.unlocked
        ? `<div class="stage-stars" style="color:${s.stars ? 'var(--gold)' : 'var(--faint)'}">${stars}</div>`
        : `<div class="stage-lock">🔒 숙성 ${s.required}장 필요</div>`}
    </div>`;
  }).join('');

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">实战关卡 · 실전 스테이지</p>
      <h2>힌트 없이 해내기</h2>
      <p class="hint">병음도 예문도 없습니다. 그 상황에서 실제로 말할 수 있는지만 봅니다.<br/>
        해금 열쇠는 <b style="color:var(--gold)">숙성된 카드 수</b>입니다 — 출석이 아니라 실력이 문을 엽니다.</p>
      <p class="hint" style="margin-top:8px">현재 레벨 ${d.level} 숙성 카드 <b style="color:var(--gold)">${d.matured}장</b></p>
    </div>
    <div class="stage-grid">${cells}</div>`;

  document.querySelectorAll('[data-stage]').forEach(el =>
    el.addEventListener('click', () => startStage(d.level, Number(el.dataset.stage))));
}

async function startStage(level, sceneIndex) {
  $('#view').innerHTML = `<div class="loading">陈老师가 문제를 내는 중…</div>`;
  try {
    const d = await post({ action: 'stageStart', level, sceneIndex });
    stageState = { level, sceneIndex, missions: d.missions, stage: d.stage };
    $('#view').innerHTML = `
      <div class="card fade-in">
        <p class="card-eyebrow">STAGE · ${esc(d.stage.cn)}</p>
        <h2>${esc(d.stage.ko)}</h2>
        <p class="hint">🚫 힌트·병음 없음 · 실전 채점 · ★95점 ★★80점 ★☆☆60점</p>
      </div>
      ${d.missions.map((m, i) => `
        <div class="card fade-in">
          <div class="mission">
            <div class="mission-no">MISSION ${i + 1}</div>
            <div class="mission-sit">${esc(m.situation)}</div>
            <div class="mission-hint">💡 ${esc(m.hint)}</div>
            <textarea rows="2" data-ans="${i}" placeholder="중국어로 답하세요"></textarea>
          </div>
        </div>`).join('')}
      <button id="stageSubmit" class="btn-primary">도전 완료</button>
      <button class="btn-ghost" onclick="location.reload()">포기하고 나가기</button>
      <p class="hint" id="stageHint"></p>`;
    $('#stageSubmit').addEventListener('click', submitStage);
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p class="block-body">${esc(err.message)}</p>
      <button class="btn-ghost" onclick="location.reload()">돌아가기</button></div>`;
  }
}

async function submitStage() {
  const answers = [...document.querySelectorAll('[data-ans]')].map(el => el.value.trim());
  if (answers.every(a => !a)) { $('#stageHint').textContent = '최소 하나는 답해주세요.'; return; }
  const btn = $('#stageSubmit');
  btn.disabled = true; btn.textContent = '채점 중…';
  try {
    const d = await post({ action: 'stageSubmit', ...stageState, answers });
    if (d.parseError) { $('#stageHint').textContent = d.message; btn.disabled = false; btn.textContent = '다시 제출'; return; }
    renderStageResult(d);
  } catch (err) {
    $('#stageHint').textContent = err.message;
    btn.disabled = false; btn.textContent = '도전 완료';
  }
}

function renderStageResult(d) {
  const r = d.result;
  renderXp(d.xp);
  if (d.xp && d.newBest) xpToast(STAR_XP_TABLE[r.stars] || 0, `★${r.stars} 최고 기록!`);
  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">关卡结果 · 스테이지 결과</p>
      <div class="star-hero">
        <div class="stars" style="color:${r.stars ? 'var(--gold)' : 'var(--faint)'}">
          ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}</div>
        <div class="pt">${r.total}<span style="font-size:15px;color:var(--faint)"> / 100</span></div>
        ${d.newBest ? `<div><span class="new-best">🎉 최고 기록 갱신</span></div>` : ''}
      </div>
      ${(r.missionScores || []).map((m, i) => `
        <div class="block">
          <div class="block-title">MISSION ${m.index || i + 1} · ${m.score}점</div>
          <div class="fix">
            <div class="good">${esc(m.fixed || '')}</div>
            <div class="why">${esc(m.comment || '')}</div>
          </div>
        </div>`).join('')}
      <div class="block"><div class="block-title">💬 陈老师</div>
        <div class="block-body">${esc(r.comment || '')}</div></div>
      <button class="btn-primary" style="margin-top:16px" onclick="location.reload()">스테이지 목록으로</button>
    </div>`;
}
const STAR_XP_TABLE = { 1: 50, 2: 120, 3: 250 };

/* ═══ 📖 도감 ═══ */
async function renderCollection() {
  const d = await api('?action=collection');
  renderXp(d.xp);
  const blocks = d.collection.map(g => {
    const pct = Math.min(100, Math.round((g.owned / g.goal) * 100));
    const cells = g.cards.map(c =>
      `<div class="dex-cell t-${c.tier}" title="${esc(c.pinyin)} · ${esc(c.meaning)}"
        onclick="__speak('${esc(c.hanzi).replace(/'/g, "\\'")}')">${esc(c.hanzi)}</div>`).join('');
    // 미획득 칸을 최소 8개는 보여줘 '채우고 싶은' 여백을 남깁니다
    const empties = Math.max(0, Math.min(16, g.goal - g.owned));
    const emptyCells = Array.from({ length: empties }, () => `<div class="dex-empty">?</div>`).join('');
    return `
      <div class="card fade-in">
        <div class="dex-head">
          <div>
            <p class="card-eyebrow" style="margin:0">LEVEL ${g.level}</p>
            <b style="font-size:14px">${esc(g.label)}</b>
          </div>
          <span class="dex-count">${g.owned} <span style="color:var(--faint);font-size:12px">/ ${g.goal}</span></span>
        </div>
        <div class="dex-bar"><i style="width:${pct}%"></i></div>
        ${g.owned ? `<div class="dex-grid">${cells}${emptyCells}</div>
          <div class="dex-legend">
            ${['master','mature','learning','new'].filter(t => g.counts[t]).map(t =>
              `${tierBadge(t)} <span style="font-size:11px;color:var(--faint)">${g.counts[t]}</span>`).join('')}
          </div>`
        : `<p class="hint">아직 이 레벨의 단어가 없습니다. 수업을 마치면 자동으로 채워집니다.</p>`}
      </div>`;
  }).join('');

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">词汇图鉴 · 도감</p>
      <h2>내가 아는 한자</h2>
      <p class="hint">카드를 탭하면 발음이 들립니다. 등급은 실제 기억 정착도로 결정됩니다 —
        <b style="color:var(--gold)">숙성</b>은 21일, <b>마스터</b>는 60일 간격을 무실수로 통과한 단어입니다.</p>
    </div>
    ${blocks}`;
}
