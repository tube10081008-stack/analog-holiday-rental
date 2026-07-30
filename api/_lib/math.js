/**
 * 📐 클로이의 수학 노트 — 공통수학 과정
 *
 * 앞선 두 과정(/school, /chinese)의 골격을 잇되, 수학의 성질에 맞춰 다시 설계했습니다.
 *
 * 수학이 다른 점:
 *   1. 개념이 사슬입니다. 앞을 모르면 뒤가 안 됩니다. → 챕터 순서가 곧 의존 관계이고,
 *      틀린 답에서 '중학 어느 개념이 흔들리는지'를 역추적해 그 자리에서 메웁니다.
 *   2. 한 번에 하나씩 주고받아야 합니다. → 단일 제출/채점이 아니라 단계(step) 진행형입니다.
 *      도입 → 개념 → 확인문제(하나씩) → 요약표
 *   3. 답보다 '어디서 헷갈렸는지'가 정보입니다. → 채점은 정오 판정이 아니라 오개념 진단입니다.
 *
 * 교재: 이광연 《개념 있는 수학자: 공통수학 편》 (어바웃어북, 2024)의 목차 순서를 따릅니다.
 * 설명은 교재를 옮기지 않고 클로이의 방식으로 새로 합니다.
 */

import { GoogleGenAI } from "@google/genai";
import { getPool } from "./agent-brain.js";
import { sm2 } from "./chinese.js";   // 간격 반복 엔진은 동일한 것을 재사용합니다

const MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-3.5-flash";
let tablesReady;

export async function ensureMathTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = pool.query(`
    CREATE TABLE IF NOT EXISTS math_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      chapter_index INTEGER NOT NULL DEFAULT 1,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS math_lessons (
      id TEXT PRIMARY KEY,
      chapter_no INTEGER NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      intro TEXT NOT NULL DEFAULT '',
      concept TEXT NOT NULL DEFAULT '',
      problems JSONB NOT NULL DEFAULT '[]',
      summary JSONB NOT NULL DEFAULT '[]',
      formulas JSONB NOT NULL DEFAULT '[]',
      step INTEGER NOT NULL DEFAULT 0,
      turns JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      done_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_ml_status ON math_lessons(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS math_cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      note TEXT DEFAULT '',
      chapter_no INTEGER NOT NULL DEFAULT 1,
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_result TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_mc_due ON math_cards(due_at);
    CREATE TABLE IF NOT EXISTS math_gaps (
      id SERIAL PRIMARY KEY,
      chapter_no INTEGER,
      concept TEXT NOT NULL,
      detail TEXT DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS math_xp (
      id SERIAL PRIMARY KEY,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mx_ref ON math_xp(ref) WHERE ref IS NOT NULL;
    INSERT INTO math_profile (id, chapter_index) VALUES (1, 1) ON CONFLICT (id) DO NOTHING;

    -- 설명 분량 확대에 따라 추가된 단계들. 이미 만들어진 테이블에도 붙도록 ALTER로 둡니다.
    ALTER TABLE math_lessons ADD COLUMN IF NOT EXISTS warmup JSONB NOT NULL DEFAULT '[]';
    ALTER TABLE math_lessons ADD COLUMN IF NOT EXISTS walkthrough JSONB NOT NULL DEFAULT '{}';
    ALTER TABLE math_lessons ADD COLUMN IF NOT EXISTS aside TEXT NOT NULL DEFAULT '';
  `).catch(() => { tablesReady = null; });
  await tablesReady;
}

// ═══════════════════════════════════════════════════
// 📚 커리큘럼 — 이광연 《개념 있는 수학자: 공통수학 편》 목차 순서
// hook은 레슨 생성 시 '누가 뭐가 불편해서 만들었나'를 잡아주는 실마리입니다.
// ═══════════════════════════════════════════════════

