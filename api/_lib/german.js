/**
 * 레나의 독일어 노트 (/german)
 *
 * 교재: Clamer / Heilmann, 《Übungsgrammatik für die Grundstufe — Regeln · Listen · Übungen》
 *       (Verlag Liebaug-Dartmann). 목차 순서만 따르고 설명은 새로 씁니다.
 *
 * 이 교재의 방법론은 '표'입니다. 산문으로 설명하지 않고 정렬된 표로 패턴을 보여줍니다.
 * (e→i, e→ie, a→ä … 변하는 글자만 이탤릭으로 띄워서 눈에 박히게 하는 방식)
 * 그래서 수학 노트에서 만든 판서 장치를 그대로 가져옵니다. 격변화표·동사변화표는
 * 자리 맞춤이 곧 내용이라, 말로 풀어쓰면 전달되지 않습니다.
 *
 * 학습자: 2019년에 독일어 일기를 쓸 정도로 배웠다가 거의 잊은 상태. 사실상 재시작이되
 * '처음 배우는 사람'은 아닙니다. 되살아나는 속도가 빠릅니다.
 */

import { generateJson } from "./llm.js";
import { getPool } from "./agent-brain.js";
import { sm2 } from "./chinese.js";   // 간격 반복 엔진은 동일한 것을 재사용합니다

let tablesReady;

// ═══════════════════════════════════════════════════
// 📚 교재 목차 (Inhaltsverzeichnis 그대로)
// ═══════════════════════════════════════════════════

export const UNITS = [
  '동사', '명사구', '형용사', '대명사', '전치사', '술어',
  '보충어', '보충어절', '부가어·부가어절', '문장연결', '수식어', '부정', '관사용법',
];

/**
 * goethe: 이 장이 대략 어느 시험 등급대에 해당하는지. 진도 감각용이지
 *         시험 압박을 주려는 게 아닙니다 — 하루하루는 흥미가 끌고 갑니다.
 * hook  : "이 규칙은 누가, 뭐가 불편해서 만들었나"의 실마리
 */
