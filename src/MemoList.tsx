import type { ReactNode } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ComposeIcon, ICON_SIZE } from './icons';
import { memoPreview, type Memo } from './memoStorage';
import { colors } from './theme';

const SIDE_PADDING = 20;
export const HEADER_HEIGHT = 44;

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

export function MemoList({ memos, onSelect, onCreate, onDelete }: Props) {
  const insets = useSafeAreaInsets();

  const confirmDelete = (memo: Memo) => {
    Alert.alert('메모 삭제', `'${rowText(memo).title}' 메모를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(memo) },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <HeaderButton label="새 메모" onPress={onCreate}>
          <ComposeIcon color={colors.accent} />
        </HeaderButton>
      </View>

      <FlatList
        data={memos}
        keyExtractor={(memo) => memo.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          <View style={styles.heading}>
            <Text style={styles.headingTitle}>메모</Text>
            <Text style={styles.headingCount}>{memos.length}개</Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>메모가 없습니다</Text>}
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
    </View>
  );
}

type HeaderButtonProps = { label: string; onPress: () => void; children: ReactNode };

export function HeaderButton({ label, onPress, children }: HeaderButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.paper,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: SIDE_PADDING - 8,
  },
  headerButton: {
    height: HEADER_HEIGHT,
    width: ICON_SIZE + 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.4,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: SIDE_PADDING,
    paddingTop: 4,
    paddingBottom: 12,
  },
  headingTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.ink,
  },
  headingCount: {
    fontSize: 15,
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
