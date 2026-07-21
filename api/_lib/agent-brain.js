import { GoogleGenAI } from "@google/genai";
import pg from "pg";
import { writeMemoryToMD, writeSharedKnowledgeToMD, rebuildVault } from './agent-wiki.js';

const { Pool } = pg;
function getDbUrl() { return process.env.DATABASE_URL || process.env.POSTGRES_URL || ""; }
function getGeminiKey() { return process.env.GEMINI_API_KEY; }

let brainPool;
let memoriesTableReady;
let policiesTableReady;
let sharedKnowledgeTableReady;
let studyArchivesTableReady;
let gpaHistoryTableReady;

export function getPool() {
  const dbUrl = getDbUrl();
  if (!brainPool && dbUrl) {
    brainPool = new Pool({ connectionString: dbUrl, max: 3 });
  }
  return brainPool;
}

// ═══════════════════════════════════════════════════
// 📦 DB 테이블 생성
// ═══════════════════════════════════════════════════

async function ensureMemoriesTable() {
  const pool = getPool();
  if (!pool || memoriesTableReady) return;
  memoriesTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      source_chat_ids TEXT DEFAULT '',
      tags TEXT[] DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed_at TIMESTAMPTZ DEFAULT NOW(),
      access_count INTEGER DEFAULT 0,
      expires_at TIMESTAMPTZ,
      is_archived BOOLEAN DEFAULT FALSE
    );
    CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_id, is_archived);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON agent_memories(agent_id, memory_type);
    CREATE INDEX IF NOT EXISTS idx_memories_importance ON agent_memories(agent_id, importance DESC);
  `).catch(() => { memoriesTableReady = null; });
  await memoriesTableReady;
}

async function ensurePoliciesTable() {
  const pool = getPool();
  if (!pool || policiesTableReady) return;
  policiesTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS agent_policies (
      id SERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      policy_key TEXT NOT NULL,
      policy_value TEXT NOT NULL,
      reason TEXT DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(agent_id, policy_key)
    );
    CREATE INDEX IF NOT EXISTS idx_policies_agent ON agent_policies(agent_id);
  `).catch(() => { policiesTableReady = null; });
  await policiesTableReady;
}

async function ensureSharedKnowledgeTable() {
  const pool = getPool();
  if (!pool || sharedKnowledgeTableReady) return;
  sharedKnowledgeTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS shared_knowledge (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_by TEXT NOT NULL,
      visible_to TEXT[] DEFAULT '{all}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_shared_category ON shared_knowledge(category);
  `).catch(() => { sharedKnowledgeTableReady = null; });
  await sharedKnowledgeTableReady;
}

// 📚 학습 아카이브 (에세이 + 평가 전문 보존)
async function ensureStudyArchivesTable() {
  const pool = getPool();
  if (!pool || studyArchivesTableReady) return;
  studyArchivesTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS study_archives (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      essay TEXT NOT NULL,
      evaluation JSONB DEFAULT '{}',
      overall_gpa REAL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_study_archives_agent ON study_archives(agent_id, created_at DESC);
  `).catch(() => { studyArchivesTableReady = null; });
  await studyArchivesTableReady;
}

