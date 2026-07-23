/**
 * 홀리데이 메이트 — 앱 로직
 * 필름카메라 여행자를 위한 촬영 동반자.
 * "지금(빛+주변 스팟)" / "필름 롤(36컷)" / "여정(기록)" 3개 뷰 + 스팟 상세.
 */
import { SPOTS, CAMERAS, PERSONAS, STAMPS, distanceM, bearingDeg, getSpotById } from './spots.js';

const STORE_KEY = 'ah-mate-v1';
const ROLL_SIZE = 36;
const FALLBACK_POS = { lat: 37.5665, lng: 126.978 }; // 서울시청 (GPS 거부 시)

/* ── 상태 ── */
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    return {
      camera: raw.camera || null,
      persona: raw.persona || null,
      shots: Array.isArray(raw.shots) ? raw.shots : [],
      scripts: raw.scripts || {}, // 대본 캐시: key → text
      stamps: Array.isArray(raw.stamps) ? raw.stamps : [],
    };
  } catch {
    return { camera: null, persona: null, shots: [], scripts: {}, stamps: [] };
  }
}
const state = loadState();
let position = null;
let gpsError = false;
let currentAudio = null;

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

/* ── DOM 헬퍼 ── */
const $ = (sel) => document.querySelector(sel);
const $view = $('#view');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── 시간대별 빛 가이드 ── */
function lightNow() {
  const h = new Date().getHours();
  if (h >= 5 && h < 8) return { time: 'MORNING LIGHT', name: '새벽의 파스텔', desc: '부드럽고 낮은 빛. 인적 없는 골목과 긴 그림자를 담기 가장 좋은 시간이에요.' };
  if (h >= 8 && h < 11) return { time: 'SOFT SUN', name: '오전의 순광', desc: '색이 가장 정직하게 나오는 시간. 바다와 하늘, 건물의 색을 담아보세요.' };
  if (h >= 11 && h < 15) return { time: 'HIGH NOON', name: '한낮의 강한 빛', desc: '그림자가 짧고 진해요. 그림자 자체를 피사체로 쓰거나, 그늘 속 장면을 노리세요.' };
  if (h >= 15 && h < 17) return { time: 'SLANTED LIGHT', name: '기울어진 오후', desc: '빛이 비스듬해지며 질감이 살아나는 시간. 벽, 기와, 돌바닥이 예뻐집니다.' };
  if (h >= 17 && h < 19) return { time: 'GOLDEN HOUR', name: '골든아워', desc: '필름이 가장 사랑하는 시간. 지금 밖이라면, 망설이지 말고 한 컷 쓰세요.' };
  if (h >= 19 && h < 20) return { time: 'BLUE HOUR', name: '블루아워', desc: '하늘에 푸른 기가 남은 20분. 야경 필름 사진의 성공률이 가장 높은 시간이에요.' };
  return { time: 'NIGHT', name: '밤의 시간', desc: '플래시의 시간입니다. 피사체와 2m 안쪽, 배경은 불빛으로 채우세요.' };
}

