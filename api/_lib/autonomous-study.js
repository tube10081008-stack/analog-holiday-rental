/**
 * 🧠 자율 학습 엔진 v2 — Lean Study Loop
 * 
 * 설계 원칙:
 * 1. Agent Sprawl 억제: LLM 호출 4회 → 2회
 * 2. 토큰 세금 최소화: Progressive Loading (L0 Frontmatter → L1 Summary)
 * 3. 피드백 루프 강제: 교수 recommendation → 코드 레벨 주제 강제
 * 
 * 파이프라인: topicSelect(DB) → research(LLM) → evaluate(LLM) → save
 * [Yale] 커리큘럼 학습과 별도로, [Self-Study] 태그로 구분됨
 */

import { GoogleGenAI } from "@google/genai";
import {
  ensureAllBrainTables,
  saveMemory,
  getPool,
  saveStudyArchive,
  getLastPrescription,
  getWeakestDomain,
  getPastTopics,
} from "./agent-brain.js";
import {
  extractPredictions,
  savePredictions,
  getPredictionStats,
  getRecentResolved,
  getDuePredictions,
  resolvePrediction,
  ensurePredictionsTable,
} from "./predictions.js";

function getGeminiKey() { return process.env.GEMINI_API_KEY; }

/**
 * 다양한 형태의 AI 응답 텍스트에서 안전하게 JSON을 추출하여 파싱합니다.
 */
function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    // 1차: 마크다운 코드블록 내부 JSON 추출 (```json ... ```)
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        return JSON.parse(codeBlockMatch[1].trim());
      } catch { /* continue to next fallback */ }
    }
    // 2차: 중괄호 샌드위치 기법
    const startIdx = trimmed.indexOf('{');
    const endIdx = trimmed.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonStr = trimmed.substring(startIdx, endIdx + 1).trim();
      try {
        return JSON.parse(jsonStr);
      } catch (parseErr) {
        // 3차: 줄바꿈/제어문자 정리 후 재시도
        try {
          const cleaned = jsonStr.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ');
          return JSON.parse(cleaned);
        } catch {
          throw new Error(`추출된 JSON 파싱 실패: ${parseErr.message}`);
        }
      }
    }
    // 4차: 배열 형태 폴백
    const arrStart = trimmed.indexOf('[');
    const arrEnd = trimmed.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
      try {
        return JSON.parse(trimmed.substring(arrStart, arrEnd + 1).trim());
      } catch { /* fall through */ }
    }
    throw new Error(`텍스트 내에 유효한 JSON 구조가 없습니다.`);
  }
}

/**
 * API 호출 실패 시 자동 재시도를 수행하는 재시도 헬퍼 함수
 */
