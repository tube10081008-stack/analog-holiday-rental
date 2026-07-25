/**
 * 🎓 윌리엄스 스쿨 API — 대표 전용 과정
 *
 * GET  ?action=today       → 오늘의 수업+과제 (없으면 그 자리에서 생성) + 인출 문항
 * GET  ?action=history     → 성적 이력
 * GET  ?action=leaderboard → 예측 랭킹 (대표 vs AI 직원들)
 * POST {action:'submit', lessonId, answer, recalls, predictions}
 * POST {action:'skip', lessonId}
 *
 * 인증: x-admin-key 헤더 (관리자 키 재사용)
 */

import { getAdminKey } from "./_lib/reservations.js";
import {
  ensureSchoolTable, CURRICULUM, pickNextTopic, generateLesson, gradeSubmission,
  getOpenLesson, getSubmittedCount, createLesson, saveGrade, getLastPrescription,
  pickReviewLessons, applyReviewResults, getHistory, getSchoolStats, FOUNDER_ID,
} from "./_lib/school.js";
import {
  ensurePredictionsTable, extractPredictions, savePredictions, getPredictionStats,
} from "./_lib/predictions.js";
import { AGENT_ROLES } from "./_lib/autonomous-study.js";

function json(res, status, payload) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(payload));
}

function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body;
}

export default async function handler(req, res) {
  // 쿼리 파싱 (Vercel 런타임에 따라 req.query 누락 대비)
  let query = req.query || {};
  if (!query.action && req.url) {
    try {
      const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      query = Object.fromEntries(u.searchParams.entries());
    } catch { /* ignore */ }
  }

  const key = req.headers?.["x-admin-key"] || readBody(req).key || "";
  const stored = getAdminKey();
  if (!stored || key !== stored) {
    return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
  }

  try {
    await ensureSchoolTable();
    await ensurePredictionsTable();

    if (req.method === "GET") {
      const action = query.action || "today";
      if (action === "today") return await handleToday(res);
      if (action === "history") return json(res, 200, { ok: true, history: await getHistory(30), stats: await getSchoolStats() });
      if (action === "leaderboard") return await handleLeaderboard(res);
      return json(res, 400, { ok: false, message: "알 수 없는 action" });
    }

    if (req.method === "POST") {
      const body = readBody(req);
      if (body.action === "submit") return await handleSubmit(res, body);
      if (body.action === "skip") return await handleSkip(res, body);
      return json(res, 400, { ok: false, message: "알 수 없는 action" });
    }

    res.setHeader("Allow", "GET, POST");
    return json(res, 405, { ok: false, message: "GET 또는 POST만 허용됩니다." });
  } catch (err) {
    console.error("[School] error:", err);
    return json(res, 500, { ok: false, message: err.message || "처리 중 오류가 발생했습니다." });
  }
}

/** 오늘의 과제 — 열린 과제가 있으면 그것, 없으면 새로 생성(지연 생성) */
async function handleToday(res) {
  let lesson = await getOpenLesson();
  let created = false;

  if (!lesson) {
    const done = await getSubmittedCount();
    const topic = pickNextTopic(done);
    const prior = await getLastPrescription();

    // 지난 처방을 수업 생성에 반영 → 개인화 (에이전트 루프의 튜터링 계승과 동일 원리)
    const priorContext = prior?.instruction
      ? `## 이 학생의 지난 회차 상태 (수업 설계에 반영하세요)
이전 주제: ${prior.topic} (GPA ${prior.gpa})
당시 진단한 약점: ${prior.diagnosis}
당시 준 가르침: ${prior.instruction}
다음에 개선하라고 지시한 것: ${prior.next_focus || '-'}
→ 오늘 과제는 위 지시가 실제로 반영되었는지 확인할 수 있는 형태로 설계하세요.`
      : '## 이 학생의 첫 수업입니다. 기초부터 시작하되 유치하지 않게 설계하세요.';

    const { brief, assignment } = await generateLesson(topic, priorContext);
    lesson = await createLesson(topic, brief, assignment);
    created = true;
  }

  const reviewItems = await pickReviewLessons(2);
  const stats = await getSchoolStats();
  const predictionStats = await getPredictionStats(FOUNDER_ID);
  const prior = await getLastPrescription();

  return json(res, 200, {
    ok: true,
    created,
    lesson: {
      id: lesson.id, track: lesson.track, trackLabel: CURRICULUM[lesson.track]?.label,
      emoji: CURRICULUM[lesson.track]?.emoji, topic: lesson.topic,
      brief: lesson.brief, assignment: lesson.assignment, issuedAt: lesson.issued_at,
      draft: lesson.submission || '',
    },
    // ⚠️ answerKey는 절대 내려보내지 않습니다 (closed-book 보장)
    reviewItems: reviewItems.map(r => ({ index: r.index, topic: r.topic, reviewCount: r.reviewCount })),
    priorFocus: prior?.next_focus || null,
    stats, predictionStats,
  });
}

