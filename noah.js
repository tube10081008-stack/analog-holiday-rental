/**
 * 노아 마케팅 대시보드
 * 아날로그 홀리데이 — 마케팅팀 콘텐츠 & 분석
 */
const NOAH_MODES = [
  {
    id: "sentiment",
    icon: "📊",
    label: "감성 분석",
    desc: "고객 리뷰 · 행동 데이터 분석",
    placeholder:
      '분석할 고객 리뷰 데이터를 붙여넣어 주세요.\n\n예시:\n"필름 감성 너무 좋아요! 다음에도 꼭 빌릴게요"\n"배송이 좀 늦었어요. 출국 전날 받아서 걱정했어요"\n"숏폼 영상 퀄리티가 상상 이상이에요 😍"',
  },
  {
    id: "sns",
    icon: "📱",
    label: "SNS 콘텐츠",
    desc: "인스타 · 틱톡 · 홍보 문구",
    placeholder:
      '어떤 SNS 콘텐츠가 필요한지 알려주세요.\n\n예시:\n"올인원 패키지 출시 기념 인스타 캐러셀 5장"\n"여름 시즌 릴스 스크립트 15초"\n"코닥 M35 카메라 소개 포스트"',
  },
  {
    id: "seo",
    icon: "🔍",
    label: "SEO 최적화",
    desc: "메타 태그 · 제품 설명 · 키워드",
    placeholder:
      'SEO 최적화가 필요한 페이지나 제품을 알려주세요.\n\n예시:\n"메인 랜딩 페이지 메타 태그 + 본문 SEO"\n"올인원 패키지 상세 페이지 SEO"\n"야시카 MF-1 카메라 제품 설명"',
  },
  {
    id: "email",
    icon: "✉️",
    label: "이메일 캠페인",
    desc: "뉴스레터 · 프로모션 · 리텐션",
    placeholder:
      '이메일 캠페인 목적과 타깃을 알려주세요.\n\n예시:\n"신규 가입자 환영 이메일"\n"여름 휴가 시즌 프로모션 메일"\n"30일 이상 미접속 고객 리텐션 캠페인"',
  },
];

let currentMode = "sentiment";
let isGenerating = false;
let noahThreadId = "";

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

/* ── DOM 생성 ── */
function buildDashboard() {
  const tabs = document.getElementById("noahTabs");
  const textarea = document.getElementById("noahPrompt");

  NOAH_MODES.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "noah-tab" + (m.id === currentMode ? " noah-tab--active" : "");
    btn.type = "button";
    btn.dataset.mode = m.id;
    btn.innerHTML = `
      <span class="noah-tab__icon">${m.icon}</span>
      <span class="noah-tab__label">${m.label}</span>
      <span class="noah-tab__desc">${m.desc}</span>
    `;
    btn.addEventListener("click", () => switchMode(m.id));
    tabs.appendChild(btn);
  });

  textarea.placeholder = NOAH_MODES[0].placeholder;
}

function switchMode(modeId) {
  currentMode = modeId;
  const mode = NOAH_MODES.find((m) => m.id === modeId);

  document.querySelectorAll(".noah-tab").forEach((el) => {
    el.classList.toggle("noah-tab--active", el.dataset.mode === modeId);
  });

  document.getElementById("noahPrompt").placeholder = mode.placeholder;
  document.getElementById("noahModeLabel").textContent = `${mode.icon} ${mode.label}`;
}

/* ── API 호출 ── */
async function generate() {
  if (isGenerating) return;

  const prompt = document.getElementById("noahPrompt").value.trim();
  if (!prompt) {
    showToast("프롬프트를 입력해 주세요!");
    return;
  }

  const resultArea = document.getElementById("noahResult");
  const btn = document.getElementById("noahGenBtn");
  const loader = document.getElementById("noahLoader");

  isGenerating = true;
  btn.disabled = true;
  loader.hidden = false;
  resultArea.innerHTML = "";

  try {
    const res = await fetch("/api/noah", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: currentMode, prompt, threadId: noahThreadId }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      throw new Error(data.message || "오류가 발생했습니다.");
    }

    renderResult(data.result);
  } catch (err) {
    resultArea.innerHTML = `<div class="noah-error">😅 ${escapeHtml(err.message)}</div>`;
  } finally {
    isGenerating = false;
    btn.disabled = false;
    loader.hidden = true;
  }
}

