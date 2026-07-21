const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("❌ GEMINI_API_KEY가 없습니다.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
async function run() {
  try {
    const models = await ai.models.list();
    console.log("--- Available Flash/Pro Models ---");
    for await (const m of models) {
      if (m.name.includes('flash') || m.name.includes('pro')) {
        console.log(m.name);
      }
    }
  } catch (e) {
    console.error("Error listing models:", e.message);
  }
}
run();