export const CHAPTERS = [
  // 1 Das Verb
  { no: 1,  sec: '1.1',   unit: '동사', de: 'Das Präsens', title: '현재형', goethe: 'A1',
    hook: '지금 일어나는 일과 앞으로 일어날 일을 독일어는 같은 형태로 말한다 — 왜 미래형을 잘 안 쓸까' },
  { no: 2,  sec: '1.1',   unit: '동사', de: 'Präsens — starke Verben', title: '현재형 — 모음이 바뀌는 동사', goethe: 'A1',
    hook: 'ich gebe인데 du gibst. 이 모음 교체는 게르만어가 수천 년 전부터 끌고 온 흔적이다' },
  { no: 3,  sec: '1.2',   unit: '동사', de: 'Trennbare / untrennbare Verben', title: '분리동사와 비분리동사', goethe: 'A1',
    hook: '동사의 앞머리가 문장 끝으로 날아가 버린다 — 끝까지 들어야 뜻이 정해지는 언어' },
  { no: 4,  sec: '1.3',   unit: '동사', de: 'Der Imperativ', title: '명령형', goethe: 'A1',
    hook: '독일어는 상대가 누구냐에 따라 명령형이 세 가지다 — 존댓말이 문법에 박혀 있다' },
  { no: 5,  sec: '1.4',   unit: '동사', de: 'Reflexiver Gebrauch der Verben', title: '재귀동사', goethe: 'A2',
    hook: '"나는 나를 씻는다" — 한국어라면 안 할 말을 독일어는 왜 굳이 할까' },
  { no: 6,  sec: '1.5',   unit: '동사', de: 'Das Präteritum', title: '과거형', goethe: 'A2',
    hook: '말할 때는 안 쓰고 글에서만 쓰는 과거 — 한 언어에 과거가 두 개인 이유' },
  { no: 7,  sec: '1.6',   unit: '동사', de: 'Das Perfekt', title: '현재완료', goethe: 'A1',
    hook: 'haben이냐 sein이냐. 이 갈림길에는 "움직였는가"라는 오래된 감각이 있다' },
  { no: 8,  sec: '1.6.1', unit: '동사', de: 'Perfekt der Modalverben', title: '화법조동사의 완료', goethe: 'B1',
    hook: '동사원형이 두 개 연달아 오는 기묘한 형태 — Ersatzinfinitiv' },
  { no: 9,  sec: '1.6.2', unit: '동사', de: 'Perfekt von „lassen" und „sehen"', title: 'lassen·sehen의 완료', goethe: 'B1',
    hook: '보다·시키다도 같은 예외로 묶인다 — 왜 하필 이 동사들일까' },
  { no: 10, sec: '1.7',   unit: '동사', de: 'Die Tempora im Deutschen', title: '독일어의 시제 전체', goethe: 'A2',
    hook: '여섯 개의 시제를 한 장에 놓고 보면 규칙이 하나로 보인다' },
  { no: 11, sec: '1.8.1', unit: '동사', de: 'Das Passiv', title: '수동태', goethe: 'B1',
    hook: '누가 했는지 말하고 싶지 않을 때 — 행위자를 지우는 장치' },
  { no: 12, sec: '1.8.2', unit: '동사', de: 'Passiv bei Modalverben', title: '화법조동사의 수동', goethe: 'B1',
    hook: '"되어야 한다"를 조립하는 법' },
  { no: 13, sec: '1.8.3', unit: '동사', de: 'Das subjektlose Passiv', title: '주어 없는 수동', goethe: 'B2',
    hook: '주어가 아예 없는 문장 — "여기서는 춤춰진다"' },
  { no: 14, sec: '1.8.4', unit: '동사', de: 'Das „Erststellen-Es"', title: '자리 채우는 es', goethe: 'B2',
    hook: '아무 뜻도 없는데 자리는 지켜야 하는 단어' },
  { no: 15, sec: '1.9',   unit: '동사', de: 'Modalverben', title: '화법조동사', goethe: 'A1',
    hook: 'dürfen·können·müssen·sollen·wollen — 말하는 사람의 태도가 동사가 된다' },
  { no: 16, sec: '1.10',  unit: '동사', de: '„lassen"', title: 'lassen', goethe: 'B1',
    hook: '두다·시키다·허락하다 — 하나의 동사가 세 가지 일을 한다' },

  // 2 Die Nominalgruppe
  { no: 17, sec: '2.1', unit: '명사구', de: 'Deklination des Nomens', title: '명사의 격변화', goethe: 'A1',
    hook: '한국어의 은/는/이/가/을/를이 독일어에서는 관사에 붙는다' },
  { no: 18, sec: '2.2', unit: '명사구', de: 'Deklination des Artikels', title: '관사의 격변화', goethe: 'A1',
    hook: '4격 × 3성 × 단복수 = 표 한 장. 이 표가 독일어의 심장이다' },
  { no: 19, sec: '2.3', unit: '명사구', de: 'Der Possessiv-Artikel', title: '소유관사', goethe: 'A1',
    hook: 'mein·dein·sein — 소유도 격에 따라 옷을 갈아입는다' },
  { no: 20, sec: '2.4', unit: '명사구', de: 'Frage-Artikel', title: '의문관사', goethe: 'A2',
    hook: 'welcher·was für ein — 두 가지 "어떤"의 차이' },
  { no: 21, sec: '2.5', unit: '명사구', de: 'Negativ-Artikel', title: '부정관사 kein', goethe: 'A1',
    hook: 'nicht와 kein은 왜 나뉘어 있나' },

  // 3 Das Adjektiv
  { no: 22, sec: '3.1', unit: '형용사', de: 'Deklination der Adjektive als Attribute', title: '형용사 어미변화', goethe: 'A2',
    hook: '독일어 학습자가 가장 많이 포기하는 지점 — 그런데 규칙은 딱 하나다' },
  { no: 23, sec: '3.2', unit: '형용사', de: 'Nominalisierte Adjektive und Partizipien', title: '명사화된 형용사·분사', goethe: 'B1',
    hook: '형용사가 그대로 사람이 된다 — der Alte, die Reisenden' },
  { no: 24, sec: '3.3', unit: '형용사', de: 'Vergleiche', title: '비교급과 최상급', goethe: 'A2',
    hook: 'gut–besser–am besten. 불규칙조차 영어와 나란히 놓으면 친척임이 보인다' },

  // 4 Pronomen
  { no: 25, sec: '4.1', unit: '대명사', de: 'Personalpronomen', title: '인칭대명사', goethe: 'A1',
    hook: 'Sie·sie·sie — 대문자 하나로 존대가 갈린다' },
  { no: 26, sec: '4.2', unit: '대명사', de: 'Präposition + Pronomen', title: '전치사 + 대명사', goethe: 'A2',
    hook: 'damit·darauf — 사물이면 전치사에 달라붙어 한 단어가 된다' },
  { no: 27, sec: '4.3', unit: '대명사', de: 'Fragewörter', title: '의문사', goethe: 'A1',
    hook: 'wer·wen·wem — 의문사조차 격변화한다' },
  { no: 28, sec: '4.4', unit: '대명사', de: 'Pronominale Formen der Artikel', title: '관사의 대명사형', goethe: 'B1',
    hook: '관사만 남기고 명사를 지우는 법' },

  // 5 Präpositionen
  { no: 29, sec: '5', unit: '전치사', de: 'Präpositionen', title: '전치사와 격지배', goethe: 'A2',
    hook: '전치사가 뒤에 올 격을 정한다 — in은 왜 3격도 되고 4격도 될까' },

  // 6 Das Prädikat
  { no: 30, sec: '6.1', unit: '술어', de: 'Kongruenz von Subjekt und Prädikat', title: '주어와 술어의 일치', goethe: 'A1',
    hook: '주어를 찾으면 동사 어미가 자동으로 정해진다' },
  { no: 31, sec: '6.2', unit: '술어', de: 'Die Stellung des Prädikats in Hauptsätzen', title: '주문장의 동사 위치', goethe: 'A1',
    hook: '동사는 반드시 두 번째 자리 — 독일어 어순의 유일한 절대 규칙' },
  { no: 32, sec: '6.3', unit: '술어', de: 'Die Stellung des Prädikats in Nebensätzen', title: '부문장의 동사 위치', goethe: 'A2',
    hook: '부문장에서 동사가 끝으로 간다 — 한국어와 똑같은 어순이 된다' },

  // 7 Ergänzungen
  { no: 33, sec: '7.1', unit: '보충어', de: 'Die Nominativ-Ergänzung', title: '1격 보충어', goethe: 'A1',
    hook: 'sein·werden·bleiben 뒤는 왜 4격이 아니라 1격일까' },
  { no: 34, sec: '7.2', unit: '보충어', de: 'Verben mit Akkusativ-Ergänzung', title: '4격 지배 동사', goethe: 'A1',
    hook: '대부분의 동사는 4격을 데리고 다닌다 — 기본값' },
  { no: 35, sec: '7.3', unit: '보충어', de: 'Verben mit Dativ-Ergänzung', title: '3격 지배 동사', goethe: 'A2',
    hook: 'helfen·danken·folgen — 외워야 하는 목록에도 결이 있다' },
  { no: 36, sec: '7.4', unit: '보충어', de: 'Akkusativ + Dativ', title: '3격 + 4격', goethe: 'A2',
    hook: '"누구에게 무엇을" — 두 목적어의 순서를 정하는 규칙' },
  { no: 37, sec: '7.5', unit: '보충어', de: 'Verben mit Situativ-Ergänzung', title: '장소 보충어', goethe: 'A2',
    hook: '어디에 있는가 — 위치를 요구하는 동사들' },
  { no: 38, sec: '7.6', unit: '보충어', de: 'Akkusativ + Direktiv', title: '4격 + 방향', goethe: 'A2',
    hook: '무엇을 어디로 — 놓다·두다의 문법' },
  { no: 39, sec: '7.7', unit: '보충어', de: 'Verben mit Direktiv-Ergänzung', title: '방향 보충어', goethe: 'A2',
    hook: 'liegen과 legen, stehen과 stellen — 있음과 옮김의 짝' },
  { no: 40, sec: '7.8', unit: '보충어', de: 'Verben mit Präpositional-Ergänzung', title: '전치사 보충어', goethe: 'B1',
    hook: 'warten auf, denken an — 동사마다 정해진 전치사가 있다' },
  { no: 41, sec: '7.9', unit: '보충어', de: 'Adjektive mit Ergänzungen', title: '보충어를 갖는 형용사', goethe: 'B1',
    hook: 'stolz auf, zufrieden mit — 형용사도 짝을 데리고 다닌다' },

  // 8 Ergänzungssätze
  { no: 42, sec: '8.1', unit: '보충어절', de: '„dass"-Sätze als Akkusativ-Ergänzungen', title: 'dass절 — 4격 자리', goethe: 'A2',
    hook: '문장 하나가 통째로 목적어가 된다' },
  { no: 43, sec: '8.2', unit: '보충어절', de: '„dass"-Sätze als Nominativ-Ergänzungen', title: 'dass절 — 1격 자리', goethe: 'B1',
    hook: '문장이 주어가 될 때 앞자리를 지키는 es' },
  { no: 44, sec: '8.3', unit: '보충어절', de: '„dass"-Sätze als Präpositional-Ergänzungen', title: 'dass절 — 전치사 자리', goethe: 'B1',
    hook: 'darauf, dass … — 전치사가 미리 자리를 예약한다' },
  { no: 45, sec: '8.4', unit: '보충어절', de: 'Infinitivsätze als Ergänzungen', title: 'zu부정사절', goethe: 'A2',
    hook: '주어가 같으면 dass 대신 더 짧게 갈 수 있다' },
  { no: 46, sec: '8.5', unit: '보충어절', de: 'Indirekte Fragesätze als Ergänzungen', title: '간접의문문', goethe: 'A2',
    hook: '질문을 문장 안에 집어넣으면 어순이 바뀐다' },

  // 9 Angaben / Angabesätze
  { no: 47, sec: '9.1', unit: '부가어·부가어절', de: 'Angaben', title: '부가어 — 때·곳·방법', goethe: 'A2',
    hook: 'te-ka-mo-lo — 독일어 어순을 외우는 오래된 주문' },
  { no: 48, sec: '9.2', unit: '부가어·부가어절', de: 'Temporalsätze', title: '시간의 부문장', goethe: 'A2',
    hook: 'als와 wenn — 한국어 "때"가 독일어에서는 둘로 갈린다' },
  { no: 49, sec: '9.3', unit: '부가어·부가어절', de: 'Kausalsätze', title: '이유의 부문장', goethe: 'A2',
    hook: 'weil과 denn — 어순 하나로 갈리는 쌍둥이' },
  { no: 50, sec: '9.4', unit: '부가어·부가어절', de: 'Finalsätze', title: '목적의 부문장', goethe: 'B1',
    hook: 'damit과 um…zu — 주어가 같은지가 갈림길' },
  { no: 51, sec: '9.5', unit: '부가어·부가어절', de: 'Konditionalsätze', title: '조건의 부문장', goethe: 'A2',
    hook: 'wenn을 아예 생략하고 동사를 맨 앞에 두는 법' },
  { no: 52, sec: '9.5.1', unit: '부가어·부가어절', de: 'Irreale Konditionalsätze', title: '비현실 조건 (접속법 2식)', goethe: 'B1',
    hook: '일어나지 않은 일을 말하는 전용 형태 — 독일어가 끝까지 지킨 접속법' },
  { no: 53, sec: '9.6', unit: '부가어·부가어절', de: 'Konzessivsätze', title: '양보의 부문장', goethe: 'B1',
    hook: 'obwohl — "그럼에도 불구하고"를 한 단어로' },
  { no: 54, sec: '9.7', unit: '부가어·부가어절', de: 'Konsekutivsätze', title: '결과의 부문장', goethe: 'B1',
    hook: 'so … dass — 정도가 결과를 낳는 구조' },
  { no: 55, sec: '9.8', unit: '부가어·부가어절', de: 'Modalsätze', title: '방법의 부문장', goethe: 'B1',
    hook: 'indem — "함으로써"를 정확히 옮기는 접속사' },

  // 10 Satzverbindungen
  { no: 56, sec: '10.1', unit: '문장연결', de: 'Konjunktionen auf Position 0', title: '0번 자리 접속사', goethe: 'A1',
    hook: 'und·aber·denn은 자리를 차지하지 않는다 — 그래서 어순이 안 바뀐다' },
  { no: 57, sec: '10.2', unit: '문장연결', de: 'Doppelkonjunktionen', title: '상관접속사', goethe: 'B1',
    hook: 'entweder…oder, weder…noch — 짝으로 움직이는 접속사' },
  { no: 58, sec: '10.3', unit: '문장연결', de: 'Satzverbindende Adverbien', title: '문장연결 부사', goethe: 'B1',
    hook: 'deshalb·trotzdem — 부사인데 자리를 차지해서 어순을 바꾼다' },

  // 11 Attribute
  { no: 59, sec: '11.1', unit: '수식어', de: 'Genitiv-Attribute', title: '2격 수식어', goethe: 'B1',
    hook: '2격은 죽어가는 격이라 하는데 왜 아직 살아 있나' },
  { no: 60, sec: '11.2', unit: '수식어', de: 'Satzförmige Attribute', title: '문장형 수식어', goethe: 'B1',
    hook: '명사 앞에 문장 하나를 통째로 끼워 넣는 독일어 특유의 확장' },
  { no: 61, sec: '11.3', unit: '수식어', de: 'Relativsätze', title: '관계절', goethe: 'B1',
    hook: '관계대명사의 성은 앞 명사가, 격은 뒷 문장이 정한다 — 두 주인을 섬긴다' },
  { no: 62, sec: '11.4', unit: '수식어', de: 'Die Apposition', title: '동격', goethe: 'B1',
    hook: '쉼표 둘 사이에 설명을 끼워 넣기' },

  // 12 · 13
  { no: 63, sec: '12', unit: '부정', de: 'Negation', title: '부정 — nicht의 자리', goethe: 'A2',
    hook: 'nicht를 어디에 놓느냐로 뜻이 달라진다' },
  { no: 64, sec: '13', unit: '관사용법', de: 'Der Gebrauch des Artikels', title: '관사를 쓸 때와 안 쓸 때', goethe: 'B1',
    hook: '관사가 없는 것도 하나의 선택이다' },
];

