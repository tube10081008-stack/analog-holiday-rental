/**
 * 👥 팀원 현황 집계 — 다섯 명이 지금 어디쯤 와 있나
 *
 * 왜 만들었나:
 *   에이전트들의 학습 현황을 보려면 지금까지는 `/api/agent-brain?action=stats`,
 *   `?action=predictions`, `?action=memories&agentId=…`를 각각 관리자 키로 호출해
 *   눈으로 합쳐야 했습니다. 다섯 명이면 일곱 번입니다.
 *   "지금 어디쯤"이라는 한 가지 질문에 답하려고 콘솔을 여는 건 도구가 없는 것과 같습니다.
 *
 * 설계:
 *   - 조회 전용입니다. 아무것도 생성하지 않고 LLM도 부르지 않습니다.
 *     현황을 보는 행위에 돈이 들면 자주 안 보게 됩니다.
 *   - 기존 조회 함수를 그대로 재사용합니다. 여기서 새 SQL을 만들면
 *     같은 숫자를 두 곳에서 다르게 세게 됩니다.
 *   - 다섯 명 × 여러 쿼리라 전부 병렬로 돌립니다.
 */

import { getPool, getAgentBrainStats, getYaleProgress, getGPAHistory } from "./agent-brain.js";
import { getPredictionStats } from "./predictions.js";
import { CURRICULUM, getNextTopic } from "./curriculum.js";
import { AGENT_ROLES } from "./autonomous-study.js";

export const TEAM = ['hani', 'geo', 'noah', 'lina', 'alex'];

/**
 * 크론이 정해놓은 학습 속도.
 * 로테이션이 하루 PER_RUN명이라 한 사람은 5일 중 2일만 돌아옵니다.
 * "언제 끝나나"를 답하려면 이 숫자가 필요합니다.
 */
const PACE = {
  agents: TEAM.length,
  perRun: Math.max(1, Number(process.env.YALE_AGENTS_PER_RUN) || 2),
  countPerTurn: 2,          // vercel.json의 크론 경로에 박힌 count=2
};
/** 한 사람이 하루에 소화하는 Yale 주제 수 (기댓값) */
const topicsPerDay = () => (PACE.perRun / PACE.agents) * PACE.countPerTurn;

