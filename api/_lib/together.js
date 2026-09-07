/**
 * 🤝 함께 공부하기
 *
 * 둘이 같은 장을 배울 때 혼자서는 못 하는 두 가지를 얹습니다.
 *
 *   ① 답 비교 — 같은 문제를 각자 푼 뒤에만 상대 답이 열립니다.
 *      먼저 열리면 베끼게 되므로, **내가 제출하기 전에는 절대 안 보입니다.**
 *      같은 문제를 다르게 푸는 걸 보는 게 이 기능의 전부입니다.
 *
 *   ② 서로 설명하기 — 상대 답에 한 줄 설명을 남깁니다.
 *      가르치는 쪽이 더 배운다는 건 오래된 이야기고, 실제로 설명을 만들려면
 *      스스로 정리해야 합니다.
 *      다만 **틀린 설명을 그대로 전달하면 상대에게 오히려 해롭습니다.**
 *      그래서 레나가 먼저 검증하고, 틀렸으면 보낸 사람에게 되돌려줍니다.
 *      검열이 아니라 오답이 굳는 걸 막는 장치입니다.
 */

import { getPool } from "./agent-brain.js";
import { generateJson } from "./llm.js";

let tablesReady;

export async function ensureTogetherTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = pool.query(`
    CREATE TABLE IF NOT EXISTS peer_notes (
      id SERIAL PRIMARY KEY,
      course TEXT NOT NULL DEFAULT 'german',
      chapter_no INTEGER NOT NULL,
      problem_index INTEGER NOT NULL DEFAULT 0,
      from_user INTEGER NOT NULL,
      to_user INTEGER NOT NULL,
      text TEXT NOT NULL,
      verdict TEXT NOT NULL DEFAULT 'pending',   -- ok | wrong | pending
      lena_note TEXT DEFAULT '',
      seen BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pn_to ON peer_notes(to_user, seen, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pn_once
      ON peer_notes(course, chapter_no, problem_index, from_user, to_user);
  `).catch(() => { tablesReady = null; });
  await tablesReady;
}

/**
 * 상대가 같은 장에서 낸 답을 가져옵니다.
 * @param mySubmitted 내가 그 문제를 이미 제출했는지. false면 아무것도 돌려주지 않습니다.
 */
export async function peerAnswers({ course = 'german', chapterNo, problemIndex,
                                    userId, partnerIds, mySubmitted }) {
  if (!mySubmitted || !partnerIds?.length) return [];
  const pool = getPool(); if (!pool) return [];
  const table = course === 'german' ? 'german_lessons'
              : course === 'math' ? 'math_lessons' : null;
  if (!table) return [];

  const r = await pool.query(
    `SELECT l.user_id, l.turns, u.name
       FROM ${table} l JOIN study_users u ON u.id = l.user_id
      WHERE l.chapter_no = $1 AND l.user_id = ANY($2::int[])`,
    [chapterNo, partnerIds]);

  const out = [];
  for (const row of r.rows) {
    const turns = Array.isArray(row.turns) ? row.turns
      : (() => { try { return JSON.parse(row.turns); } catch { return []; } })();
    // 같은 문제 번호의 마지막 답만
    const mine = turns.filter(t => t?.role === 'user' && Number(t.problemIndex) === Number(problemIndex));
    const last = mine[mine.length - 1];
    if (!last) continue;
    out.push({
      userId: row.user_id, name: row.name,
      answer: String(last.content || ''),
      correct: !!last.correct,
      at: last.at || null,
    });
  }
  return out;
}

/** 같은 장을 하고 있는 사람들의 진도 요약 */
export async function partnerProgress(course, partners) {
  const pool = getPool(); if (!pool || !partners?.length) return [];
  const profile = course === 'german' ? 'german_profile'
                : course === 'math' ? 'math_profile' : null;
  const lessons = course === 'german' ? 'german_lessons'
                : course === 'math' ? 'math_lessons' : null;
  if (!profile) return [];
  const ids = partners.map(p => p.id);

  const [prog, act] = await Promise.all([
    pool.query(`SELECT user_id, chapter_index FROM ${profile} WHERE user_id = ANY($1::int[])`, [ids]),
    pool.query(
      `SELECT user_id, COUNT(*)::int AS done, MAX(done_at) AS last_done
         FROM ${lessons} WHERE user_id = ANY($1::int[]) AND status='done'
        GROUP BY user_id`, [ids]),
  ]);
  const byId = new Map(prog.rows.map(r => [r.user_id, r]));
  const actById = new Map(act.rows.map(r => [r.user_id, r]));

  return partners.map(p => {
    const a = actById.get(p.id);
    return {
      id: p.id, name: p.name,
      chapterIndex: byId.get(p.id)?.chapter_index ?? 0,
      doneCount: a?.done || 0,
      lastDone: a?.last_done || null,
      lastSeen: p.last_seen || null,
    };
  });
}

/**
 * 설명을 남기기 전에 레나가 검증합니다.
 * 틀린 설명이 상대에게 그대로 가면 오답이 굳으므로, 보내기 전에 거릅니다.
 */
