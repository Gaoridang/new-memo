import type { JevAnswer } from './jev';

// 할 일 줄에 적힌 마감일. Jev는 날짜의 조각(몇 월, 며칠, 무슨 요일)만 읽고, 달력 계산은 코드가 한다.
// (Jev는 날짜를 글자로 읽어서 계산·비교는 믿을 수 없다 — TypeSafe Date extraction 쿡북 방식)
const MIN_CONFIDENCE = 0.6;
// 연도 없이 적은 날짜가 이보다 더 지났으면 내년 날짜로 본다.
const PAST_DAYS_BEFORE_NEXT_YEAR = 60;

const NONE = '이 줄에 이런 날짜가 적혀 있지 않다';
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

function options(keys: string[]) {
  return Object.fromEntries([...keys.map((key) => [key, null]), ['none', NONE]]);
}

export const DUE_QUESTIONS = {
  due_mode: {
    type: 'choice',
    instructions:
      '`line`에 적힌 할 일의 마감일·날짜가 어떻게 적혀 있는가? absolute = 월과 일을 적은 날짜("10월 3일", "3/15"), relative = 오늘 기준으로 적은 날짜("오늘", "내일", "모레", "금요일", "다음 주 월요일"), none = 날짜가 없다',
    criteria: { absolute: null, relative: null, none: null },
  },
  due_month: {
    type: 'choice',
    instructions: '`line`의 날짜가 absolute라면 몇 월인가?',
    criteria: options(Array.from({ length: 12 }, (_, i) => String(i + 1))),
  },
  due_day: {
    type: 'choice',
    instructions: '`line`의 날짜가 absolute라면 며칠인가? (1-31)',
    criteria: options(Array.from({ length: 31 }, (_, i) => String(i + 1))),
  },
  due_anchor: {
    type: 'choice',
    instructions:
      '`line`의 날짜가 오늘 기준이라면 어느 날인가? today = 오늘, tomorrow = 내일, day_after = 모레, weekday = 요일 이름으로 적음',
    criteria: { today: null, tomorrow: null, day_after: null, weekday: null, none: NONE },
  },
  due_weekday: {
    type: 'choice',
    instructions: '`line`에 요일이 적혀 있다면 무슨 요일인가?',
    criteria: {
      mon: '월요일',
      tue: '화요일',
      wed: '수요일',
      thu: '목요일',
      fri: '금요일',
      sat: '토요일',
      sun: '일요일',
      none: NONE,
    },
  },
  due_week: {
    type: 'choice',
    instructions:
      '`line`에 요일이 적혀 있다면 어느 주인가? next = "다음 주 금요일"처럼 다음 주, current = "이번 주 금요일"처럼 이번 주, none = 그냥 "금요일"처럼 주를 말하지 않음',
    criteria: { current: null, next: null, none: NONE },
  },
};

type Ymd = { year: number; month: number; day: number };

export function parseYmd(value: unknown): Ymd | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 ? { year, month, day } : null;
}

function toUtc({ year, month, day }: Ymd) {
  return new Date(Date.UTC(year, month - 1, day));
}

function format(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

/** 믿을 만한 답일 때만 고른 값을 돌려준다. */
function pick(answers: Record<string, JevAnswer>, key: keyof typeof DUE_QUESTIONS) {
  const answer = answers[key];
  if (typeof answer?.choice !== 'string' || (answer.confidence ?? 0) < MIN_CONFIDENCE) return null;
  return answer.choice === 'none' ? null : answer.choice;
}

/** Jev가 읽은 날짜 조각을 today 기준의 'YYYY-MM-DD'로 바꾼다. 날짜가 없거나 애매하면 null. */
export function resolveDue(answers: Record<string, JevAnswer>, today: Ymd): string | null {
  const mode = pick(answers, 'due_mode');
  const base = toUtc(today);

  if (mode === 'absolute') {
    const month = Number(pick(answers, 'due_month'));
    const day = Number(pick(answers, 'due_day'));
    if (!month || !day) return null;
    let year = today.year;
    let date = parseYmd(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (!date) return null;
    if (toUtc(date) < addDays(base, -PAST_DAYS_BEFORE_NEXT_YEAR)) {
      year += 1;
      date = parseYmd(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      if (!date) return null;
    }
    return format(toUtc(date));
  }

  if (mode === 'relative') {
    // '다음 주 월요일'처럼 요일을 적으면 anchor는 확신이 낮게 나와도 요일은 확실하게 나온다.
    const weekday = pick(answers, 'due_weekday');
    if (weekday) {
      const target = WEEKDAYS.indexOf(weekday as (typeof WEEKDAYS)[number]);
      const current = (base.getUTCDay() + 6) % 7; // 월요일 = 0
      const monday = addDays(base, -current);
      const week = pick(answers, 'due_week');
      if (week === 'next') return format(addDays(monday, 7 + target));
      if (week === 'current') return format(addDays(monday, target));
      return format(addDays(base, (target - current + 7) % 7));
    }
    const offset = { today: 0, tomorrow: 1, day_after: 2 }[pick(answers, 'due_anchor') ?? ''];
    return offset === undefined ? null : format(addDays(base, offset));
  }

  return null;
}
