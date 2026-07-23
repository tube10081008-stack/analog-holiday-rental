/**
 * 홀리데이 메이트 — 필름 촬영 스팟 데이터
 *
 * 일반 관광 해설이 아니라 "필름카메라로 이 장소를 찍는 법"에 초점을 둔 데이터입니다.
 * goldenTime(최적 촬영 시간대), filmNote(필름 촬영 노하우), cameraTips(기종별 팁)가 핵심 필드입니다.
 * 서버(api/mate.js)와 클라이언트(mate.js)가 공유합니다 — DOM 의존 금지.
 */

export const CAMERAS = {
  cam_kodak_m35: {
    name: '코닥 M35 / M38',
    trait: '쨍하고 따뜻한 코닥 옐로우 톤. 역광과 노을에서 청춘 영화 같은 색이 나옵니다.',
    generalTip: '해를 완전히 등지기보다 45도 옆에서 받으면 옐로우 톤이 가장 예쁘게 살아요.',
  },
  cam_yashica_mf1: {
    name: '야시카 MF-1',
    trait: '매트하고 차분한 톤. 조용한 골목과 흐린 날의 질감을 잘 담습니다.',
    generalTip: '화창한 날보다 얇은 구름이 낀 날, 그림자 경계가 부드러울 때 진가가 나옵니다.',
  },
  cam_ilford_sprite: {
    name: '일포드 스프라이트 35-II',
    trait: '흑백 필름의 클래식. 빛과 그림자의 대비가 곧 사진의 전부가 됩니다.',
    generalTip: '색을 잊고 명암만 보세요. 강한 사선 그림자, 창살, 돌담의 질감이 최고의 피사체입니다.',
  },
  cam_fotocola_35mm: {
    name: '포토콜라 35mm',
    trait: '팝하고 채도 높은 컬러. 완벽한 구도보다 즐거운 순간 그 자체가 어울립니다.',
    generalTip: '원색 간판, 시장의 과일, 친구의 웃음 — 채도가 높은 피사체를 정면으로 담으세요.',
  },
  cam_agfa_analogue: {
    name: '아그파포토 아날로그 35mm',
    trait: '포근하고 나른한 톤. 오후의 창가, 주말의 골목 같은 장면과 어울립니다.',
    generalTip: '오후 3~5시의 기울어진 빛에서 특유의 포근함이 삽니다. 서두르지 말고 천천히.',
  },
  cam_okio_35mm: {
    name: '오키오 다회용 카메라',
    trait: '강력한 플래시와 힙한 저화질 노이즈. 밤거리의 감성을 가장 잘 아는 카메라.',
    generalTip: '밤에는 무조건 플래시. 피사체와 1.5~2m 거리를 지키면 얼굴이 하얗게 날아가지 않아요.',
  },
};

export const PERSONAS = {
  hani: {
    name: '하니',
    role: '감성 에디터',
    emoji: '🖋️',
    color: '#8A6D4E',
    oneLiner: '문학적인 시선으로 장소의 결을 읽어드려요',
  },
  lina: {
    name: '리나',
    role: '다정한 안내원',
    emoji: '🌷',
    color: '#C0655B',
    oneLiner: '처음 온 골목도 익숙해지게, 친절하게 안내해요',
  },
  noah: {
    name: '노아',
    role: '로컬 트렌드 전문가',
    emoji: '📸',
    color: '#4E6E58',
    oneLiner: '현지인만 아는 포토 스팟과 꿀팁을 알려드려요',
  },
};

