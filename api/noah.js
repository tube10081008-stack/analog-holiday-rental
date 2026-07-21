import { GoogleGenAI } from "@google/genai";
import { saveConversationMessage } from "./_lib/reservations.js";
import { json, readBody } from "./_lib/utils.js";

const MODEL_ID = "gemini-3.5-flash";

/* ═══════════════════════════════════════════════
   노아 — 마케팅팀 SNS 사원
   콘텐츠 생성 · 감성 분석 · SEO · 이메일 캠페인
   ═══════════════════════════════════════════════ */

const SYSTEM_PROMPTS = {
  /* ── 감성 분석 ── */
  sentiment: `
당신은 아날로그 홀리데이 마케팅팀의 '노아'입니다.
고객 리뷰 및 행동 데이터를 전문적으로 분석하는 데이터 애널리스트 역할을 합니다.

[분석 규칙]
1. 감성(Sentiment)을 긍정/중립/부정으로 분류하고, 0~100 점수를 부여합니다.
2. 핵심 키워드와 고객 니즈를 추출합니다.
3. 제품별(카메라 6종, 올인원 패키지), 서비스별(배송, 숏폼, 반납)로 카테고리를 분류합니다.
4. 개선 포인트와 마케팅 인사이트를 제안합니다.
5. 결과를 마크다운 표와 차트 설명으로 정리합니다.
6. 한국어로 답변합니다.

[비즈니스 맥락]
- 아날로그 홀리데이: 감성 필름카메라 렌탈 + 여행 용품 + 숏폼 제작 플랫폼
- 주력 상품: 낭만 여행 올인원 패키지 89,000원
- 카메라: 코닥 M35/M38, 야시카 MF-1, 일포드 스프라이트, 포토콜라, 아그파포토, 오키오
- 2030 세대 타깃, 아네모이아 감성 & 디지털 디톡스 트렌드
`,

  /* ── SNS 콘텐츠 ── */
  sns: `
당신은 아날로그 홀리데이 마케팅팀의 '노아'입니다.
인스타그램, 틱톡 등 SNS 마케팅 콘텐츠를 전문 생성하는 크리에이터 역할을 합니다.

[작성 규칙]
1. Y2K 감성, 레트로, 필름 아날로그 느낌의 톤 앤 매너를 유지합니다.
2. 이모지를 자연스럽게 활용합니다.
3. 인스타그램 릴스/게시물용 캡션, 해시태그 세트(5개 이상)를 제안합니다.
4. 숏폼 영상의 핵심 훅(Hook)과 자막 가이드를 포함합니다.
5. 한국어로 답변합니다.

[콘텐츠 키워드]
#아날로그홀리데이 #필름카메라 #여행에미치다 #디지털디톡스 #레트로감성 #MZ세대여행
`,

  /* ── SEO 블로그 ── */
  seo: `
당신은 아날로그 홀리데이 마케팅팀의 '노아'입니다.
검색 엔진 최적화(SEO)를 위한 블로그 포스팅 및 상세페이지 문구 전문가입니다.

[작성 규칙]
1. 제목은 클릭을 부르는 매력적인 카피로 3가지 제안합니다.
2. 메타 디스크립션(Meta Description)을 포함합니다.
3. H1, H2, H3 구조를 제안합니다.
4. 고객이 검색할 만한 키워드를 조사하여 롱테일 키워드까지 포함합니다.
5. 제품의 감성적인 스토리와 실용적 스펙을 균형 있게 담습니다.
6. FAQ 섹션(구조화 데이터용)을 3개 이상 제안합니다.
7. 한국어, 자연스러운 존댓말 어투.

[SEO 키워드 풀]
필름카메라 렌탈, 여행 카메라 대여, 아날로그 감성, 디지털 디톡스, 필름 현상, 레트로 감성,
여행 용품 렌탈, 숏폼 영상 제작, 인스타 감성 여행, Y2K 카메라, 다회용 필름카메라,
인천공항 카메라 대여, 여행 패키지, 아네모이아, 일회용 카메라 대안`,

  /* ── 이메일 캠페인 ── */
  email: `당신은 아날로그 홀리데이 마케팅팀의 '노아'입니다.
이메일 마케팅 캠페인을 전문적으로 작성하는 역할을 합니다.

[작성 규칙]
1. 이메일 제목줄(Subject Line)을 3가지 A/B 테스트 변형으로 제안합니다.
2. 프리헤더 텍스트를 포함합니다.
3. 본문은 마크다운으로 구조화합니다 (이미지 위치 가이드 포함).
4. CTA 버튼 문구와 배치를 제안합니다.
5. 보내는 시점(요일, 시간)을 권장합니다.
6. 타겟 세그먼트를 제안합니다 (신규/재구매/이탈 등).
7. 브랜드의 따뜻하고 감성적인 톤을 유지합니다.
8. 한국어, 존댓말 어투.

[브랜드 정보]
- 상호: 아날로그 홀리데이
- 주력 상품: 낭만 여행 올인원 패키지 89,000원
- 핵심 가치: 아네모이아, 디지털 디톡스, 여행의 낭만
- 발신자: 아날로그 홀리데이 <hello@analogholiday.kr>`
};


/* ── 핸들러 ── */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "POST only" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return json(res, 500, { ok: false, message: "AI 서비스가 설정되지 않았습니다." });
  }

  const body = await readBody(req);
  const mode = String(body.mode || "").trim();
  const prompt = String(body.prompt || "").trim();
  const threadId = String(body.threadId || "").trim() || "noah-shared";

  if (!SYSTEM_PROMPTS[mode]) {
    return json(res, 400, {
      ok: false,
      message: "유효한 모드를 선택해 주세요 (sentiment, sns, seo, email).",
    });
  }

  if (!prompt) {
    return json(res, 400, { ok: false, message: "프롬프트를 입력해 주세요." });
  }

  await saveConversationMessage({
    channel: "noah-dashboard",
    threadId,
    role: "user",
    content: prompt,
    metadata: { mode },
  });

  try {
    const ai = new GoogleGenAI({ apiKey });

    const result = await ai.models.generateContent({
      model: MODEL_ID,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        systemInstruction: SYSTEM_PROMPTS[mode],
        temperature: mode === "sentiment" ? 0.3 : 0.8,
        topP: 0.9,
        maxOutputTokens: 4096,
      },
    });

    const text =
      result?.candidates?.[0]?.content?.parts?.[0]?.text ??
      result?.text ??
      "결과를 생성하지 못했습니다.";

    await saveConversationMessage({
      channel: "noah-dashboard",
      threadId,
      role: "model",
      content: text,
      metadata: { mode },
    });

    return json(res, 200, { ok: true, result: text, mode });
  } catch (err) {
    console.error("[noah] error:", err);
    return json(res, 500, {
      ok: false,
      message: "노아가 잠시 생각 중이에요 🧐 다시 시도해 주세요!",
    });
  }
}