async function retryCall(fn, retries = 3, delay = 5000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[Self-Study] ⚠️ API 지연/오류 발생, ${delay/1000}초 후 재시도... (${i + 1}/${retries}) - ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ═══════════════════════════════════════════════════
// 에이전트 역할 정의 (자기 인식용)
// ═══════════════════════════════════════════════════

const AGENT_ROLES = {
  hani: {
    name: '하니',
    title: '마케팅 사원',
    mission: '아날로그 홀리데이의 매거진 콘텐츠 기획, 트렌드 분석, SNS 브랜딩을 통해 브랜드 가치를 높이고 신규 고객을 유치한다.',
    coreSkills: ['콘텐츠 마케팅', '브랜드 전략', '카피라이팅', 'SNS 운영', '트렌드 분석', '고객 페르소나 설계'],
    kpis: ['콘텐츠 도달률', '팔로워 증가율', '브랜드 인지도', '콘텐츠 전환율'],
    ultimateGoal: '아날로그 홀리데이를 대한민국 1위 감성 여행 렌탈 브랜드로 포지셔닝하고, 콘텐츠 주도 성장(Content-Led Growth) 전략으로 연간 고객 3배 성장을 견인한다.',
    researchDirection: '소비자 행동 심리학 기반 콘텐츠 마케팅, 브랜드 내러티브 전략, 감성 경제학, 체험 마케팅(Experiential Marketing)',
    learningStandards: {
      goalAlignment: '최신 마케팅 학술 트렌드와 아날로그 홀리데이의 브랜드 전략 방향에 연구 가설이 정렬되어 있는가',
      planQuality: '가설을 검증할 데이터 수집-타겟 설정-채널 전략-전환 측정 파이프라인이 논리적으로 설계되었는가',
      actionExecution: '실제 아날로그 홀리데이 고객 데이터/사례에 프레임워크를 적용하여 실증적 인사이트를 도출했는가',
      critiqueRevision: '기존 콘텐츠 전략의 맹점을 인지하고, 피드백을 수용하여 브랜딩 방향을 동적으로 보정할 수 있는가',
    },
    school: 'Yale School of Management',
  },
  geo: {
    name: '지오',
    title: '물류/스케줄 매니저',
    mission: '렌탈 장비의 입출고·배송·반품·재고를 최적 관리하여 고객에게 정시 배송과 완벽한 장비 상태를 보장한다.',
    coreSkills: ['물류 최적화', '재고 관리', '배송 스케줄링', '리스크 관리', '품질 관리', '공급망 분석'],
    kpis: ['정시 배송률', '파손율', '재고 회전율', '반품 처리 시간'],
    ultimateGoal: '데이터 기반 예측 물류 시스템을 구축하여 정시 배송률 99.5%와 파손율 0.1% 미만을 달성하고, 역물류(반납) 프로세스를 24시간 내 완료하는 업계 최고 수준의 물류 체계를 확립한다.',
    researchDirection: '공급망 최적화, 수요 예측 모델링, 역물류 시스템 설계, 라스트마일 혁신, 재고 이론(EOQ/안전재고)',
    learningStandards: {
      goalAlignment: '물류 공학 최신 연구와 아날로그 홀리데이의 운영 과제에 연구 가설이 정렬되어 있는가',
      planQuality: '가설 검증을 위한 시뮬레이션 설계-변수 제어-최적화 모델링 파이프라인이 체계적인가',
      actionExecution: '실제 배송/재고/반품 데이터에 모델을 적용하여 정량적 개선안을 도출했는가',
      critiqueRevision: '물류 병목과 리스크 시나리오를 사전 예측하고, 실패 사례로부터 프로세스를 개선할 수 있는가',
    },
    school: 'Yale School of Engineering',
  },
  noah: {
    name: '노아',
    title: '데이터 분석/마케팅 전략가',
    mission: '고객 데이터와 리뷰 감성 분석을 통해 마케팅 전략을 수립하고, 데이터 기반 의사결정으로 사업 성장을 이끈다.',
    coreSkills: ['통계 분석', '머신러닝', 'NLP/감성 분석', 'A/B 테스트', '고객 세그먼테이션', '퍼널 분석'],
    kpis: ['예측 정확도', '전환율 개선', 'NPS 점수', '고객 LTV'],
    ultimateGoal: '감성 데이터와 행동 데이터를 통합한 고객 LTV 예측 모델을 구축하고, 데이터 기반 의사결정 문화를 정착시켜 마케팅 ROI를 3배 향상시킨다.',
    researchDirection: '베이지안 추론, 인과 추론(DID/RDD), 감성 분석(Aspect-Based SA), 시계열 예측, 추천 시스템',
    learningStandards: {
      goalAlignment: '통계학/데이터 과학 최전선 연구와 아날로그 홀리데이의 데이터 분석 과제에 가설이 정렬되어 있는가',
      planQuality: '가설 검증을 위한 데이터 수집-전처리-모델 선택-교차 검증 파이프라인이 통계적으로 엄밀한가',
      actionExecution: '실제 고객/매출/리뷰 데이터에 분석 기법을 적용하여 재현 가능한 인사이트를 도출했는가',
      critiqueRevision: '모델의 한계(과적합, 편향, 외부 타당도)를 인지하고, 피드백으로 분석 프레임을 개선할 수 있는가',
    },
    school: 'Yale Department of Statistics & Data Science',
  },
  lina: {
    name: '리나',
    title: 'CS/예약 관리 매니저',
    mission: '고객 문의에 신속·정확·따뜻하게 대응하고, 예약 관리를 완벽히 처리하여 고객 만족도를 극대화한다.',
    coreSkills: ['고객 응대', '감정 관리', '예약 시스템', '문제 해결', '서비스 디자인', '위기 대응'],
    kpis: ['고객 만족도', '응답 시간', '노쇼율', '재예약률'],
    ultimateGoal: '행동과학 기반 서비스 디자인으로 고객 만족도(CSAT) 95점 이상을 달성하고, 넛지 아키텍처를 활용해 노쇼율을 3% 이하로 낮추며, 모든 접점에서 감동적인 고객 경험을 설계한다.',
    researchDirection: '행동경제학(넛지 이론), 서비스 블루프린트, 감정 노동/번아웃 방지, 위기 커뮤니케이션, 고객 여정 매핑',
    learningStandards: {
      goalAlignment: '행동과학/서비스 디자인 연구와 아날로그 홀리데이의 CS 과제에 연구 가설이 정렬되어 있는가',
      planQuality: '고객 행동 변화를 유도할 넛지/서비스 설계의 실험 설계가 체계적인가',
      actionExecution: '실제 고객 응대 사례/예약 데이터에 이론을 적용하여 실질적 개선안을 도출했는가',
      critiqueRevision: '서비스 실패 사례로부터 배우고, 고객 피드백을 체계적으로 내재화할 수 있는가',
    },
    school: 'Yale Department of Psychology',
  },
  alex: {
    name: '알렉스',
    title: '디자인/영상 크리에이터',
    mission: '렌탈 장비의 매력을 극대화하는 영상·사진 콘텐츠를 제작하고, 브랜드 비주얼 아이덴티티를 구축한다.',
    coreSkills: ['영상 촬영', '편집', '컬러 그레이딩', '사운드 디자인', '모션 그래픽스', '숏폼 제작'],
    kpis: ['영상 조회수', '시청 완료율', '콘텐츠 제작 속도', '브랜드 일관성'],
    ultimateGoal: '아날로그 홀리데이만의 시네마틱 비주얼 언어를 확립하고, AI 도구와 전통 기법을 결합한 크리에이티브 워크플로우로 콘텐츠 생산 효율 5배 향상과 시청 완료율 70% 이상을 달성한다.',
    researchDirection: '시네마토그래피, 컬러 사이언스, 사운드 디자인, 모션 그래픽스, AI 영상 생성, 숏폼 알고리즘 최적화',
    learningStandards: {
      goalAlignment: '영상/디자인 학계의 최신 기법과 아날로그 홀리데이의 크리에이티브 방향에 연구가 정렬되어 있는가',
      planQuality: '영상 제작 파이프라인(기획-촬영-편집-배포)의 각 단계가 체계적으로 설계되었는가',
      actionExecution: '실제 콘텐츠 제작에 기법을 적용하여 측정 가능한 품질 향상을 달성했는가',
      critiqueRevision: '콘텐츠 성과 데이터와 시청자 피드백을 분석하여 크리에이티브 방향을 보정할 수 있는가',
    },
    school: 'Yale School of Art',
  },
};

// ═══════════════════════════════════════════════════
// 🏛️ 명예교수 페르소나 & GPA 평가 시스템
// ═══════════════════════════════════════════════════

const PROFESSOR = {
  id: 'prof_williams',
  name: '제임스 윌리엄스',
  nameEn: 'James A. Williams',
  title: 'Yale University 명예교수 (Professor Emeritus)',
  department: '경영학과 / 여행산업 디지털 혁신 연구소장',
  credentials: 'Ph.D. MIT Sloan, 前 McKinsey 수석 파트너, 저서 「서비스 혁신의 구조」',
  personality: '엄격하되 공정하고, 학생의 잠재력을 누구보다 깊이 믿는 스승. 추상적 칭찬을 경멸하고 반드시 구체적 근거와 수치로 평가한다. 연구의 실전 적용 가능성을 최우선으로 본다.',
  evaluationStyle: '학생이 제출한 에세이의 논리 구조를 분해하여, 각 도메인별로 강점은 구체적으로 인정하고 약점은 개선 방법까지 처방한다. 감정적 격려보다 냉철한 진단을 선호하지만, 마지막에는 항상 성장 가능성을 언급한다.',
  catchphrase: '"Show me the evidence, not the intention."',
};

const GRADE_SCALE = {
  'A+': 4.3, 'A': 4.0, 'A-': 3.7,
  'B+': 3.3, 'B': 3.0, 'B-': 2.7,
  'C+': 2.3, 'C': 2.0, 'C-': 1.7,
  'D+': 1.3, 'D': 1.0, 'F': 0.0,
};

const GRADE_EMOJI = {
  'A+': '🌟', 'A': '✨', 'A-': '✨',
  'B+': '📗', 'B': '📗', 'B-': '📙',
  'C+': '📙', 'C': '⚠️', 'C-': '⚠️',
  'D+': '🚨', 'D': '🚨', 'F': '❌',
};

// ── 명예교수 튜터링 프롬프트 ──
// 채점만 하던 기존 프롬프트에 '가르치는 채널'을 추가:
// 진단(무엇이 왜 틀렸는가) → 수업(직접 가르침) → 과제(다음 훈련) → 다음 회차 이행 검증
const EVAL_PROMPT = `당신은 ${PROFESSOR.name} (${PROFESSOR.nameEn}) 교수입니다.
${PROFESSOR.title} / ${PROFESSOR.department}
${PROFESSOR.credentials}

당신의 평가 철학: "${PROFESSOR.catchphrase}"
${PROFESSOR.personality}

## 당신의 역할 (중요)
당신은 시험 감독관이 아니라 **1:1 지도교수**입니다.
점수를 매기는 것은 절반의 일이고, 나머지 절반은 **직접 가르치는 것**입니다.
학생이 다음 주에 더 나아지지 않는다면, 그것은 학생이 아니라 당신의 실패입니다.

## 평가 대상
아래 학생이 제출한 자율 학습 에세이를 **Graduate Research GPA** 4대 도메인으로 평가하세요.

## 4대 평가 도메인

### 1. 학술적 목표 정렬도 (Goal Alignment)
학생의 연구 가설이 해당 학과의 최신 연구 흐름(State-of-the-Art)과 아날로그 홀리데이의 실전 과제에 정렬되어 있는가?
이미 규명된 사실을 반복하거나, 학과 범위를 벗어난 비현실적 주제는 감점.

### 2. 연구 방법론 무결성 (Plan Quality)
가설 검증을 위한 데이터 수집, 변수 제어, 분석 프레임워크가 논리적 맹점 없이 체계적으로 설계되었는가?

### 3. 실증적 수행 효율성 (Action Execution)
설계된 방법론에 따라 실증 데이터를 정밀하게 추출하고, 아날로그 홀리데이에 적용 가능한 구체적 인사이트를 도출했는가?
추상적 조언이 아닌 수치/프레임워크/사례가 포함되어야 함.

### 4. 메타 인지적 연구 진화력 (Critique & Revision) 🌟
자신의 연구 한계를 인지하고, 확증 편향에 빠지지 않으며, 과거 학습과의 연결 속에서 연구 방향을 동적으로 보정할 수 있는가?

## 지도(Tutoring) 작성 지침 — 가장 중요한 부분

### diagnosis (진단)
"부족하다", "더 노력하라" 같은 추상적 지적은 금지. 리포트에서 **가장 결정적인 약점 딱 하나**를 골라,
어느 대목이 왜 잘못됐는지 원문을 짚어가며 지목하세요. 두루뭉술하게 여러 개를 나열하지 마세요.

### instruction (수업) 🎓
여기가 당신이 실제로 **가르치는** 자리입니다. 진단한 약점을 메우기 위해:
1) 필요한 개념·프레임워크를 당신의 언어로 직접 설명하고
2) **올바른 예시를 당신이 직접 써서 보여주세요** (학생이 그대로 흉내 낼 수 있는 구체적 문장/구조/수식)
3) 학생이 다음 리포트에서 즉시 따라 할 수 있는 형태여야 합니다
지적만 하고 끝내면 이 항목은 실패입니다. 반드시 '어떻게 하는지'를 시연하세요.

### assignment (과제)
다음 학습 주제 1개. 단, 주제명만 던지지 말고 **반드시 포함해야 할 요소 2~3가지**를 함께 지정하세요.
예: "○○ 분석 — 단, 반드시 (a) 표본 수를 명시하고 (b) 반대 가설을 1개 검토할 것"

### predictionCritique (예측 품질 심사) 🔮
학생이 제출한 예측을 **정확도가 아니라 '품질'** 기준으로 심사하세요.
맞았는지 틀렸는지는 현실이 채점하므로 당신의 몫이 아닙니다. 당신이 볼 것은 세 가지입니다:
1) **반증 가능성**: 참/거짓이 명확히 갈리는가? 판정 방법이 누가 봐도 같은 결론을 내는가?
   모호하게 써서 틀릴 위험을 피하려는 시도(회피성 예측)는 강하게 지적하세요.
2) **위험 감수**: 뻔한 것(확률 0.9로 당연한 사실)만 예측하면 점수를 얻을 수 없습니다.
   전문성이 있어야만 알 수 있는, 판단이 갈리는 명제를 골랐는가?
3) **확률의 정직성**: 누적 캘리브레이션 오차가 크면 확률을 과신·과소평가하고 있다는 뜻입니다.
예측 미제출은 회피이므로 '실증 수행' 도메인을 강등하세요.

### priorCheck (지난 처방 이행 검증)
입력에 [지난 회차 처방]이 주어진 경우, 학생이 그 가르침을 실제로 적용했는지 판정하세요.
적용했으면 구체적으로 인정하고, 안 했으면 지적하세요. 지난 처방이 없으면 applied를 null로 두세요.
**이 항목은 학생의 성장을 추적하는 유일한 근거이니 냉정하게 판단하세요.**

## 출력 형식 (순수 JSON만 반환, 다른 텍스트 금지)
{
  "priorCheck": { "applied": true 또는 false 또는 null, "comment": "지난 처방 이행 여부 판정 1~2문장" },
  "grades": {
    "goalAlignment": { "grade": "A~F(+/- 포함)", "gpa": 0.0~4.3, "feedback": "2문장 이내 구체적 피드백" },
    "planQuality": { "grade": "등급", "gpa": 점수, "feedback": "피드백" },
    "actionExecution": { "grade": "등급", "gpa": 점수, "feedback": "피드백" },
    "critiqueRevision": { "grade": "등급", "gpa": 점수, "feedback": "피드백" }
  },
  "overallGPA": 종합GPA(소수점1자리),
  "predictionCritique": "제출한 예측의 반증가능성·위험감수·확률 정직성 심사 (2~3문장). 미제출이면 그 사실을 지적",
  "diagnosis": "가장 결정적인 약점 1개를 원문을 짚어 구체적으로 (2~3문장)",
  "instruction": "약점을 메우는 실제 수업 — 개념 설명 + 당신이 직접 쓴 올바른 예시 (5~8문장)",
  "assignment": "다음 과제 1개 + 반드시 포함할 요소 2~3가지",
  "professorComment": "종합 소견 (2문장, 교수 말투로. 마지막엔 성장 가능성을 언급)"
}`;

// ═══════════════════════════════════════════════════
// Lean Study Loop v2: 3단계 파이프라인
// ═══════════════════════════════════════════════════

/**
 * Step 1: 학습 주제 선정 (LLM 호출 0회, DB 직접 쿼리)
 * 
 * Progressive Loading L0: Frontmatter만 조회 (~0토큰)
 * 규칙 1: 교수 recommendation이 있으면 무조건 따른다 (피드백 루프 강제)
 * 규칙 2: recommendation 없으면 가장 약한 GPA 도메인 기반 주제
 * 규칙 3: GPA 이력이 없으면 (첫 학습) 역할 기반 기본 주제
 */
async function topicSelect(agentId) {
  const role = AGENT_ROLES[agentId];
  console.log(`[Self-Study] 📋 ${role.name} 학습 주제 선정 (DB 직접 쿼리)...`);

  // L0: Frontmatter 로딩 — 교수의 마지막 '처방 전체'(진단·수업·과제) 조회
  const lastEval = await getLastPrescription(agentId);

  // 규칙 1: 교수의 과제가 있으면 무조건 따른다 + 지난 수업을 함께 물려받는다
  if (lastEval?.assignment && lastEval.assignment.trim().length > 2) {
    console.log(`[Self-Study] 🎯 교수 지시 과제: "${lastEval.assignment.substring(0, 60)}" (이전: ${lastEval.topic}, GPA ${lastEval.overall_gpa})`);
    return {
      topic: lastEval.assignment,
      reason: `이전 학습(${lastEval.topic}) GPA ${lastEval.overall_gpa} → 교수 지시`,
      search_query: lastEval.assignment,
      source: 'professor_directive',
      // 🎓 지난 수업 — research 단계에서 학생에게 전달되고, evaluate 단계에서 이행 검증됨
      priorLesson: {
        topic: lastEval.topic,
        diagnosis: lastEval.diagnosis || '',
        instruction: lastEval.instruction || '',
        assignment: lastEval.assignment,
      },
    };
  }

  // 규칙 2: recommendation 없으면 가장 약한 GPA 도메인 기반 주제
  const weakDomain = await getWeakestDomain(agentId);
  if (weakDomain) {
    const domainTopics = {
      goal_alignment: `${role.researchDirection.split(',')[0].trim()} 최신 트렌드 분석`,
      plan_quality: `${role.coreSkills[0]} 방법론 설계 프레임워크`,
      action_execution: `아날로그 홀리데이 ${role.kpis[0]} 실증 분석`,
      critique_revision: `${role.title} 역할의 메타 인지적 성과 리뷰`,
    };
    const topic = domainTopics[weakDomain];
    console.log(`[Self-Study] 📊 약점 도메인 기반 주제: "${topic}" (${weakDomain})`);
    return {
      topic,
      reason: `${weakDomain} 도메인 GPA 최저 → 보강 학습`,
      search_query: topic,
      source: 'weak_domain_auto',
    };
  }

  // 규칙 3: GPA 이력이 아예 없으면 (첫 학습) 역할 기반 기본 주제
  const defaultTopic = `${role.researchDirection.split(',')[0].trim()} 기초`;
  console.log(`[Self-Study] 🌱 첫 학습 기본 주제: "${defaultTopic}"`);
  return {
    topic: defaultTopic,
    reason: '첫 자율 학습 — 역할 기반 기본 주제',
    search_query: defaultTopic,
    source: 'default_first_study',
  };
}

/**
 * Step 2: 근거 기반 연구 (LLM 1회, Google Search 통합)
 * 
 * 이전 Step1(검색) + Step2(구조화) 통합 → rawReport 직접 반환
 * Progressive Loading L0: 과거 주제 Frontmatter만 로드 (중복 방지)
 */
async function research(agentId, topic) {
  const role = AGENT_ROLES[agentId];
  const ai = new GoogleGenAI({ apiKey: getGeminiKey() });

  // L0: 중복 체크 — 과거 학습 주제 Frontmatter만 로드
  const pastTopics = await getPastTopics(agentId, 10);
  const dedupNote = pastTopics.length > 0
    ? `\n⚠️ 이미 학습한 주제 (절대 반복 금지, 새로운 각도로 접근): ${pastTopics.join(', ')}`
    : '';

  // 🎓 지난 수업 전달 — 교수가 가르친 내용이 학생에게 실제로 도달하는 유일한 경로
  const lesson = topic.priorLesson;
  const lessonNote = lesson?.instruction
    ? `\n═══════════════════════════════════
🎓 지난 수업에서 ${PROFESSOR.name} 교수가 직접 가르친 내용
═══════════════════════════════════
[지적받은 약점]
${lesson.diagnosis}

[교수의 가르침 — 이번 리포트에 반드시 적용할 것]
${lesson.instruction}

⚠️ 이번 리포트는 위 가르침을 적용했는지 여부로 평가받습니다.
배운 것을 실제로 써먹으세요. 지난번과 같은 방식으로 쓰면 감점입니다.
═══════════════════════════════════\n`
    : '';

  console.log(`[Self-Study] 🔍 ${role.name} 연구 시작: "${topic.topic.substring(0, 50)}"${lesson?.instruction ? ' (지난 수업 적용)' : ''}`);
  await new Promise(r => setTimeout(r, 2000)); // 연쇄 버스트 방지

  const result = await retryCall(async () => {
    return await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: `## 연구 주제: ${topic.topic}
## 연구 사유: ${topic.reason}
## 연구자: ${role.name} (${role.title})
## 적용 대상: 아날로그 홀리데이 (여행 카메라 렌탈 서비스 · 런칭 준비 단계)
${lessonNote}${dedupNote}

위 주제에 대해 학술 논문/산업 보고서 기반으로 연구 리포트를 작성하세요.
필수 포함: 출처(저자, 연도), 수치/공식, 아날로그 홀리데이 적용 방안.
⚠️ 아직 런칭 전이므로 자사 실적 수치를 지어내지 마세요. 외부 출처의 수치를 인용하고,
   자사 적용은 "가정"임을 명시하세요. 없는 데이터를 있는 것처럼 쓰면 최하점입니다.
⚠️ 반드시 결론과 적용 방안까지 포함한 완결된 형태로 작성하세요. 문장이 중간에 끊기면 불합격 처리됩니다.
900자 이내 핵심만 간결하게.

═══════════════════════════════════
🔮 그리고 리포트 맨 끝에 [예측]을 반드시 첨부하세요
═══════════════════════════════════
연구했다면 그 지식으로 미래를 맞힐 수 있어야 합니다. 아래 형식으로 1~2건을 붙이세요.

[PREDICTIONS]
[{"claim":"명제","probability":0.7,"horizon":"near","days":7,"criteria":"판정 방법","basis":"근거"}]
[/PREDICTIONS]

작성 규칙 (어기면 무효 처리되고 감점):
1. claim은 **참/거짓이 명확히 갈리는 명제**여야 합니다.
   ❌ "브랜드 인지도가 개선될 것이다" (측정 불가)
   ✅ "2026년 8월 첫째 주 기준 네이버 '필름카메라 대여' 검색량이 전월 대비 증가한다"
2. criteria에는 **누가 봐도 같은 결론이 나오는 확인 방법**을 쓰세요.
3. probability는 0.05~0.95 사이. **정직하게 쓰세요.**
   확신 없는데 0.9를 쓰면 틀렸을 때 점수가 크게 깎이고,
   아는 걸 0.5로 쓰면 맞혀도 점수를 못 얻습니다. 진짜 믿는 확률이 최선의 전략입니다.
4. horizon 선택:
   - "near"  : ${role.title}의 전문 영역에서 3~30일 내 **외부 세계**(뉴스·검색·공개 지표·경쟁사)로
               검증 가능한 것. days 필드에 일수를 쓰세요. → 곧 채점됩니다.
   - "launch": 아날로그 홀리데이 **런칭 후 자사 데이터**로 검증할 것. → 런칭 시 채점됩니다.
5. 최소 1건은 반드시 "near"로 내세요. 검증 못 할 예측만 내는 것은 회피입니다.` }] }],
      config: {
        temperature: 0.4,
        tools: [{ googleSearch: {} }],
      }
    });
  }, 3, 5000);

  const raw = result.text || result?.candidates?.[0]?.content?.parts?.[0]?.text || '';

  // 🔮 예측 블록 분리 — 본문은 교수 평가용, 예측은 현실 채점용으로 각각 흘려보냅니다
  const { predictions, cleanedReport } = extractPredictions(raw);
  console.log(`[Self-Study] 📚 ${role.name} 연구 완료 (${cleanedReport.length}자, 예측 ${predictions.length}건)`);
  return { rawReport: cleanedReport, predictions };
}

