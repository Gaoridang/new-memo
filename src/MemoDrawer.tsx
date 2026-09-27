import { router, useGlobalSearchParams } from 'expo-router';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { KeyboardController } from 'react-native-keyboard-controller';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

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
// 손을 뗄 때 이만큼(pt) 밀었거나, 조금이라도(pt) 밀며 이만큼 빠르면(pt/s) 마지막으로 민 방향으로 열고 닫는다.
const SWIPE_DISTANCE = 60;
const FLICK_DISTANCE = 5;
const FLICK_VELOCITY = 500;
// 버튼이나 메모를 눌러 열고 닫을 때: 누르자마자 움직이기 시작해 끝에서 부드럽게 멈춘다.
// 첫 프레임 시각이 시작 시각보다 앞서면 곡선이 0 아래로 뻗어 반대쪽으로 튀므로 0에서 자른다.
// 메모가 어디로 갔는지 보여 주는 움직임이라 동작 줄이기를 켜도 움직인다.
const { bezierFn } = Easing;
const SLIDE = {
  duration: 300,
  easing: {
    factory: () => {
      'worklet';
      const curve = bezierFn(0.32, 0.72, 0, 1);
      return (t: number) => {
        'worklet';
        return curve(Math.max(t, 0));
      };
    },
  },
  reduceMotion: ReduceMotion.Never,
};
// 밀다 놓을 때: 손가락 속도를 이어받아 튕기지 않고 멈춘다. (임계 감쇠라 0.2초면 거의 다 온다)
const SETTLE = { mass: 1, stiffness: 784, damping: 56, overshootClamping: true, reduceMotion: ReduceMotion.Never };

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
  const listWidth = width - MEMO_PEEK;
  const { id: currentId } = useGlobalSearchParams<{ id?: string }>();
  const [open, setOpen] = useState(false);
  // 목록이 드러난 만큼. 0이면 메모가 화면을 덮고 1이면 목록이 열려 있다. (화면 폭이 바뀌어도 그대로다)
  const progress = useSharedValue(0);
  const dragStart = useSharedValue(0);

  // 버튼, 메모 고르기, 뒤로 가기로 열고 닫는다. 화면을 바꾸거나 저장하기 전에 불러야 누르자마자 움직인다.
  const slide = useCallback(
    (next: boolean) => {
      setOpen(next);
      progress.set(withTiming(next ? 1 : 0, SLIDE));
    },
    [progress],
  );

  const onSwipeStart = useCallback(() => {
    // 네이티브 본문 편집기는 Keyboard.dismiss()로 내려가지 않는다.
    KeyboardController.dismiss();
  }, []);
  // 손을 떼 열림이 바뀌는 순간 톡 울린다.
  const onSwipeSettle = useCallback((next: boolean) => {
    setOpen(next);
    swipeHaptic();
  }, []);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        // 닫혀 있으면 오른쪽으로, 열려 있으면 왼쪽으로 확실히 밀 때만 움직인다.
        .activeOffsetX(open ? [-SWIPE_ACTIVATE, FAR] : [-FAR, SWIPE_ACTIVATE])
        .failOffsetY([-SWIPE_FAIL_VERTICAL, SWIPE_FAIL_VERTICAL])
        .onStart(() => {
          'worklet';
          // 움직이는 중에 잡으면 그 자리에서 이어 민다.
          dragStart.set(progress.get());
          scheduleOnRN(onSwipeStart);
        })
        .onUpdate((event) => {
          'worklet';
          progress.set(Math.min(Math.max(dragStart.get() + event.translationX / listWidth, 0), 1));
        })
        .onEnd((event) => {
          'worklet';
          const decided =
            Math.abs(event.translationX) > SWIPE_DISTANCE ||
            (Math.abs(event.translationX) > FLICK_DISTANCE && Math.abs(event.velocityX) > FLICK_VELOCITY);
          const direction = event.velocityX === 0 ? event.translationX : event.velocityX;
          const next = decided ? direction > 0 : open;
          progress.set(withSpring(next ? 1 : 0, { ...SETTLE, velocity: event.velocityX / listWidth }));
          if (next !== open) scheduleOnRN(onSwipeSettle, next);
        }),
    [dragStart, listWidth, onSwipeSettle, onSwipeStart, open, progress],
  );

  const memoStyle = useAnimatedStyle(() => ({ transform: [{ translateX: progress.get() * listWidth }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  // Android 뒤로 가기는 목록부터 닫는다.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      slide(false);
      return true;
    });
    return () => subscription.remove();
  }, [open, slide]);

  const openMemo = useCallback(
    (id: string, keepListOpen = false) => {
      // 새 메모 화면을 그리는 동안에도 메모가 바로 돌아오기 시작하도록 먼저 닫는다.
      if (!keepListOpen) slide(false);
      if (id !== currentId) router.replace({ pathname: '/memo/[id]', params: { id } });
    },
    [currentId, slide],
  );
  const newMemo = useCallback(() => openMemo(newMemoId()), [openMemo]);

  const state = useMemo(() => ({ listOpen: open, openList: () => slide(true), newMemo }), [newMemo, open, slide]);

  return (
    <MemoDrawerContext.Provider value={state}>
      <GestureDetector gesture={pan}>
        <Animated.View style={styles.root}>
          <View
            style={[styles.list, { width: listWidth }]}
            accessibilityElementsHidden={!open}
            importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          >
            <MemoListPanel currentId={currentId} onOpenMemo={openMemo} onNewMemo={newMemo} />
          </View>
          <Animated.View style={[styles.memo, memoStyle]}>
            <View
              style={styles.fill}
              accessibilityElementsHidden={open}
              importantForAccessibility={open ? 'no-hide-descendants' : 'auto'}
            >
              {children}
            </View>
            {/* 목록이 열려 있으면 남은 메모를 살짝 어둡게 덮고, 누르면 메모로 돌아간다. */}
            <Animated.View
              style={[styles.dim, { pointerEvents: open ? 'auto' : 'none' }, dimStyle]}
              accessibilityElementsHidden={!open}
              importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
            >
              <Pressable
                style={styles.fill}
                accessibilityRole="button"
                accessibilityLabel="메모로 돌아가기"
                onPress={() => slide(false)}
              />
            </Animated.View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </MemoDrawerContext.Provider>
  );
}

