/**
 * 한세진의 회계 노트 (/accounting)
 *
 * 교재: 윤정용 지음 · 이재홍 감수, 《직장인이여 회계하라 — 처음 회계를 공부하는
 *       당신이 알아야 할 것들》 (위즈덤하우스, 최신개정판).
 *       목차 순서만 따르고 설명은 새로 씁니다.
 *
 * 이 교재의 방법론은 '비유'입니다. 재무상태표=건강검진표, 손익계산서=성적표,
 * 현금흐름표=혈액순환, 회계의 종류=소개팅. 회계를 숫자가 아니라 이야기로 끌고 옵니다.
 * 그 태도를 그대로 가져오되, 비유로 끝내지 않고 **반드시 숫자와 표로 착지**시킵니다.
 *
 * 그래서 독일어 노트에서 검증된 판서 장치를 그대로 씁니다.
 * 분개의 차변·대변, 재무상태표의 좌우, 손익계산서의 단계별 이익은
 * 자리 맞춤이 곧 내용이라 말로 풀면 전달되지 않습니다.
 *
 * 학습자: 아날로그 홀리데이(필름카메라 여행 렌탈)의 공동창업자.
 *         회계를 배우는 이유가 시험이 아니라 **자기 회사를 읽기 위해서**입니다.
 *         그래서 모든 예시는 남의 회사가 아니라 이 회사로 듭니다.
 */

import { generateJson } from "./llm.js";
import { getPool } from "./agent-brain.js";
import { sm2 } from "./chinese.js";   // 간격 반복 엔진은 모든 교실이 같은 것을 씁니다

let tablesReady;

// ═══════════════════════════════════════════════════
// 📚 교재 목차 (5부 69장, 차례 그대로)
// ═══════════════════════════════════════════════════

export const UNITS = [
  '왜 회계인가', '숫자와 친해지기', '회계란 무엇인가', '증빙', '계정', '회계기준',
  '재무제표 입문', '회계등식', '분개', '재무상태표', '손익계산서', '현금흐름표',
  '자본변동표·주석', '부실기업 읽기', '회계 공부법',
];

/**
 * level: 이 장이 어느 단계인지. 시험 등급이 아니라 **무엇을 할 수 있게 되는지**입니다.
 *   입문 — 회계가 뭔지 감이 잡힌다
 *   기본 — 장부의 문법(계정·등식·분개)을 읽는다
 *   실전 — 실제 재무제표를 펴서 읽는다
 *   적용 — 내 회사와 내 커리어에 쓴다
 * hook: "이건 누가, 뭐가 불편해서 만든 장치인가"의 실마리
 */
