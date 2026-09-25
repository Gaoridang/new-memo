import { File, Paths } from 'expo-file-system';

import type { Memo } from './memoStorage';

type Pair = [string, string];

export type Suggestion = {
  // 방금 살펴본 메모
  memoId: string;
  // 그 메모와 같은 대상을 이어서 다루는 것 같은 메모
  relatedId: string;
  score: number;
};

export type LinkData = {
  // 사용자가 연결한 메모 쌍. 방향은 없고, 이어진 메모끼리 하나의 스레드가 된다.
  links: Pair[];
  // 사용자가 무시했거나 연결을 해제한 쌍. 다시 제안하지 않는다.
  dismissed: Pair[];
  suggestions: Suggestion[];
  // 메모마다 마지막으로 살펴본 버전(updatedAt). 그 뒤로 고치지 않았으면 다시 묻지 않는다.
  analyzed: Record<string, number>;
};

// 메모 파일과 따로 memo-links.json 하나에 둔다.
const LINKS_FILE = 'memo-links.json';
const TEMP_SUFFIX = '.tmp';
const EMPTY: LinkData = { links: [], dismissed: [], suggestions: [], analyzed: {} };

let cache: LinkData | null = null;
const listeners = new Set<() => void>();

function isPair(value: unknown): value is Pair {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'string'
  );
}

function isSuggestion(value: unknown): value is Suggestion {
  const suggestion = value as Suggestion | null;
  return (
    typeof suggestion?.memoId === 'string' &&
    typeof suggestion.relatedId === 'string' &&
    typeof suggestion.score === 'number'
  );
}

function parse(text: string): LinkData {
  const data = JSON.parse(text);
  const analyzed: Record<string, number> = {};
  for (const [id, time] of Object.entries(data?.analyzed ?? {})) {
    if (typeof time === 'number') analyzed[id] = time;
  }
  return {
    links: Array.isArray(data?.links) ? data.links.filter(isPair) : [],
    dismissed: Array.isArray(data?.dismissed) ? data.dismissed.filter(isPair) : [],
    suggestions: Array.isArray(data?.suggestions) ? data.suggestions.filter(isSuggestion) : [],
    analyzed,
  };
}

export function getLinkData(): LinkData {
  if (cache) return cache;
  try {
    const file = new File(Paths.document, LINKS_FILE);
    cache = file.exists ? parse(file.textSync()) : EMPTY;
  } catch (error) {
    console.warn('메모 연결을 읽지 못했습니다.', error);
    cache = EMPTY;
  }
  return cache;
}

