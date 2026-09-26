import { decideDoodle, doodleCandidates, doodleQuestions, doodleState } from '../../server/doodle';
import { askJev, jevConfigured, rejectUnlessApp, strings } from '../../server/jev';

// 메모 한 줄에서 두들을 붙일 낱말과 그림을 Jev(TypeSafe AI)에 한 번에 묻는다.
const MAX_TITLE = 200;
const MAX_LINE = 500;
const MAX_NEARBY = 5;
// 보통 0.2초 남짓에 답한다. (낱말 후보 10개까지 한 요청)
const TIMEOUT_MS = 3000;

export async function POST(request: Request) {
  const rejected = rejectUnlessApp(request);
  if (rejected) return rejected;
  if (!jevConfigured()) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  // 낱말 위치는 보낸 줄 그대로를 기준으로 센다. 그래서 앞뒤 공백을 잘라 내지 않는다.
  const line = typeof body?.line === 'string' ? body.line : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!line.trim() || line.length > MAX_LINE || title.length > MAX_TITLE) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  const candidates = doodleCandidates(line);
  if (candidates.length === 0) return Response.json({ doodle: null });

  const nearby = strings(body?.nearby, MAX_NEARBY, MAX_LINE).filter(Boolean);
  const answers = await askJev(doodleState(title, line.trim(), nearby), doodleQuestions(candidates), TIMEOUT_MS);
  if (!answers?.keyword) return Response.json({ error: 'upstream' }, { status: 502 });
  return Response.json({ doodle: decideDoodle(answers, candidates) });
}