type MemoListPanelProps = {
  currentId?: string;
  onOpenMemo: (id: string, keepListOpen?: boolean) => void;
  onNewMemo: () => void;
};

// 목록을 열고 닫을 때마다 다시 그리지 않는다. (움직이기 시작할 때 JS가 한가해야 한다)
const MemoListPanel = memo(function MemoListPanel({ currentId, onOpenMemo, onNewMemo }: MemoListPanelProps) {
  const [memos, setMemos] = useState(listMemos);

  useEffect(() => subscribeMemos(() => setMemos(listMemos())), []);

  return (
    <MemoList
      memos={memos}
      currentId={currentId}
      onSelect={(picked) => onOpenMemo(picked.id)}
      onCreate={onNewMemo}
      onDelete={(deleted) => {
        deleteMemo(deleted.id);
        // 보고 있던 메모를 지우면 남은 메모 가운데 가장 최근 것(없으면 새 메모)을 뒤에 펼쳐 둔다.
        if (deleted.id === currentId) onOpenMemo(listMemos()[0]?.id ?? newMemoId(), true);
      }}
    />
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
  list: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.paper,
  },
  memo: {
    flex: 1,
    backgroundColor: colors.paper,
    // 목록 위로 밀려난 메모의 왼쪽 가장자리
    boxShadow: '-6px 0px 20px rgba(0, 0, 0, 0.10)',
  },
  dim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.04)',
  },
});
