const adminAuthForm = document.getElementById("adminAuthForm");
const adminKeyInput = document.getElementById("adminKeyInput");
const adminRefreshButton = document.getElementById("adminRefreshButton");
const adminMigrateButton = document.getElementById("adminMigrateButton");
const adminStatus = document.getElementById("adminStatus");
const adminSummary = document.getElementById("adminSummary");
const reservationCount = document.getElementById("reservationCount");
const storageMode = document.getElementById("storageMode");
const mailMode = document.getElementById("mailMode");
const reservationList = document.getElementById("reservationList");
const reservationCardTemplate = document.getElementById("reservationCardTemplate");
let currentStorageMode = "";

const ADMIN_STORAGE_KEY = "analog-holiday-admin-key";

function setStatus(message, tone = "default") {
  if (!adminStatus) {
    return;
  }

  adminStatus.textContent = message;
  adminStatus.dataset.tone = tone;
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getAdminKey() {
  const value = adminKeyInput?.value?.trim();
  if (value) return value;
  return window.sessionStorage.getItem(ADMIN_STORAGE_KEY) || "";
}

function isExampleAdminKey(value) {
  return value === "change-this-admin-key";
}

function persistAdminKey(value) {
  if (!value) {
    window.sessionStorage.removeItem(ADMIN_STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(ADMIN_STORAGE_KEY, value);
}

function renderReservations(items = []) {
  if (!reservationList || !reservationCardTemplate) {
    return;
  }

  reservationList.innerHTML = "";

  if (items.length === 0) {
    reservationList.innerHTML = `
      <article class="admin-empty-state">
        <strong>아직 등록된 예약이 없습니다.</strong>
        <p>퀵 렌탈 예약이 접수되면 이곳에서 바로 확인할 수 있습니다.</p>
      </article>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const node = reservationCardTemplate.content.cloneNode(true);
    const card = node.querySelector(".admin-reservation-card");
    const name = node.querySelector(".admin-reservation-card__name");
    const service = node.querySelector(".admin-reservation-card__service");
    const deleteButton = node.querySelector(".admin-reservation-card__delete");

    service.textContent = item.service || "퀵 렌탈 예약";
    name.textContent = item.name || "이름 미입력";

    node.querySelector('[data-field="id"]').textContent = item.id || "-";
    node.querySelector('[data-field="createdAt"]').textContent = formatDate(item.createdAt);
    node.querySelector('[data-field="email"]').textContent = item.email || "-";
    node.querySelector('[data-field="phone"]').textContent = item.phone || "-";
    node.querySelector('[data-field="schedule"]').textContent = item.schedule || "-";
    node.querySelector('[data-field="destination"]').textContent = item.destination || "-";
    node.querySelector('[data-field="mood"]').textContent = item.mood || "-";

    deleteButton?.addEventListener("click", async () => {
      const confirmed = window.confirm(`${item.name || "이 예약"}을 삭제할까요?`);

      if (!confirmed) {
        return;
      }

      deleteButton.disabled = true;
      deleteButton.textContent = "삭제 중...";

      try {
        const response = await fetch("/api/reservations", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-admin-key": getAdminKey(),
          },
          body: JSON.stringify({
            id: item.id,
            blobPathname: item.blobPathname || "",
          }),
        });

        const payload = await response.json();

        if (!response.ok || !payload.ok) {
          throw new Error(payload.message || "예약 삭제에 실패했습니다.");
        }

        setStatus("예약을 삭제했습니다.", "success");
        await loadReservations();
      } catch (error) {
        deleteButton.disabled = false;
        deleteButton.textContent = "삭제";
        setStatus(error.message || "예약 삭제에 실패했습니다.", "error");
      }
    });

    fragment.appendChild(card);
  });

  reservationList.appendChild(fragment);
}

async function loadReservations() {
  const key = getAdminKey();

  if (!key) {
    setStatus("관리자 키를 입력해 주세요.", "error");
    return;
  }

  if (isExampleAdminKey(key)) {
    setStatus("`change-this-admin-key`는 예시 문구입니다. 실제 운영용 관리자 키를 입력해 주세요.", "error");
    return;
  }

  persistAdminKey(key);
  setStatus("예약 데이터를 불러오는 중입니다...", "loading");

  try {
    const response = await fetch("/api/reservations", {
      headers: {
        "x-admin-key": key,
      },
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "예약 데이터를 불러오지 못했습니다.");
    }

    reservationCount.textContent = String(payload.reservations.length);
    storageMode.textContent = payload.storageMode || "-";
    mailMode.textContent = payload.mailMode || "-";
    currentStorageMode = payload.storageMode || "";
    adminSummary.hidden = false;
    renderReservations(payload.reservations);
    setStatus("예약 데이터를 최신 상태로 불러왔습니다.", "success");
  } catch (error) {
    adminSummary.hidden = true;
    renderReservations([]);
    setStatus(error.message || "예약 데이터를 불러오지 못했습니다.", "error");
  }
}

adminAuthForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  await loadReservations();
});

adminRefreshButton?.addEventListener("click", async () => {
  await loadReservations();
});

adminMigrateButton?.addEventListener("click", async () => {
  const key = getAdminKey();

  if (!key) {
    setStatus("먼저 관리자 키를 입력해 주세요.", "error");
    return;
  }

  if (isExampleAdminKey(key)) {
    setStatus("예시 키가 아니라 실제 관리자 키가 필요합니다.", "error");
    return;
  }

  if (!window.confirm("기존 Blob 예약 데이터를 Postgres로 이전할까요?")) {
    return;
  }

  adminMigrateButton.disabled = true;
  adminMigrateButton.textContent = "이전 중...";
  setStatus("Postgres로 예약 데이터를 이전하는 중입니다...", "loading");

  try {
    const response = await fetch("/api/reservations", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": key,
      },
      body: JSON.stringify({
        action: "migrate-to-postgres",
      }),
    });

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || "Postgres 이전에 실패했습니다.");
    }

    setStatus(
      `이전 완료: ${payload.migration.migrated}건 이동, ${payload.migration.skipped}건 건너뜀`,
      "success",
    );
    await loadReservations();
  } catch (error) {
    setStatus(error.message || "Postgres 이전에 실패했습니다.", "error");
  } finally {
    adminMigrateButton.disabled = false;
    adminMigrateButton.textContent = "Postgres 이전";
  }
});

const savedKey = window.sessionStorage.getItem(ADMIN_STORAGE_KEY);

if (savedKey && adminKeyInput) {
  adminKeyInput.value = savedKey;
  loadReservations();
}

/* ── 에이전트 카드 네비게이션 및 채팅 로직 ── */

const AGENT_CONFIG = {
  geo: { name: "지오 (물류/스케줄)", icon: "📦", url: "./geo.html" },
  noah: { name: "노아 (마케팅/SNS)", icon: "📈", url: "./noah.html" },
  hani: { name: "하니 (마케팅 사원)", icon: "🎨", url: null },
  alex: { name: "알렉스 (디자인/영상)", icon: "🎬", url: "./alex.html" },
  lina: { name: "리나 (CS/예약관리)", icon: "📋", url: "#reservationSection" }
};

const chatModal = document.getElementById("chatModal");
const chatMessages = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSender = document.getElementById("chatSender");
const closeChatModal = document.getElementById("closeChatModal");
const chatModalTitle = document.getElementById("chatModalTitle");
const chatModalIcon = document.getElementById("chatModalIcon");

let activeAgentId = null;

// 발신자 선택 기억
const SENDER_STORAGE_KEY = "analog-holiday-sender";
const savedSender = window.sessionStorage.getItem(SENDER_STORAGE_KEY);
if (savedSender && chatSender) {
  chatSender.value = savedSender;
}
chatSender?.addEventListener("change", () => {
  window.sessionStorage.setItem(SENDER_STORAGE_KEY, chatSender.value);
});

// 카드 클릭 시 네비게이션 (채팅 버튼 제외)
document.querySelectorAll(".admin-hub-card").forEach(card => {
  card.addEventListener("click", (e) => {
    // 채팅/두뇌 버튼 클릭 시에는 페이지 이동 방지
    if (e.target.closest(".admin-hub-card__chat-btn") || e.target.closest(".admin-hub-card__brain-btn")) return;
    
    const agentId = card.dataset.agent;
    const config = AGENT_CONFIG[agentId];
    if (config && config.url) {
      if (config.url.startsWith("#")) {
        document.querySelector(config.url)?.scrollIntoView({ behavior: "smooth" });
      } else {
        window.location.href = config.url;
      }
    }
  });
});

// 채팅 버튼 클릭 시 모달 열기
document.querySelectorAll(".admin-hub-card__chat-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const agentId = btn.dataset.agent;
    await openChat(agentId);
  });
});

async function openChat(agentId) {
  const config = AGENT_CONFIG[agentId];
  if (!config) return;

  activeAgentId = agentId;
  chatModalTitle.textContent = config.name;
  chatModalIcon.textContent = config.icon;
  chatMessages.innerHTML = '<div class="admin-status">대화 기록을 불러오는 중...</div>';
  chatModal.hidden = false;

  if (chatInput) {
    chatInput.value = "";
    chatInput.style.height = "46px"; // 모달을 새로 열 때 입력창 높이 초기화
  }

  await loadChatHistory(agentId);
}

async function loadChatHistory(agentId) {
  const key = getAdminKey();
  try {
    const res = await fetch(`/api/agent-chat?agentId=${agentId}`, { headers: { "x-admin-key": key } });
    const data = await res.json();
    
    chatMessages.innerHTML = "";
    
    if (data.ok && data.history && data.history.length > 0) {
      data.history.forEach(item => {
        const role = item.role === 'model' ? 'agent' : 'user';
        const senderLabel = item.role === 'user' && item.senderName ? `${item.senderName} 대표` : null;
        appendMessage(role, item.content, item.createdAt, senderLabel);
      });
    } else {
      appendMessage("agent", `안녕하세요, 대표님! ${AGENT_CONFIG[agentId].name}입니다. 무엇을 도와드릴까요?`);
    }
  } catch (err) {
    chatMessages.innerHTML = '<div class="admin-status">이력을 불러오지 못했습니다.</div>';
  }
}

function appendMessage(role, content, timestamp, senderLabel) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;
  
  // 타임스탬프: DB에서 온 원본이 있으면 그것을 사용, 없으면 현재 시각
  let timeStr;
  if (timestamp) {
    const d = new Date(timestamp);
    timeStr = d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
  } else {
    timeStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  }

  const senderTag = senderLabel ? `<span class="chat-bubble__sender">${senderLabel}</span> ` : '';
  
  // 경량 마크다운 → HTML 변환
  const rendered = renderMarkdown(content);

  bubble.innerHTML = `
    ${senderTag}
    <div class="chat-bubble__content">${rendered}</div>
    <small class="chat-bubble__time">${timeStr}</small>
  `;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/** 경량 마크다운 파서 (XSS 안전) */
function renderMarkdown(text) {
  // 1. HTML 특수문자 이스케이프 (XSS 방지)
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. 제목 (###, ##, #)
  html = html.replace(/^### (.+)$/gm, '<strong style="font-size:1.05em;display:block;margin:0.6em 0 0.3em">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:1.1em;display:block;margin:0.7em 0 0.3em">$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong style="font-size:1.15em;display:block;margin:0.8em 0 0.4em">$1</strong>');

  // 3. 볼드 **text** 또는 __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // 4. 이탤릭 *text* 또는 _text_ (볼드 처리 후)
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // 5. 인라인 코드 `code`
  html = html.replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,0.06);padding:0.15em 0.4em;border-radius:4px;font-size:0.9em">$1</code>');

  // 6. 구분선 ---
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid rgba(0,0,0,0.1);margin:0.8em 0">');

  // 7. 불릿 목록 (- 또는 * 로 시작)
  html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin-left:1.2em;list-style:disc">$1</li>');

  // 8. 줄바꿈
  html = html.replace(/\n/g, '<br>');

  // 9. 연속된 <li>를 <ul>로 감싸기
  html = html.replace(/((?:<li[^>]*>.*?<\/li><br>?)+)/g, (match) => {
    return '<ul style="margin:0.3em 0;padding-left:0.5em">' + match.replace(/<br>/g, '') + '</ul>';
  });

  return html;
}

// textarea 높이 자동 조절 및 Shift+Enter 처리
chatInput?.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = (chatInput.scrollHeight) + "px";
});

chatInput?.addEventListener("keydown", (e) => {
  if (e.isComposing) return; // 한글 입력 시 중복 전송 방지
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    chatForm.dispatchEvent(new Event("submit"));
  }
});

chatForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  const key = getAdminKey();
  const senderName = chatSender?.value || '';
  
  if (!text || !activeAgentId) return;
  
  if (!key) {
    appendMessage("agent", "관리자 인증 키를 찾을 수 없습니다. 페이지를 새로고침하거나 키를 다시 입력해 주세요.");
    return;
  }

  appendMessage("user", text, null, senderName ? `${senderName} 대표` : null);
  chatInput.value = "";
  chatInput.style.height = "46px"; // 전송 후 높이 초기화
  chatInput.disabled = true;

  try {
    const res = await fetch("/api/agent-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: activeAgentId, message: text, key, senderName })
    });
    const data = await res.json();
    if (data.ok) {
      appendMessage("agent", data.reply);
    } else {
      appendMessage("agent", "죄송합니다. 오류가 발생했어요: " + data.message);
    }
  } catch (err) {
    appendMessage("agent", "서버와 통신할 수 없습니다.");
  } finally {
    chatInput.disabled = false;
    chatInput.focus();
  }
});

closeChatModal?.addEventListener("click", () => {
  chatModal.hidden = true;
  activeAgentId = null;
});

window.addEventListener("click", (e) => {
  if (e.target === chatModal) {
    chatModal.hidden = true;
    activeAgentId = null;
  }
  if (e.target === brainModal) {
    brainModal.hidden = true;
  }
});

/* ══════════════════════════════════════════════
   🧠 Brain Dashboard — 에이전트 기억 관리 UI
   ══════════════════════════════════════════════ */

const brainModal = document.getElementById("brainModal");
const brainModalTitle = document.getElementById("brainModalTitle");
const brainModalIcon = document.getElementById("brainModalIcon");
const brainMemoryCount = document.getElementById("brainMemoryCount");
const brainMemoryList = document.getElementById("brainMemoryList");
const closeBrainModal = document.getElementById("closeBrainModal");
const brainAddBtn = document.getElementById("brainAddBtn");

let activeBrainAgent = null;

const TYPE_LABELS = {
  directive: "📌 지시",
  fact: "📋 지식",
  preference: "💡 선호",
  lesson: "⚠️ 교훈",
  context: "🌐 맥락",
};

// 🧠 버튼 클릭 → 두뇌 모달 열기
document.querySelectorAll(".admin-hub-card__brain-btn").forEach(btn => {
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const agentId = btn.dataset.agent;
    await openBrainDashboard(agentId);
  });
});

async function openBrainDashboard(agentId) {
  const config = AGENT_CONFIG[agentId];
  if (!config) return;

  activeBrainAgent = agentId;
  brainModalTitle.textContent = `${config.name} — 두뇌`;
  brainModalIcon.textContent = "🧠";
  brainMemoryList.innerHTML = '<div class="brain-loading">기억을 불러오는 중...</div>';
  brainModal.hidden = false;

  await loadBrainMemories(agentId);
}

async function loadBrainMemories(agentId) {
  const key = getAdminKey();
  try {
    const res = await fetch(`/api/agent-brain?action=memories&agentId=${agentId}`, { headers: { "x-admin-key": key } });
    const data = await res.json();

    brainMemoryList.innerHTML = "";

    if (!data.ok || !data.memories || data.memories.length === 0) {
      brainMemoryList.innerHTML = '<div class="brain-empty">아직 저장된 기억이 없습니다. 대화하면서 자동으로 쌓이거나, 위에서 직접 추가하세요!</div>';
      brainMemoryCount.textContent = "0개 기억";
      return;
    }

    const active = data.memories.filter(m => !m.is_archived);
    const archived = data.memories.filter(m => m.is_archived);

    brainMemoryCount.textContent = `${active.length}개 기억`;

    active.forEach(m => brainMemoryList.appendChild(createMemoryCard(m)));

    if (archived.length > 0) {
      const divider = document.createElement("div");
      divider.className = "brain-archive-divider";
      divider.innerHTML = `<span>🗄️ 아카이브 (${archived.length}개)</span>`;
      divider.style.cursor = "pointer";
      
      const archiveList = document.createElement("div");
      archiveList.className = "brain-archive-list";
      archiveList.hidden = true;
      archived.forEach(m => archiveList.appendChild(createMemoryCard(m, true)));

      divider.addEventListener("click", () => {
        archiveList.hidden = !archiveList.hidden;
        divider.innerHTML = `<span>🗄️ 아카이브 (${archived.length}개) ${archiveList.hidden ? '▶' : '▼'}</span>`;
      });

      brainMemoryList.appendChild(divider);
      brainMemoryList.appendChild(archiveList);
    }
  } catch (err) {
    brainMemoryList.innerHTML = '<div class="brain-empty">기억을 불러오지 못했습니다.</div>';
  }
}

function createMemoryCard(memory, isArchived = false) {
  const card = document.createElement("div");
  card.className = `brain-memory-card${isArchived ? ' brain-memory-card--archived' : ''}`;

  const typeLabel = TYPE_LABELS[memory.memory_type] || "📋 기타";
  const impStars = "★".repeat(Math.min(memory.importance, 5)) + "☆".repeat(Math.max(0, 5 - memory.importance));
  const dateStr = memory.created_at
    ? new Date(memory.created_at).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
    : '';
  const accessStr = memory.access_count > 0 ? `참조 ${memory.access_count}회` : '';

  card.innerHTML = `
    <div class="brain-memory-card__top">
      <span class="brain-memory-card__type">${typeLabel}</span>
      <span class="brain-memory-card__importance" title="중요도 ${memory.importance}/10">${impStars}</span>
    </div>
    <h4 class="brain-memory-card__title">${escapeHtml(memory.title)}</h4>
    <p class="brain-memory-card__content">${escapeHtml(memory.content)}</p>
    <div class="brain-memory-card__footer">
      <span class="brain-memory-card__meta">${dateStr} ${accessStr}</span>
      <div class="brain-memory-card__actions">
        <button class="brain-btn--archive" data-id="${memory.id}" title="${isArchived ? '복원' : '아카이브'}">${isArchived ? '♻️' : '🗄️'}</button>
        <button class="brain-btn--delete" data-id="${memory.id}" title="삭제">🗑️</button>
      </div>
    </div>
  `;

  // 이벤트 바인딩
  card.querySelector(".brain-btn--archive").addEventListener("click", () => archiveMemory(memory.id));
  card.querySelector(".brain-btn--delete").addEventListener("click", () => deleteMemory(memory.id));

  return card;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function archiveMemory(memoryId) {
  const key = getAdminKey();
  try {
    await fetch("/api/agent-brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archiveMemory", memoryId, key }),
    });
    await loadBrainMemories(activeBrainAgent);
  } catch (err) {
    console.error("Archive failed:", err);
  }
}

async function deleteMemory(memoryId) {
  if (!confirm("이 기억을 영구 삭제하시겠습니까?")) return;
  const key = getAdminKey();
  try {
    await fetch("/api/agent-brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteMemory", memoryId, key }),
    });
    await loadBrainMemories(activeBrainAgent);
  } catch (err) {
    console.error("Delete failed:", err);
  }
}

// 기억 추가
brainAddBtn?.addEventListener("click", async () => {
  const title = document.getElementById("brainNewTitle")?.value?.trim();
  const content = document.getElementById("brainNewContent")?.value?.trim();
  const memType = document.getElementById("brainNewType")?.value || "directive";
  const key = getAdminKey();

  if (!title || !content) {
    alert("제목과 내용을 모두 입력해주세요.");
    return;
  }

  brainAddBtn.disabled = true;
  brainAddBtn.textContent = "저장 중...";

  try {
    const res = await fetch("/api/agent-brain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "addMemory",
        agentId: activeBrainAgent,
        memory_type: memType,
        title,
        content,
        importance: memType === "directive" ? 9 : 6,
        tags: [],
        key,
      }),
    });

    const data = await res.json();
    if (data.ok) {
      document.getElementById("brainNewTitle").value = "";
      document.getElementById("brainNewContent").value = "";
      await loadBrainMemories(activeBrainAgent);
    } else {
      alert("저장 실패: " + data.message);
    }
  } catch (err) {
    alert("서버 오류: " + err.message);
  } finally {
    brainAddBtn.disabled = false;
    brainAddBtn.textContent = "➕ 기억 추가";
  }
});

closeBrainModal?.addEventListener("click", () => {
  brainModal.hidden = true;
  activeBrainAgent = null;
});
