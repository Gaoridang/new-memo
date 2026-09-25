import { Directory, File, Paths } from 'expo-file-system';

export type Memo = {
  id: string;
  title: string;
  // 에디터 문서(JSON 문자열). 형식은 modules/memo-editor/ios/MemoDocument.swift 참고
  content: string;
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
      updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    };
  } catch {
    return null;
  }
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
  return { id: newMemoId(), title: '', content: '', updatedAt: Date.now() };
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

type DocumentBlock = { runs?: { text?: unknown }[] };

// 에디터 문서에서 서식을 뺀 본문 텍스트 (문단은 줄바꿈으로 잇는다)
export function memoPreview(content: string): string {
  if (!content) return '';
  try {
    const blocks: DocumentBlock[] = JSON.parse(content).blocks ?? [];
    return blocks
      .map((block) => (block.runs ?? []).map((run) => (typeof run.text === 'string' ? run.text : '')).join(''))
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}
