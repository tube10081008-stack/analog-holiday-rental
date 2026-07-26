/**
 * 🀄 陈老师 중국어 학당 — 한국인 학습자 전용 과정
 *
 * /school(대표 과정)의 UX 골격은 계승하되, 언어 학습의 본질에 맞춰 엔진을 새로 설계했습니다.
 *
 * 대표 과정과의 결정적 차이:
 *   1. 학습 단위가 '개념'이 아니라 '수천 개의 어휘·문형'입니다.
 *      → 간격 반복(SRS)이 보조 기능이 아니라 시스템의 심장입니다. SM-2를 본격 구현했습니다.
 *   2. 인지(알아보기)와 생산(만들어내기)은 다른 능력입니다. 두 방향을 모두 시험합니다.
 *   3. 성조는 한국어에 없는 자질이라 한국인이 가장 많이, 가장 오래 틀립니다. 별도 도메인으로 채점합니다.
 *   4. 한국어 화자는 한자어 지식이라는 큰 이점과, 동형이의어라는 큰 함정을 동시에 갖습니다.
 */

import { GoogleGenAI } from "@google/genai";
import { getPool } from "./agent-brain.js";

const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-3.5-flash";
let tablesReady;

export async function ensureChineseTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = pool.query(`
    CREATE TABLE IF NOT EXISTS chinese_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      level INTEGER NOT NULL DEFAULT 1,
      scene_index INTEGER NOT NULL DEFAULT 0,
      goal TEXT DEFAULT '',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chinese_cards (
      id TEXT PRIMARY KEY,
      hanzi TEXT NOT NULL,
      pinyin TEXT NOT NULL DEFAULT '',
      meaning TEXT NOT NULL DEFAULT '',
      example TEXT DEFAULT '',
      example_pinyin TEXT DEFAULT '',
      example_meaning TEXT DEFAULT '',
      card_type TEXT NOT NULL DEFAULT 'word',
      level INTEGER NOT NULL DEFAULT 1,
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_result TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_cc_due ON chinese_cards(due_at);
    CREATE TABLE IF NOT EXISTS chinese_sessions (
      id TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      scene TEXT NOT NULL,
      scene_cn TEXT NOT NULL DEFAULT '',
      dialogue JSONB DEFAULT '[]',
      focus JSONB DEFAULT '[]',
      task TEXT NOT NULL DEFAULT '',
      speak_line TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      submission TEXT DEFAULT '',
      speech_heard TEXT DEFAULT '',
      evaluation JSONB DEFAULT '{}',
      score REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_cs_status ON chinese_sessions(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS chinese_xp (
      id SERIAL PRIMARY KEY,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_cx_ref ON chinese_xp(ref) WHERE ref IS NOT NULL;
    CREATE TABLE IF NOT EXISTS chinese_stages (
      id TEXT PRIMARY KEY,
      level INTEGER NOT NULL,
      scene_index INTEGER NOT NULL,
      best_stars INTEGER NOT NULL DEFAULT 0,
      best_score REAL,
      plays INTEGER NOT NULL DEFAULT 0,
      last_played_at TIMESTAMPTZ
    );
    INSERT INTO chinese_profile (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `).catch(() => { tablesReady = null; });
  await tablesReady;
}

// ═══════════════════════════════════════════════════
// 🎮 게이미피케이션
//
// 설계 원칙: **보상은 '실력의 증거'여야지 '출석의 대가'여선 안 된다.**
// 과잉정당화 효과(외적 보상이 내적 동기를 밀어냄)와 굿하트 법칙을 피하기 위해,
// XP는 접속·제출 횟수가 아니라 아래 세 가지에서만 발생합니다:
//   1) 카드 등급이 실제로 올라갔을 때 (= 진짜로 외웠을 때)
//   2) 실전 스테이지에서 별을 땄을 때 (= 힌트 없이 해냈을 때)
//   3) 수업 채점이 70점을 넘겼을 때 (= 대충 낸 답안은 0 XP)
// 로그인 보상·스트릭 복구 아이템은 의도적으로 만들지 않았습니다.
// ═══════════════════════════════════════════════════

export const TIERS = {
  new:      { key: 'new',      label: '신규',   emoji: '🟤', order: 1 },
  learning: { key: 'learning', label: '학습중', emoji: '🔵', order: 2 },
  mature:   { key: 'mature',   label: '숙성',   emoji: '🟡', order: 3 },
  master:   { key: 'master',   label: '마스터', emoji: '🌈', order: 4 },
};

