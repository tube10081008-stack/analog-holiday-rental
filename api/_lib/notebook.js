/**
 * 📓 노트 연동 — 앱이 주(主), 종이 노트가 종(從)
 *
 * 설계 원칙: 노트는 앱이 혼자 못 하는 일을 맡고, 앱은 노트에 '무엇이 적혀 있어야 하는지'를 안다.
 * 앱이 노트를 읽지는 않습니다. 읽으려 들면 손글씨 OCR 오류가 채점을 막는 구조가 되고,
 * 노트·펜·카메라가 다 있어야만 진도가 나가는 앱이 되어버립니다.
 *
 * 그래서 네 가지만 합니다.
 *   ① 손으로 써서 맞힌 복습은 간격을 더 길게 준다 (보상이 포인트가 아니라 '복습이 줄어드는 것')
 *   ② 틀렸을 때 새 설명 대신 학습자가 직접 쓴 노트 페이지를 가리킨다
 *   ③ 구체적인 쓰기 과제를 번호와 함께 발행하고, 다음 접속 때 회수한다
 *   ④ '내 노트' 색인 — 앱이 종이 노트의 목차 역할을 한다
 *
 * 진도를 막지 않고, 자가신고를 검증하지 않습니다.
 * 혼자 배우는 사람이 속일 수 있는 건 자기 자신뿐이라 감시 장치는 낭비입니다.
 */

import { getPool } from "./agent-brain.js";

let tablesReady;

/** 과제 종류 — 라벨은 UI에서 그대로 씁니다 */
export const TASK_KINDS = {
  table:       { label: '표 채우기',   icon: '▦', hint: '가리고 채우기를 반복하세요' },
  conjugation: { label: '변화형 쓰기', icon: '⋮', hint: '소리 내어 읽으면서 쓰면 더 붙어요' },
  sentences:   { label: '예문 옮기기', icon: '¶', hint: '뜻도 같이 적어두면 나중에 찾기 쉬워요' },
  errors:      { label: '오답 정리',   icon: '✗', hint: '왜 틀렸는지 한 줄을 꼭 같이 쓰세요' },
  vocab:       { label: '단어 쓰기',   icon: '✎', hint: '관사·복수형까지 함께 쓰세요' },
};

export async function ensureNotebookTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = pool.query(`
    CREATE TABLE IF NOT EXISTS notebook_tasks (
      id TEXT PRIMARY KEY,
      course TEXT NOT NULL,
      chapter_no INTEGER NOT NULL,
      sec TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'table',
      spec TEXT NOT NULL,
      target INTEGER NOT NULL DEFAULT 1,
      done INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      photo_url TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      done_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_nb_open ON notebook_tasks(course, status, issued_at);
    CREATE INDEX IF NOT EXISTS idx_nb_ch ON notebook_tasks(course, chapter_no);
  `).catch(() => { tablesReady = null; });
  await tablesReady;
}

/** 결정적 ID — 같은 장의 같은 과제를 두 번 발행해도 늘어나지 않습니다 */
const taskId = (course, chapterNo, kind, spec) =>
  `nb_${course}_${chapterNo}_${kind}_${Buffer.from(String(spec)).toString('base64url').slice(0, 24)}`;

/**
 * 쓰기 과제를 발행합니다 (장을 마칠 때 호출).
 * @param chapter { no, sec, title }
 * @param tasks   [{ kind, spec, target }]
 */
