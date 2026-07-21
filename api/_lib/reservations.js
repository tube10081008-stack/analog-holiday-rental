import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, del, put } from "@vercel/blob";
import pg from "pg";
import { Resend } from "resend";

const { Pool } = pg;

const LOCAL_DATA_DIRECTORY = path.join(process.cwd(), "data");
const LOCAL_DATA_FILE = path.join(LOCAL_DATA_DIRECTORY, "reservations.local.json");
const RESERVATION_PREFIX = "reservations/";
const IS_VERCEL = process.env.VERCEL === "1";
const BLOB_ACCESS_MODE = process.env.BLOB_STORE_ACCESS === "private" ? "private" : "public";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

let pool;
let tableReadyPromise;
let conversationTableReadyPromise;
let conversationCustomerTableReadyPromise;
let magazineArchiveTableReadyPromise;

function normalizeSingleLine(value, maxLength = 120) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

function normalizeMultiline(value, maxLength = 600) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxLength);
}

function sanitizePhone(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^\d+\-\s]/g, "")
    .slice(0, 30);
}

function createReservationId() {
  return `rsv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createBlobPathname(id, createdAt) {
  const date = new Date(createdAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${RESERVATION_PREFIX}${year}/${month}/${day}/${id}.json`;
}

export function createReservationRecord(payload) {
  const record = {
    id: createReservationId(),
    service: normalizeSingleLine(payload.reserveService || "퀵 렌탈 예약", 100),
    cameraId: normalizeSingleLine(payload.cameraId, 60),
    extraBox: parseInt(payload.extraBox, 10) || 0,
    name: normalizeSingleLine(payload.name, 60),
    email: normalizeSingleLine(payload.email, 120),
    phone: sanitizePhone(payload.phone),
    schedule: normalizeSingleLine(payload.schedule, 120),
    destination: normalizeSingleLine(payload.destination, 120),
    mood: normalizeMultiline(payload.mood, 600),
    createdAt: new Date().toISOString(),
    status: "new",
    source: "quick-rental-modal",
  };

  const missingFields = ["name", "email", "phone", "schedule", "destination", "cameraId"].filter(
    (field) => !record[field],
  );

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
  }

  return record;
}

function ensureStorageConfigured() {
  if (!DATABASE_URL && !process.env.BLOB_READ_WRITE_TOKEN && IS_VERCEL) {
    throw new Error("Reservation storage is not configured.");
  }
}

function getPool() {
  if (!DATABASE_URL) {
    return null;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes("localhost")
        ? false
        : {
            rejectUnauthorized: false,
          },
      max: 3,
    });
  }

  return pool;
}

async function ensureReservationsTable() {
  const currentPool = getPool();

  if (!currentPool) {
    return;
  }

  if (!tableReadyPromise) {
    tableReadyPromise = currentPool.query(`
      CREATE TABLE IF NOT EXISTS quick_rental_reservations (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        camera_id TEXT NOT NULL DEFAULT '',
        extra_box INTEGER NOT NULL DEFAULT 0,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        schedule TEXT NOT NULL,
        destination TEXT NOT NULL,
        mood TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'new',
        source TEXT NOT NULL DEFAULT 'quick-rental-modal',
        tracking_number TEXT NOT NULL DEFAULT '',
        tracking_updated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      ALTER TABLE quick_rental_reservations ADD COLUMN IF NOT EXISTS camera_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE quick_rental_reservations ADD COLUMN IF NOT EXISTS extra_box INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE quick_rental_reservations ADD COLUMN IF NOT EXISTS tracking_number TEXT NOT NULL DEFAULT '';
      ALTER TABLE quick_rental_reservations ADD COLUMN IF NOT EXISTS tracking_updated_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS quick_rental_reservations_created_at_idx
      ON quick_rental_reservations (created_at DESC);
    `);
  }

  await tableReadyPromise;
}

