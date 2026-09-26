import { useCallback, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import type { MemoBlockKind, MemoEditorHandle, MemoLeaveParagraphEvent } from '../modules/memo-editor';
import { dueShort } from './dueLabel';
import { classifyPaste, detectTodo, type PasteKind, type TodoVerdict } from './jevApi';
import { memoBlocks, nearbyLines, type MemoBlock } from './memoStorage';
import { loadSettings, saveSettings } from './settings';
import type { ShowToast } from './Toast';
import type { EditorIdle } from './useEditorIdle';

const MIN_LENGTH = 2;
// 판단에 함께 보내는 주변 줄 (위로 몇 줄, 아래로 몇 줄)
const NEARBY_BEFORE = 3;
const NEARBY_AFTER = 2;
// 한 번에 이만큼 넘게 줄이 늘면 붙여넣기로 본다. (타이핑은 줄 바꿈마다 한 줄씩 는다)
const PASTE_MIN_LINES = 3;
const PASTE_MAX_LINES = 60;
const PASTE_MAX_LINE_LENGTH = 300;
// 붙여넣어 할 일이 된 줄 가운데 마감일을 찾아보는 줄 수
const PASTE_MAX_DUE_LOOKUPS = 10;
// '- 우유', '1. 볶는다'처럼 이미 표시를 적은 줄은 바꾸면 표시가 두 번 생기므로 그대로 둔다.
const TYPED_MARKER = /^\s*([-*•·]|\d+[.)]|\[[ xX]?\])\s/;

const PASTE_BLOCKS: Partial<Record<Exclude<PasteKind, null>, MemoBlockKind>> = {
  bullet: 'bullet',
  number: 'number',
  todo: 'checkbox',
};

/**
 * Jev로 메모 쓰기를 돕는다. 켜 두면
 * - 다 쓴 줄이 할 일이면 체크박스로 바꾸고, 줄에 적힌 마감일을 기억한다. 애매한 줄은 그대로 둔다.
 * - 여러 줄을 붙여넣으면 목록·단계·할 일을 알아보고 모양을 정리한다.
 * 바꿀 때 알림은 띄우지 않는다. 편집기의 되돌리기로 되돌린 줄은 이 화면에서 다시 바꾸지 않는다.
 */
