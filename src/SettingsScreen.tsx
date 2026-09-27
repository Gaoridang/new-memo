import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DoodleStylePicker } from './DoodleStylePicker';
import { BackIcon, BUTTON_ICON_SIZE } from './icons';
import { HEADER_HEIGHT, HEADER_PADDING, HeaderButton } from './MemoList';
import { colors } from './theme';
import { ToolbarEditor } from './ToolbarEditor';

const SIDE_PADDING = 20;

// 메모 목록의 톱니바퀴로 연다. 메모 화면 위에 밀려 올라오고, 뒤로 가면 목록으로 돌아간다.
export function SettingsScreen() {
  const insets = useSafeAreaInsets();
  // 툴바 버튼을 끄는 동안에는 화면이 스크롤되거나 밀어서 뒤로 가지 않는다.
  const [dragging, setDragging] = useState(false);

  // 설정 화면으로 바로 열린 경우(웹 주소 등)에는 돌아갈 곳이 없으므로 메모를 연다.
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ gestureEnabled: !dragging }} />
      <View style={styles.header}>
        <HeaderButton label="뒤로" onPress={back}>
          <BackIcon color={colors.icon} size={BUTTON_ICON_SIZE} />
        </HeaderButton>
      </View>
      <ScrollView
        scrollEnabled={!dragging}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>설정</Text>

        <Text style={styles.sectionTitle}>툴바</Text>
        <Text style={styles.sectionNote} lineBreakStrategyIOS="hangul-word">
          메모를 쓸 때 키보드 위에 뜨는 툴바예요. 바꾸면 바로 적용돼요.
        </Text>
        <ToolbarEditor onDragChange={setDragging} />

        <Text style={[styles.sectionTitle, styles.sectionGap]}>두들 그림</Text>
        <Text style={styles.sectionNote} lineBreakStrategyIOS="hangul-word">
          두들 버튼을 누르면 이 그림으로 붙여요. 이미 붙인 두들도 바뀌어요.
        </Text>
        <DoodleStylePicker />
      </ScrollView>
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
});