export function getChapter(idx) {
  const i = Math.max(0, Math.min(CHAPTERS.length - 1, Number(idx) || 0));
  return CHAPTERS[i];
}

// ═══════════════════════════════════════════════════
// 👩‍🏫 레나 — 조교이자 스파링 파트너
// ═══════════════════════════════════════════════════

const LENA = `당신은 '레나(Lena)'입니다. 학습자가 붙여준 이름이고, 당신은 그 호칭을 기쁘게 받습니다.

## 당신의 위치 (중요)
당신은 이 학습자의 **독일어 선생님이 아니라 조교이자 스파링 파트너**입니다.
규칙들을 다각도로 연결해 주고, 함께 씨름하는 상대입니다.
사람 선생님이나 좋은 어학원을 대체한다는 태도는 절대 취하지 마세요.
당신이 잘하는 것은 '지치지 않고 함께 있어주기'와 '연결해서 보여주기'입니다.

## 학습자
- **2019년에 독일어 일기를 쓸 정도로 배웠다가 거의 잊었습니다.** 사실상 재시작이지만
  '처음 배우는 사람'은 아닙니다. 한 번 지나간 길이라 되살아나는 속도가 빠릅니다.
  → "예전에 이거 보신 적 있을 거예요, 기억 안 나셔도 정상이에요" 같은 태도가 맞습니다.
  → 그렇다고 안다고 가정하지는 마세요. 매번 처음처럼 설명하되, 속도는 얕보지 마세요.
- 그때 쓴 문장의 실제 오류 유형: 부문장 어순(weil 뒤 정동사 후치 누락),
  비분리동사 과거분사에 ge- 잘못 붙임, 복수형 오류, 재귀·격지배 혼동.
  → 이 네 가지는 지금도 남아 있을 가능성이 높습니다. 나오면 반갑게 짚어주세요.
- 배우는 이유는 **두 가지**입니다.
  ① 순수한 흥미 — 규칙의 유래와 "왜 이렇게 생겼나"가 재미있어서
  ② 자격증(Goethe/TestDaF) — 다만 이건 목표지 압박이 아닙니다
  → 하루하루는 ①이 끌고 갑니다. ②는 진도 감각으로만 씁니다.
     시험 얘기로 겁주지 마세요. 다만 시험에서 자주 나오는 형태라면 짚어주는 건 좋습니다.

## 반드시 지키는 두 가지 프레임
1. **"이 규칙은 누가, 뭐가 불편해서 만든 걸까?"** — 모든 문법 도입에서 이 질문을 던지세요.
   독일어 문법은 외울 규칙 목록이 아니라 천 년 넘게 다듬어진 장치입니다.
   격은 왜 남았는지, 동사는 왜 끝으로 가는지, 접속법은 왜 살아남았는지 —
   이런 이야기에 학습자가 가장 강하게 반응합니다.
2. **"규칙이 아니라 도구"** — 문법 규칙을 외울 항목이 아니라 누군가 불편해서 만든 도구로
   보여주세요.

## 한국어를 지렛대로 쓰세요 (이 학습자만의 강점)
영어 화자용 교재는 절대 못 하는 걸 당신은 할 수 있습니다. **한국어와 독일어의 구조적 닮음**입니다.
- **격(Kasus) ↔ 조사**: 1·2·3·4격은 한국어의 이/가 · 의 · 에게 · 을/를에 거의 그대로 대응합니다.
  영어 화자에게는 격이 낯선 개념이지만, 한국어 화자에게는 **이미 매일 쓰는 것**입니다.
  격을 가르칠 때 반드시 조사와 나란히 놓으세요.
- **부문장 어순 ↔ 한국어 어순**: 부문장에서 정동사가 끝으로 가는 건
  한국어와 **똑같은 순서**입니다. "weil ich ihn gesehen habe" = "내가 그를 봤기 때문에".
  독일어 학습자 대부분이 괴로워하는 지점인데, 한국어 화자에게는 오히려 자연스럽습니다.
  이걸 반드시 알려주세요. 자신감이 붙는 지점입니다.
- **분리동사 ↔ 한국어 보조용언**: 끝까지 들어야 뜻이 정해지는 것도 닮았습니다.
- 다만 **닮지 않은 것도 정직하게** 말하세요. 성(der/die/das)은 한국어에 대응물이 없습니다.
  "이건 논리가 없으니 그냥 외워야 해요"라고 솔직히 말하는 게 낫습니다.
  단, 외우는 요령(어미로 성을 알 수 있는 경우들)은 반드시 함께 주세요.

## 톤
따뜻하고 격려하는 존댓말에 가끔 반말체를 섞습니다("~인 거죠", "~해볼까요", "맞아요, 그거예요").
이모지는 가볍게만. 남발하지 마세요.
틀린 답에는 **"어디서 헷갈리는지가 오히려 중요한 정보"**라고 안심시키세요.
먼저 맞은 부분을 인정하고, 틀린 지점만 콕 집어 설명합니다.

## 설명의 눈높이 (가장 중요한 규칙)
학습자는 **혼자 읽습니다.** 옆에서 물어볼 사람이 없습니다. 막히면 그냥 막힌 채로 끝납니다.
- **문법 용어는 처음 쓸 때 반드시 풀어서.** '정동사', '분사', '지배' 같은 말도 예외가 아닙니다.
- **독일어 예문에는 반드시 한국어 뜻을 붙이세요.** 예외 없습니다.
- **한 문단에 새로운 것 하나만.** 문장을 짧게.
- 다음 표현은 **금지**입니다: "당연히", "자명하게", "쉽게 알 수 있듯이", "간단히",
  "잘 알려진 대로". 이 말들은 막힌 사람을 혼자 뒤처진 기분으로 만듭니다.
- 추상적으로 말한 뒤에는 **반드시 구체적인 예문으로 한 번 더** 보여주세요.
- 설명을 아끼지 마세요. **분량이 넘치는 것보다 부족한 게 훨씬 나쁩니다.**

## 판서 — 표는 말로 풀지 마세요 (매우 중요)
이 교재의 방법론이 바로 '표'입니다. 격변화표, 동사변화표, 어미 목록은
**자리를 맞춰 세로로 정렬해야** 패턴이 눈에 보입니다.
"남성 4격은 den이고 여성 4격은 die이며…" 같은 문장은 표를 말로 억지 번역한 것이고,
학습자는 결국 직접 표로 그려봐야 이해합니다. 그럴 거면 처음부터 표로 보여주세요.

반드시 아래 형식의 **판서 블록**으로 그리세요. 고정폭으로 렌더되어 공백이 보존됩니다.

\`\`\`판서
          남성      여성      중성      복수
  1격     der       die       das       die      ← ~이/가
  2격     des       der       des       der      ← ~의
  3격     dem       der       dem       den      ← ~에게
  4격     den       die       das       die      ← ~을/를
\`\`\`

판서 규칙:
- **공백(스페이스)으로만 자리를 맞추세요. 탭 금지.**
- **같은 열은 반드시 세로로 정렬하세요.** 이게 판서의 핵심입니다.
- 오른쪽에 \`←\` 로 짧은 주석을 답니다. **12자 이내**로. 길면 휴대폰에서 잘립니다.
- **한 줄은 46자를 넘기지 마세요.**
- 변화하는 부분(어미 등)이 눈에 띄게 열을 맞추세요. 그게 이 교재의 방식입니다.
- 판서를 넣은 뒤에는 그 표를 **말로 다시 읊지 마세요.** 표가 이미 말했습니다.
  대신 "이 표에서 무엇을 봐야 하는지" 한두 문장만 덧붙이세요.

## 독일어 표기
- 움라우트와 에스체트를 정확히: ä ö ü Ä Ö Ü ß
- 명사는 항상 대문자로 시작합니다. 이걸 틀리지 마세요.
- 명사를 처음 소개할 때는 **반드시 관사와 복수형을 함께**: der Tisch, -e / die Stadt, ⁻e
- 강조는 **굵게** 만 사용합니다.`;

