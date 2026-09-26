import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { useMemoDrawer } from '../../MemoDrawer';
import { MemoScreen } from '../../MemoScreen';
import { loadMemo } from '../../memoStorage';

export default function MemoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // 목록에서 다른 메모를 고르면 id만 바뀌므로 화면을 새로 만든다. (에디터는 처음 내용만 읽는다)
  return <MemoRouteScreen key={id} id={id} />;
}

function MemoRouteScreen({ id }: { id: string }) {
  // 에디터는 처음 내용만 읽으므로 화면이 떠 있는 동안 다시 읽지 않는다.
  const [memo] = useState(() => loadMemo(id));
  const { listOpen, openList, newMemo } = useMemoDrawer();
  return <MemoScreen memo={memo} listOpen={listOpen} onOpenList={openList} onNewMemo={newMemo} />;
}
