import { GoogleGenAI } from "@google/genai";
import {
  createReservation,
  getConversationHistory,
  getConversationThreadByCustomer,
  saveConversationMessage,
  setConversationThreadForCustomer,
} from "./_lib/reservations.js";
import { getInventorySummary, parseScheduleDates, reserveCamera, reserveAddToBox } from "./_lib/inventory.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_ID = "gemini-3.5-flash";
const PUBLIC_LINA_CHANNEL = "public-lina";

const SYSTEM_PROMPT = `당신은 '리나'입니다.
아날로그 홀리데이(Analog Holiday) 물류팀 소속 사원으로, 고객의 여행 렌탈 문의를 24시간 밝고 친절하게 응대하는 AI 에이전트입니다.

═══════════════════════════════════
📌 리나의 성격과 말투
═══════════════════════════════════
- 항상 존댓말을 사용합니다 (반말 절대 금지)
- 따뜻하고 감성적이면서도 전문적인 톤을 유지합니다
- 이모지를 적절히 사용해 친근한 분위기를 만듭니다 (과하지 않게)
- 고객의 여행을 진심으로 응원하는 태도를 보여줍니다
- 답변은 간결하되 필요한 정보는 빠짐없이 전달합니다
- "~요", "~드려요", "~해보세요" 등 부드러운 어미를 사용합니다

═══════════════════════════════════
🏢 아날로그 홀리데이 소개
═══════════════════════════════════
아날로그 홀리데이는 단순한 카메라 대여를 넘어, 고객의 평범한 여행을 한 편의 낭만적인 영화로 만들어주는 렌탈+콘텐츠 결합 플랫폼입니다.
- 아네모이아(Anemoia): 자신이 겪어보지 않은 과거에 대한 향수와 동경
- 디지털 디톡스 트렌드를 공략합니다
- 2030 세대의 여행 낭만을 책임지는 라이프스타일 렌탈 플랫폼

═══════════════════════════════════
📦 낭만 여행 올인원 패키지 (단독 출시)
═══════════════════════════════════
가격: 89,000원

[패키지 구성]
1) 선택 카메라 1대 + 필름 1롤 (6종 중 택1)
2) 아날로그 홀리데이 짝꿍 세트
   - 필름카메라 사용설명서
   - 카메라 렌즈 닦이
   - 키홀더
3) 장거리 비행 꿀잠 세트
   - 비행기용 귀마개
   - 온열 수면 안대
   - 에어 목 쿠션
4) 여행자 필수 물품
   - 메쉬 백
   - 종합 멀티 어댑터
   - 3in1 충전기 선
5) 사후 서비스: 레트로 감성 숏폼 영상(릴스/쇼츠) 1편 전문 제작

═══════════════════════════════════
📷 큐레이션 카메라 6종
═══════════════════════════════════
01. 코닥 M35 / M38
   → 특유의 쨍하고 따뜻한 코닥 옐로우 톤. 평범한 오늘을 청춘 영화 속 명장면으로 만들어줌.
   
02. 야시카 MF-1
   → 미니멀한 바디, 매트한 질감. 혼자만의 조용한 여행이나 사색의 순간에 완벽한 파트너.

03. 일포드 스프라이트 35-II
   → 빛바랜 흑백 영화의 우아한 낭만. 클래식한 분위기 속 타임머신.

04. 포토콜라 35mm
   → 완벽한 구도보다 즐거운 분위기 자체가 예술. 가장 힙한 카메라.

05. 아그파포토 아날로그 35mm
   → 붉은 셔터를 누르면 시간이 천천히 흐르는 착각. 가장 포근한 주말 오후의 카메라.

06. 오키오 다회용 카메라
   → 강력한 플래시의 힙한 저화질 노이즈. 밤거리 감성의 완벽한 초대장.

═══════════════════════════════════
🛡️ 트러블 안심선언 (파손 보상 정책)
═══════════════════════════════════
⚡ 핵심: 어떤 카메라든, 어떤 파손이든, 고객 최대 부담금은 "3만원"입니다.
- 기기 종류와 관계없이 일률적으로 최대 3만원이 상한입니다.
- 코닥 M35든, 야시카 MF-1이든, 오키오든 전부 동일하게 3만원입니다.
- 파손 정도에 따라 3만원 이하로 책정될 수 있으나, 절대 3만원을 초과하지 않습니다.
- 고객이 파손 비용을 물어보면: "모든 카메라 공통으로 파손 시 최대 부담금은 3만원입니다"라고 명확히 안내하세요.
- 카메라별로 다른 금액을 절대 말하지 마세요. 전부 3만원 상한입니다.
- 이용 전 상담을 통해 사용법까지 케어합니다.
- 파손 걱정 없이 마음 편하게 여행할 수 있도록 하는 것이 핵심입니다.

═══════════════════════════════════
📮 배송 / 반납 안내
═══════════════════════════════════
- 인천공항 수령 및 택배 수령 모두 가능
- 반납 주소: 경기도 파주시 와석순환로 15, 19층 2호
- 출국일과 귀국일 데이터에 기반한 체계적인 배송/회수 스케줄링

═══════════════════════════════════
💰 패키지 및 결제 안내
═══════════════════════════════════
- 기본 렌탈 패키지 89,000원 (카메라 1대 + Add-to-box 여행 소품 박스 1세트 포함)
- 추가 옵션: Add-to-box(여행 소품 박스) 추가 대여 가능 (1박스 당 19,000원 추가)
- 무통장 입금: SC제일은행 586-20-201921 / 예금주: 홍성현
- 주문자명과 입금자명이 다를 경우 고객센터로 연락 필요

═══════════════════════════════════
📞 고객센터 안내
═══════════════════════════════════
- 전화: 010-5931-4144
- 운영시간: 월~금 오전 9:00 ~ 오후 6:00
- 점심시간: 오후 12:00 ~ 오후 1:00
- 카카오톡 채널 및 1:1 문의는 운영시간 내 순차 답변
- 유사시 24시간 콜센터 지원

═══════════════════════════════════
🏪 사업자 정보
═══════════════════════════════════
- 상호명: 아날로그 홀리데이
- 대표자: 신유진
- 이메일: tube10081008@gmail.com

═══════════════════════════════════
⚠️ 리나의 행동 규칙
═══════════════════════════════════
1. 위에 제공된 비즈니스 정보 범위 내에서만 답변합니다.
2. 모르거나 확실하지 않은 질문은: "정확한 확인을 위해 담당자에게 전달해 드릴게요! 📞 010-5931-4144로 연락주시거나, 잠시만 기다려주시면 확인 후 안내드리겠습니다 😊"

═══════════════════════════════════
🔒 예약 접수 3단계 프로토콜 (반드시 3단계를 순서대로 완료해야 합니다)
═══════════════════════════════════

📌 [1단계: 정보 수집] — 아래 7가지를 빠짐없이 모두 수집해야 합니다. 하나라도 빠지면 절대 2단계로 넘어가지 마세요.
  ① 성함
  ② 연락처 (010-XXXX-XXXX 형식)
  ③ 이메일 주소
  ④ 여행 일정 (출국일 ~ 귀국일, 반드시 YYYY-MM-DD ~ YYYY-MM-DD 형식으로 변환)
  ⑤ 여행지명
  ⑥ 카메라 기종 선택 (6종 중 반드시 1개를 고객이 직접 선택해야 합니다. 리나가 임의로 정하지 마세요.)
  ⑦ 추가 소품박스(Add-to-box) 수량 (기본 1세트 포함, 추가 시 박스당 19,000원)
  
  수집 규칙:
  - 고객이 한 메시지에서 여러 정보를 동시에 알려줄 수 있습니다. 이미 알려준 정보는 다시 묻지 마세요.
  - 아직 못 받은 정보만 골라서 자연스럽게 물어보세요.
  - 카메라 기종을 고객이 말하지 않았다면 반드시 6종을 소개하고 선택을 유도하세요. 고객의 선택 없이 리나가 임의로 기종을 정해서는 절대 안 됩니다.

📌 [2단계: 최종 확인] — 7가지가 모두 수집되면, 반드시 아래 형식의 확인표를 보여주고 고객의 동의("네", "맞아요", "확인" 등)를 기다리세요.
  
  표시 형식:
  ────────────────
  📋 예약 정보 확인
  ────────────────
  - 성함: OOO
  - 연락처: 010-XXXX-XXXX
  - 이메일: xxx@xxx.com
  - 일정: YYYY-MM-DD ~ YYYY-MM-DD
  - 여행지: OOO
  - 카메라: OOO
  - 추가 소품박스: O개
  - 결제 금액: 89,000원 + (추가박스 × 19,000원) = 총 OOO원
  ────────────────
  위 내용이 모두 맞으시면 "네"라고 답해 주세요! 확인 후 바로 예약을 접수해 드릴게요 😊

  ⚠️ 고객이 "네", "맞아요", "확인", "좋아요", "진행해 주세요" 등 명확한 동의를 할 때까지 절대로 3단계로 넘어가지 마세요.
  ⚠️ 확인표를 보여주기 전에 [CREATE_RESERVATION] 블록을 절대 생성하지 마세요.

📌 [3단계: 시스템 접수] — 고객이 2단계 확인에 동의한 직후에만, 답변 마지막 줄에 아래 JSON 블록을 딱 1회 추가하세요.
  [CREATE_RESERVATION: {"name":"고객이름", "phone":"연락처", "email":"이메일", "schedule":"YYYY-MM-DD ~ YYYY-MM-DD", "destination":"여행지", "cameraId":"카메라시스템ID", "extraBox": 추가박스수(정수), "mood":"무드요약"}]

  카메라 시스템 ID 매핑표 (고객이 선택한 이름 → cameraId):
  - 코닥 M35 / M38 → cam_kodak_m35
  - 야시카 MF-1 → cam_yashica_mf1
  - 일포드 스프라이트 → cam_ilford_sprite
  - 포토콜라 35mm → cam_fotocola_35mm
  - 아그파포토 → cam_agfa_analogue
  - 오키오 → cam_okio_35mm

  ⚠️ [CREATE_RESERVATION] 블록은 대화 전체에서 단 1회만 생성하세요.
  ⚠️ 이미 예약이 접수된 후에는 고객이 뭘 요청하든 절대 다시 생성하지 마세요.

═══════════════════════════════════
🚫 예약 변경/취소에 대한 리나의 권한
═══════════════════════════════════
- 리나(본 챗봇)은 이미 접수된 예약을 수정하거나 취소할 시스템 권한이 없습니다.
- 고객이 예약 후 "카메라를 바꿀래요", "소품 추가할래요", "일정을 변경할래요", "취소할래요" 등을 요청할 경우:
  → "변경해드릴게요", "바꿔드렸어요" 같은 거짓말을 절대 하지 마세요!
  → 반드시 이렇게 안내하세요: "예약 변경 및 취소는 전산상 담당자 확인이 필요하므로 고객센터(📞 010-5931-4144)로 연락 부탁드립니다 😊"
- 어떤 상황에서도 실제 시스템 권한 없이 "처리 완료"라고 말하면 안 됩니다. 이것은 고객 기만입니다.

═══════════════════════════════════
📅 날짜 해석 규칙
═══════════════════════════════════
- 고객이 "오늘", "내일", "모레", "이번주" 등의 상대적 표현을 사용하면, 시스템이 제공하는 [현재 날짜] 정보를 기준으로 정확한 YYYY-MM-DD 날짜로 변환하세요.
- 고객이 "15일"처럼 일자만 말하면 현재 날짜를 기준으로 가장 가까운 미래 날짜로 해석하세요.
- 과거 날짜로 예약하지 마세요.
- 출국일과 귀국일이 명확하지 않으면 반드시 재확인하세요. 추측하지 마세요.

═══════════════════════════════════
기타 행동 규칙
═══════════════════════════════════
5. 경쟁사 비방이나 부정적 비교는 절대 하지 않습니다.
6. 아날로그 홀리데이와 관련 없는 질문(정치, 종교, 논란 등)에는 정중히 서비스 관련 질문으로 유도합니다.
7. 답변은 최대 300자 이내로 간결하게 합니다. 필요시 항목별로 정리합니다.
8. ⚡ 재고 관련: 시스템이 [현재 재고 현황] 데이터를 제공합니다. 
   - 고객이 특정 여행 일정을 말하면, 해당 카메라의 '예약 불가능한 일정(차단 기간)'과 겹치는 날짜가 단 하루라도 있는지 꼼꼼히 확인하세요.
   - 예약 불가능한 일정으로 명시된 시작일과 종료일 그리고 그 사이의 모든 날짜는 전부 대여가 불가능합니다.
   - 요청하신 일정과 예약 불가능한 일정이 전혀 안 겹친다면 "요청하신 일정으로 대여가 가능합니다!"라고 긍정으로 답하세요.
   - 만약 일정 정보 없이 뭉뚱그려 재고를 물어본다면, "정확한 확인을 위해 출국/귀국 일정을 알려주시면 재고를 확인해 드릴게요!" 라고 먼저 답변하세요.
   - ⚠️ 단, "총 재고 수량"은 내부 영업 비밀이므로 고객에게 절대 숫자를 말하지 마세요.
9. ⚡ 파손 비용: 어떤 카메라를 물어보더라도 "최대 3만원"이라고만 답하세요. 카메라별로 다른 금액을 절대 말하지 마세요.
10. 🚫 절대 금지: 내부 사고 과정, 추론 과정, Self-correction, Thinking 등의 메타 텍스트를 응답에 포함하지 마세요. 고객에게는 최종 답변만 보여야 합니다.

═══════════════════════════════════
💬 첫 인사 (고객이 채팅을 열었을 때)
═══════════════════════════════════
고객이 처음 채팅을 시작하면 아래와 같이 인사합니다:
"안녕하세요! 아날로그 홀리데이 리나입니다 🎞️✨
여행의 낭만을 함께 준비해 드릴게요! 무엇이 궁금하신가요?"`;

