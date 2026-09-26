import { useCallback, useEffect, useRef, useState } from 'react';
import { InputAccessoryView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MemoEditor,
  type MemoEditorHandle,
  type MemoFormatState,
  type MemoHistoryState,
} from '../modules/memo-editor';
import { BAR_HEIGHT, FormatBar, type FormatKey } from './FormatBar';
import { BUTTON_ICON_SIZE, ComposeIcon, MemoListIcon, RedoIcon, UndoIcon } from './icons';
import { HEADER_HEIGHT, HEADER_PADDING, HeaderButton } from './MemoList';
import { memoBlocks, type Memo } from './memoStorage';
import { colors } from './theme';
import { Toast, TOAST_HEIGHT, useToast } from './Toast';
import { useAutoDoodle } from './useAutoDoodle';
import { useAutoTodo } from './useAutoTodo';
import { useAutosave } from './useAutosave';
import { useEditorIdle } from './useEditorIdle';

// iOS는 컨트롤 바를 키보드의 inputAccessoryView로 붙여 시스템이 키보드와 한 몸으로 움직이게 한다.
// (하드웨어 키보드면 화면 아래 안전 영역에 띄운다) Android에는 그런 자리가 없어 키보드 위치를 프레임마다 따라간다.
const ATTACHED_TO_KEYBOARD = Platform.OS === 'ios';

// 컨트롤 바와 키보드(키보드가 없으면 화면 하단 안전 영역) 사이 간격
const BAR_MARGIN = 10;
// 본문 끝과 컨트롤 바 사이 간격
const EDITOR_BAR_GAP = 8;
// iOS: 키보드 위 컨트롤 바 자리의 윗여백. 본문과의 간격이자 컨트롤 바 그림자가 잘리지 않을 자리다.
const ACCESSORY_TOP_SPACE = 14;
// 알림과 컨트롤 바 사이 간격
const TOAST_GAP = 8;
const SIDE_PADDING = 20;
// Android: 키보드가 닫혀 있으면 컨트롤 바를 이만큼 내려 화면 아래에 숨긴다. (그림자까지 가린다)
const BAR_HIDDEN_OFFSET = BAR_HEIGHT + 24;
// Android: 포커스를 받고 이만큼 지나도 화면 키보드가 없으면 하드웨어 키보드로 보고 컨트롤 바를 바닥에 띄운다.
const HARDWARE_KEYBOARD_CHECK_MS = 700;
// Android: 제목과 본문 사이를 옮겨 다니면 포커스가 잠깐 비므로, 그동안은 바닥에 띄운 컨트롤 바를 내리지 않는다.
const BAR_HIDE_DELAY_MS = 120;

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
  // 메모를 밀어 아래의 목록이 드러나 있는지
  listOpen: boolean;
  onOpenList: () => void;
  onNewMemo: () => void;
};

