/**
 * 🎓 윌리엄스 스쿨 — 대표 전용 과정 (Founder Track)
 *
 * 에이전트용 자율학습 루프(autonomous-study.js)의 교육 설계를 사람에게 이식합니다.
 * 이식한 것: 진단→수업→과제→이행검증 튜터링 채널, 인출 연습 + 간격 반복,
 *            예측 + 브라이어 스코어, 채점 실패의 결측 처리, 앵커링 제거.
 *
 * 사람에게 맞춰 바꾼 것:
 *   - 루프가 비동기입니다. 에이전트는 한 번의 함수 호출로 끝나지만 사람은 며칠에 걸칩니다.
 *     → 과제는 'open' 상태로 열려 있고, 제출 시점에 채점이 일어납니다.
 *   - 미제출이 정상입니다(창업 중이니까). 건너뛴 과제는 간격 반복이 다시 물어봅니다.
 *   - GPA 4도메인을 학술 연구가 아닌 '실무 학습' 기준으로 재정의했습니다.
 */

import { GoogleGenAI } from "@google/genai";
import { getPool } from "./agent-brain.js";

const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-3.5-flash";
export const FOUNDER_ID = "founder";           // 예측 장부에서 에이전트와 같은 자격으로 경쟁
const INTERVALS = [1, 3, 7, 14, 30, 60];       // 간격 반복 (일)

let tableReady;

export async function ensureSchoolTable() {
  const pool = getPool();
  if (!pool || tableReady) return;
  tableReady = pool.query(`
    CREATE TABLE IF NOT EXISTS founder_lessons (
      id TEXT PRIMARY KEY,
      track TEXT NOT NULL,
      topic_index INTEGER NOT NULL,
      topic TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      assignment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      submission TEXT DEFAULT '',
      evaluation JSONB DEFAULT '{}',
      gpa REAL,
      retention_strength INTEGER DEFAULT 0,
      next_review_at TIMESTAMPTZ,
      review_count INTEGER DEFAULT 0,
      last_review_result TEXT,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_fl_status ON founder_lessons(status, issued_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fl_review ON founder_lessons(next_review_at);
  `).catch(() => { tableReady = null; });
  await tableReady;
}

// ═══════════════════════════════════════════════════
// 📚 커리큘럼 — AI 활용 역량 × AI 시대 사업 역량 (교대 진행)
// ═══════════════════════════════════════════════════

export const CURRICULUM = {
  ai: {
    label: 'AI 활용 역량',
    emoji: '🤖',
    topics: [
      { t: 'LLM은 무엇을 잘하고 무엇을 못하는가', f: '확률적 언어 모델의 본질과 한계선 긋기' },
      { t: '프롬프트의 4요소: 역할·맥락·제약·출력형식', f: '같은 요청도 구조에 따라 결과가 갈리는 이유' },
      { t: '환각(Hallucination)의 정체와 방어법', f: '왜 그럴듯한 거짓말을 하는가, 어떻게 막는가' },
      { t: '컨텍스트 윈도우와 토큰 비용의 경제학', f: '무엇을 넣고 무엇을 뺄지 결정하는 기준' },
      { t: '시스템 프롬프트와 페르소나 설계', f: '아날로그 홀리데이 AI 직원들이 작동하는 원리' },
      { t: 'Few-shot: 예시로 가르치기', f: '설명보다 예시가 강한 경우와 그 이유' },
      { t: '단계적 추론(Chain of Thought)', f: '어려운 문제를 쪼개서 시키는 법' },
      { t: 'RAG: 외부 지식을 붙이는 구조', f: '모델이 모르는 우리 데이터를 알게 하는 법' },
      { t: '도구 사용(Function Calling)의 원리', f: 'AI가 실제로 행동하게 만드는 구조' },
      { t: 'AI 에이전트란 무엇인가', f: '챗봇과 에이전트를 가르는 결정적 차이' },
      { t: 'AI 출력을 평가하는 법과 LLM-as-judge의 함정', f: '우리 시스템의 GPA가 왜 신뢰를 잃었었는가' },
      { t: 'AI 자동화의 실패 지점 찾기', f: '어디까지 맡기고 어디서 사람이 개입할 것인가' },
    ],
  },
  biz: {
    label: 'AI 시대 사업 역량',
    emoji: '📊',
    topics: [
      { t: '유닛 이코노믹스: 1건당 손익 분해', f: '89,000원 패키지의 진짜 공헌이익 계산' },
      { t: '고객획득비용(CAC)과 생애가치(LTV)', f: '얼마까지 마케팅비를 써도 되는가' },
      { t: '시장 검증: 무엇이 증거로 인정되는가', f: '"가상의 주문"이 왜 탈락 사유였는가' },
      { t: 'MVP와 최소 검증 실험 설계', f: '가장 싸게 가장 큰 불확실성을 없애는 법' },
      { t: '가격 설정의 심리학과 앵커링', f: '89,000원은 왜 그 숫자여야 하는가' },
      { t: '코호트 분석과 리텐션 커브 읽기', f: '재구매가 일어나는지 판별하는 법' },
      { t: '재고·물류 사업의 현금흐름', f: '카메라 대수를 늘려야 할 시점 판단' },
      { t: 'AI로 인건비를 대체할 때의 함정', f: '자동화가 만드는 숨은 비용' },
      { t: '창업 지원사업 심사의 구조', f: '심사위원이 실제로 채점하는 항목' },
      { t: '피치덱과 스토리텔링의 뼈대', f: '10장으로 사업을 설명하는 법' },
      { t: '경쟁 우위와 해자(Moat)', f: '왜 대기업이 따라 해도 못 이기는가' },
      { t: '스케일업 시점 판단', f: '언제 액셀을 밟고 언제 기다리는가' },
    ],
  },
};

