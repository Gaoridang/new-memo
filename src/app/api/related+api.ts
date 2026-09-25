// 방금 고친 메모가 다른 메모와 같은 대상을 이어서 다루는지 Jev(TypeSafe AI)에 묻는다.
// API 키는 서버에서만 읽는다.
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_CANDIDATES = 16;
// 후보 하나에 질문 두 개. 요청 하나가 너무 커지지 않도록 나눠서 동시에 보낸다.
const CANDIDATES_PER_REQUEST = 8;
const MAX_ID = 64;
const MAX_TITLE = 200;
const MAX_BODY = 2000;
const MAX_SNIPPET = 400;
const MAX_DATE = 60;
const TIMEOUT_MS = 4000;

// 업무·장보기처럼 종류만 같은 메모가 엮이지 않도록 한 후보에 두 가지를 함께 묻는다.
// 같은 대상일 확률은 높고, 종류만 같을 확률은 낮아야 제안한다.
// TODO: 기준값은 아직 실제 메모로 맞춰 보지 않았다. (할 일 감지는 36줄로 맞췄다)
const SAME_THRESHOLD = 0.7;
const KIND_THRESHOLD = 0.5;

type MemoInput = { title: string; body: string; date: string };
type Candidate = MemoInput & { id: string };

function readText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) : null;
}

function readMemo(value: unknown, maxBody: number): MemoInput | null {
  const input = value as Partial<MemoInput> | null;
  const title = readText(input?.title, MAX_TITLE);
  const body = readText(input?.body, maxBody);
  const date = readText(input?.date, MAX_DATE);
  if (title === null || body === null || date === null || (!title && !body)) return null;
  return { title, body, date };
}

function readCandidate(value: unknown): Candidate | null {
  const id = (value as { id?: unknown } | null)?.id;
  const memo = readMemo(value, MAX_SNIPPET);
  if (typeof id !== 'string' || !id || id.length > MAX_ID || !memo) return null;
  return { id, ...memo };
}

function describe({ title, body, date }: MemoInput) {
  return [`제목: ${title || '(없음)'}`, `마지막 수정: ${date}`, `내용: ${body || '(없음)'}`].join('\n');
}

function questionsFor(candidates: Candidate[]) {
  const questions: Record<string, { type: 'noul'; instructions: string }> = {};
  candidates.forEach((candidate, index) => {
    const other = describe(candidate);
    questions[`same_${index}`] = {
      type: 'noul',
      instructions: `이 메모와 아래 메모는 같은 구체적인 대상(같은 프로젝트·일정·여행·행사·사람·물건 등)을 이어서 다룬다.\n\n아래 메모\n${other}`,
    };
    questions[`kind_${index}`] = {
      type: 'noul',
      instructions: `이 메모와 아래 메모는 메모의 종류(업무, 장보기, 일기 등)만 비슷할 뿐 다루는 대상은 서로 다르다.\n\n아래 메모\n${other}`,
    };
  });
  return questions;
}

async function askJev(key: string, state: object, candidates: Candidate[]) {
  const response = await fetch(JEV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions: questionsFor(candidates) }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Jev ${response.status}`);

  const data = await response.json();
  return candidates.map((candidate, index) => {
    const same = data?.answers?.[`same_${index}`]?.noul;
    const kind = data?.answers?.[`kind_${index}`]?.noul;
    if (typeof same !== 'number' || typeof kind !== 'number') throw new Error('Jev answer');
    return { id: candidate.id, same, kind };
  });
}

export async function POST(request: Request) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const memo = readMemo(body?.memo, MAX_BODY);
  const inputs: unknown[] = Array.isArray(body?.candidates) ? body.candidates : [];
  const candidates = inputs.map(readCandidate).filter((candidate) => candidate !== null);
  if (
    !memo ||
    !Array.isArray(body?.candidates) ||
    inputs.length > MAX_CANDIDATES ||
    candidates.length !== inputs.length
  ) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (candidates.length === 0) return Response.json({ related: [] });

  const state = { memo_title: memo.title || '(없음)', last_edited: memo.date, body: memo.body || '(없음)' };
  const batches: Candidate[][] = [];
  for (let i = 0; i < candidates.length; i += CANDIDATES_PER_REQUEST) {
    batches.push(candidates.slice(i, i + CANDIDATES_PER_REQUEST));
  }

  try {
    const answers = (await Promise.all(batches.map((batch) => askJev(key, state, batch)))).flat();
    const related = answers
      .filter(({ same, kind }) => same >= SAME_THRESHOLD && kind < KIND_THRESHOLD)
      .map(({ id, same, kind }) => ({ id, score: same - kind }))
      .sort((a, b) => b.score - a.score);
    return Response.json({ related });
  } catch {
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
}