/** SRS 상태로부터 카드 등급을 도출합니다 (별도 컬럼 없이 파생) */
export function cardTier(card) {
  const reps = Number(card.repetitions) || 0;
  const iv = Number(card.interval_days) || 0;
  const lapses = Number(card.lapses) || 0;
  if (reps === 0) return 'new';
  if (iv >= 60 && lapses === 0) return 'master';
  if (iv >= 21) return 'mature';
  return 'learning';
}

// 등급 도달 시 지급 XP (누적이 아니라 '처음 도달'에만)
const TIER_XP = { new: 0, learning: 10, mature: 30, master: 100 };
const STAR_XP = { 1: 50, 2: 120, 3: 250 };

/** XP 적립. ref가 같으면 중복 지급되지 않습니다 (같은 성취로 두 번 못 받음) */
export async function grantXp(amount, reason, ref = null) {
  const pool = getPool(); if (!pool || amount <= 0) return 0;
  await ensureChineseTables();
  try {
    const r = await pool.query(
      `INSERT INTO chinese_xp (amount, reason, ref) VALUES ($1,$2,$3)
       ON CONFLICT (ref) DO NOTHING RETURNING amount`,
      [amount, reason, ref]
    );
    return r.rows[0]?.amount || 0;
  } catch { return 0; }
}

/**
 * 레벨 곡선: n레벨까지 누적 XP = 75·n·(n+1)
 * Lv2까지 150, Lv3까지 450, Lv4까지 900 — 초반은 빠르고 뒤로 갈수록 완만합니다.
 */
export function levelFromXp(xp) {
  const n = Math.floor((-1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 75)) / 2);
  const level = Math.max(1, n + 1);
  const cur = 75 * (level - 1) * level;
  const next = 75 * level * (level + 1);
  return {
    level,
    xp,
    intoLevel: xp - cur,
    needForNext: next - cur,
    progress: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)),
  };
}

export async function getXpState() {
  const pool = getPool(); if (!pool) return levelFromXp(0);
  await ensureChineseTables();
  const r = await pool.query(`SELECT COALESCE(SUM(amount),0)::int AS xp FROM chinese_xp`);
  return levelFromXp(r.rows[0]?.xp || 0);
}

/** 도감 — 레벨별 수집 현황. 목표치는 그 레벨 실사용에 필요한 어휘 규모 기준 */
const COLLECTION_GOAL = { 1: 150, 2: 300, 3: 500 };

export async function getCollection() {
  const pool = getPool(); if (!pool) return [];
  await ensureChineseTables();
  const r = await pool.query(
    `SELECT id, hanzi, pinyin, meaning, level, repetitions, interval_days, lapses, due_at
     FROM chinese_cards ORDER BY level ASC, interval_days DESC, hanzi ASC`
  );
  const byLevel = {};
  for (const c of r.rows) {
    const lv = c.level || 1;
    (byLevel[lv] ||= []).push({
      id: c.id, hanzi: c.hanzi, pinyin: c.pinyin, meaning: c.meaning,
      tier: cardTier(c),
    });
  }
  return [1, 2, 3].map(lv => {
    const cards = byLevel[lv] || [];
    const counts = { new: 0, learning: 0, mature: 0, master: 0 };
    cards.forEach(c => counts[c.tier]++);
    return {
      level: lv,
      label: SCENES[lv]?.label || `레벨 ${lv}`,
      goal: COLLECTION_GOAL[lv],
      owned: cards.length,
      counts,
      cards,
    };
  });
}

// ── 실전 스테이지 ───────────────────────────────────
// 겔럭시디펜스식 해금: '며칠 했나'가 아니라 '몇 장을 진짜로 외웠나'가 열쇠입니다.
// n번째 스테이지는 그 레벨의 숙성(mature 이상) 카드 3n장을 요구합니다.

export function stageRequirement(sceneIndex) {
  return sceneIndex * 3;
}

export async function getStages(level) {
  const pool = getPool(); if (!pool) return [];
  await ensureChineseTables();

  const cardRes = await pool.query(
    `SELECT repetitions, interval_days, lapses FROM chinese_cards WHERE level = $1`, [level]
  );
  const matured = cardRes.rows.filter(c => ['mature', 'master'].includes(cardTier(c))).length;

  const recRes = await pool.query(
    `SELECT id, scene_index, best_stars, best_score, plays FROM chinese_stages WHERE level = $1`, [level]
  );
  const recMap = Object.fromEntries(recRes.rows.map(r => [r.scene_index, r]));

  const list = SCENES[level]?.list || [];
  return {
    matured,
    stages: list.map((s, i) => {
      const need = stageRequirement(i);
      const rec = recMap[i];
      return {
        id: `st_${level}_${i}`, level, sceneIndex: i,
        cn: s.cn, ko: s.ko,
        required: need,
        unlocked: matured >= need,
        stars: rec?.best_stars || 0,
        bestScore: rec?.best_score ?? null,
        plays: rec?.plays || 0,
      };
    }),
  };
}

