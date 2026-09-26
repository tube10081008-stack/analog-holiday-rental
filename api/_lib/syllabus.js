/**
 * 📚 누적 학습 — 목차를 '장 목록'이 아니라 '쌓는 순서'로 쓰기
 *
 * 왜 만들었나:
 *   수업을 만들 때 모델에게 준 건 **오늘 한 장**뿐이었습니다.
 *   앞의 35장에서 뭘 했는지 알려주는 데가 한 군데도 없었습니다.
 *
 *   그런데 프롬프트는 "앞 장에서 나온 것을 되짚어 주세요"라고 시킵니다.
 *   앞 장이 뭐였는지 모르는 모델이 할 수 있는 건 하나뿐입니다 —
 *   그 분야에서 가장 근본적인 것으로 되돌아가는 것. 그래서 36장을 만들어도
 *   60장을 만들어도 발생주의·재무제표·회계등식이 또 나옵니다.
 *   학습자는 매일 한 장씩 나아가는데 **같은 자리를 맴도는 느낌**을 받습니다.
 *
 *   교재 목차는 순서가 곧 설계입니다. 1부를 읽었으니 2부를 읽을 수 있는 거고,
 *   분개를 배웠으니 결산을 배울 수 있는 겁니다. 그 순서를 모델에게 넘깁니다.
 *
 * 설계:
 *   · 본체는 **목차 기반**이라 사람마다 같습니다. 수업은 사람끼리 공유되므로
 *     (findSharedLesson) 개인 정보가 본체에 들어가면 남의 수업이 내 데이터로 만들어집니다.
 *   · 개인적인 것(도감·약한 곳)은 뒤에 짧게만 붙입니다.
 *   · LLM을 부르지 않습니다. 전부 이미 있는 데이터를 엮는 것뿐입니다.
 */

/** 되짚기 후보로 쓸 직전 장 수. 더 늘리면 warmup이 다시 흐려집니다. */
const RECENT = 5;
/** 미리 당겨 쓰지 말라고 보여줄 다음 장 수 */
const AHEAD = 3;

/** '3부 3장 03 실전 분개 실습' / '1.1 현재형' / '12 이차함수' — 과정마다 다른 이름표를 맞춥니다 */
const label = (c) => `${c.sec ? `${c.sec} ` : `${c.no} `}${c.title || ''}`.trim();

/** 묶음 이름 — 회계는 부/단원, 독일어·수학은 단원 */
const groupKey = (c) => (c.part ? `${c.part} · ${c.unit || ''}` : (c.unit || '기타')).trim();

/**
 * 오늘 장 앞에 무엇이 쌓여 있는지를 프롬프트 한 덩어리로 만듭니다.
 *
 * @param {object[]} chapters  과정의 전체 목차 (CHAPTERS)
 * @param {object}   chapter   오늘 만들 장
 * @param {object}   opts
 *   @param {object} opts.collection  도감 { kinds: { 종류: [{front|title}] } }
 *   @param {object[]} opts.gaps      약한 곳 [{ concept, times }]
 *   @param {number[]} opts.doneNos   실제로 끝낸 장 번호
 * @returns {string} generateLesson(chapter, ⬅︎이것)에 그대로 들어갑니다
 */
