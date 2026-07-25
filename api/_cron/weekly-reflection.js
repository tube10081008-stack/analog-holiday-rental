import { GoogleGenAI } from "@google/genai";
import {
  ensureAllBrainTables,
  getRelevantMemories,
  getAgentBrainStats,
  saveMemory,
  saveSharedKnowledge,
} from "../_lib/agent-brain.js";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK_HANI || "";

const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];
const AGENT_NAMES = { hani: '하니', geo: '지오', noah: '노아', lina: '리나', alex: '알렉스' };
const AGENT_ICONS = { hani: '🎨', geo: '📦', noah: '📈', lina: '📋', alex: '🎬' };

let pool;
function getPool() {
  if (!pool && DATABASE_URL) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
      max: 3,
    });
  }
  return pool;
}

const REFLECTION_PROMPT = `당신은 AI 에이전트의 기억 관리자입니다.
아래는 에이전트의 현재 장기 기억 목록입니다.

다음 작업을 수행하세요:
1. **중복 기억 찾기**: 동일하거나 매우 유사한 내용의 기억이 있으면 병합 제안
2. **모순 감지**: 서로 상충하는 기억이 있으면 경고
3. **아카이브 대상**: 3개월 이상 미참조 or 중요도 3 이하인 기억
4. **이번 주 핵심**: 가장 자주 참조되고 중요한 기억 Top 3

JSON 형태로 반환:
{
  "duplicates": [{ "ids": ["id1", "id2"], "reason": "...", "merged_content": "..." }],
  "conflicts": [{ "ids": ["id1", "id2"], "description": "..." }],
  "archive_candidates": ["id1", "id2"],
  "top_memories": [{ "id": "...", "title": "...", "reason": "..." }],
  "summary": "이번 주 기억 상태 1줄 요약"
}`;

