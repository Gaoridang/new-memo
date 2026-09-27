import { BAR_BORDER, BAR_HEIGHT, BAR_PADDING, barMetrics, SEPARATOR_WIDTH } from './FormatBar';
import { TOOLBAR_BUTTONS, tidySeparators, type ToolbarItem } from './toolbar';

// 설정 화면 툴바 편집의 상태와 동작. 손가락 위치를 받아 툴바가 어떻게 바뀔지 정하고, 그리기는 ToolbarEditor가 한다.

/** 툴바 미리보기 위아래 여백. 이 띠(와 DROP_SLOP만큼 바깥)에서 손을 떼면 툴바에 들어간다. */
export const STAGE_PADDING = 28;
const DROP_SLOP = 12;
/** 넣을 수 있는 버튼 칸의 아이콘 네모 */
export const TILE_ICON_SIZE = 44;
// 구분선은 얇아서, 이만큼 넓게 눌러도 잡힌다. (양옆 버튼보다 먼저 잡는다)
const SEPARATOR_HIT_WIDTH = 16;
const NO_SEPARATOR_SPOT = '구분선은 버튼과 버튼 사이에만 놓을 수 있어요.';

/** 툴바의 버튼과 구분선. 구분선은 여러 개라 저마다 열쇠를 준다. */
export type Entry = { key: string; item: ToolbarItem };
export type Source = 'bar' | 'palette';
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };

/** 길게 누르면 집어 드는 항목의 자리 (편집기 기준 좌표). 집어 들면 흰 네모가 center에 떠오른다. */
export type HitTarget = Rect & { key: string; from: Source; center: Point };

export type Drag = {
  entry: Entry;
  from: Source;
  // 끄는 항목을 뺀 툴바. 팔레트에서 꺼냈으면 지금 툴바 그대로
  base: Entry[];
  // 툴바에서 집어 든 자리 (base의 몇 번째 앞)
  origin: number;
  // 손을 떼면 들어갈 자리 (base의 몇 번째 앞). 들어갈 곳이 없으면 null
  over: number | null;
  // 손가락이 툴바 띠 밖에 있는지
  outside: boolean;
  // 툴바 밖에 놓으면 빠지는지. 툴바에는 버튼이 하나는 남아야 한다.
  removable: boolean;
  // 손을 떼고 날아가 앉는 중
  landing: boolean;
};

export type EditorLayout = { stage: Rect | null; palette: Rect | null; tiles: Record<string, Rect> };

export type EditorState = {
  entries: Entry[];
  drag: Drag | null;
  // 집어 든 항목. 손을 뗀 뒤 날아가 앉거나 사라지는 동안에도 남는다.
  ghost: Entry | null;
  // 손을 뗀 뒤 집어 든 항목이 날아가 앉을 곳. onBar면 툴바 버튼 모습(흰 네모 없이)으로 앉는다.
  landing: (Point & { onBar: boolean }) | null;
  // 날아가 앉으면 툴바가 이 모습이 된다.
  pending: Entry[] | null;
  // 툴바 밖에 놓아 뺐으면 집어 든 항목이 그 자리에서 사라진다.
  vanishing: boolean;
  // 설명 줄에 잠깐 보이는 말 (누른 버튼의 이름 등)
  notice: string | null;
  layout: EditorLayout;
  nextSeparator: number;
  // 집어 들기가 끝날 때마다 늘어난다. (다시 집을 수 있게 푼다)
  released: number;
};

export type EditorAction =
  | { type: 'stage' | 'palette'; rect: Rect }
  | { type: 'tile'; key: string; rect: Rect }
  | { type: 'lift'; key: string; from: Source }
  | { type: 'move'; x: number; y: number }
  | { type: 'drop'; finished: boolean }
  | { type: 'landed' }
  | { type: 'vanished' }
  | { type: 'add'; key: string }
  | { type: 'shift'; key: string; by: -1 | 1 }
  | { type: 'remove'; key: string }
  | { type: 'reset'; items: readonly ToolbarItem[] }
  | { type: 'notice'; text: string | null };

export const isSeparator = (entry: Entry) => entry.item === 'separator';
const tidy = (entries: readonly Entry[]) => tidySeparators(entries, isSeparator);
const insertAt = (entries: readonly Entry[], index: number, entry: Entry) => [
  ...entries.slice(0, index),
  entry,
  ...entries.slice(index),
];
export const itemsOf = (entries: readonly Entry[]) => entries.map((entry) => entry.item);
const hasButton = (entries: readonly Entry[]) => entries.some((entry) => !isSeparator(entry));

// 넣을 수 있는 버튼 칸의 구분선. 늘 있고, 끌어 가거나 누르면 새 구분선을 만든다.
export const SEPARATOR_TILE: Entry = { key: 'separator-tile', item: 'separator' };

function withEntries(items: readonly ToolbarItem[], first: number) {
  let next = first;
  const entries = items.map((item): Entry => (item === 'separator' ? { key: `separator-${next++}`, item } : { key: item, item }));
  return { entries, nextSeparator: next };
}

