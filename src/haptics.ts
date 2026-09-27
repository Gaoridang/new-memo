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

/** 툴바 버튼을 길게 눌러 집어 든 순간 */
export function liftHaptic() {
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press);
  } else {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

/** 끌고 있는 툴바 버튼이 놓일 자리가 바뀔 때 */
export function tickHaptic() {
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick);
  } else {
    Haptics.selectionAsync();
  }
}
