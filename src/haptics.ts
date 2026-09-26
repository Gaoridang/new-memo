import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** 밀던 화면이 놓으면 넘어가는 지점을 지날 때 톡 */
export function swipeTick() {
  if (Platform.OS === 'android') {
    // Segment_Tick은 Android 14부터라 모든 버전에 있는 Clock_Tick을 쓴다.
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick);
  } else {
    Haptics.selectionAsync();
  }
}