/**
 * 주간 자기 성찰 크론 (매주 월요일 09:00 KST)
 * 
 * 각 에이전트의 기억을 분석하여:
 * 1. 중복 기억 병합
 * 2. 모순 감지 & 보고
 * 3. 오래된 기억 아카이브
 * 4. 디스코드에 성찰 보고서 발송
 */
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  try {
    await ensureAllBrainTables();
    const p = getPool();
    if (!p) {
      return res.status(500).json({ ok: false, message: 'DB not configured' });
    }

    const results = [];
    const dateStr = new Date().toLocaleDateString("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric", month: "long", day: "numeric", weekday: "long"
    });

    for (const agentId of AGENTS) {
      try {
        const report = await reflectAgent(p, agentId);
        results.push({ agentId, ...report });
      } catch (err) {
        console.error(`[Reflection] ${agentId} failed:`, err.message);
        results.push({ agentId, error: err.message });
      }
    }

    // 디스코드 보고
    const discordMessage = buildDiscordReport(dateStr, results);
    if (DISCORD_WEBHOOK) {
      await sendToDiscord(discordMessage);
    }

    return res.status(200).json({ ok: true, results });
  } catch (err) {
    console.error("[Weekly Reflection Error]:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

async function reflectAgent(p, agentId) {
  // 전체 기억 로드
  const allMemories = await p.query(
    `SELECT id, memory_type, title, content, importance, tags, 
            created_at, last_accessed_at, access_count
     FROM agent_memories
     WHERE agent_id = $1 AND is_archived = FALSE
     ORDER BY importance DESC`,
    [agentId]
  );

  const memories = allMemories.rows;
  if (memories.length === 0) {
    return { total: 0, actions: [], summary: '기억 없음' };
  }

  // Step 1: 오래된 기억 자동 아카이브 (90일 미참조 + 중요도 3 이하)
  const autoArchived = await p.query(
    `UPDATE agent_memories SET is_archived = TRUE
     WHERE agent_id = $1 
       AND is_archived = FALSE
       AND importance <= 3
       AND (last_accessed_at IS NULL OR last_accessed_at < NOW() - INTERVAL '90 days')
     RETURNING id, title`,
    [agentId]
  );

  // Step 2: 접근 빈도 기반 중요도 자동 조정
  // 자주 접근된 기억은 importance 상승 (최대 10)
  await p.query(
    `UPDATE agent_memories SET importance = LEAST(importance + 1, 10)
     WHERE agent_id = $1 AND is_archived = FALSE AND access_count >= 10
       AND importance < 10`,
    [agentId]
  );

  // 접근이 거의 없는 기억은 importance 하락 (최소 1)
  await p.query(
    `UPDATE agent_memories SET importance = GREATEST(importance - 1, 1)
     WHERE agent_id = $1 AND is_archived = FALSE AND access_count <= 1
       AND created_at < NOW() - INTERVAL '30 days'
       AND importance > 1 AND memory_type != 'directive'`,
    [agentId]
  );

  // Step 3: Gemini로 심층 분석 (기억이 5개 이상인 경우만)
  let aiAnalysis = null;
  if (memories.length >= 5 && GEMINI_API_KEY) {
    try {
      const memoryText = memories.map(m =>
        `[${m.id}] (${m.memory_type}, imp:${m.importance}, access:${m.access_count}) ${m.title}: ${m.content}`
      ).join('\n');

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const result = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: `에이전트: ${agentId}\n\n기억 목록:\n${memoryText}` }] }],
        config: {
          systemInstruction: REFLECTION_PROMPT,
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        }
      });

      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      try {
        aiAnalysis = JSON.parse(text);
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        aiAnalysis = match ? JSON.parse(match[0]) : null;
      }

      // 중복 기억 자동 병합
      if (aiAnalysis?.duplicates?.length > 0) {
        for (const dup of aiAnalysis.duplicates) {
          if (dup.ids?.length >= 2 && dup.merged_content) {
            // 첫 번째 기억을 병합 내용으로 업데이트
            await p.query(
              `UPDATE agent_memories SET content = $1 WHERE id = $2`,
              [dup.merged_content, dup.ids[0]]
            );
            // 나머지 기억 아카이브
            for (let i = 1; i < dup.ids.length; i++) {
              await p.query(
                `UPDATE agent_memories SET is_archived = TRUE WHERE id = $1`,
                [dup.ids[i]]
              );
            }
          }
        }
      }
    } catch (err) {
      console.error(`[Reflection AI] ${agentId}:`, err.message);
    }
  }

  // 통계 갱신
  const stats = await getAgentBrainStats(agentId);

  return {
    total: stats?.totalMemories || 0,
    autoArchived: autoArchived.rows.length,
    duplicatesMerged: aiAnalysis?.duplicates?.length || 0,
    conflictsFound: aiAnalysis?.conflicts?.length || 0,
    summary: aiAnalysis?.summary || `${memories.length}개 기억 보유 중`,
    topMemories: aiAnalysis?.top_memories || [],
  };
}

function buildDiscordReport(dateStr, results) {
  let msg = `🧠 **[아날로그 홀리데이] 주간 두뇌 성찰 리포트**\n`;
  msg += `📅 **${dateStr}**\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  for (const r of results) {
    const icon = AGENT_ICONS[r.agentId] || '🤖';
    const name = AGENT_NAMES[r.agentId] || r.agentId;

    if (r.error) {
      msg += `${icon} **${name}** — ❌ 오류: ${r.error}\n\n`;
      continue;
    }

    msg += `${icon} **${name}의 두뇌 현황**\n`;
    msg += `📊 총 기억: **${r.total}개** | `;
    msg += `🗄️ 아카이브: ${r.autoArchived}건 | `;
    msg += `🔗 병합: ${r.duplicatesMerged}건`;
    if (r.conflictsFound > 0) msg += ` | ⚠️ 모순: ${r.conflictsFound}건`;
    msg += `\n`;
    msg += `💬 ${r.summary}\n`;

    if (r.topMemories?.length > 0) {
      msg += `🏆 핵심 기억: `;
      msg += r.topMemories.map(m => m.title).join(', ');
      msg += `\n`;
    }
    msg += `\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🤖 _각 에이전트가 자신의 기억을 정리하고 성장합니다._`;

  return msg;
}

async function sendToDiscord(content) {
  // 디스코드 메시지 길이 제한 (2000자)
  const trimmed = content.length > 1950 ? content.slice(0, 1950) + '...' : content;

  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: trimmed }),
    });
  } catch (err) {
    console.error('[Discord Webhook Error]:', err.message);
  }
}