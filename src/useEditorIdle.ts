import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { MemoEditorHandle } from '../modules/memo-editor';

// 타이핑이 이만큼 멈췄을 때만 편집기를 고친다. 한글을 조합하는 중에 서식을 바꾸면 글자가 깨질 수 있다.
const IDLE_MS = 700;

export type EditorIdle = ReturnType<typeof useEditorIdle>;

/** 편집기를 저절로 고치는 기능들(할 일 바꾸기, 두들)이 타이핑이 멈춘 뒤에만 고치도록 기다린다. */
export function useEditorIdle(editorRef: RefObject<MemoEditorHandle | null>) {
  const lastEditAt = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  /** 본문이 바뀔 때마다 부른다. */
  const markEdited = useCallback(() => {
    lastEditAt.current = Date.now();
  }, []);

  /** 타이핑이 멈추면 한 번 실행한다. 그 사이 기능을 껐는지는 부르는 쪽이 확인한다. */
  const whenIdle = useCallback(
    (callback: (editor: MemoEditorHandle) => void) => {
      const attempt = () => {
        const wait = IDLE_MS - (Date.now() - lastEditAt.current);
        if (wait > 0) {
          const timer = setTimeout(() => {
            timers.current.delete(timer);
            attempt();
          }, wait);
          timers.current.add(timer);
          return;
        }
        const editor = editorRef.current;
        if (editor) callback(editor);
      };
      attempt();
    },
    [editorRef],
  );

  return { markEdited, whenIdle };
}
