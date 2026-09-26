import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { AutoTodoIcon } from './icons';
import { colors, floatingSurface } from './theme';

export const TOAST_HEIGHT = 36;

export type ToastMessage = {
  id: number;
  message: string;
  // 기능을 끈 알림처럼 강조하지 않을 때는 아이콘을 서식 바의 꺼진 버튼과 같은 색으로 둔다.
  muted?: boolean;
};

// 서식 바 위에 잠깐 떠서 방금 바꾼 설정을 알려주는 알약. 서식 바와 같은 표면을 쓴다.
export function Toast({ toast }: { toast: ToastMessage }) {
  return (
    <Animated.View
      key={toast.id}
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      layout={LinearTransition.duration(180)}
      style={styles.toast}
      accessibilityLiveRegion="polite"
    >
      <AutoTodoIcon color={toast.muted ? colors.icon : colors.accent} />
      <Text style={styles.message} numberOfLines={1}>
        {toast.message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    ...floatingSurface,
    borderWidth: StyleSheet.hairlineWidth,
    height: TOAST_HEIGHT,
    borderRadius: TOAST_HEIGHT / 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    paddingRight: 16,
  },
  message: {
    fontSize: 14,
    color: colors.ink,
  },
});
