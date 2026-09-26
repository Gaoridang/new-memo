import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { MemoDrawer } from '../MemoDrawer';
import { colors } from '../theme';

// 메모 한 장을 띄우고, 목록은 메모 아래에 깔아 둔다. (메모를 오른쪽으로 밀면 목록이 나온다)
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <StatusBar style="dark" />
        <MemoDrawer>
          <Slot />
        </MemoDrawer>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
