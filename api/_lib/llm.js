/**
 * LLM 프로바이더 어댑터 — JSON 응답 전용
 *
 * 사카나 Fugu(OpenAI 호환)와 Gemini를 같은 인터페이스로 감쌉니다.
 * Fugu는 내부에서 여러 모델을 조율·합성하는 구조라 품질이 좋은 대신 느립니다.
 * Vercel Hobby의 60초 상한 안에서 돌아야 하므로 다음을 지킵니다.
 *
 *   1. Fugu에 자체 타임아웃을 걸고,
 *   2. 실패·지연·JSON 깨짐 어느 경우든 Gemini로 폴백해서
 *      "수업이 아예 안 열리는" 일은 만들지 않습니다.
 *
 * 환경변수
 *   LLM_PROVIDER    'fugu' | 'gemini'  (기본 gemini)
 *   SAKANA_API_KEY  Fugu 키. 없으면 provider 설정과 무관하게 Gemini만 씁니다.
 *   SAKANA_BASE_URL 기본 https://api.sakana.ai/v1 — 콘솔에 표시된 값으로 맞추세요
 *   SAKANA_MODEL    기본 fugu (품질을 더 원하면 fugu-ultra, 비용이 크게 오릅니다)
 *   FUGU_TIMEOUT_MS 기본 40000
 */

import { GoogleGenAI } from '@google/genai';

const GEMINI_MODEL = 'gemini-3.5-flash';

const cfg = () => ({
  provider: (process.env.LLM_PROVIDER || 'gemini').toLowerCase(),
  sakanaKey: process.env.SAKANA_API_KEY || '',
  sakanaBase: (process.env.SAKANA_BASE_URL || 'https://api.sakana.ai/v1').replace(/\/$/, ''),
  sakanaModel: process.env.SAKANA_MODEL || 'fugu',
  geminiKey: process.env.GEMINI_API_KEY || '',
  fuguTimeout: Number(process.env.FUGU_TIMEOUT_MS) || 40000,
});

/** 앞뒤에 군더더기가 붙어 와도 JSON을 건져냅니다 */
export function safeJson(text) {
  const t = String(text || '');
  try { return JSON.parse(t); } catch { /* next */ }
  // ```json ... ``` 로 감싸 오는 경우
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* next */ } }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* next */ }
  try { return JSON.parse(m[0].replace(/[\r\n\t]+/g, ' ')); } catch { return null; }
}

/* ── Fugu (OpenAI 호환 chat/completions) ── */
async function callFugu({ system, user, temperature, maxTokens, timeoutMs }) {
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${c.sakanaBase}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.sakanaKey}`,
      },
      body: JSON.stringify({
        model: c.sakanaModel,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Fugu ${res.status}: ${body.slice(0, 200)}`);
    }
    const j = await res.json();
    const choice = j?.choices?.[0];
    return {
      text: choice?.message?.content || '',
      cut: choice?.finish_reason === 'length',
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ── Gemini ── */
async function callGemini({ system, user, temperature, maxTokens, timeoutMs }) {
  const c = cfg();
  if (!c.geminiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey: c.geminiKey });

  const call = ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts: [{ text: user }] }],
    config: {
      ...(system ? { systemInstruction: system } : {}),
      temperature,
      responseMimeType: 'application/json',
      maxOutputTokens: maxTokens,
    },
  });
  // SDK 버전에 따라 abortSignal 지원이 달라서 경주로 상한을 겁니다
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('Gemini 응답 시간 초과')), timeoutMs));
  const result = await Promise.race([call, timeout]);

  const cand = result?.candidates?.[0];
  return {
    text: cand?.content?.parts?.[0]?.text || result?.text || '',
    cut: cand?.finishReason === 'MAX_TOKENS',
  };
}

const PROVIDERS = { fugu: callFugu, gemini: callGemini };

/** 이번 호출에서 시도할 프로바이더 순서 */
function chain() {
  const c = cfg();
  if (c.provider === 'fugu' && c.sakanaKey) return ['fugu', 'gemini'];
  return ['gemini'];
}

/**
 * JSON 응답을 받아 파싱까지 마칩니다.
 *
 * @param validate 파싱 결과가 쓸 만한지 검사하는 함수. 여기서 false면
 *                 (형식은 JSON이지만 필수 필드가 빠진 경우) 다음 프로바이더로 넘어갑니다.
 * @returns {{data, provider, cut}} 모두 실패하면 data가 null
 */
export async function generateJson({
  system, user,
  temperature = 0.7,
  maxTokens = 8192,
  budgetMs = 55000,
  validate = (d) => !!d,
  label = 'llm',
}) {
  const c = cfg();
  const t0 = Date.now();
  const order = chain();
  let lastErr = null;

  for (let i = 0; i < order.length; i++) {
    const name = order[i];
    const remain = budgetMs - (Date.now() - t0);
    // 마지막 시도가 아니면 폴백 몫을 남겨둡니다
    const share = i === order.length - 1 ? remain : Math.min(c.fuguTimeout, remain - 14000);
    if (share < 5000) {
      console.warn(`[LLM:${label}] ${name} 건너뜀 — 남은 예산 ${Math.round(remain / 1000)}초`);
      continue;
    }
    try {
      const { text, cut } = await PROVIDERS[name]({
        system, user, temperature, maxTokens, timeoutMs: share,
      });
      const data = safeJson(text);
      if (validate(data)) {
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (i > 0) console.warn(`[LLM:${label}] ${order[0]} 실패 후 ${name}으로 처리 (${secs}초)`);
        else console.log(`[LLM:${label}] ${name} ${secs}초`);
        return { data, provider: name, cut };
      }
      lastErr = new Error(`${name}: 응답이 필요한 형식이 아님 (잘림=${cut})`);
      console.warn(`[LLM:${label}] ${lastErr.message}`);
    } catch (err) {
      lastErr = err;
      const aborted = err?.name === 'AbortError';
      console.warn(`[LLM:${label}] ${name} 실패 — ${aborted ? `${share}ms 타임아웃` : err.message}`);
    }
  }
  return { data: null, provider: null, cut: false, error: lastErr };
}

/** 현재 어떤 프로바이더로 도는지 (진단용) */
export function providerInfo() {
  const c = cfg();
  return {
    configured: c.provider,
    effective: chain()[0],
    fallback: chain()[1] || null,
    sakanaKeySet: !!c.sakanaKey,
    sakanaModel: c.sakanaModel,
    sakanaBase: c.sakanaBase,
  };
}