// 📊 GPA 이력 추적
async function ensureGPAHistoryTable() {
  const pool = getPool();
  if (!pool || gpaHistoryTableReady) return;
  gpaHistoryTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS agent_gpa_history (
      id SERIAL PRIMARY KEY,
      agent_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      goal_alignment REAL DEFAULT 0,
      plan_quality REAL DEFAULT 0,
      action_execution REAL DEFAULT 0,
      critique_revision REAL DEFAULT 0,
      overall_gpa REAL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gpa_agent ON agent_gpa_history(agent_id, created_at DESC);
  `).catch(() => { gpaHistoryTableReady = null; });
  await gpaHistoryTableReady;
}

// 🔗 연관 기억 컨네 칼럼 추가 (Knowledge Graph 용)
async function ensureRelatedMemoryColumn() {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(`ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS related_memory_ids TEXT[] DEFAULT '{}'`);
  } catch { /* column may already exist */ }
}

export async function ensureAllBrainTables() {
  await Promise.all([
    ensureMemoriesTable(),
    ensurePoliciesTable(),
    ensureSharedKnowledgeTable(),
    ensureStudyArchivesTable(),
    ensureGPAHistoryTable(),
  ]);
  // 칼럼 추가는 테이블 생성 후 실행
  await ensureRelatedMemoryColumn();
}

// ═══════════════════════════════════════════════════
// 🤝 크로스 에이전트 공유 (Cross-Agent Sharing)
// ═══════════════════════════════════════════════════

const AGENT_NAME_MAP = {
  hani: ['하니', 'Hani'],
  geo: ['지오', 'Geo'],
  noah: ['노아', 'Noah'],
  lina: ['리나', 'Lina'],
  alex: ['알렉스', 'Alex'],
};

const SHARING_KEYWORDS = [
  '공유', '전달', '알려', '미팅', '협업', '논의',
  '브리핑', '전해', '소통', '함께', '같이', '연동',
];

const SHARING_EXTRACTION_PROMPT = `당신은 AI 에이전트 팀의 지식 공유 관리자입니다.
아래 대화에서 한 에이전트가 다른 에이전트에게 공유할 핵심 내용을 추출하세요.

반드시 아래 JSON 형식 하나만 반환. 줄바꿈 없이 한 줄로 출력:
{"title":"제목20자이내","content":"핵심내용100자이내","category":"strategy|insight|request|data"}

공유할 내용이 없으면 null을 반환.`;

// ═══════════════════════════════════════════════════
// 🧠 기억 추출 (Memory Extraction Pipeline)
// ═══════════════════════════════════════════════════

const EXTRACTION_PROMPT = `당신은 AI 에이전트의 기억 관리자입니다.
아래 대화에서 **장기적으로 기억해야 할 핵심 정보만** 추출하세요.

## 분류 기준 (memory_type)
- directive: 대표님이 직접 지시한 업무 방식, 규칙 변경 (가장 중요)
- fact: 고객/상품/배송/비즈니스에 관한 새로운 사실
- preference: 대표님의 선호도, 스타일, 톤 관련 피드백
- lesson: 실수나 문제 상황에서 배운 교훈
- context: 시즌 정보, 이벤트, 장기 맥락

## importance 산정 기준 (1~10)
- 10: 대표님의 직접 명령, 절대 규칙
- 7~9: 업무 프로세스 변경, 중요한 고객 정보
- 4~6: 일반적인 사실, 맥락 정보
- 1~3: 참고용 부가 정보

## 저장하지 말 것
- 단순 인사, 잡담, 감탄사
- 이미 알려진 기본 업무 규칙 (시스템에 내장된 것)
- 일회성 질문과 답변 (장기적 가치 없음)
- 대화의 감정적 뉘앙스 (사실만 저장)

## 출력 형식
반드시 아래 JSON 배열만 반환하세요. 설명 텍스트 없이 순수 JSON만:
[
  {
    "memory_type": "directive|fact|preference|lesson|context",
    "title": "한 줄 제목 (20자 이내)",
    "content": "구체적 내용 (100자 이내, 명확하고 실행 가능한 문장)",
    "importance": 1-10,
    "tags": ["태그1", "태그2"]
  }
]

기억할 것이 없으면 빈 배열 [] 반환.`;

/**
 * 대화 내용에서 장기 기억을 추출합니다.
 * @param {string} agentId - 에이전트 ID
 * @param {Array} recentMessages - 최근 대화 메시지 배열
 * @returns {Array} 추출된 기억 목록
 */
export async function extractMemories(agentId, recentMessages) {
  if (!getGeminiKey() || !recentMessages || recentMessages.length < 3) {
    return []; // 3턴 미만이면 추출하지 않음 (비용 절약)
  }

  try {
    const conversationText = recentMessages.map(m => {
      const who = m.role === 'user'
        ? (m.senderName ? `[${m.senderName} 대표]` : '[대표님]')
        : `[${agentId}]`;
      return `${who}: ${m.content}`;
    }).join('\n');

    const ai = new GoogleGenAI({ apiKey: getGeminiKey() });
    const result = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: `에이전트: ${agentId}\n\n대화 내용:\n${conversationText}` }] }],
      config: {
        systemInstruction: EXTRACTION_PROMPT,
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      }
    });

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';

    // JSON 파싱 (3단계 폴백 — Gemini 멀티라인/트레일링 텍스트 대응)
    let memories;
    try {
      // 1차: 직접 파싱
      memories = JSON.parse(text);
    } catch {
      try {
        // 2차: 줄바꿈 정리 + 대괄호 블록만 추출
        const cleaned = text.replace(/[\r\n]+/g, '\n').trim();
        const bracketMatch = cleaned.match(/\[[\s\S]*\]/);
        if (bracketMatch) {
          memories = JSON.parse(bracketMatch[0]);
        } else {
          memories = [];
        }
      } catch {
        // 3차: 개별 JSON 객체 추출 (최후 폴백)
        try {
          const objects = [...text.matchAll(/\{[^{}]+\}/g)].map(m => {
            try { return JSON.parse(m[0]); } catch { return null; }
          }).filter(Boolean);
          memories = objects.length > 0 ? objects : [];
        } catch {
          memories = [];
        }
      }
    }

    if (!Array.isArray(memories)) return [];

    // 스키마 검증 & 정규화
    return memories
      .filter(m => m.memory_type && m.title && m.content)
      .map(m => ({
        memory_type: ['directive', 'fact', 'preference', 'lesson', 'context'].includes(m.memory_type)
          ? m.memory_type : 'context',
        title: String(m.title).slice(0, 60),
        content: String(m.content).slice(0, 300),
        importance: Math.min(10, Math.max(1, Number(m.importance) || 5)),
        tags: Array.isArray(m.tags) ? m.tags.map(t => String(t).slice(0, 30)).slice(0, 5) : [],
      }));
  } catch (err) {
    console.error(`[Brain] Memory extraction failed for ${agentId}:`, err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════
// 💾 기억 저장 (Save Memory)
// ═══════════════════════════════════════════════════

/**
 * 추출된 기억을 DB에 저장합니다. 제목이 유사한 기억이 있으면 업데이트합니다.
 */
export async function saveMemory(agentId, memory) {
  const pool = getPool();
  if (!pool) return null;
  await ensureMemoriesTable();

  const id = `mem_${agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    // 동일 에이전트의 유사 제목 기억이 있는지 확인 (중복 방지)
    const existing = await pool.query(
      `SELECT id, importance, access_count FROM agent_memories 
       WHERE agent_id = $1 AND title = $2 AND is_archived = FALSE
       LIMIT 1`,
      [agentId, memory.title]
    );

    if (existing.rows.length > 0) {
      // 기존 기억 업데이트 (내용 갱신 + 중요도 최대값 유지)
      const row = existing.rows[0];
      const newImportance = Math.max(row.importance, memory.importance);
      await pool.query(
        `UPDATE agent_memories 
         SET content = $1, importance = $2, tags = $3, 
             last_accessed_at = NOW(), access_count = access_count + 1
         WHERE id = $4`,
        [memory.content, newImportance, memory.tags, row.id]
      );
      return row.id;
    }

    // 새 기억 저장
    await pool.query(
      `INSERT INTO agent_memories (id, agent_id, memory_type, title, content, importance, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, agentId, memory.memory_type, memory.title, memory.content, memory.importance, memory.tags]
    );

    // 🔗 Fix 7: Knowledge Graph — 연관 기억 자동 링크
    try {
      const keywords = (memory.title + ' ' + memory.content).replace(/[\[\]()]/g, '').split(/\s+/).filter(w => w.length > 2).slice(0, 5);
      if (keywords.length > 0) {
        const likeConditions = keywords.map((_, i) => `(title ILIKE $${i + 3} OR content ILIKE $${i + 3})`).join(' OR ');
        const likeParams = keywords.map(k => `%${k}%`);
        const related = await pool.query(
          `SELECT id FROM agent_memories WHERE agent_id = $1 AND id != $2 AND is_archived = FALSE AND (${likeConditions}) LIMIT 5`,
          [agentId, id, ...likeParams]
        );
        if (related.rows.length > 0) {
          const relatedIds = related.rows.map(r => r.id);
          await pool.query(`UPDATE agent_memories SET related_memory_ids = $1 WHERE id = $2`, [relatedIds, id]);
          // 양방향 링크: 기존 기억들에도 새 기억 ID 추가
          await pool.query(
            `UPDATE agent_memories SET related_memory_ids = array_append(related_memory_ids, $1) WHERE id = ANY($2) AND NOT ($1 = ANY(related_memory_ids))`,
            [id, relatedIds]
          );
        }
      }
    } catch (linkErr) {
      console.warn(`[Brain] Knowledge link skipped:`, linkErr.message);
    }

    // 📝 Dual-Write: MD 파일도 동시 생성
    try {
      writeMemoryToMD(agentId, { id, ...memory });
    } catch (mdErr) {
      console.warn(`[Brain] MD write skipped:`, mdErr.message);
    }
    return id;
  } catch (err) {
    console.error(`[Brain] Save memory failed:`, err.message);
    return null;
  }
}

/**
 * Fix 6: 기억 강화 — 대화에서 실제 활용된 기억의 중요도를 강화합니다.
 */
export async function reinforceMemories(agentId, usedMemoryIds) {
  const pool = getPool();
  if (!pool || !usedMemoryIds?.length) return;
  try {
    await pool.query(
      `UPDATE agent_memories SET importance = LEAST(importance + 1, 10), last_accessed_at = NOW() WHERE id = ANY($1) AND agent_id = $2`,
      [usedMemoryIds, agentId]
    );
    console.log(`[Brain] 💪 ${agentId}: ${usedMemoryIds.length}개 기억 강화`);
  } catch (err) {
    console.warn(`[Brain] Reinforce failed:`, err.message);
  }
}

/**
 * Fix 2+3: 학습 아카이브 저장 + GPA 이력 저장
 */
export async function saveStudyArchive(agentId, topic, essay, evaluation) {
  const pool = getPool();
  if (!pool) return;
  const archiveId = `sa_${agentId}_${Date.now()}`;
  try {
    await pool.query(
      `INSERT INTO study_archives (id, agent_id, topic, essay, evaluation, overall_gpa) VALUES ($1, $2, $3, $4, $5, $6)`,
      [archiveId, agentId, topic, essay, JSON.stringify(evaluation), evaluation.overallGPA || 0]
    );
  } catch (err) { console.warn(`[Brain] Archive save failed:`, err.message); }

  // GPA 도메인별 이력 저장
  try {
    const g = evaluation.grades || {};
    await pool.query(
      `INSERT INTO agent_gpa_history (agent_id, topic, goal_alignment, plan_quality, action_execution, critique_revision, overall_gpa) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [agentId, topic, g.goalAlignment?.gpa || 0, g.planQuality?.gpa || 0, g.actionExecution?.gpa || 0, g.critiqueRevision?.gpa || 0, evaluation.overallGPA || 0]
    );
  } catch (err) { console.warn(`[Brain] GPA history save failed:`, err.message); }
}

/**
 * Fix 1+3: 최근 GPA 이력 조회 (selfAssess & 교수 평가용)
 */
export async function getGPAHistory(agentId, limit = 5) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT topic, goal_alignment, plan_quality, action_execution, critique_revision, overall_gpa, created_at FROM agent_gpa_history WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
    return res.rows;
  } catch { return []; }
}

