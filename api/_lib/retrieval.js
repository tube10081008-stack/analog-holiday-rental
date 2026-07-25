/**
 * 🧠 인출 연습 & 간격 반복 (Retrieval Practice + Spaced Repetition)
 *
 * 설계 근거:
 *   테스팅 효과(Roediger & Karpicke) — 배운 것을 '다시 읽는' 것보다 '다시 꺼내보는' 것이
 *   기억을 훨씬 강하게 만듭니다. 기존 루프는 매 회차가 독립 시행이라, 아무리 오래 돌려도
 *   지식이 누적되지 않았습니다(각 회차가 과거 학습의 '제목'만 볼 뿐 내용은 다시 보지 않음).
 *
 *   여기서는 매 학습 전에 과거에 배운 것을 **원문 없이(closed-book)** 복원하게 하고,
 *   교수가 원문과 대조해 채점합니다. 그 결과로 다음 복습 시점을 조정합니다.
 *
 *   간격 반복(에빙하우스 망각곡선 / SM-2 간소화):
 *     성공하면 복습 간격을 늘리고(1→3→7→14→30→60일), 실패하면 1일로 되돌립니다.
 *     잊어버릴 무렵에 다시 꺼내는 것이 정착에 가장 효율적이기 때문입니다.
 */

import { getPool } from "./agent-brain.js";

// strength(정착 단계) → 다음 복습까지 일수
const INTERVALS = [1, 3, 7, 14, 30, 60];
const MAX_STRENGTH = INTERVALS.length - 1;

let reviewColumnsReady;

/** 인출 연습용 컬럼을 agent_memories에 보장합니다 (기존 데이터 보존). */
export async function ensureReviewColumns() {
  const pool = getPool();
  if (!pool || reviewColumnsReady) return;
  reviewColumnsReady = (async () => {
    try {
      await pool.query(`
        ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS retention_strength INTEGER DEFAULT 0;
        ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS next_review_at TIMESTAMPTZ;
        ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;
        ALTER TABLE agent_memories ADD COLUMN IF NOT EXISTS last_review_result TEXT;
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_memories_review ON agent_memories(agent_id, next_review_at)`
      ).catch(() => {});
    } catch (err) {
      console.warn('[Retrieval] 컬럼 보장 실패:', err.message);
      reviewColumnsReady = null;
    }
  })();
  await reviewColumnsReady;
}

/**
 * 오늘 인출 시험을 볼 항목을 고릅니다.
 *
 * 대상: 학습으로 획득한 지식(fact/lesson) 중
 *   - 아직 한 번도 복습하지 않았고 하루 이상 지난 것, 또는
 *   - 복습 예정일이 도래한 것
 * 정착도가 낮은 것 → 오래 방치된 것 순으로 우선합니다.
 *
 * ⚠️ 반환되는 content는 '정답지'입니다. 학생 프롬프트에 절대 넣지 마세요(closed-book).
 */
export async function pickReviewItems(agentId, limit = 2) {
  const pool = getPool();
  if (!pool) return [];
  await ensureReviewColumns();
  try {
    const res = await pool.query(
      `SELECT id, title, content, retention_strength, review_count, created_at
       FROM agent_memories
       WHERE agent_id = $1
         AND is_archived = FALSE
         AND memory_type IN ('fact', 'lesson')
         AND (tags && ARRAY['self_study','yale_school','tutoring']::text[])
         AND created_at < NOW() - INTERVAL '20 hours'
         AND (next_review_at IS NULL OR next_review_at <= NOW())
       ORDER BY COALESCE(retention_strength, 0) ASC,
                COALESCE(next_review_at, created_at) ASC
       LIMIT $2`,
      [agentId, limit]
    );
    return res.rows.map((r, i) => ({
      index: i + 1,
      id: r.id,
      title: r.title,
      answerKey: r.content,               // 교수에게만 전달
      strength: r.retention_strength ?? 0,
      reviewCount: r.review_count ?? 0,
    }));
  } catch (err) {
    console.warn('[Retrieval] 복습 대상 조회 실패:', err.message);
    return [];
  }
}

