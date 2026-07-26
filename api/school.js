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
import * as CN from "./_lib/chinese.js";

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
    // 🀄 중국어 학당으로 분기 (Hobby 함수 한도 12개 때문에 엔드포인트를 공유합니다)
    const body0 = req.method === "POST" ? readBody(req) : {};
    if (query.course === "chinese" || body0.course === "chinese") {
      return await handleChinese(req, res, query, body0);
    }

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

/* ═══════════════════════════════════════════════
   🀄 陈老师 중국어 학당
   ═══════════════════════════════════════════════ */

async function handleChinese(req, res, query, body) {
  await CN.ensureChineseTables();

  if (req.method === "GET") {
    const action = query.action || "today";

    if (action === "today") {
      const profile = await CN.getProfile();
      let session = await CN.getOpenSession();
      let created = false;

      if (!session) {
        const scene = CN.pickScene(profile?.level || 1, profile?.scene_index || 0);
        const last = await CN.getLastEvaluation();
        const priorContext = last?.nextFocus
          ? `## 이 학생의 지난 수업\n장면: ${last.scene} (${last.score}점)\n지적한 것: ${last.nextFocus}\n→ 오늘 과제는 이 지적이 고쳐졌는지 확인할 수 있게 설계하세요.`
          : '## 이 학생의 첫 수업입니다. 자신감을 잃지 않을 난이도로 시작하되 대충 넘어가지는 마세요.';
        const gen = await CN.generateSession(scene, priorContext);
        session = await CN.createSession(scene, gen);
        created = true;
      }

      const due = await CN.getDueCards(12);
      return json(res, 200, {
        ok: true, created,
        profile: { level: profile?.level || 1, sceneIndex: profile?.scene_index || 0 },
        session: {
          id: session.id, level: session.level, scene: session.scene, sceneCn: session.scene_cn,
          dialogue: parseJ(session.dialogue), focus: parseJ(session.focus),
          task: session.task, speakLine: parseJ(session.speak_line),
          draft: session.submission || '',
        },
        dueCount: due.length,
        cardStats: await CN.getCardStats(),
        stats: await CN.getChineseStats(),
        priorFocus: (await CN.getLastEvaluation())?.nextFocus || null,
      });
    }

    if (action === "review") {
      // 플래시카드 — 정답(뜻)은 클라이언트가 뒤집을 때 보여주므로 함께 내려도 무방합니다
      const cards = await CN.getDueCards(12);
      return json(res, 200, {
        ok: true,
        cards: cards.map(c => ({ ...c, tier: CN.cardTier(c) })),
        stats: await CN.getCardStats(), xp: await CN.getXpState(),
      });
    }

    if (action === "collection") {
      return json(res, 200, { ok: true, collection: await CN.getCollection(), xp: await CN.getXpState() });
    }

    if (action === "stages") {
      const profile = await CN.getProfile();
      const lv = Number(query.level) || profile?.level || 1;
      const data = await CN.getStages(lv);
      return json(res, 200, { ok: true, level: lv, ...data, xp: await CN.getXpState() });
    }

    if (action === "history") {
      return json(res, 200, { ok: true, history: await CN.getChineseHistory(20), stats: await CN.getChineseStats() });
    }

    return json(res, 400, { ok: false, message: "알 수 없는 action" });
  }

  if (req.method === "POST") {
    if (body.action === "setLevel") {
      await CN.setLevel(body.level);
      return json(res, 200, { ok: true });
    }

    if (body.action === "review") {
      const r = await CN.reviewCard(body.cardId, body.quality);
      if (!r) return json(res, 404, { ok: false, message: "카드를 찾을 수 없습니다." });
      return json(res, 200, { ok: true, result: r, stats: await CN.getCardStats(), xp: await CN.getXpState() });
    }

    if (body.action === "stageStart") {
      const { level, sceneIndex } = body;
      const { stages } = await CN.getStages(Number(level));
      const target = stages.find(s => s.sceneIndex === Number(sceneIndex));
      if (!target) return json(res, 404, { ok: false, message: "스테이지를 찾을 수 없습니다." });
      if (!target.unlocked) {
        return json(res, 403, { ok: false, message: `아직 잠겨 있습니다. 이 레벨의 숙성 카드 ${target.required}장이 필요합니다.` });
      }
      const gen = await CN.generateStageMissions(Number(level), Number(sceneIndex));
      return json(res, 200, { ok: true, stage: target, missions: gen.missions });
    }

    if (body.action === "stageSubmit") {
      const { level, sceneIndex, missions, answers } = body;
      if (!Array.isArray(missions) || !Array.isArray(answers)) {
        return json(res, 400, { ok: false, message: "제출 형식이 올바르지 않습니다." });
      }
      const result = await CN.gradeStage(Number(level), Number(sceneIndex), missions, answers);
      if (result.parseError) return json(res, 200, { ok: true, parseError: true, message: result.comment });

      const saved = await CN.saveStageResult(Number(level), Number(sceneIndex), result.stars, result.total);
      return json(res, 200, { ok: true, result, ...saved, xp: await CN.getXpState() });
    }

    if (body.action === "submit") {
      const open = await CN.getOpenSession();
      if (!open || open.id !== body.sessionId) {
        return json(res, 409, { ok: false, message: "이미 제출되었거나 유효하지 않은 수업입니다." });
      }
      if (!String(body.answer || "").trim()) {
        return json(res, 400, { ok: false, message: "답안을 입력해 주세요." });
      }

      const priorEval = await CN.getLastEvaluation();
      const evaluation = await CN.gradeChinese({
        session: open, submission: body.answer,
        speechHeard: body.speechHeard || '', priorEval,
      });

      await CN.completeSession(open.id, body.answer, body.speechHeard, evaluation);
      if (evaluation.parseError) {
        return json(res, 200, { ok: true, parseError: true, message: evaluation.teacherComment });
      }

      // 오늘 배운 핵심표현 + 교정에서 나온 표현을 SRS 카드로 적립
      const focus = parseJ(open.focus) || [];
      const added = await CN.addCards([...focus, ...(evaluation.newCards || [])], open.level);

      // 🎮 XP는 70점 이상일 때만 — 대충 낸 답안에는 아무 보상도 없습니다
      const score = Number(evaluation.overall) || 0;
      const lessonXp = score >= 70
        ? await CN.grantXp(Math.round(score / 2), `수업 통과 (${score}점)`, `lesson_${open.id}`)
        : 0;

      return json(res, 200, {
        ok: true, evaluation, cardsAdded: added, lessonXp,
        xpEarnedNote: score >= 70 ? null : '70점 이상부터 XP가 적립됩니다.',
        cardStats: await CN.getCardStats(), stats: await CN.getChineseStats(),
        xp: await CN.getXpState(),
      });
    }

    if (body.action === "skip") {
      const { getPool } = await import("./_lib/agent-brain.js");
      const pool = getPool();
      if (pool) {
        await pool.query(`UPDATE chinese_sessions SET status='skipped' WHERE status='open'`);
        await pool.query(`UPDATE chinese_profile SET scene_index = scene_index + 1 WHERE id=1`);
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 400, { ok: false, message: "알 수 없는 action" });
  }

  res.setHeader("Allow", "GET, POST");
  return json(res, 405, { ok: false, message: "GET 또는 POST만 허용됩니다." });
}

function parseJ(v) {
  if (v == null) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
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
