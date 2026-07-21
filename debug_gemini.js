import dotenv from "dotenv";
dotenv.config();
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function main() {
  console.log("Testing gemini-3.5-flash evaluation...");
  try {
    console.log("--- Testing gemini-2.5-flash ---");
    const result25 = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: "Hello! Please evaluate this report in detail and output a full JSON. Output at least 500 characters." }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 1024,
      }
    });
    console.log("2.5 Candidate keys:", Object.keys(result25.candidates[0]));
    console.log("2.5 Finish Reason:", result25.candidates[0].finishReason);
    console.log("2.5 Text length:", result25.text?.length);

    console.log("\n--- Testing gemini-3.5-flash with NO maxOutputTokens limit ---");
    const result35NoLimit = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: "Hello! Please evaluate this report in detail and output a full JSON. Output at least 500 characters." }] }],
      config: {
        temperature: 0.3
      }
    });
    console.log("3.5 NoLimit Finish Reason:", result35NoLimit.candidates[0].finishReason);
    console.log("3.5 NoLimit Text length:", result35NoLimit.text?.length);
    console.log("3.5 NoLimit Text:", result35NoLimit.text);
  } catch (e) {
    console.error("Error:", e);
  }
}
main();