export function useAutoTodo(
  getTitle: () => string,
  getContent: () => string,
  onDue: (line: string, due: string | null) => void,
  idle: EditorIdle,
  showToast: ShowToast,
) {
  const [enabled, setEnabled] = useState(() => loadSettings().autoTodo);
  const enabledRef = useRef(enabled);
  const verdicts = useRef(new Map<string, TodoVerdict>());
  const undone = useRef(new Set<string>());

  const { whenIdle: whenEditorIdle } = idle;
  /** 타이핑이 멈추면 한 번 실행한다. 그 사이 기능을 껐으면 실행하지 않는다. */
  const whenIdle = useCallback(
    (callback: (editor: MemoEditorHandle) => void) =>
      whenEditorIdle((editor) => {
        if (enabledRef.current) callback(editor);
      }),
    [whenEditorIdle],
  );

  const convertTodo = useCallback(
    async (editor: MemoEditorHandle, index: number, text: string, due: string | null) => {
      const [converted] = await editor.setParagraphBlocks([{ index, text, from: 'paragraph', to: 'checkbox' }]);
      if (!converted) return;
      if (due) onDue(text.trim(), due);
      // 화면에는 알림을 띄우지 않으니 화면 읽기 사용자에게만 알린다.
      AccessibilityInfo.announceForAccessibility(due ? `할 일로 바꿨어요. ${dueShort(due)} 마감` : '할 일로 바꿨어요');
    },
    [onDue],
  );

  const onLeaveParagraph = useCallback(
    async ({ index, text, block }: MemoLeaveParagraphEvent) => {
      // 목록 줄은 이미 모양이 정해져 있으니 묻지 않는다.
      if (!enabledRef.current || block !== 'paragraph') return;
      const line = text.trim();
      if (line.length < MIN_LENGTH || undone.current.has(line)) return;

      const title = getTitle().trim();
      const nearby = nearbyLines(memoBlocks(getContent()), index, text, NEARBY_BEFORE, NEARBY_AFTER);
      const key = JSON.stringify([title, line, nearby]);
      let verdict = verdicts.current.get(key);
      if (verdict === undefined) {
        const answer = await detectTodo(title, line, nearby);
        if (answer === null) return;
        verdicts.current.set(key, answer);
        verdict = answer;
      }
      // 애매한 줄(maybe)은 물어볼 곳이 없으니 바꾸지 않는다.
      const { isTodo, due } = verdict;
      if (isTodo) whenIdle((editor) => convertTodo(editor, index, text, due));
    },
    [convertTodo, getContent, getTitle, whenIdle],
  );

  const formatPaste = useCallback(
    async (start: number, pasted: MemoBlock[]) => {
      const lines = pasted.map((block) => block.text.trim().slice(0, PASTE_MAX_LINE_LENGTH));
      const kinds = await classifyPaste(getTitle().trim(), lines);
      if (!kinds) return;

      whenIdle(async (editor) => {
        const changes = pasted.flatMap((block, i) => {
          const kind = kinds[i] && PASTE_BLOCKS[kinds[i]];
          if (!kind || !block.text.trim() || TYPED_MARKER.test(block.text)) return [];
          return [{ index: start + i, text: block.text, from: 'paragraph' as const, to: kind }];
        });
        if (changes.length === 0) return;
        // 한 번에 바꿔야 되돌리기 한 번으로 모두 돌아간다. 그 사이 사용자가 고친 줄은 에디터가 건너뛴다.
        const applied = await editor.setParagraphBlocks(changes);
        const converted = changes.filter((_, i) => applied[i]);
        if (converted.length === 0) return;
        AccessibilityInfo.announceForAccessibility('붙여넣은 글을 정리했어요');

        // 할 일이 된 줄은 마감일도 찾아 둔다. ('금요일까지 세탁소 들르기')
        const title = getTitle().trim();
        const todos = converted.filter((change) => change.to === 'checkbox').slice(0, PASTE_MAX_DUE_LOOKUPS);
        await Promise.all(
          todos.map(async ({ text }) => {
            const verdict = await detectTodo(title, text.trim(), []);
            if (verdict?.due && !undone.current.has(text.trim())) onDue(text.trim(), verdict.due);
          }),
        );
      });
    },
    [getTitle, onDue, whenIdle],
  );

  /**
   * 본문이 바뀔 때마다 부른다. 여러 줄이 한꺼번에 들어왔으면 붙여넣기로 보고 정리한다.
   * 되돌리기·다시 하기로 바뀐 것은 붙여넣기로 보지 않고, 할 일에서 풀려난 줄만 기억한다.
   */
  const onChangeContent = useCallback(
    (previous: string, next: string, fromHistory: boolean) => {
      if (fromHistory) {
        for (const line of revertedTodos(memoBlocks(previous), memoBlocks(next))) undone.current.add(line);
        return;
      }
      if (!enabledRef.current) return;
      const pasted = pastedBlocks(memoBlocks(previous), memoBlocks(next));
      if (pasted) formatPaste(pasted.start, pasted.blocks);
    },
    [formatPaste],
  );

  const apply = useCallback(
    (next: boolean) => {
      enabledRef.current = next;
      setEnabled(next);
      saveSettings(next ? { autoTodo: true, autoTodoConsented: true } : { autoTodo: false });
      showToast(next ? '할 일 자동 감지를 켰어요' : '할 일 자동 감지를 껐어요', { muted: !next });
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

  return { enabled, toggle, onLeaveParagraph, onChangeContent };
}

/** 체크박스였다가 일반 문단으로 돌아간 줄들 */
function revertedTodos(previous: MemoBlock[], next: MemoBlock[]): string[] {
  const todos = new Set(previous.filter((block) => block.type === 'checkbox').map((block) => block.text.trim()));
  return next
    .filter((block) => block.type === 'paragraph' && todos.has(block.text.trim()))
    .map((block) => block.text.trim());
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
