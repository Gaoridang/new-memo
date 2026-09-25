import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useState } from 'react';

import { MemoScreen } from '../../MemoScreen';
import { loadMemo } from '../../memoStorage';

export default function MemoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  // 에디터는 처음 내용만 읽으므로 화면이 떠 있는 동안 다시 읽지 않는다.
  const [memo] = useState(() => loadMemo(id));

  // 앱을 켤 때 애니메이션 없이 열었어도 목록으로 돌아갈 때는 평소처럼 밀려 나간다.
  useEffect(() => {
    navigation.setOptions({ animation: 'default' });
  }, [navigation]);

  return <MemoScreen memo={memo} onOpenList={() => router.back()} />;
}
