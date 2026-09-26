import type { DoodleId } from './catalog';

// 두들 그림의 모양. 24x24 격자 위에 한 번만 그리고, 그림 세트(presets.ts)마다 칠하는 방법만 다르다.
// 경로는 절대 좌표의 M·L·C·Q·Z만 쓴다. (나중에 네이티브 편집기가 작은 해석기로 그대로 그릴 수 있게)

export type Tone =
  | 'cream'
  | 'butter'
  | 'orange'
  | 'peach'
  | 'coral'
  | 'pink'
  | 'lavender'
  | 'sky'
  | 'mint'
  | 'latte'
  | 'brown'
  | 'gray'
  | 'dark'
  | 'white';

// fill은 파스텔 면, deep은 같은 색의 짙은 선
export const TONES: Record<Tone, { fill: string; deep: string }> = {
  cream: { fill: '#FFF5DE', deep: '#C99A55' },
  butter: { fill: '#FFE68F', deep: '#D99A0B' },
  orange: { fill: '#FFD19A', deep: '#E0801C' },
  peach: { fill: '#FFCDB2', deep: '#DB7449' },
  coral: { fill: '#FFB3A7', deep: '#DE5646' },
  pink: { fill: '#FFC8DA', deep: '#DD5686' },
  lavender: { fill: '#DCD3FF', deep: '#7A64D6' },
  sky: { fill: '#C3E2FF', deep: '#3B88D8' },
  mint: { fill: '#BDEBCF', deep: '#2F9E66' },
  latte: { fill: '#EDD3B6', deep: '#A06C40' },
  brown: { fill: '#CFA27B', deep: '#86552E' },
  gray: { fill: '#E2E5EB', deep: '#79808D' },
  dark: { fill: '#4C4C57', deep: '#34343C' },
  white: { fill: '#FFFFFF', deep: '#8F95A3' },
};

/**
 * body: 면으로 칠하고 테두리를 두르는 닫힌 모양
 * line: 선으로만 긋는 모양 (김, 손잡이, 무늬)
 * dot: 선 색으로 채우는 작은 점 (눈, 단추)
 * shine: 흰 반짝임
 */
export type Shape = {
  d: string;
  kind: 'body' | 'line' | 'dot' | 'shine';
  tone?: Tone;
};

export type DoodleArt = {
  tone: Tone;
  shapes: Shape[];
};

type Point = [number, number];
type Options = { tone?: Tone };

const body = (d: string, options: Options = {}): Shape => ({ d, kind: 'body', ...options });
const line = (d: string, options: Options = {}): Shape => ({ d, kind: 'line', ...options });
const dot = (d: string, options: Options = {}): Shape => ({ d, kind: 'dot', ...options });
const shine = (d: string): Shape => ({ d, kind: 'shine' });

const num = (value: number) => String(Math.round(value * 100) / 100);

/** 경로의 모든 점을 옮긴다. (M·L·C·Q의 숫자는 모두 x, y 쌍이다) */
export function mapPoints(d: string, fn: (point: Point) => Point): string {
  const tokens = d.match(/[MLCQZ]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  let pending: number | null = null;
  for (const token of tokens) {
    if (/[MLCQZ]/.test(token)) {
      out.push(token);
    } else if (pending === null) {
      pending = Number(token);
    } else {
      const [x, y] = fn([pending, Number(token)]);
      out.push(`${num(x)} ${num(y)}`);
      pending = null;
    }
  }
  return out.join(' ').replace(/([MLCQZ]) /g, '$1');
}

const rotate = (d: string, degrees: number, cx = 12, cy = 12) => {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return mapPoints(d, ([x, y]) => [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos]);
};

const mirror = (d: string, axis = 12) => mapPoints(d, ([x, y]) => [2 * axis - x, y]);

// 원호를 3차 베지어로 (0.1도 단위 오차는 보이지 않는다)
function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number, move = false): string {
  const segments = Math.max(1, Math.ceil(Math.abs(toDeg - fromDeg) / 90));
  const step = ((toDeg - fromDeg) / segments) * (Math.PI / 180);
  const k = (4 / 3) * Math.tan(step / 4);
  let a = (fromDeg * Math.PI) / 180;
  const at = (angle: number): Point => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  const [sx, sy] = at(a);
  let d = move ? `M${num(sx)} ${num(sy)}` : '';
  for (let i = 0; i < segments; i++) {
    const b = a + step;
    const [x1, y1] = at(a);
    const [x2, y2] = at(b);
    d += `C${num(x1 - k * r * Math.sin(a))} ${num(y1 + k * r * Math.cos(a))} ${num(x2 + k * r * Math.sin(b))} ${num(y2 - k * r * Math.cos(b))} ${num(x2)} ${num(y2)}`;
    a = b;
  }
  return d;
}

const circle = (cx: number, cy: number, r: number) => `${arc(cx, cy, r, 180, 540, true)}Z`;

function ellipse(cx: number, cy: number, rx: number, ry: number, degrees = 0) {
  const unit = circle(0, 0, 1);
  return rotate(
    mapPoints(unit, ([x, y]) => [cx + x * rx, cy + y * ry]),
    degrees,
    cx,
    cy,
  );
}

function rect(x: number, y: number, w: number, h: number, r = 0) {
  if (r === 0) return `M${x} ${y}L${num(x + w)} ${y}L${num(x + w)} ${num(y + h)}L${x} ${num(y + h)}Z`;
  const k = r * 0.4477; // 반지름 가운데 제어점까지 남는 거리 (1 - 0.5523)
  const [r1, b1] = [x + w, y + h];
  return [
    `M${num(x + r)} ${y}`,
    `L${num(r1 - r)} ${y}`,
    `C${num(r1 - k)} ${y} ${num(r1)} ${num(y + k)} ${num(r1)} ${num(y + r)}`,
    `L${num(r1)} ${num(b1 - r)}`,
    `C${num(r1)} ${num(b1 - k)} ${num(r1 - k)} ${num(b1)} ${num(r1 - r)} ${num(b1)}`,
    `L${num(x + r)} ${num(b1)}`,
    `C${num(x + k)} ${num(b1)} ${x} ${num(b1 - k)} ${x} ${num(b1 - r)}`,
    `L${x} ${num(y + r)}`,
    `C${x} ${num(y + k)} ${num(x + k)} ${y} ${num(x + r)} ${y}Z`,
  ].join('');
}

const polygon = (points: Point[]) => `M${points.map(([x, y]) => `${num(x)} ${num(y)}`).join('L')}Z`;

// 너비 16.4, 가운데 (12, 12.6)인 하트를 옮기고 줄인다.
const HEART =
  'M12 20.2C9.4 18.2 3.8 14.6 3.8 9.6C3.8 7 5.8 5 8.3 5C9.9 5 11.2 5.8 12 7.1C12.8 5.8 14.1 5 15.7 5C18.2 5 20.2 7 20.2 9.6C20.2 14.6 14.6 18.2 12 20.2Z';
const heart = (cx: number, cy: number, width: number) =>
  mapPoints(HEART, ([x, y]) => [cx + ((x - 12) * width) / 16.4, cy + ((y - 12.6) * width) / 16.4]);

// 높이 3, 가운데 (0, 0)인 물방울
const DROP = 'M0 -1.6C0.6 -0.7 1 -0.1 1 0.45C1 1.05 0.55 1.45 0 1.45C-0.55 1.45 -1 1.05 -1 0.45C-1 -0.1 -0.6 -0.7 0 -1.6Z';
const drop = (cx: number, cy: number, scale = 1) => mapPoints(DROP, ([x, y]) => [cx + x * scale, cy + y * scale]);

function star(cx: number, cy: number, outer: number, inner: number, points = 5) {
  const vertices: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    vertices.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(vertices);
}

// 네 갈래 반짝임
const sparkle = (cx: number, cy: number, r: number) =>
  `M${num(cx)} ${num(cy - r)}Q${num(cx + r * 0.18)} ${num(cy - r * 0.18)} ${num(cx + r)} ${num(cy)}Q${num(cx + r * 0.18)} ${num(cy + r * 0.18)} ${num(cx)} ${num(cy + r)}Q${num(cx - r * 0.18)} ${num(cy + r * 0.18)} ${num(cx - r)} ${num(cy)}Q${num(cx - r * 0.18)} ${num(cy - r * 0.18)} ${num(cx)} ${num(cy - r)}Z`;

