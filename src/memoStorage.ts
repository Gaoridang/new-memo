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

// 편집 화면이 열어 둔 메모. 화면 밖에서 저장 파일을 고치면 그 화면의 자동 저장이 덮어쓰므로 건드리지 않는다.
const heldMemos = new Map<string, number>();

/** 편집 화면이 메모를 여는 동안 붙잡아 둔다. 돌려준 함수를 부르면 놓는다. */
export function holdMemo(id: string) {
  heldMemos.set(id, (heldMemos.get(id) ?? 0) + 1);
  return () => {
    const count = (heldMemos.get(id) ?? 1) - 1;
    if (count > 0) heldMemos.set(id, count);
    else heldMemos.delete(id);
  };
}

/** index번째 문단의 내용이 text이고 종류가 from이면 to로 바꾼다. (에디터의 setParagraphBlocks와 같다) */
export type SavedBlockChange = { index: number; text: string; from: string; to: string };

/**
 * 편집 화면이 닫힌 뒤에 끝난 자동 정리(할 일로 바꾸기, 마감일)를 저장된 메모에 반영한다.
 * 문단 번호·글자·종류가 모두 맞는 문단만 바꾸고, 마감일은 본문에 있는 줄만 기억한다. 수정 시각은 그대로 둔다.
 * 그 메모를 편집 화면이 다시 열어 두었으면 아무것도 하지 않는다.
 */
export function updateSavedMemo(id: string, changes: SavedBlockChange[], dues: Record<string, string>) {
  if (heldMemos.has(id)) return;
  try {
    const memo = parseMemo(new File(memoDir(), `${id}.json`), id);
    if (!memo?.content) return;
    const document = JSON.parse(memo.content);
    const blocks: DocumentBlock[] = document.blocks ?? [];
    let changed = false;
    for (const { index, text, from, to } of changes) {
      const block = blocks[index];
      if (!block || documentBlockText(block) !== text || documentBlockType(block) !== from) continue;
      block.type = to;
      if (to === 'checkbox') block.checked = false;
      else delete block.checked;
      changed = true;
    }
    const lines = new Set(blocks.map((block) => documentBlockText(block).trim()));
    const nextDues = { ...memo.dues };
    for (const [line, due] of Object.entries(dues)) {
      if (!lines.has(line) || nextDues[line] === due) continue;
      nextDues[line] = due;
      changed = true;
    }
    if (!changed) return;
    writeMemoFile({ ...memo, content: JSON.stringify(document), dues: nextDues });
    notify();
  } catch (error) {
    console.warn('메모를 고치지 못했습니다.', error);
  }
}

export type MemoBlock = { type: string; checked: boolean; text: string };

type DocumentBlock = { type?: unknown; checked?: unknown; runs?: { text?: unknown }[] };

const documentBlockType = (block: DocumentBlock) => (typeof block.type === 'string' ? block.type : 'paragraph');

const documentBlockText = (block: DocumentBlock) =>
  (block.runs ?? []).map((run) => (typeof run.text === 'string' ? run.text : '')).join('');

// 에디터 문서의 문단들. 서식은 빼고 글자와 문단 종류만 남긴다.
export function memoBlocks(content: string): MemoBlock[] {
  if (!content) return [];
  try {
    const blocks: DocumentBlock[] = JSON.parse(content).blocks ?? [];
    return blocks.map((block) => ({
      type: documentBlockType(block),
      checked: block.checked === true,
      text: documentBlockText(block),
    }));
  } catch {
    return [];
  }
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
