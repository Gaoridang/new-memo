import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { MemoList } from '../MemoList';
import { deleteMemo, listMemos, newMemoId, subscribeMemos } from '../memoStorage';

// 앱을 켤 때 한 번만 가장 최근 메모(없으면 새 메모)를 연다.
let launched = false;

export default function MemoListRoute() {
  const [memos, setMemos] = useState(listMemos);

  useEffect(() => subscribeMemos(() => setMemos(listMemos())), []);

  useEffect(() => {
    if (launched) return;
    launched = true;
    router.push({
      pathname: '/memo/[id]',
      params: { id: memos[0]?.id ?? newMemoId(), launch: '1' },
    });
  }, [memos]);

  return (
    <MemoList
      memos={memos}
      onSelect={(memo) => router.push({ pathname: '/memo/[id]', params: { id: memo.id } })}
      onCreate={() => router.push({ pathname: '/memo/[id]', params: { id: newMemoId() } })}
      onDelete={(memo) => deleteMemo(memo.id)}
    />
  );
}
