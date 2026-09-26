import { useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { swipeTick } from './haptics';
import { MemoIcon } from './icons';
import { colors, floatingSurface } from './theme';

// 이만큼 밀면 놓았을 때 넘어간다. 이 지점을 지날 때마다 톡 울린다.
const THRESHOLD = 72;
// 빠르게 튕기면 이만큼만 밀어도 넘어간다. (빠르기는 px/ms)
const FLING_DISTANCE = THRESHOLD / 2;
const FLING_VELOCITY = 0.8;
// 화면은 고무줄처럼 점점 덜 따라오다 이 거리에서 멈춘다.
const MAX_SHIFT = 88;
// 가로로 이만큼 움직였고 세로보다 확실히 많이 움직였을 때만 가로 밀기로 본다.
const SLOP = 12;
// 넘어간 뒤 밀린 화면을 제자리로 돌려놓는 시점. 그때는 새 화면이 목록을 덮고 있다.
const RESET_DELAY_MS = 600;
const PILL_HEIGHT = 36;

const shiftFor = (pull: number) => MAX_SHIFT * (1 - Math.exp(-pull / MAX_SHIFT));
const ARMED_SHIFT = shiftFor(THRESHOLD);

type Props = {
  /** 손가락을 따라 움직이는 화면 */
  style?: StyleProp<ViewStyle>;
  /** 밀어서 돌아갈 메모의 제목. 없으면 밀어도 아무 일도 없다. */
  label?: string;
  onReturn: () => void;
  children: ReactNode;
};

/**
 * 목록을 왼쪽으로 밀면 방금까지 보던 메모로 돌아간다. (메모를 오른쪽으로 밀면 목록이 나온다)
 * 미는 동안 화면이 손가락을 따라오고, 오른쪽에서 돌아갈 메모가 나타난다.
 */
export function SwipeToReturn({ style, label, onReturn, children }: Props) {
  const shift = useSharedValue(0);
  const armed = useSharedValue(0);
  // 손가락을 댄 곳과 마지막으로 움직인 곳. 놓을 때 빠르기를 잰다.
  const touch = useRef({ startX: 0, startY: 0, lastX: 0, lastTime: 0, velocity: 0, armed: false });

  const setArmed = (next: boolean) => {
    if (touch.current.armed === next) return;
    touch.current.armed = next;
    armed.set(withTiming(next ? 1 : 0, { duration: 120 }));
    swipeTick();
  };

  const settle = () => {
    touch.current.armed = false;
    shift.set(withSpring(0, { damping: 22, stiffness: 260, overshootClamping: true }));
    armed.set(withTiming(0, { duration: 120 }));
  };

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -shift.value }],
  }));
  const pillStyle = useAnimatedStyle(() => {
    const progress = Math.min(1, shift.value / ARMED_SHIFT);
    return { opacity: progress, transform: [{ translateX: (1 - progress) * 32 }] };
  });
  const armedStyle = useAnimatedStyle(() => ({ opacity: armed.value }));

  return (
    <View style={styles.container}>
      <Animated.View
        style={[styles.container, style, contentStyle]}
        onStartShouldSetResponderCapture={(event) => {
          const { pageX, pageY, timestamp } = event.nativeEvent;
          touch.current = { startX: pageX, startY: pageY, lastX: pageX, lastTime: timestamp, velocity: 0, armed: false };
          return false;
        }}
        onMoveShouldSetResponderCapture={(event) => {
          if (label === undefined) return false;
          const dx = event.nativeEvent.pageX - touch.current.startX;
          const dy = event.nativeEvent.pageY - touch.current.startY;
          return dx < -SLOP && Math.abs(dx) > Math.abs(dy) * 2;
        }}
        onResponderTerminationRequest={() => false}
        onResponderMove={(event) => {
          const { pageX, timestamp } = event.nativeEvent;
          const current = touch.current;
          if (timestamp > current.lastTime) {
            current.velocity = (pageX - current.lastX) / (timestamp - current.lastTime);
          }
          current.lastX = pageX;
          current.lastTime = timestamp;
          const pull = Math.max(0, current.startX - pageX);
          shift.set(shiftFor(pull));
          setArmed(pull >= THRESHOLD);
        }}
        onResponderRelease={() => {
          const { armed: wasArmed, velocity, startX, lastX } = touch.current;
          const fling = velocity < -FLING_VELOCITY && startX - lastX >= FLING_DISTANCE;
          if (label === undefined || (!wasArmed && !fling)) {
            settle();
            return;
          }
          if (!wasArmed) swipeTick();
          touch.current.armed = false;
          // 밀린 그대로 두면 새 화면이 같은 방향으로 이어서 들어온다.
          shift.set(withDelay(RESET_DELAY_MS, withTiming(0, { duration: 0 })));
          armed.set(withDelay(RESET_DELAY_MS, withTiming(0, { duration: 0 })));
          onReturn();
        }}
        onResponderTerminate={settle}
      >
        {children}
      </Animated.View>
      {label !== undefined && (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.pill, pillStyle]}
        >
          <PillContent label={label} color={colors.ink} iconColor={colors.accent} />
          {/* 놓으면 넘어가는 지점을 지나면 강조색으로 바뀐다. */}
          <Animated.View style={[styles.pillArmed, armedStyle]}>
            <PillContent label={label} color={colors.paper} iconColor={colors.paper} />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

function PillContent({ label, color, iconColor }: { label: string; color: string; iconColor: string }) {
  return (
    <View style={styles.pillContent}>
      <MemoIcon color={iconColor} />
      <Text style={[styles.pillLabel, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pill: {
    position: 'absolute',
    top: '42%',
    right: 16,
    maxWidth: '64%',
    height: PILL_HEIGHT,
    borderRadius: PILL_HEIGHT / 2,
    ...floatingSurface,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillArmed: {
    ...StyleSheet.absoluteFill,
    borderRadius: PILL_HEIGHT / 2,
    backgroundColor: colors.accent,
  },
  pillContent: {
    height: PILL_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 14,
  },
  pillLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '600',
  },
});
