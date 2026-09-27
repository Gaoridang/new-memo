import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DoodleStylePicker } from './DoodleStylePicker';
import { BackIcon, BUTTON_ICON_SIZE } from './icons';
import { HEADER_HEIGHT, HEADER_PADDING, HeaderButton } from './MemoList';
import { saveSettings, toolbarLayout, useSettings } from './settings';
import { colors } from './theme';
import { isDefaultToolbar, sameToolbar, type ToolbarItem } from './toolbar';
import { ToolbarEditor } from './ToolbarEditor';

const SIDE_PADDING = 20;
// 화면 아래에 떠 있는 저장 버튼
const SAVE_HEIGHT = 52;
const SAVE_MARGIN = 12;

// 메모 목록의 톱니바퀴로 연다. 메모 화면 위에 밀려 올라오고, 뒤로 가면 목록으로 돌아간다.
// 고친 것은 아래의 저장 버튼을 눌러야 저장된다. 저장하지 않고 나가려 하면 묻는다.
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const savedToolbar = toolbarLayout(settings);
  const [toolbar, setToolbar] = useState<readonly ToolbarItem[]>(savedToolbar);
  const [doodleStyle, setDoodleStyle] = useState(settings.doodleStyle);
  const dirty = !sameToolbar(toolbar, savedToolbar) || doodleStyle !== settings.doodleStyle;
  // 툴바 버튼을 끄는 동안에는 화면이 스크롤되거나 밀어서 뒤로 가지 않는다.
  const [dragging, setDragging] = useState(false);

  // 설정 화면으로 바로 열린 경우(웹 주소 등)에는 돌아갈 곳이 없으므로 메모를 연다.
  const leave = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), []);

  // 기본 배치면 비워 두어 나중에 기본 배치가 바뀌면 따라가게 한다.
  const save = useCallback(() => {
    saveSettings({ toolbar: isDefaultToolbar(toolbar) ? null : [...toolbar], doodleStyle });
    leave();
  }, [doodleStyle, leave, toolbar]);

  const back = useCallback(() => {
    if (!dirty) {
      leave();
      return;
    }
    Alert.alert('바꾼 설정을 저장할까요?', '저장하지 않으면 바꾼 툴바와 두들 그림이 사라져요.', [
      { text: '취소', style: 'cancel' },
      { text: '저장 안 함', style: 'destructive', onPress: leave },
      { text: '저장', onPress: save },
    ]);
  }, [dirty, leave, save]);

  // Android 뒤로 가기도 저장하지 않은 것이 있으면 먼저 묻는다.
  useEffect(() => {
    if (!dirty) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      back();
      return true;
    });
    return () => subscription.remove();
  }, [back, dirty]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* 밀어서 뒤로 가면 물을 수 없으므로 저장하지 않은 것이 있으면 막는다. */}
      <Stack.Screen options={{ gestureEnabled: !dragging && !dirty }} />
      <View style={styles.header}>
        <HeaderButton label="뒤로" onPress={back}>
          <BackIcon color={colors.icon} size={BUTTON_ICON_SIZE} />
        </HeaderButton>
      </View>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={{ paddingBottom: insets.bottom + SAVE_MARGIN + SAVE_HEIGHT + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>설정</Text>

        <Text style={styles.sectionTitle}>툴바</Text>
        <Text style={styles.sectionNote} lineBreakStrategyIOS="hangul-word">
          메모를 쓸 때 키보드 위에 뜨는 툴바예요. 저장하면 메모에 적용돼요.
        </Text>
        <ToolbarEditor initial={savedToolbar} onChange={setToolbar} onDragChange={setDragging} />

        <Text style={[styles.sectionTitle, styles.sectionGap]}>두들 그림</Text>
        <Text style={styles.sectionNote} lineBreakStrategyIOS="hangul-word">
          두들 버튼을 누르면 이 그림으로 붙여요. 이미 붙인 두들도 바뀌어요.
        </Text>
        <DoodleStylePicker value={doodleStyle} onChange={setDoodleStyle} />
      </ScrollView>

      <View style={[styles.saveDock, { bottom: insets.bottom + SAVE_MARGIN }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty }}
          disabled={!dirty}
          onPress={save}
          style={({ pressed }) => [styles.save, dirty && styles.saveReady, pressed && styles.savePressed]}
        >
          <Text style={[styles.saveText, dirty && styles.saveTextReady]}>저장</Text>
        </Pressable>
      </View>
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
    paddingHorizontal: HEADER_PADDING,
  },
  heading: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.ink,
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 4,
    paddingBottom: 20,
  },
  sectionTitle: {
    paddingHorizontal: SIDE_PADDING,
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
  sectionGap: {
    marginTop: 36,
  },
  sectionNote: {
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 4,
    paddingBottom: 12,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  saveDock: {
    position: 'absolute',
    left: SIDE_PADDING,
    right: SIDE_PADDING,
  },
  // 바꾼 것이 없으면 흐리게 두고 누를 수 없다.
  save: {
    height: SAVE_HEIGHT,
    borderRadius: SAVE_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.divider,
  },
  saveReady: {
    backgroundColor: colors.ink,
    boxShadow: '0px 6px 20px rgba(0, 0, 0, 0.16), 0px 1px 3px rgba(0, 0, 0, 0.08)',
  },
  savePressed: {
    opacity: 0.7,
  },
  saveText: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.muted,
  },
  saveTextReady: {
    color: colors.paper,
  },
});
