import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { getLinkData, subscribeLinks } from './memoLinks';
import { suggestRelatedMemos } from './relatedMemos';
import { loadSettings, saveSettings } from './settings';

/**
 * 목록 화면의 연관 메모: 메모 연결·제안 상태와 제안 켜고 끄기.
 * 메모 내용을 외부로 보내므로 처음 켤 때 한 번 동의를 받는다.
 */
export function useRelatedMemos(latestMemoId: string | undefined) {
  const [enabled, setEnabled] = useState(() => loadSettings().relatedMemos);
  const [linkData, setLinkData] = useState(getLinkData);

  useEffect(() => subscribeLinks(() => setLinkData(getLinkData())), []);

  const apply = useCallback(
    (next: boolean) => {
      setEnabled(next);
      saveSettings(next ? { relatedMemos: true, relatedMemosConsented: true } : { relatedMemos: false });
      // 켜자마자 가장 최근 메모부터 살펴본다.
      if (next && latestMemoId) suggestRelatedMemos(latestMemoId);
    },
    [latestMemoId],
  );

  const toggle = useCallback(() => {
    if (enabled) {
      apply(false);
      return;
    }
    if (loadSettings().relatedMemosConsented) {
      apply(true);
      return;
    }
    Alert.alert(
      '연관 메모 제안',
      '메모를 닫으면 그 메모와 다른 메모 최대 16개의 제목·본문 일부를 TypeSafe AI(Jev)로 보내, 같은 대상을 이어서 다루는 메모를 찾아 연결을 제안해요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '켜기', onPress: () => apply(true) },
      ],
    );
  }, [apply, enabled]);

  return { enabled, toggle, linkData };
}
