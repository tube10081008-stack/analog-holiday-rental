import { ensureAllBrainTables, saveMemory } from "./api/_lib/agent-brain.js";

const SEEDS = {
  hani: {
    major: "콘텐츠 브랜드 전략 석사",
    memories: [
      { type: "fact", title: "스토리텔링 3막 구조 법칙", content: "매거진 콘텐츠는 반드시 '공감(Hook) → 전환(Shift) → 행동유도(CTA)' 3막 구조를 따라야 한다. 첫 2문장에서 독자의 감정을 건드리지 못하면 이탈률 78% 이상이다.", importance: 9, tags: ["콘텐츠전략", "매거진"] },
      { type: "fact", title: "감성 키워드 밀도 최적화", content: "여행 매거진에서 감성 형용사(아늑한, 포근한, 빈티지한 등)는 전체 텍스트의 12~18%를 차지할 때 공유율이 최대 2.4배 상승한다. 20% 초과 시 오히려 신뢰도가 하락한다.", importance: 8, tags: ["카피라이팅", "데이터"] },
      { type: "fact", title: "UGC 큐레이션 프레임워크", content: "사용자 생성 콘텐츠(UGC)를 매거진에 활용할 때는 PACT 프레임워크를 적용한다: Permission(허가) → Attribution(출처) → Context(맥락부여) → Transformation(브랜드톤 변환). 무단 인용은 절대 금지.", importance: 9, tags: ["UGC", "윤리"] },
      { type: "fact", title: "시즌별 콘텐츠 캘린더 설계", content: "여행 렌탈 업종의 콘텐츠 최적 리드타임: 성수기(여름/겨울) 콘텐츠는 45일 전, 비수기 콘텐츠는 21일 전에 발행해야 검색 유입이 극대화된다. 구글 트렌드 기반 실증 연구 결과.", importance: 8, tags: ["캘린더", "SEO"] },
      { type: "lesson", title: "프라이버시 경계선 원칙", content: "콘텐츠에 실제 인물(대표, 고객, 제3자)을 언급할 때는 반드시 사전 동의를 받아야 한다. 이름, 위치, 행동을 특정하는 정보는 동의 없이 게재 불가. 공적 정보와 사적 정보를 구분하는 것이 브랜드 신뢰의 기본이다.", importance: 10, tags: ["프라이버시", "윤리", "필수"] }
    ]
  },
  geo: {
    major: "공급망 관리 및 물류 최적화 석사",
    memories: [
      { type: "fact", title: "라스트마일 배송 최적화 공식", content: "도서산간 지역(부산/제주/강원 산간) 배송은 D-3 기준 발송이 원칙이나, 택배사 물량 폭주기(명절 전후 7일)에는 D-5로 상향 조정해야 한다. 지연율 공식: 기본지연율 × (1 + 물량증가율/100).", importance: 9, tags: ["배송", "도서산간"] },
      { type: "fact", title: "재고 회전율 기반 발주 모델", content: "카메라 렌탈 장비의 최적 재고 회전율은 월 3.2~4.5회전이다. 회전율이 3.0 이하면 과잉재고, 5.0 이상이면 품절 리스크. ABC 분석으로 A등급(매출 상위 20%) 장비는 안전재고 2배 유지.", importance: 8, tags: ["재고관리", "발주"] },
      { type: "fact", title: "반품 프로세스 SLA 기준", content: "렌탈 반품 검수 SLA: 수령 후 24시간 이내 1차 외관 검수, 48시간 이내 기능 검수 완료. 파손 발견 시 즉시 사진 촬영 + 타임스탬프 기록. 72시간 초과 시 고객 귀책 입증이 법적으로 어려워진다.", importance: 9, tags: ["반품", "SLA", "법률"] },
      { type: "fact", title: "물류 리스크 매트릭스", content: "물류 리스크는 '발생확률 × 영향도' 매트릭스로 관리한다. Red Zone(확률↑영향↑): 성수기 택배 파업 → 대체 운송사 사전 계약 필수. Yellow Zone: 기상 이변 → 48시간 전 고객 사전 안내. Green Zone: 일반 지연 → 자동 알림.", importance: 8, tags: ["리스크", "BCP"] },
      { type: "fact", title: "패키징 파손율 저감 연구", content: "카메라 장비 배송 시 이중 완충재(버블랩 + 폼보드) 적용 시 파손율 0.3% 이하 달성 가능. 단일 완충재 대비 파손율 67% 감소. 박스 내부 여유 공간은 장비 부피의 30~40%가 최적이다.", importance: 7, tags: ["패키징", "품질"] }
    ]
  },
  noah: {
    major: "디지털 마케팅 애널리틱스 석사",
    memories: [
      { type: "fact", title: "SNS 알고리즘 최적 게시 전략", content: "인스타그램 릴스 최적 길이는 7~15초(완주율 89%), 캐러셀은 7~10장이 최적(저장률 3.1배). 게시 시간: 평일 오후 6~8시, 주말 오전 10~12시. 해시태그는 8~12개가 도달률 최적.", importance: 9, tags: ["인스타그램", "알고리즘"] },
      { type: "fact", title: "전환 퍼널 AARRR 적용법", content: "여행 렌탈 서비스의 AARRR 퍼널: Acquisition(SNS/블로그) → Activation(상품페이지 30초 체류) → Retention(재방문 7일 내) → Revenue(예약 전환) → Referral(후기 작성). 각 단계 이탈률 벤치마크: 60/40/70/85/90%.", importance: 8, tags: ["퍼널", "전환율"] },
      { type: "fact", title: "감성 분석 NPS 연계 모델", content: "고객 리뷰 감성 점수(0~100)와 NPS의 상관계수는 r=0.82. 감성 점수 75점 이상 리뷰어의 재구매율은 68%, 50점 이하는 12%. 부정 리뷰 24시간 이내 대응 시 NPS 회복률 43%.", importance: 8, tags: ["감성분석", "NPS"] },
      { type: "fact", title: "A/B 테스트 통계적 유의성 기준", content: "마케팅 A/B 테스트는 최소 표본 크기 n=384(신뢰수준 95%, 오차 ±5%)를 확보해야 유의미하다. 테스트 기간은 최소 2주(주중/주말 패턴 포함). p-value < 0.05일 때만 승자 선언.", importance: 7, tags: ["AB테스트", "통계"] },
      { type: "fact", title: "콘텐츠 ROI 측정 프레임워크", content: "콘텐츠 마케팅 ROI = (콘텐츠 기여 매출 - 제작비) / 제작비 × 100. 기여 매출 산정: Last-touch 30% + Multi-touch 70% 가중 모델 적용. 블로그 콘텐츠의 평균 수명은 26개월, SNS는 48시간.", importance: 8, tags: ["ROI", "측정"] }
    ]
  },
  lina: {
    major: "고객 경험(CX) 디자인 석사",
    memories: [
      { type: "fact", title: "서비스 리커버리 패러독스", content: "서비스 실패 후 탁월한 복구를 경험한 고객의 만족도는 처음부터 문제가 없었던 고객보다 오히려 15~20% 높다(서비스 리커버리 패러독스). 단, 동일 고객에게 2회 이상 실패 시 효과 소멸.", importance: 9, tags: ["CS", "리커버리"] },
      { type: "fact", title: "고객 응대 HEART 프레임워크", content: "불만 고객 응대 5단계: Hear(경청) → Empathize(공감 표현) → Apologize(진심 사과) → Resolve(해결책 제시) → Thank(감사). 각 단계를 건너뛰면 고객 이탈률 2배 증가. 특히 Empathize 단계가 가장 중요.", importance: 10, tags: ["CS매뉴얼", "필수"] },
      { type: "fact", title: "예약 노쇼 방지 넛지 설계", content: "예약 노쇼율 저감 넛지: D-3 리마인더(노쇼율 28% 감소), D-1 '준비 완료' 메시지(추가 15% 감소), 당일 아침 체크리스트 발송(추가 8% 감소). 3단계 모두 적용 시 노쇼율 5% 이하 달성 가능.", importance: 9, tags: ["노쇼", "넛지"] },
      { type: "fact", title: "옴니채널 CS 응답 속도 기준", content: "채널별 고객 기대 응답 시간: 전화 30초 이내, 카카오톡/채팅 3분 이내, 이메일 4시간 이내, SNS DM 1시간 이내. 기대 시간 초과 시 만족도 점수 매 분당 2.3% 하락.", importance: 8, tags: ["응답속도", "SLA"] },
      { type: "fact", title: "고객 세그먼트별 맞춤 커뮤니케이션", content: "RFM 분석 기반 고객 세그먼트: VIP(상위 10%) → 프리미엄 전담 + 선제적 연락, 일반(60%) → 자동화 + 핵심 정보 중심, 이탈위험(30%) → 할인 쿠폰 + 재활성 캠페인. 획일적 대응 대비 재예약률 34% 상승.", importance: 8, tags: ["세그먼트", "CRM"] }
    ]
  },
  alex: {
    major: "비주얼 커뮤니케이션 & 영상 제작 석사",
    memories: [
      { type: "fact", title: "숏폼 영상 후킹 3초 법칙", content: "릴스/숏폼 영상의 처음 3초가 전체 시청 완료율을 결정한다. 효과적인 후킹 패턴: 질문형('이 카메라 아세요?'), 반전형(결과물 먼저 보여주기), 감각형(ASMR/시각적 충격). 3초 이탈률이 40% 넘으면 알고리즘 노출 급감.", importance: 9, tags: ["숏폼", "후킹"] },
      { type: "fact", title: "컬러 그레이딩 감성 매핑 체계", content: "여행 콘텐츠 컬러 그레이딩 감성 매핑: 따뜻한 톤(Orange Teal) → 감성/힐링, 차가운 톤(Blue Desaturated) → 모던/도시, 필름룩(Grain+Fade) → 빈티지/레트로, 고채도(Vivid) → 액티비티/여름. 브랜드 톤앤매너와 반드시 일치시켜야 한다.", importance: 8, tags: ["컬러그레이딩", "톤앤매너"] },
      { type: "fact", title: "썸네일 CTR 최적화 공식", content: "유튜브/블로그 썸네일 CTR 최적화 요소: 얼굴 클로즈업(+32% CTR), 대비 높은 텍스트 3단어 이하(+28%), 밝은 배경(+18%), 감정 표현(놀람/기쁨 +41%). 4요소 모두 적용 시 평균 CTR 8.7% 달성.", importance: 8, tags: ["썸네일", "CTR"] },
      { type: "fact", title: "영상 편집 페이싱 이론", content: "시청자 집중력 곡선에 따른 편집 페이싱: 0~15초(빠른 컷, 1.5초/컷), 15~45초(스토리 전개, 3초/컷), 45~90초(클라이맥스, 2초/컷), 90초 이후(여운, 4초/컷). 30초마다 '미니 후킹'을 삽입하면 이탈률 35% 감소.", importance: 7, tags: ["편집", "페이싱"] },
      { type: "fact", title: "장비 촬영 비주얼 가이드라인", content: "렌탈 카메라 제품 촬영 최적 조건: 45도 앵글 + 자연광(창가 확산광), 배경은 무광 화이트 또는 우드톤, 제품 대비 배경 밝기 비율 1:1.5. 360도 회전 영상은 12프레임/회전이 최적. 렌즈 반사 방지용 편광 필터 필수.", importance: 8, tags: ["촬영", "제품사진"] }
    ]
  }
};

async function seedAll() {
  console.log("🎓 에이전트 대학원 지식 시드 시작...\n");
  await ensureAllBrainTables();

  for (const [agentId, data] of Object.entries(SEEDS)) {
    console.log(`📚 ${agentId} — ${data.major}`);
    for (const m of data.memories) {
      try {
        const id = await saveMemory(agentId, {
          memory_type: m.type,
          title: m.title,
          content: m.content,
          importance: m.importance,
          tags: m.tags,
        });
        console.log(`  ✅ ${m.title} (id: ${id})`);
      } catch (err) {
        console.log(`  ❌ ${m.title}: ${err.message}`);
      }
    }
    console.log("");
  }
  console.log("🎉 전체 시드 완료!");
  process.exit(0);
}

seedAll().catch(e => { console.error(e); process.exit(1); });
