import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { KeyboardStickyView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MemoEditor,
  type MemoEditorHandle,
  type MemoFormatState,
} from '../modules/memo-editor';
import { BAR_HEIGHT, FormatBar, type FormatKey } from './FormatBar';
import { MemoListIcon } from './icons';
import { HEADER_HEIGHT, HeaderButton } from './MemoList';
import { isEmptyMemo, type Memo } from './memoStorage';
import { colors } from './theme';
import { Toast, TOAST_HEIGHT } from './Toast';
import { useAutoTodo } from './useAutoTodo';
import { useAutosave } from './useAutosave';

// 컨트롤 바와 키보드(키보드가 없으면 화면 하단 안전 영역) 사이 간격
const BAR_MARGIN = 10;
// 본문 끝과 컨트롤 바 사이 간격
const EDITOR_BAR_GAP = 8;
// 알림과 컨트롤 바 사이 간격
const TOAST_GAP = 8;
const SIDE_PADDING = 20;

const FORMAT_ACTIONS: Record<FormatKey, (editor: MemoEditorHandle) => Promise<void>> = {
  bold: (editor) => editor.toggleBold(),
  underline: (editor) => editor.toggleUnderline(),
  strikethrough: (editor) => editor.toggleStrikethrough(),
  checkbox: (editor) => editor.toggleBlock('checkbox'),
  bullet: (editor) => editor.toggleBlock('bullet'),
  number: (editor) => editor.toggleBlock('number'),
};

type FocusedField = 'title' | 'body' | null;

type Props = {
  // 처음 한 번만 읽는다. 다른 메모를 열 때는 key를 바꿔 화면을 새로 만든다.
  memo: Memo;
  onOpenList: () => void;
};

export function MemoScreen({ memo: initialMemo, onOpenList }: Props) {
  const insets = useSafeAreaInsets();
  const { update: updateMemo, flush } = useAutosave(initialMemo);
  const titleRef = useRef<TextInput>(null);
  const editorRef = useRef<MemoEditorHandle>(null);
  const [formatState, setFormatState] = useState<MemoFormatState | null>(null);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);
  const titleText = useRef(initialMemo.title);
  const getTitle = useCallback(() => titleText.current, []);
  const autoTodo = useAutoTodo(editorRef, getTitle);

  // 알림이 떠 있는 동안에는 본문도 그만큼 위에서 끝나 커서 줄을 가리지 않는다.
  const toastSpace = useSharedValue(0);
  const toastVisible = autoTodo.toast !== null;
  useEffect(() => {
    toastSpace.value = withTiming(toastVisible ? TOAST_HEIGHT + TOAST_GAP : 0, { duration: 180 });
  }, [toastSpace, toastVisible]);

  // 컨트롤 바는 KeyboardStickyView로 키보드를 따라 올라가고,
  // 본문은 같은 계산으로 바로 위에서 끝나도록 아래 공간을 함께 늘린다.
  const { height: keyboardHeight, progress } = useReanimatedKeyboardAnimation();
  const barRestOffset = insets.bottom + BAR_MARGIN;
  const bottomSpaceStyle = useAnimatedStyle(
    () => ({
      height:
        -keyboardHeight.value +
        interpolate(progress.value, [0, 1], [barRestOffset, BAR_MARGIN]) +
        BAR_HEIGHT +
        EDITOR_BAR_GAP +
        toastSpace.value,
    }),
    [barRestOffset],
  );

  const handleFormat = useCallback(
    (key: FormatKey) => {
      const editor = editorRef.current;
      if (!editor) return;
      if (focusedField !== 'body') editor.focus();
      FORMAT_ACTIONS[key](editor);
    },
    [focusedField],
  );

  // 포커스가 있는 입력칸을 직접 blur 해야 Android에서도 확실히 키보드가 내려간다.
  const toggleKeyboard = useCallback(() => {
    if (focusedField === 'body') {
      editorRef.current?.blur();
    } else if (focusedField === 'title') {
      titleRef.current?.blur();
    } else {
      editorRef.current?.focus();
    }
  }, [focusedField]);

  // 목록이 방금 고친 제목·본문을 보여주도록 먼저 저장하고 연다.
  const openList = useCallback(() => {
    if (focusedField === 'body') editorRef.current?.blur();
    else if (focusedField === 'title') titleRef.current?.blur();
    flush();
    onOpenList();
  }, [focusedField, flush, onOpenList]);

  const blurField = (field: Exclude<FocusedField, null>) =>
    setFocusedField((current) => (current === field ? null : current));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton label="메모 목록" onPress={openList}>
          <MemoListIcon color={colors.icon} />
        </HeaderButton>
      </View>
      <TextInput
        ref={titleRef}
        style={styles.title}
        allowFontScaling={false}
        underlineColorAndroid="transparent"
        defaultValue={initialMemo.title}
        placeholder="제목"
        placeholderTextColor={colors.placeholder}
        selectionColor={colors.accent}
        multiline
        scrollEnabled={false}
        submitBehavior="submit"
        returnKeyType="next"
        onSubmitEditing={() => editorRef.current?.focus()}
        onChangeText={(title) => {
          titleText.current = title;
          updateMemo({ title });
        }}
        onFocus={() => setFocusedField('title')}
        onBlur={() => blurField('title')}
      />
      <View style={styles.divider} />
      <MemoEditor
        ref={editorRef}
        style={styles.body}
        initialContent={initialMemo.content}
        placeholder="메모를 입력하세요"
        autoFocus={isEmptyMemo(initialMemo)}
        fontSize={18}
        textColor={colors.ink}
        mutedColor={colors.muted}
        accentColor={colors.accent}
        placeholderColor={colors.placeholder}
        insetHorizontal={SIDE_PADDING}
        insetTop={14}
        onChangeContent={(event) => {
          autoTodo.noteEdit();
          updateMemo({ content: event.nativeEvent.content });
        }}
        onLeaveParagraph={(event) => autoTodo.onLeaveParagraph(event.nativeEvent)}
        onChangeFormat={(event) => setFormatState(event.nativeEvent)}
        onFocusChange={(event) =>
          event.nativeEvent.focused ? setFocusedField('body') : blurField('body')
        }
      />
      <Animated.View style={bottomSpaceStyle} />

      {/* 알림은 따로 띄운다. 서식 바 dock 밖으로 삐져나오면 iOS가 터치를 전달하지 않는다. */}
      {autoTodo.toast && (
        <KeyboardStickyView
          style={styles.barDock}
          offset={{
            closed: -(barRestOffset + BAR_HEIGHT + TOAST_GAP),
            opened: -(BAR_MARGIN + BAR_HEIGHT + TOAST_GAP),
          }}
        >
          <Toast toast={autoTodo.toast} />
        </KeyboardStickyView>
      )}

      <KeyboardStickyView
        style={styles.barDock}
        offset={{ closed: -barRestOffset, opened: -BAR_MARGIN }}
      >
        <FormatBar
          formatState={formatState}
          formattingEnabled={focusedField !== 'title'}
          keyboardVisible={focusedField !== null}
          autoTodoEnabled={autoTodo.enabled}
          onFormat={handleFormat}
          onToggleAutoTodo={autoTodo.toggle}
          onToggleKeyboard={toggleKeyboard}
        />
      </KeyboardStickyView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SIDE_PADDING - 8,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.ink,
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 4,
    paddingBottom: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: SIDE_PADDING,
    backgroundColor: colors.divider,
  },
  body: {
    flex: 1,
  },
  barDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
});
