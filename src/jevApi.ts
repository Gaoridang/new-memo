import { isDoodleId, type DoodleId } from './doodles/catalog';

// 서버 라우트(src/app/api)를 거쳐 Jev(TypeSafe AI)에 묻는다.
// 네트워크나 서버 문제로 답을 받지 못하면 null — 부르는 쪽은 그냥 아무것도 하지 않으면 된다.

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 서버(src/server/jev.ts)가 앱에서 온 요청인지 확인하는 값
        'x-app-token': process.env.EXPO_PUBLIC_APP_TOKEN ?? '',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function localToday() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** isTodo면 바로 바꾼다. maybe는 애매한 줄로, 앱은 바꾸지 않는다. due는 줄에 적힌 마감일('YYYY-MM-DD'). */
export type TodoVerdict = { isTodo: boolean; maybe: boolean; due: string | null };

export async function detectTodo(title: string, line: string, nearby: string[]): Promise<TodoVerdict | null> {
  const data = await post<Partial<TodoVerdict>>('/api/todo', { title, line, nearby, today: localToday() }, 4000);
  if (typeof data?.isTodo !== 'boolean') return null;
  return {
    isTodo: data.isTodo,
    maybe: data.maybe === true,
    due: typeof data.due === 'string' ? data.due : null,
  };
}

/** 이미 할 일인 줄의 마감일('YYYY-MM-DD'). 날짜가 적혀 있지 않으면 due가 null이다. */
export type DueAnswer = { due: string | null };

export async function detectDue(line: string): Promise<DueAnswer | null> {
  const data = await post<{ due?: unknown }>('/api/due', { line, today: localToday() }, 4000);
  if (!data || !('due' in data)) return null;
  return { due: typeof data.due === 'string' ? data.due : null };
}

/** 붙여넣은 줄마다 어떤 모양으로 바꿀지. heading·paragraph·null은 그대로 둔다. */
export type PasteKind = 'heading' | 'paragraph' | 'bullet' | 'number' | 'todo' | null;

export async function classifyPaste(title: string, lines: string[]): Promise<PasteKind[] | null> {
  const data = await post<{ kinds?: unknown }>('/api/structure', { title, lines }, 6000);
  return Array.isArray(data?.kinds) && data.kinds.length === lines.length ? (data.kinds as PasteKind[]) : null;
}

/** 줄의 start부터 length만큼(UTF-16)이 word이고, 그 뒤에 id 그림을 그린다. confidence(0-1)가 높을수록 확실하다. */
export type DoodleSuggestion = { id: DoodleId; word: string; start: number; length: number; confidence: number };

/**
 * 줄에서 그림을 붙일 낱말들 (확실한 순서). 붙일 낱말이 없으면 빈 배열, 답을 받지 못하면 null.
 * 한 줄에 하나만 답하던 서버(doodle)도 읽는다.
 */
export async function suggestDoodles(title: string, line: string, nearby: string[]): Promise<DoodleSuggestion[] | null> {
  const data = await post<{ doodles?: unknown; doodle?: unknown }>('/api/doodle', { title, line, nearby }, 5000);
  const answered = Array.isArray(data?.doodles) ? data.doodles : data?.doodle === null ? [] : data?.doodle ? [data.doodle] : null;
  if (!answered) return null;
  const picks: DoodleSuggestion[] = [];
  for (const item of answered) {
    const doodle = item as Partial<DoodleSuggestion> | null;
    if (!doodle || !isDoodleId(doodle.id) || typeof doodle.start !== 'number' || typeof doodle.length !== 'number') continue;
    const { id } = doodle;
    const start = doodle.start;
    const length = doodle.length;
    // 보낸 줄에서 그 자리의 글자가 word와 같을 때만 믿는다.
    const word = line.slice(start, start + length);
    if (!word || word !== doodle.word) continue;
    // 낱말이 겹치면 확실한 앞쪽만 쓴다.
    if (picks.some((pick) => start < pick.start + pick.length && pick.start < start + length)) continue;
    picks.push({ id, word, start, length, confidence: typeof doodle.confidence === 'number' ? doodle.confidence : 0 });
  }
  return picks;
}

export type SearchLine = { title: string; text: string };
export type SearchResult = { index: number; relevance: number };

/** 질문에 답하는 줄의 순번(lines 기준). 답이 없으면 빈 배열. */
export async function searchLines(query: string, lines: SearchLine[]): Promise<SearchResult[] | null> {
  const data = await post<{ results?: unknown }>('/api/search', { query, lines }, 8000);
  return Array.isArray(data?.results) ? (data.results as SearchResult[]) : null;
}
