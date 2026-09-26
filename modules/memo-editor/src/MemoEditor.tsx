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

/**
 * index번째 문단의 내용이 text이고 start부터 length만큼(UTF-16)이 word이면, 그 낱말 뒤에 id 두들을 붙인다.
 * 두들은 문서에 저장되고, 낱말을 고쳐 써도 낱말 끝을 따라간다.
 */
export type MemoDoodleChange = { index: number; text: string; start: number; length: number; word: string; id: string };

/** 24x24 격자 위에 순서대로 칠하는 두들 그림 한 겹. d는 절대 좌표의 M·L·C·Q·Z 경로, 색은 '#RRGGBB'. */
export type MemoDoodleOp = {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  dx?: number;
  dy?: number;
};

/** 두들 그림과, 두들이 붙은 낱말을 감싸는 칩의 색('#RRGGBB') */
export type MemoDoodleArt = { id: string; ops: MemoDoodleOp[]; chipFill: string };

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
  /**
   * 두들을 붙인다. 한 번에 붙인 것은 되돌리기 한 번으로 떨어진다. 이미 두들이 있는 문단은 건너뛴다.
   * explicit은 사용자가 누른 동작이다. 자동으로 붙일 때와 달리 되돌린 뒤(다시 하기가 남아 있어도) 붙인다.
   */
  setDoodles(changes: MemoDoodleChange[], explicit: boolean): Promise<boolean[]>;
  /** 메모의 두들을 모두 뗀다. 되돌리기 한 번으로 돌아온다. 뗀 개수를 돌려준다. */
  removeDoodles(): Promise<number>;
  /** 타이핑, 서식, 할 일로 바꾸기를 모두 한 기록으로 되돌린다. 포커스는 건드리지 않는다. */
  undo(): Promise<void>;
  redo(): Promise<void>;
};

/** fromHistory는 되돌리기·다시 하기로 바뀐 경우 */
export type MemoChangeContentEvent = { content: string; fromHistory: boolean };

/**
 * 고친 문단에서 커서가 떠났을 때 (줄 바꿈, 다른 줄로 이동, 포커스 해제). block은 그 문단의 종류로,
 * checkbox는 체크하지 않은 체크박스, checked는 체크한 체크박스다.
 */
export type MemoLeaveParagraphEvent = { index: number; text: string; block: MemoBlockKind | 'checked' };

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
  /**
   * 두들 그림 세트. 두들이 붙은 낱말은 그림과 함께 칩으로 그린다.
   * 칩 바로 뒤에서 지우면 글자 대신 칩(두들)이 떨어지고, 되돌리기 한 번으로 다시 붙는다.
   */
  doodleArt?: MemoDoodleArt[];
  onChangeContent?: (event: NativeSyntheticEvent<MemoChangeContentEvent>) => void;
  onChangeFormat?: (event: NativeSyntheticEvent<MemoFormatState>) => void;
  onChangeHistory?: (event: NativeSyntheticEvent<MemoHistoryState>) => void;
  onFocusChange?: (event: NativeSyntheticEvent<{ focused: boolean }>) => void;
  onLeaveParagraph?: (event: NativeSyntheticEvent<MemoLeaveParagraphEvent>) => void;
  /** 본문이 비어 있을 때 지우기를 눌렀을 때. 빈 목록 줄이면 먼저 목록 표시만 없애고 알리지 않는다. */
  onBackspaceWhenEmpty?: () => void;
};

export { MemoEditor } from './MemoEditorView';
