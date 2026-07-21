import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { detectAndShareCrossAgentKnowledge } from './api/_lib/agent-brain.js';

// 실제 대화를 시뮬레이션 - 노아가 알렉스와 공유하려는 상황
const testMessages = [
  {
    role: 'user',
    content: '다시 한 번만 더 알렉스와 공유를 해봐 ! 가능할거야',
    senderName: '홍성현 대표'
  },
  {
    role: 'model',
    content: `성현 대표님, 알겠습니다! 지금 바로 알렉스에게 달려가겠습니다.
제가 대학원에서 정리해온 '감성 분석 NPS 연계 모델'의 핵심 로직과 데이터 구조를 알렉스에게 정교하게 브리핑하고,
우리 서비스의 Tech-stack 내에서 어떻게 실질적으로 구현할 수 있을지 끝장을 보고 오겠습니다.
1. 데이터 파이프라인 최적화
2. 감성 사전 최적화
3. 대시보드 시각화`,
    senderName: '노아'
  }
];

console.log('=== 디버그: 크로스 에이전트 공유 감지 테스트 ===');
console.log('fromAgentId: noah');
console.log('메시지 수:', testMessages.length);

// 매칭 로직 수동 테스트
const AGENT_NAME_MAP = {
  hani: ['하니', 'Hani'],
  geo: ['지오', 'Geo'],
  noah: ['노아', 'Noah'],
  lina: ['리나', 'Lina'],
  alex: ['알렉스', 'Alex'],
};

const SHARING_KEYWORDS = [
  '공유', '전달', '전해', '미팅', '협업', '회의',
  '브리핑', '이해', '소통', '싱크', '같이', '협동',
];

const fullText = testMessages.map(m => m.content).join(' ');

console.log('\n--- Step 1: 에이전트 이름 매칭 ---');
for (const [agentId, names] of Object.entries(AGENT_NAME_MAP)) {
  if (agentId === 'noah') continue;
  for (const name of names) {
    const found = fullText.includes(name);
    console.log(`  ${agentId} (${name}): ${found ? '✅ 매칭됨' : '❌ 없음'}`);
  }
}

console.log('\n--- Step 2: 공유 키워드 매칭 ---');
for (const kw of SHARING_KEYWORDS) {
  const found = fullText.includes(kw);
  if (found) console.log(`  "${kw}": ✅ 매칭됨`);
}

console.log('\n--- Step 3: 실제 함수 호출 ---');
try {
  const result = await detectAndShareCrossAgentKnowledge('noah', testMessages);
  console.log('결과:', result);
  if (result.length === 0) {
    console.log('⚠️ 공유 감지 실패 - 아무것도 저장되지 않았습니다');
  } else {
    console.log('✅ 공유 성공! 저장된 ID:', result);
  }
} catch (err) {
  console.error('❌ 에러 발생:', err.message);
  console.error(err.stack);
}
