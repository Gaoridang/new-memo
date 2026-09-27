import { DOODLES, isDoodleId, type DoodleId } from '../doodles/catalog';
import type { JevAnswer } from './jev';

// 메모 한 줄에서 두들을 붙일 낱말과 그 낱말에 맞는 그림을 고른다. (TypeSafe Pre-parsed value extraction 쿡북 방식)
// 낱말 후보는 코드가 띄어쓰기로 찾고, Jev는 후보 가운데 하나를 고르기만 한다. 그래서 돌려주는 낱말은 늘 줄에 있는 글자 그대로다.
// 후보는 조사까지 붙은 어절이다. 그림은 '커피'와 '를' 사이가 아니라 '커피를' 뒤에 온다.
// 붙여 쓴 어절('청소기칫솔')은 띄어 쓴 것처럼 나눠 묻는다. 칩은 그래도 어절 전체를 감싼다. (편집기가 칩을 어절 단위로 그린다)

export type DoodleCandidate = { word: string; start: number; length: number };
// confidence는 낱말 확률 × 그림 확률. 메모 전체를 훑을 때 어느 줄부터 붙일지 정한다.
export type DoodlePick = DoodleCandidate & { id: DoodleId; confidence: number };

const MAX_CANDIDATES = 10;
const NONE = 'none';
// 낱말 앞뒤의 문장 부호와 기호
const EDGE_MARKS = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const HAS_LETTER = /\p{L}/u;
// 숫자로 시작하는 낱말은 시각·날짜·양이다. ('3시', '10월', '2L', '5만원')
const STARTS_WITH_DIGIT = /^\p{N}/u;
const LINK = /:\/\/|^www\./i;
const ENGLISH_STOPWORDS = new Set(
  'a an the to at on in of for and or with from by my your our me is am are be do go it up this that'.split(' '),
);

// 붙여 쓴 어절을 나눌 때 찾는 낱말: 두들 목록 설명의 한국어 낱말 가운데 두 글자 이상. 긴 낱말부터 맞춰 본다. ('로봇청소기' > '청소기' > '청소')
// 한 글자 낱말은 다른 낱말 속에 너무 흔해 뺀다. ('배달'의 배, '눈물'의 눈)
const JOINED_TERMS = [
  ...new Set(
    Object.values(DOODLES).flatMap((description) =>
      description
        .split(' (')[0]
        .split('·')
        .map((term) => term.replace(/\s+/g, '')),
    ),
  ),
]
  .filter((term) => /^\p{Script=Hangul}{2,}$/u.test(term))
  .sort((a, b) => b.length - a.length);

/** 어절 속 두들 낱말들과 어절 안의 위치. 둘 이상일 때만 나눈다. ('청소기칫솔' → 청소기, 칫솔 / '커피를' → 나누지 않음) */
function joinedWords(word: string): { word: string; offset: number }[] {
  const found: { word: string; offset: number }[] = [];
  for (let i = 0; i < word.length; ) {
    const term = JOINED_TERMS.find((candidate) => word.startsWith(candidate, i));
    if (term) {
      found.push({ word: term, offset: i });
      i += term.length;
    } else {
      i++;
    }
  }
  return found.length >= 2 ? found : [];
}