// ═══════════════════════════════════════════════════
// 🗄 스키마
// ═══════════════════════════════════════════════════

export async function ensureGermanTables() {
  const pool = getPool();
  if (!pool || tablesReady) return;
  tablesReady = pool.query(`
    CREATE TABLE IF NOT EXISTS german_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      chapter_index INTEGER NOT NULL DEFAULT 0,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS german_lessons (
      id TEXT PRIMARY KEY,
      chapter_no INTEGER NOT NULL,
      unit TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      de_title TEXT NOT NULL DEFAULT '',
      intro TEXT NOT NULL DEFAULT '',
      warmup JSONB NOT NULL DEFAULT '[]',
      concept TEXT NOT NULL DEFAULT '',
      walkthrough JSONB NOT NULL DEFAULT '{}',
      problems JSONB NOT NULL DEFAULT '[]',
      summary JSONB NOT NULL DEFAULT '[]',
      cards JSONB NOT NULL DEFAULT '[]',
      aside TEXT NOT NULL DEFAULT '',
      step INTEGER NOT NULL DEFAULT 0,
      turns JSONB NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      done_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_gl_status ON german_lessons(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS german_cards (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'rule',
      front TEXT NOT NULL,
      back TEXT NOT NULL DEFAULT '',
      note TEXT DEFAULT '',
      genus TEXT,
      chapter_no INTEGER NOT NULL DEFAULT 1,
      ease REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      lapses INTEGER NOT NULL DEFAULT 0,
      due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_result TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gc_due ON german_cards(due_at);
    CREATE TABLE IF NOT EXISTS german_gaps (
      id SERIAL PRIMARY KEY,
      chapter_no INTEGER,
      concept TEXT NOT NULL,
      detail TEXT DEFAULT '',
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS german_xp (
      id SERIAL PRIMARY KEY,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      ref TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gx_ref ON german_xp(ref) WHERE ref IS NOT NULL;
    INSERT INTO german_profile (id, chapter_index) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
  `).catch(() => { tablesReady = null; });
  await tablesReady;
}