export const SPOTS = [
  // ═══ 서울 ═══
  {
    id: 'ikseon',
    city: '서울',
    name: '익선동 한옥길',
    emoji: '🏘️',
    category: '골목',
    lat: 37.5718, lng: 126.9891,
    desc: '1920년대 한옥이 촘촘히 이어진 서울에서 가장 오래된 한옥 골목. 좁은 길 위로 기와지붕 선이 겹겹이 흐릅니다.',
    goldenTime: '오전 10~11시 — 골목이 좁아 한낮엔 그림자가 강하고, 오전의 비스듬한 빛이 기와 질감을 살립니다.',
    filmNote: '골목이 좁아 광각이 없는 필름카메라로는 한 걸음 물러서는 게 답입니다. 지붕 처마선을 대각선으로 걸치면 프레임이 살아요.',
    moods: ['한옥', '골목', '아네모이아'],
    cameraTips: {
      cam_yashica_mf1: '흐린 날의 익선동 기와는 야시카의 매트 톤과 최고의 궁합입니다.',
      cam_ilford_sprite: '기와 그림자와 창살 — 흑백으로 찍으면 1920년대가 돌아옵니다.',
    },
  },
  {
    id: 'seochon',
    city: '서울',
    name: '서촌 골목',
    emoji: '🍚',
    category: '골목',
    lat: 37.5794, lng: 126.9702,
    desc: '경복궁 서쪽, 오래된 세탁소와 쌀가게가 남아 있는 생활의 골목. 관광지가 아니라 삶의 결이 찍히는 곳입니다.',
    goldenTime: '오후 4~5시 — 인왕산 쪽으로 기우는 빛이 낮은 지붕들 위에 길게 눕습니다.',
    filmNote: '간판, 자전거, 널어둔 빨래 같은 생활의 사물을 찍으세요. 사람을 찍을 땐 꼭 눈인사 먼저 — 그 한 컷이 더 따뜻해집니다.',
    moods: ['생활', '오후의 빛', '다정함'],
    cameraTips: {
      cam_agfa_analogue: '서촌의 나른한 오후는 아그파의 포근한 톤을 위해 존재하는 시간입니다.',
    },
  },
  {
    id: 'euljiro',
    city: '서울',
    name: '을지로 노가리 골목',
    emoji: '🍻',
    category: '밤거리',
    lat: 37.5663, lng: 126.9910,
    desc: '해가 지면 골목 전체가 야장 테이블로 변하는 서울의 밤. 백열등과 네온이 뒤섞인 빛의 정글입니다.',
    goldenTime: '저녁 8시 이후 — 완전히 어두워져야 백열등 빛이 필름에 예쁘게 감깁니다.',
    filmNote: '밤 필름 사진의 절반은 플래시 거리 조절입니다. 테이블 맞은편 친구까지가 플래시의 사정거리예요.',
    moods: ['밤', '네온', '청춘'],
    cameraTips: {
      cam_okio_35mm: '오키오의 홈그라운드. 플래시 터뜨린 저화질 노이즈가 을지로의 밤과 완벽하게 어울립니다.',
      cam_fotocola_35mm: '네온 간판을 배경으로 원색의 밤을 담아보세요.',
    },
  },
  {
    id: 'banpo',
    city: '서울',
    name: '반포한강공원 노을',
    emoji: '🌇',
    category: '노을',
    lat: 37.5109, lng: 126.9963,
    desc: '한강 위로 해가 지는 서울의 대표 노을 명당. 다리와 강물, 하늘이 한 프레임에 담깁니다.',
    goldenTime: '일몰 30분 전 도착 필수 — 골든아워는 생각보다 짧습니다. 일몰 시각을 미리 확인하세요.',
    filmNote: '노을은 하늘 7 : 강 3 비율로. 필름은 어두운 쪽 관용도가 낮아서, 하늘의 빛을 기준으로 잡는 게 안전합니다.',
    moods: ['노을', '강', '여운'],
    cameraTips: {
      cam_kodak_m35: '코닥 옐로우 톤 + 한강 노을 = 이 카메라를 고른 이유를 알게 되는 순간.',
    },
  },
  // ═══ 부산 ═══
  {
    id: 'huinnyeoul',
    city: '부산',
    name: '흰여울문화마을',
    emoji: '🌊',
    category: '바다',
    lat: 35.0777, lng: 129.0454,
    desc: '절벽 위 하얀 골목 아래로 바다가 펼쳐지는 영도의 마을. 골목과 수평선이 동시에 잡히는 드문 곳입니다.',
    goldenTime: '오전 10시~정오 — 남향 바다라 오전 순광에서 물빛이 가장 파랗게 나옵니다.',
    filmNote: '하얀 벽 + 파란 바다는 노출이 벽에 끌려가기 쉬워요. 바다를 등지고 벽의 그림자 쪽에서 찍으면 안정적입니다.',
    moods: ['바다', '하얀 골목', '수평선'],
    cameraTips: {
      cam_kodak_m35: '파란 바다와 코닥 옐로우의 보색 대비 — 실패하기 어려운 조합입니다.',
    },
  },
  {
    id: 'gwangalli',
    city: '부산',
    name: '광안리 밤바다',
    emoji: '🌉',
    category: '밤거리',
    lat: 35.1532, lng: 129.1187,
    desc: '광안대교의 불빛이 바다 위에 흐르는 부산의 밤. 모래사장에 앉아 다리를 정면으로 마주할 수 있습니다.',
    goldenTime: '저녁 7~9시 — 하늘에 푸른 기가 남은 블루아워에 다리 조명이 켜지는 20분이 황금 타이밍.',
    filmNote: '야경은 필름의 가장 어려운 과목입니다. 블루아워를 노리면 하늘빛이 노출을 도와줘서 성공률이 확 올라갑니다.',
    moods: ['밤바다', '블루아워', '불빛'],
    cameraTips: {
      cam_okio_35mm: '다리는 배경으로, 플래시로 친구를 주인공으로. 배경 불빛이 번지며 감성이 두 배가 됩니다.',
    },
  },
  // ═══ 도쿄 ═══
  {
    id: 'yanesen',
    city: '도쿄',
    name: '야네센 골목 (야나카긴자)',
    emoji: '🐈',
    category: '골목',
    lat: 35.7278, lng: 139.7669,
    desc: '전쟁을 비껴간 도쿄의 옛 동네. 고양이가 낮잠 자는 상점가와 저녁 노을 계단 "유야케단단"이 있습니다.',
    goldenTime: '오후 4~5시 — 유야케단단(夕焼けだんだん)이라는 이름 그대로, 노을이 계단 위 상점가로 쏟아집니다.',
    filmNote: '상점가 초입 계단 위에서 아래를 향해 찍는 것이 이 동네의 클래식 구도. 반셔터 없는 필카는 계단 난간에 팔을 고정하세요.',
    moods: ['옛 동네', '노을 계단', '고양이'],
    cameraTips: {
      cam_agfa_analogue: '야네센의 낡고 포근한 색은 아그파 톤 그 자체입니다.',
    },
  },
  {
    id: 'nakameguro',
    city: '도쿄',
    name: '나카메구로 강변',
    emoji: '🌸',
    category: '강변',
    lat: 35.6441, lng: 139.6982,
    desc: '메구로강을 따라 카페와 편집숍이 이어지는 거리. 봄엔 벚꽃 터널, 평소엔 잔잔한 산책의 풍경입니다.',
    goldenTime: '오전 9~10시 — 관광객이 적고, 강물 위 반사광이 부드럽습니다.',
    filmNote: '다리 위에서 강을 따라 소실점을 만드는 구도가 정석. 벚꽃 시즌엔 꽃보다 꽃 아래 사람들의 뒷모습이 더 좋은 피사체입니다.',
    moods: ['강변', '산책', '벚꽃'],
    cameraTips: {
      cam_yashica_mf1: '잔잔한 강변 산책의 속도와 야시카의 조용한 톤이 같은 템포로 흐릅니다.',
    },
  },
  {
    id: 'omoide',
    city: '도쿄',
    name: '신주쿠 오모이데요코초',
    emoji: '🏮',
    category: '밤거리',
    lat: 35.6931, lng: 139.6994,
    desc: '"추억의 골목"이라는 이름의 좁은 야키토리 골목. 붉은 초롱과 연기, 백열등이 만드는 쇼와 시대의 밤입니다.',
    goldenTime: '저녁 6~8시 — 초롱에 불이 들어오고 연기가 골목을 채우는 시간.',
    filmNote: '연기 사이로 새어드는 빛줄기를 노리세요. 골목이 매우 좁으니 통행에 방해되지 않게, 가게 안 촬영은 반드시 허락 먼저.',
    moods: ['쇼와 레트로', '초롱', '연기'],
    cameraTips: {
      cam_okio_35mm: '플래시 + 붉은 초롱 = 힙한 저화질의 정점. 오키오를 위한 골목입니다.',
      cam_fotocola_35mm: '초롱의 붉은색을 채도 높게 담으면 포스터 같은 한 장이 나옵니다.',
    },
  },
  // ═══ 교토 ═══
  {
    id: 'tetsugaku',
    city: '교토',
    name: '철학의 길',
    emoji: '🍂',
    category: '산책로',
    lat: 35.0270, lng: 135.7947,
    desc: '철학자 니시다 기타로가 사색하며 걷던 수로변 산책로. 계절이 통째로 수로 위에 내려앉는 길입니다.',
    goldenTime: '이른 아침 7~9시 — 관광객이 없는 시간의 수로는 완전히 다른 장소입니다.',
    filmNote: '길 전체를 담으려 하지 마세요. 수로에 떨어진 꽃잎 한 줌, 낡은 다리 하나 — 부분이 전체보다 많은 것을 말합니다.',
    moods: ['사색', '수로', '계절'],
    cameraTips: {
      cam_yashica_mf1: '혼자 걷는 사색의 길엔 조용한 카메라. 야시카가 이 길의 공기와 가장 닮았습니다.',
      cam_ilford_sprite: '흑백으로 찍은 겨울의 철학의 길은 한 편의 시가 됩니다.',
    },
  },
  {
    id: 'gion',
    city: '교토',
    name: '기온 하나미코지',
    emoji: '⛩️',
    category: '골목',
    lat: 35.0037, lng: 135.7752,
    desc: '격자문 마치야가 이어지는 교토의 상징적 거리. 돌바닥과 목조 건물의 질감이 필름과 잘 맞습니다.',
    goldenTime: '해 진 직후 — 가로등이 켜지고 돌바닥이 빛을 머금는 저녁의 20분.',
    filmNote: '게이코·마이코 분들을 마주쳐도 촬영은 금지입니다(벌금 있어요). 사람 없는 건물과 골목의 결만으로 충분히 아름답습니다.',
    moods: ['마치야', '돌바닥', '저녁'],
    cameraTips: {
      cam_ilford_sprite: '격자문과 돌바닥의 질감은 흑백의 영원한 주제입니다.',
    },
  },
  // ═══ 오사카 ═══
  {
    id: 'nakazakicho',
    city: '오사카',
    name: '나카자키초 골목',
    emoji: '☕',
    category: '골목',
    lat: 34.7095, lng: 135.5054,
    desc: '공습을 피해 살아남은 낡은 목조 주택가가 통째로 빈티지 카페 거리가 된 동네. 오사카의 숨은 필름 성지입니다.',
    goldenTime: '오후 2~4시 — 좁은 골목 사이로 빛이 사선으로 들어와 담쟁이와 낡은 벽을 비춥니다.',
    filmNote: '카페 외관의 손글씨 간판, 화분, 자전거 — 디테일이 주인공인 동네입니다. 한 골목에서 세 컷 이상 쓰게 될 거예요.',
    moods: ['빈티지', '카페', '낡은 벽'],
    cameraTips: {
      cam_agfa_analogue: '낡은 목조 벽의 갈색과 아그파의 포근한 톤이 한 몸처럼 섞입니다.',
      cam_fotocola_35mm: '알록달록한 카페 간판들은 포토콜라의 팝 컬러로.',
    },
  },
];

