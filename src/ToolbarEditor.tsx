import { useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { BAR_HEIGHT, barStyles, TOOLBAR_BUTTON_INFO } from './FormatBar';
import { liftHaptic, tickHaptic } from './haptics';
import { BUTTON_ICON_SIZE } from './icons';
import { colors } from './theme';
import { DEFAULT_TOOLBAR, isDefaultToolbar, type ToolbarItem } from './toolbar';
import {
  editorReducer,
  hitTargets,
  initialEditorState,
  isSeparator,
  itemsOf,
  layoutBar,
  paletteEntries,
  shownEntries,
  STAGE_PADDING,
  TILE_ICON_SIZE,
  type Drag,
  type Entry,
  type HitTarget,
} from './toolbarEditing';

// 이만큼 누르고 있으면 집어 든다. 그 전에 움직이면 화면을 넘기는 것으로 본다.
const LIFT_DELAY_MS = 250;
// 집어 든 항목은 흰 네모에 담아 조금 키운다. 구분선은 좁은 네모에 담는다.
const GHOST_SIZE = 44;
const GHOST_SEPARATOR_WIDTH = 24;
const GHOST_SCALE = 1.12;
const LIFT_SPRING = { damping: 16, stiffness: 260 };
// 손을 떼면 들어갈 자리로 날아가 앉는다. 툴바 밖에 놓으면 그 자리에서 사라진다.
const LAND = { duration: 180 };
const VANISH = { duration: 160 };
// 툴바 안의 항목이 자리를 옮기는 시간
const SLIDE = { duration: 180 };
// 넣을 수 있는 버튼 칸은 한 줄에 이 폭 이상으로 고르게 나눈다.
const TILE_MIN_WIDTH = 80;
const SIDE_PADDING = 20;
const PALETTE_PADDING = 6;
const PALETTE_BORDER = 1.5;

const labelOf = (item: ToolbarItem) => (item === 'separator' ? '구분선' : TOOLBAR_BUTTON_INFO[item].label);

/** 누른 곳에 있는 항목 */
function findTarget(targets: HitTarget[], x: number, y: number) {
  'worklet';
  for (const target of targets) {
    if (x >= target.x && x <= target.x + target.width && y >= target.y && y <= target.y + target.height) return target;
  }
  return null;
}

function hintText(drag: Drag | null, notice: string | null) {
  if (drag && !drag.landing) {
    if (drag.outside) {
      if (drag.from === 'palette') return '툴바 위로 끌어 와서 놓으세요.';
      return drag.removable ? '여기서 손을 떼면 툴바에서 빠져요.' : '툴바에는 버튼이 하나는 있어야 해요.';
    }
    if (drag.over === null) return '구분선은 버튼과 버튼 사이에만 놓을 수 있어요.';
    return '넣고 싶은 자리에서 손을 떼세요.';
  }
  return notice ?? '버튼을 길게 눌러 끌면 순서를 바꿀 수 있어요. 툴바 밖으로 끌어내면 빠져요.';
}

type Props = {
  // 처음 보여 줄 배치. 고칠 때마다 onChange로 알리고, 저장은 설정 화면의 저장 버튼이 한다.
  initial: readonly ToolbarItem[];
  onChange: (items: ToolbarItem[]) => void;
  // 끄는 동안에는 화면이 스크롤되거나 뒤로 가지 않게 한다.
  onDragChange: (dragging: boolean) => void;
};

/**
 * 툴바 편집: 실제 서식 바와 같은 모양의 미리보기에서 버튼을 길게 눌러 끌어 옮긴다.
 * 툴바 밖으로 끌어내면 빠져 아래 '넣을 수 있는 버튼'으로 가고, 거기서 끌어 오거나 누르면 다시 들어간다.
 */
export function ToolbarEditor({ initial, onChange, onDragChange }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const [state, dispatch] = useReducer(editorReducer, initial, initialEditorState);
  const { entries, drag, ghost, landing, vanishing, notice, layout, released } = state;

  // 집어 든 항목의 가운데, 누른 곳과 가운데 사이, 떠오른 정도(크기), 흰 네모, 사라지는 정도
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const grab = useSharedValue({ x: 0, y: 0 });
  const lift = useSharedValue(0);
  const surface = useSharedValue(0);
  const fade = useSharedValue(1);
  const following = useSharedValue(false);
  // 집어 든 뒤 날아가 앉기를 마칠 때까지는 새로 집지 않는다.
  const locked = useSharedValue(false);
  const targets = useSharedValue<HitTarget[]>([]);

  // 손가락을 따라가는 일은 UI 스레드에서 하고, 툴바가 어떻게 바뀔지는 editorReducer가 정한다.
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LIFT_DELAY_MS)
        .maxPointers(1)
        .onTouchesDown((event, manager) => {
          const touch = event.changedTouches[0];
          if (locked.get() || !touch || !findTarget(targets.get(), touch.x, touch.y)) manager.fail();
        })
        .onStart((event) => {
          const target = findTarget(targets.get(), event.x, event.y);
          if (!target) return;
          locked.set(true);
          grab.set({ x: event.x - target.center.x, y: event.y - target.center.y });
          ghostX.set(target.center.x);
          ghostY.set(target.center.y);
          fade.set(1);
          lift.set(withSpring(1, LIFT_SPRING));
          surface.set(target.from === 'bar' ? withTiming(1, { duration: 120 }) : 1);
          following.set(true);
          scheduleOnRN(dispatch, { type: 'lift', key: target.key, from: target.from });
        })
        .onUpdate((event) => {
          if (!following.get()) return;
          ghostX.set(event.x - grab.get().x);
          ghostY.set(event.y - grab.get().y);
          scheduleOnRN(dispatch, { type: 'move', x: event.x, y: event.y });
        })
        .onEnd((_event, success) => {
          if (!following.get()) return;
          following.set(false);
          scheduleOnRN(dispatch, { type: 'drop', finished: success });
        }),
    [fade, following, ghostX, ghostY, grab, lift, locked, surface, targets],
  );

  useEffect(() => {
    targets.set(hitTargets(entries, layout));
  }, [entries, layout, targets]);

  useEffect(() => {
    onChange(itemsOf(entries));
  }, [entries, onChange]);

  const dragging = ghost !== null;
  useEffect(() => {
    onDragChange(dragging);
  }, [dragging, onDragChange]);

  useEffect(() => {
    locked.set(false);
  }, [locked, released]);

  // 집어 들 때 한 번, 끄는 동안 들어갈 자리가 바뀔 때마다 톡
  const liftedKey = drag?.entry.key ?? null;
  const over = drag?.over ?? null;
  const lastSpot = useRef<{ key: string | null; over: number | null }>({ key: null, over: null });
  useEffect(() => {
    const last = lastSpot.current;
    if (liftedKey && liftedKey !== last.key) liftHaptic();
    else if (liftedKey && over !== null && over !== last.over) tickHaptic();
    lastSpot.current = { key: liftedKey, over };
  }, [liftedKey, over]);

  // 손을 떼면 들어갈 자리로 날아가 앉는다. 툴바에 앉으면 흰 네모를 걷어 툴바 버튼과 같아진다.
  useEffect(() => {
    if (!landing) return;
    ghostX.set(withTiming(landing.x, LAND));
    ghostY.set(withTiming(landing.y, LAND));
    lift.set(withTiming(0, LAND));
    if (landing.onBar) surface.set(withTiming(0, LAND));
    const timer = setTimeout(() => dispatch({ type: 'landed' }), LAND.duration);
    return () => clearTimeout(timer);
  }, [ghostX, ghostY, landing, lift, surface]);

  useEffect(() => {
    if (!vanishing) return;
    fade.set(withTiming(0, VANISH));
    lift.set(withTiming(0.5, VANISH));
    const timer = setTimeout(() => dispatch({ type: 'vanished' }), VANISH.duration);
    return () => clearTimeout(timer);
  }, [fade, lift, vanishing]);

  // 화면 읽기 사용자는 끌 수 없으므로 같은 일을 동작 메뉴와 누르기로 한다.
  const onBarAction = (entry: Entry, event: AccessibilityActionEvent) => {
    const label = labelOf(entry.item);
    switch (event.nativeEvent.actionName) {
      case 'moveLeft':
      case 'moveRight': {
        const left = event.nativeEvent.actionName === 'moveLeft';
        dispatch({ type: 'shift', key: entry.key, by: left ? -1 : 1 });
        AccessibilityInfo.announceForAccessibility(`${label}, ${left ? '왼쪽' : '오른쪽'}으로 옮겼어요`);
        break;
      }
      case 'remove':
        if (!isSeparator(entry) && entries.filter((item) => !isSeparator(item)).length === 1) {
          AccessibilityInfo.announceForAccessibility('툴바에는 버튼이 하나는 있어야 해요');
          break;
        }
        dispatch({ type: 'remove', key: entry.key });
        AccessibilityInfo.announceForAccessibility(`${label}, 툴바에서 뺐어요`);
        break;
    }
  };

  const addFromPalette = (entry: Entry) => {
    dispatch({ type: 'add', key: entry.key });
    if (!isSeparator(entry)) AccessibilityInfo.announceForAccessibility(`${labelOf(entry.item)}, 툴바 끝에 넣었어요`);
  };

  const width = layout.stage?.width ?? screenWidth;
  const shown = shownEntries(state);
  const bar = layoutBar(shown, width);
  const place = new Map(shown.map((entry, i) => [entry.key, i]));
  // 끄는 동안에는 툴바 항목을 빼거나 순서를 바꿔 다시 그리지 않고 자리만 옮긴다. (누른 항목을 다시 그리면
  // 손가락을 놓친다) 손을 떼면 들어갈 자리에 없는 항목은 그 자리에서 접어 둔다.
  const slots = drag?.from === 'palette' ? [...entries, drag.entry] : entries;
  const palette = paletteEntries(entries);
  const paletteRoom = width - (SIDE_PADDING + PALETTE_PADDING + PALETTE_BORDER) * 2;
  const tileWidth = Math.floor(paletteRoom / Math.max(1, Math.floor(paletteRoom / TILE_MIN_WIDTH)));
  const removing = !!drag && drag.from === 'bar' && drag.outside && drag.removable && !drag.landing;
  const isDefault = isDefaultToolbar(itemsOf(entries));

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.editor}>
        <View style={styles.stage} onLayout={(event) => dispatch({ type: 'stage', rect: event.nativeEvent.layout })}>
          <SlidingView x={bar.left} width={bar.width} style={[barStyles.bar, styles.previewBar]}>
            {slots.map((entry) => {
              const i = place.get(entry.key);
              const slot = i === undefined ? undefined : bar.slots[i];
              // 집어 든 항목은 흰 네모가 대신 보여 주므로 제자리에서는 감춘다.
              const lifted = ghost?.key === entry.key;
              return (
                <SlidingView key={entry.key} x={slot?.x} width={slot?.width ?? 0} hidden={!slot} style={styles.slot}>
                  {/* 끄는 항목이 들어갈 빈자리 */}
                  {lifted && drag && !drag.landing && !isSeparator(entry) && <View style={styles.hole} />}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${labelOf(entry.item)}, 툴바 ${(i ?? 0) + 1}번째`}
                    accessibilityHint="길게 눌러 끌면 옮기거나 툴바에서 뺄 수 있어요"
                    accessibilityActions={[
                      { name: 'moveLeft', label: '왼쪽으로 옮기기' },
                      { name: 'moveRight', label: '오른쪽으로 옮기기' },
                      { name: 'remove', label: '툴바에서 빼기' },
                    ]}
                    onAccessibilityAction={(event) => onBarAction(entry, event)}
                    onPress={() =>
                      dispatch({ type: 'notice', text: `${labelOf(entry.item)} · 길게 눌러 끌면 옮길 수 있어요.` })
                    }
                    style={({ pressed }) => [styles.slotButton, pressed && barStyles.pressed]}
                  >
                    <View style={lifted && styles.liftedIcon}>
                      <ItemIcon item={entry.item} />
                    </View>
                  </Pressable>
                </SlidingView>
              );
            })}
          </SlidingView>
        </View>
        <Text style={styles.hint} numberOfLines={2} maxFontSizeMultiplier={1.4} lineBreakStrategyIOS="hangul-word">
          {hintText(drag, notice)}
        </Text>

        <View style={styles.paletteHeader}>
          <Text style={styles.paletteTitle}>넣을 수 있는 버튼</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isDefault }}
            disabled={isDefault}
            hitSlop={8}
            onPress={() => dispatch({ type: 'reset', items: DEFAULT_TOOLBAR })}
            style={({ pressed }) => pressed && barStyles.pressed}
          >
            <Text style={[styles.reset, isDefault && styles.resetDisabled]}>기본값으로</Text>
          </Pressable>
        </View>
        <View
          style={[styles.palette, removing && styles.paletteDrop]}
          onLayout={(event) => dispatch({ type: 'palette', rect: event.nativeEvent.layout })}
        >
          <LayoutAnimationConfig skipEntering>
            {palette.map((entry) => (
              <Animated.View
                key={entry.key}
                layout={LinearTransition.duration(SLIDE.duration)}
                entering={FadeIn.duration(SLIDE.duration)}
                onLayout={(event) => dispatch({ type: 'tile', key: entry.key, rect: event.nativeEvent.layout })}
                style={{ width: tileWidth }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={labelOf(entry.item)}
                  accessibilityHint={isSeparator(entry) ? '툴바의 버튼 사이에 넣어요' : '툴바 끝에 넣어요'}
                  onPress={() => addFromPalette(entry)}
                  style={({ pressed }) => [styles.tileButton, pressed && barStyles.pressed]}
                >
                  <View
                    style={[
                      styles.tileIcon,
                      drag?.from === 'palette' && drag.entry.key === entry.key && styles.tileIconLifted,
                    ]}
                  >
                    <ItemIcon item={entry.item} />
                  </View>
                  <Text
                    style={styles.tileLabel}
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.3}
                    lineBreakStrategyIOS="hangul-word"
                  >
                    {labelOf(entry.item)}
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
          </LayoutAnimationConfig>
        </View>

        {ghost && <Ghost entry={ghost} x={ghostX} y={ghostY} lift={lift} surface={surface} fade={fade} />}
      </View>
    </GestureDetector>
  );
}

function ItemIcon({ item }: { item: ToolbarItem }) {
  if (item === 'separator') return <View style={barStyles.separator} />;
  const { Icon } = TOOLBAR_BUTTON_INFO[item];
  return <Icon color={colors.icon} size={BUTTON_ICON_SIZE} />;
}

type SlidingViewProps = {
  // 비워 두면 지금 자리에 머문다.
  x?: number;
  width: number;
  hidden?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * x와 폭이 바뀌면 미끄러지듯 옮겨 간다. (처음 나타날 때는 그 자리에 바로 선다)
 * 숨기면 그 자리에서 접히고, 다 접힌 뒤에 다시 나타나면 새 자리에서 벌어진다.
 */
function SlidingView({ x, width, hidden = false, style, children }: SlidingViewProps) {
  const left = useSharedValue(x ?? 0);
  const size = useSharedValue(hidden ? 0 : width);
  const opacity = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    if (x !== undefined) left.set(size.get() === 0 ? x : withTiming(x, SLIDE));
    size.set(withTiming(hidden ? 0 : width, SLIDE));
    opacity.set(withTiming(hidden ? 0 : 1, SLIDE));
  }, [hidden, left, opacity, size, width, x]);
  const animated = useAnimatedStyle(() => ({
    width: size.get(),
    opacity: opacity.get(),
    transform: [{ translateX: left.get() }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

type GhostProps = {
  entry: Entry;
  x: SharedValue<number>;
  y: SharedValue<number>;
  lift: SharedValue<number>;
  surface: SharedValue<number>;
  fade: SharedValue<number>;
};

/** 손가락을 따라다니는 집어 든 항목과 그 이름 */
function Ghost({ entry, x, y, lift, surface, fade }: GhostProps) {
  const width = isSeparator(entry) ? GHOST_SEPARATOR_WIDTH : GHOST_SIZE;
  const moving = useAnimatedStyle(() => ({
    opacity: fade.get(),
    transform: [
      { translateX: x.get() - width / 2 },
      { translateY: y.get() - GHOST_SIZE / 2 },
      { scale: 1 + (GHOST_SCALE - 1) * lift.get() },
    ],
  }));
  const shown = useAnimatedStyle(() => ({ opacity: surface.get() }));
  return (
    <Animated.View style={[styles.ghost, { width }, moving]}>
      <Animated.View style={[styles.ghostSurface, shown]} />
      <Animated.View style={[styles.ghostLabel, shown]}>
        <Text style={styles.ghostLabelText} numberOfLines={1}>
          {labelOf(entry.item)}
        </Text>
      </Animated.View>
      {/* 웹에서는 뷰로 감싸야 흰 네모 위에 그려진다. */}
      <View>{isSeparator(entry) ? <View style={styles.ghostSeparator} /> : <ItemIcon item={entry.item} />}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // 집어 든 항목을 아래 두들 그림 칸 위로 끌어도 가려지지 않게
  editor: {
    zIndex: 1,
  },
  // 툴바 미리보기는 실제 서식 바처럼 화면 너비 가운데에 둔다.
  stage: {
    height: BAR_HEIGHT + STAGE_PADDING * 2,
  },
  previewBar: {
    position: 'absolute',
    top: STAGE_PADDING,
    left: 0,
    paddingHorizontal: 0,
  },
  slot: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotButton: {
    alignSelf: 'stretch',
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hole: {
    position: 'absolute',
    top: 7,
    bottom: 7,
    left: '8%',
    right: '8%',
    borderRadius: 10,
    backgroundColor: colors.highlight,
  },
  liftedIcon: {
    opacity: 0,
  },
  hint: {
    minHeight: 40,
    paddingHorizontal: SIDE_PADDING,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
    textAlign: 'center',
  },
  paletteHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 16,
    paddingBottom: 8,
  },
  paletteTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  reset: {
    fontSize: 15,
    color: colors.accent,
  },
  resetDisabled: {
    color: colors.iconDisabled,
  },
  palette: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
    marginHorizontal: SIDE_PADDING,
    paddingHorizontal: PALETTE_PADDING,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: PALETTE_BORDER,
    borderColor: 'transparent',
    backgroundColor: colors.highlight,
  },
  // 툴바 버튼을 끌어내 놓으면 빠지는 곳
  paletteDrop: {
    borderColor: colors.accent,
    borderStyle: 'dashed',
  },
  tileButton: {
    alignItems: 'center',
    gap: 6,
  },
  tileIcon: {
    width: TILE_ICON_SIZE,
    height: TILE_ICON_SIZE,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.barBorder,
    boxShadow: '0px 1px 3px rgba(0, 0, 0, 0.08)',
  },
  // 집어 든 버튼의 빈자리
  tileIconLifted: {
    opacity: 0.3,
  },
  tileLabel: {
    fontSize: 12,
    lineHeight: 15,
    color: colors.icon,
    textAlign: 'center',
  },
  ghost: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: GHOST_SIZE,
    pointerEvents: 'none',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostSurface: {
    ...StyleSheet.absoluteFill,
    borderRadius: 12,
    backgroundColor: colors.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.barBorder,
    boxShadow: '0px 10px 24px rgba(0, 0, 0, 0.16), 0px 2px 6px rgba(0, 0, 0, 0.08)',
  },
  ghostLabel: {
    position: 'absolute',
    bottom: GHOST_SIZE + 8,
    left: -60,
    right: -60,
    alignItems: 'center',
  },
  ghostLabelText: {
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    fontSize: 12,
    fontWeight: '600',
    color: colors.paper,
    backgroundColor: colors.ink,
  },
  ghostSeparator: {
    width: StyleSheet.hairlineWidth * 3,
    height: 20,
    backgroundColor: colors.muted,
  },
});
