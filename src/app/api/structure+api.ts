import { askJev, jevConfigured, rejectUnlessApp, lineId } from '../../server/jev';

// 붙여넣은 글의 줄마다 메모에서 어떤 모양이어야 하는지 고른다. (TypeSafe Structure recovery 쿡북 방식)
// Jev는 글자를 고치지 않고 줄의 종류만 판단한다. 실제로 바꾸는 일은 앱이 한다.
const MAX_LINE = 300;
const MAX_LINES = 60;
const TIMEOUT_MS = 4000;

// 배열 순번('lines[4]')으로 가리키면 앞뒤 줄을 헷갈렸다. 줄마다 ID를 붙여 가리킨다.
const CRITERIA = {
  heading:
    '바로 아래에 오는 여러 줄을 묶는 이름 ("재료", "만드는 법", "준비물", "다음 할 일", "주말 장보기"). 물건·재료·동작 하나는 heading이 아니다',
  paragraph: '완결된 문장으로 된 일반 글. 일기, 설명, 회의 내용 요약',
  bullet: '목록의 한 항목이지만 할 일은 아닌 것. 레시피 재료, 참석자, 가져갈 물건, 특징 나열',
  number:
    '차례대로 해야 하는 단계 하나를 적은 동작 문장 ("돼지고기를 먼저 볶는다", "설정을 연다"). 단계들을 묶는 소제목은 heading이다',
  todo: '작성자나 담당자가 해야 할 일. 장보기 목록에 적은 살 물건("우유", "세제")도 할 일이다. 담당자가 붙은 업무도 할 일이다',
};
type Kind = keyof typeof CRITERIA;

const MIN_CONFIDENCE = 0.4;
// 목록 항목 가운데 이보다 확신이 낮은 줄은 같은 목록의 다수를 따른다. (한 목록이 체크박스·글머리표로 섞이지 않게)
const FOLLOW_LIST_BELOW = 0.7;

type Read = { kind: Kind; confidence: number; probabilities: Record<string, number> } | null;

const isListItem = (read: Read) => read?.kind === 'bullet' || read?.kind === 'todo';

function decideKinds(reads: Read[]): (Kind | null)[] {
  const kinds = reads.map((read) => (read && read.confidence >= MIN_CONFIDENCE ? read.kind : null));
  // 이어진 목록 항목들을 한 묶음으로 보고, 확률을 더해 체크박스인지 글머리표인지 정한다.
  for (let start = 0; start < reads.length; ) {
    if (!isListItem(reads[start])) {
      start++;
      continue;
    }
    let end = start;
    while (end + 1 < reads.length && isListItem(reads[end + 1])) end++;
    let todo = 0;
    let bullet = 0;
    for (let i = start; i <= end; i++) {
      todo += reads[i]?.probabilities.todo ?? 0;
      bullet += reads[i]?.probabilities.bullet ?? 0;
    }
    const winner: Kind = todo >= bullet ? 'todo' : 'bullet';
    for (let i = start; i <= end; i++) {
      const read = reads[i];
      if (read && read.confidence < FOLLOW_LIST_BELOW) kinds[i] = winner;
    }
    start = end + 1;
  }
  return kinds;
}

export async function POST(request: Request) {
  const rejected = rejectUnlessApp(request);
  if (rejected) return rejected;
  if (!jevConfigured()) return Response.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.json().catch(() => null);
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : '';
  const lines: string[] = (Array.isArray(body?.lines) ? body.lines : [])
    .map((line: unknown) => (typeof line === 'string' ? line.trim() : ''))
    .slice(0, MAX_LINES);
  if (lines.length < 2 || lines.some((line) => line.length > MAX_LINE)) {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  const document = [
    ...(title ? [`메모 제목: ${title}`, ''] : []),
    ...lines.map((line, i) => `${lineId(i)}| ${line}`),
  ].join('\n');
  const questions = Object.fromEntries(
    lines.flatMap((line, i) =>
      line
        ? [
            [
              lineId(i),
              {
                type: 'choice',
                instructions: `붙여넣은 글에서 ${lineId(i)} 줄은 메모에서 어떤 모양이어야 하는가? 앞뒤 줄과 글 전체의 흐름을 보고 판단한다`,
                criteria: CRITERIA,
              },
            ],
          ]
        : [],
    ),
  );
  const answers = await askJev(document, questions, TIMEOUT_MS);
  if (!answers) return Response.json({ error: 'upstream' }, { status: 502 });

  const reads = lines.map((_, i): Read => {
    const answer = answers[lineId(i)];
    const kind = answer?.choice as Kind | undefined;
    if (!kind || !(kind in CRITERIA)) return null;
    return { kind, confidence: answer.confidence ?? 0, probabilities: answer.probabilities ?? {} };
  });
  const kinds = decideKinds(reads);
  return Response.json({ kinds });
}
