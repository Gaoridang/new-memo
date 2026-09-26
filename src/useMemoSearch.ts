import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { searchLines, type SearchLine } from './jevApi';
import { memoBlocks, type Memo } from './memoStorage';
import { loadSettings, saveSettings } from './settings';

// 한 번에 물어볼 수 있는 줄 수와 글자 수 (서버와 같다). 넘치면 최근 메모의 줄부터 보낸다.
const MAX_LINES = 255;
const MAX_LINE = 200;
const MAX_TITLE = 60;
const MAX_CHARS = 24_000;

export type SearchHit = { memo: Memo; text: string };
export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; hits: SearchHit[] }
  | { status: 'error'; query: string };

/** 메모에게 묻기: 질문에 답하는 줄을 Jev로 뜻을 보고 찾는다. */
export function useMemoSearch() {
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const requestId = useRef(0);

  const run = useCallback(async (query: string, memos: Memo[]) => {
    const id = ++requestId.current;
    setState({ status: 'loading', query });

    const sent: SearchLine[] = [];
    const owners: Memo[] = [];
    let chars = 0;
    collect: for (const memo of memos) {
      const title = memo.title.trim().slice(0, MAX_TITLE);
      const texts = [title, ...memoBlocks(memo.content).map((block) => block.text.trim().slice(0, MAX_LINE))];
      for (const text of texts.filter(Boolean)) {
        chars += title.length + text.length + 10;
        if (sent.length >= MAX_LINES || chars > MAX_CHARS) break collect;
        sent.push({ title, text });
        owners.push(memo);
      }
    }

    const results = sent.length ? await searchLines(query, sent) : [];
    if (id !== requestId.current) return;
    if (!results) {
      setState({ status: 'error', query });
      return;
    }
    setState({
      status: 'done',
      query,
      hits: results
        .filter((result) => result.index >= 0 && result.index < sent.length)
        .map((result) => ({ memo: owners[result.index], text: sent[result.index].text })),
    });
  }, []);

  const search = useCallback(
    (query: string, memos: Memo[]) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      if (loadSettings().searchConsented) {
        run(trimmed, memos);
        return;
      }
      Alert.alert('메모에게 묻기', '검색어와 메모 내용을 TypeSafe AI(Jev)로 보내 질문에 답하는 줄을 찾아요.', [
        { text: '취소', style: 'cancel' },
        {
          text: '찾기',
          onPress: () => {
            saveSettings({ searchConsented: true });
            run(trimmed, memos);
          },
        },
      ]);
    },
    [run],
  );

  const clear = useCallback(() => {
    requestId.current++;
    setState({ status: 'idle' });
  }, []);

  return { state, search, clear };
}
