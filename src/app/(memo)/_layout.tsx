import { Slot } from 'expo-router';

import { MemoDrawer } from '../../MemoDrawer';

// 메모 한 장을 띄우고, 목록은 메모 아래에 깔아 둔다. (메모를 오른쪽으로 밀면 목록이 나온다)
export default function MemoLayout() {
  return (
    <MemoDrawer>
      <Slot />
    </MemoDrawer>
  );
}
