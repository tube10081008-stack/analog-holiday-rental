import { GoogleGenAI } from "@google/genai";
import { isAuthorized } from "./_lib/utils.js";

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: "관리자 인증이 필요합니다." });
  }
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const models = await ai.models.list();
    const names = [];
    for await (const m of models) {
       names.push(m.name);
    }
    return res.status(200).json({ models: names });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