/** 리포트에서 [RECALL] 블록(학생의 회상 답안)을 추출합니다. */
export function extractRecall(rawReport) {
  const empty = { recalls: [], cleanedReport: rawReport };
  if (!rawReport) return empty;

  const block = rawReport.match(/\[RECALL\]([\s\S]*?)\[\/RECALL\]/i);
  if (!block) return empty;

  const cleanedReport = rawReport.replace(block[0], '').trim();
  try {
    const arr = block[1].match(/\[[\s\S]*\]/);
    if (!arr) return { recalls: [], cleanedReport };
    const parsed = JSON.parse(arr[0]);
    if (!Array.isArray(parsed)) return { recalls: [], cleanedReport };
    return {
      recalls: parsed
        .filter(r => r && (r.answer !== undefined))
        .map(r => ({
          index: Number(r.index) || 0,
          answer: String(r.answer ?? '').trim().slice(0, 800),
        })),
      cleanedReport,
    };
  } catch {
    return { recalls: [], cleanedReport };
  }
}

/**
 * 채점 결과를 반영해 다음 복습 시점을 갱신합니다.
 * 성공 → 정착 단계 +1 (간격 확대) / 실패 → 0으로 리셋 (내일 다시)
 */
export async function applyReviewResults(agentId, items, results = []) {
  const pool = getPool();
  if (!pool || !items?.length) return [];
  await ensureReviewColumns();

  const applied = [];
  for (const item of items) {
    const verdict = results.find(r => Number(r.index) === item.index);
    if (!verdict) continue;                       // 채점되지 않은 항목은 건드리지 않음

    const correct = verdict.correct === true;
    const nextStrength = correct ? Math.min(item.strength + 1, MAX_STRENGTH) : 0;
    const days = INTERVALS[nextStrength];

    try {
      await pool.query(
        `UPDATE agent_memories
         SET retention_strength = $1,
             next_review_at = NOW() + ($2 || ' days')::interval,
             review_count = COALESCE(review_count, 0) + 1,
             last_review_result = $3
         WHERE id = $4`,
        [nextStrength, String(days), correct ? 'pass' : 'fail', item.id]
      );
      applied.push({
        title: item.title,
        correct,
        strength: nextStrength,
        nextInDays: days,
        comment: verdict.comment || '',
      });
    } catch (err) {
      console.warn('[Retrieval] 복습 결과 반영 실패:', err.message);
    }
  }
  return applied;
}

/** 에이전트의 기억 정착 현황 (디스코드/관리자용) */
export async function getRetentionStats(agentId) {
  const pool = getPool();
  if (!pool) return null;
  await ensureReviewColumns();
  try {
    const res = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE review_count > 0)::int AS tested,
         COUNT(*) FILTER (WHERE retention_strength >= 4)::int AS mastered,
         COUNT(*) FILTER (WHERE last_review_result = 'fail')::int AS weak,
         ROUND(AVG(NULLIF(retention_strength, NULL))::numeric, 2) AS avg_strength
       FROM agent_memories
       WHERE agent_id = $1 AND is_archived = FALSE
         AND memory_type IN ('fact','lesson')
         AND (tags && ARRAY['self_study','yale_school','tutoring']::text[])`,
      [agentId]
    );
    const passRes = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE last_review_result = 'pass')::int AS pass,
         COUNT(*) FILTER (WHERE last_review_result IS NOT NULL)::int AS graded
       FROM agent_memories WHERE agent_id = $1`,
      [agentId]
    );
    const r = res.rows[0] || {};
    const p = passRes.rows[0] || {};
    return {
      total: r.total || 0,
      tested: r.tested || 0,
      mastered: r.mastered || 0,
      weak: r.weak || 0,
      avgStrength: r.avg_strength != null ? Number(r.avg_strength) : null,
      recallRate: p.graded > 0 ? Math.round((p.pass / p.graded) * 100) / 100 : null,
    };
  } catch { return null; }
}

export { INTERVALS, MAX_STRENGTH };