export function subscribeLinks(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 저장 도중 앱이 종료돼도 기존 연결이 깨지지 않도록 임시 파일에 먼저 쓴 뒤 교체한다.
function commit(next: LinkData) {
  cache = next;
  try {
    const temp = new File(Paths.document, `${LINKS_FILE}${TEMP_SUFFIX}`);
    temp.write(JSON.stringify(next));
    const target = new File(Paths.document, LINKS_FILE);
    if (target.exists) target.delete();
    temp.move(target);
  } catch (error) {
    console.warn('메모 연결을 저장하지 못했습니다.', error);
  }
  for (const listener of listeners) listener();
}

const isSamePair = ([x, y]: Pair, a: string, b: string) => (x === a && y === b) || (x === b && y === a);
const involves = ([x, y]: Pair, id: string) => x === id || y === id;
const suggestionPair = (suggestion: Suggestion): Pair => [suggestion.memoId, suggestion.relatedId];

function neighbors(links: Pair[], id: string) {
  return links.filter((pair) => involves(pair, id)).map(([x, y]) => (x === id ? y : x));
}

// 스레드 가운데 메모를 빼도 나머지는 한 스레드로 남도록 그 메모의 이웃끼리 잇는다.
function detach(links: Pair[], id: string): Pair[] {
  const [first, ...others] = neighbors(links, id);
  const rest = links.filter((pair) => !involves(pair, id));
  for (const other of others) {
    if (!rest.some((pair) => isSamePair(pair, first, other))) rest.push([first, other]);
  }
  return rest;
}

// id와 같은 스레드에 있는 메모들 (id 포함)
function threadMembers(links: Pair[], id: string) {
  const members = new Set([id]);
  const queue = [id];
  while (queue.length > 0) {
    for (const next of neighbors(links, queue.pop()!)) {
      if (members.has(next)) continue;
      members.add(next);
      queue.push(next);
    }
  }
  return members;
}

/**
 * 연결된 메모끼리 스레드로 묶는다. memos가 최근 수정 순이면
 * 스레드도, 스레드 안의 메모도 최근 수정 순이 된다.
 */
export function groupThreads(memos: Memo[], links: Pair[]): Memo[][] {
  const root = new Map(memos.map((memo) => [memo.id, memo.id]));
  const find = (id: string) => {
    let current = id;
    while (root.get(current) !== current) current = root.get(current)!;
    return current;
  };
  for (const [a, b] of links) {
    if (root.has(a) && root.has(b)) root.set(find(a), find(b));
  }

  const threads = new Map<string, Memo[]>();
  for (const memo of memos) {
    const key = find(memo.id);
    const thread = threads.get(key);
    if (thread) thread.push(memo);
    else threads.set(key, [memo]);
  }
  return [...threads.values()];
}

// memoId에게 다시 제안하지 않을 메모: 이미 같은 스레드, 무시한 쌍, 반대쪽에서 이미 제안한 쌍
export function blockedPartners(memoId: string) {
  const { links, dismissed, suggestions } = getLinkData();
  const blocked = threadMembers(links, memoId);
  for (const pair of dismissed) {
    if (involves(pair, memoId)) blocked.add(pair[0] === memoId ? pair[1] : pair[0]);
  }
  for (const suggestion of suggestions) {
    if (suggestion.relatedId === memoId) blocked.add(suggestion.memoId);
  }
  return blocked;
}

export function isAnalyzed(memo: Memo) {
  return getLinkData().analyzed[memo.id] === memo.updatedAt;
}

// 한 메모를 살펴본 결과로 그 메모의 제안을 바꾼다.
export function setSuggestions(memoId: string, analyzedAt: number, related: { id: string; score: number }[]) {
  const data = getLinkData();
  // 응답을 기다리는 동안 연결하거나 무시한 쌍은 빼고 넣는다.
  const blocked = blockedPartners(memoId);
  commit({
    ...data,
    suggestions: [
      ...data.suggestions.filter((suggestion) => suggestion.memoId !== memoId),
      ...related
        .filter(({ id }) => !blocked.has(id))
        .map(({ id, score }) => ({ memoId, relatedId: id, score })),
    ],
    analyzed: { ...data.analyzed, [memoId]: analyzedAt },
  });
}

export function linkMemos(a: string, b: string) {
  const data = getLinkData();
  const links: Pair[] = data.links.some((pair) => isSamePair(pair, a, b)) ? data.links : [...data.links, [a, b]];
  // 이번 연결로 같은 스레드가 된 메모끼리의 제안은 더 필요 없다.
  const thread = threadMembers(links, a);
  commit({
    ...data,
    links,
    suggestions: data.suggestions.filter(
      (suggestion) => !(thread.has(suggestion.memoId) && thread.has(suggestion.relatedId)),
    ),
  });
}

export function dismissSuggestion(a: string, b: string) {
  const data = getLinkData();
  commit({
    ...data,
    dismissed: data.dismissed.some((pair) => isSamePair(pair, a, b)) ? data.dismissed : [...data.dismissed, [a, b]],
    suggestions: data.suggestions.filter((suggestion) => !isSamePair(suggestionPair(suggestion), a, b)),
  });
}

export function isInThread(id: string) {
  return getLinkData().links.some((pair) => involves(pair, id));
}

// 메모를 스레드에서 뺀다. 끊은 쌍은 다시 제안하지 않는다.
export function leaveThread(id: string) {
  const data = getLinkData();
  const cut = neighbors(data.links, id).map((other): Pair => [id, other]);
  if (cut.length === 0) return;
  commit({ ...data, links: detach(data.links, id), dismissed: [...data.dismissed, ...cut] });
}

// 지운 메모는 연결과 제안에서 모두 뺀다.
export function forgetMemoLinks(id: string) {
  const data = getLinkData();
  const used =
    data.links.some((pair) => involves(pair, id)) ||
    data.dismissed.some((pair) => involves(pair, id)) ||
    data.suggestions.some((suggestion) => involves(suggestionPair(suggestion), id)) ||
    id in data.analyzed;
  if (!used) return;

  const { [id]: _, ...analyzed } = data.analyzed;
  commit({
    links: detach(data.links, id),
    dismissed: data.dismissed.filter((pair) => !involves(pair, id)),
    suggestions: data.suggestions.filter((suggestion) => !involves(suggestionPair(suggestion), id)),
    analyzed,
  });
}