/* ── GPS ── */
function locate() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { gpsError = true; resolve(FALLBACK_POS); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { gpsError = false; resolve({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { gpsError = true; resolve(FALLBACK_POS); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

function nearbySpots() {
  const pos = position || FALLBACK_POS;
  return SPOTS
    .map((s) => ({ ...s, distance: distanceM(pos.lat, pos.lng, s.lat, s.lng), bearing: bearingDeg(pos.lat, pos.lng, s.lat, s.lng) }))
    .sort((a, b) => a.distance - b.distance);
}

function fmtDist(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}km`;
  return `${m}m`;
}

/* ── 라우팅 ── */
function go(route) { location.hash = route; }
window.addEventListener('hashchange', render);

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause?.();
    currentAudio = null;
  }
  window.speechSynthesis?.cancel();
}

function render() {
  stopAudio();
  const hash = location.hash.replace('#', '') || 'now';
  const [route, param] = hash.split('/');

  document.querySelectorAll('.bottomnav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === route);
  });
  updateRollChip();

  if (route === 'spot' && param) renderSpot(param);
  else if (route === 'roll') renderRoll();
  else if (route === 'journey') renderJourney();
  else renderNow();
  window.scrollTo(0, 0);
}

function updateRollChip() {
  $('#rollChipText').textContent = `ROLL ${state.shots.length}/${ROLL_SIZE}`;
}

/* ═══ 뷰: 지금 ═══ */
function renderNow() {
  const light = lightNow();
  const cam = CAMERAS[state.camera];
  const spots = nearbySpots();

  $view.innerHTML = `
    <div class="fade-in">
      <div class="card light-card">
        <div class="light-time">◑ ${light.time}</div>
        <div class="light-name">${light.name}</div>
        <p class="light-desc">${light.desc}</p>
        ${cam ? `<div class="light-cam"><b>${esc(cam.name)}</b><span>${esc(cam.generalTip)}</span></div>` : ''}
      </div>

      <div class="gps-line ${gpsError ? 'err' : ''}">
        <span class="dot"></span>
        <span>${gpsError ? '위치 접근 불가 — 서울 기준으로 보여드려요' : position ? '현재 위치 기준' : '위치 확인 중…'}</span>
        <button id="gpsRetry">다시 찾기</button>
      </div>

      <p class="section-eyebrow">Nearby Frames</p>
      <h2 class="section-title">지금 걸어갈 수 있는 장면들</h2>
      <p class="section-sub">가까운 순서예요. 탭하면 그 장소를 찍는 법을 알려드려요.</p>

      <div class="spot-list">
        ${spots.map((s) => `
          <button class="card spot-card" data-spot="${s.id}">
            <div class="spot-frame">${s.emoji}</div>
            <div class="spot-body">
              <div class="spot-meta"><span class="city">${s.city}</span><span>·</span><span>${s.category}</span></div>
              <div class="spot-name">${esc(s.name)}</div>
              <div class="spot-golden">☀︎ ${esc(s.goldenTime)}</div>
            </div>
            <div class="spot-side">
              <span class="spot-dist">${fmtDist(s.distance)}</span>
              <span class="spot-arrow" style="transform: rotate(${Math.round(s.bearing)}deg)">↑</span>
            </div>
          </button>
        `).join('')}
      </div>
    </div>`;

  $view.querySelectorAll('[data-spot]').forEach((el) =>
    el.addEventListener('click', () => go(`spot/${el.dataset.spot}`)));
  $('#gpsRetry').addEventListener('click', async () => {
    position = await locate();
    renderNow();
  });
}

/* ═══ 뷰: 스팟 상세 ═══ */
function renderSpot(spotId) {
  const spot = getSpotById(spotId);
  if (!spot) { go('now'); return; }
  const cam = CAMERAS[state.camera];
  const persona = PERSONAS[state.persona] || PERSONAS.hani;
  const spotCamTip = spot.cameraTips?.[state.camera];
  const scriptKey = `${spot.id}:${state.persona}:${state.camera}`;
  const cachedScript = state.scripts[scriptKey];

  $view.innerHTML = `
    <div class="fade-in">
      <button class="detail-back" id="backBtn">← 돌아가기</button>

      <div class="detail-hero">
        <div class="detail-city">${spot.city} · ${spot.category}</div>
        <div class="detail-name">${esc(spot.name)} ${spot.emoji}</div>
        <p class="detail-desc">${esc(spot.desc)}</p>
        <div class="detail-moods">${spot.moods.map((m) => `<span>#${esc(m)}</span>`).join('')}</div>
      </div>

      <div class="card info-block">
        <h4>☀︎ 촬영 골든타임</h4>
        <p>${esc(spot.goldenTime)}</p>
      </div>
      <div class="card info-block">
        <h4>🎞 필름 노하우</h4>
        <p>${esc(spot.filmNote)}</p>
      </div>
      ${cam ? `
      <div class="card info-block">
        <h4>📷 내 카메라로 찍는 법</h4>
        <p><span class="cam-name">${esc(cam.name)}</span> — ${esc(spotCamTip || cam.generalTip)}</p>
      </div>` : ''}

      <div class="card guide-player">
        <div class="guide-player-top">
          <div class="persona-avatar" style="border-color:${persona.color}">${persona.emoji}</div>
          <div class="guide-player-info">
            <div class="guide-player-name">${persona.name}의 오디오 가이드</div>
            <div class="guide-player-sub">${esc(persona.oneLiner)}</div>
          </div>
          <button class="play-btn" id="playBtn" aria-label="가이드 재생">▶</button>
        </div>
        <div class="guide-status" id="guideStatus">${cachedScript ? '준비 완료 — 다시 들어도 비용이 들지 않아요 ⚡' : '재생을 누르면 이 장소만의 가이드를 만들어드려요'}</div>
        ${cachedScript ? `<div class="guide-script">${esc(cachedScript)}</div>` : '<div class="guide-script" id="scriptBox" hidden></div>'}
      </div>

      <div class="detail-actions">
        <a class="btn-map" target="_blank" rel="noopener"
           href="https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}&travelmode=walking">길찾기</a>
        <button class="btn-shot" id="shotBtn">🎞 여기서 한 컷 쓰기</button>
      </div>
    </div>`;

  $('#backBtn').addEventListener('click', () => history.back());
  $('#shotBtn').addEventListener('click', () => openShotSheet(spot));
  $('#playBtn').addEventListener('click', () => playGuide(spot, scriptKey));
}

/* ── 가이드 생성 + 재생 ── */
async function playGuide(spot, scriptKey) {
  const btn = $('#playBtn');
  const status = $('#guideStatus');

  // 이미 재생 중이면 정지
  if (currentAudio || window.speechSynthesis?.speaking) {
    stopAudio();
    btn.textContent = '▶';
    status.textContent = '일시 정지됨';
    return;
  }

  try {
    let script = state.scripts[scriptKey];

    if (!script) {
      btn.classList.add('loading');
      btn.textContent = '…';
      status.textContent = `${PERSONAS[state.persona]?.name || '하니'}가 대본을 쓰는 중이에요…`;
      const res = await fetch('/api/mate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'script', spotId: spot.id, cameraId: state.camera, persona: state.persona }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.message || '대본 생성 실패');
      script = data.script;
      state.scripts[scriptKey] = script;
      save();

      const box = document.querySelector('#scriptBox');
      if (box) { box.textContent = script; box.hidden = false; }
    }

    status.textContent = '목소리를 입히는 중…';
    const ttsRes = await fetch('/api/mate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'tts', text: script, persona: state.persona }),
    });
    const tts = await ttsRes.json();
    btn.classList.remove('loading');

    if (tts.ok && tts.audioBase64) {
      const bytes = Uint8Array.from(atob(tts.audioBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const audio = new Audio(url);
      currentAudio = audio;
      audio.addEventListener('ended', () => {
        URL.revokeObjectURL(url);
        currentAudio = null;
        btn.textContent = '▶';
        status.textContent = '다시 들어도 비용이 들지 않아요 ⚡';
      });
      await audio.play();
      btn.textContent = '⏸';
      status.textContent = '재생 중';
    } else {
      // 브라우저 TTS 폴백 — ElevenLabs 미설정 환경에서도 동작
      const utter = new SpeechSynthesisUtterance(script);
      utter.lang = 'ko-KR';
      utter.rate = 0.95;
      utter.onend = () => { btn.textContent = '▶'; status.textContent = '다시 들어도 비용이 들지 않아요 ⚡'; };
      window.speechSynthesis.speak(utter);
      btn.textContent = '⏸';
      status.textContent = '재생 중 (기기 음성)';
    }
  } catch (err) {
    console.error(err);
    btn.classList.remove('loading');
    btn.textContent = '▶';
    status.textContent = '연결이 잠시 어려워요. 다시 시도해 주세요.';
  }
}

/* ═══ 뷰: 필름 롤 ═══ */
function renderRoll() {
  const used = state.shots.length;
  const cells = Array.from({ length: ROLL_SIZE }, (_, i) => {
    const shot = state.shots[i];
    const spot = shot ? getSpotById(shot.spotId) : null;
    return `<div class="roll-cell ${shot ? 'used' : ''}" title="${shot ? esc(spot?.name || '기록') : `${i + 1}컷`}">${shot ? (spot?.emoji || '✦') : ''}</div>`;
  }).join('');

  $view.innerHTML = `
    <div class="fade-in">
      <p class="section-eyebrow">One Trip, One Roll</p>
      <h2 class="section-title">이번 여행의 필름 롤</h2>
      <p class="section-sub">36장뿐이라서, 한 장 한 장이 신중해져요. 그게 필름의 낭만이죠.</p>

      <div class="roll-strip">
        <div class="roll-grid">${cells}</div>
        <div class="roll-count-line"><b>${used}</b> / ${ROLL_SIZE} FRAMES ${used >= ROLL_SIZE ? '· 롤 완성! 🎉' : ''}</div>
      </div>

      ${used === 0
        ? `<div class="empty-note">아직 한 컷도 쓰지 않았어요.<br/>스팟에 도착하면 "여기서 한 컷 쓰기"를 눌러보세요.</div>`
        : `<p class="section-eyebrow">Shot Log</p>
           <div class="shot-log">
            ${state.shots.map((shot, i) => {
              const spot = getSpotById(shot.spotId);
              const d = new Date(shot.at);
              return `<div class="card shot-item">
                <span class="shot-no">#${String(i + 1).padStart(2, '0')}</span>
                <div class="shot-body">
                  <div class="shot-place">${esc(spot?.name || '어딘가의 순간')}</div>
                  ${shot.note ? `<div class="shot-note-text">“${esc(shot.note)}”</div>` : ''}
                </div>
                <span class="shot-time">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}</span>
              </div>`;
            }).join('')}
           </div>`
      }
    </div>`;
}

/* ═══ 뷰: 여정 ═══ */
function renderJourney() {
  const visitedSpotIds = [...new Set(state.shots.map((s) => s.spotId).filter(Boolean))];
  const cities = [...new Set(visitedSpotIds.map((id) => getSpotById(id)?.city).filter(Boolean))];

  $view.innerHTML = `
    <div class="fade-in">
      <p class="section-eyebrow">Your Journey</p>
      <h2 class="section-title">돌아와서 곱씹게 될 기록</h2>
      <p class="section-sub">여기 남긴 기록은 귀국 후 숏폼 영상의 재료가 됩니다.</p>

      <div class="journey-stats">
        <div class="card stat-tile"><div class="stat-num">${state.shots.length}</div><div class="stat-label">사용한 컷</div></div>
        <div class="card stat-tile"><div class="stat-num">${visitedSpotIds.length}</div><div class="stat-label">방문 스팟</div></div>
        <div class="card stat-tile"><div class="stat-num">${cities.length}</div><div class="stat-label">도시</div></div>
      </div>

      <p class="section-eyebrow">Travel Stamps</p>
      <div class="stamp-grid">
        ${STAMPS.map((st) => {
          const earned = state.stamps.includes(st.id);
          return `<div class="stamp ${earned ? 'earned' : ''}" title="${esc(st.desc)}">
            <span class="stamp-emoji">${earned ? st.emoji : '·'}</span>
            <span class="stamp-name">${esc(st.name)}</span>
          </div>`;
        }).join('')}
      </div>

      ${visitedSpotIds.length > 0 ? `
        <p class="section-eyebrow">Visited Frames</p>
        <div class="spot-list">
          ${visitedSpotIds.map((id) => {
            const s = getSpotById(id);
            if (!s) return '';
            const count = state.shots.filter((sh) => sh.spotId === id).length;
            return `<button class="card spot-card" data-spot="${s.id}">
              <div class="spot-frame">${s.emoji}</div>
              <div class="spot-body">
                <div class="spot-meta"><span class="city">${s.city}</span></div>
                <div class="spot-name">${esc(s.name)}</div>
                <div class="spot-golden">이곳에서 ${count}컷을 썼어요</div>
              </div>
            </button>`;
          }).join('')}
        </div>` : `<div class="empty-note">아직 여정이 시작되지 않았어요.<br/>첫 스팟에서 첫 컷을 남겨보세요.</div>`}

      <div class="cta-card">
        <div class="cta-eyebrow">AFTER YOUR TRIP</div>
        <div class="cta-title">이 기록이 영화가 됩니다</div>
        <p class="cta-desc">현상된 필름 사진과 이 여정 기록으로, 아날로그 홀리데이가 레트로 숏폼 영상을 만들어드려요.</p>
        <a href="https://analog-holiday-mall.vercel.app" target="_blank" rel="noopener">아날로그 홀리데이 보러가기 →</a>
      </div>
    </div>`;

  $view.querySelectorAll('[data-spot]').forEach((el) =>
    el.addEventListener('click', () => go(`spot/${el.dataset.spot}`)));
}

/* ═══ 한 컷 기록 시트 ═══ */
let pendingShotSpot = null;
function openShotSheet(spot) {
  if (state.shots.length >= ROLL_SIZE) {
    alert('롤을 모두 사용했어요! 🎉 여정 탭에서 기록을 확인해보세요.');
    return;
  }
  pendingShotSpot = spot;
  $('#shotSpotLabel').textContent = `${spot.emoji} ${spot.name} — ${state.shots.length + 1}번째 컷`;
  $('#shotNote').value = '';
  $('#shotSheet').hidden = false;
}
$('#shotCancel').addEventListener('click', () => { $('#shotSheet').hidden = true; });
$('#shotSheet').addEventListener('click', (e) => { if (e.target === $('#shotSheet')) $('#shotSheet').hidden = true; });
$('#shotSave').addEventListener('click', () => {
  if (!pendingShotSpot) return;
  state.shots.push({
    spotId: pendingShotSpot.id,
    note: $('#shotNote').value.trim(),
    at: new Date().toISOString(),
    lat: position?.lat ?? null,
    lng: position?.lng ?? null,
  });
  const newStamps = checkStamps();
  save();
  $('#shotSheet').hidden = true;
  updateRollChip();
  go('roll');
  if (newStamps.length > 0) showStampToast(newStamps[0]);
});

/* ═══ 여행 스탬프 (게이미피케이션) ═══ */
function journeyFacts() {
  const spotIds = [...new Set(state.shots.map((s) => s.spotId).filter(Boolean))];
  const cities = [...new Set(spotIds.map((id) => getSpotById(id)?.city).filter(Boolean))];
  return { spotIds, cities };
}

function checkStamps() {
  const { spotIds, cities } = journeyFacts();
  const earned = [];
  for (const st of STAMPS) {
    if (!state.stamps.includes(st.id) && st.check(state.shots, cities, spotIds)) {
      state.stamps.push(st.id);
      earned.push(st);
    }
  }
  return earned;
}

function showStampToast(stamp) {
  document.querySelector('.stamp-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'stamp-toast';
  el.innerHTML = `
    <span class="stamp-toast-emoji">${stamp.emoji}</span>
    <div class="stamp-toast-text">
      <span class="stamp-toast-title">여행 스탬프 획득!</span>
      <span class="stamp-toast-name">${esc(stamp.name)} — ${esc(stamp.desc)}</span>
    </div>`;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('leaving'), 3200);
  setTimeout(() => el.remove(), 3700);
}

/* ═══ 온보딩 ═══ */
function showOnboarding() {
  let pickedCam = state.camera;
  let pickedPersona = state.persona || 'hani';

  $('#cameraPick').innerHTML = Object.entries(CAMERAS).map(([id, c]) => `
    <button class="pick-card ${id === pickedCam ? 'selected' : ''}" data-cam="${id}">
      <b>${esc(c.name)}</b><span>${esc(c.trait)}</span>
    </button>`).join('');

  $('#personaPick').innerHTML = Object.entries(PERSONAS).map(([id, p]) => `
    <button class="persona-card ${id === pickedPersona ? 'selected' : ''}" data-persona="${id}">
      <span class="p-emoji">${p.emoji}</span><b>${p.name}</b><span>${p.role}</span>
    </button>`).join('');

  const doneBtn = $('#onboardDone');
  const refresh = () => { doneBtn.disabled = !pickedCam; };
  refresh();

  $('#cameraPick').querySelectorAll('[data-cam]').forEach((el) =>
    el.addEventListener('click', () => {
      pickedCam = el.dataset.cam;
      $('#cameraPick').querySelectorAll('.pick-card').forEach((c) => c.classList.toggle('selected', c === el));
      refresh();
    }));
  $('#personaPick').querySelectorAll('[data-persona]').forEach((el) =>
    el.addEventListener('click', () => {
      pickedPersona = el.dataset.persona;
      $('#personaPick').querySelectorAll('.persona-card').forEach((c) => c.classList.toggle('selected', c === el));
    }));

  doneBtn.onclick = () => {
    state.camera = pickedCam;
    state.persona = pickedPersona;
    save();
    $('#onboard').hidden = true;
    render();
  };
  $('#onboard').hidden = false;
}

/* ═══ 내비게이션 & 부팅 ═══ */
document.querySelectorAll('.bottomnav button').forEach((b) =>
  b.addEventListener('click', () => go(b.dataset.nav)));
$('#rollChip').addEventListener('click', () => go('roll'));

(async function boot() {
  render(); // 위치 없이 먼저 그리기 (빠른 첫 화면)
  if (!state.camera) showOnboarding();
  position = await locate();
  const route = location.hash.replace('#', '').split('/')[0] || 'now';
  if (route === 'now') renderNow(); // 위치 반영해 갱신
})();