export function MemoScreen({ memo: initialMemo, listOpen, onOpenList, onNewMemo }: Props) {
  const insets = useSafeAreaInsets();
  const { update: updateMemo, flush } = useAutosave(initialMemo);
  const titleRef = useRef<TextInput>(null);
  const editorRef = useRef<MemoEditorHandle>(null);
  const [formatState, setFormatState] = useState<MemoFormatState | null>(null);
  const [history, setHistory] = useState<MemoHistoryState>({ canUndo: false, canRedo: false });
  const [focusedField, setFocusedField] = useState<FocusedField>(null);
  // 컨트롤 바가 키보드와 함께 내려가는 동안에도 마지막으로 편집한 칸 기준으로 버튼을 보여준다.
  const [barField, setBarField] = useState<Exclude<FocusedField, null>>('body');
  const editing = focusedField !== null;
  const titleText = useRef(initialMemo.title);
  const getTitle = useCallback(() => titleText.current, []);
  const contentText = useRef(initialMemo.content);
  const getContent = useCallback(() => contentText.current, []);
  const dues = useRef(initialMemo.dues);
  // 마감일은 할 일 줄의 글자로 기억한다. 저장할 때 본문에 더는 없는 줄의 마감일은 지운다.
  const setDue = useCallback(
    (line: string, due: string | null) => {
      const lines = new Set(memoBlocks(contentText.current).map((block) => block.text.trim()));
      const next = Object.fromEntries(
        Object.entries({ ...dues.current, [line]: due }).filter(
          (entry): entry is [string, string] => entry[1] !== null && lines.has(entry[0]),
        ),
      );
      dues.current = next;
      updateMemo({ dues: next });
    },
    [updateMemo],
  );
  const toast = useToast();
  const idle = useEditorIdle(editorRef);
  const autoTodo = useAutoTodo(getTitle, getContent, setDue, idle, toast.show);
  const autoDoodle = useAutoDoodle(getTitle, getContent, idle, toast.show);
  // 제목 칸과 본문이 함께 쓰는 키보드 위 컨트롤 바 (iOS). 화면마다 달라야 다른 메모 화면의 것을 찾지 않는다.
  const accessoryID = `memo-format-bar-${initialMemo.id}`;

  // Android: 화면 키보드 없이 편집할 때(하드웨어 키보드)만 컨트롤 바를 바닥에 띄운다. 화면 키보드가 있으면 키보드를 따른다.
  const docked = useSharedValue(0);
  useEffect(() => {
    if (ATTACHED_TO_KEYBOARD) return;
    const timer = editing
      ? setTimeout(() => {
          if (!KeyboardController.isVisible()) docked.value = withTiming(1, { duration: 200 });
        }, HARDWARE_KEYBOARD_CHECK_MS)
      : setTimeout(() => {
          docked.value = withTiming(0, { duration: 200 });
        }, BAR_HIDE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [docked, editing]);

  // Android: 알림이 떠 있는 동안에는 본문도 그만큼 위에서 끝나 커서 줄을 가리지 않는다.
  // (iOS는 알림도 키보드 위 컨트롤 바에 함께 들어가 키보드 높이에 포함된다)
  const toastSpace = useSharedValue(0);
  const toastVisible = editing && toast.toast !== null;
  useEffect(() => {
    toastSpace.value = withTiming(toastVisible ? TOAST_HEIGHT + TOAST_GAP : 0, { duration: 180 });
  }, [toastSpace, toastVisible]);

  // 키보드 높이. 본문은 움직임이 끝날 높이(onStart)로 한 번에 맞추고 (보이지 않는 아래쪽이라 프레임마다 맞출 필요가 없다),
  // Android의 컨트롤 바는 프레임마다(onMove) 키보드를 따라간다.
  // useReanimatedKeyboardAnimation은 iOS에서 움직이기 시작할 때 최종값으로 한 번에 바뀌어 키보드와 따로 놀았다.
  const keyboardHeight = useSharedValue(0);
  const keyboardProgress = useSharedValue(0);
  const keyboardTarget = useSharedValue(0);
  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        keyboardTarget.value = e.height;
      },
      onMove: (e) => {
        'worklet';
        keyboardHeight.value = e.height;
        keyboardProgress.value = e.progress;
      },
      onInteractive: (e) => {
        'worklet';
        keyboardTarget.value = e.height;
        keyboardHeight.value = e.height;
        keyboardProgress.value = e.progress;
      },
      onEnd: (e) => {
        'worklet';
        keyboardTarget.value = e.height;
        keyboardHeight.value = e.height;
        keyboardProgress.value = e.progress;
      },
    },
    [],
  );

  // Android: 컨트롤 바는 키보드가 닫혀 있으면 화면 아래에 숨어 있다가 키보드와 함께 올라오고,
  // 키보드가 내려가면 함께 내려가 숨는다.
  const barRestOffset = insets.bottom + BAR_MARGIN;
  const barTranslate = useDerivedValue(() => {
    const closed = interpolate(docked.value, [0, 1], [BAR_HIDDEN_OFFSET, -barRestOffset]);
    return -keyboardHeight.value + interpolate(keyboardProgress.value, [0, 1], [closed, -BAR_MARGIN]);
  }, [barRestOffset]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: barTranslate.value }] }));
  const toastStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: barTranslate.value - BAR_HEIGHT - TOAST_GAP }],
  }));
  // 본문은 컨트롤 바 바로 위에서 끝나도록 아래 공간을 맞춘다.
  const bottomSpaceStyle = useAnimatedStyle(() => {
    const keyboard = keyboardTarget.value;
    // iOS의 키보드 높이에는 위에 붙은 컨트롤 바(와 알림)가 이미 들어 있다.
    if (ATTACHED_TO_KEYBOARD) return { height: keyboard > 0 ? keyboard : insets.bottom };
    const barSpace = BAR_MARGIN + BAR_HEIGHT + EDITOR_BAR_GAP;
    const below = keyboard > 0 ? keyboard + barSpace : insets.bottom + docked.value * barSpace;
    return { height: below + toastSpace.value };
  }, [insets.bottom]);

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
  const dismissKeyboard = useCallback(() => {
    if (focusedField === 'body') editorRef.current?.blur();
    else if (focusedField === 'title') titleRef.current?.blur();
  }, [focusedField]);

  // 목록이 방금 고친 제목·본문을 보여주도록 먼저 저장하고 연다.
  const openList = useCallback(() => {
    dismissKeyboard();
    flush();
    onOpenList();
  }, [dismissKeyboard, flush, onOpenList]);

  // 지금 메모를 저장해 두고 빈 메모로 바꾼다. 키보드는 새 메모의 입력칸을 눌러야 올라온다.
  const newMemo = useCallback(() => {
    dismissKeyboard();
    flush();
    onNewMemo();
  }, [dismissKeyboard, flush, onNewMemo]);

  const focusField = (field: Exclude<FocusedField, null>) => {
    setFocusedField(field);
    setBarField(field);
  };
  const blurField = (field: Exclude<FocusedField, null>) =>
    setFocusedField((current) => (current === field ? null : current));

  // 메모를 밀어 목록을 열어도 목록이 방금 고친 제목·본문을 보여주도록 저장하고 키보드를 내린다.
  useEffect(() => {
    if (!listOpen) return;
    editorRef.current?.blur();
    titleRef.current?.blur();
    flush();
  }, [flush, listOpen]);

  const formatBar = (
    <FormatBar
      formatState={formatState}
      formattingEnabled={barField === 'body'}
      autoTodoEnabled={autoTodo.enabled}
      doodled={autoDoodle.decorated}
      doodling={autoDoodle.scanning}
      onFormat={handleFormat}
      onToggleAutoTodo={autoTodo.toggle}
      onPressDoodles={autoDoodle.press}
      onDismissKeyboard={dismissKeyboard}
    />
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton label="메모 목록" onPress={openList}>
          <MemoListIcon color={colors.icon} size={BUTTON_ICON_SIZE} />
        </HeaderButton>
        <View style={styles.headerActions}>
          {/* 할 일로 바꾸기는 포커스가 빠질 때도 일어나므로 되돌리기·다시 하기는 키보드가 없어도 늘 둔다. */}
          <HeaderButton label="되돌리기" disabled={!history.canUndo} onPress={() => editorRef.current?.undo()}>
            <UndoIcon color={history.canUndo ? colors.icon : colors.iconDisabled} size={BUTTON_ICON_SIZE} />
          </HeaderButton>
          <HeaderButton label="다시 하기" disabled={!history.canRedo} onPress={() => editorRef.current?.redo()}>
            <RedoIcon color={history.canRedo ? colors.icon : colors.iconDisabled} size={BUTTON_ICON_SIZE} />
          </HeaderButton>
          <HeaderButton label="새 메모" onPress={newMemo}>
            <ComposeIcon color={colors.accent} size={BUTTON_ICON_SIZE} />
          </HeaderButton>
        </View>
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
        inputAccessoryViewID={ATTACHED_TO_KEYBOARD ? accessoryID : undefined}
        onSubmitEditing={() => editorRef.current?.focus()}
        onChangeText={(title) => {
          titleText.current = title;
          updateMemo({ title });
        }}
        onFocus={() => focusField('title')}
        onBlur={() => blurField('title')}
      />
      <View style={styles.divider} />
      <MemoEditor
        ref={editorRef}
        style={styles.body}
        initialContent={initialMemo.content}
        placeholder="메모를 입력하세요"
        fontSize={18}
        textColor={colors.ink}
        mutedColor={colors.muted}
        accentColor={colors.accent}
        placeholderColor={colors.placeholder}
        insetHorizontal={SIDE_PADDING}
        insetTop={14}
        accessoryID={accessoryID}
        doodleArt={autoDoodle.art}
        onChangeContent={(event) => {
          const { content, fromHistory } = event.nativeEvent;
          const previous = contentText.current;
          contentText.current = content;
          idle.markEdited();
          autoTodo.onChangeContent(previous, content, fromHistory);
          autoDoodle.onChangeContent(previous, content, fromHistory);
          updateMemo({ content });
        }}
        onLeaveParagraph={(event) => {
          autoTodo.onLeaveParagraph(event.nativeEvent);
          autoDoodle.onLeaveParagraph(event.nativeEvent);
        }}
        onChangeFormat={(event) => setFormatState(event.nativeEvent)}
        onChangeHistory={(event) => setHistory(event.nativeEvent)}
        onFocusChange={(event) =>
          event.nativeEvent.focused ? focusField('body') : blurField('body')
        }
      />
      <Animated.View style={bottomSpaceStyle} />

      {ATTACHED_TO_KEYBOARD ? (
        // 제목이나 본문을 편집할 때만 키보드와 함께 나타난다.
        <InputAccessoryView nativeID={accessoryID}>
          <View style={styles.accessory}>
            {toast.toast && <Toast toast={toast.toast} />}
            {formatBar}
          </View>
        </InputAccessoryView>
      ) : (
        <>
          {editing && toast.toast && (
            <Animated.View style={[styles.barDock, toastStyle]}>
              <Toast toast={toast.toast} />
            </Animated.View>
          )}
          {/* 키보드를 따라 움직이도록 늘 그려 둔다. 편집 중이 아니면 화면 아래에 숨어 있다. */}
          <Animated.View
            style={[styles.barDock, barStyle]}
            accessibilityElementsHidden={!editing}
            importantForAccessibility={editing ? 'auto' : 'no-hide-descendants'}
          >
            {formatBar}
          </Animated.View>
        </>
      )}
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
    justifyContent: 'space-between',
    paddingHorizontal: HEADER_PADDING,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
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
  accessory: {
    alignItems: 'center',
    gap: TOAST_GAP,
    paddingTop: ACCESSORY_TOP_SPACE,
    paddingBottom: BAR_MARGIN,
  },
});