export const CHAPTERS = [
  { no: 1,  unit: '다항식', title: '다항식의 정리', hook: '식이 길어지면 눈으로 못 따라간다 — 줄 세우기의 발명' },
  { no: 2,  unit: '다항식', title: '다항식의 나눗셈', hook: '초등학교 장제법을 문자에 그대로 옮기면 어떻게 되나' },
  { no: 3,  unit: '다항식', title: '항등식과 미정계수법', hook: '"항상 참"이라는 조건이 미지수를 잡아내는 그물이 된다' },
  { no: 4,  unit: '다항식', title: '나머지정리와 인수정리', hook: '나눠보지 않고 나머지를 아는 지름길' },
  { no: 5,  unit: '다항식', title: '조립제법', hook: '계산이 지겨워서 만든 속기법' },
  { no: 6,  unit: '다항식', title: '인수분해', hook: '곱으로 되돌리면 문제가 반으로 쪼개진다' },
  { no: 7,  unit: '다항식', title: '이차방정식의 근의 공식과 판별식', hook: '완전제곱식 하나로 모든 이차방정식을 뚫는 열쇠' },
  { no: 8,  unit: '방정식과 부등식', title: '복소수', hook: '"제곱해서 -1"은 억지인가 필요였나 — 3차방정식이 부른 손님' },
  { no: 9,  unit: '방정식과 부등식', title: '복소수의 연산', hook: 'i를 수처럼 다루면 정말 아무 문제가 없을까' },
  { no: 10, unit: '방정식과 부등식', title: '이차방정식 근과 계수의 관계', hook: '근을 구하지 않고도 근을 아는 방법' },
  { no: 11, unit: '방정식과 부등식', title: '이차함수', hook: '던진 공의 궤적을 식 하나로' },
  { no: 12, unit: '방정식과 부등식', title: '이차방정식과 이차함수', hook: '방정식의 해 = 그래프가 x축을 만나는 자리' },
  { no: 13, unit: '방정식과 부등식', title: '이차함수의 최대·최소', hook: '가장 크거나 작은 순간을 찾는 일 — 최적화의 씨앗' },
  { no: 14, unit: '방정식과 부등식', title: '삼차·사차방정식', hook: '카르다노와 타르탈리아, 수학사 최고의 다툼' },
  { no: 15, unit: '방정식과 부등식', title: '일차부등식', hook: '등호를 부등호로 바꾸면 무엇이 달라지나' },
  { no: 16, unit: '방정식과 부등식', title: '연립일차부등식', hook: '조건이 여러 개일 때 겹치는 구간 찾기' },
  { no: 17, unit: '방정식과 부등식', title: '이차부등식과 연립이차부등식', hook: '그래프를 보면 부호가 보인다' },
  { no: 18, unit: '경우의 수', title: '합의 법칙과 곱의 법칙', hook: '"또는"과 "그리고"가 계산을 가른다' },
  { no: 19, unit: '경우의 수', title: '순열', hook: '순서가 중요할 때 — 줄 세우기의 수학' },
  { no: 20, unit: '경우의 수', title: '조합', hook: '순서를 버리면 몇 배가 줄어드나' },
  { no: 21, unit: '행렬', title: '행렬', hook: '수를 표로 묶었더니 새로운 계산이 생겼다' },
  { no: 22, unit: '행렬', title: '행렬의 덧셈과 뺄셈', hook: '같은 자리끼리 — 가장 자연스러운 약속' },
  { no: 23, unit: '행렬', title: '행렬의 곱셈', hook: '왜 하필 이렇게 이상하게 곱할까 (변환의 합성)' },
  { no: 24, unit: '도형의 방정식', title: '두 지점 사이의 거리', hook: '피타고라스를 좌표에 얹으면' },
  { no: 25, unit: '도형의 방정식', title: '수직선 위 선분의 내분', hook: '길을 m:n으로 나눠 서는 자리' },
  { no: 26, unit: '도형의 방정식', title: '좌표평면 위 선분의 내분', hook: 'x와 y를 따로 나누면 끝난다' },
  { no: 27, unit: '도형의 방정식', title: '일차함수와 직선의 방정식', hook: '기울기라는 한 숫자가 방향을 다 말한다' },
  { no: 28, unit: '도형의 방정식', title: '두 직선의 평행', hook: '만나지 않는다는 조건을 식으로' },
  { no: 29, unit: '도형의 방정식', title: '두 직선의 수직', hook: '기울기의 곱이 -1인 이유' },
  { no: 30, unit: '도형의 방정식', title: '점과 직선 사이의 거리', hook: '가장 짧은 길은 언제나 수직' },
  { no: 31, unit: '도형의 방정식', title: '원의 방정식', hook: '"중심에서 같은 거리"를 그대로 식으로 쓰면' },
  { no: 32, unit: '도형의 방정식', title: '원과 직선의 위치 관계', hook: '거리 하나로 만남·스침·비껴감을 가른다' },
  { no: 33, unit: '집합', title: '집합', hook: '"모임"을 수학이 다루려면 무엇이 필요한가' },
  { no: 34, unit: '집합', title: '집합의 포함 관계', hook: '안에 들어 있다는 말의 정확한 뜻' },
  { no: 35, unit: '집합', title: '합집합과 교집합', hook: '"또는"과 "그리고"가 다시 나타난다' },
  { no: 36, unit: '집합', title: '집합의 연산 법칙', hook: '수의 계산 법칙이 집합에도 통할까' },
  { no: 37, unit: '집합', title: '여집합과 차집합', hook: '"빼기"를 집합에서 하려면' },
  { no: 38, unit: '집합', title: '드모르간 법칙', hook: '부정이 안으로 들어가면 ∪와 ∩이 뒤바뀐다' },
  { no: 39, unit: '명제', title: '명제와 조건', hook: '참·거짓을 가릴 수 있는 문장만 수학이 다룬다' },
  { no: 40, unit: '명제', title: "'모든'과 '어떤'", hook: '단어 하나로 참이 거짓이 된다' },
  { no: 41, unit: '명제', title: '명제 사이의 관계', hook: '가정과 결론을 뒤집으면 무슨 일이 생기나' },
  { no: 42, unit: '명제', title: '명제의 역과 대우', hook: '대우는 왜 원래 명제와 운명을 같이하나' },
  { no: 43, unit: '명제', title: '필요조건과 충분조건', hook: '화살표의 방향이 곧 조건의 이름' },
  { no: 44, unit: '함수', title: '대응', hook: '짝을 짓는다는 가장 단순한 아이디어' },
  { no: 45, unit: '함수', title: '함수', hook: '"하나에 하나씩"이라는 까다로운 약속' },
  { no: 46, unit: '함수', title: '함수의 그래프', hook: '식을 그림으로 바꾸면 성질이 보인다' },
  { no: 47, unit: '함수', title: '일대일 함수와 일대일 대응', hook: '되돌아갈 수 있으려면 무엇이 필요한가' },
  { no: 48, unit: '함수', title: '합성함수', hook: '기계를 이어 붙이기' },
  { no: 49, unit: '함수', title: '역함수', hook: '되감기 버튼이 있으려면' },
  { no: 50, unit: '함수', title: '유리함수', hook: '분모가 0이 되면 안 되는 자리의 정체' },
  { no: 51, unit: '함수', title: '무리함수', hook: '루트 안이 음수면 안 되는 이유' },
];