/**
 * Fix 5: Yale 커리큐럼 진도 조회 (자율학습 연동용)
 */
export async function getYaleProgress(agentId) {
  const pool = getPool();
  if (!pool) return { count: 0, recentTopics: [] };
  try {
    const countRes = await pool.query(`SELECT COUNT(*) as cnt FROM agent_memories WHERE agent_id = $1 AND title LIKE '%[Yale]%'`, [agentId]);
    const recentRes = await pool.query(`SELECT title FROM agent_memories WHERE agent_id = $1 AND title LIKE '%[Yale]%' ORDER BY created_at DESC LIMIT 5`, [agentId]);
    return {
      count: parseInt(countRes.rows[0]?.cnt) || 0,
      recentTopics: recentRes.rows.map(r => r.title.replace('[Yale] ', '')),
    };
  } catch { return { count: 0, recentTopics: [] }; }
}

// ═══════════════════════════════════════════════════
// Lean Study Loop v2: Progressive Loading DB 함수
// ═══════════════════════════════════════════════════

/** L0 Frontmatter: 교수의 마지막 recommendation 조회 */
export async function getLastRecommendation(agentId) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT topic, overall_gpa, evaluation->>'recommendation' as recommendation 
       FROM study_archives 
       WHERE agent_id = $1 AND evaluation->>'recommendation' IS NOT NULL AND evaluation->>'recommendation' != '' 
       ORDER BY created_at DESC LIMIT 1`,
      [agentId]
    );
    return res.rows[0] || null;
  } catch { return null; }
}

/** L0 Frontmatter: 가장 약한 GPA 도메인 반환 */
export async function getWeakestDomain(agentId) {
  const pool = getPool();
  if (!pool) return null;
  try {
    const res = await pool.query(
      `SELECT AVG(goal_alignment) as g, AVG(plan_quality) as p, AVG(action_execution) as a, AVG(critique_revision) as c FROM agent_gpa_history WHERE agent_id = $1`,
      [agentId]
    );
    const row = res.rows[0];
    if (!row || (row.g === null && row.p === null)) return null;
    const domains = [
      { domain: 'goal_alignment', avg: parseFloat(row.g) || 0 },
      { domain: 'plan_quality', avg: parseFloat(row.p) || 0 },
      { domain: 'action_execution', avg: parseFloat(row.a) || 0 },
      { domain: 'critique_revision', avg: parseFloat(row.c) || 0 },
    ];
    return domains.sort((a, b) => a.avg - b.avg)[0].domain;
  } catch { return null; }
}

/** L0 Frontmatter: 과거 학습 주제 목록 (제목만, 내용 X) */
export async function getPastTopics(agentId, limit = 10) {
  const pool = getPool();
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT topic FROM study_archives WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
    return res.rows.map(r => r.topic);
  } catch { return []; }
}

/**
 * 대화 후 자동 기억 추출 + 저장 파이프라인
 */
export async function runMemoryPipeline(agentId, recentMessages) {
  const memories = await extractMemories(agentId, recentMessages);
  const savedIds = [];
  for (const mem of memories) {
    const id = await saveMemory(agentId, mem);
    if (id) savedIds.push(id);
  }
  if (savedIds.length > 0) {
    console.log(`[Brain] ${agentId}: ${savedIds.length}개 기억 저장/갱신 완료`);
  }
  return savedIds;
}

/**
 * 대화에서 다른 에이전트와의 공유 의도를 감지하고 shared_knowledge에 저장합니다.
 * Step 1: 키워드 매칭 (비용 0)
 * Step 2: AI 추출 (공유 의도 감지 시에만 실행)
 */
export async function detectAndShareCrossAgentKnowledge(fromAgentId, recentMessages) {
  if (!getGeminiKey() || !recentMessages || recentMessages.length < 2) {
    console.log(`[Brain] Cross-agent skip: no API key or < 2 messages (${fromAgentId})`);
    return [];
  }

  try {
    // ── Step 1: 다른 에이전트 이름 언급 + 공유 의도 키워드 감지 ──
    const fullText = recentMessages.map(m => m.content || '').join(' ');

    const mentionedAgents = Object.entries(AGENT_NAME_MAP)
      .filter(([id]) => id !== fromAgentId)
      .filter(([, names]) => names.some(name => fullText.includes(name)))
      .map(([id]) => id);

    console.log(`[Brain] Cross-agent Step1: ${fromAgentId} mentioned=[${mentionedAgents}]`);

    if (mentionedAgents.length === 0) return []; // 다른 에이전트 언급 없음

    const hasShareIntent = SHARING_KEYWORDS.some(kw => fullText.includes(kw));
    console.log(`[Brain] Cross-agent Step1: shareIntent=${hasShareIntent}`);
    if (!hasShareIntent) return []; // 공유 의도 키워드 없음

    // ── Step 2: AI로 공유할 핵심 내용 추출 ──
    const conversationText = recentMessages.slice(-6).map(m => {
      const who = m.role === 'user'
        ? (m.senderName ? `[${m.senderName} 대표]` : '[대표님]')
        : `[${fromAgentId}]`;
      return `${who}: ${m.content}`;
    }).join('\n');

    const targetNames = mentionedAgents.map(id => AGENT_NAME_MAP[id][0]).join(', ');

    const ai = new GoogleGenAI({ apiKey: getGeminiKey() });
    const result = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{
        role: 'user',
        parts: [{ text: `발신: ${AGENT_NAME_MAP[fromAgentId][0]}\n수신: ${targetNames}\n\n대화:\n${conversationText}` }],
      }],
      config: {
        systemInstruction: SHARING_EXTRACTION_PROMPT,
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    });

    const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || 'null';
    console.log(`[Brain] Cross-agent Step2: AI raw (${text.length}ch): ${text.substring(0, 300)}`);
    
    let parsed = null;
    
    // 1차: 직접 파싱 (가장 빠름)
    try {
      const raw = JSON.parse(text);
      parsed = Array.isArray(raw) ? raw[0] : raw;
    } catch (e1) {
      console.log(`[Brain] Cross-agent: 1차 파싱 실패 — ${e1.message}`);
      
      // 2차: 줄바꿈/공백 정리 후 파싱
      try {
        const cleaned = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        const raw = JSON.parse(cleaned);
        parsed = Array.isArray(raw) ? raw[0] : raw;
      } catch (e2) {
        console.log(`[Brain] Cross-agent: 2차 파싱 실패 — ${e2.message}`);
        
        // 3차: 정규식으로 필드 직접 추출 (최후 폴백)
        const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
        const contentMatch = text.match(/"content"\s*:\s*"([^"]+)"/);
        const categoryMatch = text.match(/"category"\s*:\s*"([^"]+)"/);
        if (titleMatch && contentMatch) {
          parsed = {
            title: titleMatch[1],
            content: contentMatch[1],
            category: categoryMatch?.[1] || 'insight'
          };
          console.log(`[Brain] Cross-agent: 3차 정규식 폴백 성공`);
        } else {
          console.error(`[Brain] Cross-agent Step2: 모든 JSON 파싱 실패`);
          return [];
        }
      }
    }

    if (!parsed || !parsed.title || !parsed.content) {
      console.error(`[Brain] Cross-agent Step2: 파싱 결과 필드 누락:`, JSON.stringify(parsed));
      return [];
    }
    console.log(`[Brain] Cross-agent Step2: 파싱 성공 — "${parsed.title}"`);

    // ── Step 3: shared_knowledge에 저장 ──
    const savedIds = [];
    for (const targetAgent of mentionedAgents) {
      const fromName = AGENT_NAME_MAP[fromAgentId][0];
      const toName = AGENT_NAME_MAP[targetAgent][0];
      const id = `share_${fromAgentId}_${targetAgent}_${Date.now()}`;

      const success = await saveSharedKnowledge({
        id,
        category: parsed.category || 'insight',
        title: `💌 ${fromName}→${toName}: ${parsed.title}`,
        content: parsed.content,
        createdBy: fromAgentId,
        visibleTo: [targetAgent, fromAgentId],
      });

      if (success) {
        savedIds.push(id);
        console.log(`[Brain] 🤝 크로스 에이전트 공유: ${fromName}→${toName} "${parsed.title}"`);
      }
    }

    return savedIds;
  } catch (err) {
    console.error(`[Brain] Cross-agent sharing detection failed:`, err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════
// 🔍 기억 검색 (Memory Retrieval)
// ═══════════════════════════════════════════════════

/**
 * 에이전트의 관련 기억을 가져옵니다.
 * - 높은 importance 순
 * - directive 타입 우선
 * - 최근 접근된 것 우선
 */
export async function getRelevantMemories(agentId, limit = 15) {
  const pool = getPool();
  if (!pool) return [];
  await ensureMemoriesTable();

  try {
    const result = await pool.query(
      `SELECT id, memory_type, title, content, importance, tags, created_at
       FROM agent_memories
       WHERE agent_id = $1 AND is_archived = FALSE
       ORDER BY
         CASE WHEN memory_type = 'directive' THEN 0 ELSE 1 END,
         importance DESC,
         last_accessed_at DESC NULLS LAST
       LIMIT $2`,
      [agentId, limit]
    );

    // 접근 기록 업데이트 (비동기, 응답 블로킹 안 함)
    if (result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      pool.query(
        `UPDATE agent_memories SET last_accessed_at = NOW(), access_count = access_count + 1
         WHERE id = ANY($1)`,
        [ids]
      ).catch(() => { }); // fire-and-forget
    }

    return result.rows;
  } catch (err) {
    console.error(`[Brain] Get memories failed for ${agentId}:`, err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════
// 📋 행동 정책 (Agent Policies)
// ═══════════════════════════════════════════════════

/**
 * 에이전트의 행동 정책을 가져옵니다.
 */
export async function getAgentPolicies(agentId) {
  const pool = getPool();
  if (!pool) return [];
  await ensurePoliciesTable();

  try {
    const result = await pool.query(
      `SELECT policy_key, policy_value, reason FROM agent_policies WHERE agent_id = $1`,
      [agentId]
    );
    return result.rows;
  } catch (err) {
    console.error(`[Brain] Get policies failed for ${agentId}:`, err.message);
    return [];
  }
}

/**
 * 에이전트 행동 정책을 업데이트합니다. (upsert)
 */
export async function updateAgentPolicy(agentId, policyKey, policyValue, reason = '') {
  const pool = getPool();
  if (!pool) return false;
  await ensurePoliciesTable();

  try {
    await pool.query(
      `INSERT INTO agent_policies (agent_id, policy_key, policy_value, reason, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (agent_id, policy_key) DO UPDATE
       SET policy_value = $3, reason = $4, updated_at = NOW()`,
      [agentId, policyKey, policyValue, reason]
    );
    return true;
  } catch (err) {
    console.error(`[Brain] Update policy failed:`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════
// 🌐 공유 지식 (Shared Knowledge)
// ═══════════════════════════════════════════════════

/**
 * 에이전트가 접근 가능한 공유 지식을 가져옵니다.
 */
export async function getSharedKnowledge(agentId, limit = 10) {
  const pool = getPool();
  if (!pool) return [];
  await ensureSharedKnowledgeTable();

  try {
    const result = await pool.query(
      `SELECT id, category, title, content FROM shared_knowledge
       WHERE 'all' = ANY(visible_to) OR $1 = ANY(visible_to)
       ORDER BY updated_at DESC
       LIMIT $2`,
      [agentId, limit]
    );
    return result.rows;
  } catch (err) {
    console.error(`[Brain] Get shared knowledge failed:`, err.message);
    return [];
  }
}

/**
 * 공유 지식을 추가/업데이트합니다.
 */
export async function saveSharedKnowledge({ id, category, title, content, createdBy, visibleTo = ['all'] }) {
  const pool = getPool();
  if (!pool) {
    console.error(`[Brain] saveSharedKnowledge: DB pool 없음 (DATABASE_URL=${getDbUrl() ? '있음' : '없음'})`);
    return false;
  }
  await ensureSharedKnowledgeTable();

  try {
    await pool.query(
      `INSERT INTO shared_knowledge (id, category, title, content, created_by, visible_to, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id) DO UPDATE
       SET content = $4, updated_at = NOW()`,
      [id, category, title, content, createdBy, visibleTo]
    );
    // 📝 Dual-Write: MD 파일도 동시 생성
    try {
      writeSharedKnowledgeToMD({ id, category, title, content, createdBy, visibleTo });
    } catch (mdErr) {
      console.warn(`[Brain] Shared MD write skipped:`, mdErr.message);
    }
    return true;
  } catch (err) {
    console.error(`[Brain] Save shared knowledge failed:`, err.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════
// 🔧 기억 주입용 프롬프트 빌더 (Memory Context Builder)
// ═══════════════════════════════════════════════════

const MEMORY_TYPE_LABELS = {
  directive: '📌 대표님 지시사항',
  fact: '📋 업무 지식',
  preference: '💡 대표님 선호',
  lesson: '⚠️ 과거 교훈',
  context: '🌐 맥락 정보',
};

/**
 * 에이전트의 장기 기억 + 정책 + 공유 지식을 시스템 프롬프트용 텍스트로 빌드합니다.
 */
export async function buildMemoryContext(agentId) {
  const [memories, policies, shared] = await Promise.all([
    getRelevantMemories(agentId, 15),
    getAgentPolicies(agentId),
    getSharedKnowledge(agentId, 8),
  ]);

  // Fix 6: 대화에 주입된 기억 ID 추적 (나중에 reinforceMemories로 강화)
  const usedMemoryIds = memories.map(m => m.id);

  const sections = [];

  // 1. 장기 기억
  if (memories.length > 0) {
    const grouped = {};
    for (const m of memories) {
      const label = MEMORY_TYPE_LABELS[m.memory_type] || '📋 기타';
      if (!grouped[label]) grouped[label] = [];
      grouped[label].push(`- ${m.title}: ${m.content}`);
    }

    sections.push('═══════════════════════════════════');
    sections.push('🧠 나의 장기 기억 (Brain Memory)');
    sections.push('═══════════════════════════════════');
    for (const [label, items] of Object.entries(grouped)) {
      sections.push(`\n${label}:`);
      sections.push(...items);
    }
  }

  // 2. 행동 정책
  if (policies.length > 0) {
    sections.push('\n═══════════════════════════════════');
    sections.push('⚙️ 나의 행동 정책 (Policies)');
    sections.push('═══════════════════════════════════');
    for (const p of policies) {
      sections.push(`- ${p.policy_key}: ${p.policy_value}${p.reason ? ` (이유: ${p.reason})` : ''}`);
    }
  }

  // 3. 공유 지식 (다른 에이전트가 전달한 내용 — 반드시 인식하고 답변에 반영할 것)
  if (shared.length > 0) {
    sections.push('\n═══════════════════════════════════');
    sections.push('📨 다른 팀원이 나에게 직접 전달한 업무 내용 (실제 수신 완료)');
    sections.push('아래는 다른 에이전트가 나에게 공유한 실제 업무 내용입니다.');
    sections.push('누군가 "전달받은 내용 있냐"고 물으면, 아래 내용을 요약해서 답하세요.');
    sections.push('═══════════════════════════════════');
    for (const s of shared) {
      sections.push(`- [${s.category}] ${s.title}: ${s.content}`);
    }
  }

  // Fix 6: 컨텍스트 텍스트 + 사용된 기억 ID 반환
  return { text: sections.join('\n'), usedMemoryIds };
}

// ═══════════════════════════════════════════════════
// 📊 에이전트 기억 통계 (Admin용)
// ═══════════════════════════════════════════════════

/**
 * 에이전트의 기억 현황 요약을 반환합니다.
 */
export async function getAgentBrainStats(agentId) {
  const pool = getPool();
  if (!pool) return null;
  await ensureMemoriesTable();

  try {
    const result = await pool.query(
      `SELECT 
         memory_type,
         COUNT(*) as count,
         ROUND(AVG(importance), 1) as avg_importance
       FROM agent_memories
       WHERE agent_id = $1 AND is_archived = FALSE
       GROUP BY memory_type
       ORDER BY count DESC`,
      [agentId]
    );

    const total = await pool.query(
      `SELECT COUNT(*) as total FROM agent_memories WHERE agent_id = $1 AND is_archived = FALSE`,
      [agentId]
    );

    return {
      agentId,
      totalMemories: parseInt(total.rows[0]?.total || '0'),
      byType: result.rows,
    };
  } catch (err) {
    console.error(`[Brain] Stats failed:`, err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════
// 🕐 환경 컨텍스트 빌더 (14. 날짜/시간, 15. 계절/이벤트)
// ═══════════════════════════════════════════════════

function buildEnvironmentContext() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  const kstDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const hours = kstDate.getHours();
  const timeOfDay = hours < 6 ? '새벽' : hours < 12 ? '오전' : hours < 18 ? '오후' : '저녁';
  const month = kstDate.getMonth() + 1;
  const day = kstDate.getDate();

  const seasons = { 12:'겨울',1:'겨울',2:'겨울',3:'봄',4:'봄',5:'봄',6:'여름',7:'여름',8:'여름',9:'가을',10:'가을',11:'가을' };
  const season = seasons[month];
  const isPeak = [6,7,8,12,1].includes(month);

  // 주요 이벤트/시즌 감지
  const events = [];
  if (month === 1 && day <= 3) events.push('🎍 새해');
  if (month === 2 && day === 14) events.push('💝 발렌타인');
  if (month === 3 && day === 14) events.push('🍬 화이트데이');
  if (month === 5 && day <= 5) events.push('🧒 어린이날 시즌');
  if (month === 5 && (day >= 8 && day <= 14)) events.push('💐 가정의 달');
  if (month === 9 || month === 10) events.push('🍂 가을 감성 시즌');
  if (month === 12) events.push('🎄 연말/크리스마스 시즌');

  let ctx = `\n═══════════════════════════════════\n🕐 현재 환경 인식\n═══════════════════════════════════\n`;
  ctx += `📅 ${dateStr} ${timeOfDay}\n`;
  ctx += `🌿 계절: ${season}${isPeak ? ' (성수기 — 수요 증가 대비!)' : ''}\n`;
  if (events.length > 0) ctx += `🎯 시즌 이벤트: ${events.join(', ')}\n`;

  return ctx;
}

// ═══════════════════════════════════════════════════
// 📈 비즈니스 컨텍스트 빌더 (16. 지표, 17. 오늘 스케줄)
// ═══════════════════════════════════════════════════

async function buildBusinessContext() {
  const pool = getPool();
  if (!pool) return '';

  try {
    let ctx = '';
    // 오늘 예약 현황
    const todayRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM reservations WHERE DATE(rental_date AT TIME ZONE 'Asia/Seoul') = (NOW() AT TIME ZONE 'Asia/Seoul')::date`
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    const todayCount = parseInt(todayRes.rows[0]?.cnt) || 0;

    // 활성 예약 수
    const activeRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM reservations WHERE status IN ('confirmed','active','준비중')`
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    const activeCount = parseInt(activeRes.rows[0]?.cnt) || 0;

    // 오늘 반납 예정
    const returnRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM reservations WHERE DATE(return_date AT TIME ZONE 'Asia/Seoul') = (NOW() AT TIME ZONE 'Asia/Seoul')::date`
    ).catch(() => ({ rows: [{ cnt: 0 }] }));
    const returnCount = parseInt(returnRes.rows[0]?.cnt) || 0;

    if (todayCount > 0 || activeCount > 0 || returnCount > 0) {
      ctx += `\n═══════════════════════════════════\n📈 오늘의 비즈니스 현황\n═══════════════════════════════════\n`;
      if (todayCount > 0) ctx += `📦 오늘 출고 예약: ${todayCount}건\n`;
      if (returnCount > 0) ctx += `📥 오늘 반납 예정: ${returnCount}건\n`;
      if (activeCount > 0) ctx += `📋 전체 활성 예약: ${activeCount}건\n`;
    }
    return ctx;
  } catch {
    return ''; // reservations 테이블 없으면 조용히 스킵
  }
}

