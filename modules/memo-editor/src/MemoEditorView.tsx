import { requireNativeView } from 'expo';

import type { MemoEditorProps } from './MemoEditor';

export const MemoEditor = requireNativeView<MemoEditorProps>('MemoEditor');
