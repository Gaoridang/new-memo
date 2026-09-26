import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { MemoList } from '../MemoList';
import { deleteMemo, listMemos, newMemoId, subscribeMemos } from '../memoStorage';

// 앱을 켤 때 한 번만 가장 최근 메모(없으면 새 메모)를 연다.
let launched = false;

export default function MemoListRoute() {
  const [memos, setMemos] = useState(listMemos);
  // 목록을 왼쪽으로 밀면 다시 여는 메모. 앱을 켤 때 연 메모에서 시작해 목록에서 메모를 열 때마다 바뀐다.
  const [recentId, setRecentId] = useState(() => (launched ? null : (memos[0]?.id ?? newMemoId())));

  useEffect(() => subscribeMemos(() => setMemos(listMemos())), []);

  useEffect(() => {
    if (launched || !recentId) return;
    launched = true;
    router.push({ pathname: '/memo/[id]', params: { id: recentId, launch: '1' } });
  }, [recentId]);

  const open = (id: string) => {
    setRecentId(id);
    router.push({ pathname: '/memo/[id]', params: { id } });
  };

  return (
    <MemoList
      memos={memos}
      // 아무것도 적지 않아 저장되지 않았거나 지운 메모로는 돌아가지 않는다.
      returnTo={memos.find((memo) => memo.id === recentId)}
      onSelect={(memo) => open(memo.id)}
      onCreate={() => open(newMemoId())}
      onDelete={(memo) => deleteMemo(memo.id)}
    />
  );
}
