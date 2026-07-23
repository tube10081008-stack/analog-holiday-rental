/**
 * 알렉스 포스트프로덕션 대시보드
 * 아날로그 홀리데이 — 디자인팀 · 영상 제작 & 커뮤니티
 */
let adminKey = "";
let pipelineData = [];
let currentTab = "pipeline";
let currentAIMode = "shortform";
let alexThreadId = "";

function getOrCreatePersistentThreadId(storageKey, prefix) {
  const fallback = () => {
    if (window.crypto?.randomUUID) return `${prefix}_${window.crypto.randomUUID()}`;
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  };
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) return stored;
    const nextId = fallback();
    window.localStorage.setItem(storageKey, nextId);
    return nextId;
  } catch { return fallback(); }
}

/* ── 인증 ── */
document.addEventListener("DOMContentLoaded", () => {
  alexThreadId = getOrCreatePersistentThreadId("analog-holiday-alex-thread-id", "alex");

  const savedKey = window.sessionStorage.getItem("analog-holiday-admin-key");
  if (savedKey) {
    adminKey = savedKey;
    const input = document.getElementById("alexKeyInput");
    if (input) input.value = savedKey;
    loadDashboard();
  }

  document.getElementById("alexAuthForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    adminKey = document.getElementById("alexKeyInput").value.trim();
    if (!adminKey) return;
    window.sessionStorage.setItem("analog-holiday-admin-key", adminKey);
    await loadDashboard();
  });

  document.getElementById("alexRefresh")?.addEventListener("click", loadDashboard);
  document.getElementById("alexAIGenBtn")?.addEventListener("click", generateAI);
  document.getElementById("alexCommunityGenBtn")?.addEventListener("click", generateCommunity);

  // 탭 전환
  document.querySelectorAll(".alex-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // AI 모드 전환
  document.querySelectorAll(".alex-ai__mode").forEach((btn) => {
    btn.addEventListener("click", () => switchAIMode(btn.dataset.mode));
  });
});

/* ── 대시보드 로딩 ── */
async function loadDashboard() {
  const errEl = document.getElementById("alexAuthError");
  errEl.hidden = true;

  try {
    const res = await fetch("/api/alex?action=dashboard", { headers: { "x-admin-key": adminKey } });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "인증에 실패했습니다.";
      errEl.hidden = false;
      return;
    }

    document.getElementById("alexAuth").hidden = true;
    document.getElementById("alexDashboard").hidden = false;

    pipelineData = data.pipeline || [];
    renderSummary(data.stageCounts, data.totalInPipeline, data.stages);
    renderPipeline(data.pipeline, data.stages);
  } catch (err) {
    errEl.textContent = "서버 연결에 실패했습니다.";
    errEl.hidden = false;
  }
}

/* ── 요약 카드 ── */
function renderSummary(counts, total, stages) {
  const el = document.getElementById("alexSummary");
  el.innerHTML = `
    <div class="alex-summary__card alex-summary__card--total">
      <span class="alex-summary__icon">🎬</span>
      <div><strong>${total}</strong><span>전체 진행</span></div>
    </div>
    ${stages.map(s => `
      <div class="alex-summary__card" style="--stage-color: ${s.color}">
        <span class="alex-summary__icon">${s.icon}</span>
        <div><strong>${counts[s.id] || 0}</strong><span>${s.label}</span></div>
      </div>
    `).join("")}
  `;
}

/* ── 파이프라인 렌더링 ── */
function renderPipeline(items, stages) {
  const board = document.getElementById("alexPipelineBoard");

  if (!items || items.length === 0) {
    board.innerHTML = '<p class="alex-empty">현재 파이프라인에 진행 중인 항목이 없습니다.</p>';
    return;
  }

  // 칸반 스타일: 각 단계별 컬럼
  board.innerHTML = stages.map(stage => {
    const stageItems = items.filter(i => i.stage === stage.id);
    return `
      <div class="alex-kanban__column" style="--stage-color: ${stage.color}">
        <div class="alex-kanban__header">
          <span>${stage.icon} ${stage.label}</span>
          <span class="alex-kanban__count">${stageItems.length}</span>
        </div>
        <div class="alex-kanban__cards">
          ${stageItems.length === 0 
            ? '<p class="alex-kanban__empty">—</p>'
            : stageItems.map(item => `
              <div class="alex-kanban__card">
                <div class="alex-kanban__card-header">
                  <strong>${esc(item.name)}</strong>
                  <span class="alex-kanban__days">D+${item.daysSinceReturn}</span>
                </div>
                <div class="alex-kanban__card-body">
                  <span>📍 ${esc(item.destination)}</span>
                  <span>📸 ${esc(item.cameraId || "미배정")}</span>
                </div>
                ${item.mood ? `<p class="alex-kanban__mood">"${esc(item.mood)}"</p>` : ""}
              </div>
            `).join("")
          }
        </div>
      </div>
    `;
  }).join("");
}

