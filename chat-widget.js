/**
 * 리나 AI 채팅 위젯
 * 아날로그 홀리데이 — 1차 CS 및 예약 데스크
 */
(function initLinaChatWidget() {
  /* ─── state ─── */
  let isOpen = false;
  let isLoading = false;
  let conversationHistory = [];
  let conversationThreadId = "";
  let hasHydratedHistory = false;
  let historyLoadPromise = null;

  const QUICK_CHIPS = [
    { icon: "📷", text: "카메라 종류가 궁금해요" },
    { icon: "💰", text: "패키지 가격이 얼마인가요?" },
    { icon: "📦", text: "반납은 어떻게 하나요?" },
    { icon: "🛡️", text: "파손되면 어떻게 하나요?" },
    { icon: "🎬", text: "숏폼 영상은 어떻게 받나요?" },
    { icon: "✈️", text: "예약하고 싶어요!" },
  ];

  const GREETING =
    "안녕하세요! 아날로그 홀리데이 리나입니다 🎞️✨\n여행의 낭만을 함께 준비해 드릴게요! 무엇이 궁금하신가요?";

  /* ─── create DOM ─── */
  const THREAD_STORAGE_KEY = "analog-holiday-lina-thread-id-v2";
  const CUSTOMER_ID_STORAGE_KEY = "analog-holiday-customer-id-v2";
  const CUSTOMER_PROFILE_STORAGE_KEY = "analog-holiday-customer-profile-v2";

  function buildWidget() {
    const container = document.createElement("div");
    container.id = "linaChatWidget";
    container.innerHTML = `
      <button class="lina-fab" id="linaFab" type="button" aria-label="리나에게 문의하기">
        <img class="lina-fab__avatar" src="./assets/lina-avatar.png" alt="리나" width="52" height="52">
        <span class="lina-fab__pulse"></span>
        <span class="lina-fab__badge">1</span>
      </button>

      <div class="lina-panel" id="linaPanel" hidden>
        <header class="lina-panel__header">
          <div class="lina-panel__header-left">
            <img class="lina-panel__avatar" src="./assets/lina-avatar.png" alt="리나" width="36" height="36">
            <div>
              <strong class="lina-panel__name">리나</strong>
              <span class="lina-panel__status">물류팀 · 24시간 응대</span>
            </div>
          </div>
          <button class="lina-panel__close" id="linaPanelClose" type="button" aria-label="채팅창 닫기">✕</button>
        </header>

        <div class="lina-panel__messages" id="linaMessages">
          <!-- messages inserted here -->
        </div>

        <div class="lina-panel__chips" id="linaChips">
          <!-- quick chips inserted here -->
        </div>

        <form class="lina-panel__input-bar" id="linaForm">
          <input
            class="lina-panel__input"
            id="linaInput"
            type="text"
            placeholder="리나에게 물어보세요..."
            autocomplete="off"
          >
          <button class="lina-panel__send" id="linaSend" type="submit" aria-label="전송">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" fill="currentColor"/></svg>
          </button>
        </form>
      </div>
    `;
    document.body.appendChild(container);
  }

  /* ─── references ─── */
  function getElements() {
    return {
      fab: document.getElementById("linaFab"),
      fabBadge: document.querySelector(".lina-fab__badge"),
      panel: document.getElementById("linaPanel"),
      closeBtn: document.getElementById("linaPanelClose"),
      messages: document.getElementById("linaMessages"),
      chips: document.getElementById("linaChips"),
      form: document.getElementById("linaForm"),
      input: document.getElementById("linaInput"),
      sendBtn: document.getElementById("linaSend"),
    };
  }

  /* ─── message rendering ─── */
  function createMessageBubble(text, role) {
    const wrapper = document.createElement("div");
    wrapper.className = `lina-msg lina-msg--${role}`;

    if (role === "model") {
      const avatar = document.createElement("img");
      avatar.className = "lina-msg__avatar";
      avatar.src = "./assets/lina-avatar.png";
      avatar.alt = "리나";
      avatar.width = 30;
      avatar.height = 30;
      wrapper.appendChild(avatar);
    }

    const bubble = document.createElement("div");
    bubble.className = "lina-msg__bubble";
    bubble.innerHTML = formatMessage(text);
    wrapper.appendChild(bubble);

    return wrapper;
  }

  function createTypingIndicator() {
    const wrapper = document.createElement("div");
    wrapper.className = "lina-msg lina-msg--model lina-msg--typing";
    wrapper.id = "linaTyping";

    const avatar = document.createElement("img");
    avatar.className = "lina-msg__avatar";
    avatar.src = "./assets/lina-avatar.png";
    avatar.alt = "리나";
    avatar.width = 30;
    avatar.height = 30;
    wrapper.appendChild(avatar);

    const bubble = document.createElement("div");
    bubble.className = "lina-msg__bubble lina-msg__bubble--typing";
    bubble.innerHTML =
      '<span class="lina-typing-dot"></span><span class="lina-typing-dot"></span><span class="lina-typing-dot"></span>';
    wrapper.appendChild(bubble);

    return wrapper;
  }

  function formatMessage(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>")
      .replace(
        /\*\*(.+?)\*\*/g,
        '<strong style="font-weight:700">$1</strong>',
      );
  }

  function scrollToBottom(el) {
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  function createThreadId() {
    if (window.crypto?.randomUUID) {
      return `lina_${window.crypto.randomUUID()}`;
    }

    return `lina_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function getOrCreateThreadId() {
    try {
      const stored = window.localStorage.getItem(THREAD_STORAGE_KEY);
      if (stored) {
        return stored;
      }

      const nextThreadId = createThreadId();
      window.localStorage.setItem(THREAD_STORAGE_KEY, nextThreadId);
      return nextThreadId;
    } catch {
      return createThreadId();
    }
  }

  function setConversationThreadId(threadId) {
    if (!threadId) {
      return;
    }

    conversationThreadId = threadId;

    try {
      window.localStorage.setItem(THREAD_STORAGE_KEY, threadId);
    } catch {}
  }

  function normalizeCustomerProfile(profile = {}) {
    return {
      name: String(profile.name ?? "").trim().slice(0, 60),
      email: String(profile.email ?? "").trim().toLowerCase().slice(0, 120),
      phone: String(profile.phone ?? "").replace(/[^\d]/g, "").slice(0, 20),
    };
  }

  function getStoredCustomerProfile() {
    try {
      const raw = window.localStorage.getItem(CUSTOMER_PROFILE_STORAGE_KEY);
      if (!raw) {
        return { name: "", email: "", phone: "" };
      }

      return normalizeCustomerProfile(JSON.parse(raw));
    } catch {
      return { name: "", email: "", phone: "" };
    }
  }

  function persistCustomerProfile(profile = {}) {
    const normalized = normalizeCustomerProfile(profile);

    if (!normalized.name && !normalized.email && !normalized.phone) {
      return normalized;
    }

    try {
      window.localStorage.setItem(
        CUSTOMER_PROFILE_STORAGE_KEY,
        JSON.stringify(normalized),
      );
    } catch {}

    return normalized;
  }

  function createBrowserCustomerId() {
    if (window.crypto?.randomUUID) {
      return `guest_${window.crypto.randomUUID()}`;
    }

    return `guest_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function getOrCreateBrowserCustomerId() {
    try {
      const stored = window.localStorage.getItem(CUSTOMER_ID_STORAGE_KEY);
      if (stored) {
        return stored;
      }

      const nextId = createBrowserCustomerId();
      window.localStorage.setItem(CUSTOMER_ID_STORAGE_KEY, nextId);
      return nextId;
    } catch {
      return createBrowserCustomerId();
    }
  }

  function getCurrentCustomerKey() {
    const profile = getStoredCustomerProfile();

    if (profile.phone) {
      return `phone:${profile.phone}`;
    }

    if (profile.email) {
      return `email:${profile.email}`;
    }

    return `guest:${getOrCreateBrowserCustomerId()}`;
  }

  async function loadConversationHistory(threadId) {
    const customerKey = getCurrentCustomerKey();
    const searchParams = new URLSearchParams();

    if (threadId) {
      searchParams.set("threadId", threadId);
    }

    if (customerKey) {
      searchParams.set("customerKey", customerKey);
    }

    const response = await fetch(`/api/chat?${searchParams.toString()}`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "대화 기록을 불러오지 못했습니다.");
    }

    if (data.threadId) {
      setConversationThreadId(data.threadId);
    }

    return {
      threadId: data.threadId || threadId,
      history: Array.isArray(data.history) ? data.history : [],
    };
  }

  async function hydrateConversationIfNeeded() {
    if (hasHydratedHistory) {
      return;
    }

    if (historyLoadPromise) {
      await historyLoadPromise;
      return;
    }

    const els = getElements();

    historyLoadPromise = (async () => {
      try {
        const { history, threadId } = await loadConversationHistory(conversationThreadId);
        conversationHistory = history;

        if (threadId) {
          setConversationThreadId(threadId);
        }
        els.messages.innerHTML = "";

        if (history.length > 0) {
          history.forEach((item) => {
            els.messages.appendChild(createMessageBubble(item.text, item.role));
          });
          els.chips.hidden = true;
        } else {
          els.messages.appendChild(createMessageBubble(GREETING, "model"));
          renderChips(els.chips);
          els.chips.hidden = false;
        }
      } catch {
        conversationHistory = [];
        els.messages.innerHTML = "";
        els.messages.appendChild(createMessageBubble(GREETING, "model"));
        renderChips(els.chips);
        els.chips.hidden = false;
      } finally {
        hasHydratedHistory = true;
        historyLoadPromise = null;
        scrollToBottom(els.messages);
      }
    })();

    await historyLoadPromise;
  }

  /* ─── chips ─── */
  function renderChips(chipsContainer) {
    chipsContainer.innerHTML = "";
    QUICK_CHIPS.forEach((chip) => {
      const btn = document.createElement("button");
      btn.className = "lina-chip";
      btn.type = "button";
      btn.textContent = `${chip.icon} ${chip.text}`;
      btn.addEventListener("click", () => {
        sendMessage(chip.text);
      });
      chipsContainer.appendChild(btn);
    });
  }

  /* ─── API call ─── */
  async function callChatAPI(message) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        threadId: conversationThreadId,
        customerKey: getCurrentCustomerKey(),
        customerProfile: getStoredCustomerProfile(),
        history: conversationHistory,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.message || "네트워크 오류가 발생했습니다.",
      );
    }

    return data;
  }

  /* ─── send flow ─── */
  async function sendMessage(text) {
    if (isLoading || !text.trim()) return;

    await hydrateConversationIfNeeded();

    const els = getElements();
    const userText = text.trim();

    /* hide chips after first message */
    els.chips.hidden = true;

    /* render user bubble */
    els.messages.appendChild(createMessageBubble(userText, "user"));
    scrollToBottom(els.messages);

    /* add to history */
    conversationHistory.push({ role: "user", text: userText });

    /* show typing */
    isLoading = true;
    els.input.disabled = true;
    els.sendBtn.disabled = true;
    els.messages.appendChild(createTypingIndicator());
    scrollToBottom(els.messages);

    try {
      const data = await callChatAPI(userText);
      const reply = data.reply || "잠시 후 다시 시도해 주세요 🙏";

      if (data.threadId) {
        setConversationThreadId(data.threadId);
      }
      if (data.customerProfile) {
        persistCustomerProfile(data.customerProfile);
      }

      /* remove typing */
      document.getElementById("linaTyping")?.remove();

      /* render AI bubble */
      els.messages.appendChild(createMessageBubble(reply, "model"));
      scrollToBottom(els.messages);

      /* add to history */
      conversationHistory.push({ role: "model", text: reply });

      /* handle action */
      if (data.action === "reservation_created") {
        setTimeout(() => {
          els.messages.appendChild(
            createMessageBubble("🎉 예약이 성공적으로 자동 접수되었습니다!", "model")
          );
          scrollToBottom(els.messages);
          // 예약 완료이므로 대화 기록 초기화 등 추가 처리 가능
        }, 800);
      } else if (data.action === "open_reservation") {
        setTimeout(() => {
          const reserveBtn = document.querySelector(".js-open-reserve");
          if (reserveBtn) {
            reserveBtn.click();
          }
        }, 1200);
      }
    } catch (error) {
      document.getElementById("linaTyping")?.remove();
      els.messages.appendChild(
        createMessageBubble(
          "앗, 잠시 연결이 불안정해요 😅\n잠시 후에 다시 말씀해 주세요!",
          "model",
        ),
      );
      scrollToBottom(els.messages);
    } finally {
      isLoading = false;
      els.input.disabled = false;
      els.sendBtn.disabled = false;
      els.input.focus();
    }
  }

  /* ─── toggle ─── */
  async function openPanel() {
    const els = getElements();
    isOpen = true;
    els.panel.hidden = false;
    els.fab.classList.add("is-open");
    els.fabBadge.hidden = true;

    await hydrateConversationIfNeeded();

    setTimeout(() => {
      els.input.focus();
    }, 200);
  }

  function closePanel() {
    const els = getElements();
    if (!els.panel) {
      return;
    }
    isOpen = false;
    els.panel.hidden = true;
    els.fab.classList.remove("is-open");
  }

  /* ─── init ─── */
  function init() {
    buildWidget();
    const els = getElements();
    conversationThreadId = getOrCreateThreadId();
    getOrCreateBrowserCustomerId();

    els.fab.addEventListener("click", async () => {
      if (isOpen) {
        closePanel();
      } else {
        await openPanel();
      }
    });

    els.closeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    });

    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = els.input.value;
      els.input.value = "";
      sendMessage(text);
    });

    /* keyboard: Escape to close */
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen) {
        closePanel();
      }
    });
  }

  /* ─── boot ─── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
