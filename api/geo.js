import { GoogleGenAI } from "@google/genai";
import {
  listReservations,
  getAdminKey,
  getStorageMode,
  saveConversationMessage,
  updateTrackingNumber,
} from "./_lib/reservations.js";
import { getInventorySummary } from "./_lib/inventory.js";
import { json, readBody, isAuthorized } from "./_lib/utils.js";

const MODEL_ID = "gemini-3.5-flash";

/* ═══════════════════════════════════════════════
   지오 — 물류팀 총괄
   배송 스케줄링 · 알림톡 생성 · 물류 분석
   ═══════════════════════════════════════════════ */

const SYSTEM_PROMPT = `당신은 아날로그 홀리데이 물류팀 총괄 '지오'입니다.
고객의 출입국 데이터에 기반한 배송/회수 스케줄링, 알림톡 메시지 작성, 물류 현황 분석을 담당합니다.

═══════════════════════════════════
📦 물류 운영 규칙
═══════════════════════════════════
1. 배송 스케줄링 기준:
   - 출국 2일 전(D-2): 고객에게 택배 발송 (표준)
   - 운송장 및 배송완료 추정(Korea Post): 송장 번호(trackingNumber)가 입력되면 \`trackingUpdatedAt\` 시각을 확인하세요. 오후 17:00 (17시) 이전에 등록된 송장은 발송일 기준 '다음 날(익일)' 고객의 목적지(배송완료)에 도착한다고 간주합니다. 오후 17:00 이후에 등록된 송장은 우체국 접수 마감으로 인해 하루 뒤 발송되어 '다다음 날(D+2)'에 도착한다고 추정하세요.
   - 출국 3일 전(D-3): 인천공항 수령 고객은 수령 장소 안내
   - 귀국 당일(D+0): 반납 안내 알림 발송
   - 귀국 후 3일 이내(D+3): 반납 완료 확인, 미반납 시 리마인더
   - 귀국 후 7일(D+7): 최종 반납 독촉

2. 알림톡 종류:
   - 예약 확인: 예약 접수 직후
   - 배송 출발: 택배 발송 시 (송장번호 포함)
   - 수령 안내: 인천공항 수령 고객용
   - 반납 안내: 귀국일 기준 D+0
   - 반납 리마인더: D+3 미반납 시
   - 반납 완료: 반납 확인 후 감사 + 숏폼 제작 안내

3. 반납 주소: 경기도 파주시 와석순환로 15, 19층 2호
4. 고객센터: 010-5931-4144

═══════════════════════════════════
📦 재고 관리 규칙
═══════════════════════════════════
- 카메라는 현재 6종, 각 1대씩 보유 (코닥 M35/M38, 야시카 MF-1, 일포드 스프라이트, 포토콜라, 아그파포토, 오키오)
- add-to-box(여행 소품)는 12종, 각 12개씩 보유
- 카메라 배정 시 해당 기간에 이미 대여 중인지 반드시 확인
- 동일 기간 예약이 겹치면 오버부킹 경고를 관리자에게 보고
- 반납이 확인되면 즉시 재고를 원복

═══════════════════════════════════
📊 분석 기능
═══════════════════════════════════
- 예약 데이터로부터 배송 일정 자동 산출
- 재고 현황과 예약을 대조하여 충돌/오버부킹 감지
- 주간/월간 물류 현황 요약
- 병목 구간 감지 (동시 배송 과부하 등)
- 인기 여행지/시즌 트렌드 분석

═══════════════════════════════════
✍️ 작성 규칙
═══════════════════════════════════
- 알림톡: 간결하고 친근한 존댓말, 이모지 적절히 사용, 핵심 정보(날짜, 주소, 연락처) 필수 포함
- 분석: 마크다운 표와 구조화된 형식 사용
- 재고 보고: 카메라명, 현재 상태(대여 중/가용), 예약 기간을 명확히 표시
- 한국어로 답변`;