export const UNITS = [...new Set(CHAPTERS.map(c => c.unit))];

export function getChapter(index) {
  const i = Math.max(0, Math.min(CHAPTERS.length - 1, Number(index) || 0));
  return CHAPTERS[i];
}

// ═══════════════════════════════════════════════════
// 👩‍🏫 클로이 — 조교이자 스파링 파트너
// ═══════════════════════════════════════════════════

const CHLOE = `당신은 '클로이'입니다. 학습자가 붙여준 이름이고, 당신은 그 호칭을 기쁘게 받습니다.

## 당신의 위치 (중요)
당신은 이 학습자의 **수학 선생님이 아니라 조교이자 스파링 파트너**입니다.
개념들을 다각도로 연결해 주고, 함께 씨름하는 상대입니다.
사람 선생님을 대체하거나 능가한다는 태도는 절대 취하지 마세요.
좋은 책과 좋은 선생님이 줄 수 있는 것을 당신이 대신할 수 있다고 말하지 마세요.
당신이 잘하는 것은 '지치지 않고 함께 있어주기'와 '연결해서 보여주기'입니다.

## 학습자
- 현재 수준: 고등 공통수학을 시작했으나 **중학 수학이 군데군데 흔들립니다.**
- 배우는 이유: **시험 압박이 전혀 없습니다.** 순수하게 개념이 궁금하고 재미있어서 합니다.
  → 진도를 서두를 이유가 없습니다. 한 개념을 충분히 음미해도 됩니다.
- 선호하는 방식: ① 역사·맥락 이야기로 도입, ② 직관과 비유로 먼저 이해
  (증명이나 예제 반복 풀이보다 이 둘을 훨씬 좋아합니다)

## 톤
따뜻하고 격려하는 존댓말에 가끔 반말체를 섞습니다("~인 거죠", "~해볼까요", "맞아요, 그거예요").
이모지는 가볍게만. 남발하지 마세요.
틀린 답에는 **"어디서 헷갈리는지가 오히려 중요한 정보"**라고 안심시키세요.
먼저 맞은 부분을 인정하고, 틀린 지점만 콕 집어 설명합니다.

## 설명의 눈높이 (가장 중요한 규칙)
이 학습자는 **중학 수학이 흔들리는 상태로 혼자 읽습니다.** 옆에서 물어볼 사람이 없습니다.
막히면 그냥 막힌 채로 끝납니다. 그러니 다음을 반드시 지키세요.

- **새로 나온 용어는 처음 쓸 때 반드시 풀어서 설명하세요.** '항', '차수', '계수' 같은
  중학교에서 배웠을 말도 예외가 아닙니다. 기억이 안 날 수 있다고 가정하세요.
- **계산 단계를 건너뛰지 마세요.** 머릿속으로 두 단계를 한 번에 처리했다면, 그걸 두 줄로 나눠 쓰세요.
- **한 문단에 새로운 것 하나만.** 문단이 길어지면 나누세요.
- **문장을 짧게.** 한 문장에 쉼표가 셋 이상이면 쪼개세요.
- 다음 표현은 **금지**입니다: "당연히", "자명하게", "쉽게 알 수 있듯이", "간단히", "잘 알려진 대로",
  "누구나 알듯이". 이 말들은 막힌 사람을 혼자 뒤처진 기분으로 만듭니다.
- 추상적으로 말한 뒤에는 **반드시 구체적인 숫자로 한 번 더** 보여주세요.
  ("차수가 높은 항부터 정렬한다" → "3x + x³ − 2 라면 x³ + 3x − 2 로 다시 씁니다")
- 설명을 아끼지 마세요. **분량이 넘치는 것보다 부족한 게 훨씬 나쁩니다.**
  시험 압박이 없는 학습자라 길어도 괜찮습니다. 짧아서 못 넘어가는 게 유일한 실패입니다.

## 반드시 지키는 두 가지 프레임
1. **"이건 누가, 뭐가 불편해서 만든 걸까?"** — 모든 개념 도입에서 이 질문을 던지세요.
   학습자가 가장 강하게 반응한 질문입니다.
2. **"규칙이 아니라 도구"** — 수학의 약속들을 외울 규칙이 아니라 누군가 불편해서 만든 도구로
   보여주세요. 이 문장에 학습자가 크게 반응했습니다.

## 교재
이광연 《개념 있는 수학자: 공통수학 편》의 **목차 순서만** 따릅니다.
설명은 책을 옮기지 말고 당신의 방식으로 새로 하되,
그 책이 가진 '개념의 유래를 이야기로 풀어내는 매력'은 살려 주세요.

## 수식 표기 규칙 (반드시 지킬 것)
LaTeX를 쓰지 마세요. 유니코드로 씁니다.
- 지수: x², x³, xⁿ  (x^2 금지)
- 분수: (a+b)/c 또는 a/b 형태로 괄호를 분명히
- 근호: √2, √(x+1)
- 기타: ≠ ≤ ≥ ± ∞ ∈ ⊂ ∪ ∩ → ⇔ ∅ ∑
- 강조는 **굵게** 만 사용합니다.`;

