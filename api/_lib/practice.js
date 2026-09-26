/**
 * 📝 연습장 — 노트 과제의 모범답안과, 그 과제를 놓고 하는 문답
 *
 * 왜 만들었나:
 *   독일어 노트 과제는 **베껴 쓰기**입니다. 격변화표를 옮겨 적는 것이고,
 *   답은 이미 수업 본문에 있습니다. 그래서 확인할 장치가 필요 없었습니다.
 *
 *   회계와 수학은 다릅니다. "거래 5개를 분개하세요", "이 문제를 손으로 다시 푸세요" 는
 *   **풀어야 하는 문제**입니다. 그런데 노트 과제가 담고 있던 건 지시문 한 줄(spec)뿐이라,
 *   손으로 풀고 나서 맞았는지 확인할 방법이 아예 없었습니다. 막히면 그냥 막힌 채로 끝납니다.
 *
 * 설계 원칙 세 가지:
 *   ① **먼저 풀어야 답이 열립니다.** 바로 보이면 노트 과제가 베껴 쓰기로 전락합니다.
 *      게이트는 자가신고이고 검증하지 않습니다 — 혼자 배우는 사람이 속일 수 있는 건
 *      자기 자신뿐이라 감시 장치는 낭비입니다. 다만 '한 번 누르는 마찰'은 남겨둡니다.
 *   ② **답안은 수업 만들 때 같이 만듭니다.** 펼치는 행위에 돈이 들면 안 됩니다.
 *      옛 과제처럼 답이 없는 경우에만 최초 1회 생성하고, 그 뒤로는 저장된 걸 씁니다.
 *   ③ **오늘 수업은 건드리지 않습니다.** 질문이 수업 화면을 잠식하면 주객이 전도됩니다.
 *      별도 탭에서, 과제별 스레드로 쌓입니다.
 */

import { getPool } from "./agent-brain.js";
import { generateJson } from "./llm.js";

let tablesReady;

export async function ensurePracticeTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS practice_threads (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        course TEXT NOT NULL,
        task_id TEXT NOT NULL,
        chapter_no INTEGER,
        revealed BOOLEAN NOT NULL DEFAULT FALSE,
        revealed_at TIMESTAMPTZ,
        messages JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    for (const sql of PRACTICE_MIGRATIONS) {
      await pool.query(sql).catch((e) =>
        console.warn('[연습장] 마이그레이션 건너뜀:', sql.trim().slice(0, 60), '—', e.message));
    }
  })().catch((e) => {
    console.error('[연습장] 스키마 준비 실패:', e.message);
    tablesReady = null;
  });
  await tablesReady;
}

const PRACTICE_MIGRATIONS = [
  `CREATE INDEX IF NOT EXISTS idx_pt_user ON practice_threads(user_id, course, updated_at DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_pt_task ON practice_threads(user_id, task_id)`,
];

const threadId = (userId, taskId) => `pt_u${userId}_${taskId}`;

/** 질문 한 번에 딸려 보내는 지난 대화 수. 길어지면 토큰만 먹고 답은 안 좋아집니다. */
const CONTEXT_TURNS = 6;

/* ═══════════════════════════════════════════════════
   📋 모범답안
   ═══════════════════════════════════════════════════ */

/**
 * 과제의 모범답안을 돌려줍니다.
 * 저장돼 있으면 그대로(비용 0), 없으면 **최초 1회만** 만들어 저장합니다.
 * @returns { answer, generated } — generated가 true면 이번에 만든 것
 */
export async function getAnswerKey({ userId, taskId, persona, chapter, label }) {
  const pool = getPool(); if (!pool) return { answer: '', generated: false };
  await ensurePracticeTables();

  const r = await pool.query(
    `SELECT kind, spec, answer_key, sec, title, chapter_no
       FROM notebook_tasks WHERE id=$1 AND user_id=$2`, [taskId, userId]);
  const task = r.rows[0];
  if (!task) return { answer: '', generated: false, missing: true };
  if (task.answer_key) return { answer: task.answer_key, generated: false, task };

  // 답이 없는 과제 — 수업이 답을 안 줬거나, 이 기능이 생기기 전에 발행된 것입니다
  const made = await composeAnswer({ persona, chapter, task, label });
  if (made) {
    await pool.query(
      `UPDATE notebook_tasks SET answer_key=$1 WHERE id=$2 AND user_id=$3`,
      [made.slice(0, 2000), taskId, userId]).catch(() => {});
  }
  return { answer: made || '', generated: !!made, task };
}

