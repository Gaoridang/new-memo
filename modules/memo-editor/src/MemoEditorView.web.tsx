import { View } from 'react-native';

import type { MemoEditorProps } from './MemoEditor';

// 에디터는 iOS·Android 네이티브에만 있다. 웹 빌드는 API 라우트를 배포하려고 만들 뿐이라 빈 칸만 둔다.
export function MemoEditor({ style }: MemoEditorProps) {
  return <View style={style} />;
}
