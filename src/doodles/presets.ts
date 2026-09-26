import { colors } from '../theme';
import { DOODLE_ART, TONES, type DoodleArt, type Shape } from './art';
import { DOODLE_IDS, type DoodleId } from './catalog';

// 두들 그림 세트. 모양(art.ts)은 같고 칠하는 방법만 다르다. 사용자가 둘 가운데 하나를 고른다.

/** 24x24 격자 위에 순서대로 칠한다. 선은 끝과 이음이 모두 둥글다. dx·dy만큼 옮겨 그린다. */
export type DrawOp = {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  dx?: number;
  dy?: number;
};

export const DOODLE_STYLES = [
  // 연한 면과 같은 색의 짙은 테두리
  { id: 'pastel', name: '파스텔' },
  // 먹색 테두리에 흰 테두리와 옅은 그림자를 둘러 붙인 스티커처럼
  { id: 'sticker', name: '스티커' },
] as const;

export type DoodleStyle = (typeof DOODLE_STYLES)[number]['id'];

export function isDoodleStyle(value: unknown): value is DoodleStyle {
  return DOODLE_STYLES.some((style) => style.id === value);
}

const INK = colors.icon;
const PAPER = colors.paper;
const LINE_WIDTH = 1.35;
// 두들이 붙은 낱말을 감싸는 칩의 면. 파스텔은 그림의 짙은 색을 아주 옅게(흰 그림도 보이도록),
// 스티커는 흰 테두리가 보이도록 옅은 회색
const PASTEL_CHIP_WHITE = 0.86;
const STICKER_CHIP = colors.highlight;
// 스티커: 모양 둘레의 흰 테두리 두께와 그 아래 그림자
const STICKER_MARGIN = 2.2;
const STICKER_SHADOW = '#E3E3EA';

/** outline을 주지 않으면 테두리를 면과 같은 색의 짙은 색으로 긋는다. */
function paint(shape: Shape, art: DoodleArt, outline?: string): DrawOp[] {
  const { fill, deep } = TONES[shape.tone ?? art.tone];
  const ink = outline ?? deep;
  switch (shape.kind) {
    case 'body':
      return [{ d: shape.d, fill, stroke: ink, width: LINE_WIDTH }];
    case 'line':
      return [{ d: shape.d, stroke: ink, width: LINE_WIDTH }];
    case 'dot':
      return [{ d: shape.d, fill: ink }];
    case 'shine':
      return [{ d: shape.d, stroke: PAPER, width: 1.2 }];
  }
}

// 스티커 뒷면: 모든 모양을 굵은 흰 선으로 한 번 더 그려 테두리를 만들고, 그 아래에 그림자를 깐다.
function stickerBacking(shapes: Shape[]): DrawOp[] {
  const backing = (color: string, dy?: number) =>
    shapes
      .filter((shape) => shape.kind !== 'shine')
      .map((shape): DrawOp => {
        const width = (shape.kind === 'line' ? LINE_WIDTH : 0) + STICKER_MARGIN * 2;
        return { d: shape.d, fill: shape.kind === 'line' ? undefined : color, stroke: color, width, dy };
      });
  return [...backing(STICKER_SHADOW, 0.9), ...backing(PAPER)];
}

/** 그림 세트로 그린 두들 하나 */
export function doodleOps(style: DoodleStyle, id: DoodleId): DrawOp[] {
  const art = DOODLE_ART[id];
  if (style === 'pastel') return art.shapes.flatMap((shape) => paint(shape, art));
  return [...stickerBacking(art.shapes), ...art.shapes.flatMap((shape) => paint(shape, art, INK))];
}

/** '#RRGGBB' 두 색을 섞는다. amount가 1이면 b */
function mix(a: string, b: string, amount: number) {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const value = [0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * amount));
  return `#${value.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function chipFill(style: DoodleStyle, id: DoodleId) {
  return style === 'pastel' ? mix(TONES[DOODLE_ART[id].tone].deep, PAPER, PASTEL_CHIP_WHITE) : STICKER_CHIP;
}

export type DoodleArtEntry = { id: DoodleId; ops: DrawOp[]; chipFill: string };

const artByStyle = new Map<DoodleStyle, DoodleArtEntry[]>();

/** 편집기에 넘기는 그림 세트 전체(그림과 칩 색). 같은 세트는 같은 배열을 돌려준다. */
export function doodleArt(style: DoodleStyle) {
  let art = artByStyle.get(style);
  if (!art) {
    art = DOODLE_IDS.map((id) => ({ id, ops: doodleOps(style, id), chipFill: chipFill(style, id) }));
    artByStyle.set(style, art);
  }
  return art;
}