/* ── 탭 전환 ── */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".alex-tab").forEach((el) => {
    el.classList.toggle("alex-tab--active", el.dataset.tab === tab);
  });
  document.getElementById("alexPipeline").hidden = tab !== "pipeline";
  document.getElementById("alexShortform").hidden = tab !== "shortform";
  document.getElementById("alexCommunity").hidden = tab !== "community";
}

/* ── AI 모드 전환 ── */
function switchAIMode(mode) {
  currentAIMode = mode;
  document.querySelectorAll(".alex-ai__mode").forEach((el) => {
    el.classList.toggle("alex-ai__mode--active", el.dataset.mode === mode);
  });
  const input = document.getElementById("alexAIInput");
  const placeholders = {
    shortform: "숏폼 기획 요청을 입력하세요...\n\n예시: '제주도 여행, 코닥 M35, 청춘영화 감성 → 15초 릴스 기획안'",
    delivery: "납품 메시지를 작성할 고객 정보를 입력하세요...\n\n예시: '홍지영 고객님, 제주도 여행, 오키오 카메라, 밤거리 감성'",
  };
  input.placeholder = placeholders[mode] || "";
}

/* ── AI 숏폼/납품 생성 ── */
async function generateAI() {
  const input = document.getElementById("alexAIInput");
  const prompt = input.value.trim();
  if (!prompt) return alert("프롬프트를 입력해 주세요!");

  const loader = document.getElementById("alexAILoader");
  const result = document.getElementById("alexAIResult");
  const btn = document.getElementById("alexAIGenBtn");

  loader.hidden = false;
  result.innerHTML = "";
  btn.disabled = true;

  try {
    const res = await fetch("/api/alex", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify({
        mode: currentAIMode,
        prompt,
        threadId: alexThreadId,
        includeData: document.getElementById("alexIncludeData")?.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || "오류가 발생했습니다.");
    result.innerHTML = renderMarkdown(data.result);
  } catch (err) {
    result.innerHTML = `<div class="alex-error">😅 ${esc(err.message)}</div>`;
  } finally {
    loader.hidden = true;
    btn.disabled = false;
  }
}

/* ── 커뮤니티 생성 ── */
async function generateCommunity() {
  const input = document.getElementById("alexCommunityInput");
  const prompt = input.value.trim();
  if (!prompt) return alert("프롬프트를 입력해 주세요!");

  const loader = document.getElementById("alexCommunityLoader");
  const result = document.getElementById("alexCommunityResult");
  const btn = document.getElementById("alexCommunityGenBtn");

  loader.hidden = false;
  result.innerHTML = "";
  btn.disabled = true;

  try {
    const res = await fetch("/api/alex", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify({
        mode: "community",
        prompt,
        threadId: alexThreadId,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || "오류가 발생했습니다.");
    result.innerHTML = renderMarkdown(data.result);
  } catch (err) {
    result.innerHTML = `<div class="alex-error">😅 ${esc(err.message)}</div>`;
  } finally {
    loader.hidden = true;
    btn.disabled = false;
  }
}

/* ── 마크다운 렌더링 ── */
function renderMarkdown(md) {
  let html = esc(md)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="alex-code"><code>$2</code></pre>')
    .replace(/^### (.+)$/gm, '<h4 class="alex-h4">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="alex-h3">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="alex-h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^[-*] (.+)$/gm, '<li class="alex-li">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="alex-li alex-li--ordered"><span class="alex-li__num">$1.</span> $2</li>')
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<div class="alex-result__content"><p>${html}</p></div>`;
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