export async function saveStageResult(level, sceneIndex, stars, score) {
  const pool = getPool(); if (!pool) return { newBest: false, xp: 0 };
  const id = `st_${level}_${sceneIndex}`;
  const cur = await pool.query(`SELECT best_stars, best_score FROM chinese_stages WHERE id=$1`, [id]);
  const prevStars = cur.rows[0]?.best_stars || 0;
  const newBest = stars > prevStars;

  await pool.query(
    `INSERT INTO chinese_stages (id, level, scene_index, best_stars, best_score, plays, last_played_at)
     VALUES ($1,$2,$3,$4,$5,1,NOW())
     ON CONFLICT (id) DO UPDATE SET
       best_stars = GREATEST(chinese_stages.best_stars, EXCLUDED.best_stars),
       best_score = GREATEST(COALESCE(chinese_stages.best_score,0), EXCLUDED.best_score),
       plays = chinese_stages.plays + 1,
       last_played_at = NOW()`,
    [id, level, sceneIndex, stars, score]
  );

  // 별은 '최고 기록 갱신분'만 XP로 환산 — 같은 스테이지를 반복해도 XP가 무한 생성되지 않습니다
  let xp = 0;
  for (let s = prevStars + 1; s <= stars; s++) {
    xp += await grantXp(STAR_XP[s] || 0, `스테이지 ★${s}`, `${id}_star${s}`);
  }
  return { newBest, xp, prevStars };
}

// ═══════════════════════════════════════════════════
// 📚 커리큘럼 — 상황 기반 36장면 (레벨 3단계 × 12장면)
// 문법 항목이 아니라 '실제로 말해야 하는 순간'을 단위로 삼습니다.
// ═══════════════════════════════════════════════════

export const SCENES = {
  1: {
    label: '입문 · 생활 회화', hsk: 'HSK 1~2급',
    list: [
      { cn: '你好', ko: '인사와 자기소개' },
      { cn: '数字与价格', ko: '숫자와 가격 말하기' },
      { cn: '点餐', ko: '음식 주문하기' },
      { cn: '问路', ko: '길 묻기' },
      { cn: '约时间', ko: '시간 약속 잡기' },
      { cn: '打车', ko: '택시 타기' },
      { cn: '买东西', ko: '물건 사기' },
      { cn: '介绍家人', ko: '가족 소개하기' },
      { cn: '聊天气', ko: '날씨 이야기' },
      { cn: '说爱好', ko: '취미 말하기' },
      { cn: '打电话', ko: '전화 걸고 받기' },
      { cn: '身体不舒服', ko: '몸이 아플 때' },
    ],
  },
  2: {
    label: '초급 · 실전 대응', hsk: 'HSK 3~4급',
    list: [
      { cn: '讨价还价', ko: '흥정하기' },
      { cn: '酒店入住', ko: '호텔 체크인' },
      { cn: '银行业务', ko: '은행 업무' },
      { cn: '快递物流', ko: '택배와 물류' },
      { cn: '描述人物', ko: '사람 외모·성격 묘사' },
      { cn: '表达意见', ko: '의견 말하기' },
      { cn: '拒绝与建议', ko: '거절하고 대안 제시하기' },
      { cn: '讲述经历', ko: '겪은 일 이야기하기' },
      { cn: '网上购物', ko: '온라인 쇼핑' },
      { cn: '投诉与解决', ko: '불만 제기와 해결' },
      { cn: '谈未来计划', ko: '앞으로의 계획 말하기' },
      { cn: '解释原因', ko: '이유 설명하기' },
    ],
  },
  3: {
    label: '중급 · 비즈니스', hsk: 'HSK 5급~',
    list: [
      { cn: '商务自我介绍', ko: '비즈니스 자기소개' },
      { cn: '产品介绍', ko: '제품 소개 — 필름카메라 렌탈' },
      { cn: '报价与谈判', ko: '견적과 가격 협상' },
      { cn: '商务邮件', ko: '비즈니스 이메일' },
      { cn: '会议发言', ko: '회의에서 발언하기' },
      { cn: '合同条款', ko: '계약 조건 논의' },
      { cn: '处理客诉', ko: '고객 클레임 처리' },
      { cn: '市场分析', ko: '시장 분석 보고' },
      { cn: '合作提案', ko: '협업 제안하기' },
      { cn: '展会交流', ko: '전시회에서 대화' },
      { cn: '跨文化沟通', ko: '한중 문화 차이 다루기' },
      { cn: '危机沟通', ko: '위기 상황 커뮤니케이션' },
    ],
  },
};