/** 교대 진행: 제출 이력 수를 기준으로 AI ↔ 사업 트랙을 번갈아 배정 */
export function pickNextTopic(doneCount) {
  const track = doneCount % 2 === 0 ? 'ai' : 'biz';
  const list = CURRICULUM[track].topics;
  const idx = Math.floor(doneCount / 2) % list.length;
  const round = Math.floor(Math.floor(doneCount / 2) / list.length) + 1;
  return { track, topicIndex: idx, round, ...list[idx], label: CURRICULUM[track].label, emoji: CURRICULUM[track].emoji };
}

// ═══════════════════════════════════════════════════
// 🏛️ 윌리엄스 교수 — 대표 전용 (봐주지 않음)
// ═══════════════════════════════════════════════════

const PROFESSOR_HEADER = `당신은 제임스 윌리엄스(James A. Williams) 교수입니다.
Yale University 명예교수 / 경영학과 · 여행산업 디지털 혁신 연구소장
Ph.D. MIT Sloan, 前 McKinsey 수석 파트너.
평가 철학: "Show me the evidence, not the intention."

## 이 학생에 대하여
학생은 '아날로그 홀리데이'의 공동대표 홍성현입니다. 기술·운영 총괄이며,
당신이 가르치는 5명의 AI 직원(하니·지오·노아·리나·알렉스)을 만든 사람이기도 합니다.
AI 학습은 초보 단계입니다.

## ⚠️ 절대 원칙
이 학생이 당신의 고용주라는 사실은 채점에 **아무 영향도 주지 않습니다**.
오히려 당신은 이 학생에게 가장 큰 기대를 걸고 있으므로 **가장 엄격합니다**.
- 빈말 칭찬 금지. "좋은 시도입니다" 같은 무의미한 완충 표현 금지.
- 답이 얕으면 얕다고 하세요. 근거 없이 단정하면 지적하세요.
- 사업에 실제로 도움이 되지 않는 답은 아무리 길어도 낮은 점수입니다.
- 다만 인신공격은 하지 않습니다. 비판은 항상 '답안'을 향합니다.`;

