import { router, useGlobalSearchParams } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import type { PanGesture } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';

import { swipeHaptic } from './haptics';
import { MemoList } from './MemoList';
import { deleteMemo, listMemos, newMemoId, subscribeMemos } from './memoStorage';
import { colors } from './theme';

// 목록을 열어도 메모가 오른쪽에 이만큼 남아 보인다. 누르면 메모로 돌아간다.
const MEMO_PEEK = 76;
// 옆으로 이만큼 움직여야 밀기로 본다. 세로로 이만큼 먼저 움직이면 본문을 넘기는 것으로 본다.
const SWIPE_ACTIVATE = 15;
const SWIPE_FAIL_VERTICAL = 10;
// activeOffsetX에서 한쪽 방향을 막을 때 쓰는 먼 거리
const FAR = 100_000;

type MemoDrawerState = {
  listOpen: boolean;
  openList: () => void;
  newMemo: () => void;
};

const MemoDrawerContext = createContext<MemoDrawerState>({
  listOpen: false,
  openList: () => {},
  newMemo: () => {},
});

export const useMemoDrawer = () => useContext(MemoDrawerContext);

/**
 * 메모 목록을 메모 아래에 깔아 둔다. 메모를 오른쪽으로 밀면 목록이 드러나고 메모는 오른쪽에 조금 남는다.
 * 목록을 왼쪽으로 밀거나 남은 메모를 누르면 메모로 돌아간다.
 */
export function MemoDrawer({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const { id: currentId } = useGlobalSearchParams<{ id?: string }>();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const swiping = useRef(false);

  // Drawer는 onOpen·onClose가 바뀌면 열림 애니메이션을 다시 시작하므로 늘 같은 함수를 넘긴다.
  const change = useCallback((next: boolean) => {
    if (openRef.current === next) return;
    openRef.current = next;
    // 손으로 밀어 열고 닫을 때만, 손을 떼 정해지는 순간 톡 울린다.
    if (swiping.current) swipeHaptic();
    setOpen(next);
  }, []);
  const onOpen = useCallback(() => change(true), [change]);
  const onClose = useCallback(() => change(false), [change]);
  const onGestureStart = useCallback(() => {
    swiping.current = true;
    // 네이티브 본문 편집기는 Keyboard.dismiss()로 내려가지 않는다.
    KeyboardController.dismiss();
  }, []);
  const onGestureEnd = useCallback(() => {
    swiping.current = false;
  }, []);

  // 닫혀 있으면 오른쪽으로, 열려 있으면 왼쪽으로 확실히 밀 때만 움직인다.
  const configureGesture = useCallback(
    (gesture: PanGesture) =>
      gesture
        .activeOffsetX(open ? [-SWIPE_ACTIVATE, FAR] : [-FAR, SWIPE_ACTIVATE])
        .failOffsetY([-SWIPE_FAIL_VERTICAL, SWIPE_FAIL_VERTICAL]),
    [open],
  );

  // Android 뒤로 가기는 목록부터 닫는다.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      change(false);
      return true;
    });
    return () => subscription.remove();
  }, [change, open]);

  const openMemo = useCallback(
    (id: string, keepListOpen = false) => {
      if (id !== currentId) router.replace({ pathname: '/memo/[id]', params: { id } });
      if (!keepListOpen) change(false);
    },
    [change, currentId],
  );
  const newMemo = useCallback(() => openMemo(newMemoId()), [openMemo]);

  const state = useMemo(
    () => ({ listOpen: open, openList: () => change(true), newMemo }),
    [change, newMemo, open],
  );

  return (
    <MemoDrawerContext.Provider value={state}>
      <Drawer
        open={open}
        onOpen={onOpen}
        onClose={onClose}
        onGestureStart={onGestureStart}
        onGestureEnd={onGestureEnd}
        onGestureCancel={onGestureEnd}
        drawerType="back"
        drawerStyle={[styles.list, { width: width - MEMO_PEEK }]}
        overlayStyle={styles.overlay}
        swipeEdgeWidth={width}
        configureGestureHandler={configureGesture}
        renderDrawerContent={() => (
          <MemoListPanel currentId={currentId} onOpenMemo={openMemo} onNewMemo={newMemo} />
        )}
      >
        <View style={styles.memo}>{children}</View>
      </Drawer>
    </MemoDrawerContext.Provider>
  );
}

type MemoListPanelProps = {
  currentId?: string;
  onOpenMemo: (id: string, keepListOpen?: boolean) => void;
  onNewMemo: () => void;
};

function MemoListPanel({ currentId, onOpenMemo, onNewMemo }: MemoListPanelProps) {
  const [memos, setMemos] = useState(listMemos);

  useEffect(() => subscribeMemos(() => setMemos(listMemos())), []);

  return (
    <MemoList
      memos={memos}
      currentId={currentId}
      onSelect={(memo) => onOpenMemo(memo.id)}
      onCreate={onNewMemo}
      onDelete={(memo) => {
        deleteMemo(memo.id);
        // 보고 있던 메모를 지우면 남은 메모 가운데 가장 최근 것(없으면 새 메모)을 뒤에 펼쳐 둔다.
        if (memo.id === currentId) onOpenMemo(listMemos()[0]?.id ?? newMemoId(), true);
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    backgroundColor: colors.paper,
  },
  overlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
  memo: {
    flex: 1,
    backgroundColor: colors.paper,
    // 목록 위로 밀려난 메모의 왼쪽 가장자리
    boxShadow: '-6px 0px 20px rgba(0, 0, 0, 0.10)',
  },
});