// 초승달: 큰 원에서 오른쪽 위로 비킨 원을 뺀 모양
function crescent() {
  const [c1x, c1y, r1] = [11.5, 12.5, 7.6];
  const [c2x, c2y, r2] = [15.4, 9.2, 6.3];
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(r1 * r1 - a * a);
  const [px, py] = [c1x + (a * dx) / d, c1y + (a * dy) / d];
  const top: Point = [px + (h * dy) / d, py - (h * dx) / d];
  const bottom: Point = [px - (h * dy) / d, py + (h * dx) / d];
  const angle = (cx: number, cy: number, [x, y]: Point) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
  let outerFrom = angle(c1x, c1y, top);
  const outerTo = angle(c1x, c1y, bottom);
  if (outerFrom < outerTo) outerFrom += 360;
  let innerTo = angle(c2x, c2y, top);
  const innerFrom = angle(c2x, c2y, bottom);
  if (innerTo < innerFrom) innerTo += 360;
  return `M${num(top[0])} ${num(top[1])}${arc(c1x, c1y, r1, outerFrom, outerTo)}${arc(c2x, c2y, r2, innerFrom, innerTo)}Z`;
}

function pencil() {
  const parts = [
    body('M2 12L7.1 9.6L7.1 14.4Z', { tone: 'cream' }),
    dot('M2 12L4.3 10.9L4.3 13.1Z'),
    body('M7.1 9.6L16.3 9.6L16.3 14.4L7.1 14.4Z'),
    line('M7.1 12L16.3 12'),
    body('M16.3 9.6L18.6 9.6L18.6 14.4L16.3 14.4Z', { tone: 'gray' }),
    body('M18.6 9.6L20.4 9.6C21.3 9.6 22 10.3 22 11.2L22 12.8C22 13.7 21.3 14.4 20.4 14.4L18.6 14.4Z', { tone: 'pink' }),
  ];
  return parts.map((shape) => ({ ...shape, d: rotate(shape.d, -45) }));
}

function broom() {
  const parts = [
    body(rect(11.1, 1.2, 1.8, 10, 0.9), { tone: 'latte' }),
    body('M9.3 12.4L14.7 12.4L16.9 20.3C17.1 21 16.6 21.6 15.9 21.6L8.1 21.6C7.4 21.6 6.9 21 7.1 20.3Z'),
    line('M10.4 15L9.8 20.2M12 15L12 20.2M13.6 15L14.2 20.2'),
    body(rect(9, 10.6, 6, 2.2, 0.8), { tone: 'coral' }),
  ];
  return parts.map((shape) => ({ ...shape, d: rotate(shape.d, 32) }));
}

// from에서 to까지 control 쪽으로 휜 굵은 관 (청소기 호스). 두 끝은 다른 모양 밑에 숨긴다.
function tube(from: Point, control: Point, to: Point, width: number) {
  const point = ([x, y]: Point) => `${num(x)} ${num(y)}`;
  const side = (sign: number) => {
    const normal = ([x0, y0]: Point, [x1, y1]: Point): Point => {
      const length = Math.hypot(x1 - x0, y1 - y0);
      return [(((y0 - y1) / length) * sign * width) / 2, (((x1 - x0) / length) * sign * width) / 2];
    };
    const [n0, n2] = [normal(from, control), normal(control, to)];
    const a: Point = [from[0] + n0[0], from[1] + n0[1]];
    const b: Point = [to[0] + n2[0], to[1] + n2[1]];
    // 두 끝의 접선을 옆으로 옮긴 두 직선이 만나는 곳이 새 조절점이다.
    const [d0x, d0y] = [control[0] - from[0], control[1] - from[1]];
    const [d2x, d2y] = [to[0] - control[0], to[1] - control[1]];
    const t = ((b[0] - a[0]) * d2y - (b[1] - a[1]) * d2x) / (d0x * d2y - d0y * d2x);
    return [a, [a[0] + d0x * t, a[1] + d0y * t] as Point, b];
  };
  const [a1, c1, b1] = side(1);
  const [a2, c2, b2] = side(-1);
  return `M${point(a1)}Q${point(c1)} ${point(b1)}L${point(b2)}Q${point(c2)} ${point(a2)}Z`;
}

// 가운데가 가장 굵은 가늘고 긴 날 (가위)
function blade(from: Point, to: Point, width: number) {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const length = Math.hypot(dx, dy);
  const [nx, ny] = [(-dy / length) * width, (dx / length) * width];
  const [mx, my] = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return `M${num(from[0])} ${num(from[1])}Q${num(mx + nx)} ${num(my + ny)} ${num(to[0])} ${num(to[1])}Q${num(mx - nx)} ${num(my - ny)} ${num(from[0])} ${num(from[1])}Z`;
}

function toothbrush() {
  const parts = [
    body(rect(13.6, 8.6, 7.8, 4.4, 0.6), { tone: 'white' }),
    line('M15.6 9.2L15.6 12.4M17.5 9.2L17.5 12.4M19.4 9.2L19.4 12.4', { tone: 'white' }),
    body('M13.4 8.8C13.2 7.4 14.4 6.4 15.6 6.9C16.3 5.7 18.1 5.7 18.7 6.9C19.9 6.2 21.5 7.2 21.5 8.8Z', { tone: 'mint' }),
    body(rect(2, 12.8, 20, 3, 1.5)),
  ];
  return parts.map((shape) => ({ ...shape, d: rotate(shape.d, -40) }));
}

function key() {
  const parts = [
    body(
      'M9.6 10.9L20.5 10.9C21 10.9 21.4 11.3 21.4 11.8L21.4 15.2C21.4 15.7 21 16.1 20.5 16.1L19.9 16.1C19.4 16.1 19 15.7 19 15.2L19 13.1L17.9 13.1L17.9 14.5C17.9 15 17.5 15.4 17 15.4L16.6 15.4C16.1 15.4 15.7 15 15.7 14.5L15.7 13.1L9.6 13.1Z',
    ),
    body(circle(6.4, 12, 4.2)),
    line(circle(5.6, 12, 1.4)),
  ];
  return parts.map((shape) => ({ ...shape, d: rotate(shape.d, -45) }));
}

function scissors() {
  const [left, right]: Point[] = [
    [7.4, 17.6],
    [16.6, 17.6],
  ];
  return [
    body(blade(left, [16.8, 2.6], 3.4), { tone: 'gray' }),
    body(blade(right, [7.2, 2.6], 3.4), { tone: 'gray' }),
    dot(circle(12, 10.2, 0.75), { tone: 'gray' }),
    body(`${circle(left[0], left[1], 3.3)}${circle(right[0], right[1], 3.3)}`),
    body(`${circle(left[0], left[1], 1.7)}${circle(right[0], right[1], 1.7)}`, { tone: 'white' }),
  ];
}

// 볼이 볼록한 햄스터 머리. 흰 얼굴 위에 주황 머리털을 칠한 뒤 테두리를 다시 긋는다.
const HAMSTER =
  'M12 5.4C15.6 5.4 18 7.6 18.6 10.4C20.4 11.4 21.2 13.4 20.8 15.6C20.2 18.8 16.8 20.8 12 20.8C7.2 20.8 3.8 18.8 3.2 15.6C2.8 13.4 3.6 11.4 5.4 10.4C6 7.6 8.4 5.4 12 5.4Z';

