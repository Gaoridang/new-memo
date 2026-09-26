import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import type {
  MemoBlockKind,
  MemoEditorHandle,
  MemoLeaveParagraphEvent,
  MemoParagraphBlockChange,
} from '../modules/memo-editor';
import { dueShort } from './dueLabel';
import { classifyPaste, detectDue, detectTodo, type PasteKind, type TodoVerdict } from './jevApi';
import { memoBlocks, updateSavedMemo, type MemoBlock } from './memoStorage';
import { loadSettings, saveSettings } from './settings';
import type { ToastMessage } from './Toast';

// 타이핑이 이만큼 멈췄을 때만 문단을 바꾼다. 한글을 조합하는 중에 서식을 바꾸면 글자가 깨질 수 있다.
const IDLE_MS = 700;
const MIN_LENGTH = 2;
// 판단에 함께 보내는 주변 줄 (위로 몇 줄, 아래로 몇 줄)
const NEARBY_BEFORE = 3;
const NEARBY_AFTER = 2;
const TOAST_MS = 2000;
// 한 번에 이만큼 넘게 줄이 늘면 붙여넣기로 본다. (타이핑은 줄 바꿈마다 한 줄씩 는다)
const PASTE_MIN_LINES = 3;
const PASTE_MAX_LINES = 60;
const PASTE_MAX_LINE_LENGTH = 300;
// 여러 줄이 한꺼번에 할 일이 됐을 때(붙여넣기 정리 등) 마감일을 찾아보는 줄 수
const MAX_DUE_LOOKUPS = 10;
// '- 우유', '1. 볶는다'처럼 이미 표시를 적은 줄은 바꾸면 표시가 두 번 생기므로 그대로 둔다.
const TYPED_MARKER = /^\s*([-*•·]|\d+[.)]|\[[ xX]?\])\s/;

const PASTE_BLOCKS: Partial<Record<Exclude<PasteKind, null>, MemoBlockKind>> = {
  bullet: 'bullet',
  number: 'number',
  todo: 'checkbox',
};

/** 입력이 멈추면 편집기에서 할 일(apply). 그 전에 화면이 닫히면 저장된 메모에서 대신 한다(save). */
type IdleJob = { apply: (editor: MemoEditorHandle) => void; save: () => void };

/**
 * Jev로 메모 쓰기를 돕는다. 켜 두면
 * - 다 쓴 줄이 할 일이면 체크박스로 바꾼다. 애매한 줄은 그대로 둔다.
 * - 여러 줄을 붙여넣으면 목록·단계·할 일을 알아보고 모양을 정리한다.
 * - 체크박스가 된 줄은 어떻게 됐든(직접 바꾸기, 자동으로 바꾸기, 고쳐 쓰기) 줄에 적힌 마감일을 찾아 기억한다.
 * 바꿀 때 알림은 띄우지 않는다. 편집기의 되돌리기로 되돌린 줄은 이 화면에서 다시 바꾸지 않는다.
 * 답이 오기 전에 화면이 닫히면 저장된 메모에 반영한다.
 */
