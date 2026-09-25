import { blockedPartners, isAnalyzed, setSuggestions } from './memoLinks';
import { listMemos, memoPreview, type Memo } from './memoStorage';
import { loadSettings } from './settings';

// Jev에 한 번에 물어볼 후보 수. 서버(src/app/api/related+api.ts)의 한도와 같다.
const MAX_CANDIDATES = 16;
// 글이 겹치는 메모를 먼저 고르고, 남는 자리는 가까운 때에 고친 메모로 채운다.
// 글이 겹치지 않아도 같은 대상일 수 있어서('여행 준비'와 '오사카 숙소') 시간으로도 고른다.
const TEXT_CANDIDATES = 10;
const BODY_LIMIT = 2000;
const SNIPPET_LIMIT = 400;
const TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;

const inFlight = new Set<string>();

type Related = { id: string; score: number };

/**
 * 방금 고친 메모와 같은 대상을 이어서 다루는 메모를 찾아 제안으로 남긴다.
 * 꺼져 있거나, 그 뒤로 고치지 않았거나, 네트워크 문제로 판단하지 못하면 아무것도 바꾸지 않는다.
 */
export async function suggestRelatedMemos(memoId: string) {
  if (!loadSettings().relatedMemos || inFlight.has(memoId)) return;

  const memos = listMemos();
  const memo = memos.find((item) => item.id === memoId);
  if (!memo || isAnalyzed(memo)) return;

  const blocked = blockedPartners(memo.id);
  const candidates = pickCandidates(
    memo,
    memos.filter((other) => !blocked.has(other.id)),
  );

  inFlight.add(memoId);
  try {
    const related = candidates.length > 0 ? await fetchRelated(memo, candidates) : [];
    if (related) setSuggestions(memo.id, memo.updatedAt, related);
  } finally {
    inFlight.delete(memoId);
  }
}

const memoText = (memo: Memo) => `${memo.title}\n${memoPreview(memo.content)}`;

// 한국어는 조사가 붙어도 겹치도록 낱말을 두 글자씩 끊어 비교한다.
function terms(text: string) {
  const result = new Set<string>();
  for (const word of text.toLowerCase().split(/[^0-9a-z぀-ヿㄱ-ㆎ一-鿿가-힣]+/)) {
    for (let i = 0; i + 2 <= word.length; i++) result.add(word.slice(i, i + 2));
  }
  return result;
}

function pickCandidates(memo: Memo, others: Memo[]): Memo[] {
  if (others.length <= MAX_CANDIDATES) return others;

  // 여러 메모에 흔한 조각('하기', '메모')보다 드문 조각이 겹칠수록 점수를 크게 준다.
  const own = terms(memoText(memo));
  const docs = others.map((other) => terms(memoText(other)));
  const shared = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc) if (own.has(term)) shared.set(term, (shared.get(term) ?? 0) + 1);
  }
  const textScore = (doc: Set<string>) => {
    let score = 0;
    for (const term of doc) {
      const count = shared.get(term);
      if (count) score += Math.log(1 + others.length / count);
    }
    return score / Math.sqrt(doc.size || 1);
  };

  const picked = new Set(
    others
      .map((other, index) => ({ other, score: textScore(docs[index]) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, TEXT_CANDIDATES)
      .map(({ other }) => other),
  );
  const byTime = [...others].sort(
    (a, b) => Math.abs(a.updatedAt - memo.updatedAt) - Math.abs(b.updatedAt - memo.updatedAt),
  );
  for (const other of byTime) {
    if (picked.size >= MAX_CANDIDATES) break;
    picked.add(other);
  }
  return [...picked];
}

function dayLabel(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function startOfDay(time: number) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Jev는 날짜 비교에 약하므로 두 메모의 간격을 미리 글로 적어 보낸다.
function gapLabel(time: number, base: number) {
  const days = Math.round((startOfDay(time) - startOfDay(base)) / DAY_MS);
  if (days === 0) return '이 메모와 같은 날';
  return days < 0 ? `이 메모보다 ${-days}일 전` : `이 메모보다 ${days}일 뒤`;
}

async function fetchRelated(memo: Memo, candidates: Memo[]): Promise<Related[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('/api/related', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memo: {
          title: memo.title.trim(),
          body: memoPreview(memo.content).slice(0, BODY_LIMIT),
          date: dayLabel(memo.updatedAt),
        },
        candidates: candidates.map((other) => ({
          id: other.id,
          title: other.title.trim(),
          body: memoPreview(other.content).slice(0, SNIPPET_LIMIT),
          date: `${dayLabel(other.updatedAt)} (${gapLabel(other.updatedAt, memo.updatedAt)})`,
        })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data?.related)) return null;
    return data.related.filter(
      (item: Partial<Related>) => typeof item?.id === 'string' && typeof item.score === 'number',
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
