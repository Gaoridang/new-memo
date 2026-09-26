import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** 밀어서 목록을 열거나 닫기로 정해진 순간 (손을 뗄 때) */
export function swipeHaptic() {
  if (Platform.OS === 'android') {
    // 다른 효과는 Android 버전에 따라 없을 수 있어 모든 버전에 있는 Clock_Tick을 쓴다.
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick);
  } else {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}