export function initialEditorState(items: readonly ToolbarItem[]): EditorState {
  return {
    ...withEntries(items, 0),
    drag: null,
    ghost: null,
    landing: null,
    pending: null,
    vanishing: false,
    notice: null,
    layout: { stage: null, palette: null, tiles: {} },
    released: 0,
  };
}

/** 툴바에 없는 버튼(정해진 순서)과 구분선 */
export function paletteEntries(entries: readonly Entry[]): Entry[] {
  const used = new Set(itemsOf(entries));
  const buttons = TOOLBAR_BUTTONS.filter((button) => !used.has(button));
  return [...buttons.map((button): Entry => ({ key: button, item: button })), SEPARATOR_TILE];
}

export type BarLayout = { left: number; width: number; slots: { x: number; width: number }[] };

/**
 * 미리보기 툴바의 자리. 실제 서식 바처럼 화면 너비(width)로 폭을 정하고 가운데 둔다.
 * slot의 x는 바 테두리 안쪽에서 잰다.
 */
export function layoutBar(entries: readonly Entry[], width: number): BarLayout {
  const metrics = barMetrics(itemsOf(entries), width);
  let x = BAR_PADDING;
  const slots = entries.map((entry) => {
    const slot = { x, width: isSeparator(entry) ? SEPARATOR_WIDTH : metrics.buttonWidth };
    x += slot.width;
    return slot;
  });
  return { left: (width - metrics.width) / 2, width: metrics.width, slots };
}

/** 툴바에 지금 보일 모습. 끄는 중이면 손을 뗐을 때의 모습(들어갈 자리는 비워 둔다) */
export function shownEntries({ entries, drag }: EditorState): Entry[] {
  if (!drag) return entries;
  if (drag.over !== null) return tidy(insertAt(drag.base, drag.over, drag.entry));
  return drag.from === 'bar' ? tidy(drag.base) : entries;
}

/** index번째 항목의 가운데 (편집기 기준 좌표) */
function slotCenter(entries: readonly Entry[], index: number, stage: Rect): Point {
  const bar = layoutBar(entries, stage.width);
  const slot = bar.slots[index];
  return { x: stage.x + bar.left + BAR_BORDER + slot.x + slot.width / 2, y: stage.y + STAGE_PADDING + BAR_HEIGHT / 2 };
}

/** 구분선은 버튼과 버튼 사이에만 들어간다. */
const separatorFits = (entries: readonly Entry[], index: number) =>
  index > 0 && index < entries.length && !isSeparator(entries[index - 1]) && !isSeparator(entries[index]);

/**
 * 손가락 x에 가장 가까운 들어갈 자리. 들어간 뒤의 모습(버튼 폭과 구분선 정리까지)에서 끄는 항목의 가운데로 잰다.
 * 들어갈 곳이 없으면 null
 */