/** 지시문만 있는 과제로부터 모범풀이를 만듭니다 */
async function composeAnswer({ persona, chapter, task, label }) {
  const system = `${persona}

## 지금 하는 일
학습자가 종이 노트에 손으로 푼 과제의 **모범풀이**를 보여줍니다.
학습자는 이미 자기 힘으로 풀어본 뒤에 이 답을 펼쳤습니다.

## 규칙
1. **답만 던지지 마세요.** 어떤 순서로 판단해서 그 답에 닿는지를 보여주세요.
   학습자가 자기 답과 나란히 놓고 **어디서 갈렸는지** 찾을 수 있어야 합니다.
2. 과제가 여러 건(거래 여러 개, 문제 여러 개)을 요구했다면 **전부** 풀어 주세요.
   일부만 풀면 나머지는 여전히 확인할 수 없습니다.
3. **표·분개·계산은 반드시 판서 블록으로.** 말로 풀어쓰지 마세요.
4. 마지막에 **"여기서 갈렸다면"** 한 단락. 이 과제에서 가장 흔한 실수 한두 가지와
   그때 무엇을 다시 보면 되는지.
5. 800~1400자.

## 순수 JSON만 출력
{"answer":"모범풀이 본문 (판서 블록 포함)"}`;

  const user = `## 장
[${chapter?.unit || ''}] ${chapter?.sec || ''} ${chapter?.title || ''}

## 과제 (${label || task.kind})
${task.spec}`;

  const { data } = await generateJson({
    system, user, temperature: 0.4, maxTokens: 4096, budgetMs: 45000,
    validate: (d) => !!d?.answer,
    label: `practice-answer:${task.chapter_no}`,
  });
  return data?.answer || '';
}

/* ═══════════════════════════════════════════════════
   🗂 스레드
   ═══════════════════════════════════════════════════ */

async function loadThread(userId, course, taskId, chapterNo) {
  const pool = getPool(); if (!pool) return null;
  await ensurePracticeTables();
  const id = threadId(userId, taskId);
  const r = await pool.query(`SELECT * FROM practice_threads WHERE id=$1`, [id]);
  if (r.rows[0]) return r.rows[0];
  const ins = await pool.query(
    `INSERT INTO practice_threads (id, user_id, course, task_id, chapter_no)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING *`,
    [id, userId, course, taskId, chapterNo || null]).catch(() => ({ rows: [] }));
  if (ins.rows[0]) return ins.rows[0];
  const again = await pool.query(`SELECT * FROM practice_threads WHERE id=$1`, [id]);
  return again.rows[0] || null;
}

const parseMsgs = (m) => Array.isArray(m) ? m
  : (() => { try { return JSON.parse(m) || []; } catch { return []; } })();

/**
 * 연습장 목록 — 노트 과제 + 펼침 여부 + 주고받은 수.
 * 답안 본문은 **여기서 내려보내지 않습니다.** 펼치기 전에 화면에 들어가면 게이트가 무의미합니다.
 */
export async function getPracticeList(userId, course, limit = 40) {
  const pool = getPool(); if (!pool) return [];
  await ensurePracticeTables();
  const r = await pool.query(
    `SELECT t.id, t.chapter_no, t.sec, t.title, t.kind, t.spec, t.target, t.done, t.status,
            (t.answer_key <> '') AS has_answer,
            p.revealed, COALESCE(jsonb_array_length(p.messages), 0) AS msg_count
       FROM notebook_tasks t
       LEFT JOIN practice_threads p ON p.user_id = t.user_id AND p.task_id = t.id
      WHERE t.user_id=$1 AND t.course=$2 AND t.status <> 'skipped'
      ORDER BY t.chapter_no DESC, t.issued_at DESC LIMIT $3`, [userId, course, limit]);
  return r.rows.map(x => ({
    id: x.id, chapterNo: x.chapter_no, sec: x.sec, title: x.title,
    kind: x.kind, spec: x.spec, target: x.target, done: x.done, status: x.status,
    hasAnswer: !!x.has_answer,
    revealed: !!x.revealed,
    msgCount: Number(x.msg_count) || 0,
  }));
}

/** 한 과제의 스레드 — 펼쳤을 때만 답안을 함께 돌려줍니다 */
export async function getThread(userId, course, taskId) {
  const pool = getPool(); if (!pool) return null;
  await ensurePracticeTables();
  const r = await pool.query(
    `SELECT p.revealed, p.messages, t.answer_key, t.spec, t.kind, t.sec, t.title, t.chapter_no
       FROM notebook_tasks t
       LEFT JOIN practice_threads p ON p.user_id = t.user_id AND p.task_id = t.id
      WHERE t.id=$1 AND t.user_id=$2`, [taskId, userId]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    taskId, spec: row.spec, kind: row.kind, sec: row.sec, title: row.title,
    chapterNo: row.chapter_no,
    revealed: !!row.revealed,
    // ⚠️ 펼치기 전에는 답안을 절대 내려보내지 않습니다.
    //    화면에서만 가리면 개발자도구로 그냥 보입니다.
    answer: row.revealed ? (row.answer_key || '') : '',
    messages: parseMsgs(row.messages),
  };
}

