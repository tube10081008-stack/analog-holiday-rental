import { get } from "@vercel/blob";
import { GoogleGenAI } from "@google/genai";
import { getTodayHaniContext, saveMagazineArchive, CEO_PHILOSOPHY_LIBRARY } from "../_lib/reservations.js";

const DISCORD_WEBHOOK_HANI = process.env.DISCORD_WEBHOOK_HANI || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    let morningPlan = "오늘의 매거진 주제: 빈티지 필름 카메라의 매력과 추천 스팟 (기본 주제)";

    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { stream } = await get("magazine-plan/today.json", {
          token: process.env.BLOB_READ_WRITE_TOKEN
        });
        if (stream) {
          const payload = await new Response(stream).json();
          morningPlan = payload.plan || morningPlan;
        }
      } catch (e) {
        console.error("Could not fetch morning plan, using fallback.", e);
      }
    }

    // 대표님과의 오늘 대화 맥락 가져오기 (전체 대화: 역할+발신자+시간 포함)
    const chatContext = await getTodayHaniContext();
    const chatContextSection = chatContext
      ? `\n[오늘 대표님과의 대화 전문 (시간순)]:\n${chatContext}\n---\n⚠️ 위 대화를 해석할 때 반드시 주의하세요:\n- [신유진 대표님] 또는 [홍성현 대표님]이 말한 내용은 대표님의 발언입니다.\n- [하니]가 말한 내용은 당신(하니)의 응답입니다.\n- 문맥의 주어와 목적어를 정확히 구분하세요. 예: "대표님이 영어 공부를 열심히 한다"는 대표님 본인이 공부한 것이고, 당신에게 격려해준 것이 아닙니다.\n- 대화 내용을 보고서에 인용할 때 사실관계를 왜곡하지 마세요.\n---`
      : "";

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const prompt = `당신은 아날로그 홀리데이의 마케팅 에디터 '하니(Hani)'입니다.

${CEO_PHILOSOPHY_LIBRARY}

오늘 오전에 당신이 기획했던 매거진 기획안은 다음과 같습니다:
---
${morningPlan}
---

위 기획안과 오늘 나누었던 대화 맥락, 그리고 [브랜드 철학 가이드]를 바탕으로,
오늘(18시) 최종 발행할 고품질의 [여행 매거진 본문]을 완성해주세요.
${chatContextSection}

주의사항:
- 위 [브랜드 철학 가이드]의 톤앤매너, 음악 취향, 문학적 영감 풀을 활용하세요.
- ⛔ 절대 금지: 대표님·팀원·고객·지인 등 실존 인물의 이름, 동선, 개인 행위를 매거진에 언급하지 마세요. 이는 프라이버시 침해입니다.
- ⛔ 대화 맥락은 '톤'과 '주제 방향성'을 파악하는 용도로만 사용하세요. 대화 내용을 매거진에 직접 인용하거나 재구성하지 마세요.
- 문학 작품/작가를 인용할 때, 같은 작품을 7일 이내에 재인용하지 마세요. 특히 버지니아 울프만 반복하지 말고 다양한 작가를 회전하세요.
- "오늘의 매거진을 조용히 올려둡니다." 라고 공유하는 디스코드 메시지 형식을 약간 포함합니다.
- 매거진 본문은 한 편의 잘 쓰인 에세이나 생활 비평 산문처럼 깊고 다정해야 합니다.
- 소제목(Markdown)을 사용하되 이모티콘은 절제하여 서분서분한 톤을 유지하세요.
- ⚠️ 분량은 반드시 1800자 이내로 완결하세요. 중간에 끊기지 않도록 분량을 조절하세요.
- 마지막엔 추천곡(음악 영감 풀에서 매번 다른 곡 선택) 1곡을 덧붙이고, "각자의 일상을 무사히 지나보낸 오늘을 응원합니다."와 같이 여운을 주며 마무리하세요.`;

    const responseHani = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
    });

    if (!responseHani || !responseHani.text) {
      throw new Error("Gemini produced empty response for Hani Magazine.");
    }
    let haniArticle = responseHani.text;

    // 스마트 트리밍: 2000자 초과 시 마지막 완성된 문장에서 잘라내기
    if (haniArticle.length > 1950) {
      const cutPoint = haniArticle.lastIndexOf('.', 1950);
      if (cutPoint > 800) {
        haniArticle = haniArticle.substring(0, cutPoint + 1);
      } else {
        haniArticle = haniArticle.substring(0, 1950);
      }
    }

    // 웹훅 전송
    const discordRes = await fetch(DISCORD_WEBHOOK_HANI, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "마케팅 사원 하니",
        avatar_url: "https://analog-holiday-mall.vercel.app/assets/hani-avatar.png",
        content: haniArticle
      })
    });

    if (!discordRes.ok) {
      const errBody = await discordRes.text();
      console.error(`[Hani Magazine Webhook Error] Status: ${discordRes.status}, Body: ${errBody}`);
    } else {
      console.log(`[Hani Magazine Webhook Success] Article published successfully.`);

      // [장기기억] 발행된 매거진 주제를 DB에 영구 아카이빙 (다음날 중복 방지용)
      try {
        const topicLine = morningPlan.split('\n').find(l => l.includes('주제') || l.includes('제목')) || morningPlan.substring(0, 120);
        const summary = haniArticle.substring(0, 300);
        await saveMagazineArchive({ topic: topicLine.trim(), summary, fullContent: haniArticle });
        console.log(`[Hani Archive] Magazine topic archived successfully.`);
      } catch (archiveErr) {
        console.warn('[Hani Archive] Failed to save archive, non-critical:', archiveErr.message);
      }
    }

    res.status(200).json({ ok: true, message: "저녁 매거진 발행 완료!" });
  } catch (err) {
    console.error("Evening report cron failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}