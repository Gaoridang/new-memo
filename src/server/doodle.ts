import { DOODLES, isDoodleId, type DoodleId } from '../doodles/catalog';
import type { JevAnswer } from './jev';

// 메모 한 줄에서 두들을 붙일 낱말들과 그 낱말에 맞는 그림을 고른다. (TypeSafe Pre-parsed value extraction 쿡북 방식)
// 낱말 후보는 코드가 띄어쓰기로 찾고, Jev는 후보마다 그림을 고르기만 한다. 그래서 돌려주는 낱말은 늘 줄에 있는 글자 그대로다.
// 그림은 낱말마다 붙는다. 그림이 있는 낱말은 한 줄에 여럿일 수 있다. ('커피 마시면서 책 읽기'의 커피와 책)
// 후보는 조사까지 붙은 어절이다. 그림은 '커피'와 '를' 사이가 아니라 '커피를' 뒤에 온다.
// 붙여 쓴 어절('딸기우유', '청소기칫솔')은 그 속 마지막 두들 낱말로 묻는다. 합성어는 뒤 낱말이 중심이다. (딸기우유는 우유다)
// 칩은 그래도 어절 전체를 감싼다. (편집기가 칩을 어절 단위로 그린다)

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

/**
 * 두들 낱말을 둘 이상 붙여 쓴 어절이면 물을 낱말(그 가운데 마지막 낱말)과 어절 안의 위치.
 * ('딸기우유' → 우유, '청소기칫솔' → 칫솔, '칫솔치약사기' → 치약 / '커피를', '바나나우유' → 없음)
 * 낱말마다 물으면 Jev가 더 그리기 쉬운 쪽을 골라 '딸기우유'에 딸기를 그렸다.
 */
function joinedHead(word: string): { word: string; offset: number } | null {
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
  return found.length >= 2 ? found[found.length - 1] : null;
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
    const head = joinedHead(word);
    if (head) {
      add(head.word, start + head.offset);
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
// 낱말 확률은 후보끼리 나누는 값이라 그릴 낱말이 여럿이면 몫이 작아진다. 그래서 가장 뚜렷한 낱말(MIN_WORD 이상)이 있는 줄에서만
// 다른 낱말에도 그림을 붙이고, 그 낱말들은 둘 중 하나면 된다. (jev-1.13.0, 40줄로 확인)
// - 낱말 확률이 MIN_EXTRA_WORD 이상이고 그림이 MIN_DOODLE 이상: Jev도 그릴 만하다고 본 낱말. 그릴 수 없는 낱말('오늘', '받기', '마시면서')은
//   그림을 억지로 받아도('마시면서'→커피 0.78) 낱말 확률이 0.03 이하였다.
// - 낱말이 고른 그림의 목록 낱말을 그대로 담고 있고('집에'의 집, '설거지하기'의 설거지) 그림이 MIN_NAMED_DOODLE 이상:
//   '오늘 회의 끝나고 집에 가서 밥 먹기'의 집에(0.01)와 회의(0.01)는 밥이 낱말 확률을 거의 다 가져가도 그림이 맞았다.
const MIN_WORD = 0.2;
const MIN_DOODLE = 0.7;
const MIN_EXTRA_WORD = 0.1;
const MIN_NAMED_DOODLE = 0.55;

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

// 그림마다 목록 설명의 한국어 낱말과 영어 낱말. ('coffee': 커피·카페·… / coffee, cafe, …)
const PICTURE_TERMS = Object.fromEntries(
  Object.entries(DOODLES).map(([id, description]) => [
    id,
    {
      ko: description
        .split(' (')[0]
        .split('·')
        .map((term) => term.replace(/\s+/g, ''))
        .filter((term) => /^\p{Script=Hangul}+$/u.test(term)),
      en: (description.match(/\(([^)]*)\)/)?.[1] ?? '')
        .split(',')
        .map((term) => term.trim().toLowerCase())
        .filter((term) => /^[a-z]{2,}$/.test(term)),
    },
  ]),
) as Record<DoodleId, { ko: string[]; en: string[] }>;

/**
 * 낱말이 그 그림의 목록 낱말을 그대로 담고 있는지. 한국어는 낱말 속에 있으면 되고(조사·어미가 붙는다),
 * 한 글자 낱말('집', '약', '차')은 낱말이 그 글자로 시작해야 한다. 영어는 낱말이 같거나 복수형이어야 한다.
 */
function namesPicture(word: string, id: DoodleId): boolean {
  const { ko, en } = PICTURE_TERMS[id];
  const lower = word.toLowerCase();
  return (
    ko.some((term) => (term.length === 1 ? word.startsWith(term) : word.includes(term))) ||
    en.some((term) => lower === term || lower === `${term}s` || lower === `${term}es`)
  );
}

const score = (ranked: RankedDoodle) => ranked.wordP * ranked.doodleP;

const toPick = ({ word, start, length, id, wordP, doodleP }: RankedDoodle): DoodlePick => ({
  word,
  start,
  length,
  id,
  confidence: Math.round(wordP * doodleP * 1000) / 1000,
});

/**
 * 그림을 붙일 낱말들 (확실한 순서). 낱말도 그림도 기준을 넘는 후보 가운데 둘의 곱이 가장 큰 것이 첫째이고,
 * 첫째가 없으면 그릴 게 없는 줄이라 빈 배열이다. 그림은 없어도 괜찮다.
 * 첫째 말고도 Jev가 그릴 만하다고 본 낱말(MIN_EXTRA_WORD)과 그림의 목록 낱말을 담은 낱말(MIN_NAMED_DOODLE)에는 각각 붙인다.
 * 그림은 늘 그 낱말에게 물은 답이라, 낱말과 그림이 어긋나지 않는다.
 */
export function decideDoodles(answers: Record<string, JevAnswer>, candidates: DoodleCandidate[]): DoodlePick[] {
  const ranked = rankDoodles(answers, candidates);
  const strongest = ranked
    .filter((item) => item.wordP >= MIN_WORD && item.doodleP >= MIN_DOODLE)
    .reduce<RankedDoodle | null>((best, item) => (!best || score(item) > score(best) ? item : best), null);
  if (!strongest) return [];

  const others = ranked
    .filter((item) => item !== strongest)
    .filter(
      (item) =>
        (item.wordP >= MIN_EXTRA_WORD && item.doodleP >= MIN_DOODLE) ||
        (item.doodleP >= MIN_NAMED_DOODLE && namesPicture(item.word, item.id)),
    )
    .sort((a, b) => score(b) - score(a));
  return [strongest, ...others].map(toPick);
}