export function useAutoTodo(
  editorRef: RefObject<MemoEditorHandle | null>,
  memoId: string,
  getTitle: () => string,
  getContent: () => string,
  getDues: () => Record<string, string>,
  onDue: (line: string, due: string | null) => void,
) {
  const [enabled, setEnabled] = useState(() => loadSettings().autoTodo);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const enabledRef = useRef(enabled);
  const lastEditAt = useRef(0);
  const verdicts = useRef(new Map<string, TodoVerdict>());
  const undone = useRef(new Set<string>());
  // 줄 글자 → 알아낸 마감일(날짜가 없으면 null). 이미 아는 줄은 다시 묻지 않는다.
  const knownDues = useRef(new Map<string, string | null>());
  const dueLookups = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const toastId = useRef(0);
  const mounted = useRef(true);
  const waiting = useRef(new Set<IdleJob>());

  const later = useCallback((callback: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, ms);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    const jobs = waiting.current;
    return () => {
      mounted.current = false;
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
      // 입력이 멈추기를 기다리던 변환은 저장된 메모에 반영한다. 화면의 마지막 자동 저장보다 늦게 쓰도록 한 박자 미룬다.
      const unfinished = [...jobs];
      jobs.clear();
      if (unfinished.length > 0 && enabledRef.current) {
        setTimeout(() => {
          for (const job of unfinished) job.save();
        }, 0);
      }
    };
  }, []);

  const showToast = useCallback(
    (message: string, muted = false) => {
      const id = ++toastId.current;
      setToast({ id, message, muted });
      AccessibilityInfo.announceForAccessibility(message);
      later(() => setToast((current) => (current?.id === id ? null : current)), TOAST_MS);
    },
    [later],
  );

  /**
   * 타이핑이 멈추면 편집기에서 한 번 실행한다. 그 전에 화면이 닫히면 저장된 메모에서 한다.
   * 그 사이 기능을 껐으면 하지 않는다.
   */
  const whenIdle = useCallback(
    (job: IdleJob) => {
      if (!mounted.current) {
        if (enabledRef.current) job.save();
        return;
      }
      waiting.current.add(job);
      const attempt = () => {
        const wait = IDLE_MS - (Date.now() - lastEditAt.current);
        if (wait > 0) {
          later(attempt, wait);
          return;
        }
        waiting.current.delete(job);
        const editor = editorRef.current;
        if (editor && enabledRef.current) job.apply(editor);
      };
      attempt();
    },
    [editorRef, later],
  );

  /** 알아낸 마감일을 기억한다. 화면이 닫혔으면 저장된 메모에 적는다. */
  const saveDue = useCallback(
    (line: string, due: string) => {
      if (!mounted.current) updateSavedMemo(memoId, [], { [line]: due });
      else if (getDues()[line] !== due) onDue(line, due);
    },
    [getDues, memoId, onDue],
  );

  /** 할 일 줄의 마감일을 찾아 기억한다. 이미 알거나 묻는 중인 줄은 다시 묻지 않고, 답을 받지 못했으면 다음에 다시 묻는다. */
  const lookUpDue = useCallback(
    async (text: string) => {
      const line = text.trim();
      if (line.length < MIN_LENGTH || !enabledRef.current || getDues()[line] || dueLookups.current.has(line)) return;
      if (knownDues.current.has(line)) {
        const due = knownDues.current.get(line);
        if (due) saveDue(line, due);
        return;
      }
      dueLookups.current.add(line);
      const answer = await detectDue(line);
      dueLookups.current.delete(line);
      if (!answer) return;
      knownDues.current.set(line, answer.due);
      if (answer.due && enabledRef.current) saveDue(line, answer.due);
    },
    [getDues, saveDue],
  );

  const onLeaveParagraph = useCallback(
    async ({ index, text, block }: MemoLeaveParagraphEvent) => {
      if (!enabledRef.current) return;
      const line = text.trim();
      if (line.length < MIN_LENGTH) return;
      // 체크박스는 이미 할 일이니 마감일만 찾는다. (직접 만든 체크박스, 할 일이 된 뒤 고쳐 쓴 줄)
      if (block === 'checkbox') {
        lookUpDue(line);
        return;
      }
      if (undone.current.has(line)) return;

      const title = getTitle().trim();
      const nearby = nearbyLines(memoBlocks(getContent()), index, text);
      const key = JSON.stringify([title, line, nearby]);
      let verdict = verdicts.current.get(key);
      if (verdict === undefined) {
        const answer = await detectTodo(title, line, nearby);
        if (answer === null) return;
        verdicts.current.set(key, answer);
        verdict = answer;
      }
      const { isTodo, maybe, due } = verdict;
      // 애매한 줄(maybe)은 물어볼 곳이 없으니 바꾸지 않는다. 사용자가 직접 체크박스로 바꾸면 쓰도록 날짜는 기억해 둔다.
      if (isTodo || maybe) knownDues.current.set(line, due);
      if (!isTodo) return;
      const change = { index, text, from: 'paragraph', to: 'checkbox' } as const;
      whenIdle({
        apply: (editor) => convertTodo(editor, change, due),
        save: () => updateSavedMemo(memoId, [change], due ? { [line]: due } : {}),
      });
    },
    [getContent, getTitle, lookUpDue, memoId, whenIdle],
  );

  const formatPaste = useCallback(
    async (start: number, pasted: MemoBlock[]) => {
      const lines = pasted.map((block) => block.text.trim().slice(0, PASTE_MAX_LINE_LENGTH));
      const kinds = await classifyPaste(getTitle().trim(), lines);
      if (!kinds) return;

      const changes = pasted.flatMap((block, i) => {
        const kind = kinds[i] && PASTE_BLOCKS[kinds[i]];
        if (!kind || !block.text.trim() || TYPED_MARKER.test(block.text)) return [];
        return [{ index: start + i, text: block.text, from: 'paragraph' as const, to: kind }];
      });
      if (changes.length === 0) return;
      whenIdle({
        // 한 번에 바꿔야 되돌리기 한 번으로 모두 돌아간다. 그 사이 사용자가 고친 줄은 에디터가 건너뛴다.
        // 할 일이 된 줄의 마감일('금요일까지 세탁소 들르기')은 onChangeContent가 찾는다.
        apply: async (editor) => {
          const applied = await editor.setParagraphBlocks(changes);
          if (applied.includes(true)) AccessibilityInfo.announceForAccessibility('붙여넣은 글을 정리했어요');
        },
        save: () => {
          updateSavedMemo(memoId, changes, {});
          const todos = changes.filter((change) => change.to === 'checkbox').slice(0, MAX_DUE_LOOKUPS);
          for (const { text } of todos) lookUpDue(text);
        },
      });
    },
    [getTitle, lookUpDue, memoId, whenIdle],
  );

  /**
   * 본문이 바뀔 때마다 부른다. 체크박스가 된 줄은 마감일을 찾고, 여러 줄이 한꺼번에 들어왔으면 붙여넣기로 보고 정리한다.
   * 되돌리기·다시 하기로 바뀐 것은 붙여넣기로 보지 않고, 할 일에서 풀려난 줄만 기억한다.
   */
  const onChangeContent = useCallback(
    (previous: string, next: string, fromHistory: boolean) => {
      lastEditAt.current = Date.now();
      const before = memoBlocks(previous);
      const after = memoBlocks(next);
      if (fromHistory) {
        for (const line of revertedTodos(before, after)) undone.current.add(line);
        return;
      }
      if (!enabledRef.current) return;
      for (const line of newTodos(before, after).slice(0, MAX_DUE_LOOKUPS)) lookUpDue(line);
      const pasted = pastedBlocks(before, after);
      if (pasted) formatPaste(pasted.start, pasted.blocks);
    },
    [formatPaste, lookUpDue],
  );

  const apply = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabled(next);
      saveSettings(next ? { autoTodo: true, autoTodoConsented: true } : { autoTodo: false });
      showToast(next ? '할 일 자동 감지를 켰어요' : '할 일 자동 감지를 껐어요', !next);
    },
    [showToast],
  );

  const toggle = useCallback(() => {
    if (enabledRef.current) {
      apply(false);
      return;
    }
    if (loadSettings().autoTodoConsented) {
      apply(true);
      return;
    }
    Alert.alert(
      '할 일 자동 감지',
      '줄을 다 쓰고 넘어가거나 글을 붙여넣으면, 그 내용과 메모 제목, 위아래 몇 줄을 TypeSafe AI(Jev)로 보내 할 일과 마감일을 찾고 목록 모양을 정리해요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '켜기', onPress: () => apply(true) },
      ],
    );
  }, [apply]);

  return { enabled, toggle, toast, onLeaveParagraph, onChangeContent };
}