export function buildPriorContext(chapters, chapter, opts = {}) {
  const { collection = {}, gaps = [], doneNos = [] } = opts;
  const all = Array.isArray(chapters) ? chapters : [];
  const today = Number(chapter?.no) || 0;

  const prior = all.filter(c => Number(c.no) < today);
  const ahead = all.filter(c => Number(c.no) > today).slice(0, AHEAD);
  const recent = prior.slice(-RECENT);

  const out = [];

  /* ── 1. 걸어온 길 ── */
  if (!prior.length) {
    out.push(`## 여기가 출발점입니다
이 과정의 **첫 장들**입니다. 앞에 쌓인 것이 없으니 아무것도 전제하지 말고,
용어 하나하나를 처음 만나는 사람의 자리에서 열어 주세요.`);
  } else {
    // 앞선 장을 부/단원으로 묶어 압축합니다. 69장을 한 줄씩 나열하면
    // 프롬프트만 길어지고 모델은 오히려 덜 봅니다.
    const groups = [];
    for (const c of prior) {
      const k = groupKey(c);
      const g = groups.find(x => x.k === k);
      (g || groups[groups.push({ k, items: [] }) - 1]).items.push(c.title || '');
    }
    out.push(`## 지금까지 걸어온 길 — 교재 목차 순서 (${prior.length}장)
이 수업은 교재 목차를 따라 **한 칸씩 쌓아 올리는** 과정입니다.
학습자는 아래를 이미 한 장씩 읽고, 문제를 풀고, 노트에 손으로 썼습니다.

${groups.map(g => `- **[${g.k}]** ${g.items.filter(Boolean).join(' / ')}`).join('\n')}`);

    /* ── 2. 되짚기는 여기서만 ── */
    out.push(`## 바로 앞 ${recent.length}장 — 되짚을 것은 **여기서만** 고르세요
${recent.map(c => `- ${label(c)}${c.hook ? `\n  └ ${c.hook}` : ''}`).join('\n')}`);
  }

  /* ── 3. 아직 안 나온 것 ── */
  if (ahead.length) {
    out.push(`## 아직 안 나온 것 — 오늘 당겨 쓰지 마세요
${ahead.map(c => `- ${label(c)}`).join('\n')}
필요해지면 "이건 ${label(ahead[0])}에서 제대로 봅니다" 한 줄로 미루세요.`);
  }

  /* ── 4. 이미 학습자 손에 있는 것 ── */
  const kinds = collection?.kinds || {};
  const names = [];
  for (const [kind, list] of Object.entries(kinds)) {
    const ns = (Array.isArray(list) ? list : [])
      .map(c => c?.front || c?.title).filter(Boolean);
    if (ns.length) names.push(`- ${kind}: ${ns.join(', ')}`);
  }
  if (names.length) {
    out.push(`## 이미 학습자 도감에 있는 것 — **다시 카드로 만들지 마세요**
${names.join('\n')}
이 이름들은 설명 없이 그냥 써도 됩니다. 아는 것으로 치세요.`);
  }

  /* ── 5. 약한 곳 (기존) ── */
  out.push(gaps.length
    ? `## 지금까지 관찰된 약한 곳 (설명에 자연스럽게 녹여 주세요)
${gaps.map(g => `- ${g.concept}${g.times ? ` (${g.times}회)` : ''}`).join('\n')}`
    : `## 아직 파악된 약점이 없습니다. 설명하면서 관찰해 주세요.`);

  /* ── 6. 규칙 — 이게 본론입니다 ── */
  out.push(RULES({
    priorCount: prior.length, recentCount: recent.length,
    doneCount: doneNos.length, hasAhead: ahead.length > 0,
  }));

  return out.join('\n\n');
}

/**
 * 누적 규칙.
 * 여기가 "매일 똑같은 걸 하는 느낌"을 직접 막는 자리입니다.
 * 세 교실이 이 문자열을 공유하므로 한 곳만 고치면 전부에 반영됩니다.
 */
const RULES = ({ priorCount, recentCount, doneCount, hasAhead }) => {
  const r = [];

  r.push(priorCount
    ? `**이미 다룬 것을 다시 가르치지 마세요.**
   위 '지금까지 걸어온 길'에 있는 개념은 처음부터 설명하지 말고 **한 줄로 참조만** 하세요.
   ("2부에서 그린 그 표의 오른쪽 위" / "3장에서 세운 등식 그대로")
   앞에 ${priorCount}장이 쌓여 있습니다. 초반 개념을 매 장 처음부터 다시 풀면
   학습자는 매일 한 장씩 나아가면서도 **같은 자리를 맴도는 느낌**을 받습니다. 이게 가장 큰 실패입니다.`
    : `**앞에 쌓인 것이 없습니다.** 이 과정의 첫 장이니 아무것도 전제하지 말고
   용어 하나하나를 처음 만나는 사람의 자리에서 열어 주세요.`);

  r.push(recentCount
    ? `**warmup은 '바로 앞 ${recentCount}장'에서만 고르세요.**
   거기에 오늘 쓰이는 게 없으면 1개만 넣거나, 아예 **빈 배열([])**로 두세요.
   숫자를 채우려고 초반 개념을 끌어오지 마세요.`
    : `**warmup은 빈 배열([])로 두세요.** 되짚을 앞 장이 아직 없습니다.`);

  r.push(`**도감에 이미 있는 것은 cards에 다시 넣지 마세요.** 오늘 처음 나온 것만 카드로.`);

  if (hasAhead) {
    r.push(`**아직 안 나온 것을 미리 당겨 쓰지 마세요.** 뒷장에서 다룰 개념이 필요하면
   "이건 뒤에서 제대로 봅니다" 한 줄로 미루고 오늘 범위 안에서 끝내세요.`);
  }

  r.push(`**오늘 새로 더해지는 것이 무엇인지 분명히 드러나야 합니다.**
   concept 안 어딘가에서 "여기까지는 이미 했고, **오늘 새로 붙는 건 이것**"이
   읽는 사람에게 보여야 합니다. 그게 이 수업이 쌓이고 있다는 유일한 증거입니다.`);

  if (priorCount) {
    r.push(`난이도는 목차 순서를 따라갑니다. 앞 장을 안다는 전제 위에서
   오늘 것을 **한 단계 더 깊게** 다루세요. 다시 입문으로 내려가지 마세요.${
      doneCount ? `\n   (학습자가 실제로 끝낸 장: ${doneCount}장)` : ''}`);
  }

  return `## 이 수업을 만드는 규칙 — 쌓아 올리기\n\n${
    r.map((x, i) => `${i + 1}. ${x}`).join('\n\n')}`;
};

/** 화면·테스트에서 같은 값을 쓰도록 내보냅니다 */
export const WINDOW = { RECENT, AHEAD };
