/**
 * 지오 물류 대시보드
 * 아날로그 홀리데이 — 물류팀 총괄 백오피스
 */
let adminKey = "";
let reservations = [];
let inventoryData = null;
let currentTab = "timeline";
let currentAIMode = "notification";
let geoThreadId = "";

function getOrCreatePersistentThreadId(storageKey, prefix) {
  const fallback = () => {
    if (window.crypto?.randomUUID) {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  };

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      return stored;
    }

    const nextId = fallback();
    window.localStorage.setItem(storageKey, nextId);
    return nextId;
  } catch {
    return fallback();
  }
}

const STATUS_LABELS = {
  upcoming: { label: "배송 대기", color: "#4c8a84", icon: "🗓️" },
  ship_ready: { label: "발송 준비", color: "#ef9d32", icon: "🚚" },
  shipped_out: { label: "발송 완료", color: "#3B82F6", icon: "📦" },
  delivered: { label: "고객 수령 완료", color: "#10B981", icon: "✅" },
  in_trip: { label: "여행 중", color: "#6c7bde", icon: "✈️" },
  return_due: { label: "반납 대기", color: "#e8853e", icon: "📮" },
  overdue: { label: "연체", color: "#b86051", icon: "⚠️" },
  pending: { label: "확인 필요", color: "#888", icon: "❓" },
};

/* ── 인증 ── */
document.addEventListener("DOMContentLoaded", () => {
  geoThreadId = getOrCreatePersistentThreadId("analog-holiday-geo-thread-id", "geo");
  const savedKey = window.sessionStorage.getItem("analog-holiday-admin-key");
  if (savedKey) {
    adminKey = savedKey;
    const input = document.getElementById("geoKeyInput");
    if (input) input.value = savedKey;
    loadDashboard();
  }

  document.getElementById("geoAuthForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    adminKey = document.getElementById("geoKeyInput").value.trim();
    if (!adminKey) return;
    window.sessionStorage.setItem("analog-holiday-admin-key", adminKey);
    await loadDashboard();
  });

  document.getElementById("geoRefresh")?.addEventListener("click", loadDashboard);
  document.getElementById("geoAIGenBtn")?.addEventListener("click", generateAI);

  // 탭 전환
  document.querySelectorAll(".geo-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // AI 모드 전환
  document.querySelectorAll(".geo-ai__mode").forEach((btn) => {
    btn.addEventListener("click", () => switchAIMode(btn.dataset.mode));
  });

  // 재고 동기화 (이벤트 위임)
  document.getElementById("geoInventory")?.addEventListener("click", (e) => {
    if (e.target.closest("#geoSyncInventory")) {
      syncInventoryFromUI();
    }
  });

  // Ctrl+Enter
  document.getElementById("geoAIInput")?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      generateAI();
    }
  });
});