/** 마지막으로 무언가를 배운 시각 — 크론이 실제로 돌고 있는지 보는 신호 */
async function lastSeen(agentId) {
  const pool = getPool();
  if (!pool) return { lastMemoryAt: null, lastStudyAt: null };
  const [mem, arc] = await Promise.all([
    pool.query(
      `SELECT MAX(created_at) AS t FROM agent_memories WHERE agent_id = $1`, [agentId]
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT MAX(created_at) AS t FROM study_archives WHERE agent_id = $1`, [agentId]
    ).catch(() => ({ rows: [] })),
  ]);
  return {
    lastMemoryAt: mem.rows[0]?.t || null,
    lastStudyAt: arc.rows[0]?.t || null,
  };
}

/**
 * Yale 기억 제목에서 회차를 셉니다.
 * 제목 규칙은 agent-brain.js의 generateStudyKnowledge가 정합니다:
 *   1회차       → "[Yale] 제목"
 *   2회차 이상  → "[Yale R2] 제목"
 * 총 개수만으로도 회차를 계산할 수 있지만, 제목을 세면 **실제로 저장된 것**이 보입니다.
 * 둘이 어긋나면 중간에 저장이 실패한 적이 있다는 뜻이라 그것도 정보입니다.
 */
async function yaleBreakdown(agentId) {
  const pool = getPool();
  if (!pool) return { basic: 0, advanced: 0, byRound: {} };
  const r = await pool.query(
    `SELECT title FROM agent_memories
      WHERE agent_id = $1 AND title LIKE '[Yale%' AND is_archived = FALSE`, [agentId]
  ).catch(() => ({ rows: [] }));

  let basic = 0, advanced = 0;
  const byRound = {};
  for (const row of r.rows) {
    const m = String(row.title).match(/^\[Yale(?: R(\d+))?\]/);
    if (!m) continue;
    const round = m[1] ? Number(m[1]) : 1;
    byRound[round] = (byRound[round] || 0) + 1;
    if (round === 1) basic++; else advanced++;
  }
  return { basic, advanced, byRound };
}

/** 한 사람의 현황 */
async function statusOf(agentId) {
  const role = AGENT_ROLES[agentId] || {};
  const course = CURRICULUM[agentId];
  const totalTopics = course
    ? course.semesters.reduce((s, x) => s + x.topics.length, 0) : 0;

  const [brain, yale, pred, gpa, seen, rounds] = await Promise.all([
    getAgentBrainStats(agentId).catch(() => null),
    getYaleProgress(agentId).catch(() => ({ count: 0, recentTopics: [] })),
    getPredictionStats(agentId).catch(() => null),
    getGPAHistory(agentId, 3).catch(() => []),
    lastSeen(agentId).catch(() => ({ lastMemoryAt: null, lastStudyAt: null })),
    yaleBreakdown(agentId).catch(() => ({ basic: 0, advanced: 0, byRound: {} })),
  ]);

  // 다음에 배울 주제와 회차 — 커리큘럼이 소진돼도 멈추지 않고 회차가 올라갑니다
  const next = totalTopics ? getNextTopic(agentId, yale.count) : null;

  // 남은 기초 주제를 지금 속도로 마치는 데 며칠 걸리나
  const perDay = topicsPerDay();
  const remainBasic = Math.max(0, totalTopics - rounds.basic);
  const daysToFinishBasic = perDay > 0 && remainBasic > 0
    ? Math.ceil(remainBasic / perDay) : 0;

  return {
    id: agentId,
    name: role.name || agentId,
    title: role.title || '',
    degree: course?.degree || '',
    school: course?.school || '',

    // 📚 진도
    totalTopics,
    yaleCount: yale.count,               // 저장된 Yale 기억 총수 (회차 포함)
    basic: rounds.basic,                 // 1회차(기초) 몇 개
    advanced: rounds.advanced,           // 2회차 이상(심화) 몇 개
    byRound: rounds.byRound,
    round: next?.round || 1,
    progressLabel: next?.progress || '-',
    nextTopic: next?.title || null,
    nextSemester: next?.semester || null,
    basicPercent: totalTopics ? Math.round((Math.min(rounds.basic, totalTopics) / totalTopics) * 100) : 0,
    daysToFinishBasic,

    // 🧠 기억
    totalMemories: brain?.totalMemories ?? 0,
    byType: brain?.byType || [],

    // 🔮 예측 (브라이어가 낮을수록 잘 맞힘)
    predictions: pred ? {
      resolved: pred.resolved || 0,
      open: pred.open || 0,
      avgBrier: pred.avgBrier,
      skillScore: pred.skillScore,
      hitRate: pred.hitRate,
      calibrationError: pred.calibrationError,
    } : null,

    // 🎓 최근 성적
    recentGpa: gpa.map(g => ({ topic: g.topic, gpa: g.overall_gpa, at: g.created_at })),

    // ⏱ 마지막 활동 — 크론이 실제로 돌고 있는지 보는 신호
    ...seen,
    recentTopics: yale.recentTopics || [],
  };
}

/**
 * 다섯 명 전체 현황.
 * @returns { team, pace, generatedAt }
 */
export async function getTeamStatus() {
  const team = await Promise.all(TEAM.map(id => statusOf(id).catch(() => ({
    id, name: id, error: true, totalTopics: 0, basic: 0, advanced: 0,
    totalMemories: 0, byType: [], predictions: null, recentGpa: [],
    lastMemoryAt: null, lastStudyAt: null, recentTopics: [],
  }))));

  const perDay = topicsPerDay();
  return {
    team,
    pace: {
      agentsPerRun: PACE.perRun,
      totalAgents: PACE.agents,
      countPerTurn: PACE.countPerTurn,
      topicsPerAgentPerDay: Math.round(perDay * 100) / 100,
      // 한 사람이 며칠에 한 번 순번이 돌아오나
      turnEveryDays: Math.round((PACE.agents / PACE.perRun) * 10) / 10,
      note: '로테이션은 하루 ' + PACE.perRun + '명. 나머지는 쉽니다.',
    },
    generatedAt: new Date().toISOString(),
  };
}
