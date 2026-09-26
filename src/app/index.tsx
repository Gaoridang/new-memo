import { Redirect } from 'expo-router';
import { useState } from 'react';

import { listMemos, newMemoId } from '../memoStorage';

// 앱을 켜면 가장 최근 메모(없으면 새 메모)를 연다.
export default function Index() {
  const [id] = useState(() => listMemos()[0]?.id ?? newMemoId());
  return <Redirect href={{ pathname: '/memo/[id]', params: { id } }} />;
}