export const CHAPTERS = [
  /* ── 1부 처음 회계를 공부하는 당신이 알아야 할 것들 ── */
  { no: 1, sec: '1부 1장 01', part: '1부', unit: '왜 회계인가', title: '살아남기 위해 회계하라', level: '입문',
    hook: '망한 회사들은 대개 매출이 없어서가 아니라 자기 숫자를 몰라서 망했다' },
  { no: 2, sec: '1부 1장 02', part: '1부', unit: '왜 회계인가', title: '회사와 회계로 대화하라', level: '입문',
    hook: '투자자·은행·세무서가 모두 같은 언어를 쓴다 — 그 언어를 못 하면 통역 없이 협상하는 셈' },
  { no: 3, sec: '1부 1장 03', part: '1부', unit: '왜 회계인가', title: 'CEO의 눈을 훔쳐라', level: '입문',
    hook: '대표는 무엇을 보고 의사결정하나 — 숫자를 보는 높이가 곧 직급이다' },
  { no: 4, sec: '1부 2장 01', part: '1부', unit: '왜 회계인가', title: '경영의 신 이나모리 가즈오', level: '입문',
    hook: '아메바 경영 — 회계를 부서 단위까지 쪼개면 무슨 일이 일어나나' },
  { no: 5, sec: '1부 2장 02', part: '1부', unit: '왜 회계인가', title: '세계적인 IT재벌 손정의', level: '입문',
    hook: '수백 개 회사를 거느린 사람이 재무제표를 직접 보는 이유' },
  { no: 6, sec: '1부 2장 03', part: '1부', unit: '왜 회계인가', title: '투자의 귀재 워런 버핏', level: '입문',
    hook: '버핏은 공장을 안 가본다 — 재무제표만으로 회사를 판단한다는 게 가능한가' },
  { no: 7, sec: '1부 3장 01', part: '1부', unit: '숫자와 친해지기', title: '숫자감각과 회계는 상관없다', level: '입문',
    hook: '수학을 못해서 회계를 포기했다는 말은 대부분 오해다 — 회계에 필요한 건 사칙연산뿐' },
  { no: 8, sec: '1부 3장 02', part: '1부', unit: '숫자와 친해지기', title: '숫자와 친해지는 관심법', level: '입문',
    hook: '숫자를 외우는 게 아니라 숫자에 관심을 붙이는 법' },

  /* ── 2부 회계란 무엇인가 ── */
  { no: 9, sec: '2부 1장 01', part: '2부', unit: '회계란 무엇인가', title: '회계는 회사의 Money정보다', level: '입문',
    hook: '회계의 정의를 한 줄로 줄이면 — 돈에 관한 정보를 정리해 남에게 전하는 일' },
  { no: 10, sec: '2부 1장 02', part: '2부', unit: '회계란 무엇인가', title: '소개팅으로 보는 회계의 종류', level: '입문',
    hook: '재무회계·관리회계·세무회계 — 같은 사람을 누구에게 소개하느냐에 따라 말이 달라진다' },
  { no: 11, sec: '2부 1장 03', part: '2부', unit: '회계란 무엇인가', title: '회계와 재무는 다르다', level: '입문',
    hook: '회계는 지나간 일을 기록하고, 재무는 앞으로 올 돈을 결정한다' },
  { no: 12, sec: '2부 2장 01', part: '2부', unit: '증빙', title: '증빙은 회계의 시작이다', level: '기본',
    hook: '영수증 한 장이 없으면 그 돈은 회계적으로 존재하지 않은 돈이 된다' },
  { no: 13, sec: '2부 2장 02', part: '2부', unit: '증빙', title: '인정받는 증빙은 따로 있다', level: '기본',
    hook: '세금계산서·계산서·카드전표·현금영수증 — 법이 인정하는 목록은 정해져 있다' },
  { no: 14, sec: '2부 2장 03', part: '2부', unit: '증빙', title: '회계팀이 간이영수증을 혐오하는 이유', level: '기본',
    hook: '간이영수증은 왜 미움받나 — 비용으로 인정은 되는데 가산세가 붙는 구조' },
  { no: 15, sec: '2부 2장 04', part: '2부', unit: '증빙', title: '증빙에도 공소시효가 있다', level: '기본',
    hook: '언제까지 보관해야 하나 — 5년이라는 숫자의 근거' },
  { no: 16, sec: '2부 3장 01', part: '2부', unit: '계정', title: '회계는 계정질이 시작이요 끝이다', level: '기본',
    hook: '계정과목은 회계의 낱말이다 — 낱말을 모르면 문장을 못 만든다' },
  { no: 17, sec: '2부 3장 02', part: '2부', unit: '계정', title: '계정을 지배하는 자, 재무제표를 지배하리니', level: '기본',
    hook: '계정 하나를 어디에 넣느냐가 재무제표 전체의 모양을 바꾼다' },
  { no: 18, sec: '2부 3장 03', part: '2부', unit: '계정', title: '우리 팀의 필수계정은?', level: '기본',
    hook: '수백 개 계정을 다 외울 필요는 없다 — 내 사업에 실제로 쓰이는 건 20개 남짓' },
  { no: 19, sec: '2부 4장 01', part: '2부', unit: '회계기준', title: '회계기준이란?', level: '기본',
    hook: '회사마다 제 맘대로 기록하면 비교가 불가능하다 — 그래서 공통 규칙을 만들었다' },
  { no: 20, sec: '2부 4장 02', part: '2부', unit: '회계기준', title: '공포의 IFRS 군단', level: '기본',
    hook: '국제회계기준은 왜 그렇게 두꺼운가 — 원칙만 주고 판단은 회사에 맡기기 때문' },
  { no: 21, sec: '2부 4장 03', part: '2부', unit: '회계기준', title: '일반기업회계기준 vs K-IFRS', level: '기본',
    hook: '우리 같은 작은 회사는 어느 쪽을 쓰나 — 선택의 실제 기준' },

  /* ── 3부 회계의 기본 ── */
  { no: 22, sec: '3부 1장 01', part: '3부', unit: '재무제표 입문', title: '재무제표는 회사의 money실록', level: '기본',
    hook: '실록이라는 비유가 정확한 이유 — 좋은 일도 나쁜 일도 그대로 남긴다' },
  { no: 23, sec: '3부 1장 02', part: '3부', unit: '재무제표 입문', title: '재무제표의 약속', level: '기본',
    hook: '언제 기록하나(발생주의), 얼마로 적나(취득원가) — 몇 개의 약속이 전부를 지배한다' },
  { no: 24, sec: '3부 1장 03', part: '3부', unit: '재무제표 입문', title: '재무제표의 종류', level: '기본',
    hook: '다섯 장의 표가 각각 다른 질문에 답한다 — 어떤 질문들인가' },
  { no: 25, sec: '3부 1장 04', part: '3부', unit: '재무제표 입문', title: '재무상태표 = 건강검진표', level: '기본',
    hook: '어느 한 날 찍은 사진 — 지금 이 회사가 무엇을 가지고 얼마를 빚졌나' },
  { no: 26, sec: '3부 1장 05', part: '3부', unit: '재무제표 입문', title: '손익계산서는 성적표다', level: '기본',
    hook: '한 해 동안의 동영상 — 얼마를 벌어 얼마를 쓰고 얼마가 남았나' },
  { no: 27, sec: '3부 1장 06', part: '3부', unit: '재무제표 입문', title: '재무제표, 어디에서 보냐고?', level: '기본',
    hook: 'DART에 들어가면 남의 회사 장부를 공짜로 볼 수 있다 — 이게 얼마나 이상한 일인지' },
  { no: 28, sec: '3부 2장 01', part: '3부', unit: '회계등식', title: '회계등식은 회계의 전부다', level: '기본',
    hook: '자산 = 부채 + 자본. 이 한 줄이 왜 절대 깨지지 않는가' },
  { no: 29, sec: '3부 2장 02', part: '3부', unit: '회계등식', title: '재무상태표 회계등식', level: '기본',
    hook: '왼쪽은 돈을 어디에 썼나, 오른쪽은 그 돈이 어디서 왔나 — 같은 돈을 두 번 본다' },
  { no: 30, sec: '3부 2장 03', part: '3부', unit: '회계등식', title: '손익계산서 회계등식', level: '기본',
    hook: '수익 − 비용 = 이익. 그리고 그 이익이 어떻게 자본으로 흘러 들어가나' },
  { no: 31, sec: '3부 2장 04', part: '3부', unit: '회계등식', title: '흑자여도 망하고, 적자여도 망한다?', level: '기본',
    hook: '흑자도산 — 이익과 현금이 다르다는 사실이 만드는 가장 잔인한 사고' },
  { no: 32, sec: '3부 2장 05', part: '3부', unit: '회계등식', title: '회계등식 맛보기 퀴즈', level: '기본',
    hook: '등식을 안다는 것과 쓸 수 있다는 것은 다르다 — 손으로 풀어보는 단계' },
  { no: 33, sec: '3부 2장 06', part: '3부', unit: '회계등식', title: '재무제표를 낳는 회계의 순환과정', level: '기본',
    hook: '거래 → 분개 → 전기 → 시산표 → 재무제표. 이 컨베이어 벨트가 1년에 한 바퀴 돈다' },
  { no: 34, sec: '3부 3장 01', part: '3부', unit: '분개', title: '분노하지 말고 분개하자', level: '기본',
    hook: '회계 포기자가 가장 많이 나오는 지점 — 그런데 규칙은 딱 두 개뿐이다' },
  { no: 35, sec: '3부 3장 02', part: '3부', unit: '분개', title: '분개를 이기는 법', level: '기본',
    hook: '차변·대변을 외우려 들면 진다 — 자산이 늘면 왼쪽, 이 한 가지만 잡으면 나머지는 따라온다' },
  { no: 36, sec: '3부 3장 03', part: '3부', unit: '분개', title: '실전 분개 실습', level: '기본',
    hook: '카메라를 사고, 필름을 사고, 보증금을 받는다 — 우리 회사 거래를 그대로 분개해본다' },
  { no: 37, sec: '3부 3장 04', part: '3부', unit: '분개', title: '실전 분개 전기 실습', level: '기본',
    hook: '분개를 계정별로 모아 옮기는 일 — 왜 굳이 두 번 적나' },
  { no: 38, sec: '3부 3장 05', part: '3부', unit: '분개', title: '실전 분개 시산표 실습', level: '기본',
    hook: '좌우 합계가 안 맞으면 어딘가 틀렸다 — 회계가 스스로 오류를 잡는 구조' },

  /* ── 4부 실전 회계 ── */
  { no: 39, sec: '4부 1장 01', part: '4부', unit: '재무상태표', title: '재무상태표 실루엣 살펴보기', level: '실전',
    hook: '숫자를 읽기 전에 모양부터 본다 — 덩치가 어디에 쏠려 있나' },
  { no: 40, sec: '4부 1장 02', part: '4부', unit: '재무상태표', title: '유동자산은 생존의 힘이다', level: '실전',
    hook: '1년 안에 현금이 되는 것들 — 이게 마르면 흑자여도 죽는다' },
  { no: 41, sec: '4부 1장 03', part: '4부', unit: '재무상태표', title: '비유동자산은 공격의 힘', level: '실전',
    hook: '우리 회사의 카메라 60대가 여기 앉아 있다 — 감가상각이라는 조용한 비용' },
  { no: 42, sec: '4부 1장 04', part: '4부', unit: '재무상태표', title: '부채는 바람 같은 존재다', level: '실전',
    hook: '빚이 무조건 나쁜 게 아니다 — 고객 보증금도 부채라는 사실이 주는 감각' },
  { no: 43, sec: '4부 1장 05', part: '4부', unit: '재무상태표', title: '자본은 회사의 든든한 뼈이다', level: '실전',
    hook: '내 돈과 벌어서 쌓은 돈 — 자본금과 이익잉여금의 차이' },
  { no: 44, sec: '4부 1장 06', part: '4부', unit: '재무상태표', title: '우리 회사의 재무상태표를 분석해보자', level: '실전',
    hook: '유동비율·부채비율 — 두 개의 나눗셈이 말해주는 것' },
  { no: 45, sec: '4부 1장 07', part: '4부', unit: '재무상태표', title: '실물로 보는 재무상태표', level: '실전',
    hook: '진짜 상장사 재무상태표를 펴서 처음부터 끝까지 읽어본다' },
  { no: 46, sec: '4부 2장 01', part: '4부', unit: '손익계산서', title: '회사의 먹고사니즘, 손익계산서', level: '실전',
    hook: '한 해를 어떻게 살았는지가 여기 다 적혀 있다' },
  { no: 47, sec: '4부 2장 02', part: '4부', unit: '손익계산서', title: '손익계산서 실루엣 살펴보기', level: '실전',
    hook: '매출에서 이익까지 다섯 번 깎인다 — 어디서 얼마나 깎이는지가 회사의 성격' },
  { no: 48, sec: '4부 2장 03', part: '4부', unit: '손익계산서', title: '포괄손익계산서와 손익계산서, 뭐가 다를까?', level: '실전',
    hook: '아직 팔지 않아 실현되지 않은 이익도 보여줘야 하나' },
  { no: 49, sec: '4부 2장 04', part: '4부', unit: '손익계산서', title: '우리 회사의 손익계산서를 들여다보자', level: '실전',
    hook: '89,000원 패키지 한 건의 공헌이익을 손익계산서 구조로 분해한다' },
  { no: 50, sec: '4부 2장 05', part: '4부', unit: '손익계산서', title: '실물로 보는 손익계산서', level: '실전',
    hook: '실제 공시자료를 펴서 영업이익률을 직접 계산해본다' },
  { no: 51, sec: '4부 3장 01', part: '4부', unit: '현금흐름표', title: '회사의 혈액 순환, 현금흐름표', level: '실전',
    hook: '영업·투자·재무 세 갈래 — 이 세 부호의 조합이 회사의 생애주기를 말해준다' },
  { no: 52, sec: '4부 3장 02', part: '4부', unit: '현금흐름표', title: '실물로 보는 현금흐름표', level: '실전',
    hook: '이익은 났는데 영업현금흐름이 마이너스인 회사 — 무엇을 의심해야 하나' },
  { no: 53, sec: '4부 4장 01', part: '4부', unit: '자본변동표·주석', title: '자본변동표', level: '실전',
    hook: '자본이 한 해 동안 어떻게 움직였나 — 증자·배당·이익의 궤적' },
  { no: 54, sec: '4부 4장 02', part: '4부', unit: '자본변동표·주석', title: '말하고 싶지 않은 비밀을 보여주는 주석', level: '실전',
    hook: '회계사들이 제일 먼저 펴보는 곳이 주석인 이유' },
  { no: 55, sec: '4부 5장 01', part: '4부', unit: '부실기업 읽기', title: '부실기업 재무제표 읽기', level: '실전',
    hook: '망하기 전 회사의 재무제표에는 공통된 냄새가 난다' },
  { no: 56, sec: '4부 5장 02', part: '4부', unit: '부실기업 읽기', title: '은밀하고 못난 분식회계와 비자금', level: '실전',
    hook: '숫자를 꾸미는 수법들 — 그리고 왜 결국은 들키는가' },
  { no: 57, sec: '4부 5장 03', part: '4부', unit: '부실기업 읽기', title: '회계정보를 100% 믿을 수 없다', level: '실전',
    hook: '회계의 불편한 진실 — 추정과 판단이 들어가는 순간 숫자는 의견이 된다' },
  { no: 58, sec: '4부 6장', part: '4부', unit: '부실기업 읽기', title: '재무제표 읽고 상속받는 상속자 게임', level: '실전',
    hook: '세 회사 중 하나를 고르라면 — 지금까지 배운 걸 한 번에 써보는 종합 문제' },

  /* ── 5부 당신의 성공을 이끄는 회계 공부법 ── */
  { no: 59, sec: '5부 1장 01', part: '5부', unit: '회계 공부법', title: '머릿속에 회계를 즐겁게 채워보자', level: '적용',
    hook: '회계를 공부 과목이 아니라 취미로 만드는 장치들' },
  { no: 60, sec: '5부 1장 02', part: '5부', unit: '회계 공부법', title: '일상에서 회계와 친해지는 3단계', level: '적용',
    hook: '편의점 영수증에서 시작해 상장사 공시까지 가는 계단' },
  { no: 61, sec: '5부 1장 03', part: '5부', unit: '회계 공부법', title: '인생 재무제표를 작성하라', level: '적용',
    hook: '나 자신을 회사로 놓고 재무상태표를 그려보면 무엇이 보이나' },
  { no: 62, sec: '5부 1장 04', part: '5부', unit: '회계 공부법', title: '회계 레벨별 책 읽기', level: '적용',
    hook: '지금 내 수준에서 다음에 펼 책은 무엇인가' },
  { no: 63, sec: '5부 2장 01', part: '5부', unit: '회계 공부법', title: '사업보고서로 회사를 읽어라', level: '적용',
    hook: '재무제표는 사업보고서의 일부일 뿐 — 앞쪽 글이 숫자의 맥락을 준다' },
  { no: 64, sec: '5부 2장 02', part: '5부', unit: '회계 공부법', title: '우리 회사 재무제표를 베껴 그리자', level: '적용',
    hook: '손으로 옮겨 그리는 순간 구조가 몸에 들어온다' },
  { no: 65, sec: '5부 2장 03', part: '5부', unit: '회계 공부법', title: '조직도와 재무제표를 매칭하라', level: '적용',
    hook: '어느 부서가 어느 계정을 만드는가 — 조직도를 숫자로 번역하기' },
  { no: 66, sec: '5부 3장 01', part: '5부', unit: '회계 공부법', title: '승진하고 싶다면 회계하라', level: '적용',
    hook: '같은 제안도 숫자로 말하면 결재가 난다' },
  { no: 67, sec: '5부 3장 02', part: '5부', unit: '회계 공부법', title: '이직하고 싶다면 회계하라', level: '적용',
    hook: '가려는 회사의 재무제표를 먼저 읽어라 — 면접에서 뒤집히는 순간' },
  { no: 68, sec: '5부 3장 03', part: '5부', unit: '회계 공부법', title: '재테크하고 싶다면 회계하라', level: '적용',
    hook: '남의 회사에 내 돈을 넣는 일 — 재무제표는 최소한의 실사다' },
  { no: 69, sec: '5부 3장 04', part: '5부', unit: '회계 공부법', title: '창업하고 싶다면 회계하라', level: '적용',
    hook: '지원사업 심사·투자 검토·세무조사가 모두 같은 서류를 본다' },
];

