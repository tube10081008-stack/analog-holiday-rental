import { GoogleGenAI } from "@google/genai";
import {
  listReservations,
  getAdminKey,
  getStorageMode,
  saveConversationMessage,
} from "./_lib/reservations.js";
import { parseScheduleDates } from "./_lib/inventory.js";
import { json, readBody, isAuthorized } from "./_lib/utils.js";

const MODEL_ID = "gemini-3.5-flash";

/* ═══════════════════════════════════════════════
   알렉스 — 디자인팀 · 포스트프로덕션 매니저
   필름 반납 → 현상 → 스캔 → 편집 → 숏폼 납품
   ═══════════════════════════════════════════════ */

const PIPELINE_STAGES = [
  { id: "return_pending", label: "반납 대기", icon: "📮", color: "#e8853e", daysAfterReturn: 0 },
  { id: "film_received", label: "필름 수거", icon: "📦", color: "#4c8a84", daysAfterReturn: 3 },
  { id: "developing", label: "현상 중", icon: "🧪", color: "#6c7bde", daysAfterReturn: 5 },
  { id: "scan_done", label: "스캔 완료", icon: "🖼️", color: "#9b59b6", daysAfterReturn: 8 },
  { id: "editing", label: "편집 중", icon: "✂️", color: "#ef9d32", daysAfterReturn: 10 },
  { id: "delivered", label: "납품 완료", icon: "✅", color: "#27ae60", daysAfterReturn: 14 },
];

const SYSTEM_PROMPTS = {
  shortform: `
당신은 아날로그 홀리데이 디자인팀의 '알렉스(Alex)'입니다.
감각적이고 트렌디한 숏폼 영상 기획 전문가로, 고객의 필름 카메라 사진을 활용한 릴스/쇼츠 콘텐츠를 기획합니다.

[기획 규칙]
1. 고객의 여행지, 카메라 종류, 무드를 기반으로 숏폼 영상 컨셉을 기획합니다.
2. 15초~30초 분량의 타임라인(초 단위)을 제안합니다.
3. BGM 추천 (아티스트 – 곡명, 분위기 설명 포함)을 포함합니다.
4. 색보정(그레이딩) 방향을 제안합니다.
5. 자막/타이포그래피 스타일을 제안합니다.
6. 브랜드의 '아날로그한 감성'과 '트렌디함'의 조화를 중시합니다.
7. 한국어, 전문가다운 세련된 어투.
`,

  delivery: `
당신은 아날로그 홀리데이 디자인팀의 '알렉스(Alex)'입니다.
고객에게 숏폼 결과물을 납품할 때 보내는 따뜻하고 감성적인 메시지를 작성합니다.

[작성 규칙]
1. 고객의 여행이 한 편의 영화처럼 기록되었음을 강조합니다.
2. 각 단계(현상/스캔/편집)에서 정성을 다했음을 언급합니다.
3. 결과물 시청 링크와 함께 감상 포인트를 짚어줍니다.
4. 한국어, 따뜻하고 친절한 존댓말.
`,

  community: `
당신은 아날로그 홀리데이 디자인팀의 '알렉스(Alex)'입니다.
디자인 커뮤니티나 브랜드 채널에 공유할 포트폴리오 설명글을 작성합니다.
`
};


/**
 * 귀국일 기준으로 파이프라인 단계를 자동 결정
 */
function computePipelineStage(returnDateStr) {
  const now = new Date();
  const returnDate = new Date(returnDateStr);
  const daysSinceReturn = Math.floor((now - returnDate) / 86400000);

  if (daysSinceReturn < 0) return null; // 아직 여행 중

  for (let i = PIPELINE_STAGES.length - 1; i >= 0; i--) {
    if (daysSinceReturn >= PIPELINE_STAGES[i].daysAfterReturn) {
      return { ...PIPELINE_STAGES[i], daysSinceReturn };
    }
  }
  return { ...PIPELINE_STAGES[0], daysSinceReturn };
}

/**
 * 예약 데이터를 파이프라인 아이템으로 변환
 */