export const DOODLE_ART: Record<DoodleId, DoodleArt> = {
  coffee: {
    tone: 'cream',
    shapes: [
      line('M9.2 5.9Q8.4 5 9.2 4.1Q10 3.2 9.2 2.3M12.9 5.9Q12.1 5 12.9 4.1Q13.7 3.2 12.9 2.3'),
      line('M16.9 11.4C19.1 11.2 20.5 12.3 20.5 14C20.5 15.8 19 17 16.4 16.9'),
      body('M5 9C5 8 7.7 7.2 11 7.2C14.3 7.2 17 8 17 9L16.2 17.3C16 19.5 14.1 21 11.9 21L10.1 21C7.9 21 6 19.5 5.8 17.3Z'),
      body(ellipse(11, 9, 5.1, 1.25), { tone: 'latte' }),
    ],
  },
  meal: {
    tone: 'sky',
    shapes: [
      line('M13.4 9.4L20.4 3.2M15.2 10.3L21.4 4.9', { tone: 'latte' }),
      body('M5.2 12C5.2 8.9 8.2 6.8 12 6.8C15.8 6.8 18.8 8.9 18.8 12Z', { tone: 'white' }),
      line('M8.7 9.9L9.3 9.5M11.3 8.7L11.9 8.5M14.4 9.6L14.9 10'),
      body('M9.4 19.6L14.6 19.6L14.2 21.2C14.15 21.45 13.95 21.6 13.7 21.6L10.3 21.6C10.05 21.6 9.85 21.45 9.8 21.2Z'),
      body('M3.8 11.8L20.2 11.8C20.2 16.4 16.6 20.1 12 20.1C7.4 20.1 3.8 16.4 3.8 11.8Z'),
    ],
  },
  cake: {
    tone: 'cream',
    shapes: [
      body(rect(11, 6.2, 2, 4.8, 0.5), { tone: 'sky' }),
      body('M12 2.5C12.9 3.6 13.4 4.3 13.4 4.95C13.4 5.75 12.8 6.4 12 6.4C11.2 6.4 10.6 5.75 10.6 4.95C10.6 4.3 11.1 3.6 12 2.5Z', {
        tone: 'butter',
      }),
      body('M5 13.2L19 13.2L19 19.3C19 20.25 18.25 21 17.3 21L6.7 21C5.75 21 5 20.25 5 19.3Z'),
      body(
        'M5 14.2L5 12.6C5 11.5 5.9 10.6 7 10.6L17 10.6C18.1 10.6 19 11.5 19 12.6L19 14.2Q17.25 15.9 15.5 14.2Q13.75 15.9 12 14.2Q10.25 15.9 8.5 14.2Q6.75 15.9 5 14.2Z',
        { tone: 'pink' },
      ),
    ],
  },
  bread: {
    tone: 'latte',
    shapes: [
      body(
        'M6.6 20.5L6.6 11.6C4.9 11.1 4 9.9 4 8.5C4 5.9 6.9 3.9 12 3.9C17.1 3.9 20 5.9 20 8.5C20 9.9 19.1 11.1 17.4 11.6L17.4 20.5C17.4 21.05 16.95 21.5 16.4 21.5L7.6 21.5C7.05 21.5 6.6 21.05 6.6 20.5Z',
      ),
      body(
        'M8.2 19.9L8.2 10.5C6.6 10.1 5.7 9.3 5.7 8.4C5.7 6.7 8.2 5.5 12 5.5C15.8 5.5 18.3 6.7 18.3 8.4C18.3 9.3 17.4 10.1 15.8 10.5L15.8 19.9Z',
        { tone: 'cream' },
      ),
    ],
  },
  fruit: {
    tone: 'coral',
    shapes: [
      line('M12 8.4C12 6.8 12.3 5.4 13 4.2', { tone: 'brown' }),
      body('M13.1 5.9C13.7 4.3 15.2 3.5 17.3 3.7C17 5.6 15.3 6.5 13.1 5.9Z', { tone: 'mint' }),
      body(
        'M12 8.4C10.9 7.4 9.5 7 8.1 7.3C5.5 7.9 4.2 10.4 4.5 13.2C4.9 17.1 7.5 20.7 10 20.7C10.8 20.7 11.3 20.3 12 20.3C12.7 20.3 13.2 20.7 14 20.7C16.5 20.7 19.1 17.1 19.5 13.2C19.8 10.4 18.5 7.9 15.9 7.3C14.5 7 13.1 7.4 12 8.4Z',
      ),
      shine('M7.2 13C7.2 11.6 7.8 10.5 8.8 10'),
    ],
  },
  milk: {
    tone: 'sky',
    shapes: [
      body(rect(8.7, 3.8, 6.6, 2.6, 0.6)),
      body('M6.5 10.2L9 6.3L15 6.3L17.5 10.2Z'),
      body('M6.5 10.2L17.5 10.2L17.5 20C17.5 20.55 17.05 21 16.5 21L7.5 21C6.95 21 6.5 20.55 6.5 20Z', { tone: 'white' }),
      body(
        'M6.5 16.4C8.3 15.4 10.2 15.4 12 16.4C13.8 17.4 15.7 17.4 17.5 16.4L17.5 20C17.5 20.55 17.05 21 16.5 21L7.5 21C6.95 21 6.5 20.55 6.5 20Z',
      ),
    ],
  },
  egg: {
    tone: 'white',
    shapes: [
      body(
        'M5.2 10.4C5.6 6.8 9 4.6 12.4 5.2C15.2 5.6 16.6 7.4 18.4 8.4C20.4 9.5 20.6 12.4 19.4 14.6C18.2 16.8 17.4 19.2 14.2 19.6C11.2 20 9.4 18.6 7.4 17.6C5.2 16.5 4.8 13.4 5.2 10.4Z',
      ),
      body(circle(12, 12.2, 3.7), { tone: 'butter' }),
      shine('M10.2 11.6C10.4 10.8 11 10.2 11.8 10'),
    ],
  },
  water: {
    tone: 'sky',
    shapes: [
      body('M12 3C14.9 6.5 18 10.1 18 14.2C18 17.9 15.3 20.8 12 20.8C8.7 20.8 6 17.9 6 14.2C6 10.1 9.1 6.5 12 3Z'),
      shine('M8.9 14.4C8.9 16.1 9.9 17.5 11.3 18'),
    ],
  },
  chicken: {
    tone: 'orange',
    shapes: [
      body(rotate(rect(10.9, 13.5, 7.4, 2.2, 1.1), 45, 14.6, 14.6), { tone: 'cream' }),
      body(circle(18.2, 16.5, 1.7), { tone: 'cream' }),
      body(circle(16.5, 18.2, 1.7), { tone: 'cream' }),
      body(ellipse(9.3, 9.3, 6.4, 5, 45)),
      line('M6.4 7.6Q7 7 7.7 7.2M5.9 10.3Q6.4 9.9 6.9 10.1'),
    ],
  },
  pizza: {
    tone: 'butter',
    shapes: [
      body('M4.6 6.6C9.6 3.9 14.4 3.9 19.4 6.6L12.9 20.1C12.5 20.9 11.5 20.9 11.1 20.1Z'),
      body('M4.6 6.6C9.6 3.9 14.4 3.9 19.4 6.6L18.5 8.5C14.2 6.3 9.8 6.3 5.5 8.5Z', { tone: 'latte' }),
      body(circle(9.9, 10.7, 1.35), { tone: 'coral' }),
      body(circle(14.2, 11, 1.2), { tone: 'coral' }),
      body(circle(12.1, 15.4, 1.1), { tone: 'coral' }),
    ],
  },
  beer: {
    tone: 'butter',
    shapes: [
      line('M15.8 11.3L16.8 11.3C18.4 11.3 19.4 12.3 19.4 13.9L19.4 15.2C19.4 16.8 18.4 17.8 16.8 17.8L15.8 17.8'),
      body('M5.8 9.4L15.8 9.4L15.8 19.1C15.8 20.2 14.9 21.1 13.8 21.1L7.8 21.1C6.7 21.1 5.8 20.2 5.8 19.1Z'),
      line(`${circle(9.1, 17.3, 0.6)}${circle(11.8, 14.6, 0.45)}${circle(12.6, 18.4, 0.45)}`),
      body(
        'M5.1 10C4.2 8.8 5 7 6.7 7.1C7.1 5.6 9 5 10.1 6C10.9 4.8 13 4.8 13.7 6.1C15.2 5.7 16.9 6.8 16.5 8.5C17 9.3 16.6 10.2 15.8 10.5L6 10.5C5.6 10.5 5.3 10.3 5.1 10Z',
        { tone: 'white' },
      ),
    ],
  },
  sun: {
    tone: 'butter',
    shapes: [
      line(
        Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return `M${num(12 + 7.6 * Math.cos(a))} ${num(12 + 7.6 * Math.sin(a))}L${num(12 + 9.6 * Math.cos(a))} ${num(12 + 9.6 * Math.sin(a))}`;
        }).join(''),
      ),
      body(circle(12, 12, 5.3)),
    ],
  },
  rain: {
    tone: 'coral',
    shapes: [
      line('M12 12.4L12 18.6C12 19.9 12.9 20.8 14.1 20.8C15.3 20.8 16.2 19.9 16.2 18.8', { tone: 'dark' }),
      line('M12 4.3L12 3.1'),
      body(
        'M3.4 12.4C3.4 7.7 7.3 4.3 12 4.3C16.7 4.3 20.6 7.7 20.6 12.4Q18.45 10.8 16.3 12.4Q14.15 10.8 12 12.4Q9.85 10.8 7.7 12.4Q5.55 10.8 3.4 12.4Z',
      ),
      line('M12 4.4Q9.1 7.6 7.7 12.1M12 4.4Q14.9 7.6 16.3 12.1'),
      body(drop(5, 16.6, 1.2), { tone: 'sky' }),
      body(drop(19.4, 16, 1.2), { tone: 'sky' }),
    ],
  },
  snow: {
    tone: 'white',
    shapes: [
      body(circle(12, 16.3, 4.9)),
      body(circle(12, 8.7, 3.8)),
      body('M13.6 12.9L14.3 15.8L15.9 15.3L15.3 12.5Z', { tone: 'coral' }),
      body('M8.5 11.3C10.7 12.3 13.3 12.3 15.5 11.3L16 12.7C13.4 13.8 10.6 13.8 8 12.7Z', { tone: 'coral' }),
      dot(`${circle(10.6, 8.3, 0.62)}${circle(13.4, 8.3, 0.62)}${circle(12, 15.8, 0.6)}${circle(12, 18.1, 0.6)}`),
      body('M12 9.3L14.6 9.95L12 10.6Z', { tone: 'orange' }),
    ],
  },
  moon: {
    tone: 'butter',
    shapes: [
      body(crescent()),
      line('M15.8 3.4L18.4 3.4L15.8 6L18.4 6M19.3 8.2L20.9 8.2L19.3 9.8L20.9 9.8', { tone: 'lavender' }),
    ],
  },
  star: {
    tone: 'butter',
    shapes: [body(star(12, 12.8, 9.2, 4.5))],
  },
  flower: {
    tone: 'pink',
    shapes: [
      line('M12 16.2L12 21.3', { tone: 'mint' }),
      body('M12 19.8C10.6 17.6 8.4 17 6.6 17.6C7.4 19.6 9.6 20.6 12 19.8Z', { tone: 'mint' }),
      body('M12 18.6C13.4 16.4 15.6 15.8 17.4 16.4C16.6 18.4 14.4 19.4 12 18.6Z', { tone: 'mint' }),
      body('M6.8 6.9L9.4 8.9L12 5.6L14.6 8.9L17.2 6.9L17.2 11.6C17.2 14.5 14.9 16.4 12 16.4C9.1 16.4 6.8 14.5 6.8 11.6Z'),
    ],
  },
  plant: {
    tone: 'peach',
    shapes: [
      line('M12 12.2L12 8.2', { tone: 'mint' }),
      body('M12 9.4C11.5 6.8 9.4 5.3 6.6 5.6C6.9 8.3 9.1 9.8 12 9.4Z', { tone: 'mint' }),
      body('M12 8.6C12.5 6 14.6 4.5 17.4 4.8C17.1 7.5 14.9 9 12 8.6Z', { tone: 'mint' }),
      body('M7.2 13.8L16.8 13.8L15.7 20.1C15.6 20.7 15.1 21.1 14.5 21.1L9.5 21.1C8.9 21.1 8.4 20.7 8.3 20.1Z'),
      body(rect(6.3, 11.9, 11.4, 2.5, 0.9)),
    ],
  },
  mountain: {
    tone: 'mint',
    shapes: [
      body('M11.2 20.4L16.2 9.2C16.6 8.4 17.6 8.4 18 9.2L21.9 18.6C22.3 19.5 21.8 20.4 20.9 20.4Z', { tone: 'sky' }),
      body('M3.3 20.4C2.4 20.4 1.9 19.5 2.3 18.7L9.8 5.8C10.3 5 11.4 5 11.9 5.8L19.4 18.7C19.8 19.5 19.3 20.4 18.4 20.4Z'),
      body('M7.42 9.9L9.8 5.8C10.3 5 11.4 5 11.9 5.8L14.28 9.9L12.6 9L10.85 10.3L9.1 9Z', { tone: 'white' }),
    ],
  },
  cat: {
    tone: 'orange',
    shapes: [
      body(
        'M5.1 9.2L5.5 4.3C5.6 3.6 6.4 3.3 6.9 3.8L10 6.5C11.3 6.2 12.7 6.2 14 6.5L17.1 3.8C17.6 3.3 18.4 3.6 18.5 4.3L18.9 9.2C20 10.6 20.6 12.2 20.6 13.8C20.6 17.9 16.8 20.6 12 20.6C7.2 20.6 3.4 17.9 3.4 13.8C3.4 12.2 4 10.6 5.1 9.2Z',
      ),
      body('M6.6 5.5L8.8 7.4L6.5 8.7Z', { tone: 'pink' }),
      body(mirror('M6.6 5.5L8.8 7.4L6.5 8.7Z'), { tone: 'pink' }),
      line('M12 7L12 8.5M10.3 7.3L10.6 8.5M13.7 7.3L13.4 8.5'),
      dot(`${circle(9.2, 13, 0.95)}${circle(14.8, 13, 0.95)}`),
      body('M11.2 14.5L12.8 14.5L12 15.4Z', { tone: 'pink' }),
      line('M10.6 15.8Q11.3 16.8 12 15.9Q12.7 16.8 13.4 15.8M4.8 14.1L7.4 14.5M5 16.3L7.5 15.8M19.2 14.1L16.6 14.5M19 16.3L16.5 15.8'),
    ],
  },
  dog: {
    tone: 'latte',
    shapes: [
      body('M12 5.4C16.3 5.4 19 8.4 19 12.7C19 17.3 15.9 20.6 12 20.6C8.1 20.6 5 17.3 5 12.7C5 8.4 7.7 5.4 12 5.4Z'),
      body(ellipse(14.9, 10.9, 2.3, 2), { tone: 'brown' }),
      body('M7.2 6.6C5.2 5.4 2.9 6.1 2.7 8.6C2.5 11.2 3.9 14 5.6 14.4C6.6 14.6 7 13.3 6.8 11.8Z', { tone: 'brown' }),
      body(mirror('M7.2 6.6C5.2 5.4 2.9 6.1 2.7 8.6C2.5 11.2 3.9 14 5.6 14.4C6.6 14.6 7 13.3 6.8 11.8Z'), {
        tone: 'brown',
      }),
      body(ellipse(12, 16, 3.5, 2.7), { tone: 'white' }),
      dot(`${ellipse(12, 14.5, 1.3, 0.9)}${circle(9.3, 11.4, 0.95)}${circle(14.7, 11.4, 0.95)}`),
      line('M12 15.4L12 16.3M10.7 16.6Q11.35 17.4 12 16.3Q12.65 17.4 13.3 16.6'),
    ],
  },
  rabbit: {
    tone: 'pink',
    shapes: [
      body(ellipse(8.9, 6.9, 2.5, 5.2, -12), { tone: 'white' }),
      body(ellipse(15.1, 6.9, 2.5, 5.2, 12), { tone: 'white' }),
      body(ellipse(8.9, 7.4, 1.1, 3.4, -12)),
      body(ellipse(15.1, 7.4, 1.1, 3.4, 12)),
      body('M12 9.8C16.5 9.8 19.8 12.5 19.8 16C19.8 19.2 16.5 21.2 12 21.2C7.5 21.2 4.2 19.2 4.2 16C4.2 12.5 7.5 9.8 12 9.8Z', {
        tone: 'white',
      }),
      dot(`${circle(9, 15.2, 0.95)}${circle(15, 15.2, 0.95)}`),
      body('M11.2 16.5L12.8 16.5L12 17.4Z'),
      line('M12 17.4L12 18.1M10.9 18.5Q11.45 19.1 12 18.1Q12.55 19.1 13.1 18.5'),
    ],
  },
  bear: {
    tone: 'brown',
    shapes: [
      body(`${circle(6.2, 7.2, 3)}${circle(17.8, 7.2, 3)}`),
      body(`${circle(6.2, 7.2, 1.5)}${circle(17.8, 7.2, 1.5)}`, { tone: 'latte' }),
      body(ellipse(12, 13.6, 8.2, 7.2)),
      body(ellipse(12, 16.4, 3.7, 2.8), { tone: 'cream' }),
      dot(`${ellipse(12, 15.1, 1.3, 0.9)}${circle(8.6, 12.3, 0.95)}${circle(15.4, 12.3, 0.95)}`),
      line('M12 16L12 16.9M10.8 17.4Q11.4 18 12 16.9Q12.6 18 13.2 17.4'),
    ],
  },
  pig: {
    tone: 'pink',
    shapes: [
      body('M5.3 9.2C4.8 7.6 4.8 5.6 5.6 4.5C6 4 6.6 4 7.1 4.3L10.6 6.8Z'),
      body(mirror('M5.3 9.2C4.8 7.6 4.8 5.6 5.6 4.5C6 4 6.6 4 7.1 4.3L10.6 6.8Z')),
      body('M6.2 7.6C6 6.8 6.1 6 6.4 5.6L8.4 6.9Z', { tone: 'coral' }),
      body(mirror('M6.2 7.6C6 6.8 6.1 6 6.4 5.6L8.4 6.9Z'), { tone: 'coral' }),
      body(ellipse(12, 13.4, 8.4, 7.4)),
      body(ellipse(12, 15.6, 3.8, 2.7)),
      dot(`${ellipse(10.7, 15.6, 0.62, 0.95)}${ellipse(13.3, 15.6, 0.62, 0.95)}${circle(8.4, 11.8, 0.95)}${circle(15.6, 11.8, 0.95)}`),
    ],
  },
  hamster: {
    tone: 'peach',
    shapes: [
      body(`${circle(6.9, 7, 2.2)}${circle(17.1, 7, 2.2)}`),
      body(`${circle(6.9, 7, 1.05)}${circle(17.1, 7, 1.05)}`, { tone: 'pink' }),
      body(HAMSTER, { tone: 'white' }),
      body(
        'M5.4 10.4C6 7.6 8.4 5.4 12 5.4C15.6 5.4 18 7.6 18.6 10.4C16.8 10.2 14.6 10.2 13.4 11.2C12.8 11.7 12.4 12.6 12 12.6C11.6 12.6 11.2 11.7 10.6 11.2C9.4 10.2 7.2 10.2 5.4 10.4Z',
      ),
      line(HAMSTER),
      dot(`${circle(8.6, 12.8, 0.95)}${circle(15.4, 12.8, 0.95)}`),
      body(ellipse(12, 14.6, 0.95, 0.7), { tone: 'pink' }),
      line('M12 15.3L12 16.1M10.8 16.6Q11.4 17.2 12 16.1Q12.6 17.2 13.2 16.6'),
    ],
  },
  panda: {
    tone: 'white',
    shapes: [
      body(`${circle(6.2, 7.2, 2.9)}${circle(17.8, 7.2, 2.9)}`, { tone: 'dark' }),
      body(ellipse(12, 13.6, 8.2, 7.3)),
      body(ellipse(8.7, 12.9, 1.9, 2.5, 35), { tone: 'dark' }),
      body(ellipse(15.3, 12.9, 1.9, 2.5, -35), { tone: 'dark' }),
      shine(`${circle(9, 12.5, 0.25)}${circle(15, 12.5, 0.25)}`),
      dot(ellipse(12, 15.8, 1.3, 0.9), { tone: 'dark' }),
      line('M12 16.7L12 17.5M10.8 18Q11.4 18.6 12 17.5Q12.6 18.6 13.2 18', { tone: 'dark' }),
    ],
  },
  chick: {
    tone: 'butter',
    shapes: [
      line('M10.2 19.4L10.2 21.2M13.8 19.4L13.8 21.2M9.2 21.2L11.2 21.2M12.8 21.2L14.8 21.2', { tone: 'orange' }),
      body(ellipse(5.2, 14.2, 1.6, 2.6, 30)),
      body(ellipse(18.8, 14.2, 1.6, 2.6, -30)),
      line('M11.4 5.6C11 4.2 11.6 3.1 12.8 3M12 5.6C12.4 4.6 13.3 4.2 14.2 4.5'),
      body(circle(12, 12.8, 7.4)),
      dot(`${circle(9.4, 11.6, 0.95)}${circle(14.6, 11.6, 0.95)}`),
      body('M10.5 13.3L12 12.3L13.5 13.3L12 14.5Z', { tone: 'orange' }),
    ],
  },
  penguin: {
    tone: 'sky',
    shapes: [
      body(`${ellipse(9.4, 20.5, 2, 1.1)}${ellipse(14.6, 20.5, 2, 1.1)}`, { tone: 'orange' }),
      body(ellipse(5.3, 14.2, 1.5, 3.3, 25)),
      body(ellipse(18.7, 14.2, 1.5, 3.3, -25)),
      body('M12 3.2C16.1 3.2 18.4 6.6 18.4 11.2L18.4 15.4C18.4 18.6 15.6 20.6 12 20.6C8.4 20.6 5.6 18.6 5.6 15.4L5.6 11.2C5.6 6.6 7.9 3.2 12 3.2Z'),
      body(
        'M12 7.4C12.8 6.4 14.6 6.3 15.5 7.5C16.4 8.7 16.8 10.4 16.8 12.2L16.8 15.3C16.8 17.6 14.8 19.2 12 19.2C9.2 19.2 7.2 17.6 7.2 15.3L7.2 12.2C7.2 10.4 7.6 8.7 8.5 7.5C9.4 6.3 11.2 6.4 12 7.4Z',
        { tone: 'white' },
      ),
      dot(`${circle(10, 10.6, 0.95)}${circle(14, 10.6, 0.95)}`),
      body('M10.8 12.2L13.2 12.2L12 13.6Z', { tone: 'orange' }),
    ],
  },
  fish: {
    tone: 'orange',
    shapes: [
      body('M9.6 8.2C10.2 6.2 12.2 5.2 14.2 5.8C14.2 7 13.6 8 12.8 8.6Z'),
      body('M15.8 13L20.4 9.1C21 8.6 21.8 9.1 21.6 9.8L21 13L21.6 16.2C21.8 16.9 21 17.4 20.4 16.9Z'),
      body('M2.8 13C4.6 9.6 7.8 7.6 11.2 7.6C14.2 7.6 16.6 9.8 17.8 13C16.6 16.2 14.2 18.4 11.2 18.4C7.8 18.4 4.6 16.4 2.8 13Z'),
      dot(circle(6.8, 12.2, 0.95)),
      line('M10.2 10Q11.4 13 10.2 16'),
      line(`${circle(3.2, 8.4, 0.95)}${circle(4.8, 5.6, 0.6)}`, { tone: 'sky' }),
    ],
  },
  turtle: {
    tone: 'mint',
    shapes: [
      body(`${ellipse(7.8, 17, 1.8, 2.3)}${ellipse(16.8, 17, 1.8, 2.3)}`),
      body('M19.6 14.4L21.8 15.4L19.6 16.4Z'),
      body(ellipse(4.7, 11.4, 3, 2.7)),
      body('M5.2 15.6C5.2 10.4 8.4 6.6 12.8 6.6C17.2 6.6 20.4 10.4 20.4 15.6Z', { tone: 'latte' }),
      line('M10.6 9.6L15 9.6L16.2 12.3L15 15M10.6 9.6L9.4 12.3L10.6 15', { tone: 'latte' }),
      body(rect(4.4, 14.8, 16.8, 2, 1), { tone: 'latte' }),
      dot(circle(3.8, 10.8, 0.85)),
      line('M2.5 12.6Q3.1 13.1 3.8 12.8'),
    ],
  },
  book: {
    tone: 'coral',
    shapes: [
      body('M2.8 7.2L21.2 7.2L21.2 19.9C17.9 19.5 14.8 20 12 21.2C9.2 20 6.1 19.5 2.8 19.9Z'),
      body('M12 7.2C10 5.8 7.2 5.2 4.2 5.6L4.2 18.3C7.2 17.9 10 18.4 12 19.8Z', { tone: 'white' }),
      body('M12 7.2C14 5.8 16.8 5.2 19.8 5.6L19.8 18.3C16.8 17.9 14 18.4 12 19.8Z', { tone: 'white' }),
      line(
        'M6.4 9.4C7.8 9.2 9.1 9.4 10.2 10M6.4 12.3C7.8 12.1 9.1 12.3 10.2 12.9M17.6 9.4C16.2 9.2 14.9 9.4 13.8 10M17.6 12.3C16.2 12.1 14.9 12.3 13.8 12.9',
      ),
    ],
  },
  pencil: {
    tone: 'butter',
    shapes: pencil(),
  },
  laptop: {
    tone: 'gray',
    shapes: [
      body(rect(4.8, 5, 14.4, 11, 1.5)),
      body(rect(6.3, 6.5, 11.4, 7.8, 0.7), { tone: 'sky' }),
      line('M8.4 8.9L11.4 8.9M8.4 11.3L14 11.3', { tone: 'sky' }),
      body('M2.8 16L21.2 16L20.4 18.2C20.2 18.7 19.7 19 19.2 19L4.8 19C4.3 19 3.8 18.7 3.6 18.2Z'),
      line('M10.4 17.5L13.6 17.5'),
    ],
  },
  phone: {
    tone: 'lavender',
    shapes: [
      line('M18.9 6.6C19.9 7.5 20.4 8.7 20.4 10M5.1 6.6C4.1 7.5 3.6 8.7 3.6 10'),
      body(rect(6.8, 3.1, 10.4, 17.8, 2.4)),
      body(rect(8.2, 5.4, 7.6, 12.2, 1), { tone: 'white' }),
      line('M10.9 4.25L13.1 4.25M10.7 19.3L13.3 19.3'),
      body(heart(12, 11.4, 4.4), { tone: 'pink' }),
    ],
  },
  mail: {
    tone: 'sky',
    shapes: [
      body(rect(3.4, 6.2, 17.2, 12.6, 1.8)),
      line('M3.9 7L10.6 12.3C11.4 12.9 12.6 12.9 13.4 12.3L20.1 7'),
      body(heart(12, 12.4, 3.6), { tone: 'pink' }),
    ],
  },
  chat: {
    tone: 'sky',
    shapes: [
      body(
        'M12.3 10.6L19 10.6C20.1 10.6 21 11.5 21 12.6L21 16.4C21 17.5 20.1 18.4 19 18.4L18.6 18.4L18.6 20.6L15.8 18.4L12.3 18.4C11.2 18.4 10.3 17.5 10.3 16.4L10.3 12.6C10.3 11.5 11.2 10.6 12.3 10.6Z',
        { tone: 'pink' },
      ),
      body(
        'M5.5 3.8L14.6 3.8C16 3.8 17.1 4.9 17.1 6.3L17.1 11.3C17.1 12.7 16 13.8 14.6 13.8L9.1 13.8L5.9 16.5L5.9 13.7C4.3 13.5 3 12.6 3 11.3L3 6.3C3 4.9 4.1 3.8 5.5 3.8Z',
      ),
      dot(`${circle(7, 8.8, 0.85)}${circle(10.05, 8.8, 0.85)}${circle(13.1, 8.8, 0.85)}`),
    ],
  },
  calendar: {
    tone: 'coral',
    shapes: [
      body(rect(3.8, 5.2, 16.4, 15.6, 2.2), { tone: 'white' }),
      body('M3.8 10L3.8 7.4C3.8 6.2 4.8 5.2 6 5.2L18 5.2C19.2 5.2 20.2 6.2 20.2 7.4L20.2 10Z'),
      line('M8.4 3.4L8.4 6.8M15.6 3.4L15.6 6.8', { tone: 'dark' }),
      dot(`${circle(7.6, 13.4, 0.85)}${circle(12, 13.4, 0.85)}${circle(16.4, 13.4, 0.85)}${circle(7.6, 17.2, 0.85)}${circle(12, 17.2, 0.85)}`, { tone: 'gray' }),
      body(heart(16.4, 17.3, 3.2), { tone: 'pink' }),
    ],
  },
  alarm: {
    tone: 'coral',
    shapes: [
      line('M7.4 18.6L6 20.6M16.6 18.6L18 20.6M12 6L12 4.5M10.6 4.3L13.4 4.3', { tone: 'dark' }),
      body('M4.6 8.3C3.8 7.1 4 5.4 5.2 4.5C6.4 3.6 8.1 3.8 9 4.9Z', { tone: 'butter' }),
      body(mirror('M4.6 8.3C3.8 7.1 4 5.4 5.2 4.5C6.4 3.6 8.1 3.8 9 4.9Z'), { tone: 'butter' }),
      body(circle(12, 13, 7)),
      body(circle(12, 13, 5.3), { tone: 'white' }),
      line('M12 13L12 9.9M12 13L14.3 14.3', { tone: 'dark' }),
    ],
  },
  gift: {
    tone: 'pink',
    shapes: [
      body('M12 7.6C10.7 5.1 8.2 4.1 7.1 5.4C6.1 6.7 8.3 7.9 12 7.6Z', { tone: 'butter' }),
      body('M12 7.6C13.3 5.1 15.8 4.1 16.9 5.4C17.9 6.7 15.7 7.9 12 7.6Z', { tone: 'butter' }),
      body(rect(4.6, 10.8, 14.8, 10, 1.3)),
      body(rect(3.6, 7.6, 16.8, 3.8, 1.2)),
      body(rect(10.8, 7.6, 2.4, 3.8), { tone: 'butter' }),
      body(rect(10.8, 11.4, 2.4, 9.4), { tone: 'butter' }),
    ],
  },
  package: {
    tone: 'latte',
    shapes: [
      body('M4 9.4L6.2 5.2L17.8 5.2L20 9.4Z'),
      body('M4 9.4L20 9.4L20 19.4C20 20.1 19.4 20.7 18.7 20.7L5.3 20.7C4.6 20.7 4 20.1 4 19.4Z'),
      body('M10.6 5.2L13.4 5.2L13.9 9.4L10.1 9.4Z', { tone: 'butter' }),
      body(rect(10.1, 9.4, 3.8, 3.4), { tone: 'butter' }),
    ],
  },
  shopping: {
    tone: 'mint',
    shapes: [
      body('M5.6 8.6L18.4 8.6L19.3 19.6C19.4 20.4 18.8 21.1 18 21.1L6 21.1C5.2 21.1 4.6 20.4 4.7 19.6Z'),
      line('M9 10.6L9 7.7C9 6 10.3 4.7 12 4.7C13.7 4.7 15 6 15 7.7L15 10.6', { tone: 'dark' }),
      dot(`${circle(9, 10.9, 0.7)}${circle(15, 10.9, 0.7)}`, { tone: 'dark' }),
    ],
  },
  money: {
    tone: 'butter',
    shapes: [
      body(circle(12, 12, 8)),
      line(circle(12, 12, 6.1)),
      line('M8.9 8.9L10.3 15.2L12 10.4L13.7 15.2L15.1 8.9M8.4 11.7L15.6 11.7'),
    ],
  },
  workout: {
    tone: 'lavender',
    shapes: [
      body(rect(6.2, 11, 11.6, 2, 1), { tone: 'gray' }),
      body(rect(3.1, 8.4, 2.9, 7.2, 1.2)),
      body(rect(18, 8.4, 2.9, 7.2, 1.2)),
      body(rect(5.4, 6.4, 3.2, 11.2, 1.3)),
      body(rect(15.4, 6.4, 3.2, 11.2, 1.3)),
    ].map((shape) => ({ ...shape, d: rotate(shape.d, -30) })),
  },
  running: {
    tone: 'coral',
    shapes: [
      body(
        'M3.4 15.3C3.4 13.4 4.2 12 5.5 11L7.9 9.1L9.1 6.6C9.3 6.1 9.9 5.9 10.4 6.1L12.2 7C12.8 9.1 14.8 10.7 17.2 11.3L19.5 11.9C20.6 12.2 21.1 13.1 21.1 14.1L21.1 15.3Z',
      ),
      line('M9.4 9.8L11.5 8.7M11 11.7L13.2 10.6', { tone: 'dark' }),
      body('M3.2 15.2L21.2 15.2L21.2 16.9C21.2 17.9 20.4 18.7 19.4 18.7L5 18.7C4 18.7 3.2 17.9 3.2 16.9Z', { tone: 'white' }),
    ],
  },
  music: {
    tone: 'lavender',
    shapes: [
      line('M9.9 8.4L9.9 17M18.9 6.2L18.9 14.8'),
      body('M9.6 6.4L19.2 4.2L19.2 7L9.6 9.2Z'),
      body(ellipse(7.2, 17.4, 3.1, 2.3, -20)),
      body(ellipse(16.2, 15.2, 3.1, 2.3, -20)),
    ],
  },
  movie: {
    tone: 'white',
    shapes: [
      body(
        'M5.6 10.6C4.3 9.5 4.9 7.3 6.8 7.3C7 5.6 9 4.7 10.4 5.7C11.2 4.1 13.6 4.1 14.3 5.8C15.8 4.9 17.8 5.9 17.6 7.6C19.3 7.7 20 9.6 18.6 10.6Z',
        { tone: 'cream' },
      ),
      body('M5.4 10.2L18.6 10.2L17.1 20.3C17 20.8 16.6 21.2 16.1 21.2L7.9 21.2C7.4 21.2 7 20.8 6.9 20.3Z'),
      body('M7.8 10.2L9.6 10.2L10.05 21.2L8.6 21.2Z', { tone: 'coral' }),
      body('M14.4 10.2L16.2 10.2L15.4 21.2L13.95 21.2Z', { tone: 'coral' }),
    ],
  },
  camera: {
    tone: 'lavender',
    shapes: [
      body('M8.4 7.8L9.4 5.8C9.6 5.4 10 5.2 10.4 5.2L13.6 5.2C14 5.2 14.4 5.4 14.6 5.8L15.6 7.8Z'),
      body(rect(3.4, 7.6, 17.2, 12.4, 2.4)),
      body(circle(12, 13.8, 4.3), { tone: 'white' }),
      body(circle(12, 13.8, 2.4), { tone: 'sky' }),
      dot(circle(17.6, 10.3, 0.8)),
    ],
  },
  plane: {
    tone: 'sky',
    shapes: [
      body('M4 11.4L3.3 6.8C3.2 6.2 3.8 5.8 4.3 6.1L8.6 11Z', { tone: 'coral' }),
      body(
        'M3.3 13.6C3.3 11.9 4.7 10.8 6.8 10.8L16.4 10.8C19.1 10.8 21.1 12 21.1 13.6C21.1 15.2 19.1 16.4 16.4 16.4L6.8 16.4C4.7 16.4 3.3 15.3 3.3 13.6Z',
      ),
      body('M17.6 11.3C19 11.6 20 12.2 20.4 13L17.9 13Z', { tone: 'white' }),
      dot(`${circle(10.2, 12.9, 0.7)}${circle(12.6, 12.9, 0.7)}${circle(15, 12.9, 0.7)}`),
      body('M9.4 14.2L13.6 19.8C13.8 20.1 14.3 20.2 14.6 20L15.8 19.3L13.6 14.2Z', { tone: 'coral' }),
    ],
  },
  car: {
    tone: 'mint',
    shapes: [
      body(
        'M3.4 15.3L3.4 13.7C3.4 12.5 4.2 11.6 5.3 11.4L7.2 8.4C7.8 7.4 8.8 6.8 10 6.8L14.4 6.8C15.5 6.8 16.5 7.4 17.1 8.3L19 11.3C20.3 11.5 21.1 12.5 21.1 13.7L21.1 15.3C21.1 16.1 20.4 16.8 19.6 16.8L4.9 16.8C4.1 16.8 3.4 16.1 3.4 15.3Z',
      ),
      body('M8.5 11.2L9.8 8.9C10 8.5 10.4 8.3 10.8 8.3L11.6 8.3L11.6 11.2Z', { tone: 'white' }),
      body('M13 11.2L13 8.3L13.9 8.3C14.3 8.3 14.7 8.5 14.9 8.9L16.2 11.2Z', { tone: 'white' }),
      body(circle(20.1, 13.1, 0.6), { tone: 'butter' }),
      body(circle(7.7, 16.9, 2.2), { tone: 'dark' }),
      body(circle(16.8, 16.9, 2.2), { tone: 'dark' }),
      body(`${circle(7.7, 16.9, 0.75)}${circle(16.8, 16.9, 0.75)}`, { tone: 'white' }),
    ],
  },
  house: {
    tone: 'coral',
    shapes: [
      body('M15.6 7.4L15.6 4.7L17.6 4.7L17.6 9Z'),
      body('M5.2 11.2L18.8 11.2L18.8 19.8C18.8 20.5 18.3 21 17.6 21L6.4 21C5.7 21 5.2 20.5 5.2 19.8Z', { tone: 'cream' }),
      body(
        'M2.9 11.3L11.1 4.5C11.6 4.1 12.4 4.1 12.9 4.5L21.1 11.3C21.5 11.6 21.3 12.2 20.8 12.2L3.2 12.2C2.7 12.2 2.5 11.6 2.9 11.3Z',
      ),
      body('M13.6 21L13.6 16.9C13.6 16 14.3 15.3 15.2 15.3C16.1 15.3 16.8 16 16.8 16.9L16.8 21Z', { tone: 'latte' }),
      body(rect(7.2, 14.4, 3, 3, 0.6), { tone: 'sky' }),
    ],
  },
  laundry: {
    tone: 'sky',
    shapes: [
      body(
        'M8.7 4.9C9.5 6 10.6 6.6 12 6.6C13.4 6.6 14.5 6 15.3 4.9L19.8 7.1C20.4 7.4 20.7 8.1 20.4 8.7L19.2 11.1C18.9 11.7 18.2 11.9 17.6 11.6L17 11.3L17 19.6C17 20.4 16.3 21.1 15.5 21.1L8.5 21.1C7.7 21.1 7 20.4 7 19.6L7 11.3L6.4 11.6C5.8 11.9 5.1 11.7 4.8 11.1L3.6 8.7C3.3 8.1 3.6 7.4 4.2 7.1Z',
      ),
      line('M9.6 5.3C10.2 6.9 11 7.7 12 7.7C13 7.7 13.8 6.9 14.4 5.3'),
      body(`${circle(20.2, 15.6, 1.25)}${circle(21, 18.9, 0.8)}${circle(3.8, 16.6, 0.95)}`, { tone: 'white' }),
    ],
  },
  cleaning: {
    tone: 'butter',
    shapes: [...broom(), body(sparkle(6, 6.4, 2.8), { tone: 'sky' }), body(sparkle(3.9, 11.1, 1.5), { tone: 'sky' })],
  },
  tv: {
    tone: 'orange',
    shapes: [
      line('M12 7.2L8.6 3.6M12 7.2L15.4 3.6M6.6 19.6L5.8 21.2M17.4 19.6L18.2 21.2', { tone: 'dark' }),
      body(rect(3, 7, 18, 12.8, 2.6)),
      body(rect(5, 9, 10.6, 8.8, 1.6), { tone: 'sky' }),
      shine('M6.9 12C6.9 11.2 7.3 10.8 8.1 10.8'),
      dot(`${circle(18.3, 11.2, 0.85)}${circle(18.3, 14.2, 0.85)}`),
    ],
  },
  fridge: {
    tone: 'mint',
    shapes: [
      body(rect(5.4, 2.4, 13.2, 19.4, 2.4)),
      line('M5.4 9.2L18.6 9.2'),
      line('M7.9 4.8L7.9 7M7.9 11.6L7.9 15'),
      body(rotate(rect(12.2, 12.4, 4.2, 4.2, 0.5), 8, 14.3, 14.5), { tone: 'butter' }),
    ],
  },
  washer: {
    tone: 'lavender',
    shapes: [
      body(rect(3.8, 2.8, 16.4, 18.6, 2.4)),
      line('M3.8 7L20.2 7'),
      dot(`${circle(6.6, 4.9, 0.75)}${circle(9, 4.9, 0.75)}`),
      body(rect(13.4, 4.1, 4.4, 1.6, 0.8), { tone: 'white' }),
      body(circle(12, 14.2, 5.3), { tone: 'white' }),
      // 문 안의 물: 물결 끝에서 원을 따라 아래로 돈다.
      body(`M7.94 14.8Q9.97 13.3 12 14.8Q14.03 16.3 16.06 14.8${arc(12, 14.2, 4.1, 8.4, 171.6)}Z`, { tone: 'sky' }),
    ],
  },
  microwave: {
    tone: 'coral',
    shapes: [
      line('M6.2 18.6L6.2 20.2M17.8 18.6L17.8 20.2'),
      body(rect(2.6, 5.2, 18.8, 13.8, 2.4)),
      body(rect(4.6, 7.2, 10.6, 9.8, 1.4), { tone: 'butter' }),
      shine('M6.6 10.2C6.6 9.6 7 9.2 7.6 9.2'),
      body(`${circle(18.3, 9.8, 1.2)}${circle(18.3, 13.6, 1.2)}`, { tone: 'white' }),
    ],
  },
  ricecooker: {
    tone: 'pink',
    shapes: [
      line('M10.8 5.2Q10 4.3 10.8 3.4Q11.6 2.5 10.8 1.6M13.2 5.2Q12.4 4.3 13.2 3.4Q14 2.5 13.2 1.6'),
      body('M3.8 11.4L20.2 11.4L19.7 17.8C19.5 19.6 18 20.9 16.2 20.9L7.8 20.9C6 20.9 4.5 19.6 4.3 17.8Z', { tone: 'white' }),
      body('M4.2 12C4.2 8.6 7.6 6.4 12 6.4C16.4 6.4 19.8 8.6 19.8 12Z'),
      body(rect(9.2, 14, 5.6, 3.4, 1.1), { tone: 'sky' }),
    ],
  },
  aircon: {
    tone: 'sky',
    shapes: [
      body(rect(2.4, 4.6, 19.2, 9, 2.4), { tone: 'white' }),
      line('M5.2 10.9L18.8 10.9', { tone: 'white' }),
      dot(circle(18.4, 7.4, 0.75), { tone: 'mint' }),
      line('M7.4 15.8Q8.3 17 7.4 18.2Q6.5 19.4 7.4 20.6M12 15.8Q12.9 17 12 18.2Q11.1 19.4 12 20.6M16.6 15.8Q17.5 17 16.6 18.2Q15.7 19.4 16.6 20.6'),
    ],
  },
  fan: {
    tone: 'mint',
    shapes: [
      body(rect(10.9, 15.6, 2.2, 4.4, 0.6)),
      body(rect(6.2, 19.4, 11.6, 2.2, 1.1)),
      body(circle(12, 10, 7.2), { tone: 'white' }),
      ...[0, 120, 240].map((degrees) => body(rotate(ellipse(12.8, 6.6, 2.1, 3.1, 25), degrees, 12, 10))),
      body(circle(12, 10, 1.5)),
    ],
  },
  vacuum: {
    tone: 'butter',
    shapes: [
      body(tube([11.2, 13.4], [12.6, 2.2], [17.2, 7.6], 1.9), { tone: 'gray' }),
      body(rotate(rect(17, 5.4, 2.2, 12.6, 1.1), -12, 18.1, 11.7), { tone: 'gray' }),
      body(rect(15.2, 17.2, 7.2, 2.4, 1.2), { tone: 'dark' }),
      body(
        'M2.4 17.2C2.4 13.4 5.2 10.6 8.6 10.6C11.6 10.6 13.8 12.6 14.4 15.6L14.8 17.8C14.9 18.6 14.4 19.2 13.6 19.2L4.4 19.2C3.3 19.2 2.4 18.3 2.4 17.2Z',
      ),
      body(circle(6.2, 17.4, 2.4), { tone: 'dark' }),
      body(circle(6.2, 17.4, 0.8), { tone: 'white' }),
    ],
  },
  battery: {
    tone: 'mint',
    shapes: [
      body(rect(18.8, 9.6, 2.4, 4.8, 0.8), { tone: 'white' }),
      body(rect(2.8, 6.6, 16.8, 10.8, 2.6), { tone: 'white' }),
      body(rect(4.8, 8.6, 9.4, 6.8, 1.2)),
      body(
        polygon([
          [12.9, 7.2],
          [8.4, 12.8],
          [11.4, 12.8],
          [10.4, 16.8],
          [14.9, 11.2],
          [11.9, 11.2],
        ]),
        { tone: 'butter' },
      ),
    ],
  },
  toothbrush: {
    tone: 'sky',
    shapes: toothbrush(),
  },
  soap: {
    tone: 'lavender',
    shapes: [
      body(`${circle(19.4, 6.2, 1.9)}${circle(20.6, 10.4, 1.15)}`, { tone: 'sky' }),
      shine('M18.4 5.8C18.5 5.3 18.9 4.9 19.4 4.8'),
      body('M13.6 3L8.2 3C7.2 3 6.4 3.8 6.4 4.8L6.4 5.2L7.8 5.2L7.8 4.6L13.6 4.6C14 4.6 14.4 4.2 14.4 3.8C14.4 3.4 14 3 13.6 3Z'),
      body(rect(11, 4.6, 2, 2.8), { tone: 'white' }),
      body(rect(9, 7, 6, 2.4, 0.8)),
      body(rect(5.8, 9, 12.4, 12.2, 3)),
      body(rect(8.2, 12, 7.6, 6.2, 1.4), { tone: 'white' }),
      body(drop(12, 15.2, 1.4), { tone: 'sky' }),
    ],
  },
  tissue: {
    tone: 'pink',
    shapes: [
      body('M3.6 11.2L5.8 8.6L18.2 8.6L20.4 11.2Z'),
      body('M9 9.6C8.8 7.4 7.8 6 8.8 4.6C10 5.4 11.4 5.2 12.2 4C13.2 5 14.6 5.2 15.4 4.8C14.8 6.4 14.8 8 15 9.6Z', { tone: 'white' }),
      body(rect(3.6, 11.2, 16.8, 9.6, 2)),
      body(heart(12, 15.8, 4.6), { tone: 'white' }),
    ],
  },
  trash: {
    tone: 'mint',
    shapes: [
      body('M10 5.2L10 4.4C10 3.8 10.4 3.4 11 3.4L13 3.4C13.6 3.4 14 3.8 14 4.4L14 5.2Z'),
      body('M5.8 8.4L18.2 8.4L17 19.8C16.9 20.7 16.2 21.3 15.3 21.3L8.7 21.3C7.8 21.3 7.1 20.7 7 19.8Z'),
      line('M10 11L10.3 18.6M14 11L13.7 18.6'),
      body(rect(4.4, 5.2, 15.2, 3.2, 1.2)),
    ],
  },
  key: {
    tone: 'butter',
    shapes: key(),
  },
  mask: {
    tone: 'sky',
    shapes: [
      line('M5.6 9.4C3 8.8 1.8 10.6 2.2 12.6C2.6 14.4 3.8 15.2 5.6 14.6'),
      line(mirror('M5.6 9.4C3 8.8 1.8 10.6 2.2 12.6C2.6 14.4 3.8 15.2 5.6 14.6')),
      body('M5.2 8.6C9.5 6.8 14.5 6.8 18.8 8.6L18.8 14.6C14.5 17.6 9.5 17.6 5.2 14.6Z'),
      line('M7.4 10.6C10.5 9.6 13.5 9.6 16.6 10.6M7.4 13.2C10.5 12.2 13.5 12.2 16.6 13.2'),
    ],
  },
  glasses: {
    tone: 'brown',
    shapes: [
      line('M10.6 11.6Q12 10.6 13.4 11.6M3.2 11L1.8 9.6M20.8 11L22.2 9.6'),
      body(`${circle(6.9, 13, 4.2)}${circle(17.1, 13, 4.2)}`),
      body(`${circle(6.9, 13, 3)}${circle(17.1, 13, 3)}`, { tone: 'sky' }),
      shine('M5.2 12.4C5.4 11.5 6 11 6.8 10.9M15.4 12.4C15.6 11.5 16.2 11 17 10.9'),
    ],
  },
  scissors: {
    tone: 'coral',
    shapes: scissors(),
  },
  bed: {
    tone: 'sky',
    shapes: [
      body(rect(5, 12.4, 14.6, 3.8, 0.8), { tone: 'white' }),
      body(rect(6.4, 9.4, 5.4, 3.6, 1.8), { tone: 'white' }),
      body('M10.6 11.2C13.6 10.6 16.6 10.6 19.6 11.2L19.6 16.4L10.6 16.4Z'),
      line('M10.6 13.4L19.6 13.4'),
      body(rect(4.4, 15.6, 16, 2.6, 0.6), { tone: 'latte' }),
      body(rect(2.4, 5.8, 3.6, 14.2, 1.6), { tone: 'latte' }),
      body(rect(18.6, 11.2, 3, 8.8, 1.3), { tone: 'latte' }),
    ],
  },
  pill: {
    tone: 'coral',
    shapes: [
      body('M7.2 8.3L12 8.3L12 15.7L7.2 15.7C5.16 15.7 3.5 14.04 3.5 12C3.5 9.96 5.16 8.3 7.2 8.3Z'),
      body('M12 8.3L16.8 8.3C18.84 8.3 20.5 9.96 20.5 12C20.5 14.04 18.84 15.7 16.8 15.7L12 15.7Z', { tone: 'white' }),
      shine('M6.2 10.3L8.4 10.3'),
    ].map((shape) => ({ ...shape, d: rotate(shape.d, -40) })),
  },
  heart: {
    tone: 'pink',
    shapes: [body(HEART), shine('M6.5 9.4C6.5 8.3 7.2 7.5 8.2 7.3')],
  },
  idea: {
    tone: 'butter',
    shapes: [
      line('M12 2.3L12 1.2M5.9 4.6L5.1 3.8M18.1 4.6L18.9 3.8M3.6 10.1L2.5 10.1M20.4 10.1L21.5 10.1'),
      body(
        'M12 4C15.4 4 18.2 6.7 18.2 10.1C18.2 12.3 17.1 14 15.5 15.1C14.8 15.6 14.5 16.3 14.5 17.1L14.5 17.4L9.5 17.4L9.5 17.1C9.5 16.3 9.2 15.6 8.5 15.1C6.9 14 5.8 12.3 5.8 10.1C5.8 6.7 8.6 4 12 4Z',
      ),
      body('M9.5 17.4L14.5 17.4L14.5 19.3C14.5 20.3 13.7 21.1 12.7 21.1L11.3 21.1C10.3 21.1 9.5 20.3 9.5 19.3Z', { tone: 'gray' }),
      line('M9.6 19.2L14.4 19.2', { tone: 'gray' }),
      line('M10.4 17.2L10.4 14.6C10.4 12.6 13.6 12.6 13.6 14.6L13.6 17.2', { tone: 'orange' }),
    ],
  },
  party: {
    tone: 'lavender',
    shapes: [
      body('M3.6 20.6L8.3 9.4L14.8 15.9Z'),
      body('M5.72 15.56L6.66 13.32L10.88 17.55L8.64 18.49Z', { tone: 'butter' }),
      body(circle(16.4, 5.4, 1.15), { tone: 'pink' }),
      body(circle(12.6, 4.2, 0.9), { tone: 'mint' }),
      body(rotate(rect(18.6, 8.7, 2, 2, 0.4), 30, 19.6, 9.7), { tone: 'butter' }),
      line('M15.9 12Q17.1 10.9 18 12.1Q18.9 13.3 20.1 12.3', { tone: 'sky' }),
      line('M10.6 7.8L11.6 6.1M13.4 9.6L15.2 8.8', { tone: 'coral' }),
    ],
  },
};