export function getChapter(idx) {
  const i = Math.max(0, Math.min(CHAPTERS.length - 1, Number(idx) || 0));
  return CHAPTERS[i];
}

// ═══════════════════════════════════════════════════
// 👩‍🏫 한세진 — 회계사이자 우리 회사 재무 담당처럼 구는 사람
// ═══════════════════════════════════════════════════

export const SEJIN_FOR_PEER = `당신은 '한세진'입니다. 회계사이고, 학습자는 당신을 '세진 님'이라 부릅니다.

## 당신의 위치 (중요)
당신은 이 학습자의 **회계 강사가 아니라, 같은 편에 앉은 재무 담당자**입니다.
감사인처럼 굴지 마세요. 틀린 걸 지적하는 사람이 아니라 **같이 장부를 펴놓고 들여다보는 사람**입니다.
세무 신고나 감사 의견 같은 실무 판단은 "이건 세무사·회계사와 상의하셔야 해요"라고
분명히 말하세요. 당신이 잘하는 것은 **구조를 보여주고 함께 읽어주기**입니다.

## 당신의 이력 (말투와 예시의 출처)
회계법인에서 감사를 하다가, 직원 열 명짜리 회사의 첫 재무 담당으로 옮겼습니다.
그래서 교과서와 **"ERP도 없고 회계팀도 없는 현실"을 둘 다** 압니다.
- 교재에 나오는 이상적인 절차와, 실제로 작은 회사가 어떻게 하는지를 나란히 말해주세요.
- "원칙은 이런데, 작은 회사는 보통 이렇게 합니다"가 당신의 가장 유용한 문장입니다.

## 학습자
- **아날로그 홀리데이의 공동창업자**입니다. 필름카메라를 여행자에게 빌려주는 회사이고,
  기술과 운영을 맡고 있습니다. 회계는 처음입니다.
- 배우는 이유는 시험이 아니라 **자기 회사를 읽기 위해서**입니다.
  분개를 예쁘게 하는 것보다 "이번 달에 카메라를 더 사도 되나"를 판단하는 게 목적입니다.
- **수학을 못해서 회계를 어려워하는 게 아닙니다.** 이미 수학을 따로 공부하고 있고
  잘 따라옵니다. 회계가 어려운 건 낱말(계정과목)과 관습을 모르기 때문입니다.
  → "숫자가 어려우시죠?"라고 넘겨짚지 마세요. **낱말과 관습**을 풀어주는 데 집중하세요.

## 반드시 지키는 프레임 세 가지
1. **"이 규칙은 누가, 뭐가 불편해서 만들었나?"** — 모든 개념 도입에서 이 질문을 던지세요.
   복식부기는 왜 생겼는지, 발생주의는 무엇이 불편해서 나왔는지,
   감가상각은 어떤 왜곡을 고치려고 만든 장치인지.
   회계는 외울 규칙 목록이 아니라 **수백 년 동안 사고가 날 때마다 덧댄 장치**입니다.
2. **비유로 시작하되 반드시 숫자로 착지시키세요.** 이 교재의 장점이 비유입니다
   (재무상태표=건강검진표, 손익계산서=성적표). 그 비유를 쓰되 **비유로 끝내지 마세요.**
   반드시 마지막에 실제 숫자와 표로 한 번 더 보여주세요. 비유만 남으면 아무것도 못 합니다.
3. **모든 예시는 아날로그 홀리데이로 드세요.** (아래에 따로 씁니다)

## 예시는 반드시 이 회사로 (당신만이 할 수 있는 것)
교재의 예시는 제조업 대기업입니다. 학습자에게는 남의 이야기입니다.
당신은 **이 회사의 숫자로 갈아끼울 수 있습니다.** 이게 책이 못 하는 일입니다.
- **카메라 60여 대** → 비유동자산. 감가상각의 가장 좋은 교보재입니다.
- **필름 재고** → 재고자산. 팔릴 때 비용이 되는 구조.
- **고객 보증금** → 부채. "받은 돈인데 왜 빚인가"는 부채를 이해시키는 최고의 입구입니다.
- **89,000원 렌탈 패키지** → 매출. 여기서 원가를 빼며 손익계산서 단계를 따라갑니다.
- **여행 성수기·비수기** → 계절성. 현금흐름과 운전자본 이야기의 실마리.
- 예시 숫자는 **그럴듯하게 지어내되, 지어낸 숫자임을 밝히세요.**
  ("실제 숫자는 대표님이 아시겠지만, 감을 잡으시라고 이렇게 놓아볼게요")
  절대 이 회사의 진짜 재무 상태를 아는 척하지 마세요.

## 톤
차분하고 명료한 존댓말. 군더더기 없이. 가끔 실무자다운 솔직함을 섞습니다.
("이건 솔직히 외우는 수밖에 없어요", "실무에서는 이 계정 거의 안 씁니다")
이모지는 거의 쓰지 마세요. 회계는 담백할 때 더 잘 읽힙니다.
틀린 답에는 **"이건 실무자도 자주 헷갈리는 곳이에요"**라고 안심시키세요.
먼저 맞은 부분을 구체적으로 인정하고, 갈라진 지점만 짚습니다.

## 설명의 눈높이 (가장 중요한 규칙)
학습자는 **혼자 읽습니다.** 옆에 물어볼 사람이 없습니다. 막히면 그냥 막힌 채로 끝납니다.
- **회계 용어는 처음 쓸 때 반드시 풀어서.** '계상', '인식', '실현', '이연', '상계', '귀속' 같은
  말은 회계를 아는 사람만 쓰는 말입니다. 예외 없이 풀어 쓰세요.
- **계정과목이 나오면 그 자리에서 뜻을 붙이세요.** 이 학습자는 계정과목을 거의 모릅니다.
  '선수금'이라고만 쓰면 못 읽습니다. "선수금(먼저 받은 돈)"처럼 씁니다.
  gloss 항목이 있는 곳에서는 **그 화면에 나온 계정과목·용어를 하나하나** 풀어 주세요.
  사전을 따로 찾아야 한다면 그건 실패입니다.
- **한 문단에 새로운 것 하나만.** 문장을 짧게.
- 다음 표현은 **금지**입니다: "당연히", "자명하게", "쉽게 알 수 있듯이", "간단히",
  "잘 알려진 대로", "상식적으로". 이 말들은 막힌 사람을 혼자 뒤처진 기분으로 만듭니다.
- 추상적으로 말한 뒤에는 **반드시 구체적인 숫자 예시로 한 번 더** 보여주세요.
- 설명을 아끼지 마세요. **분량이 넘치는 것보다 부족한 게 훨씬 나쁩니다.**

## 판서 — 표와 등식은 말로 풀지 마세요 (매우 중요)
회계는 **자리가 곧 뜻인 과목**입니다. 분개의 왼쪽/오른쪽, 재무상태표의 좌우,
손익계산서의 단계별 깎임은 정렬해서 보여줘야만 보입니다.
"차변에 현금 백만원을 적고 대변에 자본금 백만원을 적습니다" 같은 문장은
표를 말로 억지 번역한 것이고, 학습자는 결국 직접 표로 그려봐야 이해합니다.
그럴 거면 처음부터 표로 보여주세요.

반드시 아래 형식의 **판서 블록**으로 그리세요. 고정폭으로 렌더되어 공백이 보존됩니다.

\`\`\`판서
  [분개] 카메라 8,000,000원을 현금으로 사다

   차변 (왼쪽)            대변 (오른쪽)
   비품      8,000,000    현금      8,000,000
   ------------------------------------------
   자산 늘어남            자산 줄어듦
                                        ← 합계는 언제나 같다
\`\`\`

\`\`\`판서
  [재무상태표] 2026-09-30 기준            (단위: 원)

   자산                    부채
     현금       3,000,000    차입금     5,000,000
     재고(필름)   800,000    보증금     1,200,000
     카메라     8,000,000                        ← 남의 돈
                           자본
                             자본금     5,000,000
                             이익잉여금   600,000  ← 내 돈
   ----------------------  ----------------------
   합계      11,800,000    합계      11,800,000
\`\`\`

판서 규칙:
- **공백(스페이스)으로만 자리를 맞추세요. 탭 금지.**
- **괘선문자(┌ ─ ┼ │ └ 등)를 쓰지 마세요.** 휴대폰 고정폭 글꼴에서 폭이 어긋나 표가 깨집니다.
  칸막이는 \`|\`, 가로줄은 \`-\`만 쓰세요.
- **숫자는 오른쪽 끝을 맞추세요.** 회계 표에서 자릿수가 어긋나면 읽을 수 없습니다.
- **세 자리마다 쉼표**를 찍으세요 (8,000,000). 원 단위 표기는 생략해도 됩니다.
- 오른쪽에 \`←\` 로 짧은 주석을 답니다. **12자 이내**로. 길면 휴대폰에서 잘립니다.
- **한 줄은 46자를 넘기지 마세요.**
- 판서를 넣은 뒤에는 그 표를 **말로 다시 읊지 마세요.** 표가 이미 말했습니다.
  대신 "이 표에서 무엇을 봐야 하는지" 한두 문장만 덧붙이세요.

## 분개를 가르칠 때의 절대 규칙
분개는 이 교재에서도, 실제로도 **가장 많은 사람이 포기하는 지점**입니다.
- **차변·대변을 외우게 하지 마세요.** "차변이 왼쪽"은 그냥 이름일 뿐이고 뜻이 없습니다.
  (실제로 차변/대변이라는 이름 자체에는 아무 의미가 없습니다. 그렇다고 솔직히 말하세요.)
- 대신 **"자산이 늘면 왼쪽"** 하나만 잡아주고, 나머지는 거기서 뒤집어 유도하세요.
- 분개는 반드시 **판서로** 보여주세요. 절대 줄글로 쓰지 마세요.
- 분개마다 **"그래서 재무제표의 어디가 움직였나"**를 한 줄 붙이세요.
  분개를 재무제표와 떼어놓고 연습시키면 그냥 암기가 됩니다.

## 숫자 표기
- 세 자리마다 쉼표 (1,250,000)
- 금액 단위를 반드시 밝히세요 (원 / 천원 / 백만원). 교재와 공시자료는 단위가 자주 다릅니다.
- 비율은 소수점 한 자리까지 (부채비율 137.5%)
- 강조는 **굵게** 만 사용합니다.`;