/** 할 일로 바꾼다. 마감일은 체크박스가 된 줄을 알아보는 onChangeContent가 찾는다. (판정에서 받은 날짜는 knownDues에 있다) */
async function convertTodo(editor: MemoEditorHandle, change: MemoParagraphBlockChange, due: string | null) {
  const [converted] = await editor.setParagraphBlocks([change]);
  if (!converted) return;
  // 화면에는 알림을 띄우지 않으니 화면 읽기 사용자에게만 알린다.
  AccessibilityInfo.announceForAccessibility(due ? `할 일로 바꿨어요. ${dueShort(due)} 마감` : '할 일로 바꿨어요');
}

/**
 * index번째 문단 주변의 줄들. (체크박스 표시는 붙이지 않는다 — 붙이면 오히려 판단이 흐려졌다)
 * 문서의 그 문단이 text와 다르면(순서가 어긋났으면) 엉뚱한 맥락 대신 빈 배열을 돌려준다.
 */
function nearbyLines(blocks: MemoBlock[], index: number, text: string): string[] {
  if (index >= blocks.length || blocks[index].text.trim() !== text.trim()) return [];
  return [
    ...blocks.slice(Math.max(0, index - NEARBY_BEFORE), index),
    ...blocks.slice(index + 1, index + 1 + NEARBY_AFTER),
  ]
    .map((block) => block.text.trim())
    .filter(Boolean);
}

