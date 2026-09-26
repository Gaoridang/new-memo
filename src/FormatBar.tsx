import type { ComponentType, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { MemoFormatState } from '../modules/memo-editor';
import {
  AutoTodoIcon,
  BoldIcon,
  BulletListIcon,
  BUTTON_ICON_SIZE,
  CheckboxIcon,
  DoodleIcon,
  ICON_SIZE,
  KeyboardDismissIcon,
  NumberedListIcon,
  StrikethroughIcon,
  UnderlineIcon,
  type IconProps,
} from './icons';
import { colors, floatingSurface } from './theme';

export type FormatKey = 'bold' | 'underline' | 'strikethrough' | 'checkbox' | 'bullet' | 'number';

type FormatItem = {
  key: FormatKey;
  label: string;
  Icon: ComponentType<IconProps>;
};

const INLINE_ITEMS: FormatItem[] = [
  { key: 'bold', label: '굵게', Icon: BoldIcon },
  { key: 'underline', label: '밑줄', Icon: UnderlineIcon },
  { key: 'strikethrough', label: '취소선', Icon: StrikethroughIcon },
];

const PARAGRAPH_ITEMS: FormatItem[] = [
  { key: 'checkbox', label: '체크박스', Icon: CheckboxIcon },
  { key: 'bullet', label: '글머리 기호', Icon: BulletListIcon },
  { key: 'number', label: '번호 목록', Icon: NumberedListIcon },
];

// 누르기 쉽도록 버튼마다 권장 크기(44pt)에 가까운 자리를 주되, 버튼 아홉 개가 화면 너비에 들어가도록 줄인다.
// (좁은 화면 375pt에서 37pt, 393pt에서 39pt)
const MAX_BUTTON_WIDTH = 42;
const BUTTON_COUNT = 9;
const SEPARATOR_COUNT = 3;
const SEPARATOR_GUTTER = 2;
const BAR_PADDING = 6;
// 서식 바와 화면 가장자리 사이에 남기는 최소 여백
const SCREEN_MARGIN = 8;
export const BAR_HEIGHT = 48;

type Props = {
  formatState: MemoFormatState | null;
  formattingEnabled: boolean;
  autoTodoEnabled: boolean;
  // 이 메모에 두들이 붙어 있는지, 메모를 훑는 중인지
  doodled: boolean;
  doodling: boolean;
  onFormat: (key: FormatKey) => void;
  onToggleAutoTodo: () => void;
  onPressDoodles: () => void;
  onDismissKeyboard: () => void;
};

// 제목이나 본문을 편집하는 동안에만 키보드 위에 띄운다.
export function FormatBar({
  formatState,
  formattingEnabled,
  autoTodoEnabled,
  doodled,
  doodling,
  onFormat,
  onToggleAutoTodo,
  onPressDoodles,
  onDismissKeyboard,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const separators = SEPARATOR_COUNT * (SEPARATOR_GUTTER * 2 + StyleSheet.hairlineWidth);
  const buttonWidth = Math.min(
    MAX_BUTTON_WIDTH,
    Math.floor((screenWidth - SCREEN_MARGIN * 2 - BAR_PADDING * 2 - separators) / BUTTON_COUNT),
  );

  const isActive = (key: FormatKey) => {
    if (!formatState) return false;
    switch (key) {
      case 'bold':
      case 'underline':
      case 'strikethrough':
        return formatState[key];
      default:
        return formatState.block === key;
    }
  };

  const renderItem = ({ key, label, Icon }: FormatItem) => {
    const disabled = !formattingEnabled;
    const active = formattingEnabled && isActive(key);
    const color = disabled ? colors.iconDisabled : active ? colors.accent : colors.icon;

    return (
      <BarButton
        key={key}
        label={label}
        width={buttonWidth}
        active={active}
        disabled={disabled}
        onPress={() => onFormat(key)}
      >
        <Icon color={color} size={BUTTON_ICON_SIZE} />
      </BarButton>
    );
  };

  return (
    <View style={styles.bar}>
      {INLINE_ITEMS.map(renderItem)}
      <View style={styles.separator} />
      {PARAGRAPH_ITEMS.map(renderItem)}
      <View style={styles.separator} />
      {/* 서식이 아니라 모드라서 제목을 편집할 때도 켜고 끌 수 있다. */}
      <BarButton label="할 일 자동 감지" width={buttonWidth} active={autoTodoEnabled} onPress={onToggleAutoTodo}>
        <AutoTodoIcon color={autoTodoEnabled ? colors.accent : colors.icon} size={BUTTON_ICON_SIZE} />
      </BarButton>
      <BarButton label="두들" width={buttonWidth} active={doodled} busy={doodling} onPress={onPressDoodles}>
        {doodling ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <DoodleIcon color={doodled ? colors.accent : colors.icon} size={BUTTON_ICON_SIZE} />
        )}
      </BarButton>
      <View style={styles.separator} />
      <BarButton label="키보드 내리기" width={buttonWidth} onPress={onDismissKeyboard}>
        <KeyboardDismissIcon color={colors.icon} size={BUTTON_ICON_SIZE} />
      </BarButton>
    </View>
  );
}

type BarButtonProps = {
  label: string;
  width: number;
  active?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
};

function BarButton({ label, width, active = false, busy = false, disabled = false, onPress, children }: BarButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { width }, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_HEIGHT,
    paddingHorizontal: BAR_PADDING,
    borderRadius: BAR_HEIGHT / 2,
    ...floatingSurface,
    borderWidth: StyleSheet.hairlineWidth,
  },
  button: {
    height: BAR_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.4,
  },
  separator: {
    width: StyleSheet.hairlineWidth,
    height: ICON_SIZE,
    marginHorizontal: SEPARATOR_GUTTER,
    backgroundColor: colors.divider,
  },
});
