// 툴바(키보드 위 서식 바)의 배치. 설정 화면에서 끌어서 고치고 settings.json에 저장한다.

/** 툴바에 놓을 수 있는 버튼. 설정 화면의 넣을 수 있는 버튼도 이 순서로 늘어놓는다. */
export const TOOLBAR_BUTTONS = [
  'bold',
  'underline',
  'strikethrough',
  'checkbox',
  'bullet',
  'number',
  'autoTodo',
  'doodle',
  'dismissKeyboard',
] as const;

export type ToolbarButton = (typeof TOOLBAR_BUTTONS)[number];
/** 버튼은 한 번씩, 구분선은 버튼 사이에 몇 개든 놓는다. */
export type ToolbarItem = ToolbarButton | 'separator';

export const DEFAULT_TOOLBAR: readonly ToolbarItem[] = [
  'bold',
  'underline',
  'strikethrough',
  'separator',
  'checkbox',
  'bullet',
  'number',
  'separator',
  'autoTodo',
  'doodle',
  'separator',
  'dismissKeyboard',
];

export function isToolbarButton(value: unknown): value is ToolbarButton {
  return TOOLBAR_BUTTONS.some((button) => button === value);
}

/** 구분선은 버튼 사이에 하나씩만 남긴다. (맨 앞과 맨 끝, 이어진 구분선은 뺀다) */
export function tidySeparators<T>(items: readonly T[], isSeparator: (item: T) => boolean): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (isSeparator(item) && (result.length === 0 || isSeparator(result[result.length - 1]))) continue;
    result.push(item);
  }
  if (result.length > 0 && isSeparator(result[result.length - 1])) result.pop();
  return result;
}

/** 저장된 배치를 읽는다. 모르는 항목과 두 번 나온 버튼은 빼고, 고친 적이 없거나 버튼이 하나도 없으면 null(기본 배치) */
export function readToolbar(value: unknown): ToolbarItem[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<ToolbarButton>();
  const items = value.filter((item): item is ToolbarItem => {
    if (item === 'separator') return true;
    if (!isToolbarButton(item) || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
  return seen.size > 0 ? tidySeparators(items, (item) => item === 'separator') : null;
}

export function isDefaultToolbar(items: readonly ToolbarItem[]) {
  return items.length === DEFAULT_TOOLBAR.length && items.every((item, i) => item === DEFAULT_TOOLBAR[i]);
}
