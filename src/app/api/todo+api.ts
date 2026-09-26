import { DUE_QUESTIONS, parseYmd, resolveDue } from '../../server/dueDate';
import { askJev, jevConfigured, rejectUnlessApp, strings } from '../../server/jev';

// 메모 한 줄이 할 일인지, 마감일이 있는지 Jev(TypeSafe AI)에 한 번에 묻는다.
const MAX_TITLE = 200;
const MAX_LINE = 500;
const MAX_NEARBY = 5;
const TIMEOUT_MS = 2500;

// 한 번의 Choice로 할 일·소제목·기록 중 하나를 고르게 한다. Jev는 지시를 글자 그대로 읽으므로
// 헷갈리기 쉬운 경우(명사만 있는 짧은 항목, 레시피 단계)를 기준에 직접 적었다.
// 기준값은 한국어·영어 약 80줄로 확인했다. 할 일은 대부분 0.9 이상, 할 일이 아닌 줄은 0.36 이하.
// 그 사이(주변 줄이 있어야 할 일로 보이는 '계란', '이메일 답장' 등)는 maybe로 알려 주고 앱은 바꾸지 않는다.
const KIND_QUESTION = {
  type: 'choice',
  instructions:
    '메모 앱의 한 줄(`line`)이 어떤 종류인지 고른다. `line`만 판단하고, `memo_title`과 `nearby_lines`는 맥락으로만 참고한다.',
  criteria: {
    todo: '작성자가 직접 해야 할 일. 동사가 있는 문장("세탁소 들르기", "call mom")뿐 아니라 "우유 사기", "치과 예약", "보고서 제출", "책 반납"처럼 명사 한두 개에 행동(사기·예약·제출·반납·전화)이 붙은 짧은 항목도 할 일이다',
    heading:
      '행동이 아니라 목록이나 메모를 묶는 제목·소제목·분류 이름. 예: "장보기 목록", "이번 주 할 일", "회의록", "Groceries", "아이디어"',
    note: '사실, 감상, 생각, 일기, 남의 이야기, 날씨나 소식처럼 작성자가 할 행동이 아닌 기록. 레시피 단계, 사용법, 설명서처럼 방법이나 절차를 적어 둔 줄도 여기에 속한다',
  },
};
const AUTO_THRESHOLD = 0.8;
const SUGGEST_THRESHOLD = 0.45;

export async function POST(request: Request) {
  const rejected = rejectUnlessApp(request);
  if (rejected) return rejected;
  if (!jevConfigured()) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const line = typeof body?.line === 'string' ? body.line.trim() : '';
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  // 상대 날짜('내일', '금요일')는 사용자 기기의 오늘을 기준으로 계산한다.
  const today = parseYmd(body?.today);
  if (!line || line.length > MAX_LINE || title.length > MAX_TITLE || !today) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }
  if (line === title) return Response.json({ isTodo: false, maybe: false, due: null });

  // 주변 줄은 제목이 없을 때 특히 도움이 된다. ('장보기' 목록 사이의 '계란'과 아침 일기 속 '계란')
  const nearby = strings(body?.nearby, MAX_NEARBY, MAX_LINE).filter(Boolean);

  const answers = await askJev(
    { memo_title: title, line, nearby_lines: nearby },
    { kind: KIND_QUESTION, ...DUE_QUESTIONS },
    TIMEOUT_MS,
  );
  const kind = answers?.kind;
  const todo = kind?.probabilities?.todo;
  if (!answers || typeof kind?.choice !== 'string' || typeof todo !== 'number') {
    return Response.json({ error: 'upstream' }, { status: 502 });
  }

  const isTodo = kind.choice === 'todo' && todo >= AUTO_THRESHOLD;
  const maybe = !isTodo && todo >= SUGGEST_THRESHOLD;
  return Response.json({ isTodo, maybe, due: isTodo || maybe ? resolveDue(answers, today) : null });
}
