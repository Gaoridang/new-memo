import { requireNativeView } from 'expo';
import type { Ref } from 'react';
import type { ColorValue, NativeSyntheticEvent, ViewProps } from 'react-native';

export type MemoBlockKind = 'paragraph' | 'checkbox' | 'bullet' | 'number';
export type MemoListKind = Exclude<MemoBlockKind, 'paragraph'>;

export type MemoFormatState = {
  bold: boolean;
  underline: boolean;
  strikethrough: boolean;
  block: MemoBlockKind;
};

export type MemoEditorHandle = {
  focus(): Promise<void>;
  blur(): Promise<void>;
  toggleBold(): Promise<void>;
  toggleUnderline(): Promise<void>;
  toggleStrikethrough(): Promise<void>;
  toggleBlock(kind: MemoListKind): Promise<void>;
};

export type MemoEditorProps = ViewProps & {
  ref?: Ref<MemoEditorHandle>;
  /** 처음 한 번만 읽는 저장 내용(JSON). 이후 편집 내용은 에디터가 들고 있다. */
  initialContent?: string;
  placeholder?: string;
  autoFocus?: boolean;
  fontSize?: number;
  textColor?: ColorValue;
  mutedColor?: ColorValue;
  accentColor?: ColorValue;
  placeholderColor?: ColorValue;
  insetHorizontal?: number;
  insetTop?: number;
  onChangeContent?: (event: NativeSyntheticEvent<{ content: string }>) => void;
  onChangeFormat?: (event: NativeSyntheticEvent<MemoFormatState>) => void;
  onFocusChange?: (event: NativeSyntheticEvent<{ focused: boolean }>) => void;
};

export const MemoEditor = requireNativeView<MemoEditorProps>('MemoEditor');
