// 메모 한 줄이 할 일인지 Jev(TypeSafe AI)에 묻는다. API 키는 서버에서만 읽는다.
const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
const MAX_TITLE = 200;
const MAX_LINE = 500;
const TIMEOUT_MS = 2500;

// 할 일 확률이 높아도 '장보기 목록' 같은 소제목은 할 일이 아니다. 한 번의 호출로 둘 다 묻는다.
// 기준값은 한국어·영어 36줄로 확인했다. (소제목 0.80~0.92, 실제 할 일 0.66 이하)
const QUESTIONS = {
  is_todo: {
    type: 'noul',
    instructions: '이 메모 한 줄은 작성자가 앞으로 직접 해야 할 구체적인 행동(할 일, to-do)이다',
  },
  is_heading: {
    type: 'noul',
    instructions: '이 줄은 행동이 아니라 목록이나 메모의 제목·소제목·분류 이름이다',
  },
};
const TODO_THRESHOLD = 0.7;
const HEADING_THRESHOLD = 0.7;

export async function POST(request: Request) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const line = typeof body?.line === 'string' ? body.line.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  if (!line || line.length > MAX_LINE || title.length > MAX_TITLE) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (line === title) return Response.json({ isTodo: false });

  // 제목이 있으면 함께 보낸다. ('장보기' 아래의 '우유 사기'처럼 제목이 판단을 크게 돕는다)
  const state = title ? { memo_title: title, line } : line;

  try {
    const response = await fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'jev-latest',
        state,
        questions: QUESTIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return Response.json({ error: 'upstream' }, { status: 502 });

    const data = await response.json();
    const todo = data?.answers?.is_todo?.noul;
    const heading = data?.answers?.is_heading?.noul;
    if (typeof todo !== 'number' || typeof heading !== 'number') {
      return Response.json({ error: 'upstream' }, { status: 502 });
    }
    return Response.json({ isTodo: todo >= TODO_THRESHOLD && heading < HEADING_THRESHOLD });
  } catch {
    return Response.json({ error: 'upstream' }, { status: 502 });
  }
}
