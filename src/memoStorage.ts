import { Directory, File, Paths } from 'expo-file-system';

export type Memo = {
  id: string;
  title: string;
  // 에디터 문서(JSON 문자열). 형식은 modules/memo-editor/ios/MemoDocument.swift 참고
  content: string;
  // 할 일 줄(글자 그대로) → 마감일 'YYYY-MM-DD'. 할 일 자동 감지가 줄에서 읽어 채운다.
  dues: Record<string, string>;
  updatedAt: number;
};

// 메모 하나당 memos/<id>.json 파일 하나
const MEMO_DIR = 'memos';
// 예전 단일 메모 파일. 처음 실행할 때 memos/ 로 옮긴다.
const LEGACY_FILE = 'memo.json';
const LEGACY_TEMP_FILE = 'memo.tmp.json';
// 저장 도중 앱이 종료돼도 기존 메모가 깨지지 않도록 임시 파일에 먼저 쓴 뒤 교체한다.
const TEMP_SUFFIX = '.tmp';

function memoDir() {
  const dir = new Directory(Paths.document, MEMO_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function parseMemo(file: File, id: string): Memo | null {
  if (!file.exists) return null;

  try {
    const data = JSON.parse(file.textSync());
    return {
      id,
      title: typeof data.title === 'string' ? data.title : '',
      content: typeof data.content === 'string' ? data.content : '',
      dues: parseDues(data.dues),
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function parseDues(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry[1]),
    ),
  );
}

// 목록 화면이 저장·삭제를 바로 반영하도록 알린다. (뒤로 스와이프로 편집 화면을 닫으면
// 편집 화면의 마지막 저장이 목록의 focus 이후에 일어날 수 있다.)
const listeners = new Set<() => void>();

export function subscribeMemos(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

function writeMemoFile(memo: Memo) {
  const dir = memoDir();
  const temp = new File(dir, `${memo.id}.json${TEMP_SUFFIX}`);
  temp.write(JSON.stringify(memo));

  const target = new File(dir, `${memo.id}.json`);
  if (target.exists) target.delete();
  temp.move(target);
}

export function newMemoId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createMemo(): Memo {
  return { id: newMemoId(), title: '', content: '', dues: {}, updatedAt: Date.now() };
}

function migrateLegacyMemo() {
  const legacy = [LEGACY_FILE, LEGACY_TEMP_FILE].map((name) => new File(Paths.document, name));
  if (!legacy.some((file) => file.exists)) return;

  const memo = parseMemo(legacy[0], '') ?? parseMemo(legacy[1], '');
  if (memo && !isEmptyMemo(memo)) {
    writeMemoFile({ ...memo, id: newMemoId(), updatedAt: memo.updatedAt || Date.now() });
  }
  for (const file of legacy) if (file.exists) file.delete();
}

// 최근 수정 순
export function listMemos(): Memo[] {
  try {
    migrateLegacyMemo();
  } catch (error) {
    console.warn('예전 메모를 옮기지 못했습니다.', error);
  }

  const memos: Memo[] = [];
  for (const entry of memoDir().list()) {
    if (!(entry instanceof File) || !entry.name.endsWith('.json')) continue;
    const memo = parseMemo(entry, entry.name.slice(0, -'.json'.length));
    if (memo) memos.push(memo);
  }
  return memos.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadMemo(id: string): Memo {
  return parseMemo(new File(memoDir(), `${id}.json`), id) ?? { ...createMemo(), id };
}

export function isEmptyMemo(memo: Pick<Memo, 'title' | 'content'>) {
  return memo.title.trim() === '' && memoPreview(memo.content) === '';
}

export function saveMemo(memo: Memo) {
  try {
    // 아무것도 적지 않은 메모는 목록에 남기지 않는다.
    if (isEmptyMemo(memo)) {
      deleteMemo(memo.id);
      return;
    }
    writeMemoFile(memo);
    notify();
  } catch (error) {
    console.warn('메모를 저장하지 못했습니다.', error);
  }
}

export function deleteMemo(id: string) {
  try {
    const file = new File(memoDir(), `${id}.json`);
    if (!file.exists) return;
    file.delete();
    notify();
  } catch (error) {
    console.warn('메모를 삭제하지 못했습니다.', error);
  }
}

// doodle은 문단에 두들이 붙은 낱말이 있는지
export type MemoBlock = { type: string; checked: boolean; text: string; doodle: boolean };

type DocumentBlock = { type?: unknown; checked?: unknown; runs?: { text?: unknown; doodle?: unknown }[] };

// 에디터 문서의 문단들. 서식은 빼고 글자와 문단 종류만 남긴다.
export function memoBlocks(content: string): MemoBlock[] {
  if (!content) return [];
  try {
    const blocks: DocumentBlock[] = JSON.parse(content).blocks ?? [];
    return blocks.map((block) => ({
      type: typeof block.type === 'string' ? block.type : 'paragraph',
      checked: block.checked === true,
      text: (block.runs ?? []).map((run) => (typeof run.text === 'string' ? run.text : '')).join(''),
      doodle: (block.runs ?? []).some((run) => typeof run.doodle === 'string'),
    }));
  } catch {
    return [];
  }
}

/**
 * index번째 문단 위아래의 줄들. Jev에 맥락으로 함께 보낸다. (체크박스 표시는 붙이지 않는다 — 붙이면 오히려 판단이 흐려졌다)
 * 문서의 그 문단이 text와 다르면(순서가 어긋났으면) 엉뚱한 맥락 대신 빈 배열을 돌려준다.
 */
export function nearbyLines(blocks: MemoBlock[], index: number, text: string, before: number, after: number): string[] {
  if (index >= blocks.length || blocks[index].text.trim() !== text.trim()) return [];
  return [...blocks.slice(Math.max(0, index - before), index), ...blocks.slice(index + 1, index + 1 + after)]
    .map((block) => block.text.trim())
    .filter(Boolean);
}

// 에디터 문서에서 서식을 뺀 본문 텍스트 (문단은 줄바꿈으로 잇는다)
export function memoPreview(content: string): string {
  return memoBlocks(content)
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export type UpcomingTodo = { memo: Memo; text: string; due: string };

// 아직 끝내지 않은 할 일 가운데 마감일이 있는 것, 마감이 가까운 순
export function upcomingTodos(memos: Memo[]): UpcomingTodo[] {
  const todos: UpcomingTodo[] = [];
  for (const memo of memos) {
    for (const block of memoBlocks(memo.content)) {
      const text = block.text.trim();
      const due = memo.dues[text];
      if (due && block.type === 'checkbox' && !block.checked) todos.push({ memo, text, due });
    }
  }
  return todos.sort((a, b) => a.due.localeCompare(b.due));
}