function nearestSpot({ base, entry }: Drag, x: number, stage: Rect): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i <= base.length; i++) {
    if (isSeparator(entry) && !separatorFits(base, i)) continue;
    const entries = tidy(insertAt(base, i, entry));
    const distance = Math.abs(slotCenter(entries, entries.indexOf(entry), stage).x - x);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/** 길게 누르면 집어 드는 항목들. 구분선을 먼저 찾는다. */
export function hitTargets(entries: readonly Entry[], { stage, palette, tiles }: EditorLayout): HitTarget[] {
  const targets: HitTarget[] = [];
  if (stage) {
    const bar = layoutBar(entries, stage.width);
    entries.forEach((entry, i) => {
      const center = slotCenter(entries, i, stage);
      const width = isSeparator(entry) ? SEPARATOR_HIT_WIDTH : bar.slots[i].width;
      targets.push({ key: entry.key, from: 'bar', center, x: center.x - width / 2, y: center.y - BAR_HEIGHT / 2, width, height: BAR_HEIGHT });
    });
  }
  if (palette) {
    for (const entry of paletteEntries(entries)) {
      const tile = tiles[entry.key];
      if (!tile) continue;
      const x = palette.x + tile.x;
      const y = palette.y + tile.y;
      targets.push({ ...tile, key: entry.key, from: 'palette', x, y, center: { x: x + tile.width / 2, y: y + TILE_ICON_SIZE / 2 } });
    }
  }
  return targets.sort((a, b) => Number(b.key.startsWith('separator')) - Number(a.key.startsWith('separator')));
}

function lift(state: EditorState, key: string, from: Source): EditorState {
  const { entries } = state;
  if (state.ghost) return state;
  let entry: Entry | undefined;
  let { nextSeparator } = state;
  if (from === 'bar') entry = entries.find((item) => item.key === key);
  else if (key === SEPARATOR_TILE.key) entry = { key: `separator-${nextSeparator++}`, item: 'separator' };
  else entry = paletteEntries(entries).find((item) => item.key === key);
  // 그 사이 툴바가 바뀌어 누른 자리에 다른 것이 있으면 집지 않고 다시 집을 수 있게 푼다.
  if (!entry) return { ...state, released: state.released + 1 };
  const base = from === 'bar' ? entries.filter((item) => item !== entry) : entries;
  const origin = from === 'bar' ? entries.indexOf(entry) : -1;
  return {
    ...state,
    nextSeparator,
    ghost: entry,
    notice: null,
    drag: {
      entry,
      from,
      base,
      origin,
      over: from === 'bar' ? origin : null,
      outside: from === 'palette',
      removable: from === 'palette' || isSeparator(entry) || hasButton(base),
      landing: false,
    },
  };
}

function move(state: EditorState, x: number, y: number): EditorState {
  const { drag } = state;
  const { stage } = state.layout;
  if (!drag || drag.landing || !stage) return state;
  const outside = y < stage.y - DROP_SLOP || y > stage.y + stage.height + DROP_SLOP;
  // 뺄 수 없는 마지막 버튼은 툴바 밖으로 끌어도 자리를 비워 둔다.
  const over = !outside ? nearestSpot(drag, x, stage) : drag.removable ? null : drag.over;
  if (over === drag.over && outside === drag.outside) return state;
  return { ...state, drag: { ...drag, over, outside } };
}

function drop(state: EditorState, finished: boolean): EditorState {
  const { drag } = state;
  const { stage, palette, tiles } = state.layout;
  if (!drag || drag.landing) return state;
  // 끄는 도중에 끊기면(전화가 오는 등) 집어 든 자리로 돌린다.
  const over = finished ? drag.over : drag.from === 'bar' ? drag.origin : null;
  if (over !== null && stage) {
    const pending = tidy(insertAt(drag.base, over, drag.entry));
    const center = slotCenter(pending, pending.indexOf(drag.entry), stage);
    return { ...state, drag: { ...drag, over, landing: true }, pending, landing: { ...center, onBar: true } };
  }
  if (drag.from === 'bar') {
    // 툴바 밖에 놓으면 빠지고, 집어 든 항목은 그 자리에서 사라진다.
    return { ...state, entries: tidy(drag.base), drag: null, vanishing: true };
  }
  // 넣을 수 있는 버튼 칸에서 꺼낸 것은 툴바에 넣지 않으면 제자리로 돌아간다.
  const tile = tiles[isSeparator(drag.entry) ? SEPARATOR_TILE.key : drag.entry.key];
  if (!tile || !palette) return { ...state, drag: null, vanishing: true };
  const home = { x: palette.x + tile.x + tile.width / 2, y: palette.y + tile.y + TILE_ICON_SIZE / 2 };
  return { ...state, drag: { ...drag, over: null, landing: true }, landing: { ...home, onBar: false } };
}

/** 누르면 툴바 끝에 넣는다. 구분선은 끝에서 가장 가까운 버튼과 버튼 사이에 넣는다. */
function add(state: EditorState, key: string): EditorState {
  const { entries } = state;
  if (key !== SEPARATOR_TILE.key) {
    const entry = paletteEntries(entries).find((item) => item.key === key);
    return entry ? { ...state, entries: [...entries, entry], notice: null } : state;
  }
  for (let i = entries.length - 1; i > 0; i--) {
    if (separatorFits(entries, i)) {
      const entry: Entry = { key: `separator-${state.nextSeparator}`, item: 'separator' };
      return { ...state, entries: insertAt(entries, i, entry), nextSeparator: state.nextSeparator + 1, notice: null };
    }
  }
  return { ...state, notice: NO_SEPARATOR_SPOT };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  // 끄는 동안에는 툴바를 다른 방법으로 고치지 않는다.
  const busy = state.ghost !== null;
  switch (action.type) {
    case 'stage':
    case 'palette':
      return { ...state, layout: { ...state.layout, [action.type]: action.rect } };
    case 'tile':
      return { ...state, layout: { ...state.layout, tiles: { ...state.layout.tiles, [action.key]: action.rect } } };
    case 'lift':
      return lift(state, action.key, action.from);
    case 'move':
      return move(state, action.x, action.y);
    case 'drop':
      return drop(state, action.finished);
    case 'landed':
      return {
        ...state,
        entries: state.pending ?? state.entries,
        pending: null,
        drag: null,
        ghost: null,
        landing: null,
        released: state.released + 1,
      };
    case 'vanished':
      return { ...state, ghost: null, vanishing: false, released: state.released + 1 };
    case 'add':
      return busy ? state : add(state, action.key);
    case 'shift': {
      const from = state.entries.findIndex((entry) => entry.key === action.key);
      const to = from + action.by;
      if (busy || from < 0 || to < 0 || to >= state.entries.length) return state;
      const next = [...state.entries];
      [next[from], next[to]] = [next[to], next[from]];
      return { ...state, entries: tidy(next) };
    }
    case 'remove': {
      const rest = state.entries.filter((entry) => entry.key !== action.key);
      if (busy || !hasButton(rest)) return state;
      return { ...state, entries: tidy(rest) };
    }
    case 'reset':
      return busy ? state : { ...state, ...withEntries(action.items, state.nextSeparator), notice: null };
    case 'notice':
      // 끌고 나서 손을 뗀 곳의 버튼이 눌린 것으로 잡혀도 설명을 바꾸지 않는다.
      return busy ? state : { ...state, notice: action.text };
  }
}
