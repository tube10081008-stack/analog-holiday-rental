const fs = require('fs');
const env = fs.readFileSync('.env.production', 'utf8');
const apiKeyMatch = env.split('\n').find(l => l.startsWith('GEMINI_API_KEY='));
if(!apiKeyMatch) throw new Error('no key');
const apiKey = apiKeyMatch.split('=')[1].trim().replace(/\"/g, '');
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey });
async function run() {
  const models = await ai.models.list();
  for await (const m of models) {
    if (m.name.includes('flash') || m.name.includes('pro')) {
       console.log(m.name);
    }
  }
}
run();