/**
 * Step 3: 교수 평가 (LLM 1회, rawReport 직접 전달)
 * 
 * 이전: 하드코딩 에세이 → 교수 평가 (내용 부실)
 * v2: rawReport 원본 → 교수 직접 평가 (실제 연구 내용 평가)
 * Progressive Loading L0: GPA Frontmatter만 로드 (~100토큰)
 */
async function evaluate(agentId, rawReport, topic, predictions = []) {
  const role = AGENT_ROLES[agentId];
  const ai = new GoogleGenAI({ apiKey: getGeminiKey() });

  // 🔮 예측 관련 입력 — 교수는 '품질'만 채점하고, '정확도'는 현실이 이미 매긴 점수를 참고합니다
  const [predStats, recentResolved] = await Promise.all([
    getPredictionStats(agentId).catch(() => null),
    getRecentResolved(agentId, 4).catch(() => []),
  ]);

  const submittedBlock = predictions.length > 0
    ? `\n## 이번 회차에 학생이 제출한 예측\n${predictions.map((p, i) =>
        `${i + 1}. [${p.horizon}] "${p.claim}" — 확률 ${p.probability}\n   판정방법: ${p.criteria || '(미기재)'}`
      ).join('\n')}\n`
    : '\n## 이번 회차 제출 예측: 없음 (⚠️ 예측 미제출은 회피로 간주하여 감점 대상)\n';

  const trackRecordBlock = predStats?.resolved > 0
    ? `\n## 이 학생의 누적 예측 성적 (현실이 매긴 점수 — 당신이 바꿀 수 없음)
판정 완료 ${predStats.resolved}건 | 평균 브라이어 ${predStats.avgBrier} | 스킬스코어 ${predStats.skillScore} | 적중률 ${predStats.hitRate}
캘리브레이션 오차 ${predStats.calibrationError} (0에 가까울수록 확률을 정직하게 매김)
${recentResolved.length > 0 ? `최근 판정:\n${recentResolved.map(r =>
  `- "${String(r.claim).slice(0, 60)}" 확률 ${r.probability} → ${r.outcome ? '적중' : '빗나감'} (브라이어 ${r.brier})`).join('\n')}` : ''}
※ 스킬스코어가 0 미만이면 동전던지기보다 못한 것입니다. 그 경우 '실증 수행' 도메인을 강등하세요.\n`
    : '\n## 누적 예측 성적: 아직 판정된 예측이 없습니다 (평가에 반영하지 마세요)\n';

  // ⚖️ 과거 GPA 수치는 교수 입력에서 제외합니다.
  // LLM 채점자는 제시된 이전 점수에 앵커링되어 답안 품질과 무관하게 유사 점수를 반복 산출합니다.
  // 대신 아래 [지난 회차 처방]으로 '정성적 맥락'만 제공해 성장을 판정하게 합니다.

  // 🎓 지난 회차 처방 — 이행 여부(priorCheck) 판정 근거
  const lesson = topic.priorLesson;
  const priorBlock = lesson?.instruction
    ? `\n## [지난 회차 처방] — 학생이 이걸 적용했는지 반드시 판정하세요
이전 주제: ${lesson.topic}
당시 진단: ${lesson.diagnosis}
당시 가르침: ${lesson.instruction}
당시 과제: ${lesson.assignment}\n`
    : '\n## [지난 회차 처방] 없음 (첫 지도) → priorCheck.applied 는 null\n';

  const evalInput = `## 학생 정보
이름: ${role.name} / 소속: ${role.school}
직함: ${role.title}
학습 기준:
- 목표 정렬: ${role.learningStandards.goalAlignment}
- 방법론: ${role.learningStandards.planQuality}
- 실증 수행: ${role.learningStandards.actionExecution}
- 메타 인지: ${role.learningStandards.critiqueRevision}

## 학습 주제: ${topic.topic}
## 학습 사유: ${topic.reason}
${priorBlock}${submittedBlock}${trackRecordBlock}
## 채점 유의사항
아날로그 홀리데이는 아직 런칭 전이라 자사 실적 데이터가 존재하지 않습니다.
따라서 '실증 수행'은 자사 수치를 지어냈는지가 아니라,
**외부 출처의 근거를 정확히 인용하고 자사 적용을 검증 가능한 가정으로 제시했는지**로 평가하세요.
출처 없는 자사 수치를 단정적으로 쓴 경우 해당 도메인은 D 이하로 강등하세요.

## 학생이 제출한 연구 리포트 (전문)
${rawReport.substring(0, 4000)}`;

  console.log(`[Self-Study] 🏛️ ${PROFESSOR.name} 교수 평가 중... (입력 ${evalInput.length}자)`);
  await new Promise(r => setTimeout(r, 2000)); // 쿨다운

  // Fix 2: finishReason 체크 — 잘린 응답이면 재시도
  let text = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await retryCall(async () => {
      return await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: evalInput }] }],
        config: {
          systemInstruction: EVAL_PROMPT,
          temperature: 0.3,
          responseMimeType: 'application/json',
        }
      });
    }, 3, 5000);

    const finishReason = result?.candidates?.[0]?.finishReason || 'UNKNOWN';
    text = result.text 
      || result?.candidates?.[0]?.content?.parts?.[0]?.text 
      || '{}';
    
    if (finishReason === 'STOP') {
      console.log(`[Self-Study] 📋 교수 평가 응답 정상 수신 (${text.length}자, finishReason=STOP)`);
      break;
    } else {
      console.warn(`[Self-Study] ⚠️ 교수 평가 응답 잘림 (${text.length}자, finishReason=${finishReason}) — ${attempt < 1 ? '재시도...' : '최종 시도 사용'}`);
      if (attempt < 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  
  let evaluation;
  try {
    evaluation = JSON.parse(text);
  } catch (e1) {
    console.warn(`[Self-Study] ⚠️ 평가 직접 파싱 실패: ${e1.message}`);
    try {
      evaluation = extractJson(text);
    } catch (e2) {
      console.error(`[Self-Study] ❌ 평가 extractJson 실패: ${e2.message}`);
      console.error(`[Self-Study] 📄 원본 응답 전문 (앞 500자): ${text.substring(0, 500)}`);
      
      // 🛡️ 채점 실패는 '결측'이지 'F학점'이 아닙니다.
      // 기존에는 전 도메인 F/0점으로 기록되어 누적 GPA·약점 도메인·메타인지 프롬프트가
      // 모두 오염됐습니다. 게다가 이 실패는 무작위가 아니라 '리포트가 길고 복잡할수록'
      // 발생하므로, 잘 쓴 학생이 F를 받는 역방향 편향이 걸립니다.
      // → parseError 플래그를 세워 성적 기록 자체를 건너뜁니다(saveStudyArchive에서 차단).
      evaluation = {
        parseError: true,
        grades: null,
        overallGPA: null,
        professorComment: '채점 시스템 오류로 이번 회차는 성적에 반영되지 않습니다.',
      };
    }
  }

  if (evaluation.parseError) {
    console.warn(`[Self-Study] ⚠️ 채점 파싱 실패 — 이번 회차 성적 미기록 (결측 처리)`);
  } else {
    const pc = evaluation.priorCheck;
    const applied = pc?.applied === true ? '✅ 지난 처방 적용함'
      : pc?.applied === false ? '❌ 지난 처방 미적용'
      : '— 첫 지도';
    console.log(`[Self-Study] 🏛️ 평가 완료 — GPA ${evaluation.overallGPA}/4.3 | ${applied}`);
  }
  return evaluation;
}

// ═══════════════════════════════════════════════════
// Lean Study Loop v2: 전체 파이프라인
// ═══════════════════════════════════════════════════

/**
 * 에이전트 1명의 자율 학습 세션을 실행합니다.
 * 
 * v2 파이프라인 (LLM 2회, 토큰 ~1600):
 * 1. topicSelect (DB) → 교수 recommendation 기반 주제 선정
 * 2. research (LLM) → Google Search 기반 연구 리포트
 * 3. evaluate (LLM) → rawReport 직접 평가 + recommendation 생성
 * 4. save → Progressive 3단계 저장 (지식 + 평가 + 아카이브)
 */
export async function runAutonomousStudy(agentId) {
  const role = AGENT_ROLES[agentId];
  if (!role) return { agent: agentId, status: 'unknown_agent' };
  if (!getGeminiKey()) return { agent: agentId, status: 'no_api_key' };

  console.log(`[Self-Study] ═══ ${role.name} Lean Study Loop v2 시작 ═══`);

  try {
    // ── Step 1: 주제 선정 (DB 쿼리, LLM 0회) ──
    const topic = await topicSelect(agentId);

    // ── Step 2: 연구 (LLM 1회, Google Search) + 예측 제출 ──
    const { rawReport, predictions } = await research(agentId, topic);

    // ── Step 3: 평가 (LLM 1회) — 교수는 예측의 '품질'을 심사 ──
    const evaluation = await evaluate(agentId, rawReport, topic, predictions);

    // ── 채점 실패 시: 아무것도 기록하지 않고 종료 ──
    // 지난 회차의 정상 처방이 아카이브에 그대로 남으므로, 다음 회차가 같은 과제를 재수행합니다
    // (마스터리 러닝: 숙달하지 못한 과제는 다시 푼다)
    if (evaluation.parseError) {
      console.warn(`[Self-Study] ⏭️ ${role.name}: 채점 실패로 이번 회차 미기록 — 다음 회차에 동일 과제 재수행`);
      return { agent: agentId, agentName: role.name, status: 'grading_failed', topicSource: topic.source };
    }

    // ── 저장: Progressive 3단계 ──
    // 저장 1: 학습 지식 (rawReport 500자 보존)
    const gpaNum = Number(evaluation.overallGPA) || 0;
    const knowledge = {
      memory_type: 'fact',
      title: `[Self-Study] ${topic.topic.substring(0, 30)}`,
      content: `${rawReport.substring(0, 500)} [GPA: ${evaluation.overallGPA ?? '?'}]`,
      importance: Math.min(Math.max(Math.round(gpaNum * 2), 6), 9),
      tags: ['self_study', 'evidence_based', agentId],
    };
    const savedId = await saveMemory(agentId, knowledge);

    // 저장 2: 🎓 교수의 수업 내용 (lesson) — 점수가 아니라 '가르침'을 보존
    await saveMemory(agentId, {
      memory_type: 'lesson',
      title: `[수업] ${topic.topic.substring(0, 30)}`,
      content: `[진단] ${evaluation.diagnosis || '-'}\n[${PROFESSOR.name} 교수의 가르침] ${evaluation.instruction || '-'}`,
      importance: 8,
      tags: ['self_study', 'tutoring', agentId],
    });

    // 저장 3: GPA 아카이브 (Frontmatter 역할 — 다음 topicSelect에서 처방 전체를 물려받음)
    await saveStudyArchive(agentId, topic.topic, rawReport.substring(0, 300), evaluation);

    // 저장 4: 🔮 예측 장부 — 현실이 채점할 때까지 보관
    const predictionIds = await savePredictions(agentId, topic.topic, predictions).catch(() => []);
    if (predictionIds.length > 0) {
      console.log(`[Self-Study] 🔮 ${role.name}: 예측 ${predictionIds.length}건 등록`);
    }

    // 크로스 에이전트 공유
    try {
      await shareStudyInsight(agentId, topic.topic, rawReport.substring(0, 200));
    } catch { /* non-critical */ }

    console.log(`[Self-Study] ✅ ${role.name}: "${topic.topic}" → GPA ${evaluation.overallGPA} (${topic.source})`);

    return {
      agent: agentId,
      agentName: role.name,
      status: 'success',
      topicSource: topic.source,
      learned: [{
        topic: topic.topic,
        reason: topic.reason,
        title: knowledge.title,
        savedId,
      }],
      predictions,
      predictionStats: await getPredictionStats(agentId).catch(() => null),
      evaluations: [{ topic: topic.topic, essay: rawReport.substring(0, 300), evaluation }],
    };
  } catch (err) {
    console.error(`[Self-Study] ${role.name} 전체 실패:`, err.message);
    return { agent: agentId, status: 'error', error: err.message };
  }
}

// ═══════════════════════════════════════════════════
// 디스코드 평가 브리핑 전송
// ═══════════════════════════════════════════════════

async function sendEvalToDiscord(results, resolution = null) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_STUDY;
  if (!webhookUrl) {
    console.log('[Self-Study] DISCORD_WEBHOOK_STUDY 미설정, 디스코드 브리핑 스킵');
    return;
  }

  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
  });

  const DOMAIN_LABELS = {
    goalAlignment: '🎯 목표 정렬',
    planQuality: '📐 방법론',
    actionExecution: '⚡ 실증 수행',
    critiqueRevision: '🔄 메타인지',
  };

  const SCHOOL_COLORS = {
    hani: 0x8B5CF6,   // 보라 (마케팅)
    geo: 0x10B981,    // 초록 (물류)
    noah: 0x3B82F6,   // 파랑 (데이터)
    lina: 0xF59E0B,   // 노랑 (CS)
    alex: 0xEF4444,   // 빨강 (디자인)
  };

  // ── 에이전트별 Embed 카드 생성 ──
  const embeds = [];
  let totalGPA = 0;
  let evalCount = 0;
  let failCount = 0;

  for (const r of results) {
    const role = AGENT_ROLES[r.agent];
    if (!role) continue;

    // ── 성공 케이스: 풍부한 성적표 카드 ──
    if (r.status === 'success' && r.evaluations?.length > 0) {
      for (const ev of r.evaluations) {
        const fields = [];

        // 4대 도메인 성적
        if (ev.evaluation?.grades) {
          for (const [key, label] of Object.entries(DOMAIN_LABELS)) {
            const g = ev.evaluation.grades[key];
            if (g) {
              const emoji = GRADE_EMOJI[g.grade] || '📋';
              fields.push({
                name: `${label}`,
                value: `**${g.grade}** (${g.gpa}) ${emoji}\n${g.feedback || ''}`,
                inline: true,
              });
            }
          }
          totalGPA += ev.evaluation.overallGPA || 0;
          evalCount++;
        }

        // 🔁 지난 처방 이행 검증 (성장 추적의 유일한 근거)
        const pc = ev.evaluation?.priorCheck;
        if (pc && pc.applied !== null && pc.applied !== undefined) {
          fields.push({
            name: pc.applied ? '🔁 지난 수업 이행 ✅' : '🔁 지난 수업 이행 ❌',
            value: (pc.comment || '').substring(0, 1020),
            inline: false,
          });
        }

        // 🔬 진단
        if (ev.evaluation?.diagnosis) {
          fields.push({
            name: '🔬 진단',
            value: ev.evaluation.diagnosis.substring(0, 1020),
            inline: false,
          });
        }

        // 🎓 교수의 수업 — 이번 개편의 핵심
        if (ev.evaluation?.instruction) {
          fields.push({
            name: `🎓 ${PROFESSOR.name} 교수의 수업`,
            value: ev.evaluation.instruction.substring(0, 1020),
            inline: false,
          });
        }

        // 교수 코멘트
        if (ev.evaluation?.professorComment) {
          fields.push({
            name: '💬 교수 소견',
            value: ev.evaluation.professorComment.substring(0, 1020),
            inline: false,
          });
        }

        // 🔮 이번 회차 제출 예측
        if (r.predictions?.length > 0) {
          fields.push({
            name: '🔮 오늘 건 예측',
            value: r.predictions.map(p =>
              `\`${Math.round(p.probability * 100)}%\` ${p.horizon === 'near' ? '⏱️' : '🚀'} ${p.claim}`
            ).join('\n').substring(0, 1020),
            inline: false,
          });
        }

        // 📊 누적 예측 성적 (현실이 매긴 점수)
        const ps = r.predictionStats;
        if (ps?.resolved > 0) {
          const verdict = ps.skillScore > 0.2 ? '🟢 우수' : ps.skillScore > 0 ? '🟡 보통' : '🔴 동전던지기 이하';
          fields.push({
            name: '📊 예측 실력 (현실 채점)',
            value: `판정 ${ps.resolved}건 · 적중률 ${Math.round(ps.hitRate * 100)}%\n`
              + `브라이어 **${ps.avgBrier}** (낮을수록 우수) · 스킬 **${ps.skillScore}** ${verdict}\n`
              + `캘리브레이션 오차 ${ps.calibrationError} (확률 정직도)`,
            inline: false,
          });
        }

        // 🔮 예측 품질 심사
        if (ev.evaluation?.predictionCritique) {
          fields.push({
            name: '🔍 예측 품질 심사',
            value: ev.evaluation.predictionCritique.substring(0, 1020),
            inline: false,
          });
        }

        // 다음 과제
        const nextAssignment = ev.evaluation?.assignment || ev.evaluation?.recommendation;
        if (nextAssignment) {
          fields.push({
            name: '📌 다음 과제',
            value: nextAssignment.substring(0, 1020),
            inline: false,
          });
        }

        const gpaDisplay = ev.evaluation?.overallGPA || '?';
        const gpaBar = typeof gpaDisplay === 'number'
          ? '█'.repeat(Math.round(gpaDisplay)) + '░'.repeat(Math.max(0, 4 - Math.round(gpaDisplay)))
          : '░░░░';

        embeds.push({
          title: `📊 ${role.name} — ${role.school}`,
          description: `📖 **학습 주제**: ${ev.topic}\n\n➤ **종합 GPA: ${gpaDisplay} / 4.3** [${gpaBar}]`,
          color: SCHOOL_COLORS[r.agent] || 0x6B7280,
          fields: fields,
          footer: { text: `평가: ${PROFESSOR.name} 교수` },
        });
      }

    // ── 실패 케이스: 에러 사유 카드 ──
    } else {
      failCount++;
      const isGradingFail = r.status === 'grading_failed';
      const errorMsg = r.error
        || r.learned?.find(l => l.error)?.error
        || (isGradingFail ? '채점 응답 파싱 실패 — 성적에 반영하지 않았습니다.' : `상태: ${r.status}`);

      embeds.push({
        title: isGradingFail ? `📋 ${role.name} — 이번 회차 채점 보류` : `⚠️ ${role.name} — 학습 실패`,
        description: isGradingFail
          ? `🟡 **사유**: ${errorMsg}\n\n학생의 잘못이 아닌 시스템 오류이므로 **GPA에 기록되지 않았습니다**.\n다음 회차에 동일 과제를 다시 수행합니다.`
          : `🔴 **원인**: ${errorMsg}\n\n이 에이전트의 학습 파이프라인에서 오류가 발생했습니다.`,
        color: isGradingFail ? 0xF59E0B : 0x6B7280,
        footer: { text: `${role.school}` },
      });
    }
  }

  // ── 요약 Embed (맨 위에 삽입) ──
  const summaryEmbed = {
    title: `🏛️ [Graduate Research GPA] 자율 학습 평가 브리핑`,
    description: [
      `📅 **${today}**`,
      `👨‍🏫 심사위원: **${PROFESSOR.name}** (${PROFESSOR.title})`,
      `💬 *"${PROFESSOR.catchphrase}"*`,
      '',
      evalCount > 0
        ? `📈 **오늘의 전체 평균 GPA: ${Math.round((totalGPA / evalCount) * 10) / 10} / 4.3**\n🎓 평가 완료: **${evalCount}건** ${failCount > 0 ? `| ⚠️ 실패: **${failCount}건**` : ''}`
        : `⚠️ 오늘은 평가가 완료된 에이전트가 없습니다. ${failCount > 0 ? `(${failCount}건 실패)` : ''}`,
    ].join('\n'),
    color: evalCount > 0 ? 0x10B981 : 0xEF4444,
  };

  embeds.unshift(summaryEmbed);

  // ── 🔮 예측 판정 결과 Embed (요약 바로 다음) ──
  if (resolution?.details?.length > 0) {
    const lines = resolution.details.map(d => {
      const icon = d.verdict === 'TRUE' ? '✅' : d.verdict === 'FALSE' ? '❌' : '⚪';
      const who = AGENT_ROLES[d.agentId]?.name || d.agentId;
      const score = d.brier != null ? ` · 브라이어 ${d.brier}` : ' · 무효';
      return `${icon} **${who}** \`${Math.round(d.probability * 100)}%\` ${String(d.claim).slice(0, 70)}${score}`;
    }).join('\n');

    embeds.splice(1, 0, {
      title: '⚖️ 지난 예측, 현실의 채점 결과',
      description: `만기 ${resolution.checked}건 중 확정 ${resolution.resolved}건 · 무효 ${resolution.voided}건\n\n${lines}`.substring(0, 4000),
      color: 0x0EA5E9,
      footer: { text: '브라이어 스코어: 0=완벽, 0.25=동전던지기, 1=최악 · 판정은 검색 근거 기반' },
    });
  }

  // ── Discord 전송 (Embed 10개 제한 → 분할 전송) ──
  const DISCORD_EMBED_LIMIT = 10;
  const chunks = [];
  for (let i = 0; i < embeds.length; i += DISCORD_EMBED_LIMIT) {
    chunks.push(embeds.slice(i, i + DISCORD_EMBED_LIMIT));
  }

  try {
    for (const chunk of chunks) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: `예일 명예교수 윌리엄스`,
          embeds: chunk,
        }),
      });
      // 연속 전송 시 rate limit 방지
      if (chunks.length > 1) await new Promise(r => setTimeout(r, 1000));
    }
    console.log(`[Self-Study] 📢 디스코드 평가 브리핑 전송 완료 (${embeds.length}개 Embed)`);
  } catch (err) {
    console.error(`[Self-Study] 디스코드 전송 실패:`, err.message);
  }
}