/** 체크박스였다가 일반 문단으로 돌아간 줄들 */
function revertedTodos(previous: MemoBlock[], next: MemoBlock[]): string[] {
  const todos = new Set(previous.filter((block) => block.type === 'checkbox').map((block) => block.text.trim()));
  return next
    .filter((block) => block.type === 'paragraph' && todos.has(block.text.trim()))
    .map((block) => block.text.trim());
}

/** 글자는 그대로 두고 체크박스로 바꾼 줄들 (체크하지 않은 것만). 체크박스 안에서 고쳐 쓴 줄은 떠날 때 따로 알린다. */
function newTodos(previous: MemoBlock[], next: MemoBlock[]): string[] {
  const todos = new Set(previous.filter((block) => block.type === 'checkbox').map((block) => block.text.trim()));
  const others = new Set(previous.filter((block) => block.type !== 'checkbox').map((block) => block.text.trim()));
  return next
    .filter((block) => block.type === 'checkbox' && !block.checked)
    .map((block) => block.text.trim())
    .filter((line) => line && !todos.has(line) && others.has(line));
}

const sameBlock = (a: MemoBlock, b: MemoBlock) => a.type === b.type && a.text === b.text;

/** 앞뒤로 같은 문단을 걷어내고 새로 들어온 문단들을 찾는다. 붙여넣기처럼 보이지 않으면 null. */
function pastedBlocks(previous: MemoBlock[], next: MemoBlock[]) {
  let start = 0;
  while (start < previous.length && start < next.length && sameBlock(previous[start], next[start])) start++;
  let end = 0;
  while (
    end < previous.length - start &&
    end < next.length - start &&
    sameBlock(previous[previous.length - 1 - end], next[next.length - 1 - end])
  ) {
    end++;
  }
  const blocks = next.slice(start, next.length - end);
  const added = blocks.length - (previous.length - start - end);
  const lines = blocks.filter((block) => block.text.trim()).length;
  if (added < PASTE_MIN_LINES - 1 || lines < PASTE_MIN_LINES || blocks.length > PASTE_MAX_LINES) return null;
  // 이미 목록 모양인 줄이 섞였으면 건드리지 않는다.
  if (blocks.some((block) => block.type !== 'paragraph')) return null;
  return { start, blocks };
}