let chatTableReadyPromise;
async function ensureAgentChatTable() {
  const currentPool = getPool();
  if (!currentPool) return;

  if (!chatTableReadyPromise) {
    chatTableReadyPromise = currentPool.query(`
      CREATE TABLE IF NOT EXISTS agent_chat_history (
        id SERIAL PRIMARY KEY,
        agent_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        sender_name TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS agent_chat_history_agent_idx ON agent_chat_history(agent_id, created_at);
      ALTER TABLE agent_chat_history ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '';
    `);
  }
  await chatTableReadyPromise;
}

export async function saveAgentChatMessage({ agentId, role, content, senderName = '' }) {
  if (DATABASE_URL) {
    const currentPool = getPool();
    await ensureAgentChatTable();
    await currentPool.query(
      `INSERT INTO agent_chat_history (agent_id, role, content, sender_name) VALUES ($1, $2, $3, $4)`,
      [agentId, role, content, senderName]
    );
    return true;
  }
  return false;
}

export async function getAgentChatHistory(agentId, limit = 20) {
  if (DATABASE_URL) {
    const currentPool = getPool();
    await ensureAgentChatTable();
    // 최근 N건을 가져온 뒤 시간순으로 재정렬 (ASC LIMIT은 가장 오래된 N건을 반환하므로 금지)
    const result = await currentPool.query(
      `SELECT role, content, "senderName", "createdAt" FROM (
         SELECT role, content, sender_name AS "senderName", created_at AS "createdAt"
         FROM agent_chat_history WHERE agent_id = $1
         ORDER BY created_at DESC LIMIT $2
       ) AS recent ORDER BY "createdAt" ASC`,
      [agentId, limit]
    );
    return result.rows;
  }
  return [];
}

async function ensureConversationMessagesTable() {
  const currentPool = getPool();
  if (!currentPool) return;

  if (!conversationTableReadyPromise) {
    conversationTableReadyPromise = currentPool.query(`
      CREATE TABLE IF NOT EXISTS conversation_messages (
        id SERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS conversation_messages_channel_thread_idx
      ON conversation_messages(channel, thread_id, created_at);
    `);
  }

  await conversationTableReadyPromise;
}

function normalizeConversationText(value, maxLength = 8000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function normalizeThreadId(value, fallback = "default") {
  return normalizeSingleLine(value || fallback, 120) || fallback;
}

function normalizeConversationCustomerKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .slice(0, 180);
}

async function ensureConversationCustomerTable() {
  const currentPool = getPool();
  if (!currentPool) return;

  if (!conversationCustomerTableReadyPromise) {
    conversationCustomerTableReadyPromise = currentPool.query(`
      CREATE TABLE IF NOT EXISTS conversation_customer_threads (
        id SERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        customer_key TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'guest',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(channel, customer_key)
      );
      CREATE INDEX IF NOT EXISTS conversation_customer_threads_thread_idx
      ON conversation_customer_threads(channel, thread_id, updated_at DESC);
    `);
  }

  await conversationCustomerTableReadyPromise;
}

function normalizeConversationMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const normalized = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!key) continue;

    if (value == null) {
      normalized[key] = null;
      continue;
    }

    if (typeof value === "string") {
      normalized[key] = value.slice(0, 500);
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      normalized[key] = value;
      continue;
    }

    normalized[key] = String(value).slice(0, 500);
  }

  return normalized;
}

