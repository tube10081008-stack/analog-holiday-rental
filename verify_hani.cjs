const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

async function verify() {
  console.log("--- 하니(Hani) 정상화 검증 테스트 시작 ---");
  
  // 1. 모델 리스트에서 가장 적합한 Flash 모델 찾기
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ GEMINI_API_KEY가 없습니다.");
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const modelToTest = 'gemini-3-flash-preview'; // 리스트에 존재 확인됨
  
  console.log(`\n1. 모델 테스트: ${modelToTest}`);
  try {
    const model = ai.getGenerativeModel({ model: modelToTest });
    const result = await model.generateContent("안녕? 넌 누구니? 한 문장으로 대답해줘.");
    console.log("✅ 모델 응답 성공:", result.response.text());
  } catch (e) {
    console.error("❌ 모델 테스트 실패:", e.message);
  }

  // 2. 하니 웹훅 테스트
  const webhookUrl = "https://discord.com/api/webhooks/1492798329958961204/tkmM8VTgGXkUdJq-kVQ64biTZOvxUhtog8lYyP0d0EYDsBen5rphTpBwyr99FR-flr5W7";
  console.log(`\n2. 웹훅 테스트: ${webhookUrl}`);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "검증봇",
        content: "하니 에이전트 통신 검증 메시지입니다. 이게 보인다면 웹훅은 정상입니다."
      })
    });
    if (res.ok) {
      console.log("✅ 웹훅 전송 성공!");
    } else {
      console.log("❌ 웹훅 전송 실패:", res.statusText);
    }
  } catch (e) {
    console.error("❌ 웹훅 통신 에러:", e.message);
  }
}

verify();
