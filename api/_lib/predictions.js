/**
 * 🔮 예측 장부 (Prediction Ledger) — 적정 스코어링 룰 기반 실력 측정
 *
 * 설계 근거:
 *   자사 실적 데이터가 없는 런칭 전 단계에서 "이 직원이 정말 유능해지고 있는가"를
 *   측정할 유일하게 게이밍 불가능한 방법은 '반증 가능한 예측'을 남기고 현실이 채점하게 하는 것입니다.
 *
 *   브라이어 스코어 BS = (p − o)²  (p: 예측 확률, o: 실제 결과 0/1, 낮을수록 우수)
 *   이 스코어는 '엄격 적정(strictly proper)'합니다 — 기대 점수를 최대화하는 유일한 전략이
 *   '진짜 믿는 확률을 정직하게 보고하는 것'입니다. 즉 구조적으로 속일 수 없습니다.
 *
 * 지평(horizon) 두 종류:
 *   near   — 7~14일 내 외부 세계에서 검증 가능. 런칭 전에도 즉시 채점됩니다.
 *   launch — 런칭 후 자사 데이터로 검증. 지금 쌓아두면 런칭 순간 문제은행이 됩니다.
 */

import { getPool } from "./agent-brain.js";

let predictionsTableReady;

export async function ensurePredictionsTable() {
  const pool = getPool();
  if (!pool || predictionsTableReady) return;
  predictionsTableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS agent_predictions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      study_topic TEXT NOT NULL DEFAULT '',
      claim TEXT NOT NULL,
      probability REAL NOT NULL,
      horizon TEXT NOT NULL DEFAULT 'near',
      resolve_by TIMESTAMPTZ,
      resolution_criteria TEXT NOT NULL DEFAULT '',
      basis TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      outcome BOOLEAN,
      brier REAL,
      resolution_note TEXT DEFAULT '',
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pred_agent ON agent_predictions(agent_id, status);
    CREATE INDEX IF NOT EXISTS idx_pred_due ON agent_predictions(status, horizon, resolve_by);
  `).catch(() => { predictionsTableReady = null; });
  await predictionsTableReady;
}

/**
 * 리포트 본문에서 [PREDICTIONS] 블록을 추출하고 정규화합니다.
 * @returns {{ predictions: Array, cleanedReport: string }}
 */
export function extractPredictions(rawReport) {
  const empty = { predictions: [], cleanedReport: rawReport };
  if (!rawReport) return empty;

  const block = rawReport.match(/\[PREDICTIONS\]([\s\S]*?)\[\/PREDICTIONS\]/i);
  if (!block) return empty;

  const cleanedReport = rawReport.replace(block[0], '').trim();

  let parsed;
  try {
    const arr = block[1].match(/\[[\s\S]*\]/);
    if (!arr) return { predictions: [], cleanedReport };
    parsed = JSON.parse(arr[0]);
  } catch {
    return { predictions: [], cleanedReport };
  }
  if (!Array.isArray(parsed)) return { predictions: [], cleanedReport };

  const predictions = parsed
    .filter(p => p && typeof p.claim === 'string' && p.claim.trim().length > 5)
    .slice(0, 3) // 회차당 최대 3건
    .map(p => {
      // 확률은 0.05~0.95로 클램프 — 0/1 단정은 브라이어에서 치명적 페널티를 받으므로
      // 극단값을 막아 '정직한 불확실성'을 유도합니다.
      let prob = Number(p.probability);
      if (!Number.isFinite(prob)) prob = 0.5;
      if (prob > 1) prob = prob / 100;               // 70 처럼 퍼센트로 쓴 경우 보정
      prob = Math.min(0.95, Math.max(0.05, prob));

      const horizon = p.horizon === 'launch' ? 'launch' : 'near';
      const days = Math.min(30, Math.max(3, Number(p.days) || 7));
      const resolveBy = horizon === 'near'
        ? new Date(Date.now() + days * 86400000).toISOString()
        : null;

      return {
        claim: String(p.claim).trim().slice(0, 400),
        probability: Math.round(prob * 100) / 100,
        horizon,
        resolveBy,
        criteria: String(p.criteria || '').trim().slice(0, 400),
        basis: String(p.basis || '').trim().slice(0, 400),
      };
    });

  return { predictions, cleanedReport };
}

export async function savePredictions(agentId, studyTopic, predictions) {
  const pool = getPool();
  if (!pool || !predictions?.length) return [];
  await ensurePredictionsTable();

  const ids = [];
  for (const [i, p] of predictions.entries()) {
    const id = `pred_${agentId}_${Date.now()}_${i}`;
    try {
      await pool.query(
        `INSERT INTO agent_predictions
           (id, agent_id, study_topic, claim, probability, horizon, resolve_by, resolution_criteria, basis)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, agentId, studyTopic.slice(0, 200), p.claim, p.probability, p.horizon, p.resolveBy, p.criteria, p.basis]
      );
      ids.push(id);
    } catch (err) {
      console.warn(`[Predictions] 저장 실패:`, err.message);
    }
  }
  return ids;
}

/** 만기가 도래한 near 예측 조회 (자동 판정 대상) */
export async function getDuePredictions(limit = 10) {
  const pool = getPool();
  if (!pool) return [];
  await ensurePredictionsTable();
  try {
    const res = await pool.query(
      `SELECT id, agent_id, claim, probability, resolution_criteria, basis, created_at
       FROM agent_predictions
       WHERE status = 'open' AND horizon = 'near' AND resolve_by IS NOT NULL AND resolve_by <= NOW()
       ORDER BY resolve_by ASC LIMIT $1`,
      [limit]
    );
    return res.rows;
  } catch { return []; }
}