function json(response, statusCode, payload) {
  response
    .status(statusCode)
    .setHeader("Content-Type", "application/json; charset=utf-8");
  response.send(JSON.stringify(payload));
}

function readRequestBody(request) {
  if (!request.body) {
    return {};
  }

  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }

  return request.body;
}

function mapStoredConversation(rows = []) {
  return rows
    .filter((row) => row && (row.role === "user" || row.role === "model") && row.content)
    .map((row) => ({
      role: row.role,
      text: row.content,
    }));
}

function normalizeCustomerKeyInput(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 180);
}

function buildCustomerKeyFromProfile(profile = {}) {
  const phone = String(profile.phone ?? "").replace(/\D/g, "");
  if (phone) {
    return `phone:${phone}`;
  }

  const email = String(profile.email ?? "").trim().toLowerCase();
  if (email) {
    return `email:${email}`;
  }

  return "";
}

function createFallbackThreadId() {
  return `lina_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function resolvePublicLinaThread({
  threadId,
  customerKey,
  customerProfile,
  source = "guest",
  metadata = {},
} = {}) {
  let resolvedThreadId = String(threadId ?? "").trim() || createFallbackThreadId();
  const resolvedCustomerKey = normalizeCustomerKeyInput(
    customerKey || buildCustomerKeyFromProfile(customerProfile),
  );

  if (!resolvedCustomerKey) {
    return {
      threadId: resolvedThreadId,
      customerKey: "",
    };
  }

  const mappedThreadId = await getConversationThreadByCustomer({
    channel: PUBLIC_LINA_CHANNEL,
    customerKey: resolvedCustomerKey,
  });

  if (mappedThreadId) {
    resolvedThreadId = mappedThreadId;
  } else {
    await setConversationThreadForCustomer({
      channel: PUBLIC_LINA_CHANNEL,
      customerKey: resolvedCustomerKey,
      threadId: resolvedThreadId,
      source,
      metadata,
    });
  }

  return {
    threadId: resolvedThreadId,
    customerKey: resolvedCustomerKey,
  };
}

async function loadPublicLinaHistory(threadId) {
  return getConversationHistory({
    channel: PUBLIC_LINA_CHANNEL,
    threadId,
    limit: 120,
  });
}

export default async function handler(request, response) {
  if (request.method === "GET") {
    const threadId = String(request.query?.threadId ?? "").trim();
    const customerKey = String(request.query?.customerKey ?? "").trim();

    if (!threadId && !customerKey) {
      return json(response, 400, {
        ok: false,
        message: "threadId or customerKey is required.",
      });
    }

    try {
      const resolved = await resolvePublicLinaThread({
        threadId,
        customerKey,
        source: "customer_lookup",
      });
      const history = await loadPublicLinaHistory(resolved.threadId);
      return json(response, 200, {
        ok: true,
        threadId: resolved.threadId,
        customerKey: resolved.customerKey,
        history: mapStoredConversation(history),
      });
    } catch (error) {
      console.error("[chat] history load error:", error);
      return json(response, 500, {
        ok: false,
        message: "대화 기록을 불러오지 못했습니다.",
      });
    }
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return json(response, 405, {
      ok: false,
      message: "POST 요청만 허용됩니다.",
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return json(response, 500, {
      ok: false,
      message: "AI 서비스가 아직 설정되지 않았습니다.",
    });
  }

  try {
    const body = readRequestBody(request);
    const userMessage = String(body.message ?? "").trim();
    const threadId = String(body.threadId ?? "").trim();
    const customerKey = String(body.customerKey ?? "").trim();
    const customerProfile =
      body.customerProfile && typeof body.customerProfile === "object"
        ? body.customerProfile
        : {};
    let conversationHistory = [];

    if (!userMessage) {
      return json(response, 400, {
        ok: false,
        message: "메시지를 입력해 주세요.",
      });
    }

    const resolved = await resolvePublicLinaThread({
      threadId,
      customerKey,
      customerProfile,
      source: customerKey ? "customer_key" : "guest",
      metadata: customerProfile,
    });
    const resolvedThreadId = resolved.threadId;

    if (resolvedThreadId) {
      conversationHistory = mapStoredConversation(await loadPublicLinaHistory(resolvedThreadId));
      await saveConversationMessage({
        channel: PUBLIC_LINA_CHANNEL,
        threadId: resolvedThreadId,
        role: "user",
        content: userMessage,
      });
    }

    if (!conversationHistory.length) {
      conversationHistory = Array.isArray(body.history)
        ? body.history
        : [];
    }

    const ai = new GoogleGenAI({ apiKey });

    const contents = [];

    for (const turn of conversationHistory) {
      if (turn.role === "user" || turn.role === "model") {
        contents.push({
          role: turn.role,
          parts: [{ text: turn.text }],
        });
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: userMessage }],
    });

    // 실시간 재고 데이터 및 기예약 일정 조회하여 시스템 프롬프트에 주입
    let inventoryContext = "";
    try {
      const inv = await getInventorySummary();
      const cameraStatus = inv.cameras.map(c => {
        const reservations = c.reservations || [];
        const bookedDates = reservations.map(r => {
          const start = new Date(r.departure);
          start.setDate(start.getDate() - 2);
          const end = new Date(r.returnDate);
          end.setDate(end.getDate() + 3);
          const fmt = d => `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월 ${String(d.getDate()).padStart(2, "0")}일`;
          return `${fmt(start)}부터 ${fmt(end)}까지`;
        }).join(", ");
        const statusStr = bookedDates ? `[해당 기간 대여 절대불가: ${bookedDates}]` : `[전 일정 대여 가능]`;
        return `- [ID: ${c.id}] ${c.name}: 총 재고 ${c.totalStock}대 ${statusStr}`;
      }).join("\n");
      inventoryContext = `\n\n═══════════════════════════════════\n📊 [현재 재고 현황 및 예약 현황] (일정 겹침 여부 엄격 판단 요망)\n═══════════════════════════════════\n${cameraStatus}\n\n전체 ${inv.totalCameraTypes}종의 카메라 상태입니다.`;
    } catch (e) {
      console.error("[chat] inventory fetch error:", e);
      inventoryContext = "\n\n[재고 데이터를 조회할 수 없습니다. 재고 문의 시 고객센터로 안내해주세요.]";
    }

    const result = await ai.models.generateContent({
      model: MODEL_ID,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT + `\n\n═══════════════════════════════════\n📅 [현재 날짜 및 시간 정보]\n═══════════════════════════════════\n현재 날짜: ${new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" })}\n현재 시각: ${new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul" })}\n"오늘"=${new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })).toISOString().split("T")[0]}\n고객이 말하는 상대적 날짜(내일, 모레, 이번주 등)를 이 기준으로 정확히 변환하세요.` + inventoryContext,
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1024,
      },
    });

    let aiText =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ??
      result?.text ??
      "죄송합니다, 잠시 후 다시 시도해 주세요 🙏";

    let action = null;
    let createdReservation = null;
    let responseCustomerProfile = null;

    // AI 텍스트 내에서 JSON 추출
    const match = aiText.match(/\[CREATE_RESERVATION:\s*(\{[^}]+\})\s*\]/);
    if (match) {
      try {
        const payload = JSON.parse(match[1]);

        // ══════════════════════════════════════════════════════════════
        // 서버 검증 GATE — AI가 프롬프트를 무시해도 여기서 차단합니다
        // ══════════════════════════════════════════════════════════════

        // [검증 1] 필수 필드 6종 완전성 체크 (mood는 선택사항)
        const REQUIRED_FIELDS = ["name", "phone", "email", "schedule", "destination", "cameraId"];
        const missingFields = REQUIRED_FIELDS.filter(f => !payload[f] || String(payload[f]).trim().length === 0);

        // [검증 2] cameraId가 유효한 6종 중 하나인지 체크
        const VALID_CAMERA_IDS = [
          "cam_kodak_m35", "cam_yashica_mf1", "cam_ilford_sprite",
          "cam_fotocola_35mm", "cam_agfa_analogue", "cam_okio_35mm"
        ];
        const isCameraValid = VALID_CAMERA_IDS.includes(payload.cameraId);

        // [검증 3] schedule이 YYYY-MM-DD ~ YYYY-MM-DD 형식인지 체크
        const schedulePattern = /^\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}$/;
        const isScheduleValid = schedulePattern.test(String(payload.schedule || "").trim());

        // 검증 실패 시 예약 접수 거부 — JSON만 제거하고 텍스트는 유지
        if (missingFields.length > 0 || !isCameraValid || !isScheduleValid) {
          console.warn(`[chat] ❌ 서버 검증 실패 — 예약 접수 거부!`);
          console.warn(`  → 누락 필드: ${missingFields.join(", ") || "없음"}`);
          console.warn(`  → 카메라ID 유효: ${isCameraValid} (값: ${payload.cameraId})`);
          console.warn(`  → 일정 포맷 유효: ${isScheduleValid} (값: ${payload.schedule})`);
          aiText = aiText.replace(match[0], "").trim();
        } else {

          // [검증 4] 중복 예약 방지: 같은 스레드에서 최근 10분 내 예약이 있으면 차단
          const recentHistory = await getConversationHistory({
            channel: PUBLIC_LINA_CHANNEL,
            threadId: resolvedThreadId,
            limit: 30,
          });
          const alreadyCreated = recentHistory.some(
            (msg) => {
              if (msg.role === "model" && msg.metadata?.action === "reservation_created") {
                const ageMs = new Date() - new Date(msg.createdAt);
                return ageMs < 10 * 60 * 1000; // 10분 이내 동일 스레드 중복 차단
              }
              return false;
            }
          );
          if (alreadyCreated) {
            console.log(`[chat] 중복 예약 차단: 10분 이내에 이미 이 스레드에서 예약이 생성됨 (threadId=${resolvedThreadId})`);
            aiText = aiText.replace(match[0], "").trim();
          } else {
            // ✅ 모든 검증 통과 — 예약 접수
            const resObj = await createReservation(payload);
            createdReservation = resObj;
            action = "reservation_created";
            responseCustomerProfile = {
              name: payload.name || resObj.name || "",
              email: payload.email || resObj.email || "",
              phone: payload.phone || resObj.phone || "",
            };

            const reservationCustomerKey = buildCustomerKeyFromProfile(responseCustomerProfile);
            if (resolvedThreadId && reservationCustomerKey) {
              await setConversationThreadForCustomer({
                channel: PUBLIC_LINA_CHANNEL,
                customerKey: reservationCustomerKey,
                threadId: resolvedThreadId,
                source: "reservation",
                metadata: {
                  reservationId: resObj.id || "",
                  name: responseCustomerProfile.name || "",
                },
              });
            }

            // 재고 자동 차감 (카메라 + Add-to-box 옵션) — cameraId는 검증 완료 상태
            const parsed = parseScheduleDates(resObj.schedule);
            if (parsed) {
              try {
                await reserveCamera(resObj.cameraId, resObj.id, parsed.departure, parsed.returnDate);
                const addReqCount = 1 + (resObj.extraBox || 0);
                for (let i = 0; i < addReqCount; i++) {
                  await reserveAddToBox("add-to-box-kit", `${resObj.id}_box_${i}`, parsed.departure, parsed.returnDate);
                }
              } catch (e) {
                console.error("[chat] Inventory holding failed:", e);
              }
            }

            // 디스코드 보고 (리나 전용 웹훅)
            try {
              const discordWebhookUrl = "https://discord.com/api/webhooks/1492783938916192397/PLX_rcl8qdukfrK4XtzRL_NcZwxFF3iWgzgmt-b1lc9aID9r_J5QryWOUMGZEnpAQAk5";
              const extraBoxMsg = resObj.extraBox ? ` (추가 소품 박스 ${resObj.extraBox}개)` : '';
              const content = `🚨 **[신규 주문 접수] (Lina AI 직접 응대)**\n> **고객명**: ${resObj.name}\n> **일정**: ${resObj.schedule}\n> **카메라**: ${resObj.cameraId}${extraBoxMsg}\n> **여행지**: ${resObj.destination}\n> **요청무드**: ${resObj.mood || '-'}\n\n✅ 서버 검증 완료 후 정상 접수! - *물류사원 리나*`;
              await fetch(discordWebhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  username: "물류사원 리나",
                  avatar_url: "https://analog-holiday-mall.vercel.app/assets/lina-avatar.png",
                  content
                })
              });
            } catch (e) { console.error("Discord error:", e); }

            // 고객에게 보여줄 텍스트에서 JSON 삭제
            aiText = aiText.replace(match[0], "").trim();
          } // else (alreadyCreated 분기 종료)
        } // else (검증 실패 분기 종료)
      } catch (e) {
        console.error("Failed to parse or create reservation:", e);
      }
    } else {
      // 명시적 폼 오픈 인텐트는 유지 (Fallback fallback)
      const hasReservationIntent =
        /예약|렌탈\s*신청|주문|결제\s*하고|빌리고\s*싶|대여\s*하고|패키지\s*신청/i.test(userMessage) && !/취소|변경/.test(userMessage);

      // AI가 모호하게 끝난 경우 기존처럼 open_reservation 유도 가능. 하지만 가급적 직접 받게 변경했음.
      // 필요하다면 사용
      if (hasReservationIntent && aiText.includes("예약")) {
        // action = "open_reservation";
      }
    }

    // ── 내부 추론 텍스트 필터링 (Self-correction, Thinking 등 고객 노출 방지) ──
    aiText = aiText
      .replace(/\*(?:Self-correction|Thinking|Internal note|Note to self|내부 메모|자체 수정)[^*]*\*/gi, "")
      .replace(/^\s*(?:Self-correction|Thinking|Internal note|Note to self|내부 메모|자체 수정):.*$/gmi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (resolvedThreadId && aiText) {
      await saveConversationMessage({
        channel: PUBLIC_LINA_CHANNEL,
        threadId: resolvedThreadId,
        role: "model",
        content: aiText,
        metadata: action ? { action } : {},
      });
    }

    return json(response, 200, {
      ok: true,
      reply: aiText,
      action: action,
      threadId: resolvedThreadId,
      customerKey:
        buildCustomerKeyFromProfile(responseCustomerProfile || {}) || resolved.customerKey,
      customerProfile: responseCustomerProfile,
    });
  } catch (error) {
    console.error("[chat] Gemini API error:", error);
    return json(response, 500, {
      ok: false,
      message:
        "리나가 잠시 자리를 비웠어요 😅 잠시 후 다시 시도해 주세요!",
    });
  }
}