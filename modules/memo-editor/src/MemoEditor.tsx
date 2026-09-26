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

export type MemoHistoryState = { canUndo: boolean; canRedo: boolean };

/** index번째 문단의 내용이 text이고 종류가 from이면 to로 바꾼다. */
export type MemoParagraphBlockChange = { index: number; text: string; from: MemoBlockKind; to: MemoBlockKind };

export type MemoEditorHandle = {
  focus(): Promise<void>;
  blur(): Promise<void>;
  toggleBold(): Promise<void>;
  toggleUnderline(): Promise<void>;
  toggleStrikethrough(): Promise<void>;
  toggleBlock(kind: MemoListKind): Promise<void>;
  /**
   * 문단 종류를 한꺼번에 바꾼다. 한 번에 바꾼 것은 되돌리기 한 번으로 돌아간다.
   * 그 사이 사용자가 고친 문단은 건너뛴다. 바꾼 문단마다 true를 돌려준다.
   */
  setParagraphBlocks(changes: MemoParagraphBlockChange[]): Promise<boolean[]>;
  /** 타이핑, 서식, 할 일로 바꾸기를 모두 한 기록으로 되돌린다. 포커스는 건드리지 않는다. */
  undo(): Promise<void>;
  redo(): Promise<void>;
};

/** fromHistory는 되돌리기·다시 하기로 바뀐 경우 */
export type MemoChangeContentEvent = { content: string; fromHistory: boolean };

/** 고친 일반 문단이나 체크하지 않은 체크박스에서 커서가 떠났을 때 (줄 바꿈, 다른 줄로 이동, 포커스 해제) */
export type MemoLeaveParagraphEvent = { index: number; text: string; block: 'paragraph' | 'checkbox' };

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
  /** iOS: 키보드 위에 붙일 InputAccessoryView의 nativeID (Android는 무시한다) */
  accessoryID?: string;
  onChangeContent?: (event: NativeSyntheticEvent<MemoChangeContentEvent>) => void;
  onChangeFormat?: (event: NativeSyntheticEvent<MemoFormatState>) => void;
  onChangeHistory?: (event: NativeSyntheticEvent<MemoHistoryState>) => void;
  onFocusChange?: (event: NativeSyntheticEvent<{ focused: boolean }>) => void;
  onLeaveParagraph?: (event: NativeSyntheticEvent<MemoLeaveParagraphEvent>) => void;
  /** 본문이 비어 있을 때 지우기를 눌렀을 때. 빈 목록 줄이면 먼저 목록 표시만 없애고 알리지 않는다. */
  onBackspaceWhenEmpty?: () => void;
};

export { MemoEditor } from './MemoEditorView';