// ═══════════════════════════════════════════════════
// 🧠 수업 생성
// ═══════════════════════════════════════════════════

/** 한 챕터의 수업 전체를 생성합니다 */
export async function generateLesson(chapter, priorContext) {
  const prompt = `## 오늘 다룰 장
[${chapter.unit}] ${chapter.sec} ${chapter.de} — ${chapter.title}
Goethe 등급대: ${chapter.goethe}
실마리: ${chapter.hook}

${priorContext}

## 만들 것 일곱 가지

### intro (도입 · 이야기)
"이 규칙은 누가, 뭐가 불편해서 만든 걸까?"로 시작하는 도입.
역사적 배경(게르만어의 흔적, 다른 언어와의 비교)이나 실제 쓰임의 맥락으로
이 문법이 **왜 필요했는지**를 이야기하세요. 규칙을 먼저 던지지 마세요. 500~800자.

### warmup (준비운동 · 되짚을 것 2~3개)
오늘 내용을 이해하려면 **미리 서 있어야 하는 것**을 되짚어 줍니다.
학습자는 예전에 배웠다가 잊은 상태라, 완전히 새로운 게 아니라 '되살리는' 단계입니다.
각 항목: concept(항목 이름) / refresher(150~250자, 예문 필수) / why(오늘 왜 필요한지 한 문장)

### concept (핵심 · 표로 보여주기)
**이 수업의 본체입니다. 1600~2200자.** 각 대목은 \`## 소제목\`으로 나누세요.
1. **한국어와 이어붙이기** — 이 문법이 한국어의 무엇에 해당하는지 먼저.
   닮은 게 없으면 "이건 한국어에 대응물이 없어요"라고 정직하게 말하고 외우는 요령을 주세요.
2. **표(판서)로 패턴 보여주기** — 변화형·어미·목록은 반드시 판서 블록으로.
   이 교재의 방식이 그렇습니다. 말로 풀어쓰지 마세요.
3. **예문으로 확인** — 판서에서 본 형태가 실제 문장에서 어떻게 나오는지.
   **모든 독일어 예문에 한국어 뜻을 붙이세요.**
4. **흔한 함정** — 한국어 화자가 특히 걸리는 지점을 미리 꺼내 풀어주세요.
5. **규칙이 아니라 도구** — 이 문법이 무엇을 가능하게 해주는지 한 문장.

### walkthrough (문장 해부 · 함께 하나 풀어보기)
문제를 내기 전에, **레나가 예문 하나를 끝까지 분석해 보여줍니다.**
- problem: 분석할 독일어 문장 하나 (오늘 문법이 들어간 전형적인 문장) + 한국어 뜻
- steps: **3~6단계.** 각 단계마다
  · what: 이 단계에서 실제로 한 판단 (어느 단어를 보고 무엇을 정했는지)
  · why: **왜 그렇게 판단하는지.** "그래서 다음에 뭘 정할 수 있게 되나"를 쓰세요.
  · board: 그 단계까지의 누적 판서 (문장을 자리별로 늘어놓거나 변화표를 채워가는 식).
    매 단계 처음부터 다시 그리되 **그 단계까지 정해진 것만** 채우세요.
    판서 표시(\`\`\`판서)는 붙이지 말고 내용만. 필요 없으면 빈 문자열.
- recap: 전체 전략 한두 문장 ("결국 하는 일은 ~를 보고 ~를 정하는 거예요")

### problems (확인 문제 3개 — 난이도 사다리)
반드시 순서대로, level 값을 정확히:
1. level:"easy" — **함정 없음.** 방금 함께 본 것과 거의 같은 형태. 자신감이 목적.
2. level:"trap" — **한국어 화자가 흔히 걸리는 함정**을 의도적으로.
3. level:"connect" — 앞서 배운 장과 연결하거나 "왜 그런가"를 묻는 문제.
각 문제: question(문제 — 독일어 부분에는 한국어 뜻 병기) / answer(정답) / level /
trap(심은 함정, easy는 빈 문자열) / prereq(틀린다면 흔들릴 선행 항목) / hint(힌트 한 줄, 정답은 빼고)

### summary (요약표 3~5행)
term(형태·용어) / meaning(뜻·쓰임) / caution(주의할 점)

### cards (복습 카드 0~4개)
나중에 다시 꺼내 써야 할 것. kind는 아래 넷 중 하나:
- "genus" — 명사의 성. front는 명사, genus는 "der"/"die"/"das", back은 뜻과 복수형
- "stamm" — 강변화·불규칙 동사의 3기본형. front는 부정형, back은 "기본형 – 과거 – 과거분사"
- "rule" — 문법 규칙. front는 질문 형태, back은 답
- "vocab" — 어휘·숙어. front는 독일어, back은 뜻
각 카드: kind / front / back / note(언제 쓰는지 한 줄) / genus(성 카드만, 아니면 null)

### aside (곁가지 이야기 · 선택)
어원, 다른 언어와의 비교, 독일어를 쓰는 사람들의 실제 습관 등 재미있는 여담.
200~400자. 없으면 빈 문자열. 시험에 안 나와도 괜찮습니다 — 이 학습자는 재미로 배웁니다.

## 순수 JSON만 출력
{"intro":"...",
 "warmup":[{"concept":"...","refresher":"...","why":"..."}],
 "concept":"...",
 "walkthrough":{"problem":"...","steps":[{"what":"...","why":"...","board":"..."}],"recap":"..."},
 "problems":[{"question":"...","answer":"...","level":"easy","trap":"","prereq":"...","hint":"..."}],
 "summary":[{"term":"...","meaning":"...","caution":"..."}],
 "cards":[{"kind":"genus","front":"...","back":"...","note":"...","genus":"der"}],
 "aside":"..."}`;

  const valid = (d) => !!(d?.intro && d?.concept && d?.problems?.length);
  const ask = (extraRule, budgetMs) => generateJson({
    system: LENA,
    user: extraRule ? `${prompt}\n\n${extraRule}` : prompt,
    temperature: 0.75, maxTokens: 16384, budgetMs, validate: valid,
    label: `de-lesson:${chapter.no}`,
  });

  let r = await ask(null, 40000);
  if (!r.data) {
    console.warn('[German] 1차 수업 생성 실패 — 분량을 줄여 재시도합니다');
    r = await ask(
      `## ⚠️ 재시도 지침\n앞선 시도에서 출력이 너무 길어 실패했습니다. 이번에는:\n` +
      `- aside는 빈 문자열로 두세요\n- concept은 1200~1500자로 줄이세요\n` +
      `- 나머지는 그대로 유지하세요 (준비운동과 문장 해부는 절대 빼지 마세요)`,
      14000,
    );
  }
  if (!r.data) throw new Error('수업 생성에 실패했습니다. 다시 시도해 주세요.');
  return r.data;
}

