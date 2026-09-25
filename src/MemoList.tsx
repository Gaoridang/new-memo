import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headerIcons } from './headerIcons';
import { memoPreview, type Memo } from './memoStorage';
import { colors } from './theme';

const SIDE_PADDING = 20;

type Props = {
  memos: Memo[];
  onSelect: (memo: Memo) => void;
  onCreate: () => void;
  onDelete: (memo: Memo) => void;
};

function formatDate(time: number) {
  const date = new Date(time);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  }
  return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
}

// 제목이 비어 있으면 본문 첫 줄을 제목으로, 나머지를 미리보기로 쓴다.
function rowText(memo: Memo) {
  const lines = memoPreview(memo.content)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const title = memo.title.trim().replace(/\s+/g, ' ');
  if (title) return { title, preview: lines.join(' ') };
  return { title: lines[0] ?? '새로운 메모', preview: lines.slice(1).join(' ') };
}

// 제목과 본문에 검색어가 들어 있는 메모만 남긴다. (대소문자 무시)
function matches(memo: Memo, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${memo.title}\n${memoPreview(memo.content)}`.toLowerCase().includes(needle);
}

export function MemoList({ memos, onSelect, onCreate, onDelete }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const visibleMemos = useMemo(() => memos.filter((memo) => matches(memo, query)), [memos, query]);
  const searching = query.trim() !== '';

  const confirmDelete = (memo: Memo) => {
    Alert.alert('메모 삭제', `'${rowText(memo).title}' 메모를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(memo) },
    ]);
  };

  return (
    <>
      <Stack.Title large>메모</Stack.Title>
      <Stack.SearchBar
        placeholder="검색"
        placement="stacked"
        hideWhenScrolling={false}
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
        onCancelButtonPress={() => setQuery('')}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={headerIcons.compose} accessibilityLabel="새 메모" onPress={onCreate} />
      </Stack.Toolbar>

      {/* 큰 제목이 스크롤에 맞춰 줄어들도록 목록이 화면의 첫 스크롤 뷰여야 한다. */}
      <FlatList
        style={styles.screen}
        data={visibleMemos}
        keyExtractor={(memo) => memo.id}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          memos.length > 0 ? (
            <Text style={styles.count}>
              {searching ? `${visibleMemos.length}개 찾음` : `${memos.length}개의 메모`}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{searching ? '검색 결과가 없습니다' : '메모가 없습니다'}</Text>
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => {
          const { title, preview } = rowText(item);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityHint="길게 누르면 삭제합니다"
              onPress={() => onSelect(item)}
              onLongPress={() => confirmDelete(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowHighlighted]}
            >
              <Text style={styles.rowTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                <Text style={styles.rowDate}>{formatDate(item.updatedAt)}</Text>
                {preview ? `  ${preview}` : ''}
              </Text>
            </Pressable>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  count: {
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 4,
    paddingBottom: 4,
    fontSize: 13,
    color: colors.muted,
  },
  empty: {
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 24,
    fontSize: 16,
    color: colors.muted,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: SIDE_PADDING,
    backgroundColor: colors.divider,
  },
  row: {
    paddingHorizontal: SIDE_PADDING,
    paddingVertical: 12,
    gap: 4,
  },
  rowHighlighted: {
    backgroundColor: colors.highlight,
  },
  rowTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.ink,
  },
  rowMeta: {
    fontSize: 14,
    color: colors.muted,
  },
  rowDate: {
    color: colors.icon,
  },
});