export async function issueTasks(course, chapter, tasks) {
  const pool = getPool();
  if (!pool || !Array.isArray(tasks) || !tasks.length) return 0;
  await ensureNotebookTables();
  let n = 0;
  for (const t of tasks.slice(0, 4)) {
    const spec = String(t?.spec || '').trim();
    if (!spec) continue;
    const kind = TASK_KINDS[t.kind] ? t.kind : 'table';
    const target = Math.max(1, Math.min(9, Number(t.target) || 1));
    const id = taskId(course, chapter.no, kind, spec);
    try {
      const r = await pool.query(
        `INSERT INTO notebook_tasks (id, course, chapter_no, sec, title, kind, spec, target)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [id, course, chapter.no, chapter.sec || String(chapter.no), chapter.title || '',
         kind, spec.slice(0, 400), target]);
      if (r.rowCount > 0) n++;
    } catch { /* skip */ }
  }
  return n;
}

/** 아직 안 쓴 과제 — 다음 접속 때 "하셨어요?"로 회수합니다 */
export async function getPending(course, limit = 5) {
  const pool = getPool(); if (!pool) return [];
  await ensureNotebookTables();
  const r = await pool.query(
    `SELECT id, chapter_no, sec, title, kind, spec, target, done, issued_at
     FROM notebook_tasks WHERE course=$1 AND status='open'
     ORDER BY issued_at ASC LIMIT $2`, [course, limit]);
  return r.rows.map(row => ({
    id: row.id, chapterNo: row.chapter_no, sec: row.sec, title: row.title,
    kind: row.kind, spec: row.spec, target: row.target, done: row.done,
    ...TASK_KINDS[row.kind],
    daysAgo: Math.floor((Date.now() - new Date(row.issued_at)) / 86400000),
  }));
}

/**
 * 한 회차 썼다고 표시합니다. target에 도달하면 자동으로 닫힙니다.
 * @returns { done, target, closed } 또는 null
 */
export async function bumpTask(taskIdStr, by = 1) {
  const pool = getPool(); if (!pool) return null;
  await ensureNotebookTables();
  const r = await pool.query(
    `UPDATE notebook_tasks
        SET done = LEAST(target, done + $1),
            status  = CASE WHEN done + $1 >= target THEN 'done' ELSE status END,
            done_at = CASE WHEN done + $1 >= target THEN NOW() ELSE done_at END
      WHERE id = $2 AND status = 'open'
      RETURNING done, target, status`,
    [Math.max(1, Number(by) || 1), taskIdStr]);
  const row = r.rows[0];
  if (!row) return null;
  return { done: row.done, target: row.target, closed: row.status === 'done' };
}

/** 과제를 통째로 접습니다 ("이건 안 할래요") */
export async function dismissTask(taskIdStr) {
  const pool = getPool(); if (!pool) return false;
  await ensureNotebookTables();
  const r = await pool.query(
    `UPDATE notebook_tasks SET status='skipped', done_at=NOW()
      WHERE id=$1 AND status='open'`, [taskIdStr]);
  return r.rowCount > 0;
}

/** 노트 페이지 사진 — 채점용이 아니라 보관용입니다 (OCR 하지 않습니다) */
export async function attachPhoto(taskIdStr, url) {
  const pool = getPool(); if (!pool || !url) return false;
  await ensureNotebookTables();
  const r = await pool.query(
    `UPDATE notebook_tasks SET photo_url=$1 WHERE id=$2`, [String(url).slice(0, 900), taskIdStr]);
  return r.rowCount > 0;
}

/**
 * '내 노트' 색인 — 앱이 종이 노트의 목차가 됩니다.
 * 장 번호(=교재 절 번호)로 묶어 돌려줍니다.
 */
export async function getIndex(course, limit = 200) {
  const pool = getPool(); if (!pool) return { pages: [], stats: { open: 0, done: 0 } };
  await ensureNotebookTables();
  const r = await pool.query(
    `SELECT * FROM notebook_tasks WHERE course=$1 ORDER BY chapter_no, issued_at LIMIT $2`,
    [course, limit]);
  const byChapter = new Map();
  let open = 0, done = 0;
  for (const t of r.rows) {
    if (t.status === 'open') open++; else if (t.status === 'done') done++;
    if (!byChapter.has(t.chapter_no)) {
      byChapter.set(t.chapter_no, {
        chapterNo: t.chapter_no, sec: t.sec, title: t.title, tasks: [], photo: null,
      });
    }
    const page = byChapter.get(t.chapter_no);
    page.tasks.push({
      id: t.id, kind: t.kind, spec: t.spec, target: t.target, done: t.done,
      status: t.status, ...TASK_KINDS[t.kind],
    });
    if (t.photo_url && !page.photo) page.photo = t.photo_url;
  }
  return { pages: [...byChapter.values()], stats: { open, done } };
}

/**
 * ② "노트 X.X 펴세요" — 틀렸을 때 새 설명 대신 본인 손글씨를 가리킵니다.
 *
 * gapConcept(흔들린 선행 개념)이 어느 장에서 다뤄졌는지 찾습니다.
 * 못 찾으면 현재 장을 가리킵니다. 그 장에 실제로 쓴 기록이 있을 때만 돌려줍니다 —
 * 안 쓴 페이지를 펴라고 하면 헛걸음이니까요.
 */
export async function pointerFor(course, chapters, currentChapterNo, gapConcept) {
  const pool = getPool(); if (!pool) return null;
  await ensureNotebookTables();

  let target = null;
  const needle = String(gapConcept || '').trim();
  if (needle) {
    // 개념 이름이 장 제목과 겹치는 곳을 찾습니다 (한국어 제목 우선, 없으면 원어 제목)
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const n = norm(needle);
    target = chapters.find(c => {
      const t = norm(c.title), d = norm(c.de);
      return (t && (n.includes(t) || t.includes(n))) || (d && (n.includes(d) || d.includes(n)));
    }) || null;
  }
  if (!target) target = chapters.find(c => c.no === currentChapterNo) || null;
  if (!target) return null;

  // 그 장에 실제로 쓴 기록이 있어야 가리킵니다
  const r = await pool.query(
    `SELECT sec, title, SUM(done)::int AS written
       FROM notebook_tasks
      WHERE course=$1 AND chapter_no=$2 AND done > 0
      GROUP BY sec, title LIMIT 1`, [course, target.no]);
  const row = r.rows[0];
  if (!row) return null;
  return {
    chapterNo: target.no,
    sec: row.sec || target.sec || String(target.no),
    title: row.title || target.title,
    matchedGap: !!needle && target.no !== currentChapterNo,
  };
}

/**
 * 과제를 못 받은 수업에 쓸 기본 과제.
 * 독일어는 레나가 직접 지정하지만, 수학·중국어처럼 프롬프트를 안 건드린 과정이나
 * 생성이 빠진 경우에 대비한 안전망입니다.
 */
export function deriveTasks(course, chapter, lesson = {}) {
  const tasks = [];
  const cards = Array.isArray(lesson.cards) ? lesson.cards
              : Array.isArray(lesson.formulas) ? lesson.formulas : [];
  const hasBoard = /```(?:판서|board)/.test(String(lesson.concept || ''))
    || (lesson.walkthrough?.steps || []).some(s => s?.board);

  if (hasBoard) {
    tasks.push({ kind: 'table', target: 3,
      spec: `${chapter.title}의 표를 노트에 옮겨 그리고, 가린 채로 채우기를 반복하세요.` });
  }
  if (cards.length) {
    const names = cards.map(c => c.front || c.title).filter(Boolean).slice(0, 4).join(', ');
    tasks.push({ kind: course === 'chinese' ? 'vocab' : 'sentences', target: 2,
      spec: `오늘 나온 것을 노트에 옮겨 적으세요${names ? ` — ${names}` : ''}.` });
  }
  if (!tasks.length) {
    tasks.push({ kind: 'sentences', target: 1,
      spec: `${chapter.title}에서 가장 헷갈렸던 부분을 노트에 정리하세요.` });
  }
  return tasks;
}

/** 한 장에 열려 있는 과제 수 — 오답 과제가 쌓이는 걸 막는 데 씁니다 */
export async function countOpen(course, chapterNo, kind = null) {
  const pool = getPool(); if (!pool) return 0;
  await ensureNotebookTables();
  const r = kind
    ? await pool.query(`SELECT COUNT(*)::int AS n FROM notebook_tasks
         WHERE course=$1 AND chapter_no=$2 AND kind=$3 AND status='open'`, [course, chapterNo, kind])
    : await pool.query(`SELECT COUNT(*)::int AS n FROM notebook_tasks
         WHERE course=$1 AND chapter_no=$2 AND status='open'`, [course, chapterNo]);
  return r.rows[0]?.n || 0;
}

/** 틀린 문제로부터 오답 정리 과제를 만듭니다 */
export function errorTask(correctAnswer) {
  const ans = String(correctAnswer || '').slice(0, 60);
  return {
    kind: 'errors', target: 3,
    spec: ans
      ? `오늘 틀린 문제를 노트에 다시 쓰세요 — 정답 "${ans}"을(를) 세 번 쓰고, 왜 틀렸는지 한 줄로 적으세요.`
      : `오늘 틀린 문제를 노트에 다시 쓰고, 왜 틀렸는지 한 줄로 적으세요.`,
  };
}