/** 확인 문제 채점 — 정오보다 '어디서 갈렸는지'가 핵심 */
export async function gradeAnswer({ chapter, problem, userAnswer, history }) {
  const systemPrompt = `${LENA}

## 지금 하는 일
학습자가 확인 문제에 답했습니다. 채점하고 피드백하세요.

## 피드백 원칙
1. **먼저 맞은 부분을 구체적으로 인정하세요.** "잘했어요" 같은 빈말 말고, 무엇을 제대로 했는지 짚어서.
2. 틀렸다면 **어느 지점에서 갈렸는지 딱 집어** 설명하세요. 전체를 다시 강의하지 마세요.
3. 함정에 걸렸다면 **"이건 한국어 화자가 진짜 많이 걸리는 지점이에요"**라고 안심시키세요.
4. 틀린 답도 "어디서 헷갈리는지 알게 됐으니 오히려 좋은 정보"라는 태도를 유지하세요.
5. 절대 학습자를 평가하거나 실망한 티를 내지 마세요.
6. **올바른 형태를 단계별로 보여주세요.** 정답만 알려주는 건 도움이 안 됩니다.
   갈라진 지점부터 정답까지 가는 길을, 판단 근거를 생략하지 말고 쓰세요.
   변화표를 봐야 하는 문제라면 **판서 블록으로 그려서** 보여주세요.
7. 갈라진 원인에 **이름을 붙여** 주세요. ("부문장인데 정동사를 두 번째 자리에 두신 거예요"처럼)
   이름이 붙으면 다음에 같은 실수를 알아챌 수 있습니다.
8. 철자·움라우트·명사 대문자는 틀렸으면 **조용히 고쳐서 보여주되 혼내지 마세요.**

## 선행 항목 진단
오답의 원인이 이 장이 아니라 **더 앞의 문법**에 있다고 판단되면
(예: 형용사 어미를 틀렸는데 실은 격 판단이 흔들리는 경우),
gapConcept에 그 항목 이름을 쓰고 gapPatch에 그 항목을 **처음 배우는 사람 기준으로 다시**
설명하세요. **4~7문장, 예문 필수(한국어 뜻 포함).**
아래가 튼튼하면 gapConcept은 null입니다. 억지로 만들지 마세요.

## 순수 JSON만 출력
{"correct": true 또는 false,
 "partial": true 또는 false,
 "feedback": "피드백 본문. 맞았으면 250~400자, 틀렸으면 올바른 풀이까지 담아 450~700자",
 "corrected": "학습자 답을 고친 문장 (독일어 작문 문제일 때만, 아니면 null)",
 "gapConcept": "흔들리는 선행 항목 이름" 또는 null,
 "gapPatch": "그 항목 다시 설명 (4~7문장, 예문 포함)" 또는 null}`;

  const input = `## 장
[${chapter.unit}] ${chapter.sec} ${chapter.de} — ${chapter.title}

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
${history?.length ? `\n## 이 장에서 앞서 주고받은 내용\n${history.slice(-4).map(t => `${t.role === 'user' ? '학습자' : '레나'}: ${String(t.content).slice(0, 200)}`).join('\n')}` : ''}`;

  const { data } = await generateJson({
    system: systemPrompt, user: input,
    temperature: 0.4, maxTokens: 4096, budgetMs: 50000,
    validate: (d) => typeof d?.correct === 'boolean',
    label: `de-grade:${chapter.no}`,
  });
  if (!data) return { parseError: true, feedback: '채점 중 문제가 생겼어요. 다시 제출해 주세요.' };
  return data;
}

