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
import type { ToolbarButton, ToolbarItem } from './toolbar';

export type FormatKey = 'bold' | 'underline' | 'strikethrough' | 'checkbox' | 'bullet' | 'number';

/** 툴바 버튼의 이름과 아이콘. 설정 화면도 같은 것으로 그린다. */
export const TOOLBAR_BUTTON_INFO: Record<ToolbarButton, { label: string; Icon: ComponentType<IconProps> }> = {
  bold: { label: '굵게', Icon: BoldIcon },
  underline: { label: '밑줄', Icon: UnderlineIcon },
  strikethrough: { label: '취소선', Icon: StrikethroughIcon },
  checkbox: { label: '체크박스', Icon: CheckboxIcon },
  bullet: { label: '글머리 기호', Icon: BulletListIcon },
  number: { label: '번호 목록', Icon: NumberedListIcon },
  autoTodo: { label: '할 일 자동 감지', Icon: AutoTodoIcon },
  doodle: { label: '두들', Icon: DoodleIcon },
  dismissKeyboard: { label: '키보드 내리기', Icon: KeyboardDismissIcon },
};

// 누르기 쉽도록 버튼마다 권장 크기(44pt)에 가까운 자리를 주되, 버튼이 모두 화면 너비에 들어가도록 줄인다.
// (기본 배치인 버튼 아홉 개는 좁은 화면 375pt에서 37pt, 393pt에서 39pt)
const MAX_BUTTON_WIDTH = 42;
const SEPARATOR_GUTTER = 2;
export const SEPARATOR_WIDTH = SEPARATOR_GUTTER * 2 + StyleSheet.hairlineWidth;
export const BAR_PADDING = 6;
export const BAR_BORDER = StyleSheet.hairlineWidth;
// 서식 바와 화면 가장자리 사이에 남기는 최소 여백
const SCREEN_MARGIN = 8;
export const BAR_HEIGHT = 48;

/** 배치에 따른 버튼 폭과 서식 바 전체 폭 (테두리 포함) */
export function barMetrics(layout: readonly ToolbarItem[], screenWidth: number) {
  const separators = layout.filter((item) => item === 'separator').length;
  const buttons = layout.length - separators;
  const room = screenWidth - SCREEN_MARGIN * 2 - (BAR_PADDING + BAR_BORDER) * 2 - separators * SEPARATOR_WIDTH;
  const buttonWidth = Math.min(MAX_BUTTON_WIDTH, Math.floor(room / Math.max(1, buttons)));
  const width = (BAR_PADDING + BAR_BORDER) * 2 + buttons * buttonWidth + separators * SEPARATOR_WIDTH;
  return { buttonWidth, width };
}

const FORMAT_KEYS: readonly ToolbarButton[] = ['bold', 'underline', 'strikethrough', 'checkbox', 'bullet', 'number'];
const isFormatKey = (button: ToolbarButton): button is FormatKey => FORMAT_KEYS.includes(button);

type Props = {
  // 설정 화면에서 고른 버튼과 구분선, 왼쪽부터
  layout: readonly ToolbarItem[];
  formatState: MemoFormatState | null;
  formattingEnabled: boolean;
  autoTodoEnabled: boolean;
  // 메모를 훑어 두들을 찾는 중인지
  doodling: boolean;
  onFormat: (key: FormatKey) => void;
  onToggleAutoTodo: () => void;
  onPressDoodles: () => void;
  onDismissKeyboard: () => void;
};

// 제목이나 본문을 편집하는 동안에만 키보드 위에 띄운다.
export function FormatBar({
  layout,
  formatState,
  formattingEnabled,
  autoTodoEnabled,
  doodling,
  onFormat,
  onToggleAutoTodo,
  onPressDoodles,
  onDismissKeyboard,
}: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const { buttonWidth } = barMetrics(layout, screenWidth);

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

  const renderFormat = (key: FormatKey) => {
    const { label, Icon } = TOOLBAR_BUTTON_INFO[key];
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

  const renderButton = (button: ToolbarButton) => {
    if (isFormatKey(button)) return renderFormat(button);
    const { label, Icon } = TOOLBAR_BUTTON_INFO[button];
    switch (button) {
      case 'autoTodo':
        // 서식이 아니라 모드라서 제목을 편집할 때도 켜고 끌 수 있다.
        return (
          <BarButton key={button} label={label} width={buttonWidth} active={autoTodoEnabled} onPress={onToggleAutoTodo}>
            <Icon color={autoTodoEnabled ? colors.accent : colors.icon} size={BUTTON_ICON_SIZE} />
          </BarButton>
        );
      case 'doodle':
        // 붙이기만 하는 버튼이라 켜고 끄는 버튼처럼 보이지 않게 늘 같은 색이다.
        return (
          <BarButton key={button} label={label} width={buttonWidth} busy={doodling} onPress={onPressDoodles}>
            {doodling ? (
              <ActivityIndicator size="small" color={colors.icon} />
            ) : (
              <Icon color={colors.icon} size={BUTTON_ICON_SIZE} />
            )}
          </BarButton>
        );
      case 'dismissKeyboard':
        return (
          <BarButton key={button} label={label} width={buttonWidth} onPress={onDismissKeyboard}>
            <Icon color={colors.icon} size={BUTTON_ICON_SIZE} />
          </BarButton>
        );
    }
  };

  return (
    <View style={barStyles.bar}>
      {layout.map((item, i) =>
        item === 'separator' ? <View key={`separator-${i}`} style={barStyles.separator} /> : renderButton(item),
      )}
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
      style={({ pressed }) => [barStyles.button, { width }, pressed && barStyles.pressed]}
    >
      {children}
    </Pressable>
  );
}

// 설정 화면의 툴바 미리보기도 이 모양을 그대로 쓴다.
export const barStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BAR_HEIGHT,
    paddingHorizontal: BAR_PADDING,
    borderRadius: BAR_HEIGHT / 2,
    ...floatingSurface,
    borderWidth: BAR_BORDER,
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
