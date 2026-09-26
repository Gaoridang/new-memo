import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

// 모든 아이콘은 20x20 격자 위에 직접 그리고, 쓰는 곳에서 크기를 정한다.
export const ICON_SIZE = 20;
// 툴바와 상단 버튼처럼 손가락으로 누르는 아이콘
export const BUTTON_ICON_SIZE = 24;
const STROKE = 1.6;

export type IconProps = { color: string; size?: number };

function Icon({ size = ICON_SIZE, children }: { size?: number; children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      {children}
    </Svg>
  );
}

function strokeProps(color: string, width = STROKE) {
  return {
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  } as const;
}

export function BoldIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path
        d="M5.75 4H10.25C12.1 4 13.25 5.05 13.25 6.7C13.25 8.35 12.1 9.4 10.25 9.4H5.75Z M5.75 9.4H10.9C13 9.4 14.25 10.55 14.25 12.7C14.25 14.85 13 16 10.9 16H5.75Z"
        {...strokeProps(color, 2.1)}
      />
    </Icon>
  );
}

export function UnderlineIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path
        d="M6.25 3.75V9.25C6.25 11.6 7.75 13 10 13C12.25 13 13.75 11.6 13.75 9.25V3.75 M5 16.25H15"
        {...strokeProps(color)}
      />
    </Icon>
  );
}

export function StrikethroughIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path
        d="M13.5 5.9C13 4.6 11.7 3.75 10 3.75C7.9 3.75 6.5 4.85 6.5 6.55C6.5 7.55 7 8.25 8 8.75 M12.4 11.45C13.2 11.95 13.6 12.65 13.6 13.5C13.6 15.2 12.1 16.25 10 16.25C8.1 16.25 6.8 15.45 6.3 14.1 M4.25 10H15.75"
        {...strokeProps(color)}
      />
    </Icon>
  );
}

export function CheckboxIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Rect x={3.5} y={3.5} width={13} height={13} rx={3.25} {...strokeProps(color)} />
      <Path d="M7 10.25L9.1 12.35L13.1 8" {...strokeProps(color)} />
    </Icon>
  );
}

export function BulletListIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Circle cx={4.5} cy={5.5} r={1.2} fill={color} />
      <Circle cx={4.5} cy={10} r={1.2} fill={color} />
      <Circle cx={4.5} cy={14.5} r={1.2} fill={color} />
      <Path d="M8.5 5.5H16 M8.5 10H16 M8.5 14.5H16" {...strokeProps(color)} />
    </Icon>
  );
}

export function NumberedListIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path
        d="M3.7 4.5L4.8 3.9V7.1 M3.6 9.1C3.75 8.7 4.15 8.4 4.7 8.4C5.3 8.4 5.75 8.8 5.75 9.3C5.75 9.75 5.45 10.05 5.05 10.35L3.6 11.6H5.85 M3.7 13.2C3.95 13 4.3 12.9 4.7 12.9C5.3 12.9 5.7 13.25 5.7 13.7C5.7 14.15 5.3 14.45 4.75 14.45C5.35 14.45 5.8 14.8 5.8 15.3C5.8 15.8 5.3 16.1 4.7 16.1C4.25 16.1 3.9 15.95 3.65 15.7"
        {...strokeProps(color, 1.1)}
      />
      <Path d="M8.75 5.5H16 M8.75 10H16 M8.75 14.5H16" {...strokeProps(color)} />
    </Icon>
  );
}

export function KeyboardDismissIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Rect x={2.75} y={2.75} width={14.5} height={9} rx={2.25} {...strokeProps(color)} />
      <Circle cx={6} cy={5.85} r={0.8} fill={color} />
      <Circle cx={8.67} cy={5.85} r={0.8} fill={color} />
      <Circle cx={11.33} cy={5.85} r={0.8} fill={color} />
      <Circle cx={14} cy={5.85} r={0.8} fill={color} />
      <Path d="M7.25 9H12.75" {...strokeProps(color)} />
      <Path d="M7.75 15.1L10 17.1L12.25 15.1" {...strokeProps(color)} />
    </Icon>
  );
}

export function UndoIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path d="M4.5 7.5H12C14.5 7.5 16.25 9.4 16.25 11.75C16.25 14.1 14.5 16 12 16H9" {...strokeProps(color)} />
      <Path d="M7.75 4.25L4.5 7.5L7.75 10.75" {...strokeProps(color)} />
    </Icon>
  );
}

export function RedoIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path d="M15.5 7.5H8C5.5 7.5 3.75 9.4 3.75 11.75C3.75 14.1 5.5 16 8 16H11" {...strokeProps(color)} />
      <Path d="M12.25 4.25L15.5 7.5L12.25 10.75" {...strokeProps(color)} />
    </Icon>
  );
}

export function MemoListIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path d="M3.5 5H16.5 M3.5 10H16.5 M3.5 15H11.5" {...strokeProps(color, 1.8)} />
    </Icon>
  );
}

export function ComposeIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Path
        d="M9.25 3.75H6C4.75 3.75 3.75 4.75 3.75 6V14C3.75 15.25 4.75 16.25 6 16.25H14C15.25 16.25 16.25 15.25 16.25 14V10.75"
        {...strokeProps(color)}
      />
      <Path d="M14.6 3.15L16.85 5.4L10.4 11.85L7.6 12.4L8.15 9.6Z" {...strokeProps(color)} />
    </Icon>
  );
}

// 체크박스 + 반짝임: 할 일 자동 감지
export function AutoTodoIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Rect x={2.75} y={6} width={11} height={11} rx={2.75} {...strokeProps(color)} />
      <Path d="M5.6 11.6L7.4 13.4L10.9 9.6" {...strokeProps(color)} />
      <Path
        d="M15.5 1.9L16.15 3.85L18.1 4.5L16.15 5.15L15.5 7.1L14.85 5.15L12.9 4.5L14.85 3.85Z"
        fill={color}
        {...strokeProps(color, 0.8)}
      />
    </Icon>
  );
}

// 돋보기 + 반짝임: 메모에게 묻기 (뜻으로 찾기)
export function AskIcon({ color, size }: IconProps) {
  return (
    <Icon size={size}>
      <Circle cx={8.25} cy={9.75} r={5} {...strokeProps(color)} />
      <Path d="M11.85 13.35L16 17.5" {...strokeProps(color, 1.8)} />
      <Path
        d="M15.5 1.9L16.15 3.85L18.1 4.5L16.15 5.15L15.5 7.1L14.85 5.15L12.9 4.5L14.85 3.85Z"
        fill={color}
        {...strokeProps(color, 0.8)}
      />
    </Icon>
  );
}
