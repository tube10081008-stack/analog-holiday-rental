import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
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
