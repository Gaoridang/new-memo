import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { MemoScreen } from '../../MemoScreen';
import { deleteMemo, loadMemo } from '../../memoStorage';
import { suggestRelatedMemos } from '../../relatedMemos';

export default function MemoRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  // 에디터는 처음 내용만 읽으므로 화면이 떠 있는 동안 다시 읽지 않는다.
  const [memo] = useState(() => loadMemo(id));

  // 앱을 켤 때 애니메이션 없이 열었어도 목록으로 돌아갈 때는 평소처럼 밀려 나간다.
  useEffect(() => {
    navigation.setOptions({ animation: 'default' });
  }, [navigation]);

  // 목록으로 돌아가면 방금 고친 메모와 이어지는 메모를 찾아 제안한다.
  const suggestRelated = useCallback(() => {
    suggestRelatedMemos(memo.id);
  }, [memo.id]);

  return (
    <MemoScreen
      memo={memo}
      onClose={suggestRelated}
      onDelete={() => {
        deleteMemo(memo.id);
        router.back();
      }}
    />
  );
}