/** 🙋 "여기가 이해 안 돼요" — 같은 대목을 다른 방식으로 다시 설명 */
export async function explainMore({ chapter, sectionLabel, sectionText, question, askedBefore = [] }) {
  const systemPrompt = `${LENA}

## 지금 하는 일
학습자가 방금 읽은 설명에서 **막혔습니다.** 다시 설명해 주세요.

## 절대 규칙
1. **앞서 한 설명을 그대로 반복하지 마세요.** 그 방식은 이미 안 통했습니다.
   접근 자체를 바꾸세요 — 한국어와 나란히 놓거나, 표로 다시 그리거나,
   예문을 아주 많이 늘어놓고 패턴을 스스로 보게 하거나, 더 앞 단계로 내려가거나.
2. **더 아래로 내려가는 걸 두려워하지 마세요.** 필요하면 A1 기초까지 돌아가도 됩니다.
   "거기까지 돌아가면 창피한 것"이 절대 아니라는 태도를 유지하세요.
3. 학습자가 구체적으로 뭘 물었다면 **그 지점만** 답하세요. 장 전체를 다시 강의하지 마세요.
   무엇이 막혔는지 안 적었다면, 이 대목에서 한국어 화자가 가장 흔히 걸리는 지점부터 푸세요.
4. **막힌 대목이 변화표라면 접근을 바꾸는 가장 좋은 방법은 판서입니다.**
   말로 다시 설명하는 대신 표를 다르게 잘라서 그려 보여주세요.
   (예: 성별로 자르던 걸 격별로 잘라 보기)
5. 마지막에 **아주 작은 확인 질문 하나**를 던지세요. 답이 한 줄로 나오는 크기여야 합니다.
6. 막힌 걸 부끄러워하지 않게 하세요. "이 부분은 원래 여기서 다들 한 번 멈춰요" 같은 태도로.

## 분량
600~1000자. 넉넉하게 쓰세요. 짧아서 또 막히는 게 최악입니다.

## 순수 JSON만 출력
{"explanation":"다시 설명한 본문","approach":"이번에 바꾼 접근을 한 줄로","check":"작은 확인 질문 한 줄"}`;

  const input = `## 장
[${chapter.unit}] ${chapter.sec} ${chapter.de} — ${chapter.title}

## 학습자가 막힌 대목
${sectionLabel}

## 그 대목에서 레나가 이미 한 설명 (이 방식은 안 통했습니다)
${String(sectionText || '').slice(0, 2500)}

## 학습자가 말한 막힌 지점
${String(question || '').trim() || '(구체적으로 적지 않았습니다 — 이 대목에서 한국어 화자가 가장 흔히 걸리는 곳을 짚어주세요)'}
${askedBefore.length ? `\n## 이미 시도한 다른 접근들 (또 반복하지 마세요)\n${askedBefore.map((a, i) => `${i + 1}. ${a}`).join('\n')}` : ''}`;

  const { data } = await generateJson({
    system: systemPrompt, user: input,
    temperature: 0.8, maxTokens: 4096, budgetMs: 50000,
    validate: (d) => !!d?.explanation,
    label: `de-deepen:${chapter.no}`,
  });
  if (!data) return { parseError: true, explanation: '설명을 만드는 중에 문제가 생겼어요. 다시 눌러주세요.' };
  return data;
}

// ═══════════════════════════════════════════════════
// 💾 진도 · 레슨 · 카드 · XP
// ═══════════════════════════════════════════════════

export async function getProfile() {
  const pool = getPool(); if (!pool) return null;
  await ensureGermanTables();
  const r = await pool.query(`SELECT * FROM german_profile WHERE id=1`);
  return r.rows[0] || null;
}

export async function setChapterIndex(idx) {
  const pool = getPool(); if (!pool) return;
  await ensureGermanTables();
  await pool.query(`UPDATE german_profile SET chapter_index=$1 WHERE id=1`,
    [Math.max(0, Math.min(CHAPTERS.length - 1, Number(idx) || 0))]);
}

export async function getOpenLesson() {
  const pool = getPool(); if (!pool) return null;
  await ensureGermanTables();
  const r = await pool.query(`SELECT * FROM german_lessons WHERE status='open' ORDER BY created_at DESC LIMIT 1`);
  return r.rows[0] || null;
}

export async function createLesson(chapter, gen) {
  const pool = getPool(); if (!pool) return null;
  const id = `gl_${chapter.no}_${Date.now()}`;
  await pool.query(
    `INSERT INTO german_lessons
       (id, chapter_no, unit, title, de_title, intro, warmup, concept, walkthrough,
        problems, summary, cards, aside)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [id, chapter.no, chapter.unit, chapter.title, chapter.de, gen.intro,
     JSON.stringify(gen.warmup || []), gen.concept,
     JSON.stringify(gen.walkthrough || {}), JSON.stringify(gen.problems),
     JSON.stringify(gen.summary || []), JSON.stringify(gen.cards || []), gen.aside || '']
  );
  const r = await pool.query(`SELECT * FROM german_lessons WHERE id=$1`, [id]);
  return r.rows[0];
}

export async function advanceStep(lessonId, step, turn) {
  const pool = getPool(); if (!pool) return;
  if (turn) {
    await pool.query(
      `UPDATE german_lessons SET step=$1, turns = turns || $2::jsonb WHERE id=$3`,
      [step, JSON.stringify([turn]), lessonId]);
  } else {
    await pool.query(`UPDATE german_lessons SET step=$1 WHERE id=$2`, [step, lessonId]);
  }
}

export async function completeLesson(lessonId) {
  const pool = getPool(); if (!pool) return;
  await pool.query(`UPDATE german_lessons SET status='done', done_at=NOW() WHERE id=$1`, [lessonId]);
  await pool.query(`UPDATE german_profile SET chapter_index = chapter_index + 1 WHERE id=1`);
}

export async function getDoneChapters() {
  const pool = getPool(); if (!pool) return [];
  await ensureGermanTables();
  const r = await pool.query(`SELECT DISTINCT chapter_no FROM german_lessons WHERE status='done'`);
  return r.rows.map(x => x.chapter_no);
}

export async function recordGap(chapterNo, concept, detail) {
  const pool = getPool(); if (!pool || !concept) return;
  await pool.query(
    `INSERT INTO german_gaps (chapter_no, concept, detail) VALUES ($1,$2,$3)`,
    [chapterNo, String(concept).slice(0, 120), String(detail || '').slice(0, 800)]
  ).catch(() => {});
}

export async function getGaps(limit = 10) {
  const pool = getPool(); if (!pool) return [];
  await ensureGermanTables();
  const r = await pool.query(
    `SELECT concept, COUNT(*)::int AS times, MAX(created_at) AS last_at
     FROM german_gaps WHERE resolved = FALSE
     GROUP BY concept ORDER BY times DESC, last_at DESC LIMIT $1`, [limit]);
  return r.rows;
}

/* ── 카드 ── */

const CARD_KINDS = ['genus', 'stamm', 'rule', 'vocab'];

export async function addCards(cards, chapterNo) {
  const pool = getPool(); if (!pool || !cards?.length) return 0;
  let n = 0;
  for (const c of cards) {
    if (!c?.front) continue;
    const kind = CARD_KINDS.includes(c.kind) ? c.kind : 'rule';
    const genus = kind === 'genus' && ['der', 'die', 'das'].includes(c.genus) ? c.genus : null;
    const id = `gc_${chapterNo}_${Buffer.from(String(c.front)).toString('base64url').slice(0, 40)}`;
    try {
      const r = await pool.query(
        `INSERT INTO german_cards (id, kind, front, back, note, genus, chapter_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [id, kind, c.front, c.back || '', c.note || '', genus, chapterNo]);
      if (r.rowCount > 0) n++;
    } catch { /* skip */ }
  }
  return n;
}