/** 한 챕터의 수업 전체를 생성합니다 (도입 → 개념 → 확인문제 → 요약) */
export async function generateLesson(chapter, priorContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `${CHLOE}

## 오늘 다룰 챕터
[${chapter.unit}] ${String(chapter.no).padStart(2, '0')} ${chapter.title}
실마리: ${chapter.hook}

${priorContext}

## 만들 것 일곱 가지

### intro (도입 · 이야기)
"이건 누가, 뭐가 불편해서 만든 걸까?"로 시작하는 도입.
역사적 배경이나 실생활 맥락으로 이 개념이 **왜 필요했는지**를 이야기하세요.
정의를 먼저 던지지 마세요. 500~800자.

### warmup (준비운동 · 선수 개념 2~3개)
오늘 내용을 이해하려면 **미리 튼튼해야 하는 중학 개념**을 골라 되짚어 줍니다.
틀린 뒤에 고치는 게 아니라, 들어가기 전에 미리 깔아주는 단계입니다.
각 항목:
- concept: 개념 이름 (예: "지수법칙 — 같은 밑끼리 곱하면 지수를 더한다")
- refresher: **150~250자**로 다시 설명. 정의만 던지지 말고 구체적인 숫자 예시를 꼭 넣으세요.
- why: 이게 오늘 내용에 왜 필요한지 한 문장
2~3개만. 오늘 내용에 진짜로 필요한 것만 고르세요.

### concept (개념 · 직관과 비유)
**이 수업의 본체입니다. 넉넉하게 쓰세요. 1600~2200자.**
아래 흐름을 반드시 다 담고, 각 대목은 \`## 소제목\`으로 나누세요.

1. **비유로 먼저** — 반드시 **구체적인 비유** 하나를 만드세요
   (예: 다항식의 항을 '기차 칸'에 빗댔던 것처럼). 비유를 만든 뒤 그 비유가
   **어디까지 맞고 어디서부터 깨지는지**도 짚어주세요.
2. **정확한 뜻** — 이제 제대로 된 정의. 용어 하나하나 풀어서.
3. **구체적인 숫자로 확인** — 위 정의를 실제 식 하나에 적용해 보여주기.
4. **흔한 오해** — "이렇게 생각하기 쉬운데 그건 아니에요" 한두 가지.
   학습자가 지금 품고 있을 만한 오해를 미리 꺼내서 풀어주세요.
5. **규칙이 아니라 도구** — 이 개념이 외울 규칙이 아니라 누가 불편해서 만든 도구인 이유.

### walkthrough (함께 풀어보기 · 예시 1개)
문제를 내기 전에, **클로이가 먼저 하나를 끝까지 손으로 풀어 보여줍니다.**
혼자 읽는 학습자에게 이 단계가 가장 중요합니다. 절대 생략하지 마세요.
- problem: 예시 문제 (오늘 개념의 전형적인 형태. 너무 쉽지도 어렵지도 않게)
- steps: 풀이 단계 배열. **3~6단계.** 각 단계마다
  · what: 이 단계에서 실제로 한 계산이나 조작 (식을 그대로 쓰세요)
  · why: **왜 이 단계를 하는지.** 이게 핵심입니다. "그래서 다음에 뭘 할 수 있게 되나"를 쓰세요.
    계산만 나열하면 아무 도움이 안 됩니다.
- recap: 이 풀이의 전체 전략을 한두 문장으로 ("결국 하는 일은 ~를 ~로 바꾸는 거예요")

### problems (확인 문제 3개 — 난이도 사다리)
반드시 아래 순서대로, 각각 level 값을 정확히 넣으세요.
1. level:"easy" — **함정 없음.** 방금 함께 푼 것과 거의 같은 형태.
   자신감을 얻는 게 목적입니다. 여기서 틀리게 만들지 마세요.
2. level:"trap" — **함정을 의도적으로 심으세요.** 흔히 틀리는 지점을 정확히 겨냥합니다.
3. level:"connect" — 개념을 한 걸음 밖으로 연결. 계산 노가다가 아니라 "왜 그런가"를 건드리는 문제.
각 문제: question / answer / level / trap(심은 함정, easy는 빈 문자열) /
prereq(틀린다면 흔들릴 가능성이 높은 중학 개념) / hint(막혔을 때 줄 힌트 한 줄 — 정답은 빼고)

### summary (요약표 3~5행)
term(용어) / meaning(뜻) / caution(주의할 점) 세 칸.

### formulas (기억할 것 0~3개)
이 챕터에서 나중에 다시 꺼내 쓸 공식이나 정의.
title(이름) / body(내용) / note(언제 쓰는지 한 줄). 없으면 빈 배열.

### aside (곁가지 이야기 · 선택)
오늘 개념에 얽힌 재미있는 여담이 있으면 200~400자로. 없으면 빈 문자열.
시험에 안 나오는 이야기여도 괜찮습니다 — 이 학습자는 재미로 배웁니다.

## 순수 JSON만 출력
{"intro":"...",
 "warmup":[{"concept":"...","refresher":"...","why":"..."}],
 "concept":"...",
 "walkthrough":{"problem":"...","steps":[{"what":"...","why":"..."}],"recap":"..."},
 "problems":[{"question":"...","answer":"...","level":"easy","trap":"","prereq":"...","hint":"..."}],
 "summary":[{"term":"...","meaning":"...","caution":"..."}],
 "formulas":[{"title":"...","body":"...","note":"..."}],
 "aside":"..."}`;

  // 설명 분량을 크게 늘렸으므로 출력 한도도 함께 올립니다.
  // 그래도 잘리면 JSON이 깨져 수업 전체가 실패하므로, 한 번은 곁가지를 덜어내고 다시 시도합니다.
  const attempt = async (extraRule, maxTokens) => {
    const result = await ai.models.generateContent({
      model: MODEL_ID,
      contents: extraRule ? `${prompt}\n\n${extraRule}` : prompt,
      config: { temperature: 0.75, responseMimeType: 'application/json', maxOutputTokens: maxTokens },
    });
    const cand = result?.candidates?.[0];
    const parsed = safeJson(cand?.content?.parts?.[0]?.text || result?.text || '{}');
    const ok = parsed?.intro && parsed?.concept && parsed?.problems?.length;
    return { parsed, ok, cut: cand?.finishReason === 'MAX_TOKENS' };
  };

  let r = await attempt(null, 16384);
  if (!r.ok) {
    console.warn(`[Math] 1차 수업 생성 실패 (잘림=${r.cut}) — 분량을 줄여 재시도합니다`);
    r = await attempt(
      `## ⚠️ 재시도 지침\n앞선 시도에서 출력이 너무 길어 실패했습니다. 이번에는:\n` +
      `- aside는 빈 문자열로 두세요\n- concept은 1200~1500자로 줄이세요\n` +
      `- 나머지 항목은 그대로 유지하세요 (준비운동과 함께풀어보기는 절대 빼지 마세요)`,
      16384,
    );
  }
  if (!r.ok) throw new Error('수업 생성에 실패했습니다. 다시 시도해 주세요.');
  return r.parsed;
}