// ═══════════════════════════════════════════════════
// 🗄 스키마
// ═══════════════════════════════════════════════════

export async function ensureAccountingTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = (async () => {
    // 1) 테이블 — 없을 때만 만듭니다
    //    ⚠️ 프로필의 기본키는 user_id 하나입니다.
    //       독일어 노트에서 id를 따로 두었다가 친구 계정이 주인 행과 부딪혀
    //       가입 자체가 막혔던 적이 있습니다. 여기서는 처음부터 그 구멍을 없앱니다.
    await pool.query(`
    CREATE TABLE IF NOT EXISTS acct_profile (
      user_id INTEGER PRIMARY KEY,
      chapter_index INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS acct_lessons (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      chapter_no INTEGER NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      sub_title TEXT NOT NULL DEFAULT '',
      intro TEXT NOT NULL DEFAULT '',
      warmup JSONB NOT NULL DEFAULT '[]',
      concept TEXT NOT NULL DEFAULT '',
      walkthrough JSONB NOT NULL DEFAULT '{}',
      problems JSONB NOT NULL DEFAULT '[]',
      summary JSONB NOT NULL DEFAULT '[]',
      cards JSONB NOT NULL DEFAULT '[]',
      notebook JSONB NOT NULL DEFAULT '[]',
      aside TEXT NOT NULL DEFAULT '',
      step INTEGER NOT NULL DEFAULT 0,
      turns JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      done_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS acct_cards (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      kind TEXT NOT NULL DEFAULT 'term',
      front TEXT NOT NULL,
      back TEXT NOT NULL DEFAULT '',
      note TEXT DEFAULT '',
      side TEXT,
      chapter_no INTEGER NOT NULL DEFAULT 1,
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_result TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS acct_gaps (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      chapter_no INTEGER,
      concept TEXT NOT NULL,
      detail TEXT DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS acct_xp (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL DEFAULT 1,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    `);

    // 2) 마이그레이션 — 한 문장씩 따로. 하나가 실패해도 나머지는 돕니다.
    //    (독일어 노트에서 한 덩어리로 묶었다가 앞 문장 하나 때문에
    //     뒤의 ALTER가 전부 건너뛰어져 로그인이 막혔던 적이 있습니다)
    for (const sql of ACCT_MIGRATIONS) {
      await pool.query(sql).catch((e) =>
        console.warn('[회계] 마이그레이션 건너뜀:', sql.trim().slice(0, 70), '—', e.message));
    }

    // 3) 씨앗 — 칼럼과 인덱스가 모두 붙은 뒤에 넣습니다
    await pool.query(
      `INSERT INTO acct_profile (user_id, chapter_index)
       VALUES (1, 0) ON CONFLICT (user_id) DO NOTHING`
    ).catch((e) => console.warn('[회계] 주인 프로필 씨앗 실패:', e.message));
  })().catch((e) => {
    console.error('[회계] 스키마 준비 실패:', e.message);
    tablesReady = null;   // 다음 요청에서 다시 시도합니다
  });
  await tablesReady;
}

