import { askJev, jevConfigured, rejectUnlessApp, lineId } from '../../server/jev';

// 메모의 줄 가운데 질문에 답하는 줄을 뜻으로 찾는다. (TypeSafe Line-by-line search 쿡북 방식)
// 줄마다 ID를 붙여 Choice로 가리키게 하고, 같은 요청의 Noul로 답이 있기는 한지 따로 묻는다.
// Choice 확률은 항상 합이 1이라 답이 없어도 어떤 줄이 1등이 되기 때문이다.
const MAX_QUERY = 200;
const MAX_TITLE = 60;
const MAX_LINE = 200;
// Choice 하나가 고를 수 있는 선택지 수의 상한
const MAX_LINES = 255;
// 한 번에 보내는 글자 수. 한국어 메모는 글자당 토큰이 1개 남짓이라, 넘치면 Jev가 max_tokens_exceeded로 거절한다.
// (보통 줄 255개 = 약 1만 자 = 1.1만 토큰은 통과, 200자 줄 255개는 거절)
const MAX_DOCUMENT_CHARS = 24_000;
const TIMEOUT_MS = 6000;

// 확인한 질문에서 답이 있으면 0.9 이상, 없으면 0.05 이하였다.
const EXISTS_THRESHOLD = 0.35;
const MIN_RELEVANCE = 0.1;
const MAX_RESULTS = 5;

export async function POST(request: Request) {
  const rejected = rejectUnlessApp(request);
  if (rejected) return rejected;
  if (!jevConfigured()) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const lines: { title: string; text: string }[] = [];
  let chars = 0;
  for (const line of (Array.isArray(body?.lines) ? body.lines : []).slice(0, MAX_LINES)) {
    const title = typeof line?.title === 'string' ? line.title.trim().slice(0, MAX_TITLE) : '';
    const text = typeof line?.text === 'string' ? line.text.trim().slice(0, MAX_LINE) : '';
    chars += title.length + text.length + 10;
    if (chars > MAX_DOCUMENT_CHARS) break;
    lines.push({ title, text });
  }
  if (!query || query.length > MAX_QUERY || lines.length === 0) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // 'L004| [장보기] 우유' — 줄이 어느 메모에 있는지도 함께 보여준다.
  const document = lines
    .map((line, i) => `${lineId(i)}| ${line.title ? `[${line.title}] ` : ''}${line.text}`)
    .join('\n');
  const answers = await askJev(
    document,
    {
      where: {
        type: 'choice',
        instructions: `메모의 어느 줄이 이 질문에 답하거나 가장 관련 있는가: "${query}"`,
        criteria: Object.fromEntries(lines.map((_, i) => [lineId(i), null])),
      },
      exists: {
        type: 'noul',
        instructions: `메모 중 어느 줄이든 이 질문에 답하거나 직접 관련 있는가: "${query}"`,
        criteria: {
          true: '적어도 한 줄이 답을 적었거나 바로 관련 있다',
          false: '이 질문과 관련된 줄이 없다',
        },
      },
    },
    TIMEOUT_MS,
  );
  const exists = answers?.exists?.noul;
  const probabilities = answers?.where?.probabilities;
  if (typeof exists !== 'number' || !probabilities) {
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
  if (exists < EXISTS_THRESHOLD) return Response.json({ results: [] });

  const results = lines
    .map((_, index) => ({ index, relevance: probabilities[lineId(index)] ?? 0 }))
    .filter((result) => result.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, MAX_RESULTS);
  return Response.json({ results });
}