/**
 * 📋 답안 펼치기 — "제가 먼저 풀어봤어요"를 누른 뒤에만 부릅니다.
 * 게이트는 자가신고입니다. 검증하지 않습니다.
 */
export async function reveal({ userId, course, taskId, persona, chapter, label }) {
  const pool = getPool(); if (!pool) return null;
  const th = await loadThread(userId, course, taskId, chapter?.no);
  if (!th) return null;

  const { answer, generated, missing } = await getAnswerKey({ userId, taskId, persona, chapter, label });
  if (missing) return null;

  if (!th.revealed) {
    await pool.query(
      `UPDATE practice_threads SET revealed=TRUE, revealed_at=NOW(), updated_at=NOW()
        WHERE id=$1`, [threadId(userId, taskId)]).catch(() => {});
  }
  return { answer, generated, messages: parseMsgs(th.messages) };
}

/**
 * 💬 세진/클로이에게 물어보기.
 * 학습자가 자기 풀이를 적어 올리면 채점도 됩니다 — 질문과 채점을 한 경로로 둡니다.
 * 둘을 나누면 "이거 물어보는 건가 채점받는 건가"를 학습자가 먼저 판단해야 해서요.
 */
export async function ask({ userId, course, taskId, question, persona, chapter, label }) {
  const pool = getPool(); if (!pool) return null;
  const text = String(question || '').trim();
  if (!text) return { error: '질문을 적어주세요.' };

  const th = await loadThread(userId, course, taskId, chapter?.no);
  if (!th) return null;

  const tr = await pool.query(
    `SELECT spec, kind, answer_key FROM notebook_tasks WHERE id=$1 AND user_id=$2`,
    [taskId, userId]);
  const task = tr.rows[0];
  if (!task) return null;

  const history = parseMsgs(th.messages);

  const system = `${persona}

## 지금 하는 일
학습자가 **연습장**에서 노트 과제를 놓고 질문했습니다.
여기는 오늘 수업이 아니라, 손으로 풀어본 뒤에 막힌 걸 푸는 자리입니다.

## 규칙
1. **물어본 것만 답하세요.** 장 전체를 다시 강의하지 마세요.
2. 학습자가 **자기 풀이를 적어 올렸다면 그걸 채점**하세요.
   먼저 맞은 부분을 구체적으로 인정하고, 갈라진 지점만 짚습니다.
   맞았으면 맞았다고 분명히 말해주세요 — 확인이 안 되면 다음으로 못 넘어갑니다.
3. **표·분개·계산은 판서 블록으로.** 말로 풀어쓰지 마세요.
4. 300~700자. 여기는 짧게 주고받는 자리입니다.
5. 모르면 모른다고 하세요. 특히 세법·회계기준의 구체적 적용은
   "이건 세무사와 상의하셔야 해요"라고 분명히 넘기세요.

## 순수 JSON만 출력
{"reply":"답변 본문"}`;

  const user = `## 장
[${chapter?.unit || ''}] ${chapter?.sec || ''} ${chapter?.title || ''}

## 과제 (${label || task.kind})
${task.spec}
${task.answer_key ? `\n## 이 과제의 모범풀이 (학습자도 이미 봤습니다)\n${String(task.answer_key).slice(0, 1200)}` : ''}
${history.length ? `\n## 지금까지 주고받은 것\n${history.slice(-CONTEXT_TURNS)
    .map(m => `${m.role === 'user' ? '학습자' : '선생'}: ${String(m.content).slice(0, 400)}`).join('\n')}` : ''}

## 학습자의 질문
${text.slice(0, 1200)}`;

  const { data } = await generateJson({
    system, user, temperature: 0.5, maxTokens: 2048, budgetMs: 45000,
    validate: (d) => !!d?.reply,
    label: `practice-ask:${chapter?.no ?? '?'}`,
  });

  const reply = data?.reply
    || '답을 만드는 중에 문제가 생겼어요. 다시 한 번 물어봐 주세요.';
  const add = [
    { role: 'user', content: text.slice(0, 1200), at: new Date().toISOString() },
    { role: 'teacher', content: reply, at: new Date().toISOString() },
  ];
  await pool.query(
    `UPDATE practice_threads SET messages = messages || $1::jsonb, updated_at = NOW()
      WHERE id=$2`, [JSON.stringify(add), threadId(userId, taskId)]).catch(() => {});

  return { reply, parseError: !data?.reply, messages: [...history, ...add] };
}
