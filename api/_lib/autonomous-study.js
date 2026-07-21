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
  getGPAHistory,
  getLastRecommendation,
  getWeakestDomain,
  getPastTopics,
} from "./agent-brain.js";

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

// ── 명예교수 평가 프롬프트 ──
const EVAL_PROMPT = `당신은 ${PROFESSOR.name} (${PROFESSOR.nameEn}) 교수입니다.
${PROFESSOR.title} / ${PROFESSOR.department}
${PROFESSOR.credentials}

당신의 평가 철학: "${PROFESSOR.catchphrase}"
${PROFESSOR.personality}

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

## 출력 형식 (순수 JSON만 반환, 다른 텍스트 금지)
{
  "grades": {
    "goalAlignment": { "grade": "A~F(+/- 포함)", "gpa": 0.0~4.3, "feedback": "2문장 이내 구체적 피드백" },
    "planQuality": { "grade": "등급", "gpa": 점수, "feedback": "피드백" },
    "actionExecution": { "grade": "등급", "gpa": 점수, "feedback": "피드백" },
    "critiqueRevision": { "grade": "등급", "gpa": 점수, "feedback": "피드백" }
  },
  "overallGPA": 종합GPA(소수점1자리),
  "professorComment": "윌리엄스 교수의 종합 소견 (3문장, 교수 말투로)",
  "recommendation": "다음 학습에서 반드시 다뤄야 할 구체적 주제 1개"
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

  // L0: Frontmatter 로딩 — 교수의 마지막 recommendation 조회
  const lastEval = await getLastRecommendation(agentId);
  
  // 규칙 1: 교수 recommendation이 있으면 무조건 따른다
  if (lastEval?.recommendation && lastEval.recommendation.trim().length > 2) {
    console.log(`[Self-Study] 🎯 교수 지시 주제: "${lastEval.recommendation}" (이전: ${lastEval.topic}, GPA ${lastEval.overall_gpa})`);
    return {
      topic: lastEval.recommendation,
      reason: `이전 학습(${lastEval.topic}) GPA ${lastEval.overall_gpa} → 교수 지시`,
      search_query: lastEval.recommendation,
      source: 'professor_directive',
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

  console.log(`[Self-Study] 🔍 ${role.name} 연구 시작: "${topic.topic}"`);
  await new Promise(r => setTimeout(r, 2000)); // 연쇄 버스트 방지

  const result = await retryCall(async () => {
    return await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: `## 연구 주제: ${topic.topic}
## 연구 사유: ${topic.reason}
## 연구자: ${role.name} (${role.title})
## 적용 대상: 아날로그 홀리데이 (여행 카메라 렌탈 서비스)
${dedupNote}