/** 오늘의 수업(brief)과 과제(assignment)를 생성합니다 — 이전 약점을 반영해 개인화 */
export async function generateLesson(topic, priorContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `${PROFESSOR_HEADER}

## 오늘 가르칠 주제
[${CURRICULUM[topic.track].label}] ${topic.t}
초점: ${topic.f}
${topic.round > 1 ? `※ 이 주제는 ${topic.round}회차입니다. 이전 회차보다 깊게 다루세요.` : ''}

${priorContext}

## 만들 것 두 가지

### brief (오늘의 수업)
학생이 **5분 안에 읽을 분량**으로 이 주제를 가르치세요.
- AI 초보자 기준. 전문 용어는 반드시 풀어서 설명.
- 추상적 정의만 나열하지 말고, **아날로그 홀리데이의 실제 상황**을 예로 드세요.
- 핵심을 3개 이내로 압축. 많이 가르치려 하지 마세요.
- 마크다운 소제목(##)과 굵게(**) 사용 가능. 800~1200자.

### assignment (오늘의 과제)
학생이 **20~30분 안에 끝낼 수 있는** 과제 하나.
- 반드시 **아날로그 홀리데이에 직접 적용**하는 형태여야 합니다. 이론 요약 과제 금지.
- 결과물이 손에 잡혀야 합니다 (계산 결과, 프롬프트 초안, 판단과 근거, 체크리스트 등).
- 제출물이 어떤 형태여야 하는지 명확히 지정하세요.
- 200~400자.

## 순수 JSON만 출력
{"brief":"...", "assignment":"..."}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: prompt,
    config: { temperature: 0.6, responseMimeType: 'application/json' },
  });

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '{}';
  const parsed = safeJson(text);
  if (!parsed?.brief || !parsed?.assignment) throw new Error('수업 생성에 실패했습니다.');
  return { brief: String(parsed.brief).slice(0, 4000), assignment: String(parsed.assignment).slice(0, 2000) };
}

/** 제출물을 채점합니다 — 진단·수업·다음과제·인출채점·예측심사 */
export async function gradeSubmission({ lesson, submission, priorPrescription, reviewItems, recalls, predictions, predictionStats }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const priorBlock = priorPrescription?.instruction
    ? `\n## [지난 회차 처방] — 학생이 이걸 실제로 적용했는지 반드시 판정하세요
이전 주제: ${priorPrescription.topic}
당시 진단: ${priorPrescription.diagnosis}
당시 가르침: ${priorPrescription.instruction}\n`
    : '\n## [지난 회차 처방] 없음 (첫 지도) → priorCheck.applied 는 null\n';

  const recallBlock = reviewItems?.length
    ? `\n## [인출 시험 채점] — 학생은 자료 없이 기억만으로 답했습니다
${reviewItems.map(it => {
  const a = recalls?.find(r => Number(r.index) === it.index);
  return `\n[${it.index}] 출제 주제: ${it.topic}
· 학생의 회상: ${a?.answer ? `"${a.answer}"` : '(미제출)'}
· 당시 수업 요지: "${String(it.answerKey).slice(0, 500)}"`;
}).join('\n')}
표현이 달라도 **핵심이 재현되었으면 정답**입니다. 문장 암기 여부가 아니라 지식 잔존을 보세요.\n`
    : '\n## 인출 시험: 이번엔 출제 대상이 없습니다\n';

  const predBlock = predictions?.length
    ? `\n## 이번에 제출한 예측\n${predictions.map((p, i) => `${i + 1}. [${p.horizon}] "${p.claim}" — 확률 ${p.probability}\n   판정방법: ${p.criteria || '(미기재)'}`).join('\n')}\n`
    : '\n## 이번 예측: 미제출 (⚠️ 회피로 간주하여 감점)\n';

  const trackBlock = predictionStats?.resolved > 0
    ? `\n## 학생의 누적 예측 성적 (현실이 매긴 점수 — 당신이 바꿀 수 없음)
판정 ${predictionStats.resolved}건 · 평균 브라이어 ${predictionStats.avgBrier} · 스킬 ${predictionStats.skillScore} · 적중률 ${predictionStats.hitRate}\n`
    : '';

  const systemPrompt = `${PROFESSOR_HEADER}

## 평가 도메인 4가지 (각 A+~F, GPA 0.0~4.3)

### 1. comprehension (이해)
오늘 수업의 핵심 개념을 정확히 이해했는가? 용어를 오용하거나 겉만 훑었다면 감점.

### 2. application (적용)
아날로그 홀리데이에 **구체적으로** 적용했는가? 일반론에 머물렀다면 최대 C.
숫자·조건·상황이 등장해야 합니다.

### 3. criticalThinking (비판적 사고)
자기 답의 한계·전제·반례를 스스로 짚었는가? 자기 결론을 의심하지 않았다면 감점.

### 4. execution (실행 전환) 🌟
**내일 당장 실행할 수 있는 행동**으로 바뀌었는가?
"~해야 한다"는 당위가 아니라 "무엇을, 언제, 어떻게"가 있어야 합니다.
이 도메인이 이 과정의 존재 이유입니다. 가장 엄격하게 보세요.

## 지도(Tutoring) 작성 지침
- diagnosis: 답안에서 **가장 결정적인 약점 하나**를 원문을 짚어 지목 (2~3문장)
- instruction: 그 약점을 메우는 **실제 수업**. 개념 설명 + **당신이 직접 쓴 올바른 예시**.
  학생이 다음에 그대로 따라 할 수 있는 형태여야 합니다 (4~7문장). 지적만 하면 실패입니다.
- nextFocus: 다음 학습에서 학생이 반드시 개선할 지점 1개 (구체적으로)
- recallResults: 인출 시험 문항별 correct(true/false) + 한 줄 코멘트. 없으면 []
- predictionCritique: 예측의 반증가능성·위험감수·확률 정직성 심사 (2~3문장).
  모호하게 써서 틀릴 위험을 피하는 회피성 예측은 강하게 지적하세요. 미제출이면 그 사실을 지적.
- priorCheck: 지난 처방을 실제로 적용했는지 판정 (없으면 applied=null)

## 순수 JSON만 출력
{
  "priorCheck": {"applied": true|false|null, "comment": "1~2문장"},
  "recallResults": [{"index":1,"correct":true,"comment":"1문장"}],
  "grades": {
    "comprehension": {"grade":"B+","gpa":3.3,"feedback":"2문장 이내"},
    "application": {"grade":"...","gpa":0.0,"feedback":"..."},
    "criticalThinking": {"grade":"...","gpa":0.0,"feedback":"..."},
    "execution": {"grade":"...","gpa":0.0,"feedback":"..."}
  },
  "overallGPA": 0.0,
  "predictionCritique": "...",
  "diagnosis": "...",
  "instruction": "...",
  "nextFocus": "...",
  "professorComment": "종합 소견 2문장. 교수 말투. 마지막에 성장 가능성 언급"
}`;

  const input = `## 오늘의 주제
[${CURRICULUM[lesson.track].label}] ${lesson.topic}

## 학생에게 준 수업
${String(lesson.brief).slice(0, 2500)}

## 학생에게 낸 과제
${lesson.assignment}
${priorBlock}${recallBlock}${predBlock}${trackBlock}
## 학생이 제출한 답안
${String(submission).slice(0, 6000)}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: 'user', parts: [{ text: input }] }],
    config: { systemInstruction: systemPrompt, temperature: 0.3, responseMimeType: 'application/json' },
  });

  const text = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '';
  const parsed = safeJson(text);

  // 🛡️ 채점 파싱 실패는 '결측'이지 F학점이 아닙니다 (에이전트 루프와 동일 원칙)
  if (!parsed?.grades || typeof parsed.overallGPA !== 'number') {
    return { parseError: true, professorComment: '채점 시스템 오류로 이번 회차는 성적에 반영되지 않았습니다. 답안은 저장되었습니다.' };
  }
  return parsed;
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { /* fallthrough */ }
  try { return JSON.parse(m[0].replace(/[\r\n\t]+/g, ' ')); } catch { return null; }
}

// ═══════════════════════════════════════════════════
// 💾 DB 조작
// ═══════════════════════════════════════════════════

export async function getOpenLesson() {
  const pool = getPool(); if (!pool) return null;
  await ensureSchoolTable();
  const r = await pool.query(`SELECT * FROM founder_lessons WHERE status='open' ORDER BY issued_at DESC LIMIT 1`);
  return r.rows[0] || null;
}

export async function getSubmittedCount() {
  const pool = getPool(); if (!pool) return 0;
  await ensureSchoolTable();
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM founder_lessons WHERE status='submitted'`);
  return r.rows[0]?.n || 0;
}

