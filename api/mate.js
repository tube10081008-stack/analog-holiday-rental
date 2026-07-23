import { GoogleGenAI } from "@google/genai";
import { SPOTS, CAMERAS, getSpotById } from "../mate/spots.js";

/* ═══════════════════════════════════════════════
   홀리데이 메이트 — AI 프록시
   클라이언트에 API 키를 절대 노출하지 않기 위한 서버 게이트웨이.
   action: "script" (Gemini 가이드 대본) | "tts" (ElevenLabs 음성)
   ═══════════════════════════════════════════════ */

const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-3.5-flash";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";

// 페르소나별 시스템 프롬프트 — 아날로그 홀리데이 세계관의 AI 직원들
const PERSONA_PROMPTS = {
  hani: `당신은 아날로그 홀리데이의 감성 에디터 '하니'입니다.
문학적이고 다정한 어조로, 장소의 결과 시간의 흔적을 톺아보듯 말합니다.
과장된 감탄사 없이, 여행자가 이 장소를 천천히 바라보게 만드세요.`,
  lina: `당신은 아날로그 홀리데이의 안내원 '리나'입니다.
밝고 친절한 존댓말로, 처음 온 여행자도 편안해지도록 또박또박 안내합니다.
실용적인 정보를 빠뜨리지 않되 따뜻한 온도를 유지하세요.`,
  noah: `당신은 아날로그 홀리데이의 로컬 트렌드 전문가 '노아'입니다.
자신감 있고 감각적인 어조로, 현지인만 아는 포인트를 콕 집어 알려줍니다.
"여기서 포인트는요" 같은 표현으로 핵심을 짚어주세요.`,
};

// 페르소나 → ElevenLabs 한국어 보이스 매핑
const VOICE_MAP = {
  hani: "xi3rF0t7dg7uN2M0WUhr",
  lina: "z6Kj0hecH20CdetSElRT",
  noah: "U1cJYS4EdbaHmfR7YzHd",
};

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

async function handleScript(res, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(res, 500, { ok: false, message: "AI 서비스가 설정되지 않았습니다." });

  // 클라이언트는 ID만 보냅니다 — 데이터는 서버가 조회 (프롬프트 인젝션 차단)
  const spot = getSpotById(String(body.spotId || ""));
  const camera = CAMERAS[String(body.cameraId || "")] || null;
  const personaPrompt = PERSONA_PROMPTS[String(body.persona || "")] || PERSONA_PROMPTS.hani;

  if (!spot) return json(res, 400, { ok: false, message: "알 수 없는 스팟입니다." });

  const cameraSection = camera
    ? `\n**여행자의 카메라: ${camera.name}**\n- 특성: ${camera.trait}\n- 기본 팁: ${camera.generalTip}${spot.cameraTips?.[body.cameraId] ? `\n- 이 장소 전용 팁: ${spot.cameraTips[body.cameraId]}` : ""}\n반드시 이 카메라 이름을 한 번 언급하며, 이 카메라로 여기서 찍는 법을 알려주세요.`
    : "";

  const prompt = `${personaPrompt}

당신은 지금 필름카메라를 든 여행자와 함께 "${spot.name}" 앞에 서 있습니다.
40~50초 분량(한국어 200~260자)의 오디오 가이드 대본을 작성하세요.

**장소 정보:**
- 이름: ${spot.name} (${spot.city})
- 설명: ${spot.desc}
- 촬영 골든타임: ${spot.goldenTime}
- 필름 촬영 노하우: ${spot.filmNote}${cameraSection}

**필수 규칙:**
1. TTS로 읽히는 대본 — 자연스러운 구어체, 괄호·번호·마크다운·특수문자 금지
2. 한 문장 최대 25자, 짧고 리듬 있게
3. 구성: 짧은 인사 → 장소의 매력 한 가지 → 촬영 팁 한 가지(골든타임 또는 구도) → 여운 있는 마무리
4. 과장된 감탄사(와우, 대박) 금지 — 차분하고 밀도 있게
5. 필름은 36장뿐이라는 감각을 존중하세요. "이 한 컷"의 무게를 담아주세요`;

  const ai = new GoogleGenAI({ apiKey });
  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: { temperature: 0.8, maxOutputTokens: 512 },
  });

  const script = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || "";
  if (!script) return json(res, 502, { ok: false, message: "대본 생성에 실패했습니다." });

  return json(res, 200, { ok: true, script: script.trim() });
}

async function handleTts(res, body) {
  const text = String(body.text || "").trim().slice(0, 1000);
  if (!text) return json(res, 400, { ok: false, message: "텍스트가 없습니다." });

  // ElevenLabs 미설정 시 클라이언트가 브라우저 TTS로 폴백하도록 신호
  if (!ELEVENLABS_API_KEY) {
    return json(res, 200, { ok: true, fallback: true });
  }

  const voiceId = VOICE_MAP[String(body.persona || "")] || VOICE_MAP.hani;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.6, similarity_boost: 0.78, style: 0.3, use_speaker_boost: true },
    }),
  });

  if (!response.ok) {
    console.error("[mate] ElevenLabs error:", response.status);
    return json(res, 200, { ok: true, fallback: true });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return json(res, 200, { ok: true, audioBase64: buffer.toString("base64") });
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    // 스팟 목록은 공개 데이터 — 클라이언트 번들과 동일 소스를 공유
    return json(res, 200, { ok: true, spots: SPOTS.length });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "POST 요청만 허용됩니다." });
  }

  const body = readBody(req);
  const action = String(body.action || "");

  try {
    if (action === "script") return await handleScript(res, body);
    if (action === "tts") return await handleTts(res, body);
    return json(res, 400, { ok: false, message: "알 수 없는 action입니다." });
  } catch (err) {
    console.error("[mate] error:", err);
    return json(res, 500, { ok: false, message: "잠시 후 다시 시도해 주세요." });
  }
}
