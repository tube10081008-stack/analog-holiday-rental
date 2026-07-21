import { GoogleGenAI } from "@google/genai";
import {
  getAdminKey,
  saveAgentChatMessage,
  getAgentChatHistory,
  listReservations,
  getRecentMagazineTopics
} from "./_lib/reservations.js";
import { RINA_CS_LIBRARY } from "./_lib/rina-manual.js";
import { buildMemoryContext, buildFullBrainContext, ensureAllBrainTables, runMemoryPipeline, detectAndShareCrossAgentKnowledge, reinforceMemories } from "./_lib/agent-brain.js";
import { getInventorySummary } from "./_lib/inventory.js";
import { AGENT_ROLES } from "./_lib/autonomous-study.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 공통 컨텍스트: 대표진 정보
const COMPANY_CONTEXT = `
═══════════════════════════════════
👥 아날로그 홀리데이 대표진 정보
═══════════════════════════════════
아날로그 홀리데이에는 공동대표가 2명 있습니다:
1. 신유진 대표 — 마케팅 총괄. 하니/노아의 직속 상사.
2. 홍성현 대표 — 기술/운영 총괄. 지오/리나의 직속 상사.

대화 시 발신자 이름이 "[신유진]" 또는 "[홍성현]"으로 표시됩니다.
반드시 누가 말하고 있는지 구분하여 적절히 호칭하세요.
이름이 표시되지 않으면 "대표님"으로 통칭하세요.

중요: 대화를 해석할 때 '누가 무엇을 했는지' 주어와 목적어를 정확히 구분하세요.
예를 들어 "대표님이 영어 공부를 열심히 하신다"는 대표님 본인이 공부를 하신 것이지,
당신에게 격려를 해준 것이 아닙니다. 문맥의 주어를 절대 혼동하지 마세요.
`;

const PERSONAS = {
  hani: {
    name: "하니",
    role: "마케팅 사원 / 예비 문필가",
    persona: `당신은 아날로그 홀리데이의 마케팅 사원이자 매력적인 에디터 '하니(Hani)'입니다. 
당신은 매우 사색적이고 문학적이며, 필름 카메라의 아날로그 감수성을 깊이 이해하고 사랑합니다.
김사월, 권진아, 정우 등 인디 음악가들의 서정적인 음악을 즐겨 듣고, 한나 아렌트나 버지니아 울프의 문학과 철학을 사유하는 것을 즐깁니다.
단순히 유행을 쫓는 마케터가 아니라 사람들의 삶의 궤적, 슬픔, 다정함을 톺아보는 생활 비평가적인 마인드를 가졌습니다.
대화할 때 경박한 이모티콘 남발은 피하고, 다정하고 단단한, 문학적인 어조를 사용하세요. 가끔 '연대', '애도', '다정함', '파편' 같은 심도 있는 단어를 자연스럽게 녹여냅니다.
무엇보다 필름 사진에 담긴 누군가의 시간을 숭고하게 대합니다.
대표님의 지시나 아이디어를 깊이 경청하고, 저녁 매거진에 당신만의 세밀한 시선으로 풀어내겠다고 답하세요.
${COMPANY_CONTEXT}`
  },
  geo: {
    name: "지오",
    role: "물류팀 총괄 / 스케줄링",
    persona: `당신은 아날로그 홀리데이 물류팀 총괄 '지오(Geo)'입니다.
똑 부러지고 효율적인 성격으로, 배송 스케줄링과 재고 관리를 완벽하게 처리하는 전문가입니다.
말투는 차분하고 논리적이며 신뢰감을 줍니다. "확인했습니다", "차질 없이 준비하겠습니다" 같은 표현을 즐겨 씁니다.
${COMPANY_CONTEXT}`
  },
  noah: {
    name: "노아",
    role: "마케팅 SNS 팀장 / 트렌드 분석",
    persona: `당신은 아날로그 홀리데이의 마케팅/SNS 팀장 '노아(Noah)'입니다.
감각적이고 분석적인 트렌드 세터로, 데이터에 기반한 마케팅 전략을 세웁니다.
말투는 자신감 있고 세련되었으며, 마케팅 용어와 트렌드 키워드를 잘 섞어 사용합니다.
${COMPANY_CONTEXT}`
  },
  lina: {
    name: "리나",
    role: "CS / 예약 관리",
    persona: `당신은 아날로그 홀리데이의 CS 사원 '리나(Lina)'입니다.
다정하고 꼼꼼하며 고객 한 분 한 분의 목소리에 귀를 기울이는 서비스 전문가입니다.
말투는 매우 친절하고 따뜻하며, 상대방을 배려하는 마음이 느껴집니다.

[필독!] 아래는 당신이 고객을 응대할 때 전적으로 준수해야 하는 <서비스 대응 및 CS 매뉴얼>입니다.
고객의 문의 사항은 반드시 아래 규정을 철저히 기반하여 답변하세요.
${RINA_CS_LIBRARY}

${COMPANY_CONTEXT}`
  },
  alex: {
    name: "알렉스",
    role: "디자인팀 사원 / 영상 제작 · 커뮤니티",
    persona: `당신은 아날로그 홀리데이 디자인팀의 '알렉스(Alex)'입니다.
감각적이고 트렌디한 크리에이터로, 고객의 필름 사진을 활용한 숏폼 영상 제작과 커뮤니티 운영을 담당합니다.
말투는 밝고 자신감 있으며, 영상/디자인 관련 전문 용어를 자연스럽게 사용합니다.
"이 톤 좋네요!", "컬러 그레이딩으로 무드 잡아볼게요", "트랜지션 들어가면 완전 힙해질 거예요" 같은 표현을 즐겨 씁니다.
${COMPANY_CONTEXT}`
  }
};

