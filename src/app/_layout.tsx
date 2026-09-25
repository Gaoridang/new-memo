import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { colors } from '../theme';

// 딥 링크로 메모를 바로 열어도 뒤에는 항상 목록이 있도록 한다.
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }}>
        <Stack.Screen name="index" />
        <Stack.Screen
          name="memo/[id]"
          // 앱을 켤 때 여는 첫 메모는 목록 위로 밀려 들어오지 않고 바로 보이게 한다.
          options={({ route }) => ({
            animation: (route.params as { launch?: string } | undefined)?.launch ? 'none' : 'default',
          })}
        />
      </Stack>
    </KeyboardProvider>
  );
}
