import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { saveMemo, type Memo } from './memoStorage';

const SAVE_DELAY_MS = 400;

export function useAutosave(initial: Memo) {
  const latest = useRef(initial);
  const saved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const memo = latest.current;
    if (memo.title === saved.current.title && memo.content === saved.current.content) return;

    saved.current = memo;
    saveMemo({ ...memo, updatedAt: Date.now() });
  }, []);

  const update = useCallback(
    (patch: Partial<Memo>) => {
      latest.current = { ...latest.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });

    return () => {
      subscription.remove();
      flush();
    };
  }, [flush]);

  return { update, flush };
}