/* ── 결과 렌더링 (마크다운 → HTML) ── */
function renderResult(md) {
  const el = document.getElementById("noahResult");

  let html = escapeHtml(md)
    /* 코드 블록 */
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="noah-code"><code>$2</code></pre>')
    /* 표 */
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)*)/g, (_, header, body) => {
      const ths = header.split("|").map((h) => `<th>${h.trim()}</th>`).join("");
      const rows = body.trim().split("\n").map((row) => {
        const tds = row.split("|").filter(Boolean).map((c) => `<td>${c.trim()}</td>`).join("");
        return `<tr>${tds}</tr>`;
      }).join("");
      return `<table class="noah-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`;
    })
    /* 헤더 */
    .replace(/^### (.+)$/gm, '<h4 class="noah-h4">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 class="noah-h3">$1</h3>')
    .replace(/^# (.+)$/gm, '<h2 class="noah-h2">$1</h2>')
    /* 볼드/이탤릭 */
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    /* 리스트 */
    .replace(/^[-*] (.+)$/gm, '<li class="noah-li">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="noah-li noah-li--ordered"><span class="noah-li__num">$1.</span> $2</li>')
    /* 줄바꿈 */
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>");

  html = `<p>${html}</p>`;

  el.innerHTML = `
    <div class="noah-result__content">${html}</div>
    <div class="noah-result__actions">
      <button class="noah-btn noah-btn--secondary" onclick="copyResult()">📋 복사하기</button>
      <button class="noah-btn noah-btn--secondary" onclick="regenerate()">🔄 다시 생성</button>
    </div>
  `;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ── 유틸 ── */
function copyResult() {
  const el = document.getElementById("noahResult");
  const text = el.querySelector(".noah-result__content")?.innerText || "";
  navigator.clipboard.writeText(text).then(() => showToast("클립보드에 복사 완료! ✅"));
}

function regenerate() {
  generate();
}

function showToast(msg) {
  let toast = document.getElementById("noahToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "noahToast";
    toast.className = "noah-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("noah-toast--show");
  setTimeout(() => toast.classList.remove("noah-toast--show"), 2400);
}

/* ── 예시 프롬프트 삽입 ── */
function insertExample(text) {
  document.getElementById("noahPrompt").value = text;
  document.getElementById("noahPrompt").focus();
}

/* ── 초기화 ── */
let adminKey = "";

document.addEventListener("DOMContentLoaded", () => {
  buildDashboard();
  noahThreadId = getOrCreatePersistentThreadId("analog-holiday-noah-thread-id", "noah");

  const savedKey = window.sessionStorage.getItem("analog-holiday-admin-key");
  if (savedKey) {
    adminKey = savedKey;
    const input = document.getElementById("noahKeyInput");
    if (input) input.value = savedKey;
    
    document.getElementById("noahAuth").hidden = true;
    document.getElementById("noahDashboard").hidden = false;
  }

  document.getElementById("noahAuthForm").addEventListener("submit", (e) => {
    e.preventDefault();
    adminKey = document.getElementById("noahKeyInput").value.trim();
    if (!adminKey) return;
    
    window.sessionStorage.setItem("analog-holiday-admin-key", adminKey);
    document.getElementById("noahAuth").hidden = true;
    document.getElementById("noahDashboard").hidden = false;
  });

  document.getElementById("noahGenBtn").addEventListener("click", generate);

  document.getElementById("noahPrompt").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      generate();
    }
  });

  const fetchBtn = document.getElementById("noahFetchDataBtn");
  if (fetchBtn) {
    fetchBtn.addEventListener("click", async () => {
      if (!adminKey) {
        showToast("관리자 인증이 필요합니다.");
        return;
      }
      
      try {
        const res = await fetch("/api/reservations", {
          headers: { "x-admin-key": adminKey }
        });
        const data = await res.json();
        
        if (!res.ok || !data.ok) throw new Error(data.message || "데이터를 불러올 수 없습니다.");
        
        let promptText = "다음 최근 예약 데이터들의 [고객 무드/요청사항]을 분석해서 마케팅 인사이트를 도출해줘:\n\n";
        data.reservations.slice(0, 10).forEach((r, i) => {
          promptText += `${i + 1}. [여행지: ${r.destination}] ${r.mood || "특별한 요청 없음"}\n`;
        });
        
        document.getElementById("noahPrompt").value = promptText;
        switchMode("sentiment");
        showToast("실제 데이터를 성공적으로 불러왔습니다!");
      } catch (err) {
        showToast("오류: " + err.message);
      }
    });
  }
});
