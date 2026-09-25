export const colors = {
  paper: '#FFFFFF',
  ink: '#1C1C1E',
  placeholder: '#B4B4BA',
  muted: '#A1A1A6',
  divider: '#E3E3E8',
  icon: '#3A3A3C',
  iconDisabled: '#C7C7CC',
  accent: '#007AFF',
  barBorder: 'rgba(0, 0, 0, 0.06)',
  highlight: '#F2F2F7',
  // 목록에서 스레드로 이어진 메모 왼쪽의 세로선
  thread: '#D1D1D6',
} as const;

// 서식 바와 알림처럼 본문 위에 떠 있는 알약 모양 표면
export const floatingSurface = {
  backgroundColor: colors.paper,
  borderWidth: 0.5,
  borderColor: colors.barBorder,
  boxShadow: '0px 6px 20px rgba(0, 0, 0, 0.10), 0px 1px 3px rgba(0, 0, 0, 0.06)',
} as const;