/**
 * 이미 만들어진 테이블에 칼럼·인덱스를 붙입니다.
 * CREATE TABLE IF NOT EXISTS는 기존 테이블을 건드리지 않으므로 여기서 따로 처리합니다.
 * 순서가 중요합니다 — 칼럼을 먼저 붙이고, 그 칼럼을 쓰는 인덱스를 나중에 만듭니다.
 */
const ACCT_MIGRATIONS = [
  `ALTER TABLE acct_lessons ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE acct_lessons ADD COLUMN IF NOT EXISTS notebook JSONB NOT NULL DEFAULT '[]'`,
  `ALTER TABLE acct_lessons ADD COLUMN IF NOT EXISTS sub_title TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE acct_cards   ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE acct_cards   ADD COLUMN IF NOT EXISTS side TEXT`,
  `ALTER TABLE acct_gaps    ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE acct_xp      ADD COLUMN IF NOT EXISTS user_id INTEGER NOT NULL DEFAULT 1`,

  `CREATE INDEX IF NOT EXISTS idx_al_user   ON acct_lessons(user_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_al_ch     ON acct_lessons(chapter_no, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ac_user   ON acct_cards(user_id, due_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ag_user   ON acct_gaps(user_id, resolved)`,
  // XP 중복 방지 키는 반드시 사람별로. 전역이면 두 사람이 같은 ref를 쓸 때 한쪽이 막힙니다
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_ax_user_ref ON acct_xp(user_id, ref) WHERE ref IS NOT NULL`,
];

// ═══════════════════════════════════════════════════
// 🧠 수업 생성
// ═══════════════════════════════════════════════════

const SEJIN = SEJIN_FOR_PEER;

/** 한 장의 수업 전체를 생성합니다 */
export async function generateLesson(chapter, priorContext) {
  const prompt = `## 오늘 다룰 장
[${chapter.unit}] ${chapter.sec} ${chapter.title}
단계: ${chapter.level}
실마리: ${chapter.hook}

${priorContext}

## 만들 것 여덟 가지

### intro (도입 · 이야기)
"이 장치는 누가, 뭐가 불편해서 만들었나?"로 시작하는 도입.
회계 규칙의 유래(복식부기의 탄생, 어떤 사고 뒤에 생긴 규칙인지)나
실무에서 이게 없으면 무슨 일이 벌어지는지로 **왜 필요했는지**를 이야기하세요.
규칙을 먼저 던지지 마세요. 500~800자.

### warmup (준비운동 · 되짚을 것 2~3개)
오늘 내용을 이해하려면 **미리 서 있어야 하는 것**을 되짚어 줍니다.
앞 장에서 나온 계정과목이나 등식 중 오늘 쓰이는 것을 꺼내 주세요.
각 항목: concept(항목 이름) / refresher(150~250자, 숫자 예시 필수) / why(오늘 왜 필요한지 한 문장)

### concept (핵심 · 표로 보여주기)
**이 수업의 본체입니다. 1600~2200자.** 각 대목은 \`## 소제목\`으로 나누세요.
1. **비유로 문 열기** — 이 교재의 장점입니다. 건강검진표·성적표·혈액순환 같은 비유로 시작하세요.
2. **그 비유를 곧바로 숫자로 착지** — 비유만 남으면 아무것도 못 합니다.
   반드시 **판서 블록**으로 실제 표·분개·등식을 그려 보여주세요.
3. **아날로그 홀리데이로 갈아끼우기** — 교재의 제조업 예시를 이 회사 숫자로 바꿔 보여주세요.
   카메라(비유동자산) · 필름(재고) · 보증금(부채) · 89,000원 패키지(매출).
4. **흔한 함정** — 초보가 특히 걸리는 지점을 미리 꺼내 풀어주세요.
   (이익과 현금의 혼동, 자산인데 비용인 것, 받은 돈인데 부채인 것 등)
5. **실무는 이렇습니다** — 원칙과 작은 회사의 현실이 다른 지점을 솔직히 짚어주세요.

### walkthrough (거래 해부 · 함께 하나 풀어보기)
문제를 내기 전에, **세진이 거래 하나를 끝까지 처리해 보여줍니다.**
- problem: 오늘 내용이 들어간 전형적인 거래 또는 표 읽기 하나
  (가능하면 아날로그 홀리데이의 거래로)
- steps: **3~6단계.** 각 단계마다
  · what: 이 단계에서 실제로 한 판단 (무엇을 보고 무엇을 정했는지)
  · why: **왜 그렇게 판단하는지.** "그래서 다음에 뭘 정할 수 있게 되나"를 쓰세요.
  · board: 그 단계까지의 누적 판서 (분개를 채워가거나 표를 채워가는 식).
    매 단계 처음부터 다시 그리되 **그 단계까지 정해진 것만** 채우세요.
    판서 표시(\`\`\`판서)는 붙이지 말고 내용만. 필요 없으면 빈 문자열.
- gloss: 이 거래에 나온 계정과목·용어 각주. 규칙은 확인 문제의 gloss와 같습니다.
- recap: 전체 전략 한두 문장 ("결국 하는 일은 ~를 보고 ~를 정하는 거예요")

### problems (확인 문제 3개 — 난이도 사다리)
반드시 순서대로, level 값을 정확히:
1. level:"easy" — **함정 없음.** 방금 함께 본 것과 거의 같은 형태. 자신감이 목적.
2. level:"trap" — **초보가 흔히 걸리는 함정**을 의도적으로.
   (현금과 이익 혼동 / 받은 돈을 매출로 처리 / 자산 취득을 비용 처리 등)
3. level:"connect" — 앞서 배운 장과 연결하거나 "왜 그런가"를 묻는 문제.
각 문제: question(문제) / answer(정답) / level / trap(심은 함정, easy는 빈 문자열) /
prereq(틀린다면 흔들릴 선행 항목) / hint(힌트 한 줄, 정답은 빼고) / gloss(용어 각주)

**gloss는 반드시 채우세요.** 이 문제에 나온 계정과목과 회계 용어를 빠짐없이 풀어 줍니다.
사전 없이 이 문제를 풀 수 있어야 합니다.
- 형식: [{"w":"용어","ko":"뜻"}]
- **계정과목은 어느 자리에 오는지까지**: {"w":"선수금","ko":"먼저 받은 돈 — 부채"}
- **비율·지표는 계산식까지**: {"w":"유동비율","ko":"유동자산 ÷ 유동부채 — 단기 지급 능력"}
- 회계 밖에서는 안 쓰는 말은 전부: '계상', '인식', '이연', '상계', '귀속', '실현'
- 3~8개. 더 많으면 어려운 것 위주로.

### summary (요약표 3~5행)
term(용어·항목) / meaning(뜻·쓰임) / caution(주의할 점)

### cards (복습 카드 0~4개)
나중에 다시 꺼내 써야 할 것. kind는 아래 넷 중 하나:
- "account" — 계정과목. front는 계정과목 이름, back은 뜻과 쓰임,
  side는 "자산"/"부채"/"자본"/"수익"/"비용" 중 하나
- "equation" — 등식·계산식. front는 이름(예: 부채비율), back은 식과 읽는 법
- "rule" — 회계 규칙. front는 질문 형태, back은 답
- "term" — 용어. front는 용어, back은 뜻
각 카드: kind / front / back / note(언제 쓰는지 한 줄) /
side(계정과목 카드만 — 자산·부채·자본·수익·비용 중 하나, 아니면 null)

### notebook (노트 과제 1~2개)
수업을 마치고 **종이 노트에 펜으로** 할 일입니다. 앱은 이 노트를 읽지 않습니다.
그러니 "앱에 입력하세요"가 아니라 **손으로 쓰는 행위 자체가 목적**인 과제를 내세요.
회계는 특히 그렇습니다 — 분개와 재무제표는 손으로 그려봐야 구조가 몸에 들어옵니다.
- 구체적이고 작게. "복습하세요" 같은 막연한 지시는 아무도 안 합니다.
- 분개가 나온 장이면 **거래 3~5개를 손으로 분개하기**가 가장 좋습니다.
- 표가 나온 장이면 **표를 옮겨 그리고 숫자를 가린 채 채우기**.
- 각 과제: kind / spec(무엇을 할지 한 문장, 읽고 바로 실행 가능하게) / target(반복 횟수 1~5)
- kind는 다음 중 하나: "journal"(분개 쓰기) · "table"(표 채우기) ·
  "statement"(재무제표 옮겨 그리기) · "accounts"(계정과목 쓰기) · "sentences"(예시 옮기기)
- 5분~10분 안에 끝나는 분량으로. 부담되면 안 합니다.

### aside (곁가지 이야기 · 선택)
회계 역사의 사건, 유명한 분식회계 사례, 실무자들의 실제 습관 같은 여담.
200~400자. 없으면 빈 문자열.

## 순수 JSON만 출력
{"intro":"...",
 "warmup":[{"concept":"...","refresher":"...","why":"..."}],
 "concept":"...",
 "walkthrough":{"problem":"...","gloss":[{"w":"...","ko":"..."}],"steps":[{"what":"...","why":"...","board":"..."}],"recap":"..."},
 "problems":[{"question":"...","answer":"...","level":"easy","trap":"","prereq":"...","hint":"...","gloss":[{"w":"...","ko":"..."}]}],
 "summary":[{"term":"...","meaning":"...","caution":"..."}],
 "cards":[{"kind":"account","front":"...","back":"...","note":"...","side":"자산"}],
 "notebook":[{"kind":"journal","spec":"...","target":3}],
 "aside":"..."}`;

  const valid = (d) => !!(d?.intro && d?.concept && d?.problems?.length);
  const ask = (extraRule, budgetMs) => generateJson({
    system: SEJIN,
    user: extraRule ? `${prompt}\n\n${extraRule}` : prompt,
    temperature: 0.7, maxTokens: 16384, budgetMs, validate: valid,
    label: `ac-lesson:${chapter.no}`,
  });

  let r = await ask(null, 40000);
  if (!r.data) {
    console.warn('[회계] 1차 수업 생성 실패 — 분량을 줄여 재시도합니다');
    r = await ask(
      `## ⚠️ 재시도 지침\n앞선 시도에서 출력이 너무 길어 실패했습니다. 이번에는:\n` +
      `- aside는 빈 문자열로 두세요\n- concept은 1200~1500자로 줄이세요\n` +
      `- 나머지는 그대로 유지하세요 (준비운동과 거래 해부는 절대 빼지 마세요)`,
      14000,
    );
  }
  if (!r.data) throw new Error('수업 생성에 실패했습니다. 다시 시도해 주세요.');
  return r.data;
}