// ═══════════════════════════════════════════════════
// 🧠 메타인지 컨텍스트 빌더 (18. GPA이력, 19. 강약점)
// ═══════════════════════════════════════════════════

async function buildMetaCognitionContext(agentId) {
  const gpaHistory = await getGPAHistory(agentId, 10);
  if (gpaHistory.length === 0) return '';

  const avgGPA = Math.round((gpaHistory.reduce((s, g) => s + g.overall_gpa, 0) / gpaHistory.length) * 10) / 10;
  const domains = ['goal_alignment', 'plan_quality', 'action_execution', 'critique_revision'];
  const domainNames = { goal_alignment: '목표 정렬', plan_quality: '방법론 설계', action_execution: '실증 수행', critique_revision: '메타 인지' };
  const domainAvgs = domains.map(d => ({
    domain: d,
    name: domainNames[d],
    avg: Math.round((gpaHistory.reduce((s, g) => s + (g[d] || 0), 0) / gpaHistory.length) * 10) / 10
  })).sort((a, b) => a.avg - b.avg);

  const recent3 = gpaHistory.slice(0, 3);
  const trend = recent3.length >= 2
    ? (recent3[0].overall_gpa > recent3[1].overall_gpa ? '📈 상승세' : recent3[0].overall_gpa < recent3[1].overall_gpa ? '📉 하락세' : '➡️ 유지')
    : '';

  let ctx = `\n═══════════════════════════════════\n🧠 나의 메타인지 (자기 인식)\n═══════════════════════════════════\n`;
  ctx += `📊 누적 GPA: ${avgGPA}/4.3 (${gpaHistory.length}건 평가) ${trend}\n`;
  ctx += `💪 강점: ${domainAvgs[3].name} (${domainAvgs[3].avg})\n`;
  ctx += `⚠️ 약점: ${domainAvgs[0].name} (${domainAvgs[0].avg}) — 이 영역의 질문에 더 신중하게 답변하세요\n`;
  ctx += `📝 최근 학습: ${recent3.map(g => g.topic).join(', ')}\n`;

  return ctx;
}

