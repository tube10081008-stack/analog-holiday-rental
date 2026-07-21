const slides = Array.from(document.querySelectorAll(".hero-slide"));
const dots = Array.from(document.querySelectorAll(".hero-carousel__dot"));

const siteHeader = document.getElementById("siteHeader");
const menuOpenBtn = document.getElementById("menuOpenBtn");
const menuCloseBtn = document.getElementById("menuCloseBtn");
const fullscreenMenu = document.getElementById("fullscreenMenu");

const reserveTriggers = Array.from(document.querySelectorAll(".js-open-reserve"));
const reserveModal = document.getElementById("reserveModal");
const reserveBackdrop = reserveModal?.querySelector(".reserve-modal__backdrop");
const reserveCloseButton = reserveModal?.querySelector(".reserve-modal__close");
const reserveForm = document.getElementById("reserveForm");
const reserveStatus = document.getElementById("reserveStatus");
const reserveServiceInput = document.getElementById("reserveService");
const reserveNameInput = document.getElementById("reserveName");
const reserveEmailInput = document.getElementById("reserveEmail");
const reservePhoneInput = document.getElementById("reservePhone");
const reserveDestinationInput = document.getElementById("reserveDestination");
const reserveMoodInput = document.getElementById("reserveMood");
const reserveSubmitButton = reserveForm?.querySelector(".reserve-form__submit");

let activeIndex = 0;
let autoSlideTimer = null;
let lastActiveElement = null;

const CUSTOMER_PROFILE_STORAGE_KEY = "analog-holiday-customer-profile-v2";