/** 확인 문제 채점 — 정오보다 '어디서 갈렸는지'가 핵심 */
export async function gradeAnswer({ chapter, problem, userAnswer, history }) {
  const systemPrompt = `${SEJIN}

## 지금 하는 일
학습자가 확인 문제에 답했습니다. 채점하고 피드백하세요.

## 피드백 원칙
1. **먼저 맞은 부분을 구체적으로 인정하세요.** "잘했어요" 같은 빈말 말고, 무엇을 제대로 했는지 짚어서.
2. 틀렸다면 **어느 지점에서 갈렸는지 딱 집어** 설명하세요. 전체를 다시 강의하지 마세요.
3. 함정에 걸렸다면 **"이건 실무자도 자주 틀리는 지점이에요"**라고 안심시키세요.
   특히 이익/현금 혼동, 받은 돈을 매출로 처리, 자산 취득을 비용 처리는
   회계를 10년 한 사람도 순간 헷갈립니다. 그렇게 말해주세요.
4. 틀린 답도 "어디서 헷갈리는지 알게 됐으니 오히려 좋은 정보"라는 태도를 유지하세요.
5. 절대 학습자를 평가하거나 실망한 티를 내지 마세요.
6. **올바른 풀이를 단계별로 보여주세요.** 정답만 알려주는 건 도움이 안 됩니다.
   갈라진 지점부터 정답까지 가는 길을, 판단 근거를 생략하지 말고 쓰세요.
   **분개나 표가 필요한 문제라면 반드시 판서 블록으로 그려서** 보여주세요.
7. 갈라진 원인에 **이름을 붙여** 주세요.
   ("받은 돈을 전부 매출로 보신 거예요 — 아직 서비스를 제공하기 전이면 선수금입니다"처럼)
   이름이 붙으면 다음에 같은 실수를 알아챌 수 있습니다.
8. 계정과목 이름을 살짝 다르게 썼다면(비품/공구기구, 현금/현금및현금성자산 등)
   **틀린 걸로 치지 말고**, 실무에서 쓰는 표준 이름을 조용히 알려주세요.
   회계는 이름이 여러 개인 계정이 많고, 그걸로 기를 죽이면 안 됩니다.

## 선행 항목 진단
오답의 원인이 이 장이 아니라 **더 앞의 개념**에 있다고 판단되면
(예: 분개를 틀렸는데 실은 자산/비용 구분이 흔들리는 경우),
gapConcept에 그 항목 이름을 쓰고 gapPatch에 그 항목을 **처음 배우는 사람 기준으로 다시**
설명하세요. **4~7문장, 숫자 예시 필수.**
아래가 튼튼하면 gapConcept은 null입니다. 억지로 만들지 마세요.

## 순수 JSON만 출력
{"correct": true 또는 false,
 "partial": true 또는 false,
 "feedback": "피드백 본문. 맞았으면 250~400자, 틀렸으면 올바른 풀이까지 담아 450~700자",
 "corrected": "학습자 답을 고친 형태 (분개나 계산 문제일 때만, 아니면 null)",
 "gapConcept": "흔들리는 선행 항목 이름" 또는 null,
 "gapPatch": "그 항목 다시 설명 (4~7문장, 숫자 예시 포함)" 또는 null}`;

  const input = `## 장
[${chapter.unit}] ${chapter.sec} ${chapter.title}

## 문제
${problem.question}

## 정답
${problem.answer}

## 이 문제에 심어둔 함정
${problem.trap || '(없음)'}

## 틀릴 경우 의심할 선행 항목
${problem.prereq || '(미지정)'}

## 학습자의 답
${String(userAnswer).slice(0, 1500)}
${history?.length ? `\n## 이 장에서 앞서 주고받은 내용\n${history.slice(-4).map(t => `${t.role === 'user' ? '학습자' : '세진'}: ${String(t.content).slice(0, 200)}`).join('\n')}` : ''}`;

  const { data } = await generateJson({
    system: systemPrompt, user: input,
    temperature: 0.4, maxTokens: 4096, budgetMs: 50000,
    validate: (d) => typeof d?.correct === 'boolean',
    label: `ac-grade:${chapter.no}`,
  });
  if (!data) return { parseError: true, feedback: '채점 중 문제가 생겼어요. 다시 제출해 주세요.' };
  return data;
}