function buildPipelineItems(reservations) {
  const items = [];

  for (const rsv of reservations) {
    if (!rsv.schedule) continue;

    const parsed = parseScheduleDates(rsv.schedule);
    if (!parsed) continue;

    const stageData = computePipelineStage(parsed.returnDate);
    if (!stageData) continue; // 아직 여행 중이면 파이프라인에 안 넣음

    items.push({
      reservationId: rsv.id,
      name: rsv.name,
      destination: rsv.destination,
      cameraId: rsv.cameraId || "",
      mood: rsv.mood || "",
      schedule: rsv.schedule,
      departure: parsed.departure,
      returnDate: parsed.returnDate,
      daysSinceReturn: stageData.daysSinceReturn,
      stage: stageData.id,
      stageLabel: stageData.label,
      stageIcon: stageData.icon,
      stageColor: stageData.color,
    });
  }

  // 단계 순서 + 오래된 것 우선
  const stageOrder = Object.fromEntries(PIPELINE_STAGES.map((s, i) => [s.id, i]));
  items.sort((a, b) => {
    const orderDiff = (stageOrder[a.stage] ?? 99) - (stageOrder[b.stage] ?? 99);
    return orderDiff !== 0 ? orderDiff : b.daysSinceReturn - a.daysSinceReturn;
  });

  return items;
}

/* ── 핸들러 ── */
export default async function handler(req, res) {

  // ── GET: 파이프라인 대시보드 ──
  if (req.method === "GET" && req.query?.action === "dashboard") {
    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
    }

    try {
      const reservations = await listReservations();
      const pipeline = buildPipelineItems(reservations);
      
      const stageCounts = {};
      for (const s of PIPELINE_STAGES) {
        stageCounts[s.id] = 0;
      }
      for (const item of pipeline) {
        if (stageCounts[item.stage] !== undefined) {
          stageCounts[item.stage]++;
        }
      }

      return json(res, 200, {
        ok: true,
        pipeline,
        stages: PIPELINE_STAGES,
        stageCounts,
        totalInPipeline: pipeline.length,
      });
    } catch (err) {
      return json(res, 500, { ok: false, message: err.message });
    }
  }

  // ── POST: AI 기능 ──
  if (req.method === "POST") {
    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return json(res, 500, { ok: false, message: "AI 서비스가 설정되지 않았습니다." });
    }

    const body = await readBody(req);
    const mode = String(body.mode || "").trim();
    const prompt = String(body.prompt || "").trim();
    const threadId = String(body.threadId || "").trim() || "alex-shared";

    if (!SYSTEM_PROMPTS[mode]) {
      return json(res, 400, {
        ok: false,
        message: "유효한 모드를 선택해 주세요 (shortform, delivery, community).",
      });
    }

    if (!prompt) {
      return json(res, 400, { ok: false, message: "프롬프트를 입력해 주세요." });
    }

    await saveConversationMessage({
      channel: "alex-dashboard",
      threadId,
      role: "user",
      content: prompt,
      metadata: { mode },
    });

    try {
      const ai = new GoogleGenAI({ apiKey });

      // 숏폼 기획 시 실 예약 데이터 컨텍스트 주입
      let contextPrefix = "";
      if (mode === "shortform" && body.includeData) {
        const reservations = await listReservations();
        const pipeline = buildPipelineItems(reservations);
        const editingItems = pipeline.filter(
          (p) => p.stage === "scan_done" || p.stage === "editing"
        );
        if (editingItems.length > 0) {
          contextPrefix = `[현재 편집 대기 중인 고객 목록]\n${editingItems.map(
            (item) => `- ${item.name}: ${item.destination}, 카메라: ${item.cameraId}, 무드: ${item.mood}, 귀국일: ${item.returnDate}`
          ).join("\n")}\n\n 위 고객 데이터를 참고하여 답변하세요.\n\n`;
        }
      }

      const result = await ai.models.generateContent({
        model: MODEL_ID,
        contents: [{ role: "user", parts: [{ text: contextPrefix + prompt }] }],
        config: {
          systemInstruction: SYSTEM_PROMPTS[mode],
          temperature: mode === "delivery" ? 0.6 : 0.85,
          topP: 0.9,
          maxOutputTokens: 4096,
        },
      });

      const text =
        result?.candidates?.[0]?.content?.parts?.[0]?.text ??
        result?.text ??
        "결과를 생성하지 못했습니다.";

      await saveConversationMessage({
        channel: "alex-dashboard",
        threadId,
        role: "model",
        content: text,
        metadata: { mode },
      });

      return json(res, 200, { ok: true, result: text, mode });
    } catch (err) {
      console.error("[alex] error:", err);
      return json(res, 500, {
        ok: false,
        message: "알렉스가 잠시 생각 중이에요 🎬 다시 시도해 주세요!",
      });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { ok: false, message: "허용되지 않은 요청입니다." });
}