async function syncInventoryFromUI() {
  const btn = document.getElementById("geoSyncInventory");
  if (!btn || btn.disabled) return;

  if (!confirm("⚠️ 재고 데이터를 DB 예약 기준으로 완전 재구축하시겠습니까?\n이 작업은 현재의 모든 카메라 홀딩 상태를 리셋하고 다시 계산합니다.")) {
    return;
  }

  btn.disabled = true;
  const originalText = btn.innerHTML;
  btn.innerHTML = "⏳ 동기화 중...";

  try {
    const res = await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sync",
        adminKey: adminKey
      })
    });
    
    const result = await res.json();
    if (res.ok && result.ok) {
      alert("✅ 재고 동기화 완료!\n" + result.message);
      await loadDashboard(); // 대시보드 새로고침
    } else {
      alert("❌ 동기화 실패: " + (result.message || "알 수 없는 오류"));
    }
  } catch (err) {
    alert("❌ 에러 발생: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

async function loadDashboard() {
  const errEl = document.getElementById("geoAuthError");
  errEl.hidden = true;

  try {
    const res = await fetch("/api/geo?action=dashboard", { headers: { "x-admin-key": adminKey } });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      errEl.textContent = data.message || "인증에 실패했습니다.";
      errEl.hidden = false;
      return;
    }

    reservations = data.reservations || [];
    inventoryData = data.inventory || null;
    document.getElementById("geoAuth").hidden = true;
    document.getElementById("geoDashboard").hidden = false;

    updateSummary(data.summary);
    renderInventory(inventoryData);
    renderTimeline();
  } catch (err) {
    errEl.textContent = "서버 연결에 실패했습니다.";
    errEl.hidden = false;
  }
}

/* ── 요약 업데이트 ── */
function updateSummary(s) {
  document.getElementById("geoTotal").textContent = s.total;
  document.getElementById("geoUpcoming").textContent = s.upcoming;
  document.getElementById("geoShipReady").textContent = s.ship_ready;
  const shippedOutEl = document.getElementById("geoShippedOut");
  if (shippedOutEl) shippedOutEl.textContent = s.shipped_out || 0;
  document.getElementById("geoInTrip").textContent = s.in_trip;
  document.getElementById("geoReturnDue").textContent = s.return_due;
  document.getElementById("geoOverdue").textContent = s.overdue;
}

/* ── 재고 현황 렌더링 ── */
function renderInventory(inv) {
  const el = document.getElementById("geoInventory");
  if (!el || !inv) return;

  const cameraRows = (inv.cameras || []).map((c) => {
    const isOut = c.totalStock - c.available > 0;
    const statusClass = isOut ? "geo-stock--out" : "geo-stock--ok";
    const statusText = isOut ? "🚀 외부 반출됨" : "📦 창고 보관중";
    const reservedInfo = c.reservations && c.reservations.length > 0
      ? c.reservations.map((r) => `${r.departure} ~ ${r.returnDate}`).join(", ")
      : "—";

    return `
      <tr>
        <td><strong>${esc(c.name)}</strong></td>
        <td class="${statusClass}">${statusText}</td>
        <td>${c.totalStock}대</td>
        <td>${c.totalReservations}건</td>
        <td class="geo-stock__reserved">${reservedInfo}</td>
      </tr>
    `;
  }).join("");

  el.innerHTML = `
    <div class="geo-section-header">
      <h3 class="geo-section-title">📦 카메라 재고 및 스케줄 현황</h3>
      <button class="geo-btn geo-btn--sync" id="geoSyncInventory" type="button">🔄 재고 풀 동기화</button>
    </div>
    <div class="geo-table-wrap">
      <table class="geo-table">
        <thead>
          <tr>
            <th>카메라</th>
            <th>현재 실물 상태</th>
            <th>총 보유 재고</th>
            <th>잡힌 예약 건수</th>
            <th>블락된 예약 기간</th>
          </tr>
        </thead>
        <tbody>${cameraRows}</tbody>
      </table>
    </div>
    
    <h3 class="geo-section-title" style="margin-top:24px;">🎒 여행 소품 박스 현황</h3>
    <div class="geo-table-wrap">
      <table class="geo-table">
        <thead>
          <tr>
            <th>소품 이름</th>
            <th>잔여 재고</th>
            <th>출고/반출량</th>
            <th>누적 예약 건수</th>
          </tr>
        </thead>
        <tbody>
          ${(inv.addToBox || []).map(b => {
             const warning = b.available <= (b.totalStock * 0.2) ? " geo-stock--out" : "";
             return `
              <tr>
                <td><strong>${esc(b.name)}</strong></td>
                <td class="${warning}">${b.available} / ${b.totalStock}개</td>
                <td>${b.currentlyRented}개</td>
                <td>${b.totalReservations}건</td>
              </tr>
             `;
          }).join("")}
        </tbody>
      </table>
    </div>

    <p class="geo-stock-summary">📌 <strong>총 ${inv.totalCameraTypes}종</strong>의 카메라와 소품 박스가 활발히 운영되고 있습니다.</p>
  `;
}

/* ── 탭 전환 ── */
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".geo-tab").forEach((el) => {
    el.classList.toggle("geo-tab--active", el.dataset.tab === tab);
  });
  document.getElementById("geoTimeline").hidden = tab !== "timeline";
  document.getElementById("geoAI").hidden = tab !== "ai";
}

/* ── AI 모드 전환 ── */
function switchAIMode(mode) {
  currentAIMode = mode;
  document.querySelectorAll(".geo-ai__mode").forEach((el) => {
    el.classList.toggle("geo-ai__mode--active", el.dataset.mode === mode);
  });
  const input = document.getElementById("geoAIInput");
  const placeholders = {
    notification: "알림톡을 작성할 대상과 종류를 입력하세요.\n\n예: '이번 주 출국 예정 고객들에게 배송 출발 알림톡'",
    schedule: "스케줄 최적화가 필요한 기간이나 조건을 입력하세요.\n\n예: '5월 첫째 주 배송 스케줄 최적화'",
    analysis: "분석이 필요한 항목을 입력하세요.\n\n예: '이번 달 물류 현황 요약 및 병목 구간 분석'",
  };
  input.placeholder = placeholders[mode] || "";
}