// ═══════════════════════════════════════════════════
// ❤️ 감정 상태 감지 (21. 편도체)
// ═══════════════════════════════════════════════════

function detectEmotionalState(recentMessages) {
  if (!recentMessages || recentMessages.length === 0) return '';

  const userMsgs = recentMessages.filter(m => m.role === 'user').slice(-5);
  const text = userMsgs.map(m => m.content || '').join(' ');

  const positive = ['좋아', '잘했', '고마워', '훌륭', '멋져', '최고', '좋네', '감사', '대단', '완벽', '사랑', '칭찬'].filter(k => text.includes(k)).length;
  const negative = ['왜', '문제', '실수', '답답', '안돼', '못해', '짜증', '화가', '이상', '잘못', '걱정', '심각'].filter(k => text.includes(k)).length;
  const urgent = ['급해', '빨리', '지금', '당장', '바로', '긴급', '서둘러', '즉시', '당장'].filter(k => text.includes(k)).length;

  let ctx = '';
  if (urgent >= 1) {
    ctx = `\n😤 대표님 감정 톤: ⚡ 긴급 — 간결하고 신속하게 핵심만 답변하세요\n`;
  } else if (negative >= 2) {
    ctx = `\n😤 대표님 감정 톤: 😟 불만/우려 — 먼저 공감하고, 해결책을 제시하세요\n`;
  } else if (positive >= 2) {
    ctx = `\n😊 대표님 감정 톤: 😊 긍정/격려 — 감사를 표현하되 겸손하게 더 나은 방향 제안\n`;
  }
  return ctx;
}