export async function verifyExplanation({ chapter, problem, correctAnswer,
                                          peerAnswer, explanation, persona }) {
  const systemPrompt = `${persona}

## 지금 하는 일
학습자 A가 학습자 B의 답에 **설명을 남기려 합니다.** 보내기 전에 그 설명이 맞는지 봐주세요.

## 판정 원칙
1. 설명이 **문법적으로 맞으면** verdict는 "ok"입니다. 표현이 서툴러도 내용이 맞으면 ok예요.
2. 설명이 **틀렸거나 오해를 심을 수 있으면** "wrong"입니다.
   틀린 설명이 그대로 전달되면 상대가 오답을 굳히게 되니까요.
3. 애매하면 "ok"로 두되 note에 보탤 말을 적으세요. 검열이 아니라 사고 방지입니다.

## note (레나의 한 줄)
- ok일 때: 설명에서 **잘 짚은 지점**을 한 문장으로. 또는 보태면 좋을 것 한 가지.
- wrong일 때: **어디가 틀렸는지** 보낸 사람에게 알려주세요. 상대에게는 전달되지 않습니다.
  혼내지 말고 "이건 이렇게 보는 게 맞아요"로.
- 120~200자.

## 순수 JSON만 출력
{"verdict":"ok" 또는 "wrong","note":"레나의 한 줄"}`;

  const input = `## 장
[${chapter.unit}] ${chapter.sec} ${chapter.de} — ${chapter.title}

## 문제
${problem}

## 정답
${correctAnswer}

## 상대(B)가 쓴 답
${String(peerAnswer || '').slice(0, 800)}

## A가 남기려는 설명
${String(explanation || '').slice(0, 800)}`;

  const { data } = await generateJson({
    system: systemPrompt, user: input,
    temperature: 0.3, maxTokens: 1024, budgetMs: 40000,
    validate: (d) => d?.verdict === 'ok' || d?.verdict === 'wrong',
    label: 'peer-verify',
  });
  // 검증이 실패하면 막지 않고 통과시킵니다 — 설명을 못 남기는 것보다 낫습니다
  if (!data) return { verdict: 'ok', note: '', unverified: true };
  return data;
}

export async function saveNote({ course = 'german', chapterNo, problemIndex,
                                 fromUser, toUser, text, verdict, lenaNote }) {
  const pool = getPool(); if (!pool) return null;
  await ensureTogetherTables();
  const r = await pool.query(
    `INSERT INTO peer_notes (course, chapter_no, problem_index, from_user, to_user,
                             text, verdict, lena_note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (course, chapter_no, problem_index, from_user, to_user)
     DO UPDATE SET text = EXCLUDED.text, verdict = EXCLUDED.verdict,
                   lena_note = EXCLUDED.lena_note, seen = FALSE, created_at = NOW()
     RETURNING *`,
    [course, chapterNo, Number(problemIndex) || 0, fromUser, toUser,
     String(text).slice(0, 1000), verdict, String(lenaNote || '').slice(0, 600)]);
  return r.rows[0];
}

/** 나에게 온 설명. 레나가 wrong으로 판정한 것은 전달하지 않습니다 */
export async function inboxFor(userId, course = 'german', limit = 20) {
  const pool = getPool(); if (!pool) return [];
  await ensureTogetherTables();
  const r = await pool.query(
    `SELECT n.*, u.name AS from_name
       FROM peer_notes n JOIN study_users u ON u.id = n.from_user
      WHERE n.to_user=$1 AND n.course=$2 AND n.verdict='ok'
      ORDER BY n.created_at DESC LIMIT $3`, [userId, course, limit]);
  return r.rows.map(x => ({
    id: x.id, from: x.from_name, chapterNo: x.chapter_no, problemIndex: x.problem_index,
    text: x.text, lenaNote: x.lena_note, seen: x.seen, at: x.created_at,
  }));
}

/** 내가 보낸 설명 (레나가 되돌려준 것 포함 — 보낸 사람만 봅니다) */
export async function outboxFor(userId, course = 'german', limit = 20) {
  const pool = getPool(); if (!pool) return [];
  await ensureTogetherTables();
  const r = await pool.query(
    `SELECT n.*, u.name AS to_name
       FROM peer_notes n JOIN study_users u ON u.id = n.to_user
      WHERE n.from_user=$1 AND n.course=$2
      ORDER BY n.created_at DESC LIMIT $3`, [userId, course, limit]);
  return r.rows.map(x => ({
    id: x.id, to: x.to_name, chapterNo: x.chapter_no, problemIndex: x.problem_index,
    text: x.text, verdict: x.verdict, lenaNote: x.lena_note, at: x.created_at,
  }));
}

export async function markSeen(userId, course = 'german') {
  const pool = getPool(); if (!pool) return 0;
  await ensureTogetherTables();
  const r = await pool.query(
    `UPDATE peer_notes SET seen=TRUE WHERE to_user=$1 AND course=$2 AND seen=FALSE`,
    [userId, course]);
  return r.rowCount;
}

export async function unseenCount(userId, course = 'german') {
  const pool = getPool(); if (!pool) return 0;
  await ensureTogetherTables();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n FROM peer_notes
      WHERE to_user=$1 AND course=$2 AND seen=FALSE AND verdict='ok'`, [userId, course]);
  return r.rows[0]?.n || 0;
}