export async function saveConversationMessage({
  channel,
  threadId,
  role,
  content,
  metadata = {},
}) {
  if (!DATABASE_URL) {
    return false;
  }

  const currentPool = getPool();
  await ensureConversationMessagesTable();

  const normalizedChannel = normalizeSingleLine(channel, 80);
  const normalizedThreadId = normalizeThreadId(threadId);
  const normalizedRole = normalizeSingleLine(role, 30);
  const normalizedContent = normalizeConversationText(content);

  if (!normalizedChannel || !normalizedRole || !normalizedContent) {
    return false;
  }

  await currentPool.query(
    `
      INSERT INTO conversation_messages (channel, thread_id, role, content, metadata)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      normalizedChannel,
      normalizedThreadId,
      normalizedRole,
      normalizedContent,
      JSON.stringify(normalizeConversationMetadata(metadata)),
    ],
  );

  return true;
}

export async function getConversationHistory({ channel, threadId, limit = 50 } = {}) {
  if (!DATABASE_URL) {
    return [];
  }

  const normalizedChannel = normalizeSingleLine(channel, 80);
  const normalizedThreadId = normalizeThreadId(threadId, "");

  if (!normalizedChannel || !normalizedThreadId) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const currentPool = getPool();
  await ensureConversationMessagesTable();

  const result = await currentPool.query(
    `
      SELECT
        role,
        content,
        metadata,
        created_at AS "createdAt"
      FROM (
        SELECT role, content, metadata, created_at
        FROM conversation_messages
        WHERE channel = $1 AND thread_id = $2
        ORDER BY created_at DESC
        LIMIT $3
      ) AS recent_messages
      ORDER BY created_at ASC
    `,
    [normalizedChannel, normalizedThreadId, safeLimit],
  );

  return result.rows;
}

export async function getConversationThreadByCustomer({ channel, customerKey } = {}) {
  if (!DATABASE_URL) {
    return "";
  }

  const normalizedChannel = normalizeSingleLine(channel, 80);
  const normalizedCustomerKey = normalizeConversationCustomerKey(customerKey);

  if (!normalizedChannel || !normalizedCustomerKey) {
    return "";
  }

  const currentPool = getPool();
  await ensureConversationCustomerTable();

  const result = await currentPool.query(
    `
      SELECT thread_id AS "threadId"
      FROM conversation_customer_threads
      WHERE channel = $1 AND customer_key = $2
      LIMIT 1
    `,
    [normalizedChannel, normalizedCustomerKey],
  );

  return result.rows[0]?.threadId || "";
}

export async function setConversationThreadForCustomer({
  channel,
  customerKey,
  threadId,
  source = "customer",
  metadata = {},
} = {}) {
  if (!DATABASE_URL) {
    return false;
  }

  const normalizedChannel = normalizeSingleLine(channel, 80);
  const normalizedCustomerKey = normalizeConversationCustomerKey(customerKey);
  const normalizedThreadId = normalizeThreadId(threadId, "");
  const normalizedSource = normalizeSingleLine(source, 40) || "customer";

  if (!normalizedChannel || !normalizedCustomerKey || !normalizedThreadId) {
    return false;
  }

  const currentPool = getPool();
  await ensureConversationCustomerTable();

  await currentPool.query(
    `
      INSERT INTO conversation_customer_threads (
        channel,
        customer_key,
        thread_id,
        source,
        metadata,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
      ON CONFLICT (channel, customer_key)
      DO UPDATE SET
        thread_id = EXCLUDED.thread_id,
        source = EXCLUDED.source,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      normalizedChannel,
      normalizedCustomerKey,
      normalizedThreadId,
      normalizedSource,
      JSON.stringify(normalizeConversationMetadata(metadata)),
    ],
  );

  return true;
}

export async function clearConversationStorage() {
  if (!DATABASE_URL) {
    return {
      cleared: false,
      reason: "database_not_configured",
    };
  }

  const currentPool = getPool();
  await ensureAgentChatTable();
  await ensureConversationMessagesTable();
  await ensureConversationCustomerTable();

  await currentPool.query(`
    TRUNCATE TABLE
      agent_chat_history,
      conversation_messages,
      conversation_customer_threads
    RESTART IDENTITY
  `);

  return {
    cleared: true,
  };
}