위 주제에 대해 학술 논문/산업 보고서 기반으로 연구 리포트를 작성하세요.
필수 포함: 출처(저자, 연도), 수치/공식, 아날로그 홀리데이 적용 방안.
⚠️ 반드시 결론과 적용 방안까지 포함한 완결된 형태로 작성하세요. 문장이 중간에 끊기면 불합격 처리됩니다.
600자 이내 핵심만 간결하게.` }] }],
      config: {
        temperature: 0.4,
        tools: [{ googleSearch: {} }],
      }
    });
  }, 3, 5000);

  const rawReport = result.text || result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log(`[Self-Study] 📚 ${role.name} 연구 완료 (${rawReport.length}자)`);
  return rawReport;
}

/**
 * Step 3: 교수 평가 (LLM 1회, rawReport 직접 전달)
 * 
 * 이전: 하드코딩 에세이 → 교수 평가 (내용 부실)
 * v2: rawReport 원본 → 교수 직접 평가 (실제 연구 내용 평가)
 * Progressive Loading L0: GPA Frontmatter만 로드 (~100토큰)
 */
async function evaluate(agentId, rawReport, topic) {
  const role = AGENT_ROLES[agentId];
  const ai = new GoogleGenAI({ apiKey: getGeminiKey() });

  // L0: GPA Frontmatter만 로드 (~100토큰)
  const gpaHistory = await getGPAHistory(agentId, 3);
  const gpaLine = gpaHistory.length > 0
    ? `최근 GPA: ${gpaHistory.map(g => `${g.topic}(${g.overall_gpa})`).join(', ')}`
    : '첫 학습 (이전 성적 없음)';

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
## ${gpaLine}

## 학생이 제출한 연구 리포트
${rawReport.substring(0, 700)}`;

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
      
      // Fix 3: 파싱 실패 시 이전 성공한 recommendation을 DB에서 복원
      let fallbackRec = role.researchDirection.split(',')[0].trim();
      try {
        const lastGoodRec = await getLastRecommendation(agentId);
        if (lastGoodRec?.recommendation) {
          fallbackRec = lastGoodRec.recommendation;
          console.log(`[Self-Study] 🔄 이전 성공 recommendation 복원: "${fallbackRec.substring(0, 60)}"`);
        }
      } catch { /* DB 조회 실패 시 기본값 사용 */ }
      
      evaluation = {
        grades: {
          goalAlignment: { grade: 'F', gpa: 0, feedback: '평가 파싱 오류' },
          planQuality: { grade: 'F', gpa: 0, feedback: '평가 파싱 오류' },
          actionExecution: { grade: 'F', gpa: 0, feedback: '평가 파싱 오류' },
          critiqueRevision: { grade: 'F', gpa: 0, feedback: '평가 파싱 오류' },
        },
        overallGPA: 0,
        professorComment: '평가 처리 중 오류 발생',
        recommendation: fallbackRec,
      };
    }
  }

  console.log(`[Self-Study] 🏛️ 평가 완료 — GPA ${evaluation.overallGPA}/4.3`);
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

    // ── Step 2: 연구 (LLM 1회, Google Search) ──
    const rawReport = await research(agentId, topic);

    // ── Step 3: 평가 (LLM 1회, rawReport 직접 전달) ──
    const evaluation = await evaluate(agentId, rawReport, topic);

    // ── 저장: Progressive 3단계 ──
    // 저장 1: 학습 지식 (rawReport 500자 보존)
    const knowledge = {
      memory_type: 'fact',
      title: `[Self-Study] ${topic.topic.substring(0, 30)}`,
      content: `${rawReport.substring(0, 500)} [GPA: ${evaluation.overallGPA || '?'}]`,
      importance: Math.min(Math.max(Math.round(evaluation.overallGPA * 2) || 7, 6), 9),
      tags: ['self_study', 'evidence_based', agentId],
    };
    const savedId = await saveMemory(agentId, knowledge);

    // 저장 2: 교수 평가 (lesson)
    await saveMemory(agentId, {
      memory_type: 'lesson',
      title: `[평가] ${topic.topic}`,
      content: `${PROFESSOR.name} 교수 평가 — GPA ${evaluation.overallGPA}/4.3. ${evaluation.professorComment || ''} [다음 과제: ${evaluation.recommendation || '미지정'}]`,
      importance: 7,
      tags: ['self_study', 'evaluation', 'gpa', agentId],
    });

    // 저장 3: GPA 아카이브 (Frontmatter 역할 — 다음 topicSelect에서 사용)
    await saveStudyArchive(agentId, topic.topic, rawReport.substring(0, 300), evaluation);

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

async function sendEvalToDiscord(results) {
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

        // 교수 코멘트
        if (ev.evaluation?.professorComment) {
          fields.push({
            name: '💬 교수 소견',
            value: ev.evaluation.professorComment,
            inline: false,
          });
        }

        // 다음 과제
        if (ev.evaluation?.recommendation) {
          fields.push({
            name: '📌 다음 과제',
            value: ev.evaluation.recommendation,
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
      const errorMsg = r.error
        || r.learned?.find(l => l.error)?.error
        || (r.status === 'no_gaps_found' ? '진단 결과 학습할 주제를 도출하지 못했습니다.' : `상태: ${r.status}`);

      embeds.push({
        title: `⚠️ ${role.name} — 학습 실패`,
        description: `🔴 **원인**: ${errorMsg}\n\n이 에이전트의 학습 파이프라인에서 오류가 발생했습니다.`,
        color: 0x6B7280, // 회색
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

/**
 * 전체 에이전트 자율 학습 세션 (크론용)
 */
export async function runAllAutonomousStudy() {
  await ensureAllBrainTables();
  const AGENTS = ['hani', 'geo', 'noah', 'lina', 'alex'];
  const results = [];

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
    await sendEvalToDiscord(results);
  } catch (err) {
    console.error('[Self-Study] 디스코드 브리핑 전송 실패:', err.message);
  }

  console.log(`[Self-Study] 🎓 전체 완료: ${totalLearned}건 학습, 평가 브리핑 전송`);
  return { session: new Date().toISOString(), totalLearned, results };
}

export { AGENT_ROLES, PROFESSOR };