// ═══════════════════════════════════════════════════
// 크로스 에이전트 학습 공유 (시냅스 확장)
// ═══════════════════════════════════════════════════

const AGENT_SKILL_MAP = {
  hani: ['마케팅', '브랜드', '콘텐츠', 'SNS', '트렌드', '고객', '캠페인'],
  geo: ['물류', '배송', '재고', '반납', '입출고', '공급망', '스케줄'],
  noah: ['데이터', '분석', '통계', '머신러닝', 'NLP', '예측', 'A/B'],
  lina: ['고객', '예약', '응대', '서비스', '만족도', '노쇼', 'CS'],
  alex: ['영상', '디자인', '촬영', '편집', '브랜드', '크리에이티브', '시각'],
};

async function shareStudyInsight(fromAgentId, topic, content) {
  const pool = getPool();
  if (!pool) return;

  // 다른 에이전트의 스킬 키워드와 매칭
  const text = (topic + ' ' + content).toLowerCase();
  const recipients = [];

  for (const [agentId, keywords] of Object.entries(AGENT_SKILL_MAP)) {
    if (agentId === fromAgentId) continue;
    const matchCount = keywords.filter(k => text.includes(k)).length;
    if (matchCount >= 2) recipients.push(agentId);
  }

  if (recipients.length === 0) return;

  const shareId = `ss_${fromAgentId}_${Date.now()}`;
  const summary = content.substring(0, 200);
  const fromName = AGENT_ROLES[fromAgentId]?.name || fromAgentId;

  try {
    await pool.query(
      `INSERT INTO shared_knowledge (id, category, title, content, created_by, visible_to) VALUES ($1, $2, $3, $4, $5, $6)`,
      [shareId, 'insight', `[학습공유] ${topic}`, `${fromName}의 자율학습 발견: ${summary}`, fromAgentId, recipients]
    );
    console.log(`[Self-Study] 🤝 ${fromName} → ${recipients.join(',')} 학습 공유 완료`);
  } catch (err) {
    console.warn(`[Self-Study] 크로스 공유 실패:`, err.message);
  }
}