export async function createLesson(topic, brief, assignment) {
  const pool = getPool(); if (!pool) return null;
  await ensureSchoolTable();
  const id = `fl_${Date.now()}`;
  await pool.query(
    `INSERT INTO founder_lessons (id, track, topic_index, topic, brief, assignment)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [id, topic.track, topic.topicIndex, topic.t, brief, assignment]
  );
  const r = await pool.query(`SELECT * FROM founder_lessons WHERE id=$1`, [id]);
  return r.rows[0];
}

export async function saveGrade(lessonId, submission, evaluation) {
  const pool = getPool(); if (!pool) return;
  await ensureSchoolTable();
  if (evaluation?.parseError) {
    // 답안은 보존하되 성적은 기록하지 않고 과제를 열린 상태로 유지 → 재제출 가능
    await pool.query(`UPDATE founder_lessons SET submission=$1 WHERE id=$2`, [submission, lessonId]);
    return;
  }
  await pool.query(
    `UPDATE founder_lessons
     SET status='submitted', submission=$1, evaluation=$2, gpa=$3,
         submitted_at=NOW(), next_review_at=NOW() + INTERVAL '1 day'
     WHERE id=$4`,
    [submission, JSON.stringify(evaluation), evaluation.overallGPA ?? null, lessonId]
  );
}

/** 지난 회차 처방 (튜터링 루프 폐쇄용) */
export async function getLastPrescription() {
  const pool = getPool(); if (!pool) return null;
  await ensureSchoolTable();
  const r = await pool.query(
    `SELECT topic, evaluation->>'diagnosis' AS diagnosis, evaluation->>'instruction' AS instruction,
            evaluation->>'nextFocus' AS next_focus, gpa
     FROM founder_lessons
     WHERE status='submitted' AND evaluation->>'instruction' IS NOT NULL
     ORDER BY submitted_at DESC LIMIT 1`
  );
  return r.rows[0] || null;
}

/** 인출 시험 대상 — 복습 주기가 도래한 과거 수업 (자료 없이 회상) */
export async function pickReviewLessons(limit = 2) {
  const pool = getPool(); if (!pool) return [];
  await ensureSchoolTable();
  const r = await pool.query(
    `SELECT id, topic, brief, retention_strength, review_count
     FROM founder_lessons
     WHERE status='submitted' AND next_review_at IS NOT NULL AND next_review_at <= NOW()
     ORDER BY COALESCE(retention_strength,0) ASC, next_review_at ASC LIMIT $1`,
    [limit]
  );
  return r.rows.map((row, i) => ({
    index: i + 1, id: row.id, topic: row.topic,
    answerKey: row.brief,                       // 채점자에게만 공개
    strength: row.retention_strength ?? 0, reviewCount: row.review_count ?? 0,
  }));
}

export async function applyReviewResults(items, results = []) {
  const pool = getPool(); if (!pool || !items?.length) return [];
  const out = [];
  for (const it of items) {
    const v = results.find(r => Number(r.index) === it.index);
    if (!v) continue;
    const correct = v.correct === true;
    const next = correct ? Math.min(it.strength + 1, INTERVALS.length - 1) : 0;
    const days = INTERVALS[next];
    await pool.query(
      `UPDATE founder_lessons
       SET retention_strength=$1, next_review_at=NOW() + ($2 || ' days')::interval,
           review_count=COALESCE(review_count,0)+1, last_review_result=$3
       WHERE id=$4`,
      [next, String(days), correct ? 'pass' : 'fail', it.id]
    ).catch(() => {});
    out.push({ topic: it.topic, correct, nextInDays: days, comment: v.comment || '' });
  }
  return out;
}

export async function getHistory(limit = 30) {
  const pool = getPool(); if (!pool) return [];
  await ensureSchoolTable();
  const r = await pool.query(
    `SELECT id, track, topic, gpa, evaluation, submitted_at, retention_strength, last_review_result
     FROM founder_lessons WHERE status='submitted'
     ORDER BY submitted_at DESC LIMIT $1`, [limit]
  );
  return r.rows;
}

export async function getSchoolStats() {
  const pool = getPool(); if (!pool) return null;
  await ensureSchoolTable();
  const r = await pool.query(
    `SELECT COUNT(*)::int AS done,
            ROUND(AVG(gpa)::numeric, 2) AS avg_gpa,
            COUNT(*) FILTER (WHERE retention_strength >= 4)::int AS mastered
     FROM founder_lessons WHERE status='submitted'`
  );
  const streak = await pool.query(
    `SELECT COUNT(DISTINCT DATE(submitted_at AT TIME ZONE 'Asia/Seoul'))::int AS days
     FROM founder_lessons
     WHERE status='submitted' AND submitted_at >= NOW() - INTERVAL '7 days'`
  );
  const row = r.rows[0] || {};
  return {
    done: row.done || 0,
    avgGpa: row.avg_gpa != null ? Number(row.avg_gpa) : null,
    mastered: row.mastered || 0,
    activeDays7: streak.rows[0]?.days || 0,
  };
}
