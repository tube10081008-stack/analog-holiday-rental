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
import { resolveUser, invite, listUsers, partnersOf, removeUser, rotateKey,
         ensureUserTables } from "./_lib/users.js";

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

  // 👥 키로 사람을 가립니다. 대표는 기존 관리자 키 그대로, 친구는 초대 키로 들어옵니다.
  // 공용 수업방(독일어·회계)은 여러 사람을 받고, 나머지는 지금까지대로 대표 전용입니다.
  let me = null;
  try { me = await resolveUser(key); } catch { /* DB 미연결 시 아래 폴백 */ }
  const isOwnerKey = !!stored && key === stored;
  if (!me && !isOwnerKey) {
    return json(res, 401, { ok: false, message: "관리자 인증이 필요합니다." });
  }
  // DB가 없거나 아직 계정이 안 만들어졌으면 대표로 봅니다 (기존 동작 유지)
  if (!me) me = { id: 1, name: process.env.OWNER_NAME || "나", is_owner: true,
                  courses: ["german", "accounting", "math", "chinese"] };

  try {
    // 🀄 과정별 분기 (Hobby 함수 한도 12개 때문에 엔드포인트를 공유합니다)
    const body0 = req.method === "POST" ? readBody(req) : {};
    const course0 = query.course || body0.course;

    // 공용 수업방 — 초대받은 사람도 들어올 수 있습니다.
    // 다만 자기 courses에 없는 과정은 막습니다 (독일어만 초대된 사람이 회계로 못 넘어가게)
    // Object.hasOwn으로 확인합니다. ROOMS[course0]만 보면 ?course=constructor 같은
    // 값이 프로토타입 체인에서 truthy로 걸려 엉뚱한 곳으로 들어갑니다.
    if (course0 && Object.hasOwn(ROOMS, course0)) {
      const allowed = me.is_owner || (me.courses || []).includes(course0);
      if (!allowed) {
        return json(res, 403, {
          ok: false, message: "이 교실에는 아직 초대되지 않았어요.",
        });
      }
      return await handleRoom(req, res, query, body0, me, ROOMS[course0]);
    }

    // 아래 과정들은 대표 전용입니다. 친구 계정으로는 들어올 수 없습니다.
    if (!me.is_owner) {
      return json(res, 403, {
        ok: false, message: "이 과정은 아직 함께하기가 열려 있지 않아요. 독일어 노트로 가주세요.",
      });
    }
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
      // 👥 팀원 현황 — 조회 전용이라 LLM을 부르지 않습니다.
      //    (현황을 보는 데 돈이 들면 자주 안 보게 됩니다)
      if (action === "team") {
        const { getTeamStatus } = await import("./_lib/team.js");
        return json(res, 200, { ok: true, ...(await getTeamStatus()) });
      }
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
  const NB = await import("./_lib/notebook.js");
  await NB.ensureNotebookTables();
  // 중국어는 아직 대표 전용이라 사람은 늘 1번입니다.
  // (노트 테이블은 이미 user_id를 갖고 있어 나중에 열어도 그대로 맞습니다)
  const uid = 1;

  /**
   * 중국어는 '장'이 아니라 '장면'입니다. 노트 페이지 번호를 레벨-장면으로 만듭니다.
   *   예: 2레벨 3번째 장면 → 번호 203, 표기 "2-3"
   * 앱이 종이 노트의 목차가 되려면 번호 체계가 한 가지여야 해서요.
   */
  const sceneAsChapter = (session) => {
    const level = Number(session?.level) || 1;
    // ⚠️ 세션 행에는 scene_index가 없습니다. 프로필의 값을 쓰면 이미 다음으로
    //    넘어가 있을 수 있으므로, 장면 이름으로 목록에서 되찾습니다.
    const list = CN.SCENES[level]?.list || [];
    const i = Math.max(0, list.findIndex(x => x.cn === session?.scene_cn));
    return {
      no: level * 100 + i,
      sec: `${level}-${i + 1}`,
      title: `${session?.scene_cn || ''} ${session?.scene || ''}`.trim(),
    };
  };

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
        // 📓 지난 장면에서 낸 손글씨 과제 — 진도를 막지 않고 물어만 봅니다
        notebookPending: await NB.getPending(uid, 'chinese', 3),
      });
    }

    // 📓 내 노트 — 앱이 종이 노트의 색인이 됩니다
    if (action === "notebook") {
      const idx = await NB.getIndex(uid, 'chinese');
      return json(res, 200, { ok: true, pages: idx.pages, notebookStats: idx.stats,
        kinds: NB.TASK_KINDS, stats: await CN.getChineseStats(), xp: await CN.getXpState() });
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
      const r = await CN.reviewCard(body.cardId, body.quality, !!body.wrote);
      if (!r) return json(res, 404, { ok: false, message: "카드를 찾을 수 없습니다." });
      return json(res, 200, { ok: true, result: r, ...r,
        stats: await CN.getCardStats(), xp: await CN.getXpState() });
    }

    if (body.action === "notebook-done") {
      const out = await NB.bumpTask(uid, body.taskId, Number(body.by) || 1);
      if (!out) return json(res, 404, { ok: false, message: "그런 과제가 없거나 이미 끝났습니다." });
      const xpGained = out.closed
        ? await CN.grantXp(15, '노트 과제 완료', `nb_${body.taskId}`) : 0;
      return json(res, 200, { ok: true, ...out, xpGained, xp: await CN.getXpState() });
    }

    if (body.action === "notebook-skip") {
      const ok = await NB.dismissTask(uid, body.taskId);
      return json(res, 200, { ok, message: ok ? '접었습니다.' : '이미 처리된 과제입니다.' });
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

      // 📓 한자는 읽는 것과 쓰는 것이 다른 기억입니다.
      //    오늘 나온 표현을 손으로 쓰는 과제를 발행합니다.
      const page = sceneAsChapter(open);
      const hanzi = [...focus, ...(evaluation.newCards || [])]
        .map(c => c?.hanzi || c?.cn || c?.front).filter(Boolean).slice(0, 5);
      const notebookIssued = await NB.issueTasks(uid, 'chinese', page, [
        { kind: 'hanzi', target: 3,
          spec: hanzi.length
            ? `오늘 표현을 노트에 획순대로 쓰세요 — ${hanzi.join(', ')}. 병음과 뜻도 옆에 적고요.`
            : `오늘 장면의 핵심 표현을 노트에 획순대로 쓰세요. 병음과 뜻도 옆에 적고요.` },
      ]).catch(() => 0);

      return json(res, 200, {
        ok: true, evaluation, cardsAdded: added, lessonXp,
        xpEarnedNote: score >= 70 ? null : '70점 이상부터 XP가 적립됩니다.',
        notebookIssued, notebookTasks: await NB.getPending(uid, 'chinese', 3),
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

/* ═══════════════════════════════════════════════════
   📓 공용 수업방 런타임
   ───────────────────────────────────────────────────
   독일어 노트에서 다듬은 흐름(수업 → 노트 과제 → 복습 → 함께)을
   한 벌만 두고 과정별 설명서(ROOM)만 갈아끼웁니다.
   교실을 하나 더 열 때마다 이 330줄을 복사하면 고칠 곳이 두 배가 되니까요.

   Hobby 함수 한도 12개 때문에 모든 과정이 이 엔드포인트를 공유합니다.
   ═══════════════════════════════════════════════════ */

/**
 * 과정별로 다른 것만 모아둔 설명서.
 *   load       : 그 과정의 라이브러리
 *   adapt      : 라이브러리의 함수 이름을 공용 이름으로 맞춰줍니다
 *                (german은 ensureGermanTables, accounting은 ensureAccountingTables …)
 *   subTitle   : 레슨 행에서 부제를 꺼내는 법 (독일어는 원어 제목, 회계는 목차 번호)
 *   cardsOf    : 레슨 행에서 복습 카드를 꺼내는 법 (수학은 'formulas'라고 부릅니다)
 *   lessonExtra: 그 과정 화면만 쓰는 추가 필드
 *   labels     : "다시 설명해 주세요"에서 보여줄 대목 이름
 */
const ROOMS = {
  german: {
    course: 'german',
    load: () => import("./_lib/german.js"),
    adapt: (M) => ({ ...M, ensureTables: M.ensureGermanTables,
                     getStats: M.getGermanStats, persona: M.LENA_FOR_PEER }),
    subTitle: (row) => row.de_title || '',
    chapterSub: (c) => c.de || '',
    cardsOf: (row) => parseJ(row.cards) || [],
    genCards: (gen) => ({ cards: gen.cards || [] }),
    lessonExtra: () => ({}),
    labels: { intro: '도입 — 이 규칙이 왜 생겼나', warmup: '준비운동 — 되짚을 것',
              concept: '핵심 설명', walkthrough: '문장 해부' },
  },
  accounting: {
    course: 'accounting',
    load: () => import("./_lib/accounting.js"),
    adapt: (M) => ({ ...M, ensureTables: M.ensureAccountingTables,
                     getStats: M.getAccountingStats, persona: M.SEJIN_FOR_PEER }),
    subTitle: (row) => row.sub_title || '',
    chapterSub: (c) => c.sec || '',
    cardsOf: (row) => parseJ(row.cards) || [],
    genCards: (gen) => ({ cards: gen.cards || [] }),
    lessonExtra: () => ({}),
    labels: { intro: '도입 — 이 장치가 왜 생겼나', warmup: '준비운동 — 되짚을 것',
              concept: '핵심 설명', walkthrough: '거래 해부' },
  },
  math: {
    course: 'math',
    load: () => import("./_lib/math.js"),
    // 수학은 카드를 '공식(formulas)'이라 부르고 도감 탭이 없습니다.
    // 이름만 맞춰주면 나머지 흐름은 그대로 돕니다.
    adapt: (M) => ({ ...M, ensureTables: M.ensureMathTables,
                     getStats: M.getMathStats, persona: M.CHLOE_FOR_PEER,
                     addCards: M.addFormulaCards,
                     TIERS: {}, getCollection: async () => ({ kinds: {}, total: 0 }) }),
    subTitle: () => '',
    chapterSub: () => '',
    cardsOf: (row) => parseJ(row.formulas) || [],
    genCards: (gen) => ({ formulas: gen.formulas || [] }),
    lessonExtra: (row) => ({ formulas: parseJ(row.formulas) || [] }),
    labels: { intro: '도입 — 이 개념이 왜 필요했나', warmup: '준비운동 — 선수 개념',
              concept: '개념 설명', walkthrough: '함께 풀어보기' },
  },
};

async function handleRoom(req, res, query, body, me, ROOM) {
  const course = ROOM.course;
  const GE = ROOM.adapt(await ROOM.load());
  const NB = await import("./_lib/notebook.js");
  const TG = await import("./_lib/together.js");
  await GE.ensureTables();
  await NB.ensureNotebookTables();
  await TG.ensureTogetherTables();
  await ensureUserTables();   // peer 조회가 study_users를 조인하므로 먼저 보장합니다
  const uid = me.id;
  const action = query.action || body.action || "today";

  const chapterMeta = (lesson) => GE.CHAPTERS.find(c => c.no === lesson.chapter_no)
    || { no: lesson.chapter_no, sec: String(lesson.chapter_no), title: lesson.title,
         de: ROOM.subTitle(lesson), unit: lesson.unit };

  if (req.method === "GET") {
    if (action === "today") {
      let lesson = await GE.getOpenLesson(uid);
      let created = false, shared = false;
      if (!lesson) {
        const profile = await GE.getProfile(uid);
        const chapter = GE.getChapter(profile?.chapter_index ?? 0);

        // 🤝 같은 장을 이미 누가 배웠으면 그 텍스트를 그대로 씁니다.
        // 둘이 같은 글을 읽어야 답 비교가 의미 있고, 생성 비용도 아낍니다.
        const existing = await GE.findSharedLesson(chapter.no);
        if (existing) {
          lesson = await GE.createLesson(uid, chapter, {
            intro: existing.intro, concept: existing.concept, aside: existing.aside,
            warmup: parseJ(existing.warmup) || [],
            walkthrough: parseJ(existing.walkthrough) || {},
            problems: parseJ(existing.problems) || [],
            summary: parseJ(existing.summary) || [],
            notebook: parseJ(existing.notebook) || [],
            ...ROOM.genCards({ cards: parseJ(existing.cards) || [],
                               formulas: parseJ(existing.formulas) || [] }),
          });
          created = true; shared = true;
        } else {
          const gaps = await GE.getGaps(uid, 6);
          const priorContext = gaps.length
            ? `## 지금까지 관찰된 약한 곳 (설명에 자연스럽게 녹여 주세요)\n${
                gaps.map(g => `- ${g.concept} (${g.times}회)`).join('\n')}`
            : '## 아직 파악된 약점이 없습니다. 설명하면서 관찰해 주세요.';
          const gen = await GE.generateLesson(chapter, priorContext);
          lesson = await GE.createLesson(uid, chapter, gen);
          created = true;
        }
      }
      const problems = parseJ(lesson.problems) || [];
      const partners = await partnersOf(uid, course);
      return json(res, 200, {
        ok: true, created, shared,
        me: { id: me.id, name: me.name, isOwner: !!me.is_owner },
        lesson: {
          id: lesson.id, chapterNo: lesson.chapter_no, unit: lesson.unit,
          // deTitle은 독일어 화면이 쓰는 옛 이름입니다. subTitle이 과정 공용 이름이고
          // 둘 다 같은 값을 담습니다 — 화면을 한꺼번에 고치지 않아도 되도록.
          title: lesson.title, deTitle: ROOM.subTitle(lesson), subTitle: ROOM.subTitle(lesson),
          intro: lesson.intro, concept: lesson.concept, aside: lesson.aside || '',
          warmup: parseJ(lesson.warmup) || [],
          walkthrough: parseJ(lesson.walkthrough) || {},
          problems: problems.map(p => ({
            question: p.question, level: p.level || 'trap', hint: p.hint || '',
            gloss: Array.isArray(p.gloss) ? p.gloss : [],
          })),
          problemCount: problems.length,
          summary: parseJ(lesson.summary) || [],
          step: lesson.step, turns: parseJ(lesson.turns) || [],
          ...ROOM.lessonExtra(lesson),
        },
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid),
        gaps: await GE.getGaps(uid, 5),
        notebookPending: await NB.getPending(uid, course, 3),
        partnerCount: partners.length,
        unseenNotes: await TG.unseenCount(uid, course),
      });
    }

    if (action === "notebook") {
      const idx = await NB.getIndex(uid, course);
      return json(res, 200, { ok: true, pages: idx.pages, notebookStats: idx.stats,
        kinds: NB.TASK_KINDS,
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid) });
    }

    if (action === "map") {
      const done = await GE.getDoneChapters(uid);
      const profile = await GE.getProfile(uid);
      const currentNo = GE.getChapter(profile?.chapter_index ?? 0).no;
      return json(res, 200, {
        ok: true, units: GE.UNITS, currentNo,
        chapters: GE.CHAPTERS.map(c => ({
          ...c, done: done.includes(c.no), current: c.no === currentNo,
        })),
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid),
      });
    }

    if (action === "review") {
      return json(res, 200, {
        ok: true, cards: await GE.getDueCards(uid, 12), tiers: GE.TIERS,
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid),
      });
    }

    if (action === "collection") {
      const col = await GE.getCollection(uid);
      return json(res, 200, { ok: true, ...col, tiers: GE.TIERS,
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid) });
    }

    if (action === "gaps") {
      return json(res, 200, { ok: true, gaps: await GE.getGaps(uid, 20),
        stats: await GE.getStats(uid) });
    }

    // 🤝 함께 — 친구 진도 + 주고받은 설명
    if (action === "together") {
      const partners = await partnersOf(uid, course);
      const profile = await GE.getProfile(uid);
      await TG.markSeen(uid, course);
      return json(res, 200, {
        ok: true,
        me: { id: me.id, name: me.name, isOwner: !!me.is_owner,
              chapterIndex: profile?.chapter_index ?? 0 },
        partners: await TG.partnerProgress(course, partners),
        inbox: await TG.inboxFor(uid, course),
        outbox: await TG.outboxFor(uid, course),
        chapters: GE.CHAPTERS.map(c => ({ no: c.no, sec: c.sec, title: c.title,
                                          de: ROOM.chapterSub(c), sub: ROOM.chapterSub(c) })),
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid),
      });
    }

    // 배포 후 어느 모델로 돌고 있는지 확인용 (키 값 자체는 노출하지 않습니다)
    if (action === "provider") {
      const { providerInfo } = await import("./_lib/llm.js");
      return json(res, 200, { ok: true, ...providerInfo() });
    }

    // 초대 관리 — 주인만
    if (action === "members") {
      if (!me.is_owner) return json(res, 403, { ok: false, message: "주인만 볼 수 있어요." });
      return json(res, 200, { ok: true, users: await listUsers() });
    }

    return json(res, 400, { ok: false, message: "알 수 없는 action" });
  }

  if (req.method === "POST") {
    if (body.action === "step") {
      await GE.advanceStep(uid, body.lessonId, Number(body.step) || 0, null);
      return json(res, 200, { ok: true });
    }

    if (body.action === "deepen") {
      const lesson = await GE.getOpenLesson(uid);
      if (!lesson || lesson.id !== body.lessonId) {
        return json(res, 409, { ok: false, message: "진행 중인 수업이 아닙니다." });
      }
      const wt = parseJ(lesson.walkthrough) || {};
      const SECTIONS = {
        intro:   { label: ROOM.labels.intro, text: lesson.intro },
        warmup:  { label: ROOM.labels.warmup, text: (parseJ(lesson.warmup) || [])
                     .map(w => `${w.concept}\n${w.refresher}`).join('\n\n') },
        concept: { label: ROOM.labels.concept, text: lesson.concept },
        walkthrough: { label: ROOM.labels.walkthrough, text: [wt.problem,
                        ...(wt.steps || []).map(s => `${s.what} — ${s.why}`), wt.recap]
                        .filter(Boolean).join('\n') },
      };
      const sec = SECTIONS[body.section] || SECTIONS.concept;
      const out = await GE.explainMore({
        chapter: chapterMeta(lesson),
        sectionLabel: sec.label, sectionText: sec.text, question: body.question,
        askedBefore: Array.isArray(body.askedBefore) ? body.askedBefore.slice(-3) : [],
      });
      if (out.parseError) return json(res, 200, { ok: true, parseError: true, message: out.explanation });
      return json(res, 200, { ok: true, ...out });
    }

    if (body.action === "answer") {
      const lesson = await GE.getOpenLesson(uid);
      if (!lesson || lesson.id !== body.lessonId) {
        return json(res, 409, { ok: false, message: "진행 중인 수업이 아닙니다." });
      }
      const problems = parseJ(lesson.problems) || [];
      const idx = Number(body.problemIndex) || 0;
      const problem = problems[idx];
      if (!problem) return json(res, 400, { ok: false, message: "문제를 찾을 수 없습니다." });

      const chapter = chapterMeta(lesson);
      const graded = await GE.gradeAnswer({
        chapter, problem, userAnswer: body.answer, history: parseJ(lesson.turns) || [],
      });
      if (graded.parseError) return json(res, 200, { ok: true, parseError: true, message: graded.feedback });

      // problemIndex를 함께 남깁니다 — 친구와 답을 맞춰 보려면 어느 문제였는지 알아야 합니다
      await GE.advanceStep(uid, lesson.id, Number(body.step) || lesson.step,
        { role: 'user', problemIndex: idx, content: String(body.answer).slice(0, 800),
          correct: graded.correct, at: new Date().toISOString() });

      if (graded.gapConcept) await GE.recordGap(uid, lesson.chapter_no, graded.gapConcept, graded.gapPatch);

      let notebookPointer = null;
      if (!graded.correct) {
        notebookPointer = await NB.pointerFor(uid, course, GE.CHAPTERS, lesson.chapter_no, graded.gapConcept);
        const already = await NB.countOpen(uid, course, lesson.chapter_no, 'errors');
        if (already === 0) {
          await NB.issueTasks(uid, course, chapter,
            [NB.errorTask(problem.answer)]).catch(() => {});
        }
      }

      const xpGained = graded.correct
        ? await GE.grantXp(uid, 20, '확인문제 정답', `${lesson.id}_p${idx}`)
        : 0;

      // 🤝 내가 제출한 뒤에만 친구 답이 열립니다 (먼저 열리면 베끼게 됩니다)
      const partners = await partnersOf(uid, course);
      const peers = await TG.peerAnswers({
        course, chapterNo: lesson.chapter_no, problemIndex: idx,
        userId: uid, partnerIds: partners.map(p => p.id), mySubmitted: true,
      });

      return json(res, 200, {
        ok: true, graded, xpGained, answer: problem.answer, notebookPointer,
        peers, problemIndex: idx, chapterNo: lesson.chapter_no,
        xp: await GE.getXpState(uid),
      });
    }

    // 🤝 친구 답에 설명 남기기 — 레나가 먼저 검증합니다
    if (body.action === "explain-peer") {
      const lesson = await GE.getOpenLesson(uid);
      const chapterNo = Number(body.chapterNo) || lesson?.chapter_no;
      const idx = Number(body.problemIndex) || 0;
      const text = String(body.text || '').trim();
      if (!text) return json(res, 400, { ok: false, message: "설명을 적어주세요." });
      if (!chapterNo) return json(res, 400, { ok: false, message: "어느 장인지 알 수 없어요." });

      const partners = await partnersOf(uid, course);
      const target = partners.find(p => p.id === Number(body.toUser));
      if (!target) return json(res, 400, { ok: false, message: "그런 친구가 없어요." });

      const chapter = GE.CHAPTERS.find(c => c.no === chapterNo) || { no: chapterNo, sec: '', title: '', de: '', unit: '' };
      const problems = parseJ(lesson?.problems) || [];
      const prob = problems[idx] || {};

      const check = await TG.verifyExplanation({
        chapter, problem: prob.question || '(문제 없음)', correctAnswer: prob.answer || '',
        peerAnswer: body.peerAnswer, explanation: text, persona: GE.persona,
      });

      const saved = await TG.saveNote({
        course, chapterNo, problemIndex: idx, fromUser: uid,
        toUser: target.id, text, verdict: check.verdict, lenaNote: check.note,
      });
      // 설명이 맞았을 때만 작게 보상합니다 (가르치는 쪽이 더 배우니까요)
      // 저장에 실패하면 ref가 undefined가 되어 다음 설명까지 막히므로 그때는 XP를 건너뜁니다
      const xpGained = check.verdict === 'ok' && saved?.id
        ? await GE.grantXp(uid, 15, '친구에게 설명', `peer_${saved.id}`) : 0;

      return json(res, 200, {
        ok: true, verdict: check.verdict, lenaNote: check.note,
        delivered: check.verdict === 'ok', xpGained, xp: await GE.getXpState(uid),
      });
    }

    if (body.action === "complete") {
      const lesson = await GE.getOpenLesson(uid);
      if (!lesson || lesson.id !== body.lessonId) {
        return json(res, 409, { ok: false, message: "진행 중인 수업이 아닙니다." });
      }
      const lessonCards = ROOM.cardsOf(lesson);
      const cardsAdded = await GE.addCards(uid, lessonCards, lesson.chapter_no);
      const meta = chapterMeta(lesson);
      let nbTasks = parseJ(lesson.notebook) || [];
      if (!nbTasks.length) {
        nbTasks = NB.deriveTasks(course, meta, {
          concept: lesson.concept, walkthrough: parseJ(lesson.walkthrough) || {},
          cards: lessonCards,
        });
      }
      const notebookIssued = await NB.issueTasks(uid, course, meta, nbTasks);
      await GE.completeLesson(uid, lesson.id);
      const xpGained = await GE.grantXp(uid, 60, `${lesson.title} 수료`, `${lesson.id}_done`);
      return json(res, 200, {
        ok: true, cardsAdded, xpGained, notebookIssued,
        notebookTasks: await NB.getPending(uid, course, 4),
        stats: await GE.getStats(uid), xp: await GE.getXpState(uid),
      });
    }

    if (body.action === "review") {
      const out = await GE.reviewCard(uid, body.cardId, Number(body.quality), !!body.wrote);
      if (!out) return json(res, 404, { ok: false, message: "카드를 찾을 수 없습니다." });
      return json(res, 200, { ok: true, ...out, xp: await GE.getXpState(uid) });
    }

    if (body.action === "notebook-done") {
      const out = await NB.bumpTask(uid, body.taskId, Number(body.by) || 1);
      if (!out) return json(res, 404, { ok: false, message: "그런 과제가 없거나 이미 끝났습니다." });
      const xpGained = out.closed
        ? await GE.grantXp(uid, 15, '노트 과제 완료', `nb_${body.taskId}`) : 0;
      return json(res, 200, { ok: true, ...out, xpGained, xp: await GE.getXpState(uid) });
    }

    if (body.action === "notebook-skip") {
      const ok = await NB.dismissTask(uid, body.taskId);
      return json(res, 200, { ok, message: ok ? '접었습니다.' : '이미 처리된 과제입니다.' });
    }

    if (body.action === "jump") {
      const idx = GE.CHAPTERS.findIndex(c => c.no === Number(body.chapterNo));
      if (idx < 0) return json(res, 400, { ok: false, message: "그런 장이 없습니다." });
      const open = await GE.getOpenLesson(uid);
      if (open) await GE.completeLesson(uid, open.id).catch(() => {});
      await GE.setChapterIndex(uid, idx);
      return json(res, 200, { ok: true });
    }

    /* ── 초대 관리 (주인만) ── */
    if (body.action === "invite") {
      if (!me.is_owner) return json(res, 403, { ok: false, message: "주인만 초대할 수 있어요." });
      const u = await invite(body.name, [course]);
      if (!u) return json(res, 500, { ok: false, message: "초대를 만들지 못했습니다." });
      return json(res, 200, { ok: true, user: { id: u.id, name: u.name, key: u.login_key } });
    }

    if (body.action === "member-remove") {
      if (!me.is_owner) return json(res, 403, { ok: false, message: "주인만 할 수 있어요." });
      return json(res, 200, { ok: await removeUser(body.userId) });
    }

    if (body.action === "member-rotate") {
      if (!me.is_owner) return json(res, 403, { ok: false, message: "주인만 할 수 있어요." });
      const u = await rotateKey(body.userId);
      if (!u) return json(res, 404, { ok: false, message: "그런 사람이 없어요." });
      return json(res, 200, { ok: true, user: { id: u.id, name: u.name, key: u.login_key } });
    }

    return json(res, 400, { ok: false, message: "알 수 없는 action" });
  }

  return json(res, 405, { ok: false, message: "지원하지 않는 메서드" });
}