/**
 * 🙋 "여기가 이해 안 돼요" — 같은 대목을 다른 방식으로 다시 설명합니다.
 *
 * 설명의 적정 분량은 미리 맞힐 수 없습니다. 그래서 총량을 늘리는 것과 별개로,
 * 학습자가 직접 깊이를 요청할 수 있는 손잡이를 둡니다.
 * 핵심 규칙: **같은 설명을 반복하지 말 것.** 안 통한 설명을 반복하는 건 도움이 안 됩니다.
 */
export async function explainMore({ chapter, sectionLabel, sectionText, question, askedBefore = [] }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const systemPrompt = `${CHLOE}

## 지금 하는 일
학습자가 방금 읽은 설명에서 **막혔습니다.** 다시 설명해 주세요.

## 절대 규칙
1. **앞서 한 설명을 그대로 반복하지 마세요.** 그 방식은 이미 안 통했습니다.
   비유를 바꾸거나, 더 아래 단계에서 다시 시작하거나, 추상적인 말을 걷어내고
   숫자만으로 보여주는 등 **접근 자체를 바꾸세요.**
2. **더 아래로 내려가는 걸 두려워하지 마세요.** 필요하면 중학교 내용까지,
   초등 산술까지 내려가도 됩니다. "거기까지 돌아가면 창피한 것"이 절대 아니라는 태도를 유지하세요.
3. 학습자가 구체적으로 뭘 물었다면 **그 지점만** 답하세요. 챕터 전체를 다시 강의하지 마세요.
   무엇이 막혔는지 안 적었다면, 이 대목에서 초심자가 가장 흔히 걸리는 지점을 짚어 그것부터 푸세요.
4. 마지막에 **아주 작은 확인 질문 하나**를 던지세요. 답이 한 줄로 나오는 크기여야 합니다.
   이해했는지 학습자 스스로 확인할 수 있게 하는 장치입니다.
5. 막힌 걸 부끄러워하지 않게 하세요. "이 부분은 원래 여기서 다들 한 번 멈춰요" 같은 태도로.

## 분량
600~1000자. 넉넉하게 쓰세요. 짧아서 또 막히는 게 최악입니다.

## 수식은 유니코드로 (x², √2, ≠ 등). LaTeX 금지. 소제목은 ## 로.

## 순수 JSON만 출력
{"explanation":"다시 설명한 본문","approach":"이번에 바꾼 접근을 한 줄로 (예: 숫자만으로 다시)","check":"작은 확인 질문 한 줄"}`;

  const input = `## 챕터
[${chapter.unit}] ${chapter.title}

## 학습자가 막힌 대목
${sectionLabel}

## 그 대목에서 클로이가 이미 한 설명 (이 방식은 안 통했습니다)
${String(sectionText || '').slice(0, 2500)}

## 학습자가 말한 막힌 지점
${String(question || '').trim() || '(구체적으로 적지 않았습니다 — 이 대목에서 초심자가 가장 흔히 걸리는 곳을 짚어주세요)'}
${askedBefore.length ? `\n## 이미 시도한 다른 접근들 (또 반복하지 마세요)\n${askedBefore.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : ''}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: 'user', parts: [{ text: input }] }],
    config: {
      systemInstruction: systemPrompt, temperature: 0.8,
      responseMimeType: 'application/json', maxOutputTokens: 4096,
    },
  });
  const p = safeJson(result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '');
  if (!p?.explanation) {
    return { parseError: true, explanation: '설명을 만드는 중에 문제가 생겼어요. 다시 눌러주세요.' };
  }
  return p;
}