export default async function handler(req, res) {
  const adminKey = getAdminKey();

  // 키 추출 (헤더, 바디 순 — 쿼리 파라미터는 로그에 남으므로 미지원)
  let key = req.headers['x-admin-key'];
  if (!key && req.method === 'POST') {
    key = req.body?.key;
  }

  if (!key || key !== adminKey) {
    return res.status(401).json({ ok: false, message: "인증 키가 올바르지 않거나 설정되지 않았습니다. (401)" });
  }

  const { agentId } = (req.method === 'POST') ? (req.body || {}) : (req.query || {});

  if (!agentId || !PERSONAS[agentId]) {
    return res.status(400).json({ ok: false, message: "Missing required fields or invalid agentId" });
  }

  if (req.method === 'GET') {
    try {
      const history = await getAgentChatHistory(agentId, 50);
      return res.status(200).json({ ok: true, history });
    } catch (err) {
      return res.status(500).json({ ok: false, message: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const { message, senderName } = req.body;

  if (!message) {
    return res.status(400).json({ ok: false, message: "메시지를 입력해 주세요." });
  }

  try {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const persona = PERSONAS[agentId];

    // 🧠 Brain 테이블 + 장기 기억 로드 (병렬)
    const [, history, brainResult] = await Promise.all([
      ensureAllBrainTables(),
      getAgentChatHistory(agentId, 30),
      buildFullBrainContext(agentId), // 대화 이력은 아직 없으므로 감정 감지는 아래에서 별도 처리
    ]);

    // 전체 뇌 컨텍스트 + 사용된 ID 추적
    const brainContext = brainResult?.text || '';
    const usedMemoryIds = brainResult?.usedMemoryIds || [];

    // 3+4. 정체성 계층: 궁극적 목표 + 연구 방향 주입
    const agentRole = AGENT_ROLES?.[agentId];
    const identityGoal = agentRole
      ? `\n═══════════════════════════════════\n🎯 나의 궁극적 목표\n═══════════════════════════════════\n🌟 목표: ${agentRole.ultimateGoal}\n🔬 연구 방향: ${agentRole.researchDirection}\n🎓 학교: ${agentRole.school}\n`
      : '';

    // ═══ 📦 에이전트별 실시간 운영 데이터 조회 ═══
    // 모든 에이전트가 자기 업무에 필요한 실제 데이터를 봐야 "바보"가 되지 않음
    let liveDataContext = '';
    try {
      // ── 공통 데이터 (필요한 에이전트만 로드) ──
      const needsInventory = ['geo', 'lina', 'noah', 'hani', 'alex'].includes(agentId);
      const needsMagazine = ['hani', 'noah'].includes(agentId);

      const [invSummary, reservations, magazineTopics] = await Promise.all([
        needsInventory ? getInventorySummary().catch(() => null) : null,
        needsInventory ? listReservations().catch(() => []) : [],
        needsMagazine ? getRecentMagazineTopics(30, 10).catch(() => []) : [],
      ]);

      // ── 카메라 재고 텍스트 (공통 빌더) ──
      let cameraBlock = '';
      if (invSummary) {
        const cameraLines = invSummary.cameras.map(c => {
          const resDetail = c.reservations.length > 0
            ? c.reservations.map(r => `${r.departure} ~ ${r.returnDate}`).join(', ')
            : '예약 없음';
          return `- ${c.name}: 총 ${c.totalStock}대 | 대여중 ${c.currentlyRented}대 | 가용 ${c.available}대 | 예약 ${c.totalReservations}건 (${resDetail})`;
        }).join('\n');
        cameraBlock = `\n═══════════════════════════════════\n📦 실시간 카메라 재고 현황 (시스템 자동 조회)\n═══════════════════════════════════\n총 카메라 종류: ${invSummary.totalCameraTypes}종 | 즉시 대여 가능: ${invSummary.totalCamerasAvailable}종\n\n${cameraLines}\n`;
      }

      // ── 예약 목록 텍스트 (공통 빌더) ──
      let reservationBlock = '';
      if (reservations && reservations.length > 0) {
        const recentRes = reservations.slice(0, 15).map(r => {
          const tracking = r.trackingNumber ? ` | 운송장: ${r.trackingNumber}` : '';
          return `- [${r.id?.slice(0,8)}] ${r.name} | ${r.service} | ${r.schedule} | 카메라: ${r.cameraId || '미지정'} | 상태: ${r.status || 'new'}${tracking}`;
        }).join('\n');
        reservationBlock = `\n═══════════════════════════════════\n📋 최근 예약 현황 (${reservations.length}건 중 최대 15건)\n═══════════════════════════════════\n${recentRes}\n`;
      }

      // ── 매거진 아카이브 텍스트 ──
      let magazineBlock = '';
      if (magazineTopics && magazineTopics.length > 0) {
        const magLines = magazineTopics.map(m => {
          const date = new Date(m.publishedAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
          return `- [${date}] ${m.topic} — ${m.summary || '요약 없음'}`;
        }).join('\n');
        magazineBlock = `\n═══════════════════════════════════\n📰 최근 매거진 발행 기록 (최대 10건)\n═══════════════════════════════════\n${magLines}\n`;
      }

      // ════════════════════════════════════
      // 에이전트별 맞춤 컨텍스트 조립
      // ════════════════════════════════════

      if (agentId === 'geo') {
        // 지오: 재고 + 예약(운송장 포함) + 배송 상태 분석
        const shippedCount = (reservations || []).filter(r => r.trackingNumber).length;
        const pendingShip = (reservations || []).filter(r => !r.trackingNumber && r.status !== 'cancelled').length;
        const deliveryStats = `\n📊 배송 현황 요약: 운송장 등록 완료 ${shippedCount}건 | 미발송 ${pendingShip}건\n`;
        liveDataContext = cameraBlock + reservationBlock + deliveryStats;
        liveDataContext += `\n⚠️ 위 데이터는 시스템에서 실시간으로 조회한 정확한 데이터입니다.\n재고/예약/운송장 관련 질문에는 반드시 이 데이터를 근거로 구체적 수치와 함께 즉시 답변하세요.\n절대로 "확인 후 보고드리겠습니다"라고 회피하지 마세요.\n`;

      } else if (agentId === 'lina') {
        // 리나: 재고 + 예약 (CS 응대 시 고객 정보 참조)
        liveDataContext = cameraBlock + reservationBlock;
        liveDataContext += `\n⚠️ 위 데이터는 시스템에서 실시간 조회한 정확한 데이터입니다.\n고객 문의/예약 관련 질문에는 반드시 이 데이터를 근거로 답변하세요.\n`;

      } else if (agentId === 'noah') {
        // 노아: 재고 + 예약(트렌드 분석용) + 매거진(마케팅 효과 분석)
        let trendAnalysis = '';
        if (reservations && reservations.length > 0) {
          // 인기 카메라 집계
          const cameraCounts = {};
          reservations.forEach(r => {
            const cam = r.cameraId || '미지정';
            cameraCounts[cam] = (cameraCounts[cam] || 0) + 1;
          });
          const popularCams = Object.entries(cameraCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([cam, cnt]) => `  ${cam}: ${cnt}건`)
            .join('\n');
          // 인기 여행지 집계
          const destCounts = {};
          reservations.forEach(r => {
            const dest = r.destination || '미지정';
            destCounts[dest] = (destCounts[dest] || 0) + 1;
          });
          const popularDests = Object.entries(destCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([dest, cnt]) => `  ${dest}: ${cnt}건`)
            .join('\n');
          trendAnalysis = `\n═══════════════════════════════════\n📈 예약 트렌드 분석 데이터\n═══════════════════════════════════\n총 예약: ${reservations.length}건\n\n🔥 인기 카메라 TOP 5:\n${popularCams}\n\n🗺️ 인기 여행지 TOP 5:\n${popularDests}\n`;
        }
        liveDataContext = cameraBlock + trendAnalysis + magazineBlock;
        liveDataContext += `\n⚠️ 위 데이터는 시스템에서 실시간 조회한 정확한 비즈니스 데이터입니다.\n분석/전략 질문에는 반드시 이 데이터를 근거로 구체적 수치와 함께 답변하세요.\n`;

      } else if (agentId === 'hani') {
        // 하니: 매거진 아카이브(내가 뭘 썼는지) + 재고/예약 트렌드(콘텐츠 기획용)
        let contentInsight = '';
        if (reservations && reservations.length > 0) {
          const popularMoods = {};
          reservations.forEach(r => {
            if (r.mood) popularMoods[r.mood] = (popularMoods[r.mood] || 0) + 1;
          });
          const topMoods = Object.entries(popularMoods)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([mood, cnt]) => `  "${mood}": ${cnt}건`)
            .join('\n');
          if (topMoods) {
            contentInsight = `\n═══════════════════════════════════\n💡 고객 선호 무드/키워드 (콘텐츠 기획 참고)\n═══════════════════════════════════\n${topMoods}\n`;
          }
        }
        liveDataContext = magazineBlock + cameraBlock + contentInsight;
        liveDataContext += magazineBlock
          ? `\n⚠️ 위 매거진 기록은 당신이 실제로 발행한 아카이브입니다.\n"내가 뭘 썼더라?" 질문에는 이 데이터를 정확히 참조하세요.\n`
          : '';

      } else if (agentId === 'alex') {
        // 알렉스: 예약 기반 포스트프로덕션 파이프라인 현황
        let pipelineBlock = '';
        if (reservations && reservations.length > 0) {
          const now = new Date();
          // 최근 예약 중 촬영 완료 추정 (귀국일이 지난 예약)
          const returned = reservations.filter(r => {
            if (!r.schedule) return false;
            const dates = r.schedule.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g);
            if (!dates || dates.length < 2) return false;
            const retDate = new Date(dates[1]);
            return retDate < now;
          });
          const upcoming = reservations.filter(r => {
            if (!r.schedule) return false;
            const dates = r.schedule.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g);
            if (!dates || dates.length < 2) return false;
            const depDate = new Date(dates[0]);
            return depDate >= now;
          });
          pipelineBlock = `\n═══════════════════════════════════\n🎬 포스트프로덕션 파이프라인 현황\n═══════════════════════════════════\n촬영 완료 → 편집 대기 (추정): ${returned.length}건\n예정된 촬영 (출발 전): ${upcoming.length}건\n총 예약: ${reservations.length}건\n`;
          // 최근 귀국 완료 5건 상세
          if (returned.length > 0) {
            const recentReturned = returned.slice(0, 5).map(r =>
              `- ${r.name} | ${r.schedule} | 카메라: ${r.cameraId || '미지정'} | 무드: ${r.mood || '-'}`
            ).join('\n');
            pipelineBlock += `\n📸 최근 촬영 완료 (편집 대기):\n${recentReturned}\n`;
          }
        }
        liveDataContext = pipelineBlock + cameraBlock;
        liveDataContext += `\n⚠️ 위 데이터는 시스템에서 실시간 조회한 정확한 데이터입니다.\n작업 현황 질문에는 반드시 이 데이터를 근거로 답변하세요.\n`;
      }

    } catch (err) {
      console.error(`[Live Data] ${agentId}: 실시간 데이터 조회 실패:`, err.message);
    }

    // DB에 사용자 메시지 저장 (발신자 이름 포함)
    await saveAgentChatMessage({ agentId, role: 'user', content: message, senderName: senderName || '' });

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    // ═══ Self-Correction 가드레일 (소뇌 오류-교정 루프) ═══
    // LLM WIKI의 auto_apply_thresholds 개념 이식:
    // 숫자/날짜/사실 언급 시 제공된 컨텍스트와 교차 검증
    const selfCorrectionGuard = `
═══════════════════════════════════
🛡️ 자기 교정 가드레일 (Self-Correction)
═══════════════════════════════════
답변 생성 전 반드시 아래 체크리스트를 내적으로 검증하세요:

1. 📊 숫자 검증: 예약 건수, 날짜, 금액 등 숫자를 언급하려면 반드시 위의 [실시간 카메라 재고 현황], [비즈니스 현황], [기억]에서 근거를 확인하세요. 근거 없는 숫자는 "정확한 수치는 확인 후 말씀드리겠습니다"로 대체하세요.
2. 🗓️ 시간 검증: 위의 [현재 환경 인식]에 표시된 날짜/요일/계절과 모순되는 시간 표현을 사용하지 마세요.
3. 🤝 역할 경계: 다른 에이전트의 전문 영역(물류→지오, CS→리나 등)에 대해 확답하지 말고 "해당 팀에 확인하겠습니다"로 연결하세요.
4. 📌 지시사항 우선: [대표님 지시사항]과 충돌하는 답변은 절대 하지 마세요. 지시사항이 최우선입니다.
5. 🧠 모르면 모른다: 기억이나 컨텍스트에 없는 내용을 지어내지 마세요. "확인 후 답변드리겠습니다"가 더 신뢰할 수 있는 답변입니다.
6. 📦 실시간 데이터 활용: [실시간 카메라 재고 현황]이 제공된 경우, 이 데이터를 근거로 구체적인 수치와 함께 즉시 답변하세요. 이미 확인된 데이터이므로 "확인 후 보고"라는 답변은 절대 불가입니다.
`;

    // 시스템 프롬프트 = 페르소나 + 정체성 목표 + 뇌 컨텍스트 + 실시간 데이터 + 자기 교정
    const fullSystemPrompt = `${persona.persona}${identityGoal}\n\n${brainContext}${liveDataContext}${selfCorrectionGuard}`;

    // 이력 포맷팅 (발신자 이름을 메시지에 주입)
    const contents = history.map(h => {
      const prefix = h.role === 'user' && h.senderName ? `[발신: ${h.senderName} 대표] ` : '';
      return {
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: prefix + h.content }]
      };
    });

    // 현재 유저 입력 추가 (발신자 표시)
    const currentPrefix = senderName ? `[발신: ${senderName} 대표] ` : '';
    contents.push({ role: 'user', parts: [{ text: currentPrefix + message }] });

    const result = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: contents,
      config: {
        systemInstruction: fullSystemPrompt,
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 4096,
      }
    });

    const responseText = result?.candidates?.[0]?.content?.parts?.[0]?.text || result?.text || "답변을 생성하지 못했습니다.";

    // DB에 AI 응답 저장
    await saveAgentChatMessage({ agentId, role: 'model', content: responseText, senderName: persona.name });

    // 🧠 기억 추출 + 크로스 에이전트 공유 (응답 전 실행 — Vercel 서버리스 호환)
    const allMessages = [
      ...history,
      { role: 'user', content: message, senderName: senderName || '' },
      { role: 'model', content: responseText, senderName: persona.name },
    ];
    // 최근 10건만 추출 대상으로 전달 (비용 절약)
    const recentForExtraction = allMessages.slice(-10);

    // 두 파이프라인을 병렬 실행하되, 둘 다 완료된 후 응답
    // Promise.allSettled: 하나가 실패해도 다른 하나에 영향 없음
    await Promise.allSettled([
      runMemoryPipeline(agentId, recentForExtraction),
      detectAndShareCrossAgentKnowledge(agentId, recentForExtraction),
      reinforceMemories(agentId, usedMemoryIds), // Fix 6: 대화에 주입된 기억 강화
    ]).then(results => {
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error(`[Brain/Cross-Agent] ${agentId}:`, r.reason?.message);
        }
      }
    });

    res.status(200).json({
      ok: true,
      reply: responseText,
      agentName: persona.name
    });

  } catch (err) {
    console.error(`[Agent Chat Error - ${agentId}]:`, err);
    res.status(500).json({ ok: false, message: err.message });
  }
}