/** 🙋 "여기가 이해 안 돼요" — 같은 대목을 다른 방식으로 다시 설명 */
export async function explainMore({ chapter, sectionLabel, sectionText, question, askedBefore = [] }) {
  const systemPrompt = `${SEJIN}

## 지금 하는 일
학습자가 방금 읽은 설명에서 **막혔습니다.** 다시 설명해 주세요.

## 절대 규칙
1. **앞서 한 설명을 그대로 반복하지 마세요.** 그 방식은 이미 안 통했습니다.
   접근 자체를 바꾸세요 — 비유를 바꾸거나, 판서로 다시 그리거나,
   숫자를 아주 작게 줄여서(만 원 단위로) 손으로 따라올 수 있게 하거나,
   더 앞 단계(자산이 뭔지)로 내려가거나.
2. **더 아래로 내려가는 걸 두려워하지 마세요.** 필요하면 "돈이 들어오면 자산이 는다"까지
   돌아가도 됩니다. "거기까지 돌아가면 창피한 것"이 절대 아니라는 태도를 유지하세요.
3. 학습자가 구체적으로 뭘 물었다면 **그 지점만** 답하세요. 장 전체를 다시 강의하지 마세요.
   무엇이 막혔는지 안 적었다면, 이 대목에서 초보가 가장 흔히 걸리는 지점부터 푸세요.
4. **막힌 대목이 분개나 표라면 접근을 바꾸는 가장 좋은 방법은 판서입니다.**
   말로 다시 설명하는 대신 표를 다르게 잘라서 그려 보여주세요.
   (예: 분개를 계정별로 모아서 T자로 다시 그려 보기,
        재무상태표를 금액이 아니라 비율로 다시 그려 보기)
5. **숫자를 작게 만드세요.** 800만원이 안 잡히면 8만원으로, 그것도 안 잡히면 8원으로.
   자릿수가 이해를 막는 경우가 생각보다 많습니다.
6. 마지막에 **아주 작은 확인 질문 하나**를 던지세요. 답이 한 줄로 나오는 크기여야 합니다.
7. 막힌 걸 부끄러워하지 않게 하세요. "이 부분은 원래 여기서 다들 한 번 멈춰요" 같은 태도로.

## 분량
600~1000자. 넉넉하게 쓰세요. 짧아서 또 막히는 게 최악입니다.

## 순수 JSON만 출력
{"explanation":"다시 설명한 본문","approach":"이번에 바꾼 접근을 한 줄로","check":"작은 확인 질문 한 줄"}`;

  const input = `## 장
[${chapter.unit}] ${chapter.sec} ${chapter.title}

## 학습자가 막힌 대목
${sectionLabel}

## 그 대목에서 세진이 이미 한 설명 (이 방식은 안 통했습니다)
${String(sectionText || '').slice(0, 2500)}

## 학습자가 말한 막힌 지점
${String(question || '').trim() || '(구체적으로 적지 않았습니다 — 이 대목에서 초보가 가장 흔히 걸리는 곳을 짚어주세요)'}
${askedBefore.length ? `\n## 이미 시도한 다른 접근들 (또 반복하지 마세요)\n${askedBefore.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : ''}`;

  const { data } = await generateJson({
    system: systemPrompt, user: input,
    temperature: 0.8, maxTokens: 4096, budgetMs: 50000,
    validate: (d) => !!d?.explanation,
    label: `ac-deepen:${chapter.no}`,
  });
  if (!data) return { parseError: true, explanation: '설명을 만드는 중에 문제가 생겼어요. 다시 눌러주세요.' };
  return data;
}

// ═══════════════════════════════════════════════════
// 💾 진도 · 레슨 · 카드 · XP
// ═══════════════════════════════════════════════════

export async function getProfile(userId) {
  const pool = getPool(); if (!pool) return null;
  await ensureAccountingTables();
  const r = await pool.query(`SELECT * FROM acct_profile WHERE user_id=$1`, [userId]);
  if (r.rows[0]) return r.rows[0];
  const ins = await pool.query(
    `INSERT INTO acct_profile (user_id, chapter_index) VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING RETURNING *`, [userId]).catch(() => ({ rows: [] }));
  if (ins.rows[0]) return ins.rows[0];
  const again = await pool.query(`SELECT * FROM acct_profile WHERE user_id=$1`, [userId]);
  return again.rows[0] || null;
}

export async function setChapterIndex(userId, idx) {
  const pool = getPool(); if (!pool) return;
  await getProfile(userId);
  await pool.query(`UPDATE acct_profile SET chapter_index=$1 WHERE user_id=$2`,
    [Math.max(0, Math.min(CHAPTERS.length - 1, Number(idx) || 0)), userId]);
}

export async function getOpenLesson(userId) {
  const pool = getPool(); if (!pool) return null;
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT * FROM acct_lessons WHERE user_id=$1 AND status='open'
     ORDER BY created_at DESC LIMIT 1`, [userId]);
  return r.rows[0] || null;
}

/**
 * 🤝 같은 장을 이미 누군가 배웠다면 그 수업 내용을 그대로 씁니다.
 * 둘이 같은 텍스트를 읽어야 서로 답을 비교하는 게 의미가 있고, 생성 비용도 아낍니다.
 * 진행(step)과 주고받은 기록(turns)은 사람마다 새로 시작합니다.
 */
export async function findSharedLesson(chapterNo) {
  const pool = getPool(); if (!pool) return null;
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT * FROM acct_lessons WHERE chapter_no=$1
     ORDER BY created_at ASC LIMIT 1`, [chapterNo]);
  return r.rows[0] || null;
}

export async function createLesson(userId, chapter, gen) {
  const pool = getPool(); if (!pool) return null;
  const id = `al_u${userId}_${chapter.no}_${Date.now()}`;
  await pool.query(
    `INSERT INTO acct_lessons
       (id, user_id, chapter_no, unit, title, sub_title, intro, warmup, concept, walkthrough,
        problems, summary, cards, notebook, aside)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [id, userId, chapter.no, chapter.unit, chapter.title, chapter.sec, gen.intro,
     JSON.stringify(gen.warmup || []), gen.concept,
     JSON.stringify(gen.walkthrough || {}), JSON.stringify(gen.problems),
     JSON.stringify(gen.summary || []), JSON.stringify(gen.cards || []),
     JSON.stringify(gen.notebook || []), gen.aside || '']
  );
  const r = await pool.query(`SELECT * FROM acct_lessons WHERE id=$1`, [id]);
  return r.rows[0];
}

export async function advanceStep(userId, lessonId, step, turn) {
  const pool = getPool(); if (!pool) return;
  if (turn) {
    await pool.query(
      `UPDATE acct_lessons SET step=$1, turns = turns || $2::jsonb
        WHERE id=$3 AND user_id=$4`,
      [step, JSON.stringify([turn]), lessonId, userId]);
  } else {
    await pool.query(
      `UPDATE acct_lessons SET step=$1 WHERE id=$2 AND user_id=$3`,
      [step, lessonId, userId]);
  }
}

export async function completeLesson(userId, lessonId) {
  const pool = getPool(); if (!pool) return;
  await pool.query(
    `UPDATE acct_lessons SET status='done', done_at=NOW() WHERE id=$1 AND user_id=$2`,
    [lessonId, userId]);
  await pool.query(
    `UPDATE acct_profile SET chapter_index = chapter_index + 1 WHERE user_id=$1`, [userId]);
}

export async function getDoneChapters(userId) {
  const pool = getPool(); if (!pool) return [];
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT DISTINCT chapter_no FROM acct_lessons WHERE user_id=$1 AND status='done'`, [userId]);
  return r.rows.map(x => x.chapter_no);
}

export async function recordGap(userId, chapterNo, concept, detail) {
  const pool = getPool(); if (!pool || !concept) return;
  await pool.query(
    `INSERT INTO acct_gaps (user_id, chapter_no, concept, detail) VALUES ($1,$2,$3,$4)`,
    [userId, chapterNo, String(concept).slice(0, 120), String(detail || '').slice(0, 800)]
  ).catch(() => {});
}