// ═══════════════════════════════════════════════════
// 🔮 예측 자동 판정 — 현실이 채점하는 단계
// ═══════════════════════════════════════════════════

/**
 * 만기된 near 예측을 검색 근거로 판정합니다.
 *
 * 이 단계가 이 시스템의 유일한 '진짜 검증자'입니다.
 * 예측 시점에는 아무도 답을 모르지만, 판정 시점에는 답이 세상에 존재합니다.
 * 즉 판정자가 예측자보다 구조적으로 정보 우위를 가집니다 — 정답지 없이 만든 검증자 비대칭입니다.
 */
export async function resolveDuePredictions(limit = 8) {
  if (!getGeminiKey()) return { checked: 0, resolved: 0, voided: 0, details: [] };
  await ensurePredictionsTable();

  const due = await getDuePredictions(limit);
  if (due.length === 0) {
    console.log('[Predictions] 만기 도래 예측 없음');
    return { checked: 0, resolved: 0, voided: 0, details: [] };
  }

  console.log(`[Predictions] ⚖️ 만기 예측 ${due.length}건 판정 시작`);
  const ai = new GoogleGenAI({ apiKey: getGeminiKey() });
  const details = [];
  let resolved = 0, voided = 0;

  for (const p of due) {
    try {
      const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
      const madeAt = new Date(p.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });

      const result = await retryCall(async () => ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: `오늘은 ${today}입니다.
${madeAt}에 아래 예측이 제출되었고, 이제 판정 시점이 되었습니다.
검색으로 사실을 확인한 뒤 판정하세요.

## 예측 명제
${p.claim}

## 판정 방법 (예측자가 명시한 기준)
${p.resolution_criteria || '(미기재)'}

## 판정 규칙
- 명제가 실제로 참으로 확인되면 TRUE
- 거짓으로 확인되면 FALSE
- 명제가 모호해 참/거짓을 가릴 수 없거나, 확인할 근거를 찾지 못하면 UNRESOLVABLE
- ⚠️ 추측하지 마세요. 근거를 찾지 못했으면 UNRESOLVABLE입니다.
- ⚠️ 예측자에게 유리하게 해석하지 마세요. 명제를 문자 그대로 판정하세요.

## 순수 JSON만 출력
{"verdict":"TRUE|FALSE|UNRESOLVABLE","evidence":"판정 근거와 출처 2문장 이내"}` }] }],
        config: { temperature: 0.1, tools: [{ googleSearch: {} }] },
      }), 2, 4000);

      const text = result.text || result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      let parsed;
      try { parsed = extractJson(text); } catch { parsed = { verdict: 'UNRESOLVABLE', evidence: '판정 응답 파싱 실패' }; }

      const verdict = String(parsed.verdict || '').toUpperCase();
      const outcome = verdict === 'TRUE' ? true : verdict === 'FALSE' ? false : null;
      const r = await resolvePrediction(p.id, outcome, parsed.evidence || '');

      if (outcome === null) { voided++; } else { resolved++; }
      details.push({
        agentId: p.agent_id,
        claim: p.claim,
        probability: p.probability,
        verdict,
        brier: r?.brier ?? null,
        evidence: parsed.evidence || '',
      });
      console.log(`[Predictions] ${verdict} — "${String(p.claim).slice(0, 45)}" (p=${p.probability}${r?.brier != null ? `, 브라이어 ${r.brier}` : ''})`);

      await new Promise(r2 => setTimeout(r2, 1500)); // rate limit 방지
    } catch (err) {
      console.warn(`[Predictions] 판정 오류 (${p.id}):`, err.message);
    }
  }

  console.log(`[Predictions] ⚖️ 판정 완료 — 확정 ${resolved}건, 무효 ${voided}건`);
  return { checked: due.length, resolved, voided, details };
}