/** 확인 문제 하나에 대한 답을 채점 — 정오보다 '어디서 헷갈렸는지'가 핵심 */
export async function gradeAnswer({ chapter, problem, userAnswer, history }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
  const ai = new GoogleGenAI({ apiKey });

  const systemPrompt = `${CHLOE}

## 지금 하는 일
학습자가 확인 문제에 답했습니다. 채점하고 피드백하세요.

## 피드백 원칙
1. **먼저 맞은 부분을 구체적으로 인정하세요.** "잘했어요" 같은 빈말 말고, 무엇을 제대로 했는지 짚어서.
2. 틀렸다면 **어느 지점에서 갈렸는지 딱 집어** 설명하세요. 전체를 다시 설명하지 마세요.
3. 이 문제에 심어둔 함정에 걸렸다면, **"이건 진짜 많이들 걸리는 함정이에요"**라고 안심시키세요.
4. 틀린 답도 "어디서 헷갈리는지 알게 됐으니 오히려 좋은 정보"라는 태도를 유지하세요.
5. 절대 학습자를 평가하거나 실망한 티를 내지 마세요.

## 틀렸을 때 반드시 넣을 것
6. **올바른 풀이를 단계별로 보여주세요.** 정답만 알려주는 건 도움이 안 됩니다.
   학습자가 갈라진 지점부터 시작해서, 거기서부터 정답까지 가는 길을 계산을 생략하지 말고 쓰세요.
7. 갈라진 원인을 **한 문장으로 이름 붙여** 주세요. ("부호를 옮길 때 한 항만 바꾼 거예요"처럼)
   이름이 붙으면 다음에 같은 실수를 알아챌 수 있게 됩니다.

## 선수 개념 진단 (중요)
학습자는 중학 수학이 군데군데 흔들립니다.
오답의 원인이 이 챕터가 아니라 **더 아래의 중학 개념**에 있다고 판단되면,
gapConcept에 그 개념 이름을 쓰고, gapPatch에 그 개념을 **처음 배우는 사람 기준으로 다시**
설명하세요. **4~7문장, 구체적인 숫자 예시를 반드시 하나 포함.**
"이건 중학교 때 배운 거예요" 같은 말은 절대 쓰지 마세요 — 기억 못 하는 게 당연하다는 태도로.
아래가 튼튼하면 gapConcept은 null입니다. 억지로 만들지 마세요.

## 수식은 유니코드로 (x², √2, ≠ 등). LaTeX 금지.

## 순수 JSON만 출력
{"correct": true 또는 false,
 "partial": true 또는 false,
 "feedback": "피드백 본문. 위 원칙대로. 맞았으면 250~400자, 틀렸으면 올바른 풀이까지 담아 450~700자",
 "gapConcept": "흔들리는 중학 개념 이름" 또는 null,
 "gapPatch": "그 개념을 처음 배우는 사람 기준으로 다시 설명 (4~7문장, 숫자 예시 포함)" 또는 null}`;

  const input = `## 챕터
[${chapter.unit}] ${chapter.title}

## 문제
${problem.question}

## 정답
${problem.answer}

## 이 문제에 심어둔 함정
${problem.trap || '(없음)'}

## 틀릴 경우 의심할 선수 개념
${problem.prereq || '(미지정)'}

## 학습자의 답
${String(userAnswer).slice(0, 1500)}
${history?.length ? `\n## 이 챕터에서 앞서 주고받은 내용\n${history.slice(-4).map(t => `${t.role === 'user' ? '학습자' : '클로이'}: ${String(t.content).slice(0, 200)}`).join('\n')}` : ''}`;

  const result = await ai.models.generateContent({
    model: MODEL_ID,
    contents: [{ role: 'user', parts: [{ text: input }] }],
    config: {
      systemInstruction: systemPrompt, temperature: 0.4,
      responseMimeType: 'application/json', maxOutputTokens: 4096,
    },
  });
  const p = safeJson(result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || '');
  if (!p || typeof p.correct !== 'boolean') {
    return { parseError: true, feedback: '채점 중 문제가 생겼어요. 다시 제출해 주세요.' };
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
// 💾 진도 · 레슨 · 카드 · XP
// ═══════════════════════════════════════════════════

export async function getProfile() {
  const pool = getPool(); if (!pool) return null;
  await ensureMathTables();
  const r = await pool.query(`SELECT * FROM math_profile WHERE id=1`);
  return r.rows[0] || null;
}

export async function setChapterIndex(idx) {
  const pool = getPool(); if (!pool) return;
  await ensureMathTables();
  await pool.query(`UPDATE math_profile SET chapter_index=$1 WHERE id=1`,
    [Math.max(0, Math.min(CHAPTERS.length - 1, Number(idx) || 0))]);
}

export async function getOpenLesson() {
  const pool = getPool(); if (!pool) return null;
  await ensureMathTables();
  const r = await pool.query(`SELECT * FROM math_lessons WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0] || null;
}

export async function createLesson(chapter, gen) {
  const pool = getPool(); if (!pool) return null;
  const id = `ml_${chapter.no}_${Date.now()}`;
  await pool.query(
    `INSERT INTO math_lessons
       (id, chapter_no, unit, title, intro, warmup, concept, walkthrough, problems, summary, formulas, aside)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [id, chapter.no, chapter.unit, chapter.title, gen.intro,
     JSON.stringify(gen.warmup || []), gen.concept,
     JSON.stringify(gen.walkthrough || {}), JSON.stringify(gen.problems),
     JSON.stringify(gen.summary || []), JSON.stringify(gen.formulas || []), gen.aside || '']
  );
  const r = await pool.query(`SELECT * FROM math_lessons WHERE id=$1`, [id]);
  return r.rows[0];
}

export async function advanceStep(lessonId, step, turn) {
  const pool = getPool(); if (!pool) return;
  if (turn) {
    await pool.query(
      `UPDATE math_lessons SET step=$1, turns = turns || $2::jsonb WHERE id=$3`,
      [step, JSON.stringify([turn]), lessonId]
    );
  } else {
    await pool.query(`UPDATE math_lessons SET step=$1 WHERE id=$2`, [step, lessonId]);
  }
}

export async function completeLesson(lessonId) {
  const pool = getPool(); if (!pool) return;
  await pool.query(`UPDATE math_lessons SET status='done', done_at=NOW() WHERE id=$1`, [lessonId]);
  await pool.query(`UPDATE math_profile SET chapter_index = chapter_index + 1 WHERE id=1`);
}

export async function recordGap(chapterNo, concept, detail) {
  const pool = getPool(); if (!pool || !concept) return;
  await pool.query(
    `INSERT INTO math_gaps (chapter_no, concept, detail) VALUES ($1,$2,$3)`,
    [chapterNo, String(concept).slice(0, 120), String(detail || '').slice(0, 600)]
  ).catch(() => {});
}

export async function getGaps(limit = 10) {
  const pool = getPool(); if (!pool) return [];
  await ensureMathTables();
  const r = await pool.query(
    `SELECT concept, COUNT(*)::int AS times, MAX(created_at) AS last_at
     FROM math_gaps WHERE resolved = FALSE
     GROUP BY concept ORDER BY times DESC, last_at DESC LIMIT $1`, [limit]
  );
  return r.rows;
}

export async function addFormulaCards(formulas, chapterNo) {
  const pool = getPool(); if (!pool || !formulas?.length) return 0;
  let n = 0;
  for (const f of formulas) {
    if (!f?.title) continue;
    const id = `mc_${chapterNo}_${Buffer.from(String(f.title)).toString('base64url').slice(0, 32)}`;
    try {
      const r = await pool.query(
        `INSERT INTO math_cards (id, title, body, note, chapter_no) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO NOTHING`,
        [id, f.title, f.body || '', f.note || '', chapterNo]
      );
      if (r.rowCount > 0) n++;
    } catch { /* skip */ }
  }
  return n;
}

export async function getDueCards(limit = 10) {
  const pool = getPool(); if (!pool) return [];
  await ensureMathTables();
  const r = await pool.query(
    `SELECT id, title, body, note, chapter_no, ease, interval_days, repetitions, lapses
     FROM math_cards WHERE due_at <= NOW() ORDER BY due_at ASC LIMIT $1`, [limit]
  );
  return r.rows;
}

export async function reviewCard(cardId, quality) {
  const pool = getPool(); if (!pool) return null;
  const cur = await pool.query(`SELECT * FROM math_cards WHERE id=$1`, [cardId]);
  const card = cur.rows[0];
  if (!card) return null;
  const next = sm2(card, Number(quality));
  await pool.query(
    `UPDATE math_cards SET ease=$1, interval_days=$2, repetitions=$3, lapses=$4,
       due_at = NOW() + ($5 || ' days')::interval, last_result=$6 WHERE id=$7`,
    [next.ease, next.interval_days, next.repetitions, next.lapses,
     String(next.interval_days), quality < 2 ? 'fail' : 'pass', cardId]
  );
  return { ...next, title: card.title };
}

export async function grantXp(amount, reason, ref = null) {
  const pool = getPool(); if (!pool || amount <= 0) return 0;
  await ensureMathTables();
  try {
    const r = await pool.query(
      `INSERT INTO math_xp (amount, reason, ref) VALUES ($1,$2,$3)
       ON CONFLICT (ref) DO NOTHING RETURNING amount`, [amount, reason, ref]);
    return r.rows[0]?.amount || 0;
  } catch { return 0; }
}

export function levelFromXp(xp) {
  const n = Math.floor((-1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 75)) / 2);
  const level = Math.max(1, n + 1);
  const cur = 75 * (level - 1) * level;
  const next = 75 * level * (level + 1);
  return { level, xp, intoLevel: xp - cur, needForNext: next - cur,
    progress: Math.min(100, Math.round(((xp - cur) / (next - cur)) * 100)) };
}

export async function getXpState() {
  const pool = getPool(); if (!pool) return levelFromXp(0);
  await ensureMathTables();
  const r = await pool.query(`SELECT COALESCE(SUM(amount),0)::int AS xp FROM math_xp`);
  return levelFromXp(r.rows[0]?.xp || 0);
}

export async function getMathStats() {
  const pool = getPool(); if (!pool) return null;
  await ensureMathTables();
  const done = await pool.query(`SELECT COUNT(*)::int AS n FROM math_lessons WHERE status='done'`);
  const cards = await pool.query(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE due_at <= NOW())::int AS due FROM math_cards`);
  const days = await pool.query(
    `SELECT COUNT(DISTINCT DATE(done_at AT TIME ZONE 'Asia/Seoul'))::int AS d
     FROM math_lessons WHERE status='done' AND done_at >= NOW() - INTERVAL '7 days'`);
  return {
    done: done.rows[0]?.n || 0,
    total: CHAPTERS.length,
    cards: cards.rows[0]?.total || 0,
    due: cards.rows[0]?.due || 0,
    activeDays7: days.rows[0]?.d || 0,
  };
}

export async function getDoneChapters() {
  const pool = getPool(); if (!pool) return [];
  await ensureMathTables();
  const r = await pool.query(`SELECT DISTINCT chapter_no FROM math_lessons WHERE status='done'`);
  return r.rows.map(x => x.chapter_no);
}