export async function getTodayHaniContext() {
  if (DATABASE_URL) {
    const currentPool = getPool();
    await ensureAgentChatTable();
    // 유저 메시지와 AI 응답 양쪽 다 가져와서 전체 대화 맥락을 전달
    const result = await currentPool.query(
      `SELECT role, content, sender_name, created_at FROM agent_chat_history 
       WHERE agent_id = 'hani'
       AND created_at >= CURRENT_DATE 
       ORDER BY created_at ASC LIMIT 20`
    );
    if (result.rows.length === 0) return "";
    return result.rows.map(r => {
      const who = r.role === 'user' 
        ? (r.sender_name ? `[${r.sender_name} 대표님]` : '[대표님]')
        : '[하니]';
      const time = new Date(r.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
      return `${who} (${time}): ${r.content}`;
    }).join("\n");
  }
  return "";
}

// ═══════════════════════════════════════════════════════════
// 📚 매거진 아카이브 — 과거 발행 주제 영구 저장 & 중복 방지
// ═══════════════════════════════════════════════════════════

async function ensureMagazineArchiveTable() {
  const currentPool = getPool();
  if (!currentPool) return;

  if (!magazineArchiveTableReadyPromise) {
    magazineArchiveTableReadyPromise = currentPool.query(`
      CREATE TABLE IF NOT EXISTS magazine_archive (
        id SERIAL PRIMARY KEY,
        topic TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        full_content TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS magazine_archive_published_idx ON magazine_archive(published_at DESC);
    `);
  }
  await magazineArchiveTableReadyPromise;
}

export async function saveMagazineArchive({ topic, summary, fullContent }) {
  if (!DATABASE_URL) return false;
  const currentPool = getPool();
  await ensureMagazineArchiveTable();
  await currentPool.query(
    `INSERT INTO magazine_archive (topic, summary, full_content) VALUES ($1, $2, $3)`,
    [topic || '', summary || '', fullContent || '']
  );
  return true;
}

export async function getRecentMagazineTopics(days = 90, limit = 60) {
  if (!DATABASE_URL) return [];
  const currentPool = getPool();
  await ensureMagazineArchiveTable();
  const result = await currentPool.query(
    `SELECT topic, summary, published_at AS "publishedAt"
     FROM magazine_archive
     WHERE published_at >= NOW() - INTERVAL '1 day' * $1
     ORDER BY published_at DESC
     LIMIT $2`,
    [days, limit]
  );
  return result.rows;
}

// ═══════════════════════════════════════════════════════════
// 📖 유진 대표 철학 도서관 (CEO Philosophy Library)
//    블로그(柔眞, fromeugene) 225개 포스팅에서 추출한 핵심 에센스
//    하니가 매거진을 쓸 때 이 도서관을 참조하여 아날로그 홀리데이
//    고유의 정체성을 가진 깊은 글을 씁니다.
// ═══════════════════════════════════════════════════════════

export const CEO_PHILOSOPHY_LIBRARY = `
[아날로그 홀리데이 — 브랜드 철학 가이드]

■ 핵심 철학:
- "부드러움이 강함을 이긴다"는 정서가 브랜드의 뿌리입니다.
- 모든 것을 투명하고 다정하게 대하는 태도를 지향합니다.

■ 필름 카메라에 대한 시선:
- 필름 카메라는 단순한 기계가 아니라, 누군가의 숭고하고 유일한 시간을 붙잡아두는 매개체입니다.
- 필름은 결과물이 아니라 그 순간 자체의 기록입니다.
- 디지털 이미지가 범람하는 시대에도, 아날로그의 진정성을 놓지 않습니다.

■ 여행에 대한 정서:
- 여행은 관광이 아니라 삶의 궤적을 톺아보는 행위입니다.
- 장소 자체보다, 그곳에서 생기는 고유한 감정과 관계가 여행을 완성합니다.
- 여행지의 서사를 흡수하고, 돌아와서 곱씹는 깊은 여행을 지향합니다.

■ 음악 취향 (추천곡 영감 풀 — 매회 다른 곡을 선택할 것):
- 한국 인디: 김사월, 권진아, 정우, 요조, 계피, 강아솔, 권나무, 백예린, 이슬아
- 해외: Laufey, Agnes Obel, Aurora, Daniel Caesar, Clairo, ROSALÍA, Lana Del Rey, Brian Eno
- 클래식/앰비언트/OST: Patrick Watson, Fabio Caramuru, Conan Gray
- 음악을 글의 첫머리에 배치하는 것이 시그니처 스타일입니다.

■ 문학적 영감 풀 (아래에서 골라 쓰되, 같은 작품을 7일 이내 재인용 금지):
- 버지니아 울프, 한나 아렌트, 한병철, 정희진
- 이창동, 피나바우슈, 이제니 시인, 김지승, 최지인 시인
- 다양한 작품과 작가를 골고루 회전하며 인용하세요.

■ 톤앤매너 가이드라인:
- 경박한 트렌디함 대신, 묵직하고 다정한 서정성
- 이모티콘은 절제 (최소한으로만)
- '파편', '애도', '연대', '다정함', '투명한', '궤적', '생활 비평', '톺아보다' 같은 단어를 자연스럽게 사용
- 글의 시작은 음악 한 곡으로 시작하고, 마무리는 여운을 남기는 한 문장으로

■ 절대 금기사항 (위반 시 매거진 발행 실격):
- 단순한 "인스타 감성", "핫플 추천", "가성비 여행" 같은 얕은 접근 금지
- 같은 주제를 2주 안에 반복 금지
- ⛔ 대표님, 팀원, 또는 실존하는 특정 인물의 이름/행적/동선을 절대 언급하지 마세요
- ⛔ "대표님이 ○○를 다녀왔다", "대표님이 ○○를 구입했다" 같은 개인 행위를 매거진에 기재 금지
- ⛔ 대화에서 언급된 제3자(고객명, 지인 이름 등)의 실명을 외부 매거진에 노출 금지
- ⛔ 위 금기를 어기면 프라이버시 침해이므로, 의심스러우면 아예 빼세요
- "떠나고 싶게 만든다"보다 "돌아와서 곱씹게 만든다"가 우리의 목표
`;


async function readLocalReservations() {
  try {
    const fileContents = await readFile(LOCAL_DATA_FILE, "utf8");
    return JSON.parse(fileContents);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function writeLocalReservations(reservations) {
  await mkdir(LOCAL_DATA_DIRECTORY, { recursive: true });
  await writeFile(LOCAL_DATA_FILE, JSON.stringify(reservations, null, 2), "utf8");
}

async function readBlobReservation(pathname) {
  const commonOptions = {
    access: BLOB_ACCESS_MODE,
    ...(BLOB_TOKEN ? { token: BLOB_TOKEN } : {}),
  };
  const result =
    BLOB_ACCESS_MODE === "private"
      ? await get(pathname, { ...commonOptions, useCache: false })
      : await get(pathname, commonOptions);

  if (!result?.stream) {
    return null;
  }

  const payload = await new Response(result.stream).text();
  return JSON.parse(payload);
}

async function listBlobReservations() {
  const blobs = [];
  let cursor;

  do {
    const result = await list({
      cursor,
      limit: 200,
      prefix: RESERVATION_PREFIX,
      ...(BLOB_TOKEN ? { token: BLOB_TOKEN } : {}),
    });

    blobs.push(...result.blobs.filter((blob) => blob.pathname.endsWith(".json")));
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  const reservations = await Promise.all(
    blobs.map(async (blob) => {
      const reservation = await readBlobReservation(blob.pathname);

      if (!reservation) {
        return null;
      }

      return {
        ...reservation,
        blobPathname: blob.pathname,
        uploadedAt: blob.uploadedAt,
      };
    }),
  );

  return reservations
    .filter(Boolean)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

async function createReservationInBlob(reservation) {
  const pathname = createBlobPathname(reservation.id, reservation.createdAt);
  await put(pathname, JSON.stringify(reservation, null, 2), {
    access: BLOB_ACCESS_MODE,
    addRandomSuffix: false,
    contentType: "application/json",
    ...(BLOB_TOKEN ? { token: BLOB_TOKEN } : {}),
  });

  return {
    ...reservation,
    blobPathname: pathname,
  };
}

async function createReservationInPostgres(reservation) {
  const currentPool = getPool();
  await ensureReservationsTable();

  await currentPool.query(
    `
      INSERT INTO quick_rental_reservations (
        id, service, camera_id, extra_box, name, email, phone, schedule, destination, mood, status, source, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
      )
    `,
    [
      reservation.id,
      reservation.service,
      reservation.cameraId || '',
      reservation.extraBox || 0,
      reservation.name,
      reservation.email,
      reservation.phone,
      reservation.schedule,
      reservation.destination,
      reservation.mood,
      reservation.status,
      reservation.source,
      reservation.createdAt,
    ],
  );

  return reservation;
}

async function listPostgresReservations() {
  const currentPool = getPool();
  await ensureReservationsTable();
  const result = await currentPool.query(`
    SELECT
      id,
      service,
      camera_id AS "cameraId",
      extra_box AS "extraBox",
      name,
      email,
      phone,
      schedule,
      destination,
      mood,
      status,
      source,
      tracking_number AS "trackingNumber",
      tracking_updated_at AS "trackingUpdatedAt",
      created_at AS "createdAt"
    FROM quick_rental_reservations
    ORDER BY created_at DESC
  `);

  return result.rows;
}

export async function updateTrackingNumber(id, trackingNumber, trackingTime) {
  if (DATABASE_URL) {
    const currentPool = getPool();
    await ensureReservationsTable();
    let updateTime = new Date().toISOString();
    if (trackingTime) {
      updateTime = new Date(trackingTime + "+09:00").toISOString();
    }
    await currentPool.query(
      `UPDATE quick_rental_reservations SET tracking_number = $1, tracking_updated_at = $2 WHERE id = $3`,
      [trackingNumber || '', updateTime, id]
    );
    return true;
  }
  
  // 지원되지 않는 스토리지인 경우
  return false;
}

async function deletePostgresReservation(id) {
  const currentPool = getPool();
  await ensureReservationsTable();
  const result = await currentPool.query(
    `DELETE FROM quick_rental_reservations WHERE id = $1`,
    [id],
  );

  return result.rowCount > 0;
}

export function getStorageMode() {
  if (DATABASE_URL) {
    return "postgres";
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return `blob-${BLOB_ACCESS_MODE}`;
  }

  return IS_VERCEL ? "missing" : "local";
}

export function getMailMode() {
  return process.env.RESEND_API_KEY ? "resend" : "missing";
}

export function getNotifyEmail() {
  return process.env.RESERVATION_NOTIFY_TO || "tube10081008@gmail.com";
}

export function getAdminKey() {
  return process.env.RESERVATION_ADMIN_KEY || "";
}

export function getMailFrom() {
  return process.env.RESEND_FROM || "Analog Holiday <onboarding@resend.dev>";
}

export async function saveReservationToDb(reservation) {
  if (DATABASE_URL) {
    return createReservationInPostgres(reservation);
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return createReservationInBlob(reservation);
  }

  ensureStorageConfigured();

  const reservations = await readLocalReservations();
  reservations.unshift(reservation);
  await writeLocalReservations(reservations);

  return reservation;
}

export async function createReservation(payload) {
  const reservation = createReservationRecord(payload);
  return saveReservationToDb(reservation);
}

export async function listReservations() {
  if (DATABASE_URL) {
    return listPostgresReservations();
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return listBlobReservations();
  }

  ensureStorageConfigured();

  const reservations = await readLocalReservations();
  return reservations.sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  );
}

export async function deleteReservation({ id, blobPathname }) {
  if (!id && !blobPathname) {
    return false;
  }

  if (DATABASE_URL) {
    return deletePostgresReservation(id);
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const pathnameToDelete =
      blobPathname ||
      (await listReservations()).find((reservation) => reservation.id === id)?.blobPathname;

    if (!pathnameToDelete) {
      return false;
    }

    await del(pathnameToDelete, BLOB_TOKEN ? { token: BLOB_TOKEN } : undefined);
    return true;
  }

  ensureStorageConfigured();

  const reservations = await readLocalReservations();
  const nextReservations = reservations.filter((reservation) => reservation.id !== id);

  if (nextReservations.length === reservations.length) {
    return false;
  }

  await writeLocalReservations(nextReservations);
  return true;
}

export async function migrateBlobReservationsToPostgres() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      migrated: 0,
      skipped: 0,
      source: "none",
    };
  }

  await ensureReservationsTable();
  const currentPool = getPool();
  const blobReservations = await listBlobReservations();

  let migrated = 0;
  let skipped = 0;

  for (const reservation of blobReservations) {
    const result = await currentPool.query(
      `
        INSERT INTO quick_rental_reservations (
          id, service, name, email, phone, schedule, destination, mood, status, source, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        )
        ON CONFLICT (id) DO NOTHING
      `,
      [
        reservation.id,
        reservation.service,
        reservation.name,
        reservation.email,
        reservation.phone,
        reservation.schedule,
        reservation.destination,
        reservation.mood,
        reservation.status || "new",
        reservation.source || "quick-rental-modal",
        reservation.createdAt,
      ],
    );

    if (result.rowCount > 0) {
      migrated += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    migrated,
    skipped,
    source: `blob-${BLOB_ACCESS_MODE}`,
  };
}

function buildReservationText(reservation) {
  return [
    "새 퀵 렌탈 예약이 등록되었습니다.",
    "",
    `예약 ID: ${reservation.id}`,
    `등록 시각: ${reservation.createdAt}`,
    `예약 서비스: ${reservation.service}`,
    `성함: ${reservation.name}`,
    `이메일: ${reservation.email}`,
    `연락처: ${reservation.phone}`,
    `여행 일정: ${reservation.schedule}`,
    `여행지: ${reservation.destination}`,
    `원하는 카메라/무드: ${reservation.mood || "-"}`,
  ].join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildReservationHtml(reservation) {
  const safeMood = reservation.mood
    ? escapeHtml(reservation.mood).replace(/\n/g, "<br>")
    : "-";

  return `
    <div style="font-family: Pretendard, Arial, sans-serif; color: #222; line-height: 1.7;">
      <h1 style="font-size: 22px; margin-bottom: 12px;">새 퀵 렌탈 예약이 등록되었습니다.</h1>
      <table style="width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #ece7df;">
        <tbody>
          <tr><th style="text-align:left; padding:12px; width:170px; background:#faf6f0;">예약 ID</th><td style="padding:12px;">${escapeHtml(reservation.id)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">등록 시각</th><td style="padding:12px;">${escapeHtml(reservation.createdAt)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">예약 서비스</th><td style="padding:12px;">${escapeHtml(reservation.service)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">성함</th><td style="padding:12px;">${escapeHtml(reservation.name)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">이메일</th><td style="padding:12px;">${escapeHtml(reservation.email)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">연락처</th><td style="padding:12px;">${escapeHtml(reservation.phone)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">여행 일정</th><td style="padding:12px;">${escapeHtml(reservation.schedule)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">여행지</th><td style="padding:12px;">${escapeHtml(reservation.destination)}</td></tr>
          <tr><th style="text-align:left; padding:12px; background:#faf6f0;">원하는 카메라/무드</th><td style="padding:12px;">\n카메라ID: ${escapeHtml(reservation.cameraId || '미선택')}<br>추가 박스(19,000원): ${reservation.extraBox || 0}개<br>요청사항: ${safeMood}</td></tr>
        </tbody>
      </table>
    </div>
  `;
}

export async function sendReservationNotification(reservation) {
  if (!process.env.RESEND_API_KEY) {
    return {
      sent: false,
      reason: "missing_resend_api_key",
    };
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = getMailFrom();
  const to = getNotifyEmail();

  const { data, error } = await resend.emails.send({
    from,
    to,
    replyTo: reservation.email,
    subject: `[Quick Rental] ${reservation.name}님의 예약 문의`,
    text: buildReservationText(reservation),
    html: buildReservationHtml(reservation),
  });

  if (error) {
    throw new Error(error.message || "Failed to send reservation email.");
  }

  return {
    sent: true,
    messageId: data?.id ?? null,
  };
}
