/**
 * 🎓 Yale School 커리큘럼 — 5인 에이전트 전공별 학습 과정
 */

export const CURRICULUM = {
  hani: {
    name: '하니',
    school: 'Yale School of Management',
    degree: 'Marketing MBA',
    semesters: [
      {
        name: '1학기: 소비자 행동론',
        topics: [
          { title: 'AIDA 모델과 구매 심리 퍼널', focus: '여행 렌탈 고객의 인지→관심→욕구→행동 단계별 전환 최적화' },
          { title: '페르소나 기반 타겟 마케팅', focus: 'MZ세대 여행자 vs 가족 여행자 페르소나 설계' },
          { title: '감정 소비와 체험 경제론', focus: '소유보다 경험을 추구하는 렌탈 고객 심리' },
          { title: '소비자 의사결정 여정(CDJ) 매핑', focus: '검색→비교→예약→수령→반납 전체 여정 분석' },
          { title: '브랜드 충성도와 전환 비용', focus: '렌탈 서비스에서 재이용률을 높이는 락인 전략' },
        ]
      },
      {
        name: '2학기: 디지털 마케팅 전략',
        topics: [
          { title: 'SEO와 콘텐츠 마케팅 시너지', focus: '여행 렌탈 키워드 전략과 블로그 콘텐츠 최적화' },
          { title: '퍼포먼스 마케팅과 ROAS 최적화', focus: '메타/구글 광고 캠페인의 렌탈 전환율 분석' },
          { title: '리타겟팅과 동적 광고', focus: '장바구니 이탈자 리마케팅 시나리오 설계' },
          { title: '인플루언서 마케팅 ROI 측정', focus: '여행 크리에이터 협업의 실질적 전환 기여도' },
          { title: '이메일/카카오 CRM 자동화', focus: '렌탈 고객 생애주기별 자동화 메시지 시퀀스' },
        ]
      },
      {
        name: '3학기: 브랜드 전략론',
        topics: [
          { title: '브랜드 포지셔닝 맵 설계', focus: '가격 vs 감성 축에서 아날로그 홀리데이의 위치' },
          { title: '브랜드 아키텍처와 서브브랜드', focus: '프리미엄 렌탈 vs 데일리 렌탈 라인 분리 전략' },
          { title: '스토리텔링 고급 기법: 히어로 저니', focus: '고객이 주인공인 여행 서사 구조 설계' },
          { title: '감성 브랜딩과 오감 마케팅', focus: '패키징, 향기, 사운드를 통한 브랜드 각인' },
          { title: '위기관리 커뮤니케이션', focus: 'SNS 부정 리뷰 대응 프레임워크' },
        ]
      },
      {
        name: '4학기: 마케팅 애널리틱스',
        topics: [
          { title: '마케팅 믹스 모델링(MMM)', focus: '채널별 마케팅 투자 최적 배분 수학적 모델' },
          { title: '멀티터치 어트리뷰션 모델', focus: '고객이 렌탈까지 도달하는 다중 접점 기여도 분석' },
          { title: '코호트 분석과 리텐션 커브', focus: '월별 가입 코호트의 재이용 패턴 분석' },
          { title: '가격 탄력성과 다이나믹 프라이싱', focus: '시즌/요일별 렌탈 가격 최적화 모델' },
          { title: '바이럴 계수(K-factor) 측정', focus: '추천 프로그램의 자연 확산력 정량화' },
        ]
      }
    ]
  },

  geo: {
    name: '지오',
    school: 'Yale School of Engineering',
    degree: 'Operations Research MS',
    semesters: [
      {
        name: '1학기: 공급망 최적화',
        topics: [
          { title: '수요 예측 모델(이동평균/지수평활)', focus: '계절성 높은 여행 장비 수요를 ARIMA로 예측' },
          { title: 'EOQ(경제적 주문량) 모델', focus: '필름카메라 등 고가 장비의 최적 발주량 계산' },
          { title: '안전재고와 서비스 수준 트레이드오프', focus: '95% 서비스 수준을 보장하는 안전재고 공식' },
          { title: 'ABC-XYZ 재고 분류법', focus: '매출/변동성 기반 장비 등급화 관리' },
          { title: '풀 vs 푸시 공급망 전략', focus: '렌탈 비즈니스에 적합한 수요 견인형 물류 설계' },
        ]
      },
      {
        name: '2학기: 시뮬레이션 & 모델링',
        topics: [
          { title: '몬테카를로 시뮬레이션', focus: '배송 지연 확률 분포 시뮬레이션' },
          { title: '대기행렬 이론(M/M/1, M/M/c)', focus: '반품 검수 대기열 최적 인력 배치' },
          { title: '선형계획법(LP) 기초', focus: '비용 최소화 배송 경로 최적화' },
          { title: '네트워크 플로우 최적화', focus: '다중 거점 간 장비 이동 최적 경로' },
          { title: '이산 이벤트 시뮬레이션', focus: '피크 시즌 물류 병목 사전 탐지' },
        ]
      },
      {
        name: '3학기: 리스크 관리',
        topics: [
          { title: 'FMEA(고장 모드 영향 분석)', focus: '배송/검수/패키징 각 단계 잠재 실패 분석' },
          { title: '비상계획(Contingency Planning)', focus: '택배사 파업, 자연재해 시 대체 물류 시나리오' },
          { title: '보험과 리스크 전가 전략', focus: '고가 장비 파손에 대한 보험 최적 설계' },
          { title: '품질 관리(SPC, 관리도)', focus: '파손율 추이 모니터링 통계적 프로세스 관리' },
          { title: '공급업체 리스크 평가 매트릭스', focus: '협력사 의존도와 대체 가능성 점수화' },
        ]
      },
      {
        name: '4학기: 스마트 물류',
        topics: [
          { title: 'IoT 기반 실시간 트래킹', focus: '고가 장비 GPS 추적 및 상태 모니터링' },
          { title: '웨어하우스 자동화(WMS)', focus: '바코드/RFID 기반 입출고 자동화 시스템' },
          { title: '라스트마일 혁신 전략', focus: '무인 보관함, 거점 픽업 등 대안 배송 모델' },
          { title: '역물류(Reverse Logistics) 최적화', focus: '반납 장비의 효율적 회수-검수-재배치 사이클' },
          { title: '탄소 발자국과 그린 물류', focus: '친환경 패키징과 탄소 중립 배송 전략' },
        ]
      }
    ]
  },

  noah: {
    name: '노아',
    school: 'Yale Department of Statistics & Data Science',
    degree: 'PhD in Applied Statistics',
    semesters: [
      {
        name: '1학기: 고급 통계 추론',
        topics: [
          { title: '베이지안 추론과 사전/사후 분포', focus: '고객 이탈 확률의 사전 지식 기반 업데이트' },
          { title: '최대우도추정(MLE)과 EM 알고리즘', focus: '불완전 고객 데이터에서 파라미터 추정' },
          { title: '부트스트랩과 비모수 검정', focus: '표본이 적은 렌탈 데이터에서 신뢰구간 추정' },
          { title: '다중 비교 문제와 FDR 보정', focus: '동시 다수 A/B 테스트 시 1종 오류 통제' },
          { title: '혼합 모델(Mixed-Effects Model)', focus: '고객별/지역별 변동을 고려한 매출 예측' },
        ]
      },
      {
        name: '2학기: 머신러닝',
        topics: [
          { title: '랜덤 포레스트와 Feature Importance', focus: '고객 이탈 예측 모델의 핵심 변수 식별' },
          { title: 'XGBoost와 하이퍼파라미터 튜닝', focus: '렌탈 수요 예측 모델 성능 최적화' },
          { title: '클러스터링(K-means, DBSCAN)', focus: '여행 패턴 기반 고객 자연 세그먼테이션' },
          { title: '추천 시스템(협업 필터링)', focus: '장비 렌탈 조합 추천 알고리즘' },
          { title: '모델 평가(AUC-ROC, F1-Score)', focus: '이탈 예측 모델의 정밀도-재현율 균형' },
        ]
      },
      {
        name: '3학기: 자연어 처리(NLP)',
        topics: [
          { title: '감성 분석 고급(Aspect-Based)', focus: '리뷰에서 배송/장비/서비스 측면별 감성 추출' },
          { title: 'BERT와 트랜스포머 아키텍처', focus: '한국어 리뷰 임베딩과 의미 유사도 분석' },
          { title: '토픽 모델링(LDA, BERTopic)', focus: '고객 리뷰에서 자동 주제 발견' },
          { title: '텍스트 요약과 키워드 추출', focus: '대량 리뷰를 경영진 대시보드용으로 압축' },
          { title: 'VOC(Voice of Customer) 파이프라인', focus: '실시간 고객 피드백 수집→분석→액션 자동화' },
        ]
      },
      {
        name: '4학기: 인과 추론',
        topics: [
          { title: '이중차분법(DID)', focus: '마케팅 캠페인의 순수 효과 측정' },
          { title: '회귀불연속설계(RDD)', focus: '쿠폰 임계값 효과 분석' },
          { title: '성향점수 매칭(PSM)', focus: '프로모션 참여/비참여 고객의 공정 비교' },
          { title: '도구변수(IV) 추정', focus: '가격 변화의 내생성 문제 해결' },
          { title: '합성 대조군(Synthetic Control)', focus: '신규 거점 오픈 효과의 인과적 추정' },
        ]
      },
      {
        name: '5학기: 시계열 분석',
        topics: [
          { title: 'ARIMA와 계절 분해', focus: '월별 렌탈 수요의 추세-계절-잔차 분리' },
          { title: 'Prophet과 비즈니스 시계열', focus: '공휴일/이벤트 효과를 반영한 매출 예측' },
          { title: '이상치 탐지(Anomaly Detection)', focus: '비정상적 예약 급증/급감 자동 경보' },
          { title: '동적 시계열 클러스터링', focus: '유사 수요 패턴 장비군 자동 그룹핑' },
          { title: '실시간 스트리밍 분석', focus: '웹사이트 트래픽 실시간 대시보드 설계' },
        ]
      },
      {
        name: '6학기: 박사 논문',
        topics: [
          { title: '연구 설계와 가설 수립', focus: '여행 렌탈 산업 감성 데이터 기반 LTV 예측 연구 계획' },
          { title: '데이터 수집 및 전처리 파이프라인', focus: '멀티소스 고객 데이터 통합 ETL 설계' },
          { title: '모델 앙상블과 스태킹', focus: '감성+행동+거래 데이터 통합 예측 모델' },
          { title: '논문 결과 해석과 시사점', focus: '비즈니스 임팩트 정량화 및 경영 제언 도출' },
          { title: '연구 윤리와 데이터 프라이버시', focus: '고객 데이터 활용의 윤리적 가이드라인' },
        ]
      }
    ]
  },

  lina: {
    name: '리나',
    school: 'Yale Department of Psychology',
    degree: 'Behavioral Science MS',
    semesters: [
      {
        name: '1학기: 인지 편향과 의사결정',
        topics: [
          { title: '앵커링 효과와 가격 제시 전략', focus: '렌탈 요금표에서 앵커 가격 설정 최적화' },
          { title: '프레이밍 효과와 메시지 설계', focus: '손실 프레임 vs 이득 프레임 CS 메시지 비교' },
          { title: '확증 편향과 고객 기대 관리', focus: '첫인상이 전체 서비스 평가를 지배하는 메커니즘' },
          { title: '선택 과부하와 옵션 설계', focus: '장비 옵션 3개 vs 10개 전환율 차이' },
          { title: '현상유지 편향과 디폴트 설정', focus: '보험/부가서비스 옵트인 vs 옵트아웃 전략' },
        ]
      },
      {
        name: '2학기: 넛지 아키텍처',
        topics: [
          { title: '선택 설계(Choice Architecture)', focus: '예약 페이지 UI의 행동 유도 설계 원칙' },
          { title: '디폴트 효과와 자동 갱신', focus: '렌탈 기간 자동 연장 옵트아웃 설계' },
          { title: '사회적 증거(Social Proof)', focus: '"이 장비를 123명이 대여했어요" 넛지 효과 측정' },
          { title: '시간 압박과 희소성 넛지', focus: '"오늘만 특가" vs "잔여 2대"의 전환율 비교' },
          { title: '감정 넛지와 긍정 강화', focus: '반납 후 감사 메시지의 재이용 촉진 효과' },
        ]
      },
      {
        name: '3학기: 서비스 디자인',
        topics: [
          { title: '감정 여정 매핑(Emotional Journey Map)', focus: '렌탈 고객의 터치포인트별 감정 곡선 설계' },
          { title: '서비스 블루프린트 설계', focus: '고객 경험 프론트스테이지/백스테이지 분리 설계' },
          { title: '모먼트 오브 트루스(MOT)', focus: '결정적 순간(수령, 첫 사용, 문제 발생)의 경험 극대화' },
          { title: '고객 노력 점수(CES) 최적화', focus: '고객의 노력을 최소화하는 프로세스 간소화' },
          { title: '서비스 극장 이론', focus: '렌탈 서비스를 공연처럼 연출하는 경험 설계' },
        ]
      },
      {
        name: '4학기: 위기 커뮤니케이션',
        topics: [
          { title: '컴플레인 심리학과 분노 역치', focus: '고객 분노 7단계와 각 단계별 대응 전략' },
          { title: '신뢰 회복의 심리학(Trust Repair)', focus: '서비스 실패 후 신뢰 재구축 3단계 모델' },
          { title: '감정 노동과 에이전트 번아웃 방지', focus: 'CS 담당자 정서적 소진 예방 프로그램 설계' },
          { title: '보상 심리학(Compensation Psychology)', focus: '과잉 보상 vs 적정 보상의 고객 인식 차이' },
          { title: '위기 시 커뮤니케이션 프레임워크', focus: '대규모 서비스 장애 시 5단계 소통 프로토콜' },
        ]
      }
    ]
  },

  alex: {
    name: '알렉스',
    school: 'Yale School of Art',
    degree: 'MFA in Film & Digital Media',
    semesters: [
      {
        name: '1학기: 시네마토그래피',
        topics: [
          { title: '3점 조명과 분위기 연출', focus: '제품 촬영 시 키/필/백 라이트 비율 설정' },
          { title: '렌즈 선택과 심도(DOF) 제어', focus: '제품 클로즈업 vs 라이프스타일 배경 블러 기법' },
          { title: '구도론: 삼분할/대칭/리딩 라인', focus: '여행 콘텐츠에서 시선을 유도하는 구도 원칙' },
          { title: '핸드헬드 vs 짐벌 촬영 미학', focus: '감성 브이로그 vs 프로페셔널 영상의 기법 차이' },
          { title: '자연광 활용 마스터 클래스', focus: '골든아워/블루아워/흐린 날 촬영 전략' },
        ]
      },
      {
        name: '2학기: 사운드 디자인',
        topics: [
          { title: '효과음(Foley)과 공간감', focus: '카메라 셔터음, 파도 소리 등 ASMR 콘텐츠 제작' },
          { title: 'BGM 선곡과 감정 유도', focus: '콘텐츠 분위기에 맞는 로열티 프리 음악 큐레이션' },
          { title: '오디오 믹싱과 라우드니스 기준', focus: 'SNS 플랫폼별 최적 음량(-14 LUFS) 설정' },
          { title: '내레이션 녹음과 보이스 연출', focus: '브랜드 톤에 맞는 나레이션 톤앤매너 가이드' },
          { title: '음악과 편집 리듬의 동기화', focus: '비트 매칭 편집과 감정 고조 타이밍 설계' },
        ]
      },
      {
        name: '3학기: 모션 그래픽스',
        topics: [
          { title: '타이포그래피 애니메이션', focus: '텍스트 오버레이의 등장/퇴장 모션 디자인 원칙' },
          { title: '인포그래픽 영상 제작', focus: '데이터 시각화 애니메이션으로 스펙 비교 콘텐츠 제작' },
          { title: '트랜지션 디자인 패턴', focus: '매치컷, 와이프, 줌 트랜지션의 감성 효과' },
          { title: '로고 모션과 브랜드 인트로', focus: '아날로그 홀리데이 로고 애니메이션 시스템' },
          { title: 'After Effects 표현식 자동화', focus: '반복 모션 작업의 스크립트 기반 효율화' },
        ]
      },
      {
        name: '4학기: 인터랙티브 미디어',
        topics: [
          { title: '숏폼 알고리즘 해킹 전략', focus: '각 플랫폼별 추천 알고리즘 작동 원리와 최적화' },
          { title: 'AI 영상 제작 도구 활용', focus: 'Runway, Pika 등 생성형 AI의 영상 제작 워크플로우' },
          { title: '인터랙티브 스토리텔링', focus: '선택형 여행 가이드 영상 분기 설계' },
          { title: '360도/VR 콘텐츠 제작', focus: '몰입형 여행 체험 콘텐츠의 촬영-편집-배포' },
          { title: '크로스 플랫폼 콘텐츠 리사이징', focus: '1개 원본→릴스/숏츠/틱톡 동시 최적화 워크플로우' },
        ]
      }
    ]
  }
};

