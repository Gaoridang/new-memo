import { useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dueDate, dueRelative } from './dueLabel';
import { AskIcon, BUTTON_ICON_SIZE, ComposeIcon } from './icons';
import { memoPreview, upcomingTodos, type Memo } from './memoStorage';
import { SwipeToReturn } from './SwipeToReturn';
import { colors } from './theme';
import { useMemoSearch, type SearchState } from './useMemoSearch';

// 목록 위에 보여주는 다가오는 할 일 수
const MAX_UPCOMING = 5;

const SIDE_PADDING = 20;
export const HEADER_HEIGHT = 44;
// 상단 버튼은 권장 크기(44pt)로 누르게 하고, 아이콘 가장자리는 본문 여백에 맞춘다.
const HEADER_BUTTON_SIZE = 44;
export const HEADER_PADDING = SIDE_PADDING - (HEADER_BUTTON_SIZE - BUTTON_ICON_SIZE) / 2;

type Props = {
  memos: Memo[];
  // 목록을 왼쪽으로 밀면 다시 여는 메모 (방금까지 보던 메모)
  returnTo?: Memo;
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

export function MemoList({ memos, returnTo, onSelect, onCreate, onDelete }: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { state: searchState, search, clear } = useMemoSearch();
  const upcoming = useMemo(() => upcomingTodos(memos).slice(0, MAX_UPCOMING), [memos]);

  // 입력하는 동안에는 글자가 들어 있는 메모만 남긴다. 뜻으로 찾기는 검색 버튼을 눌러야 한다.
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? memos.filter((memo) => `${memo.title}\n${memoPreview(memo.content)}`.toLowerCase().includes(needle))
    : memos;

  const changeQuery = (text: string) => {
    setQuery(text);
    if (searchState.status !== 'idle') clear();
  };

  const confirmDelete = (memo: Memo) => {
    Alert.alert('메모 삭제', `'${rowText(memo).title}' 메모를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(memo) },
    ]);
  };

  return (
    <SwipeToReturn
      style={[styles.screen, { paddingTop: insets.top }]}
      label={returnTo && rowText(returnTo).title}
      onReturn={() => returnTo && onSelect(returnTo)}
    >
      <View style={styles.header}>
        <HeaderButton label="새 메모" onPress={onCreate}>
          <ComposeIcon color={colors.accent} size={BUTTON_ICON_SIZE} />
        </HeaderButton>
      </View>

      <FlatList
        data={shown}
        keyExtractor={(memo) => memo.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          <>
            <View style={styles.heading}>
              <Text style={styles.headingTitle}>메모</Text>
              <Text style={styles.headingCount}>{memos.length}개</Text>
            </View>
            {memos.length > 0 && (
              <View style={styles.searchField}>
                <AskIcon color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={changeQuery}
                  placeholder="메모에게 묻기 · 예: 치과 언제 가지?"
                  placeholderTextColor={colors.placeholder}
                  selectionColor={colors.accent}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                  onSubmitEditing={() => search(query, memos)}
                  accessibilityLabel="메모 검색"
                  accessibilityHint="입력하면 글자로 거르고, 검색을 누르면 뜻으로 답을 찾습니다"
                />
              </View>
            )}
            {searchState.status !== 'idle' ? (
              <SearchPanel state={searchState} onSelect={onSelect} />
            ) : (
              !needle &&
              upcoming.length > 0 && (
                <Section title="다가오는 할 일">
                  {upcoming.map(({ memo, text, due }) => {
                    const relative = dueRelative(due);
                    const urgent = relative === '오늘' || relative.endsWith('지남');
                    return (
                      <SectionRow
                        key={`${memo.id}\n${text}`}
                        title={text}
                        meta={`${dueDate(due)} · ${rowText(memo).title}`}
                        badge={relative}
                        badgeColor={urgent ? colors.urgent : colors.accent}
                        onPress={() => onSelect(memo)}
                      />
                    );
                  })}
                </Section>
              )
            )}
          </>
        }
        ListEmptyComponent={
          searchState.status === 'idle' ? (
            <Text style={styles.empty}>
              {needle ? '글자가 같은 메모가 없어요. 검색을 누르면 뜻으로 찾아요' : '메모가 없습니다'}
            </Text>
          ) : null
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
              <Text style={[styles.rowPreview, !preview && styles.rowPreviewEmpty]} numberOfLines={1}>
                {preview || '추가 텍스트 없음'}
              </Text>
              <Text style={styles.rowDate}>{formatDate(item.updatedAt)}</Text>
            </Pressable>
          );
        }}
      />
    </SwipeToReturn>
  );
}

function SearchPanel({ state, onSelect }: { state: Exclude<SearchState, { status: 'idle' }>; onSelect: (memo: Memo) => void }) {
  if (state.status === 'loading') {
    return (
      <View style={styles.searchStatus}>
        <ActivityIndicator size="small" color={colors.muted} />
        <Text style={styles.searchStatusText}>뜻이 맞는 줄을 찾는 중…</Text>
      </View>
    );
  }
  if (state.status === 'error') {
    return <Text style={[styles.searchStatus, styles.searchStatusText]}>지금은 찾을 수 없어요. 잠시 뒤 다시 해 보세요.</Text>;
  }
  if (state.hits.length === 0) {
    return <Text style={[styles.searchStatus, styles.searchStatusText]}>답이 적힌 메모를 찾지 못했어요</Text>;
  }
  return (
    <Section title="찾은 답">
      {state.hits.map(({ memo, text }, i) => (
        <SectionRow key={`${memo.id}\n${i}`} title={text} meta={rowText(memo).title} onPress={() => onSelect(memo)} />
      ))}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

type SectionRowProps = {
  title: string;
  meta: string;
  badge?: string;
  badgeColor?: string;
  onPress: () => void;
};

function SectionRow({ title, meta, badge, badgeColor, onPress }: SectionRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${title}, ${badge}, ${meta}` : `${title}, ${meta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.sectionRow, pressed && styles.pressed]}
    >
      <View style={styles.sectionRowText}>
        <Text style={styles.sectionRowTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      {badge && <Text style={[styles.badge, { color: badgeColor }]}>{badge}</Text>}
    </Pressable>
  );
}

type HeaderButtonProps = { label: string; disabled?: boolean; onPress: () => void; children: ReactNode };

export function HeaderButton({ label, disabled = false, onPress, children }: HeaderButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={{ top: 8, bottom: 8 }}
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
    paddingHorizontal: HEADER_PADDING,
  },
  headerButton: {
    height: HEADER_BUTTON_SIZE,
    width: HEADER_BUTTON_SIZE,
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
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: SIDE_PADDING,
    marginBottom: 12,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.highlight,
  },
  searchInput: {
    flex: 1,
    height: 40,
    fontSize: 16,
    color: colors.ink,
  },
  searchStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: SIDE_PADDING,
    paddingBottom: 16,
  },
  searchStatusText: {
    fontSize: 15,
    color: colors.muted,
  },
  section: {
    paddingHorizontal: SIDE_PADDING,
    paddingBottom: 16,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  sectionCard: {
    borderRadius: 12,
    backgroundColor: colors.highlight,
    paddingVertical: 4,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sectionRowText: {
    flex: 1,
    gap: 2,
  },
  sectionRowTitle: {
    fontSize: 16,
    color: colors.ink,
  },
  badge: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
    gap: 3,
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
  rowPreview: {
    fontSize: 15,
    color: colors.icon,
  },
  rowPreviewEmpty: {
    color: colors.placeholder,
  },
  rowDate: {
    fontSize: 13,
    color: colors.muted,
  },
});