/** 두들을 붙일 수 있는 낱말 후보. start·length는 line 안의 UTF-16 위치다. (JS·NSString·Kotlin String이 같은 단위를 쓴다) */
export function doodleCandidates(line: string): DoodleCandidate[] {
  const candidates: DoodleCandidate[] = [];
  const seen = new Set<string>();
  const add = (word: string, start: number) => {
    if (seen.has(word)) return;
    seen.add(word);
    candidates.push({ word, start, length: word.length });
  };
  for (const match of line.matchAll(/\S+/g)) {
    const token = match[0];
    const word = token.replace(EDGE_MARKS, '');
    if (!word || LINK.test(word)) continue;
    const start = match.index + token.indexOf(word);
    const joined = joinedWords(word);
    if (joined.length > 0) {
      for (const part of joined) add(part.word, start + part.offset);
    } else {
      if (!HAS_LETTER.test(word) || STARTS_WITH_DIGIT.test(word)) continue;
      // 낱말을 선택지 이름으로 쓰므로 'none'과 겹치는 낱말은 뺀다.
      if (ENGLISH_STOPWORDS.has(word.toLowerCase()) || word.toLowerCase() === NONE) continue;
      add(word, start);
    }
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates.slice(0, MAX_CANDIDATES);
}

/** 제목과 주변 줄은 맥락으로만 쓴다. ('눈 건강' 메모의 '눈'은 눈사람이 아니다) */
export function doodleState(title: string, line: string, nearby: string[]) {
  return { memo_title: title, line, nearby_lines: nearby };
}

const doodleQuestionKey = (index: number) => `doodle_${index}`;

/**
 * 한 번에 묻는다. keyword는 그림을 붙일 낱말이고, doodle_<i>는 i번째 후보에 맞는 그림이다.
 * 어느 낱말이 뽑힐지 모르니 후보마다 그림을 미리 물어 두고, 뽑힌 낱말의 답만 쓴다. (Speculative fan-out)
 */
export function doodleQuestions(candidates: DoodleCandidate[]) {
  return {
    keyword: {
      type: 'choice',
      instructions:
        '`line` 옆에 작고 귀여운 그림(두들)을 하나 그려 준다면 어느 낱말 바로 뒤에 그리는 게 가장 어울리는가? 한눈에 그림으로 알아볼 수 있는 사물·음식·동물·날씨·장소·활동을 가리키는 낱말을 고른다. 시간, 날짜, 사람, 추상적인 말(생각, 결론, 문제, 기분)은 고르지 않는다. 그릴 만한 낱말이 없으면 none',
      criteria: {
        ...Object.fromEntries(candidates.map((candidate) => [candidate.word, null])),
        [NONE]: '그림으로 그릴 만한 낱말이 없다',
      },
    },
    ...Object.fromEntries(
      candidates.map((candidate, i) => [
        doodleQuestionKey(i),
        {
          type: 'choice',
          instructions: {
            word: candidate.word,
            question:
              '`line`에 쓰인 `word`를 작은 그림 하나로 나타낸다면 어떤 그림인가? `word`가 이 줄에서 가리키는 것을 바로 떠올리게 하는 그림만 고른다. 딱 맞는 그림이 없으면 none',
          },
          criteria: { ...DOODLES, [NONE]: '`word`에 딱 맞는 그림이 목록에 없다' },
        },
      ]),
    ),
  };
}

// 기준값은 한국어·영어 141줄을 보고 골랐다. (jev-1.13.0) 이 값에서 105줄이 맞는 그림을 받았고, 애매하게 어긋난 그림 1줄
// ('이번 달은' → 달력 0.80)과 없어도 될 그림 1줄('메모' → 연필 0.77)이 남았다. 나머지 줄은 그리지 않았다.
// 그림: 맞는 그림은 거의 모두 0.8 이상이고, 어긋난 그림은 대부분('배 먹기'의 배→밥 0.62, 'auth module'→노트북 0.62) 0.7 아래였다.
// 낱말: 그릴 만한 낱말이 여럿이면 확률이 나뉘고('커피 마시면서 책 읽기'는 커피 0.78·책 0.20), 1등 낱말에 맞는 그림이 없으면
// 다음 낱말을 쓴다('공항 가는 버스 시간 확인'은 버스 0.68에 그림이 없어 공항 0.31 → 비행기). 그래서 낮게 둔다.
// 그릴 게 없는 줄('결론은 이렇다')은 낱말 확률이 대부분 0.1 아래였다.
const MIN_WORD = 0.2;
const MIN_DOODLE = 0.7;

export type RankedDoodle = DoodleCandidate & { id: DoodleId; wordP: number; doodleP: number };

/** 후보마다 고른 그림과 확률. 그림이 none인 후보는 뺀다. */
export function rankDoodles(answers: Record<string, JevAnswer>, candidates: DoodleCandidate[]): RankedDoodle[] {
  const words = answers.keyword?.probabilities ?? {};
  return candidates.flatMap((candidate, i) => {
    const answer = answers[doodleQuestionKey(i)];
    const id = answer?.choice;
    if (!isDoodleId(id)) return [];
    return [{ ...candidate, id, wordP: words[candidate.word] ?? 0, doodleP: answer?.probabilities?.[id] ?? 0 }];
  });
}

/**
 * 낱말도 그림도 기준을 넘는 후보 가운데 둘의 곱이 가장 큰 것. 없으면 null — 그림은 없어도 괜찮다.
 * 그림은 늘 그 낱말에게 물은 답이라, 뽑힌 낱말과 그림이 어긋나지 않는다.
 */
export function decideDoodle(answers: Record<string, JevAnswer>, candidates: DoodleCandidate[]): DoodlePick | null {
  let best: RankedDoodle | null = null;
  for (const ranked of rankDoodles(answers, candidates)) {
    if (ranked.wordP < MIN_WORD || ranked.doodleP < MIN_DOODLE) continue;
    if (!best || ranked.wordP * ranked.doodleP > best.wordP * best.doodleP) best = ranked;
  }
  if (!best) return null;
  const { word, start, length, id, wordP, doodleP } = best;
  return { word, start, length, id, confidence: Math.round(wordP * doodleP * 1000) / 1000 };
}
