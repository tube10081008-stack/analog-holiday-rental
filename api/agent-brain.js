import { getAdminKey } from "./_lib/reservations.js";
import {
  getRelevantMemories,
  getAgentPolicies,
  getSharedKnowledge,
  getAgentBrainStats,
  saveMemory,
  updateAgentPolicy,
  saveSharedKnowledge,
  ensureAllBrainTables,
} from "./_lib/agent-brain.js";
import { getNextTopic, getCurriculumSummary } from "./_lib/curriculum.js";
import { runAllAutonomousStudy, runAutonomousStudy } from "./_lib/autonomous-study.js";
import { GoogleGenAI } from "@google/genai";
import pg from "pg";

const { Pool } = pg;
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

let pool;
function getPool() {
  if (!pool && DATABASE_URL) pool = new Pool({ connectionString: DATABASE_URL, max: 3 });
  return pool;
}

/**
 * 에이전트 기억 관리 API
 * 
 * GET  /api/agent-brain?action=stats&key=...                    → 전체 에이전트 두뇌 현황
 * GET  /api/agent-brain?action=memories&agentId=geo&key=...     → 특정 에이전트 기억 목록
 * GET  /api/agent-brain?action=policies&agentId=geo&key=...     → 특정 에이전트 정책 목록
 * POST /api/agent-brain { action: "deleteMemory", memoryId, key }
 * POST /api/agent-brain { action: "updateMemory", memoryId, content, importance, key }
 * POST /api/agent-brain { action: "addMemory", agentId, memory_type, title, content, importance, tags, key }
 * POST /api/agent-brain { action: "archiveMemory", memoryId, key }
 */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // 쿼리 스트링 안전하게 파싱 (Vercel Node 런타임에 따라 req.query 누락 방지)
  if ((!req.query || Object.keys(req.query).length === 0) && req.url) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      req.query = {};
      for (const [key, val] of urlObj.searchParams.entries()) {
        req.query[key] = val;
      }
    } catch (e) {
      req.query = {};
    }
  }

  // Yale 학습 / 자율 학습 세션 — Vercel Cron 인증 확인
  const action = req.query?.action || req.body?.action;
  if (action === "study" || action === "self-study") {
    // Vercel Cron은 Authorization: Bearer <CRON_SECRET> 헤더를 전송
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers?.authorization;
    const adminKey = req.query?.key || req.body?.key;

    const isCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;
    const isAdminAuth = adminKey && adminKey === getAdminKey();

    if (!isCronAuth && !isAdminAuth) {
      return res.status(401).json({ ok: false, message: "크론 또는 관리자 인증이 필요합니다." });
    }

    await ensureAllBrainTables();
    if (action === "study") return handleStudySession(req, res);
    if (action === "self-study") return handleSelfStudy(req, res);
  }

  // 인증 확인
  const keyParam = req.query?.key || req.body?.key;
  const storedKey = getAdminKey();
  if (!keyParam || keyParam !== storedKey) {
    return res.status(401).json({ ok: false, message: "관리자 인증이 필요합니다." });
  }

  await ensureAllBrainTables();

  if (req.method === "GET") {
    return handleGet(req, res);
  }
  if (req.method === "POST") {
    return handlePost(req, res);
  }

  return res.status(405).json({ ok: false, message: "Method not allowed" });
}