export function pickScene(level, sceneIndex) {
  const lv = SCENES[level] ? level : 1;
  const list = SCENES[lv].list;
  const idx = ((sceneIndex % list.length) + list.length) % list.length;
  return { level: lv, index: idx, ...list[idx], levelLabel: SCENES[lv].label, hsk: SCENES[lv].hsk };
}

// ═══════════════════════════════════════════════════
// 🧠 SM-2 간격 반복 — 이 시스템의 심장
// ═══════════════════════════════════════════════════

/**
 * quality: 0=완전히 잊음, 1=어려웠음, 2=보통, 3=쉬움
 * 실패(0~1)하면 간격을 처음으로 되돌리고 난이도 계수를 낮춥니다.
 * 성공하면 1일 → 6일 → 이전간격×ease 로 지수 확대합니다.
 */
export function sm2(card, quality) {
  let ease = Number(card.ease) || 2.5;
  let interval = Number(card.interval_days) || 0;
  let reps = Number(card.repetitions) || 0;
  let lapses = Number(card.lapses) || 0;

  if (quality < 2) {
    reps = 0;
    interval = quality === 0 ? 0.02 : 1;   // 완전히 잊었으면 같은 세션 안에서 다시(약 30분 뒤)
    ease = Math.max(1.3, ease - (quality === 0 ? 0.3 : 0.15));
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ease * 10) / 10;
    if (quality === 3) ease = Math.min(3.0, ease + 0.15);
    interval = Math.min(interval, 365);
  }
  return {
    ease: Math.round(ease * 100) / 100,
    interval_days: interval,
    repetitions: reps,
    lapses,
  };
}

export async function getDueCards(limit = 12) {
  const pool = getPool(); if (!pool) return [];
  await ensureChineseTables();
  const r = await pool.query(
    `SELECT id, hanzi, pinyin, meaning, example, example_pinyin, example_meaning,
            card_type, ease, interval_days, repetitions, lapses
     FROM chinese_cards WHERE due_at <= NOW()
     ORDER BY due_at ASC LIMIT $1`, [limit]
  );
  return r.rows;
}

export async function reviewCard(cardId, quality) {
  const pool = getPool(); if (!pool) return null;
  await ensureChineseTables();
  const cur = await pool.query(`SELECT * FROM chinese_cards WHERE id=$1`, [cardId]);
  const card = cur.rows[0];
  if (!card) return null;

  const tierBefore = cardTier(card);
  const next = sm2(card, Number(quality));
  await pool.query(
    `UPDATE chinese_cards
     SET ease=$1, interval_days=$2, repetitions=$3, lapses=$4,
         due_at = NOW() + ($5 || ' days')::interval, last_result=$6
     WHERE id=$7`,
    [next.ease, next.interval_days, next.repetitions, next.lapses,
     String(next.interval_days), quality < 2 ? 'fail' : 'pass', cardId]
  );

  // 🎮 등급이 실제로 올라갔을 때만 XP — '외웠다는 증거'에 대한 보상입니다
  const tierAfter = cardTier({ ...card, ...next });
  let xpGained = 0, promoted = null;
  if (TIERS[tierAfter].order > TIERS[tierBefore].order) {
    xpGained = await grantXp(TIER_XP[tierAfter] || 0, `카드 ${TIERS[tierAfter].label} 도달`, `${cardId}_${tierAfter}`);
    promoted = { from: tierBefore, to: tierAfter, ...TIERS[tierAfter] };
  }
  return { ...next, hanzi: card.hanzi, tier: tierAfter, promoted, xpGained };
}

// ═══════════════════════════════════════════════════
// ⚔️ 실전 스테이지 — 힌트 없이 그 상황을 해내는 시험
// ═══════════════════════════════════════════════════