export async function getDueCards(limit = 12) {
  const pool = getPool(); if (!pool) return [];
  await ensureGermanTables();
  const r = await pool.query(
    `SELECT * FROM german_cards WHERE due_at <= NOW() ORDER BY due_at ASC LIMIT $1`, [limit]);
  return r.rows.map(c => ({
    id: c.id, kind: c.kind, front: c.front, back: c.back, note: c.note,
    genus: c.genus, tier: cardTier(c), chapterNo: c.chapter_no,
  }));
}

export async function reviewCard(cardId, quality) {
  const pool = getPool(); if (!pool) return null;
  const r = await pool.query(`SELECT * FROM german_cards WHERE id=$1`, [cardId]);
  const card = r.rows[0];
  if (!card) return null;
  const tierBefore = cardTier(card);
  const next = sm2(card, quality);
  await pool.query(
    `UPDATE german_cards SET ease=$1, interval_days=$2, repetitions=$3, lapses=$4,
       due_at=NOW() + ($5 || ' days')::interval, last_result=$6 WHERE id=$7`,
    [next.ease, next.interval_days, next.repetitions, next.lapses,
     String(next.interval_days), quality >= 3 ? 'ok' : 'again', cardId]);
  const tierAfter = cardTier({ ...card, ...next });
  // 🎮 XP는 '맞혔을 때'만. 등급이 올라가면 보너스
  const gained = quality >= 3
    ? await grantXp(tierAfter !== tierBefore ? 25 : 10,
        tierAfter !== tierBefore ? `카드 승급 · ${TIERS[tierAfter]?.label || tierAfter}` : '복습 정답',
        `${cardId}_${Date.now()}`)
    : 0;
  return { tierBefore, tierAfter, promoted: tierAfter !== tierBefore, xpGained: gained,
           nextInDays: next.interval_days };
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

/** 도감 — 카드를 종류·등급별로 모아 봅니다 */
export async function getCollection() {
  const pool = getPool(); if (!pool) return { kinds: {}, total: 0 };
  await ensureGermanTables();
  const r = await pool.query(`SELECT * FROM german_cards ORDER BY chapter_no, created_at`);
  const kinds = {};
  for (const c of r.rows) {
    (kinds[c.kind] ||= []).push({
      id: c.id, front: c.front, back: c.back, note: c.note, genus: c.genus,
      tier: cardTier(c), chapterNo: c.chapter_no,
    });
  }
  return { kinds, total: r.rows.length };
}

/* ── XP ── */

export async function grantXp(amount, reason, ref = null) {
  const pool = getPool(); if (!pool) return 0;
  await ensureGermanTables();
  try {
    const r = await pool.query(
      `INSERT INTO german_xp (amount, reason, ref) VALUES ($1,$2,$3)
       ON CONFLICT (ref) DO NOTHING RETURNING amount`, [amount, reason, ref]);
    return r.rows[0]?.amount || 0;
  } catch { return 0; }
}

/** 누적 XP = 75·n·(n+1) 에서 레벨을 역산합니다 (중국어 학당과 동일한 곡선) */
export function levelFromXp(xp) {
  const n = Math.floor((-1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 75)) / 2);
  const level = n + 1;
  const base = 75 * n * (n + 1);
  const need = 150 * (n + 1);
  return { xp, level, intoLevel: xp - base, needForNext: need,
           progress: Math.round(((xp - base) / need) * 100) };
}

export async function getXpState() {
  const pool = getPool(); if (!pool) return levelFromXp(0);
  await ensureGermanTables();
  const r = await pool.query(`SELECT COALESCE(SUM(amount),0)::int AS xp FROM german_xp`);
  return levelFromXp(r.rows[0]?.xp || 0);
}

export async function getGermanStats() {
  const pool = getPool();
  if (!pool) return { done: 0, total: CHAPTERS.length, cards: 0, due: 0, activeDays7: 0, goethe: {} };
  await ensureGermanTables();
  const [done, cards, due, active] = await Promise.all([
    pool.query(`SELECT COUNT(DISTINCT chapter_no)::int AS n FROM german_lessons WHERE status='done'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM german_cards`),
    pool.query(`SELECT COUNT(*)::int AS n FROM german_cards WHERE due_at <= NOW()`),
    pool.query(`SELECT COUNT(DISTINCT DATE(created_at))::int AS n FROM german_xp
                WHERE created_at > NOW() - INTERVAL '7 days'`),
  ]);
  // Goethe 등급대별 진도 — 압박이 아니라 진도 감각용입니다
  const doneNos = (await pool.query(
    `SELECT DISTINCT chapter_no FROM german_lessons WHERE status='done'`)).rows.map(x => x.chapter_no);
  const goethe = {};
  for (const c of CHAPTERS) {
    const g = (goethe[c.goethe] ||= { done: 0, total: 0 });
    g.total++;
    if (doneNos.includes(c.no)) g.done++;
  }
  return {
    done: done.rows[0].n, total: CHAPTERS.length, cards: cards.rows[0].n,
    due: due.rows[0].n, activeDays7: active.rows[0].n, goethe,
  };
}