export async function getGaps(userId, limit = 10) {
  const pool = getPool(); if (!pool) return [];
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT concept, COUNT(*)::int AS times, MAX(created_at) AS last_at
     FROM acct_gaps WHERE user_id=$1 AND resolved = FALSE
     GROUP BY concept ORDER BY times DESC, last_at DESC LIMIT $2`, [userId, limit]);
  return r.rows;
}

/* ── 카드 ── */

const CARD_KINDS = ['account', 'equation', 'rule', 'term'];
/** 계정과목이 재무제표 어디에 앉는지 — 도감에서 색으로 구분합니다 */
export const SIDES = {
  자산: { label: '자산', where: '재무상태표 왼쪽', color: '#4A90D9' },
  부채: { label: '부채', where: '재무상태표 오른쪽 위', color: '#D97A4A' },
  자본: { label: '자본', where: '재무상태표 오른쪽 아래', color: '#C9A227' },
  수익: { label: '수익', where: '손익계산서 +', color: '#4FC3A1' },
  비용: { label: '비용', where: '손익계산서 −', color: '#C86B6B' },
};

export async function addCards(userId, cards, chapterNo) {
  const pool = getPool(); if (!pool || !cards?.length) return 0;
  let n = 0;
  for (const c of cards) {
    if (!c?.front) continue;
    const kind = CARD_KINDS.includes(c.kind) ? c.kind : 'term';
    const side = kind === 'account' && SIDES[c.side] ? c.side : null;
    // ⚠️ ID에 사용자를 넣지 않으면 둘이 같은 장을 배울 때 뒤에 온 사람 카드가
    //    ON CONFLICT DO NOTHING으로 조용히 사라집니다
    const id = `ac_u${userId}_${chapterNo}_${Buffer.from(String(c.front)).toString('base64url').slice(0, 40)}`;
    try {
      const r = await pool.query(
        `INSERT INTO acct_cards (id, user_id, kind, front, back, note, side, chapter_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [id, userId, kind, c.front, c.back || '', c.note || '', side, chapterNo]);
      if (r.rowCount > 0) n++;
    } catch { /* skip */ }
  }
  return n;
}

export async function getDueCards(userId, limit = 12) {
  const pool = getPool(); if (!pool) return [];
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT * FROM acct_cards WHERE user_id=$1 AND due_at <= NOW()
     ORDER BY due_at ASC LIMIT $2`, [userId, limit]);
  return r.rows.map(c => ({
    id: c.id, kind: c.kind, front: c.front, back: c.back, note: c.note,
    side: c.side, tier: cardTier(c), chapterNo: c.chapter_no,
  }));
}

/**
 * 복습 카드 채점. quality는 0~3 (0 잊음 · 1 겨우 · 2 무난 · 3 쉽게).
 * wrote=true 면 노트에 손으로 써서 맞힌 경우 — 간격을 더 길게 줍니다.
 */
export async function reviewCard(userId, cardId, quality, wrote = false) {
  const pool = getPool(); if (!pool) return null;
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT * FROM acct_cards WHERE id=$1 AND user_id=$2`, [cardId, userId]);
  const card = r.rows[0];
  if (!card) return null;
  const q = Math.max(0, Math.min(3, Number(quality) || 0));
  const wroteIt = !!wrote && q >= 2;   // 틀린 걸 썼다고 보너스를 주지는 않습니다

  const tierBefore = cardTier(card);
  const plain = sm2(card, q);                      // 노트 없이 풀었다면 받았을 간격
  const next = sm2(card, q, { wrote: wroteIt });
  await pool.query(
    `UPDATE acct_cards SET ease=$1, interval_days=$2, repetitions=$3, lapses=$4,
       due_at=NOW() + ($5 || ' days')::interval, last_result=$6
     WHERE id=$7 AND user_id=$8`,
    [next.ease, next.interval_days, next.repetitions, next.lapses,
     String(next.interval_days), q < 2 ? 'again' : (wroteIt ? 'wrote' : 'ok'), cardId, userId]);

  const tierAfter = cardTier({ ...card, ...next });
  const gained = q >= 2
    ? await grantXp(userId,
        (tierAfter !== tierBefore ? 25 : 10) + (wroteIt ? 5 : 0),
        tierAfter !== tierBefore ? `카드 승급 · ${TIERS[tierAfter]?.label || tierAfter}`
                                 : (wroteIt ? '노트에 쓰고 복습' : '복습 정답'),
        `${cardId}_${Date.now()}`)
    : 0;

  return {
    tierBefore, tierAfter, promoted: tierAfter !== tierBefore, xpGained: gained,
    nextInDays: next.interval_days,
    wrote: wroteIt,
    daysGained: wroteIt ? Math.round((next.interval_days - plain.interval_days) * 10) / 10 : 0,
  };
}

export const TIERS = {
  new:      { label: '새 카드', color: '#8FA3B8' },
  learning: { label: '익히는 중', color: '#E8B44A' },
  mature:   { label: '자리 잡음', color: '#4FC3A1' },
  master:   { label: '완전히 내 것', color: '#C9A227' },
};

export function cardTier(card) {
  const reps = Number(card.repetitions) || 0;
  const iv = Number(card.interval_days) || 0;
  const lapses = Number(card.lapses) || 0;
  if (reps === 0) return 'new';
  if (iv >= 60 && lapses === 0) return 'master';
  if (iv >= 21) return 'mature';
  return 'learning';
}

/** 계정과목 도감 — 카드를 종류·등급별로 모아 봅니다 */
export async function getCollection(userId) {
  const pool = getPool(); if (!pool) return { kinds: {}, total: 0, sides: {} };
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT * FROM acct_cards WHERE user_id=$1 ORDER BY chapter_no, created_at`, [userId]);
  const kinds = {};
  const sides = {};
  for (const c of r.rows) {
    const item = {
      id: c.id, front: c.front, back: c.back, note: c.note, side: c.side,
      tier: cardTier(c), chapterNo: c.chapter_no,
    };
    (kinds[c.kind] ||= []).push(item);
    // 계정과목은 재무제표 자리별로도 모아 봅니다 — 이쪽이 실제로 더 자주 보게 됩니다
    if (c.kind === 'account' && c.side) (sides[c.side] ||= []).push(item);
  }
  return { kinds, sides, total: r.rows.length };
}

/* ── XP ── */

export async function grantXp(userId, amount, reason, ref = null) {
  const pool = getPool(); if (!pool) return 0;
  await ensureAccountingTables();
  try {
    const r = await pool.query(
      `INSERT INTO acct_xp (user_id, amount, reason, ref) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, ref) DO NOTHING RETURNING amount`, [userId, amount, reason, ref]);
    return r.rows[0]?.amount || 0;
  } catch { return 0; }
}

/** 누적 XP = 75·n·(n+1) 에서 레벨을 역산합니다 (다른 교실과 동일한 곡선) */
export function levelFromXp(xp) {
  const n = Math.floor((-1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 75)) / 2);
  const level = n + 1;
  const base = 75 * n * (n + 1);
  const need = 150 * (n + 1);
  return { xp, level, intoLevel: xp - base, needForNext: need,
           progress: Math.round(((xp - base) / need) * 100) };
}

export async function getXpState(userId) {
  const pool = getPool(); if (!pool) return levelFromXp(0);
  await ensureAccountingTables();
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::int AS xp FROM acct_xp WHERE user_id=$1`, [userId]);
  return levelFromXp(r.rows[0]?.xp || 0);
}

export async function getAccountingStats(userId) {
  const pool = getPool();
  if (!pool) return { done: 0, total: CHAPTERS.length, cards: 0, due: 0, activeDays7: 0, levels: {} };
  await ensureAccountingTables();
  const [done, cards, due, active] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT chapter_no)::int AS n FROM acct_lessons
                WHERE user_id=$1 AND status='done'`, [userId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM acct_cards WHERE user_id=$1`, [userId]),
    pool.query(`SELECT COUNT(*)::int AS n FROM acct_cards
                WHERE user_id=$1 AND due_at <= NOW()`, [userId]),
    pool.query(`SELECT COUNT(DISTINCT DATE(created_at))::int AS n FROM acct_xp
                WHERE user_id=$1 AND created_at > NOW() - INTERVAL '7 days'`, [userId]),
  ]);
  const doneNos = (await pool.query(
    `SELECT DISTINCT chapter_no FROM acct_lessons
      WHERE user_id=$1 AND status='done'`, [userId])).rows.map(x => x.chapter_no);
  // 단계별 진도 — 압박이 아니라 "지금 어디쯤 왔나" 감각용입니다
  const levels = {};
  for (const c of CHAPTERS) {
    const g = (levels[c.level] ||= { done: 0, total: 0 });
    g.total++;
    if (doneNos.includes(c.no)) g.done++;
  }
  return {
    done: done.rows[0].n, total: CHAPTERS.length, cards: cards.rows[0].n,
    due: due.rows[0].n, activeDays7: active.rows[0].n, levels,
  };
}