/* ── 타임라인 렌더링 ── */
function renderTimeline() {
  const container = document.getElementById("geoTimelineList");

  if (reservations.length === 0) {
    container.innerHTML = '<p class="geo-timeline__empty">아직 예약이 없습니다.</p>';
    return;
  }

  // 상태 우선순위로 정렬: overdue > return_due > delivered > shipped_out > ship_ready > in_trip > upcoming
  const priority = { overdue: 0, return_due: 1, delivered: 2, shipped_out: 3, ship_ready: 4, in_trip: 5, upcoming: 6, pending: 7 };
  const sorted = [...reservations].sort(
    (a, b) => (priority[a.logistics?.status] ?? 9) - (priority[b.logistics?.status] ?? 9),
  );

  container.innerHTML = sorted.map((r) => {
    const lg = r.logistics || {};
    const st = STATUS_LABELS[lg.status] || STATUS_LABELS.pending;

    let trackingInfo = "";
    if (lg.trackingNumber) {
      trackingInfo = `<div style="margin-top:4px"><span class="geo-card__label" style="color:var(--color-brand)">송장 번호</span> <strong style="color:var(--color-brand)">${esc(lg.trackingNumber)}</strong><br><span style="font-size:0.85em; color:#666;">(접수: ${r.trackingUpdatedAt ? new Date(r.trackingUpdatedAt).toLocaleString('ko-KR', { hour12: false }) : '기록없음'})</span></div>`;
    } else if (lg.status === "ship_ready" || lg.status === "upcoming") {
      const nowIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      trackingInfo = `
        <div style="margin-top: 8px; display:flex; flex-direction:column; gap: 4px; background:#f9fafb; padding:6px; border-radius:6px; border:1px solid #eaeaea;">
          <label style="font-size:0.8em; color:#555; font-weight:bold;">📮 운송장 및 실제 접수 시간 등록</label>
          <input type="text" id="track_${r.id}" placeholder="송장번호 직접 입력" style="padding:6px; font-size:0.85em; border:1px solid #ddd; border-radius:4px" />
          <div style="display:flex; gap: 4px;">
            <input type="datetime-local" id="track_time_${r.id}" value="${nowIso}" style="flex:1; padding:4px 6px; font-size:0.85em; border:1px solid #ddd; border-radius:4px" title="우체국 실제 접수 시간" />
            <button class="geo-btn geo-btn--sm" onclick="saveTracking('${r.id}')" style="padding:4px 12px; font-size:0.85em; background:#3B82F6; color:#fff; border:none; border-radius:4px; font-weight:600; cursor:pointer;">발송 완료</button>
          </div>
        </div>
      `;
    }

    const scheduleInfo = lg.error
      ? `<span class="geo-card__info-muted">${esc(lg.raw || "일정 파싱 불가")}</span>`
      : `
        <div class="geo-card__schedule">
          <div><span class="geo-card__label">출국</span> ${esc(lg.departure)}</div>
          <div><span class="geo-card__label">귀국</span> ${esc(lg.returnDate)}</div>
          <div><span class="geo-card__label">배송일</span> ${esc(lg.shipDate)}</div>
          <div><span class="geo-card__label">반납기한</span> ${esc(lg.returnDeadline)}</div>
          ${trackingInfo}
        </div>
      `;

    const daysInfo = lg.daysUntilDeparture != null
      ? `<span class="geo-card__days">${lg.daysUntilDeparture > 0 ? `D-${lg.daysUntilDeparture}` : lg.daysUntilReturn > 0 ? `여행 중 (귀국 D-${lg.daysUntilReturn})` : "귀국 완료"}</span>`
      : "";

    return `
      <article class="geo-card" style="--status-color: ${st.color}">
        <div class="geo-card__header">
          <div class="geo-card__status-badge" style="background: ${st.color}">${st.icon} ${st.label}</div>
          ${daysInfo}
        </div>
        <div class="geo-card__body">
          <div class="geo-card__customer">
            <strong>${esc(r.name)}</strong>
            <span class="geo-card__dest">📍 ${esc(r.destination)}</span>
          </div>
          <div class="geo-card__camera" style="margin-top: 4px; font-size: 0.9em; color: var(--color-brand);">
            📸 배정된 카메라: <strong>${esc(r.cameraId || r.mood || "미선택")}</strong>
          </div>
          ${scheduleInfo}
          <div class="geo-card__meta">
            <span>📧 ${esc(r.email)}</span>
            <span>📞 ${esc(r.phone)}</span>
          </div>
        </div>
        <div class="geo-card__actions">
          <button class="geo-btn geo-btn--sm" onclick="quickNotification('${esc(r.name)}', '${esc(r.schedule)}', '${esc(r.destination)}', '${lg.status}')">📱 알림톡</button>
        </div>
      </article>
    `;
  }).join("");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ── 운송장 번호 등록 ── */
async function saveTracking(id) {
  const inputEl = document.getElementById(`track_${id}`);
  const timeEl = document.getElementById(`track_time_${id}`);
  const btnEl = timeEl ? timeEl.nextElementSibling : null;
  const trackingNumber = inputEl ? inputEl.value.trim() : "";
  const trackingTime = timeEl ? timeEl.value : "";
  
  if (!trackingNumber) {
    alert("송장번호를 입력해주세요.");
    return;
  }
  if (!trackingTime) {
    alert("실제 우체국 접수 시간을 입력해주세요.");
    return;
  }

  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = "저장 중...";
  }

  try {
    const res = await fetch("/api/geo?action=update_tracking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminKey}`,
      },
      body: JSON.stringify({ id, trackingNumber, trackingTime }),
    });

    const data = await res.json();
    if (data.ok) {
      alert("운송장이 등록되었습니다. (상태가 발송 완료로 변경됩니다)");
      await fetchDashboard();
    } else {
      alert("등록 실패: " + data.message);
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = "발송 완료"; }
    }
  } catch (e) {
    console.error(e);
    alert("서버 연결에 실패했습니다.");
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = "발송 완료"; }
  }
}