/**
 * 여행 스탬프 — 촬영 행동 기반 게이미피케이션
 * check(shots, cities, spotIds): shots = 전체 컷 배열, cities = 방문 도시명 배열, spotIds = 방문 스팟 ID 배열
 * 주의: 모든 스탬프는 현재 데이터로 실제 달성 가능해야 합니다 (도시 5곳, 스팟 12곳, 롤 36컷 기준).
 */
export const STAMPS = [
  {
    id: 'first_frame', emoji: '👣', name: '첫 컷',
    desc: '여행의 첫 프레임을 기록했어요',
    check: (shots) => shots.length >= 1,
  },
  {
    id: 'golden_hunter', emoji: '🌇', name: '골든아워 헌터',
    desc: '오후 5~7시, 필름이 가장 사랑하는 빛을 담았어요',
    check: (shots) => shots.some((s) => { const h = new Date(s.at).getHours(); return h >= 17 && h < 19; }),
  },
  {
    id: 'night_walker', emoji: '🌙', name: '밤의 사진가',
    desc: '해가 진 뒤의 한 컷 — 플래시의 시간을 즐겼어요',
    check: (shots) => shots.some((s) => { const h = new Date(s.at).getHours(); return h >= 20 || h < 5; }),
  },
  {
    id: 'five_frames', emoji: '✨', name: '다섯 장면',
    desc: '서로 다른 스팟 다섯 곳에서 셔터를 눌렀어요',
    check: (shots, cities, spotIds) => spotIds.length >= 5,
  },
  {
    id: 'city_hopper', emoji: '🧳', name: '도시 수집가',
    desc: '두 도시의 빛을 한 롤에 담는 중이에요',
    check: (shots, cities) => cities.length >= 2,
  },
  {
    id: 'pilgrim', emoji: '⛩️', name: '세 도시 순례자',
    desc: '세 도시를 필름으로 순례했어요',
    check: (shots, cities) => cities.length >= 3,
  },
  {
    id: 'half_roll', emoji: '🎞', name: '반 롤',
    desc: '18컷 — 롤의 절반, 여행도 절반쯤 왔을까요',
    check: (shots) => shots.length >= 18,
  },
  {
    id: 'full_roll', emoji: '🏆', name: '롤 컴플리트',
    desc: '36컷을 모두 사용! 현상소에서 만나요',
    check: (shots) => shots.length >= 36,
  },
];

/** 두 좌표 간 거리 (m, Haversine) */
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/** 사용자 → 스팟 방위각 (도, 북쪽 기준 시계방향) */
export function bearingDeg(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function getSpotById(id) {
  return SPOTS.find((s) => s.id === id) || null;
}