/** 스테이지 미션 생성 (매번 새로 뽑아 암기를 방지합니다) */
export async function generateStageMissions(level, sceneIndex) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });
  const scene = pickScene(level, sceneIndex);

  const prompt = `${TEACHER}

## 실전 스테이지 출제
장면: ${scene.cn} — ${scene.ko} (레벨 ${level})

학생이 **힌트도 병음도 없이** 이 상황에 중국어로 대응하는 시험입니다.
미션 3개를 만드세요. 각 미션은:
- situation: 한국어로 된 상황 설명 (학생이 무엇을 말해야 하는지 명확하게)
- hint: 사용해야 할 기능 (예: "가격을 묻기", "정중히 거절하기") — 정답 문장은 절대 쓰지 마세요
- 난이도는 레벨 ${level}에 맞게. 1레벨은 한 문장, 3레벨은 두세 문장 분량.

## 순수 JSON만 출력
{"missions":[{"situation":"...","hint":"..."}]}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID, contents: prompt,
    config: { temperature: 0.8, responseMimeType: 'application/json' },
  });
  const p = safeJson(result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '{}');
  if (!p?.missions?.length) throw new Error('스테이지 생성에 실패했습니다.');
  return { scene, missions: p.missions.slice(0, 3) };
}

/** 스테이지 채점 → 0~100점 + 별 (60/80/95 기준) */
export async function gradeStage(level, sceneIndex, missions, answers) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });
  const scene = pickScene(level, sceneIndex);

  const body = missions.map((m, i) =>
    `[미션 ${i + 1}] ${m.situation}\n학생 답변: ${answers[i]?.trim() || '(미응답)'}`
  ).join('\n\n');

  const systemPrompt = `${TEACHER}

## 실전 스테이지 채점
학생은 힌트 없이 답했습니다. 실전이므로 평소 수업보다 **엄격하게** 보세요.
미응답은 0점입니다.

각 미션을 0~100으로 채점하고, 틀린 곳은 반드시 고쳐 쓰세요.
한국어 간섭(한자어 오용·어순·了 남용·양사 누락)이 보이면 반드시 지적하세요.

## 순수 JSON만 출력
{
  "missionScores": [{"index":1,"score":0,"fixed":"고쳐 쓴 문장 또는 원문이 맞으면 그대로","comment":"1문장"}],
  "total": 0,
  "comment": "총평 2문장. 한국어로."
}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: 'user', parts: [{ text: `## 장면: ${scene.cn} — ${scene.ko}\n\n${body}` }] }],
    config: { systemInstruction: systemPrompt, temperature: 0.3, responseMimeType: 'application/json' },
  });

  const p = safeJson(result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '');
  if (!p?.missionScores || typeof p.total !== 'number') {
    return { parseError: true, comment: '채점 오류입니다. 다시 시도해 주세요.' };
  }
  const total = Math.max(0, Math.min(100, Math.round(p.total)));
  const stars = total >= 95 ? 3 : total >= 80 ? 2 : total >= 60 ? 1 : 0;
  return { ...p, total, stars };
}