/* ── 빠른 알림톡 생성 ── */
function quickNotification(name, schedule, destination, status) {
  switchTab("ai");
  switchAIMode("notification");

  const typeMap = {
    upcoming: "배송 출발 알림톡",
    ship_ready: "배송 출발 알림톡 (송장번호 포함)",
    in_trip: "여행 중 안부 메시지",
    return_due: "반납 안내 알림톡",
    overdue: "반납 독촉 알림톡 (정중하게)",
  };
  const type = typeMap[status] || "예약 확인 알림톡";

  document.getElementById("geoAIInput").value =
    `${name} 고객님에게 ${type}을 작성해줘.\n\n여행 일정: ${schedule}\n여행지: ${destination}`;
  document.getElementById("geoAIInput").focus();
}

/* ── AI 생성 ── */
async function generateAI() {
  const prompt = document.getElementById("geoAIInput").value.trim();
  if (!prompt) return;

  const resultEl = document.getElementById("geoAIResult");
  const loader = document.getElementById("geoAILoader");
  const btn = document.getElementById("geoAIGenBtn");

  btn.disabled = true;
  loader.hidden = false;
  resultEl.innerHTML = "";

  const includeData = document.getElementById("geoIncludeData").checked;

  try {
    const res = await fetch("/api/geo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: currentAIMode,
        prompt,
        threadId: geoThreadId,
        adminKey,
        reservationData: includeData ? reservations.slice(0, 20) : undefined,
        inventoryData: includeData ? inventoryData : undefined,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || "오류 발생");

    renderAIResult(data.result);
  } catch (err) {
    resultEl.innerHTML = `<div class="geo-error">😅 ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    loader.hidden = true;
  }
}

function renderAIResult(md) {
  const el = document.getElementById("geoAIResult");
  let html = esc(md)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="geo-code"><code>$2</code></pre>')
    .replace(/^### (.+)$/gm, '<h4 class="geo-h4">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="geo-h3">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="geo-h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");

  el.innerHTML = `
    <div class="geo-ai__content"><p>${html}</p></div>
    <div class="geo-ai__result-actions">
      <button class="geo-btn geo-btn--secondary" onclick="copyGeoResult()">📋 복사</button>
    </div>
  `;
}

function copyGeoResult() {
  const text = document.querySelector(".geo-ai__content")?.innerText || "";
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector(".geo-ai__result-actions button");
    if (btn) { btn.textContent = "✅ 복사됨!"; setTimeout(() => { btn.textContent = "📋 복사"; }, 1500); }
  });
}