function normalizeCustomerProfile(profile = {}) {
  return {
    name: String(profile.name ?? "").trim().slice(0, 60),
    email: String(profile.email ?? "").trim().toLowerCase().slice(0, 120),
    phone: String(profile.phone ?? "").replace(/[^\d]/g, "").slice(0, 20),
  };
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

function buildMailtoLink(payload) {
  const subject = `[Quick Rental] ${payload.reserveService}`;
  const body = [
    "아날로그 홀리데이 퀵 렌탈 문의",
    "",
    `예약 서비스: ${payload.reserveService}`,
    `성함: ${payload.name}`,
    `이메일: ${payload.email}`,
    `연락처: ${payload.phone}`,
    `여행 일정: ${payload.schedule}`,
    `여행지: ${payload.destination}`,
    `원하는 카메라/여행 무드: ${payload.mood}`,
  ].join("\n");

  return `mailto:tube10081008@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderSlide(nextIndex) {
  slides.forEach((slide, index) => {
    slide.classList.toggle("is-active", index === nextIndex);
  });

  dots.forEach((dot, index) => {
    dot.classList.toggle("is-active", index === nextIndex);
  });

  activeIndex = nextIndex;
}

function scheduleSlides() {
  if (autoSlideTimer) {
    window.clearInterval(autoSlideTimer);
  }

  if (slides.length < 2) {
    return;
  }

  autoSlideTimer = window.setInterval(() => {
    const nextIndex = (activeIndex + 1) % slides.length;
    renderSlide(nextIndex);
  }, 4500);
}

function setReserveStatus(message, tone = "default") {
  if (!reserveStatus) {
    return;
  }

  reserveStatus.textContent = message;
  reserveStatus.dataset.tone = tone;
}

function openReserveModal(serviceName = "") {
  if (!reserveModal) {
    return;
  }

  lastActiveElement = document.activeElement;
  reserveServiceInput.value = serviceName;
  reserveModal.hidden = false;
  document.body.style.overflow = "hidden";
  setReserveStatus("");

  window.setTimeout(() => {
    reserveNameInput?.focus();
  }, 30);
}

function closeReserveModal() {
  if (!reserveModal || reserveModal.hidden) {
    return;
  }

  reserveModal.hidden = true;
  document.body.style.overflow = "";
  setReserveStatus("");

  if (lastActiveElement instanceof HTMLElement) {
    lastActiveElement.focus();
  }
}

async function updateAvailableCameras() {
  const reserveDepartureInput = document.getElementById("reserveDeparture");
  const reserveReturnInput = document.getElementById("reserveReturn");
  const reserveCameraInput = document.getElementById("reserveCamera");
  
  if (!reserveDepartureInput || !reserveReturnInput || !reserveCameraInput) return;

  const departure = reserveDepartureInput.value;
  const returnDt = reserveReturnInput.value;

  if (!departure || !returnDt) {
    reserveCameraInput.innerHTML = '<option value="" disabled selected>출국일/귀국일을 먼저 선택해 주세요</option>';
    return;
  }

  try {
    reserveCameraInput.innerHTML = '<option value="" disabled selected>카메라 재고 확인 중...</option>';
    const res = await fetch(`/api/inventory?action=available&departure=${departure}&returnDate=${returnDt}`);
    const data = await res.json();
    
    if (data.ok && data.cameras) {
      reserveCameraInput.innerHTML = '<option value="" disabled selected>원하시는 카메라를 선택해 주세요</option>';
      data.cameras.forEach(c => {
        const option = document.createElement("option");
        option.value = c.id;
        option.textContent = `${c.name} - ${c.mood} ${c.available ? '(대여 가능)' : '(예약 마감)'}`;
        if (!c.available) option.disabled = true;
        reserveCameraInput.appendChild(option);
      });
    } else {
      throw new Error("Failed to load");
    }
  } catch (error) {
    console.error("Failed to load cameras:", error);
    reserveCameraInput.innerHTML = '<option value="" disabled selected>카메라 목록을 불러오지 못했습니다.</option>';
  }
}

async function handleReserveSubmit(event) {
  event.preventDefault();

  if (!reserveForm || !reserveSubmitButton) {
    return;
  }

  const reserveDepartureInput = document.getElementById("reserveDeparture");
  const reserveReturnInput = document.getElementById("reserveReturn");
  const reserveCameraInput = document.getElementById("reserveCamera");

  const departure = reserveDepartureInput?.value?.trim() || "";
  const returnDt = reserveReturnInput?.value?.trim() || "";
  const cameraId = reserveCameraInput?.value?.trim() || "";

  if (!cameraId) {
    setReserveStatus("카메라를 선택해 주세요.", "error");
    return;
  }

  const reserveExtraBoxInput = document.getElementById("reserveExtraBox");

  const payload = {
    reserveService: reserveServiceInput?.value?.trim() || "빠른 퀵 렌탈 문의",
    name: reserveNameInput?.value?.trim() || "",
    email: reserveEmailInput?.value?.trim() || "",
    phone: reservePhoneInput?.value?.trim() || "",
    schedule: departure && returnDt ? `${departure} ~ ${returnDt}` : "",
    destination: reserveDestinationInput?.value?.trim() || "",
    mood: reserveMoodInput?.value?.trim() || "",
    cameraId,
    extraBox: parseInt(reserveExtraBoxInput?.value || "0", 10),
  };

  reserveSubmitButton.disabled = true;
  reserveSubmitButton.textContent = "예약 접수 중...";
  setReserveStatus("예약을 저장하고 있습니다...", "loading");

  try {
    const response = await fetch("/api/reservations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      if (result?.storageMode === "missing") {
        persistCustomerProfile(payload);
        window.location.href = buildMailtoLink(payload);
        setReserveStatus("예약 시스템 설정이 완료되기 전까지는 메일 문의로 연결됩니다.", "loading");
        return;
      }

      throw new Error(result.message || "예약 접수에 실패했습니다.");
    }

    reserveForm.reset();
    persistCustomerProfile({
      name: payload.name,
      email: payload.email,
      phone: payload.phone,
    });
    reserveServiceInput.value = payload.reserveService;
    setReserveStatus(
      `${result.message} 예약번호: ${result.reservation?.id || "-"}`,
      "success",
    );

    window.setTimeout(() => {
      closeReserveModal();
    }, 1800);
  } catch (error) {
    setReserveStatus(error.message || "예약 접수 중 오류가 발생했습니다.", "error");
  } finally {
    reserveSubmitButton.disabled = false;
    reserveSubmitButton.textContent = "예약 문의 보내기";
  }
}

if (slides.length && dots.length) {
  dots.forEach((dot, index) => {
    dot.addEventListener("click", () => {
      renderSlide(index);
      scheduleSlides();
    });
  });

  renderSlide(0);
  scheduleSlides();
}

if (reserveTriggers.length && reserveModal) {
  reserveTriggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      openReserveModal(trigger.dataset.service || "");
    });
  });

  reserveBackdrop?.addEventListener("click", closeReserveModal);
  reserveCloseButton?.addEventListener("click", closeReserveModal);
  reserveForm?.addEventListener("submit", handleReserveSubmit);

  const reserveDepartureInput = document.getElementById("reserveDeparture");
  const reserveReturnInput = document.getElementById("reserveReturn");
  reserveDepartureInput?.addEventListener("change", updateAvailableCameras);
  reserveReturnInput?.addEventListener("change", updateAvailableCameras);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeReserveModal();
    }
  });
}

/* 헤더 스크롤 감지 */
window.addEventListener("scroll", () => {
  if (window.scrollY > 50) {
    siteHeader?.classList.add("is-scrolled");
  } else {
    siteHeader?.classList.remove("is-scrolled");
  }
}, { passive: true });

/* 메뉴 열기/닫기 */
menuOpenBtn?.addEventListener("click", () => {
  if (fullscreenMenu) {
    fullscreenMenu.hidden = false;
    document.body.style.overflow = "hidden";
  }
});

menuCloseBtn?.addEventListener("click", () => {
  if (fullscreenMenu) {
    fullscreenMenu.hidden = true;
    document.body.style.overflow = "";
  }
});

fullscreenMenu?.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    fullscreenMenu.hidden = true;
    document.body.style.overflow = "";
  });
});