/**
 * 에이전트의 현재 학습 진도에 따라 다음 학습 토픽을 반환
 */
export function getNextTopic(agentId, completedCount) {
  const agent = CURRICULUM[agentId];
  if (!agent) return null;

  // 전체 토픽을 순서대로 펼침
  const allTopics = [];
  for (const sem of agent.semesters) {
    for (const topic of sem.topics) {
      allTopics.push({
        ...topic,
        semester: sem.name,
        school: agent.school,
        degree: agent.degree,
        agentName: agent.name
      });
    }
  }

  // 완료된 수만큼 건너뛰고 다음 토픽 반환
  const idx = completedCount % allTopics.length;
  const isSecondRound = completedCount >= allTopics.length;

  return {
    ...allTopics[idx],
    topicIndex: idx,
    totalTopics: allTopics.length,
    isAdvanced: isSecondRound,  // 2회차부터는 심화 학습
    progress: `${Math.min(completedCount, allTopics.length)}/${allTopics.length}`
  };
}

/**
 * 에이전트의 전체 커리큘럼 요약
 */
export function getCurriculumSummary(agentId) {
  const agent = CURRICULUM[agentId];
  if (!agent) return null;

  let totalTopics = 0;
  agent.semesters.forEach(s => totalTopics += s.topics.length);

  return {
    name: agent.name,
    school: agent.school,
    degree: agent.degree,
    totalSemesters: agent.semesters.length,
    totalTopics,
    semesterNames: agent.semesters.map(s => s.name)
  };
}