/**
 * 전체 에이전트 자율 학습 세션 (크론용)
 */
export async function runAllAutonomousStudy() {
  await ensureAllBrainTables();
  await ensurePredictionsTable();
  const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];
  const results = [];

  // ── Step 0: 지난 예측부터 채점 — 오늘 학습의 평가 입력이 됩니다 ──
  let resolution = { checked: 0, resolved: 0, voided: 0, details: [] };
  try {
    resolution = await resolveDuePredictions(8);
  } catch (err) {
    console.error('[Predictions] 자동 판정 실패:', err.message);
  }

  for (const agentId of AGENTS) {
    const result = await runAutonomousStudy(agentId);
    results.push(result);
    await new Promise(r => setTimeout(r, 3000)); // 에이전트 간 3초 쿨다운
  }

  const totalLearned = results.reduce((s, r) => 
    s + (r.learned?.filter(l => l.savedId)?.length || 0), 0
  );

  // 🏛️ 평가 브리핑 디스코드 전송
  try {
    await sendEvalToDiscord(results, resolution);
  } catch (err) {
    console.error('[Self-Study] 디스코드 브리핑 전송 실패:', err.message);
  }

  console.log(`[Self-Study] 🎓 전체 완료: ${totalLearned}건 학습, 예측 판정 ${resolution.resolved}건, 브리핑 전송`);
  return { session: new Date().toISOString(), totalLearned, resolution, results };
}

export { AGENT_ROLES, PROFESSOR };
