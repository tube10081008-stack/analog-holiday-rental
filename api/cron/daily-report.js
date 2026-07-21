import { getInventorySummary } from "../_lib/inventory.js";
import { listReservations, getRecentMagazineTopics, CEO_PHILOSOPHY_LIBRARY } from "../_lib/reservations.js";
import { put } from "@vercel/blob";
import { GoogleGenAI } from "@google/genai";

const DISCORD_WEBHOOK_GIO = process.env.DISCORD_WEBHOOK_GIO || "";
const DISCORD_WEBHOOK_LINA = process.env.DISCORD_WEBHOOK_LINA || "";
const DISCORD_WEBHOOK_HANI = process.env.DISCORD_WEBHOOK_HANI || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    const inv = await getInventorySummary();
    const reservations = await listReservations();

    const dateStr = new Date().toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    });

    let message = `📦 **[아날로그 홀리데이] 물류총괄 Gio(지오) 일일 모닝 브리핑**\n`;
    message += `📅 **${dateStr} (오전 09:00 KST)**\n\n`;

    message += `=====================================\n`;
    message += `📸 **카메라 재고 및 스케줄 현황** \n`;
    message += `=====================================\n`;

    inv.cameras.forEach(c => {
      const isOut = c.totalStock - c.available > 0;
      const statusIcon = isOut ? "🚀" : "📦";
      const statusText = isOut ? "외부 반출됨" : "창고 보관중";

      message += `${statusIcon} **${c.name}**\n`;
      message += `  - 현재 위치: ${statusText} (총 ${c.totalStock}대 중 ${c.available}대 즉시 가용)\n`;
      message += `  - 예정된/진행중인 예약: 총 ${c.totalReservations}건\n`;

      if (c.reservations && c.reservations.length > 0) {
        message += `  - 블락 스케줄: `;
        const blocks = c.reservations.map(r => `${r.departure} ~ ${r.returnDate}`).join(", ");
        message += `${blocks}\n`;
      }
      message += "\n";
      message += "\n";
    });

    message += `=====================================\n`;
    message += `🎒 **Add-to-Box (여행 소품) 재고 현황** \n`;
    message += `=====================================\n`;

    // Add-to-box 재고 수량 요약
    inv.addToBox.forEach(item => {
      const isLow = item.available <= (item.totalStock * 0.2);
      const icon = isLow ? "⚠️" : "🎒";
      message += `${icon} **${item.name}**: 잔여 **${item.available}**개 / 총 ${item.totalStock}개 (현재 외부 반출: ${item.currentlyRented}개, 누적 예약: ${item.totalReservations}건)\n`;
    });

    message += `\n✨ **총 ${inv.totalCameraTypes}종**의 카메라와 **${inv.addToBox.length}종**의 여행 소품이 안정적으로 운영 중입니다.\n오늘도 화이팅입니다 대표님!`;

    // 1. 지오 (Gio) 보고
    const responseGio = await fetch(DISCORD_WEBHOOK_GIO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "물류총괄 Gio(지오)",
        avatar_url: "https://analog-holiday-mall.vercel.app/assets/geo-avatar.png",
        content: message
      })
    });

    if (!responseGio.ok) {
      console.error(`Gio Webhook failed: ${responseGio.statusText}`);
    }

    // 2. 리나 (Lina) 보고 - 물류 일정 브리핑
    const todayStr = new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).replace(/(\.|\s)/g, "-").replace(/-+/g, "-").replace(/-$/, "");
    // todayStr 형식: "2026-04-12" (파싱 형태에 따라 주의하지만 예약 schedule은 'YYYY/MM/DD'나 'YYYY-MM-DD' 혼재)
    // 따라서 오늘과 이틀 뒤(출고)를 좀 더 안전하게 계산
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const todaySimple = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const todaySimpleDash = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    // 이틀 뒤 (출고일)
    d.setDate(d.getDate() + 2);
    const shipDaySimple = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    const shipDaySimpleDash = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    let linaMessage = `✨ **[아날로그 홀리데이] 물류사원 Lina(리나) 일일 대여 일정 브리핑**\n`;
    linaMessage += `행복한 아침입니다! 오늘 신경써야 할 예약 일정들을 정리해 왔어요! 🏃‍♀️💨\n\n`;

    const upcomingToShip = reservations.filter(r => {
      const parts = r.schedule.split("~")[0] || "";
      return parts.includes(shipDaySimple) || parts.includes(shipDaySimpleDash) || r.status === "pending_shipment"; // 출국일 = 이틀 뒤, 혹은 미발송
    }).slice(0, 5);

    const departingToday = reservations.filter(r => {
      const parts = r.schedule.split("~")[0] || "";
      return parts.includes(todaySimple) || parts.includes(todaySimpleDash); // 출국일 = 오늘
    }).slice(0, 5);

    const upcomingToReturn = reservations.filter(r => {
      const parts = r.schedule.split("~")[1] || "";
      return parts.includes(todaySimple) || parts.includes(todaySimpleDash); // 반납일(귀국일) = 오늘
    }).slice(0, 5);

    linaMessage += `🚀 **오늘 택배 출발해야 하는 건 (출국일이 코앞이에요!)**\n`;
    if (upcomingToShip.length === 0) {
      linaMessage += `> 오늘 급하게 출고할 건은 없습니다!\n`;
    } else {
      upcomingToShip.forEach(r => linaMessage += `> 📦 **${r.name}**님 (카메라: ${r.cameraId}, 출국일: ${r.schedule.split("~")[0].trim()})\n`);
    }

    linaMessage += `\n✈️ **오늘 드디어 출국하는 건 (여행 잘 다녀오세요!)**\n`;
    if (departingToday.length === 0) {
      linaMessage += `> 오늘 출발하시는 분은 없습니다!\n`;
    } else {
      departingToday.forEach(r => linaMessage += `> 🛫 **${r.name}**님 (카메라: ${r.cameraId}, 방금 출국!)\n`);
    }

    linaMessage += `\n📥 **오늘 귀국/반납 예정인 건**\n`;
    if (upcomingToReturn.length === 0) {
      linaMessage += `> 오늘 귀국하시는 분은 없습니다!\n`;
    } else {
      upcomingToReturn.forEach(r => linaMessage += `> 🛬 **${r.name}**님 (카메라: ${r.cameraId}, 무사 귀국!)\n`);
    }

    linaMessage += `\n> 지오 대리님 보고서와 함께 일정 참고해주세요! 화이팅 💖`;

    const responseLina = await fetch(DISCORD_WEBHOOK_LINA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "물류사원 리나",
        avatar_url: "https://analog-holiday-mall.vercel.app/assets/lina-avatar.png",
        content: linaMessage
      })
    });

    if (!responseLina.ok) {
      console.error(`Lina Webhook failed: ${responseLina.statusText}`);
    }

    // 3. 하니 (Hani) 아침 보고 (매거진 주제 기획 및 임시 저장)
    let haniStatus = "Skipped (No Key)";
    if (GEMINI_API_KEY) {
      try {
        // [장기기억] 최근 90일간 발행 주제 조회 → 중복 방지
        let pastTopicsSection = '';
        try {
          const pastTopics = await getRecentMagazineTopics(90, 60);
          if (pastTopics.length > 0) {
            const topicList = pastTopics.map((t, i) => `${i + 1}. [${new Date(t.publishedAt).toLocaleDateString('ko-KR')}] ${t.topic}`).join('\n');
            pastTopicsSection = `\n\n[⚠️ 중복 방지 — 최근 발행된 매거진 주제 목록]\n아래 주제들은 이미 발행되었습니다. 절대 같거나 유사한 주제를 다시 기획하지 마세요:\n---\n${topicList}\n---\n`;
          }
        } catch (e) {
          console.warn('[Hani] Past topics fetch failed, continuing without dedup:', e.message);
        }

        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const prompt = `당신은 아날로그 홀리데이의 마케팅 에디터 '하니(Hani)'입니다.

${CEO_PHILOSOPHY_LIBRARY}
${pastTopicsSection}

오늘은 ${dateStr} 입니다.
오전 9시 아침 보고를 위해, 오늘 저녁 발행할 매거진의 [주제 1가지], [목차 3~4개], [깊이 있는 기획 의도]를 작성해주세요.

주의사항:
- 위 [브랜드 철학 가이드]의 정서와 톤앤매너를 참조하되, 대표님이나 팀원의 개인적 에피소드·실명·동선은 절대 언급하지 마세요.
- 대화에서 들은 제3자(고객, 지인 등)의 이름도 매거진에 노출하면 안 됩니다.
- 위 [중복 방지 목록]에 있는 주제와 같거나 유사한 주제는 절대 금지합니다.
- 문학 작품이나 작가를 인용할 때, 최근 7일 이내에 이미 인용한 작품은 재사용하지 마세요. 특히 버지니아 울프만 반복 인용하지 말고 다양한 작가를 회전하세요.
- 신유진 대표님(마케팅 총괄)께 보고하는 다정하면서도 단단한 말투로 작성하세요. "대표님, 차분한 아침입니다." 등으로 시작하세요.
- 흔하고 뻔한 여행 주제(단순 로맨스, 단순 풍경, 핫플)를 피하고, 문학적·철학적 사유가 담긴 서정적인 주제를 선정하세요.
- '다정함', '파편화된 기억', '삶의 궤적', '생활 비평'과 같은 깊이 있는 어휘를 기획 의도에 자연스럽게 녹이세요.
- 이모티콘은 절제하세요.
- 전체 분량은 1500자 이내로 간결하게 작성하세요.
- 마지막엔 "오늘 저녁, 마음을 담아 써내려간 글로 찾아뵙겠습니다." 처럼 진정성 있게 마무리해주세요.`;

        const responseHani = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt,
        });

        if (!responseHani || !responseHani.text) {
          throw new Error("Gemini produced empty response for Hani.");
        }
        const haniPlan = responseHani.text;

        // Vercel Blob에 오늘치 기획안 임시 저장 (저녁 발행을 위해 덮어쓰기 허용)
        if (process.env.BLOB_READ_WRITE_TOKEN) {
          try {
            await put("magazine-plan/today.json", JSON.stringify({
              date: todaySimpleDash,
              plan: haniPlan
            }), {
              access: "public",
              addRandomSuffix: false,
              allowOverwrite: true,
              token: process.env.BLOB_READ_WRITE_TOKEN
            });
          } catch (blobErr) {
            console.warn("Blob save failed even with allowOverwrite:", blobErr.message);
            // Non-critical error, continue to webhook
          }
        }

        // 웹훅 전송
        const haniWebhookRes = await fetch(DISCORD_WEBHOOK_HANI, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "마케팅 사원 하니",
            avatar_url: "https://analog-holiday-mall.vercel.app/assets/hani-avatar.png",
            content: haniPlan
          })
        });

        if (!haniWebhookRes.ok) {
          const errBody = await haniWebhookRes.text();
          console.error(`[Hani Webhook Error] Status: ${haniWebhookRes.status}, Body: ${errBody}`);
          haniStatus = `Webhook Failed (${haniWebhookRes.status})`;
        } else {
          console.log(`[Hani Webhook Success] Plan reported successfully.`);
          haniStatus = "Success";
        }
      } catch (err) {
        console.error("Hani morning planning failed strictly:", err);
        haniStatus = `Error: ${err.message}`;
      }
    }

    res.status(200).json({
      ok: true,
      message: "일일 모닝 브리핑 발송 완료!",
      hani: haniStatus
    });
  } catch (err) {
    console.error("Daily report cron failed:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
}