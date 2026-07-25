/**
 * 윌리엄스 스쿨 — 대표 과정 프런트엔드
 * 오늘의 강의(수업+인출시험+과제+예측) / 성적 / 예측 랭킹
 */

const $ = (s) => document.querySelector(s);
const KEY_STORE = 'ah-school-key';
let adminKey = sessionStorage.getItem(KEY_STORE) || '';
let today = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 최소 마크다운 렌더 (## 소제목, **굵게**) */
function md(text) {
  return esc(text)
    .replace(/^#{2,4}\s*(.+)$/gm, '<h4>$1</h4>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

async function api(path, options = {}) {
  const res = await fetch(`/api/school${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey, ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({ ok: false, message: '응답을 읽지 못했습니다.' }));
  if (res.status === 401) { logout(); throw new Error('인증이 만료되었습니다.'); }
  if (!data.ok) throw new Error(data.message || '요청이 실패했습니다.');
  return data;
}

function logout() {
  sessionStorage.removeItem(KEY_STORE);
  adminKey = '';
  $('#app').hidden = true;
  $('#gate').hidden = false;
}

/* ── 로그인 ── */
$('#enterBtn').addEventListener('click', enter);
$('#keyInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') enter(); });

async function enter() {
  const v = $('#keyInput').value.trim();
  if (!v) return;
  adminKey = v;
  $('#gateError').hidden = true;
  $('#enterBtn').disabled = true;
  $('#enterBtn').textContent = '확인 중…';
  try {
    await api('?action=history');
    sessionStorage.setItem(KEY_STORE, v);
    $('#gate').hidden = true;
    $('#app').hidden = false;
    loadTab('today');
  } catch (err) {
    $('#gateError').textContent = err.message;
    $('#gateError').hidden = false;
  } finally {
    $('#enterBtn').disabled = false;
    $('#enterBtn').textContent = '강의실 입장';
  }
}

/* ── 탭 ── */
document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    loadTab(b.dataset.tab);
  }));

async function loadTab(tab) {
  $('#view').innerHTML = `<div class="loading dot-pulse">불러오는 중</div>`;
  try {
    if (tab === 'today') await renderToday();
    else if (tab === 'history') await renderHistory();
    else await renderRank();
  } catch (err) {
    $('#view').innerHTML = `<div class="card"><p class="block-body">${esc(err.message)}</p>
      <button class="btn-ghost" onclick="location.reload()">다시 시도</button></div>`;
  }
}

function renderStats(s, ps) {
  $('#statStrip').innerHTML = `
    <div class="stat"><b>${s?.done ?? 0}</b><span>수료</span></div>
    <div class="stat"><b>${s?.avgGpa ?? '—'}</b><span>평균 GPA</span></div>
    <div class="stat"><b>${s?.activeDays7 ?? 0}/7</b><span>주간 출석</span></div>
    ${ps?.resolved > 0 ? `<div class="stat"><b>${ps.avgBrier}</b><span>브라이어</span></div>` : ''}`;
}

/* ── 오늘의 강의 ── */
async function renderToday() {
  const d = await api('?action=today');
  today = d;
  renderStats(d.stats, d.predictionStats);
  const L = d.lesson;

  const recallHtml = d.reviewItems.length ? `
    <div class="card fade-in">
      <p class="card-eyebrow">RETRIEVAL · 인출 시험</p>
      <h2>지난 수업, 기억나십니까</h2>
      <p class="hint" style="margin-bottom:14px">자료를 다시 보지 말고 기억나는 대로 쓰세요.
        기억나지 않으면 솔직히 적으시는 편이 낫습니다 — 지어내면 더 큰 감점입니다.</p>
      ${d.reviewItems.map(r => `
        <div class="recall-item">
          <div class="recall-q"><b>[${r.index}]</b> ${esc(r.topic)}${r.reviewCount ? ` <span style="color:var(--paper-faint);font-size:12px">(${r.reviewCount}회 복습)</span>` : ''}</div>
          <textarea rows="3" data-recall="${r.index}" placeholder="기억나는 핵심 내용…"></textarea>
        </div>`).join('')}
    </div>` : '';

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">${L.emoji || '📘'} ${esc(L.trackLabel || '')} · 오늘의 수업</p>
      <h2>${esc(L.topic)}</h2>
      <div class="meta-row">
        <span class="chip brass">제임스 윌리엄스 교수</span>
        ${d.priorFocus ? `<span class="chip">지난 지시: ${esc(String(d.priorFocus).slice(0, 40))}</span>` : ''}
      </div>
      <div class="brief">${md(L.brief)}</div>
    </div>

    ${recallHtml}

    <div class="card fade-in">
      <p class="card-eyebrow">ASSIGNMENT · 오늘의 과제</p>
      <div class="assignment">${md(L.assignment)}</div>

      <div class="field-label">답안</div>
      <textarea id="answer" rows="12" placeholder="20~30분 안에 끝낼 분량으로 작성하세요. 아날로그 홀리데이에 실제로 적용한 내용이어야 합니다.">${esc(L.draft || '')}</textarea>

      <div class="field-label">🔮 오늘의 예측 (1건) — 현실이 채점합니다</div>
      <p class="hint" style="margin:0 0 8px">확률은 정직하게. 확신 없이 90%를 쓰면 틀렸을 때 크게 깎이고,
        아는 걸 50%로 쓰면 맞혀도 점수를 못 얻습니다. AI 직원들과 같은 기준(브라이어 스코어)으로 겨룹니다.</p>
      <div class="pred-row">
        <input class="field" type="text" id="predClaim" placeholder="예: 8월 첫 주 와디즈 필름카메라 카테고리에 신규 펀딩이 3건 이상 열린다" />
        <div class="pred-sub" style="grid-column:1/-1">
          <select class="field" id="predProb">
            ${[10,20,30,40,50,60,70,80,90].map(v => `<option value="${v/100}"${v===60?' selected':''}>확률 ${v}%</option>`).join('')}
          </select>
          <select class="field" id="predHorizon">
            <option value="near">7일 내 확인 가능</option>
            <option value="launch">런칭 후 확인</option>
          </select>
        </div>
        <input class="field" type="text" id="predCriteria" placeholder="판정 방법 (예: 와디즈에서 카테고리 검색해 개수 확인)" style="grid-column:1/-1" />
      </div>

      <button id="submitBtn" class="btn-primary" style="margin-top:18px">제출하고 채점받기</button>
      <button id="skipBtn" class="btn-ghost">오늘은 건너뛰기</button>
      <p class="hint" id="submitHint"></p>
    </div>`;

  $('#submitBtn').addEventListener('click', submit);
  $('#skipBtn').addEventListener('click', skip);
}

async function submit() {
  const answer = $('#answer').value.trim();
  if (answer.length < 30) {
    $('#submitHint').textContent = '답안이 너무 짧습니다. 최소한 과제가 요구한 내용은 채워주세요.';
    return;
  }
  const recalls = [...document.querySelectorAll('[data-recall]')]
    .map(el => ({ index: Number(el.dataset.recall), answer: el.value.trim() }));

  const claim = $('#predClaim').value.trim();
  const predictions = claim ? [{
    claim,
    probability: Number($('#predProb').value),
    horizon: $('#predHorizon').value,
    days: 7,
    criteria: $('#predCriteria').value.trim(),
    basis: '대표 직관',
  }] : [];

  const btn = $('#submitBtn');
  btn.disabled = true;
  btn.textContent = '윌리엄스 교수가 채점 중…';
  $('#submitHint').textContent = '엄격한 채점이라 30초 정도 걸립니다.';

  try {
    const d = await api('', {
      method: 'POST',
      body: JSON.stringify({ action: 'submit', lessonId: today.lesson.id, answer, recalls, predictions }),
    });
    if (d.parseError) {
      $('#submitHint').textContent = d.message;
      btn.disabled = false; btn.textContent = '다시 제출';
      return;
    }
    renderResult(d);
  } catch (err) {
    $('#submitHint').textContent = err.message;
    btn.disabled = false;
    btn.textContent = '제출하고 채점받기';
  }
}

async function skip() {
  if (!confirm('오늘 과제를 건너뛸까요? 다음 접속 시 새 과제가 나옵니다.')) return;
  await api('', { method: 'POST', body: JSON.stringify({ action: 'skip', lessonId: today.lesson.id }) });
  loadTab('today');
}

const DOMAIN_LABEL = {
  comprehension: '이해', application: '적용',
  criticalThinking: '비판적 사고', execution: '실행 전환',
};

function renderResult(d) {
  const e = d.evaluation;
  renderStats(d.stats, null);
  const g = e.grades || {};

  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">EVALUATION · 채점 결과</p>
      <div class="gpa-hero"><b>${e.overallGPA}</b><span>GPA / 4.3</span></div>
      <div class="grade-grid">
        ${Object.entries(DOMAIN_LABEL).map(([k, label]) => {
          const x = g[k]; if (!x) return '';
          return `<div class="grade-tile">
            <div class="grade-name">${label}</div>
            <div class="grade-val">${esc(x.grade)}</div>
            <div class="grade-fb">${esc(x.feedback || '')}</div>
          </div>`;
        }).join('')}
      </div>

      ${e.priorCheck && e.priorCheck.applied !== null ? `
        <div class="block">
          <div class="block-title">🔁 지난 지시 이행 ${e.priorCheck.applied ? '✅' : '❌'}</div>
          <div class="block-body">${esc(e.priorCheck.comment || '')}</div>
        </div>` : ''}

      ${d.reviewOutcome?.length ? `
        <div class="block">
          <div class="block-title">🧠 인출 시험</div>
          <div class="block-body">${d.reviewOutcome.map(r =>
            `${r.correct ? '✅' : '❌'} ${esc(r.topic)}\n   └ ${esc(r.comment)} → ${r.nextInDays}일 후 재시험`).join('\n')}</div>
        </div>` : ''}

      <div class="block">
        <div class="block-title">🔬 진단</div>
        <div class="block-body">${esc(e.diagnosis || '')}</div>
      </div>

      <div class="block">
        <div class="block-title">🎓 윌리엄스 교수의 수업</div>
        <div class="block-body">${md(e.instruction || '')}</div>
      </div>

      ${e.predictionCritique ? `
        <div class="block">
          <div class="block-title">🔮 예측 심사${d.predictionsSaved ? ` · ${d.predictionsSaved}건 등록됨` : ''}</div>
          <div class="block-body">${esc(e.predictionCritique)}</div>
        </div>` : ''}

      ${e.nextFocus ? `
        <div class="block">
          <div class="block-title">📌 다음에 반드시 개선할 것</div>
          <div class="block-body">${esc(e.nextFocus)}</div>
        </div>` : ''}

      <div class="block">
        <div class="block-title">💬 종합 소견</div>
        <div class="block-body" style="font-family:var(--serif)">${esc(e.professorComment || '')}</div>
      </div>

      <button class="btn-primary" style="margin-top:18px" onclick="location.reload()">다음 강의 받기</button>
    </div>`;
}

/* ── 성적 ── */
async function renderHistory() {
  const d = await api('?action=history');
  renderStats(d.stats, null);
  if (!d.history.length) {
    $('#view').innerHTML = `<div class="empty">아직 제출한 과제가 없습니다.<br/>첫 강의부터 시작해 보세요.</div>`;
    return;
  }
  $('#view').innerHTML = `<div class="fade-in">
    ${d.history.map(h => {
      const dt = new Date(h.submitted_at);
      const ev = h.evaluation || {};
      return `<div class="card hist-item" style="margin-bottom:10px;padding:14px 16px">
        <span class="hist-gpa">${h.gpa ?? '—'}</span>
        <div class="hist-body">
          <div class="hist-topic">${esc(h.topic)}</div>
          <div class="hist-date" style="margin-top:2px">${esc(String(ev.nextFocus || ev.professorComment || '').slice(0, 60))}</div>
        </div>
        <span class="hist-date">${dt.getMonth() + 1}/${dt.getDate()}</span>
      </div>`;
    }).join('')}
  </div>`;
}

/* ── 예측 랭킹 ── */
async function renderRank() {
  const d = await api('?action=leaderboard');
  const rows = d.ranked || [];
  $('#view').innerHTML = `
    <div class="card fade-in">
      <p class="card-eyebrow">LEADERBOARD · 예측 정확도</p>
      <h2>누가 더 잘 맞히는가</h2>
      <p class="hint" style="margin-bottom:16px">브라이어 스코어는 낮을수록 우수합니다.
        0.25는 동전던지기 수준이고, 스킬 점수가 0보다 커야 실력이 있다는 뜻입니다.</p>
      ${rows.length ? rows.map((r, i) => `
        <div class="card rank-row ${r.isFounder ? 'me' : ''}" style="margin-bottom:8px">
          <span class="rank-no">${i + 1}</span>
          <span class="rank-name">${r.isFounder ? '👤 ' : '🤖 '}${esc(r.name)}</span>
          <div class="rank-score">
            <b style="color:${r.skillScore > 0.2 ? 'var(--green)' : r.skillScore > 0 ? 'var(--brass)' : 'var(--red)'}">${r.avgBrier}</b>
            <span>${r.resolved}건 · 적중 ${Math.round((r.hitRate || 0) * 100)}%</span>
          </div>
        </div>`).join('')
        : `<div class="empty">아직 판정된 예측이 없습니다.<br/>near 예측은 7일 뒤부터 채점됩니다.</div>`}
      ${d.unranked?.length ? `<p class="hint" style="margin-top:14px">대기 중: ${d.unranked.map(u => esc(u.name)).join(', ')}</p>` : ''}
    </div>`;
}

/* ── 부팅 ── */
if (adminKey) {
  $('#keyInput').value = adminKey;
  enter();
}