async function handleSubmit(res, body) {
  const { lessonId, answer } = body;
  if (!lessonId || !String(answer || "").trim()) {
    return json(res, 400, { ok: false, message: "답안을 입력해 주세요." });
  }

  const open = await getOpenLesson();
  if (!open || open.id !== lessonId) {
    return json(res, 409, { ok: false, message: "이미 제출되었거나 유효하지 않은 과제입니다." });
  }

  // 예측 파싱 — 예측 장부에 founder로 등록해 에이전트와 같은 기준으로 채점받습니다
  const rawPreds = Array.isArray(body.predictions) ? body.predictions : [];
  const { predictions } = extractPredictions(
    `[PREDICTIONS]${JSON.stringify(rawPreds)}[/PREDICTIONS]`
  );

  const reviewItems = await pickReviewLessons(2);
  const priorPrescription = await getLastPrescription();
  const predictionStats = await getPredictionStats(FOUNDER_ID);

  const evaluation = await gradeSubmission({
    lesson: open,
    submission: answer,
    priorPrescription,
    reviewItems,
    recalls: Array.isArray(body.recalls) ? body.recalls : [],
    predictions,
    predictionStats,
  });

  await saveGrade(lessonId, answer, evaluation);

  if (evaluation.parseError) {
    return json(res, 200, { ok: true, parseError: true, message: evaluation.professorComment });
  }

  const reviewOutcome = await applyReviewResults(reviewItems, evaluation.recallResults || []);
  const savedPredIds = await savePredictions(FOUNDER_ID, open.topic, predictions).catch(() => []);

  return json(res, 200, {
    ok: true,
    evaluation,
    reviewOutcome,
    predictionsSaved: savedPredIds.length,
    stats: await getSchoolStats(),
  });
}

async function handleSkip(res, body) {
  const open = await getOpenLesson();
  if (!open || open.id !== body.lessonId) {
    return json(res, 409, { ok: false, message: "유효하지 않은 과제입니다." });
  }
  // 건너뛴 과제는 status를 유지한 채 새 과제를 받도록 'skipped'로 닫습니다.
  // 놓친 지식은 간격 반복 대상에 포함되지 않으므로, 커리큘럼이 다음 회차에 자연히 재순환합니다.
  const { getPool } = await import("./_lib/agent-brain.js");
  const pool = getPool();
  if (pool) await pool.query(`UPDATE founder_lessons SET status='skipped' WHERE id=$1`, [open.id]);
  return json(res, 200, { ok: true, message: "오늘 과제를 건너뛰었습니다. 다음 접속 시 새 과제가 나옵니다." });
}

/** 예측 랭킹 — 대표 vs AI 직원 5명 (브라이어 스코어 기준) */
async function handleLeaderboard(res) {
  const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];
  const rows = await Promise.all([FOUNDER_ID, ...AGENTS].map(async (id) => {
    const s = await getPredictionStats(id);
    return {
      id,
      name: id === FOUNDER_ID ? '홍성현 대표' : (AGENT_ROLES[id]?.name || id),
      isFounder: id === FOUNDER_ID,
      resolved: s?.resolved || 0,
      open: s?.open || 0,
      avgBrier: s?.avgBrier ?? null,
      skillScore: s?.skillScore ?? null,
      hitRate: s?.hitRate ?? null,
      calibrationError: s?.calibrationError ?? null,
    };
  }));

  // 판정된 예측이 있는 사람만 순위에 포함 (브라이어 낮은 순)
  const ranked = rows.filter(r => r.resolved > 0).sort((a, b) => a.avgBrier - b.avgBrier);
  const unranked = rows.filter(r => r.resolved === 0);

  return json(res, 200, { ok: true, ranked, unranked });
}