/**
 * 예측을 판정하고 브라이어 스코어를 확정합니다.
 * @param {boolean|null} outcome - true/false, 또는 null이면 판정 불가(void 처리)
 */
export async function resolvePrediction(id, outcome, note = '') {
  const pool = getPool();
  if (!pool) return null;
  await ensurePredictionsTable();

  if (outcome === null || outcome === undefined) {
    await pool.query(
      `UPDATE agent_predictions SET status='void', resolution_note=$1, resolved_at=NOW() WHERE id=$2`,
      [note.slice(0, 500), id]
    ).catch(() => {});
    return { id, status: 'void' };
  }

  try {
    const cur = await pool.query(`SELECT probability FROM agent_predictions WHERE id=$1`, [id]);
    const p = Number(cur.rows[0]?.probability);
    if (!Number.isFinite(p)) return null;
    const o = outcome ? 1 : 0;
    const brier = Math.round(((p - o) ** 2) * 10000) / 10000;

    await pool.query(
      `UPDATE agent_predictions
       SET status='resolved', outcome=$1, brier=$2, resolution_note=$3, resolved_at=NOW()
       WHERE id=$4`,
      [outcome, brier, note.slice(0, 500), id]
    );
    return { id, status: 'resolved', outcome, brier };
  } catch (err) {
    console.warn(`[Predictions] 판정 실패:`, err.message);
    return null;
  }
}

/**
 * 에이전트의 예측 실력 통계.
 * - avgBrier: 평균 브라이어 (0=완벽, 0.25=동전던지기, 1=최악)
 * - skillScore: 1 − BS/0.25. 0보다 크면 동전던지기보다 낫다는 뜻.
 * - calibrationError: 확률 구간별 |평균확률 − 실제적중률|의 가중평균 (낮을수록 정직)
 */
export async function getPredictionStats(agentId) {
  const pool = getPool();
  if (!pool) return null;
  await ensurePredictionsTable();

  try {
    const res = await pool.query(
      `SELECT probability, outcome, brier FROM agent_predictions
       WHERE agent_id = $1 AND status = 'resolved'`,
      [agentId]
    );
    const counts = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM agent_predictions WHERE agent_id=$1 GROUP BY status`,
      [agentId]
    );
    const byStatus = Object.fromEntries(counts.rows.map(r => [r.status, r.n]));

    const rows = res.rows;
    if (rows.length === 0) {
      return { agentId, resolved: 0, open: byStatus.open || 0, void: byStatus.void || 0, avgBrier: null, skillScore: null, hitRate: null, calibrationError: null, buckets: [] };
    }

    const avgBrier = rows.reduce((s, r) => s + Number(r.brier), 0) / rows.length;
    const hitRate = rows.filter(r => r.outcome).length / rows.length;

    // 캘리브레이션 버킷 (5구간)
    const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.01];
    const buckets = [];
    let ece = 0;
    for (let i = 0; i < edges.length - 1; i++) {
      const inB = rows.filter(r => r.probability >= edges[i] && r.probability < edges[i + 1]);
      if (inB.length === 0) continue;
      const meanP = inB.reduce((s, r) => s + Number(r.probability), 0) / inB.length;
      const actual = inB.filter(r => r.outcome).length / inB.length;
      ece += (inB.length / rows.length) * Math.abs(meanP - actual);
      buckets.push({
        range: `${Math.round(edges[i] * 100)}~${Math.round(Math.min(edges[i + 1], 1) * 100)}%`,
        n: inB.length,
        meanProbability: Math.round(meanP * 100) / 100,
        actualRate: Math.round(actual * 100) / 100,
      });
    }

    return {
      agentId,
      resolved: rows.length,
      open: byStatus.open || 0,
      void: byStatus.void || 0,
      avgBrier: Math.round(avgBrier * 1000) / 1000,
      skillScore: Math.round((1 - avgBrier / 0.25) * 100) / 100,
      hitRate: Math.round(hitRate * 100) / 100,
      calibrationError: Math.round(ece * 1000) / 1000,
      buckets,
    };
  } catch { return null; }
}

/** 미판정 예측 목록 (관리자 화면 / 교수 입력용) */
export async function getOpenPredictions(agentId, limit = 5) {
  const pool = getPool();
  if (!pool) return [];
  await ensurePredictionsTable();
  try {
    const res = await pool.query(
      `SELECT id, claim, probability, horizon, resolve_by, resolution_criteria
       FROM agent_predictions
       WHERE agent_id=$1 AND status='open'
       ORDER BY created_at DESC LIMIT $2`,
      [agentId, limit]
    );
    return res.rows;
  } catch { return []; }
}

/** 최근 판정 결과 (교수 평가 입력용 — 예측 실력 피드백) */
export async function getRecentResolved(agentId, limit = 5) {
  const pool = getPool();
  if (!pool) return [];
  await ensurePredictionsTable();
  try {
    const res = await pool.query(
      `SELECT claim, probability, outcome, brier, resolution_note
       FROM agent_predictions
       WHERE agent_id=$1 AND status='resolved'
       ORDER BY resolved_at DESC LIMIT $2`,
      [agentId, limit]
    );
    return res.rows;
  } catch { return []; }
}