/* ── 스케줄 계산 ── */
function parseScheduleDates(schedule) {
  if (!schedule) return null;
  // "2026-05-01 ~ 2026-05-08" 또는 "5/1 ~ 5/8" 형태 파싱
  const match = schedule.match(
    /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s*[~\-–—]\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/
  );
  if (match) {
    return {
      departure: new Date(match[1].replace(/[/.]/g, "-")),
      returnDate: new Date(match[2].replace(/[/.]/g, "-")),
    };
  }
  return null;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${y}-${m}-${d}(${days[date.getDay()]})`;
}

function computeLogisticsSchedule(reservation) {
  const dates = parseScheduleDates(reservation.schedule);
  if (!dates) {
    return { error: "일정을 파싱할 수 없습니다", raw: reservation.schedule };
  }

  const now = new Date();
  const { departure, returnDate } = dates;
  const shipDate = addDays(departure, -2);
  const returnReminder = addDays(returnDate, 0);
  const returnDeadline = addDays(returnDate, 3);
  const finalNotice = addDays(returnDate, 7);

  // 상태 판단
  let status = "pending";
  if (now >= finalNotice) status = "overdue";
  else if (now >= returnDate) status = "return_due";
  else if (now >= departure) status = "in_trip";
  else if (reservation.trackingNumber && reservation.trackingUpdatedAt) {
    const trackingDt = new Date(reservation.trackingUpdatedAt);
    const kstStr = trackingDt.toLocaleString("en-US", { timeZone: "Asia/Seoul", hour12: false });
    const hourMatch = kstStr.match(/ (\d+):/);
    const hour = hourMatch ? parseInt(hourMatch[1], 10) : 0;
    
    const deliveredDate = new Date(trackingDt);
    if (hour >= 17) deliveredDate.setDate(deliveredDate.getDate() + 2);
    else deliveredDate.setDate(deliveredDate.getDate() + 1);
    
    if (now >= deliveredDate) status = "delivered";
    else status = "shipped_out";
  }
  else if (reservation.trackingNumber) status = "shipped_out";
  else if (now >= shipDate) status = "ship_ready";
  else status = "upcoming";

  return {
    departure: formatDate(departure),
    returnDate: formatDate(returnDate),
    shipDate: formatDate(shipDate),
    returnReminder: formatDate(returnReminder),
    returnDeadline: formatDate(returnDeadline),
    finalNotice: formatDate(finalNotice),
    status,
    trackingNumber: reservation.trackingNumber,
    daysUntilDeparture: Math.ceil((departure - now) / 86400000),
    daysUntilReturn: Math.ceil((returnDate - now) / 86400000),
  };
}

/* ── 핸들러 ── */
export default async function handler(req, res) {
  if (req.method === "GET" && req.query?.action === "dashboard") {
    // 대시보드 데이터: 예약 목록 + 물류 스케줄 계산
    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
    }

    try {
      const [reservations, inventorySummary] = await Promise.all([
        listReservations(),
        getInventorySummary(),
      ]);

      const enriched = reservations.map((r) => ({
        ...r,
        logistics: computeLogisticsSchedule(r),
      }));

      // 상태별 카운트
      const summary = {
        total: enriched.length,
        upcoming: enriched.filter((r) => r.logistics.status === "upcoming").length,
        ship_ready: enriched.filter((r) => r.logistics.status === "ship_ready").length,
        shipped_out: enriched.filter((r) => ["shipped_out", "delivered"].includes(r.logistics.status)).length,
        in_trip: enriched.filter((r) => r.logistics.status === "in_trip").length,
        return_due: enriched.filter((r) => r.logistics.status === "return_due").length,
        overdue: enriched.filter((r) => r.logistics.status === "overdue").length,
      };

      return json(res, 200, {
        ok: true,
        reservations: enriched,
        summary,
        inventory: inventorySummary,
        storageMode: getStorageMode(),
      });
    } catch (err) {
      return json(res, 500, { ok: false, message: err.message });
    }
  }

  if (req.method === "POST" && req.query?.action === "update_tracking") {
    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
    }
    const body = readBody(req);
    const id = String(body.id || "").trim();
    const trackingNumber = String(body.trackingNumber || "").trim();
    const trackingTime = String(body.trackingTime || "").trim();

    if (!id) {
      return json(res, 400, { ok: false, message: "예약 ID가 누락되었습니다." });
    }

    try {
      const success = await updateTrackingNumber(id, trackingNumber, trackingTime);

      if (success) {
        try {
          const resvList = await listReservations();
          const target = resvList.find((r) => r.id === id);
          if (target) {
            const discordWebhookUrl = process.env.DISCORD_WEBHOOK_GIO || "";
            if (!discordWebhookUrl) throw new Error("DISCORD_WEBHOOK_GIO is not configured.");
            const timeFormatted = trackingTime ? new Date(trackingTime).toLocaleString('ko-KR', { hour12: false }) : '시간 미지정';
            const msg = `📦 **운송장 등록 완료 보고장**\n\n**고객 성함**: ${target.name} 님\n**배송 목적지**: ${target.destination}\n**출국 예정일**: ${target.schedule.split('~')[0].trim()}\n**배정된 카메라**: ${target.cameraId || '미지정'}\n**입력 운송장**: \`${trackingNumber}\`\n**우체국 실제 접수시간**: ${timeFormatted}\n\n> "배송 준비" 상태에서 "발송 완료"로 대시보드 상태가 성공적으로 승급되었습니다! 🚚💨`;
            await fetch(discordWebhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ 
                username: "물류 대리 지오", 
                avatar_url: "https://analog-holiday-mall.vercel.app/assets/geo-avatar.png",
                content: msg 
              }),
            });
          }
        } catch (err2) {
          console.error("[geo] discord webhook error:", err2);
        }
      }

      return json(res, 200, { ok: success });
    } catch (err) {
      console.error("[geo] tracking update error:", err);
      return json(res, 500, { ok: false, message: "운송장 업데이트 중 오류가 발생했습니다." });
    }
  }

  if (req.method === "POST") {
    // AI 기능: 알림톡 생성, 물류 분석
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json(res, 500, { ok: false, message: "AI 서비스가 설정되지 않았습니다." });
    }

    const body = readBody(req);
    const mode = String(body.mode || "").trim();
    const prompt = String(body.prompt || "").trim();
    const threadId = String(body.threadId || "").trim() || "geo-shared";

    if (!prompt) {
      return json(res, 400, { ok: false, message: "요청 내용을 입력해 주세요." });
    }

    // 예약 데이터를 컨텍스트로 주입
    await saveConversationMessage({
      channel: "geo-dashboard",
      threadId,
      role: "user",
      content: prompt,
      metadata: { mode },
    });

    let contextData = "";
    if (body.reservationData) {
      contextData = `\n\n[참고 예약 데이터]\n${JSON.stringify(body.reservationData, null, 2)}`;
    }

    // 재고 데이터도 컨텍스트에 주입
    if (body.inventoryData) {
      contextData += `\n\n[현재 재고 현황]\n${JSON.stringify(body.inventoryData, null, 2)}`;
    }

    const modePrompts = {
      notification: "다음 예약 정보를 바탕으로 알림톡 메시지를 작성해 주세요. 알림톡 종류를 지정하면 해당 종류로 작성합니다.",
      analysis: "다음 예약/물류 데이터를 분석하여 인사이트를 제공해 주세요.",
      schedule: "다음 예약 데이터의 배송/회수 스케줄을 최적화하여 제안해 주세요. 동시 배송 과부하 등 병목도 확인합니다.",
    };

    const modeInstruction = modePrompts[mode] || modePrompts.notification;

    try {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: MODEL_ID,
        contents: [{ role: "user", parts: [{ text: `${modeInstruction}\n\n${prompt}${contextData}` }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: mode === "analysis" ? 0.3 : 0.7,
          topP: 0.9,
          maxOutputTokens: 4096,
        },
      });

      const text =
        result?.candidates?.[0]?.content?.parts?.[0]?.text ??
        result?.text ??
        "결과를 생성하지 못했습니다.";

      await saveConversationMessage({
        channel: "geo-dashboard",
        threadId,
        role: "model",
        content: text,
        metadata: { mode },
      });

      return json(res, 200, { ok: true, result: text, mode });
    } catch (err) {
      console.error("[geo] error:", err);
      return json(res, 500, {
        ok: false,
        message: "지오가 잠시 확인 중이에요 📦 다시 시도해 주세요!",
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { ok: false, message: "허용되지 않은 메서드입니다." });
}
