import { DUE_QUESTIONS, parseYmd, resolveDue } from '../../server/dueDate';
import { askJev, jevConfigured, rejectUnlessApp } from '../../server/jev';

// 이미 할 일인 줄(사용자가 직접 만든 체크박스, 붙여넣어 체크박스가 된 줄)의 마감일만 Jev(TypeSafe AI)에 묻는다.
// 할 일인지 다시 묻지 않으므로 할 일 판정과 상관없이 날짜를 돌려준다.
const MAX_LINE = 500;
const TIMEOUT_MS = 2500;

export async function POST(request: Request) {
  const rejected = rejectUnlessApp(request);
  if (rejected) return rejected;
  if (!jevConfigured()) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const line = typeof body?.line === 'string' ? body.line.trim() : '';
  // 상대 날짜('내일', '금요일')는 사용자 기기의 오늘을 기준으로 계산한다.
  const today = parseYmd(body?.today);
  if (!line || line.length > MAX_LINE || !today) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const answers = await askJev({ line }, DUE_QUESTIONS, TIMEOUT_MS);
  if (!answers) return Response.json({ error: 'upstream' }, { status: 502 });
  return Response.json({ due: resolveDue(answers, today) });
}
