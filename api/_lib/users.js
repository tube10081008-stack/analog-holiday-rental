/**
 * 👥 학습자 계정 — 친구와 함께 공부하기 위한 최소한의 사용자 분리
 *
 * 지금까지 이 앱은 1인용이었습니다. 모든 진도가 `WHERE id=1` 한 줄에 박혀 있어서,
 * 둘이 같은 키로 들어오면 함께 공부하는 게 아니라 세이브 파일 하나를 두고 다투게 됩니다.
 *
 * 그래서 계정을 나누되, 로그인 방식은 그대로 둡니다.
 * 게이트에서 키를 넣는 UX는 변하지 않고, **어떤 키를 넣느냐로 사람이 갈립니다.**
 *   - 대표(주인)는 기존 RESERVATION_ADMIN_KEY를 그대로 씁니다 → 기존 데이터가 그대로 자기 것
 *   - 친구는 대표가 발급한 초대 키를 넣습니다 → 자기 진도가 새로 생깁니다
 *
 * 비밀번호·이메일을 만들지 않은 이유: 둘이 쓰는 사적인 앱에 계정 체계를 얹으면
 * 관리 비용만 늘고 학습에는 아무 도움이 안 됩니다.
 */

import crypto from "node:crypto";
import { getPool } from "./agent-brain.js";
import { getAdminKey } from "./reservations.js";

let tablesReady;
let ownerReady = null;   // 요청마다 시퀀스를 다시 맞출 필요는 없습니다

export async function ensureUserTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = pool.query(`
    CREATE TABLE IF NOT EXISTS study_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      login_key TEXT NOT NULL UNIQUE,
      is_owner BOOLEAN NOT NULL DEFAULT FALSE,
      courses TEXT[] NOT NULL DEFAULT ARRAY['german']::text[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen TIMESTAMPTZ
    );
  `).catch(() => { tablesReady = null; });
  await tablesReady;
}

/**
 * 주인 계정을 보장합니다. 기존 데이터가 전부 user_id=1로 이관되므로
 * 주인은 반드시 id=1 이어야 합니다.
 */
export async function ensureOwner() {
  // 캐시는 관리자 키가 그대로일 때만 씁니다.
  // 키를 교체하면 다음 요청에서 바로 따라가야 하니까요.
  if (ownerReady && ownerReady.login_key === getAdminKey()) return ownerReady;
  const pool = getPool(); if (!pool) return null;
  await ensureUserTables();
  const adminKey = getAdminKey();
  if (!adminKey) return null;

  const existing = await pool.query(`SELECT * FROM study_users WHERE is_owner = TRUE LIMIT 1`);
  if (existing.rows[0]) {
    // 관리자 키가 바뀌었으면 따라갑니다 (키를 교체해도 계정을 잃지 않도록)
    if (existing.rows[0].login_key !== adminKey) {
      await pool.query(`UPDATE study_users SET login_key=$1 WHERE id=$2`,
        [adminKey, existing.rows[0].id]).catch(() => {});
      existing.rows[0].login_key = adminKey;
    }
    ownerReady = existing.rows[0];
    return ownerReady;
  }
  // id=1을 명시적으로 잡아둡니다 — 기존 데이터의 기본값과 맞춰야 합니다
  const r = await pool.query(
    `INSERT INTO study_users (id, name, login_key, is_owner, courses)
     VALUES (1, $1, $2, TRUE, ARRAY['german','math','chinese']::text[])
     ON CONFLICT (id) DO UPDATE SET login_key = EXCLUDED.login_key, is_owner = TRUE
     RETURNING *`,
    [process.env.OWNER_NAME || '나', adminKey]);
  // SERIAL 시퀀스가 1에서 멈춰 있으면 다음 INSERT가 충돌하므로 앞으로 당겨둡니다
  await pool.query(
    `SELECT setval('study_users_id_seq', GREATEST((SELECT MAX(id) FROM study_users), 1))`
  ).catch(() => {});
  ownerReady = r.rows[0];
  return ownerReady;
}

/** 키로 사람을 찾습니다. 못 찾으면 null (호출부가 401을 냅니다) */
export async function resolveUser(key) {
  if (!key) return null;
  const pool = getPool(); if (!pool) return null;
  await ensureOwner();
  const r = await pool.query(`SELECT * FROM study_users WHERE login_key = $1`, [key]);
  const u = r.rows[0];
  if (!u) return null;
  pool.query(`UPDATE study_users SET last_seen = NOW() WHERE id = $1`, [u.id]).catch(() => {});
  return u;
}

/** 초대 — 주인만 부를 수 있습니다. 읽기 쉬운 키를 만들어 돌려줍니다 */
export async function invite(name, courses = ['german']) {
  const pool = getPool(); if (!pool) return null;
  await ensureUserTables();
  const clean = String(name || '').trim().slice(0, 24) || '친구';
  // 헷갈리는 글자(0/O, 1/l/I)를 뺀 문자셋 — 말로 불러줄 수 있어야 합니다
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const chunk = (n) => Array.from(crypto.randomBytes(n))
    .map(b => ALPHA[b % ALPHA.length]).join('');
  const key = `${chunk(4)}-${chunk(4)}`;
  const safe = (courses || []).filter(c => ['german', 'math', 'chinese'].includes(c));
  const r = await pool.query(
    `INSERT INTO study_users (name, login_key, is_owner, courses)
     VALUES ($1, $2, FALSE, $3::text[]) RETURNING *`,
    [clean, key, safe.length ? safe : ['german']]);
  return r.rows[0];
}

export async function listUsers() {
  const pool = getPool(); if (!pool) return [];
  await ensureOwner();
  const r = await pool.query(
    `SELECT id, name, is_owner, courses, created_at, last_seen
     FROM study_users ORDER BY id`);
  return r.rows;
}

/** 함께 공부하는 사람들 (나를 뺀 나머지) */
export async function partnersOf(userId, course) {
  const pool = getPool(); if (!pool) return [];
  await ensureUserTables();
  const r = await pool.query(
    `SELECT id, name, last_seen FROM study_users
      WHERE id <> $1 AND $2 = ANY(courses) ORDER BY id`, [userId, course]);
  return r.rows;
}

export async function removeUser(userId) {
  const pool = getPool(); if (!pool) return false;
  await ensureUserTables();
  // 주인은 지울 수 없습니다
  const r = await pool.query(
    `DELETE FROM study_users WHERE id=$1 AND is_owner = FALSE`, [Number(userId)]);
  return r.rowCount > 0;
}

/** 키를 다시 발급합니다 (친구가 키를 잃어버렸을 때) */
export async function rotateKey(userId) {
  const pool = getPool(); if (!pool) return null;
  const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const chunk = (n) => Array.from(crypto.randomBytes(n))
    .map(b => ALPHA[b % ALPHA.length]).join('');
  const key = `${chunk(4)}-${chunk(4)}`;
  const r = await pool.query(
    `UPDATE study_users SET login_key=$1 WHERE id=$2 AND is_owner = FALSE RETURNING *`,
    [key, Number(userId)]);
  return r.rows[0] || null;
}
