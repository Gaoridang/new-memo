const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function parse(due: string) {
  const [year, month, day] = due.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// '10월 3일 (금)'
export function dueDate(due: string) {
  const date = parse(due);
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${WEEKDAYS[date.getDay()]})`;
}

// '오늘', '내일', 'D-3', '2일 지남'
export function dueRelative(due: string, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((parse(due).getTime() - today.getTime()) / 86_400_000);
  if (days === 0) return '오늘';
  if (days === 1) return '내일';
  if (days < 0) return `${-days}일 지남`;
  return `D-${days}`;
}

// 알림처럼 좁은 곳에 쓰는 짧은 표기: '오늘', '내일', '10월 3일'
export function dueShort(due: string, now = new Date()) {
  const relative = dueRelative(due, now);
  if (relative === '오늘' || relative === '내일') return relative;
  const date = parse(due);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}