// ═══════════════════════════════════════════════════
// 🔗 Knowledge Graph 확산 활성화 (8. 연관 기억)
// ═══════════════════════════════════════════════════

async function buildKnowledgeGraphContext(agentId, alreadyLoadedIds) {
  const pool = getPool();
  if (!pool || alreadyLoadedIds.length === 0) return '';

  try {
    // 이미 로딩된 기억들의 연관 ID 수집
    const relRes = await pool.query(
      `SELECT related_memory_ids FROM agent_memories WHERE id = ANY($1) AND related_memory_ids IS NOT NULL AND array_length(related_memory_ids, 1) > 0`,
      [alreadyLoadedIds]
    );

    const allRelatedIds = new Set();
    for (const row of relRes.rows) {
      for (const rid of (row.related_memory_ids || [])) {
        if (!alreadyLoadedIds.includes(rid)) allRelatedIds.add(rid);
      }
    }

    if (allRelatedIds.size === 0) return '';

    // 연관 기억 중 상위 3개만 제목 로드 (확산 활성화)
    const relatedMems = await pool.query(
      `SELECT title, content FROM agent_memories WHERE id = ANY($1) AND is_archived = FALSE ORDER BY importance DESC LIMIT 3`,
      [Array.from(allRelatedIds)]
    );

    if (relatedMems.rows.length === 0) return '';

    let ctx = `\n🔗 연관 지식 (확산 활성화)\n`;
    for (const m of relatedMems.rows) {
      ctx += `- ${m.title}: ${m.content.substring(0, 80)}\n`;
    }
    return ctx;
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════
// 📝 에세이 아카이브 회상 (9. 최근 학습 기록)
// ═══════════════════════════════════════════════════

async function buildEssayRecallContext(agentId) {
  const pool = getPool();
  if (!pool) return '';

  try {
    const res = await pool.query(
      `SELECT topic, overall_gpa, created_at FROM study_archives WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [agentId]
    );
    if (res.rows.length === 0) return '';

    let ctx = `\n📝 최근 연구 기록\n`;
    for (const r of res.rows) {
      const date = new Date(r.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' });
      ctx += `- ${date}: "${r.topic}" (GPA ${r.overall_gpa})\n`;
    }
    return ctx;
  } catch {
    return '';
  }
}

// ═══════════════════════════════════════════════════
// 🎓 Yale 커리큘럼 진도 (20. 대화 시 인식)
// ═══════════════════════════════════════════════════

async function buildYaleContext(agentId) {
  const progress = await getYaleProgress(agentId);
  if (progress.count === 0) return '';

  let ctx = `\n🎓 Yale 커리큘럼 수료: ${progress.count}건\n`;
  if (progress.recentTopics.length > 0) {
    ctx += `최근: ${progress.recentTopics.slice(0, 3).join(', ')}\n`;
  }
  return ctx;
}

// ═══════════════════════════════════════════════════
// 🧬 통합 뇌 컨텍스트 (21개 청크 전체 조립)
// ═══════════════════════════════════════════════════

/**
 * P3: 최근 학습 교훈을 에이전트 시스템 프롬프트에 주입
 * 학습 결과가 실제 고객 응대/업무 수행에 반영되도록 하는 핵심 연결 고리
 */
async function buildRecentLessonsContext(agentId) {
  const pool = getPool();
  if (!pool) return '';
  try {
    const res = await pool.query(
      `SELECT title, content, created_at FROM agent_memories 
       WHERE agent_id = $1 AND memory_type = 'lesson' 
       ORDER BY created_at DESC LIMIT 3`,
      [agentId]
    );
    if (res.rows.length === 0) return '';
    const lessons = res.rows.map(r => {
      const date = new Date(r.created_at).toLocaleDateString('ko-KR');
      return `- ${date}: ${r.content.substring(0, 150)}`;
    }).join('\n');
    return `\n\n## 📋 최근 학습 교훈 (실무 적용 필수)\n아래는 윌리엄스 교수의 최근 평가에서 도출된 핵심 교훈입니다. 고객 응대 시 반드시 참고하세요.\n${lessons}\n`;
  } catch { return ''; }
}

/**
 * 에이전트의 전체 뇌 컨텍스트를 조립합니다.
 * 
 * 1️⃣ 정체성 계층: 페르소나/회사/목표 (agent-chat.js에서 별도 주입)
 * 2️⃣ 기억 계층: 장기기억 + 정책 + 공유지식 + KG확산 + 에세이 + Yale
 * 3️⃣ 환경 계층: 날짜/시간/계절/비즈니스
 * 4️⃣ 메타인지 계층: GPA/강약점/감정
 */
export async function buildFullBrainContext(agentId, recentMessages = []) {
  // 병렬 실행 (비동기 항목) — P3: 최근 학습 교훈 추가
  const [memoryResult, metaCog, biz, essayRecall, yaleCtx, lessonsCtx] = await Promise.all([
    buildMemoryContext(agentId),
    buildMetaCognitionContext(agentId),
    buildBusinessContext(),
    buildEssayRecallContext(agentId),
    buildYaleContext(agentId),
    buildRecentLessonsContext(agentId),  // P3: 최근 학습 교훈 주입
  ]);

  // 동기 항목
  const envCtx = buildEnvironmentContext();
  const emotionCtx = detectEmotionalState(recentMessages);

  // Knowledge Graph 확산 활성화 (메모리 ID 필요하므로 메모리 로딩 후)
  const kgCtx = await buildKnowledgeGraphContext(agentId, memoryResult.usedMemoryIds);

  // 전체 조립
  const fullText = [
    memoryResult.text,   // 5. 장기기억 + 6. 정책 + 7. 공유지식
    kgCtx,               // 8. Knowledge Graph 확산 활성화
    essayRecall,         // 9. 에세이 아카이브 회상
    yaleCtx,             // 20. Yale 커리큘럼 진도
    envCtx,              // 14. 날짜/시간 + 15. 계절/이벤트
    biz,                 // 16. 비즈니스 지표 + 17. 오늘 스케줄
    metaCog,             // 18. GPA이력 + 19. 강약점 프로필
    lessonsCtx,          // 22. P3: 최근 학습 교훈 (실무 적용 필수)
    emotionCtx,          // 21. 감정 상태
  ].filter(Boolean).join('');

  return { text: fullText, usedMemoryIds: memoryResult.usedMemoryIds };
}