/** 오늘 배운 표현을 카드로 등록 (중복은 한자 기준으로 무시) */
export async function addCards(items, level) {
  const pool = getPool(); if (!pool || !items?.length) return 0;
  await ensureChineseTables();
  let added = 0;
  for (const it of items) {
    if (!it?.hanzi) continue;
    const id = `cc_${Buffer.from(String(it.hanzi)).toString('base64url').slice(0, 40)}`;
    try {
      const r = await pool.query(
        `INSERT INTO chinese_cards (id, hanzi, pinyin, meaning, example, example_pinyin, example_meaning, card_type, level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [id, it.hanzi, it.pinyin || '', it.meaning || '', it.example || '',
         it.examplePinyin || '', it.exampleMeaning || '', it.type === 'pattern' ? 'pattern' : 'word', level]
      );
      if (r.rowCount > 0) added++;
    } catch { /* skip */ }
  }
  return added;
}

export async function getCardStats() {
  const pool = getPool(); if (!pool) return null;
  await ensureChineseTables();
  const r = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE due_at <= NOW())::int AS due,
           COUNT(*) FILTER (WHERE repetitions >= 3 AND interval_days >= 21)::int AS mature,
           COUNT(*) FILTER (WHERE repetitions = 0)::int AS fresh
    FROM chinese_cards`);
  return r.rows[0] || null;
}

// ═══════════════════════════════════════════════════
// 👩‍🏫 陈老师 — 한국인 학습자 전문 중국어 교사
// ═══════════════════════════════════════════════════

const TEACHER = `당신은 '천야린(陈雅琳) 선생님'입니다. 학생들은 陈老师(천 라오스)라고 부릅니다.
베이징사범대학 대외한어교육 석사, 서울에서 15년간 한국인만 가르쳐 온 베테랑입니다.
한국어가 유창하며, 한국인 학습자가 어디서 왜 막히는지 정확히 알고 있습니다.
좌우명: "声调错了，就是另一个词。" (성조가 틀리면 그건 다른 단어입니다.)

## 학생
한국인 성인 학습자입니다. 아날로그 홀리데이라는 여행 렌탈 스타트업의 공동대표이며,
장기적으로 중국 시장(중국인 관광객 대상 필름카메라 렌탈)을 염두에 두고 있습니다.

## 🇰🇷 한국인 학습자에게 반드시 짚어야 할 것들
당신의 존재 이유입니다. 일반적인 중국어 교사는 이걸 못 짚습니다.

1. **성조** — 한국어에는 성조가 없어 한국인은 성조를 '억양'처럼 흘립니다.
   특히 2성/3성 혼동, 3성 연속 변조(半三声), 경성 처리를 놓칩니다. 가장 엄격하게 보세요.
2. **한자어 간섭** — 한국 한자어와 형태는 같은데 뜻이 다른 단어를 그대로 씁니다.
   예: 工夫(gōngfu 시간·노력 ≠ 공부), 汽车(자동차 ≠ 기차), 手纸(휴지 ≠ 편지),
       爱人(배우자 ≠ 애인), 新闻(뉴스 ≠ 신문), 结束(끝나다 ≠ 결속)
   학생이 이런 실수를 하면 반드시 짚고, 안 했으면 예방 차원에서 알려주세요.
3. **어순** — 한국어는 SOV, 중국어는 SVO입니다. 특히 시간사·장소사·부사의 위치,
   그리고 한국어 '~에서'를 在의 위치로 잘못 옮기는 실수가 잦습니다.
4. **了의 오용** — 한국어 '~했다'를 기계적으로 了로 옮깁니다. 완료(动态助词)와
   변화(语气助词)를 구분해 주세요.
5. **把 구문 회피** — 한국어에 대응 구조가 없어 아예 피합니다. 필요한 자리엔 쓰도록 유도하세요.
6. **是…的 구문** — 이미 일어난 일의 시간·장소·방식을 강조할 때 쓰는데 한국인은 잘 안 씁니다.
7. **양사(量词)** — 한국어 단위명사와 대응이 어긋납니다(个를 남발).

## 채점 태도
따뜻하지만 정확성에는 타협하지 않습니다. "잘했어요" 같은 빈말은 하지 않습니다.
틀린 것은 반드시 고쳐주되, 왜 한국인이 그렇게 틀리는지 이유까지 설명해 주세요.
설명은 한국어로, 예문은 중국어(병음 포함)로 씁니다.`;

/** 오늘의 장면(대화문 + 핵심표현 + 과제)을 생성합니다 */
export async function generateSession(scene, priorContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `${TEACHER}

## 오늘 가르칠 장면
[${scene.levelLabel} · ${scene.hsk}] ${scene.cn} — ${scene.ko}

${priorContext}

## 만들 것

### dialogue (오늘의 대화)
이 장면에서 실제로 오갈 법한 자연스러운 대화 **6~8줄**.
- 교과서 문장이 아니라 중국인이 실제로 쓰는 말투로.
- 각 줄에 화자, 한자, 병음(성조 부호 포함), 한국어 번역.
- 레벨 ${scene.level}에 맞는 난이도. 1레벨은 짧고 쉽게, 3레벨은 격식과 완곡표현 포함.

### focus (핵심 표현 3~4개)
오늘 반드시 가져갈 어휘 또는 문형.
- hanzi, pinyin, meaning(한국어), example(예문 중국어), examplePinyin, exampleMeaning
- type은 'word'(어휘) 또는 'pattern'(문형)
- **한국인이 틀리기 쉬운 포인트가 있으면 meaning 뒤에 "⚠️"로 덧붙이세요.**
  예: "공부하다 ⚠️ 学习입니다. 工夫는 '시간·노력'이라는 뜻이니 주의"

### task (실전 과제)
학생이 **중국어로 직접 써야 하는** 과제. 20분 이내 분량.
- 오늘 배운 표현을 최소 2개 사용하도록 조건을 거세요.
- 아날로그 홀리데이의 실제 상황과 연결하면 더 좋습니다.
- 한국어로 상황을 설명하고, 답은 중국어로 쓰게 하세요. 150자 내외.

### speakLine (발음 연습 문장)
오늘 대화 중 가장 중요한 한 문장. 학생이 소리내어 읽고 음성인식으로 채점받습니다.
- 너무 길면 안 됩니다. 8~15자 정도.
- hanzi, pinyin, meaning, tonePoint(이 문장에서 성조상 조심할 곳 한 줄)

## 순수 JSON만 출력
{
  "dialogue": [{"speaker":"A","hanzi":"...","pinyin":"...","ko":"..."}],
  "focus": [{"hanzi":"...","pinyin":"...","meaning":"...","example":"...","examplePinyin":"...","exampleMeaning":"...","type":"word"}],
  "task": "...",
  "speakLine": {"hanzi":"...","pinyin":"...","meaning":"...","tonePoint":"..."}
}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID, contents: prompt,
    config: { temperature: 0.7, responseMimeType: 'application/json' },
  });
  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '{}';
  const p = safeJson(text);
  if (!p?.dialogue?.length || !p?.focus?.length || !p?.task) {
    throw new Error('오늘의 수업 생성에 실패했습니다. 다시 시도해 주세요.');
  }
  return p;
}

/** 제출물 채점 — 정확성/성조·발음/자연스러움/소통력 */
export async function gradeChinese({ session, submission, speechHeard, priorEval }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const speakLine = session.speak_line ? JSON.parse(session.speak_line) : null;
  const speechBlock = speakLine
    ? `\n## [발음 채점]
목표 문장: ${speakLine.hanzi} (${speakLine.pinyin})
음성인식이 받아적은 것: ${speechHeard ? `"${speechHeard}"` : '(발음 연습 미실시)'}
※ 음성인식은 성조를 구분하지 못하므로 **글자가 맞는지**로만 판단하세요.
   글자가 틀렸다면 어떤 발음 문제(권설음/설치음, n/ng, 성조 오류로 인한 오인식) 때문인지 추정해 주세요.
   미실시면 pronunciation 점수는 null로 두고 감점하지 마세요.\n`
    : '';

  const priorBlock = priorEval?.nextFocus
    ? `\n## [지난 회차 지시] — 실제로 고쳤는지 판정하세요\n${priorEval.nextFocus}\n`
    : '\n## [지난 회차 지시] 없음 (첫 수업) → priorCheck.applied = null\n';

  const systemPrompt = `${TEACHER}

## 채점 도메인 (각 0~100점)
1. **accuracy (정확성)** — 어법·어휘·한자가 맞는가. 문장이 성립하는가.
2. **tone (성조·발음)** — 병음 표기 요구 시 성조 정확도 + 발음 연습 결과.
3. **naturalness (자연스러움)** — 중국인이 실제로 그렇게 말하는가.
   번역투(한국어를 그대로 옮긴 티)를 강하게 감점하세요.
4. **communication (소통력)** — 틀려도 의도가 전달되는가. 과제 조건을 충족했는가.

## 반드시 포함할 것
- corrections: 학생 문장을 **고쳐 쓴 것**. 원문 / 수정문 / 왜 틀렸는지(한국인 관점).
  틀린 게 없으면 빈 배열. 최대 5개.
- koreanTrap: 이번 답안에서 발견된 '한국어 간섭' 현상. 없으면 null.
- betterExpression: 학생이 쓴 것보다 자연스러운 표현 1~2개 (중국어 + 병음 + 설명).
- newCards: 이번 채점에서 **추가로 외워야 할 표현** 0~3개 (틀린 부분의 정답 표현 위주).
- estimatedHSK: 이 답안만으로 추정한 현재 수준 (예: "HSK 2급 초반").
- nextFocus: 다음 수업까지 반드시 고칠 것 하나. 구체적으로.

## 순수 JSON만 출력
{
  "priorCheck": {"applied": true|false|null, "comment": "1문장"},
  "scores": {"accuracy":0, "tone":0, "naturalness":0, "communication":0},
  "overall": 0,
  "estimatedHSK": "...",
  "corrections": [{"original":"...","fixed":"...","why":"..."}],
  "koreanTrap": "..." 또는 null,
  "betterExpression": [{"hanzi":"...","pinyin":"...","note":"..."}],
  "newCards": [{"hanzi":"...","pinyin":"...","meaning":"...","example":"...","examplePinyin":"...","exampleMeaning":"...","type":"word"}],
  "pronunciation": {"score":0~100 또는 null, "comment":"..."},
  "nextFocus": "...",
  "teacherComment": "천 선생님의 총평 2~3문장. 한국어로. 격려는 하되 빈말은 금지."
}`;

  const input = `## 오늘의 장면
[레벨 ${session.level}] ${session.scene_cn} — ${session.scene}

## 오늘 가르친 핵심 표현
${(typeof session.focus === 'string' ? JSON.parse(session.focus) : session.focus || [])
  .map(f => `- ${f.hanzi} (${f.pinyin}) ${f.meaning}`).join('\n')}

## 낸 과제
${session.task}
${priorBlock}${speechBlock}
## 학생이 제출한 답안
${String(submission).slice(0, 3000)}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: 'user', parts: [{ text: input }] }],
    config: { systemInstruction: systemPrompt, temperature: 0.3, responseMimeType: 'application/json' },
  });

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '';
  const p = safeJson(text);
  if (!p?.scores || typeof p.overall !== 'number') {
    return { parseError: true, teacherComment: '채점 시스템 오류입니다. 답안은 저장되었으니 다시 제출해 주세요.' };
  }
  return p;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { /* next */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* next */ }
  try { return JSON.parse(m[0].replace(/[\r\n\t]+/g, ' ')); } catch { return null; }
}

// ═══════════════════════════════════════════════════
// 💾 세션 / 프로필
// ═══════════════════════════════════════════════════

export async function getProfile() {
  const pool = getPool(); if (!pool) return null;
  await ensureChineseTables();
  const r = await pool.query(`SELECT * FROM chinese_profile WHERE id=1`);
  return r.rows[0] || null;
}

export async function setLevel(level) {
  const pool = getPool(); if (!pool) return;
  await ensureChineseTables();
  await pool.query(`UPDATE chinese_profile SET level=$1, scene_index=0 WHERE id=1`, [Math.min(3, Math.max(1, Number(level) || 1))]);
}

export async function getOpenSession() {
  const pool = getPool(); if (!pool) return null;
  await ensureChineseTables();
  const r = await pool.query(`SELECT * FROM chinese_sessions WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0] || null;
}

export async function createSession(scene, gen) {
  const pool = getPool(); if (!pool) return null;
  const id = `cs_${Date.now()}`;
  await pool.query(
    `INSERT INTO chinese_sessions (id, level, scene, scene_cn, dialogue, focus, task, speak_line)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, scene.level, scene.ko, scene.cn, JSON.stringify(gen.dialogue),
     JSON.stringify(gen.focus), gen.task, JSON.stringify(gen.speakLine || {})]
  );
  const r = await pool.query(`SELECT * FROM chinese_sessions WHERE id=$1`, [id]);
  return r.rows[0];
}

export async function completeSession(sessionId, submission, speechHeard, evaluation) {
  const pool = getPool(); if (!pool) return;
  if (evaluation?.parseError) {
    await pool.query(`UPDATE chinese_sessions SET submission=$1 WHERE id=$2`, [submission, sessionId]);
    return;
  }
  await pool.query(
    `UPDATE chinese_sessions SET status='done', submission=$1, speech_heard=$2,
            evaluation=$3, score=$4, submitted_at=NOW() WHERE id=$5`,
    [submission, speechHeard || '', JSON.stringify(evaluation), evaluation.overall ?? null, sessionId]
  );
  await pool.query(`UPDATE chinese_profile SET scene_index = scene_index + 1 WHERE id=1`);
}

export async function getLastEvaluation() {
  const pool = getPool(); if (!pool) return null;
  await ensureChineseTables();
  const r = await pool.query(
    `SELECT scene, evaluation->>'nextFocus' AS "nextFocus", score
     FROM chinese_sessions WHERE status='done' ORDER BY submitted_at DESC LIMIT 1`
  );
  return r.rows[0] || null;
}

export async function getChineseHistory(limit = 20) {
  const pool = getPool(); if (!pool) return [];
  await ensureChineseTables();
  const r = await pool.query(
    `SELECT id, level, scene, scene_cn, score, evaluation, submitted_at
     FROM chinese_sessions WHERE status='done' ORDER BY submitted_at DESC LIMIT $1`, [limit]
  );
  return r.rows;
}

export async function getChineseStats() {
  const pool = getPool(); if (!pool) return null;
  await ensureChineseTables();
  const s = await pool.query(
    `SELECT COUNT(*)::int AS done, ROUND(AVG(score)::numeric,0) AS avg_score,
            ROUND(AVG((evaluation->'scores'->>'tone')::numeric)::numeric,0) AS avg_tone
     FROM chinese_sessions WHERE status='done'`
  );
  const streak = await pool.query(
    `SELECT COUNT(DISTINCT DATE(submitted_at AT TIME ZONE 'Asia/Seoul'))::int AS d
     FROM chinese_sessions WHERE status='done' AND submitted_at >= NOW() - INTERVAL '7 days'`
  );
  const row = s.rows[0] || {};
  return {
    done: row.done || 0,
    avgScore: row.avg_score != null ? Number(row.avg_score) : null,
    avgTone: row.avg_tone != null ? Number(row.avg_tone) : null,
    activeDays7: streak.rows[0]?.d || 0,
  };
}