async function handleGet(req, res) {
  const { action, agentId } = req.query;
  const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];

  try {
    switch (action) {
      case "stats": {
        // 전체 에이전트 두뇌 현황
        const statsPromises = AGENTS.map(async (id) => {
          const stats = await getAgentBrainStats(id);
          return stats || { agentId: id, totalMemories: 0, byType: [] };
        });
        const allStats = await Promise.all(statsPromises);
        return res.status(200).json({ ok: true, stats: allStats });
      }

      case "memories": {
        if (!agentId) return res.status(400).json({ ok: false, message: "agentId 필요" });
        // 전체 기억 (아카이브 포함)
        const p = getPool();
        const result = await p.query(
          `SELECT id, agent_id, memory_type, title, content, importance, tags, 
                  created_at, last_accessed_at, access_count, is_archived
           FROM agent_memories WHERE agent_id = $1
           ORDER BY is_archived ASC, importance DESC, created_at DESC
           LIMIT 500`,
          [agentId]
        );
        return res.status(200).json({ ok: true, memories: result.rows });
      }

      case "policies": {
        if (!agentId) return res.status(400).json({ ok: false, message: "agentId 필요" });
        const policies = await getAgentPolicies(agentId);
        return res.status(200).json({ ok: true, policies });
      }

      case "shared": {
        const shared = await getSharedKnowledge("all", 50);
        return res.status(200).json({ ok: true, shared });
      }

      default:
        return res.status(400).json({ ok: false, message: "올바른 action을 지정하세요 (stats, memories, policies, shared)" });
    }
  } catch (err) {
    console.error("[Brain API GET Error]:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

async function handlePost(req, res) {
  const { action } = req.body;

  try {
    switch (action) {
      case "addMemory": {
        const { agentId, memory_type, title, content, importance = 8, tags = [] } = req.body;
        if (!agentId || !title || !content) {
          return res.status(400).json({ ok: false, message: "agentId, title, content 필요" });
        }
        const id = await saveMemory(agentId, {
          memory_type: memory_type || 'directive',
          title,
          content,
          importance,
          tags,
        });
        return res.status(200).json({ ok: true, memoryId: id });
      }

      case "updateMemory": {
        const { memoryId, content: newContent, importance: newImportance } = req.body;
        if (!memoryId) return res.status(400).json({ ok: false, message: "memoryId 필요" });
        const p = getPool();
        const sets = [];
        const vals = [];
        let idx = 1;
        if (newContent !== undefined) { sets.push(`content = $${idx++}`); vals.push(newContent); }
        if (newImportance !== undefined) { sets.push(`importance = $${idx++}`); vals.push(newImportance); }
        if (sets.length === 0) return res.status(400).json({ ok: false, message: "수정할 항목 없음" });
        vals.push(memoryId);
        await p.query(`UPDATE agent_memories SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
        return res.status(200).json({ ok: true });
      }

      case "deleteMemory": {
        const { memoryId } = req.body;
        if (!memoryId) return res.status(400).json({ ok: false, message: "memoryId 필요" });
        const p = getPool();
        await p.query(`DELETE FROM agent_memories WHERE id = $1`, [memoryId]);
        return res.status(200).json({ ok: true });
      }

      case "archiveMemory": {
        const { memoryId } = req.body;
        if (!memoryId) return res.status(400).json({ ok: false, message: "memoryId 필요" });
        const p = getPool();
        await p.query(`UPDATE agent_memories SET is_archived = NOT is_archived WHERE id = $1`, [memoryId]);
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ ok: false, message: "올바른 action 필요 (addMemory, updateMemory, deleteMemory, archiveMemory)" });
    }
  } catch (err) {
    console.error("[Brain API POST Error]:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════
// 🎓 Yale School 야간 학습 세션
// ═══════════════════════════════════════════════════

async function handleStudySession(req, res) {
  const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];
  const agentParam = req.query?.agent || 'all';
  const count = parseInt(req.query?.count || '2');
  const targets = agentParam === 'all' ? AGENTS : AGENTS.filter(a => a === agentParam);
  if (!targets.length) return res.status(400).json({ error: `Unknown agent: ${agentParam}` });

  console.log(`[Yale] 🎓 학습 세션: ${targets.join(', ')} / ${count}건씩`);
  const results = [];

  for (const agentId of targets) {
    for (let i = 0; i < count; i++) {
      try {
        const studyCount = await getYaleStudyCount(agentId);
        const topic = getNextTopic(agentId, studyCount);
        if (!topic) { results.push({ agent: agentId, status: 'no_curriculum' }); continue; }

        const existingTitles = await getExistingTitles(agentId);
        const knowledge = await generateStudyKnowledge(agentId, topic, existingTitles);
        const savedId = await saveMemory(agentId, knowledge);

        console.log(`[Yale] ✅ ${topic.agentName}: "${knowledge.title}"`);
        results.push({ agent: agentId, status: 'success', learned: knowledge.title, progress: topic.progress, savedId });
      } catch (err) {
        console.error(`[Yale] ❌ ${agentId}:`, err.message);
        results.push({ agent: agentId, status: 'error', error: err.message });
      }
      if (i < count - 1) await new Promise(r => setTimeout(r, 1000));
    }
    await new Promise(r => setTimeout(r, 500));
  }

  const success = results.filter(r => r.status === 'success').length;
  return res.status(200).json({ session: new Date().toISOString(), totalLearned: success, results });
}

async function getYaleStudyCount(agentId) {
  const p = getPool();
  if (!p) return 0;
  try {
    const res = await p.query(`SELECT COUNT(*) as cnt FROM agent_memories WHERE agent_id = $1 AND title LIKE '%[Yale]%'`, [agentId]);
    return parseInt(res.rows[0].cnt) || 0;
  } catch { return 0; }
}

async function getExistingTitles(agentId) {
  const p = getPool();
  if (!p) return [];
  try {
    const res = await p.query(`SELECT title FROM agent_memories WHERE agent_id = $1`, [agentId]);
    return res.rows.map(r => r.title);
  } catch { return []; }
}

async function generateStudyKnowledge(agentId, topic, existingTitles) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set');
  const ai = new GoogleGenAI({ apiKey: key });
  const curriculum = getCurriculumSummary(agentId);

  const prompt = `당신은 ${topic.school}의 ${topic.semester} 담당 교수입니다.
학생 '${topic.agentName}'은 '아날로그 홀리데이'라는 여행 장비 렌탈 서비스 회사의 AI 에이전트입니다.

## 수업 주제: ${topic.title}
적용: ${topic.focus} / 학위: ${curriculum.degree}

## 기존 지식 (중복 금지)
${existingTitles.slice(-15).map(t => `- ${t}`).join('\n')}

## 요구사항
아날로그 홀리데이에 바로 적용 가능한 실전 지식 1건. 수치/공식/프레임워크 필수. 150자 이내. 한국어.

## JSON만 출력
{"title":"제목 20자 이내", "content":"핵심 지식 150자 이내", "importance": 7~9}`;

  const result = await ai.models.generateContent({ model: 'gemini-3.5-flash', contents: prompt, config: { temperature: 0.7 } });
  const text = result.text.trim();
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error('AI 파싱 실패');
  const parsed = JSON.parse(jsonMatch[0]);

  return {
    memory_type: 'fact',
    title: `[Yale] ${parsed.title}`,
    content: parsed.content,
    importance: Math.min(Math.max(parsed.importance || 7, 6), 9),
    tags: ['yale_school', agentId]
  };
}

// ═══════════════════════════════════════════════════
// 🧠 자율 학습 세션 (Self-Directed Study)
// ═══════════════════════════════════════════════════

async function handleSelfStudy(req, res) {
  const agentParam = req.query?.agent || 'all';
  const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];

  console.log(`[Self-Study] 🧠 자율 학습 시작: ${agentParam}`);

  try {
    let result;
    if (agentParam === 'all') {
      result = await runAllAutonomousStudy();
    } else if (AGENTS.includes(agentParam)) {
      const singleResult = await runAutonomousStudy(agentParam);
      result = { session: new Date().toISOString(), totalLearned: singleResult.learned?.filter(l => l.savedId)?.length || 0, results: [singleResult] };
    } else {
      return res.status(400).json({ error: `Unknown agent: ${agentParam}` });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[Self-Study] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

