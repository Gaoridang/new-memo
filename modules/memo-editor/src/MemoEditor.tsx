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
  /**
   * index번째 문단의 내용이 text이고 종류가 from일 때만 to로 바꾼다.
   * 그 사이 사용자가 문단을 고쳤으면 아무것도 하지 않고 false를 돌려준다.
   */
  setParagraphBlock(index: number, text: string, from: MemoBlockKind, to: MemoBlockKind): Promise<boolean>;
};

/** 고친 일반 문단에서 커서가 떠났을 때 (줄 바꿈, 다른 줄로 이동, 포커스 해제) */
export type MemoLeaveParagraphEvent = { index: number; text: string };

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
  onLeaveParagraph?: (event: NativeSyntheticEvent<MemoLeaveParagraphEvent>) => void;
};

export const MemoEditor = requireNativeView<MemoEditorProps>('MemoEditor');
