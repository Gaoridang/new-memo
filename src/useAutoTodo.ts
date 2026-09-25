import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import type { MemoEditorHandle, MemoLeaveParagraphEvent } from '../modules/memo-editor';
import { detectTodo } from './detectTodo';
import { loadSettings, saveSettings } from './settings';
import type { ToastMessage } from './Toast';

// 타이핑이 이만큼 멈췄을 때만 문단을 바꾼다. 한글을 조합하는 중에 서식을 바꾸면 글자가 깨질 수 있다.
const IDLE_MS = 700;
const MIN_LENGTH = 2;
const TOAST_MS = 5000;
const INFO_TOAST_MS = 2000;

/**
 * 할 일 자동 감지: 다 쓴 줄이 할 일이면 체크박스로 바꾸고, 되돌리기를 알림으로 보여준다.
 * 되돌린 줄은 이 화면에서 다시 바꾸지 않는다.
 */
export function useAutoTodo(editorRef: RefObject<MemoEditorHandle | null>, getTitle: () => string) {
  const [enabled, setEnabled] = useState(() => loadSettings().autoTodo);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const enabledRef = useRef(enabled);
  const lastEditAt = useRef(0);
  const verdicts = useRef(new Map<string, boolean>());
  const undone = useRef(new Set<string>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const toastId = useRef(0);

  const later = useCallback((callback: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      callback();
    }, ms);
    timers.current.add(timer);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const showToast = useCallback(
    (message: string, options: Pick<ToastMessage, 'action' | 'muted'> = {}) => {
      const { action, muted } = options;
      const id = ++toastId.current;
      setToast({ id, message, action, muted });
      AccessibilityInfo.announceForAccessibility(action ? `${message}. ${action.label} 가능` : message);
      later(() => setToast((current) => (current?.id === id ? null : current)), action ? TOAST_MS : INFO_TOAST_MS);
    },
    [later],
  );

  const undo = useCallback(
    async (index: number, text: string) => {
      setToast(null);
      undone.current.add(text.trim());
      await editorRef.current?.setParagraphBlock(index, text, 'checkbox', 'paragraph');
    },
    [editorRef],
  );

  const convertWhenIdle = useCallback(
    (index: number, text: string) => {
      const attempt = () => {
        const wait = IDLE_MS - (Date.now() - lastEditAt.current);
        if (wait > 0) {
          later(attempt, wait);
          return;
        }
        const editor = editorRef.current;
        if (!editor || !enabledRef.current) return;
        editor.setParagraphBlock(index, text, 'paragraph', 'checkbox').then((converted) => {
          if (converted) {
          showToast('할 일로 바꿨어요', { action: { label: '되돌리기', onPress: () => undo(index, text) } });
        }
        });
      };
      attempt();
    },
    [editorRef, later, showToast, undo],
  );

  const onLeaveParagraph = useCallback(
    async ({ index, text }: MemoLeaveParagraphEvent) => {
      if (!enabledRef.current) return;
      const line = text.trim();
      if (line.length < MIN_LENGTH || undone.current.has(line)) return;

      const title = getTitle().trim();
      const key = `${title}\n${line}`;
      let isTodo = verdicts.current.get(key);
      if (isTodo === undefined) {
        const verdict = await detectTodo(title, line);
        if (verdict === null) return;
        verdicts.current.set(key, verdict);
        isTodo = verdict;
      }
      if (isTodo) convertWhenIdle(index, text);
    },
    [convertWhenIdle, getTitle],
  );

  const noteEdit = useCallback(() => {
    lastEditAt.current = Date.now();
  }, []);

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
      '줄을 다 쓰고 넘어가면 그 줄과 메모 제목을 TypeSafe AI(Jev)로 보내 할 일인지 판단하고, 할 일이면 체크박스로 바꿔요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '켜기', onPress: () => apply(true) },
      ],
    );
  }, [apply]);

  return { enabled, toggle, toast, onLeaveParagraph, noteEdit };
}
