import { Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { headerIcons } from './headerIcons';
import { groupThreads, type LinkData, type Suggestion } from './memoLinks';
import { memoPreview, type Memo } from './memoStorage';
import { colors } from './theme';

const SIDE_PADDING = 20;
// 스레드에 이어진 메모와 연관 메모 제안은 이만큼 들여 쓴다.
const THREAD_INDENT = 16;
// 메모 하나 아래에 보여 줄 제안 수
const MAX_SUGGESTIONS = 2;

type Props = {
  memos: Memo[];
  linkData: LinkData;
  suggestionsEnabled: boolean;
  onToggleSuggestions: () => void;
  onSelect: (memo: Memo) => void;
  onCreate: () => void;
  onDelete: (memo: Memo) => void;
  onLink: (suggestion: Suggestion) => void;
  onDismiss: (suggestion: Suggestion) => void;
  onLeaveThread: (memo: Memo) => void;
};

// 이 줄 아래 구분선: 스레드 안에서는 들여 쓴 자리부터, 제안 카드 앞뒤에는 긋지 않는다.
type Separator = 'full' | 'thread' | 'none';

type Row =
  | { type: 'memo'; key: string; memo: Memo; inThread: boolean; child: boolean; separator: Separator }
  | { type: 'suggestion'; key: string; suggestion: Suggestion; related: Memo; separator: Separator };

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

// 검색 중에는 찾은 메모만 평평하게, 아니면 연결된 메모를 스레드로 묶고 제안을 그 메모 아래에 둔다.
function buildRows(memos: Memo[], linkData: LinkData, query: string, showSuggestions: boolean): Row[] {
  if (query.trim()) {
    return memos
      .filter((memo) => matches(memo, query))
      .map((memo) => ({ type: 'memo', key: memo.id, memo, inThread: false, child: false, separator: 'full' }));
  }

  const byId = new Map(memos.map((memo) => [memo.id, memo]));
  const rows: Row[] = [];
  for (const thread of groupThreads(memos, linkData.links)) {
    thread.forEach((memo, index) => {
      rows.push({
        type: 'memo',
        key: memo.id,
        memo,
        inThread: thread.length > 1,
        child: index > 0,
        separator: 'full',
      });
      if (!showSuggestions) return;
      linkData.suggestions
        .filter((suggestion) => suggestion.memoId === memo.id && byId.has(suggestion.relatedId))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_SUGGESTIONS)
        .forEach((suggestion) =>
          rows.push({
            type: 'suggestion',
            key: `${suggestion.memoId}>${suggestion.relatedId}`,
            suggestion,
            related: byId.get(suggestion.relatedId)!,
            separator: 'none',
          }),
        );
    });
  }

  rows.forEach((row, index) => {
    const next = rows[index + 1];
    if (!next || row.type === 'suggestion' || next.type === 'suggestion') row.separator = 'none';
    else row.separator = next.child ? 'thread' : 'full';
  });
  return rows;
}

export function MemoList({
  memos,
  linkData,
  suggestionsEnabled,
  onToggleSuggestions,
  onSelect,
  onCreate,
  onDelete,
  onLink,
  onDismiss,
  onLeaveThread,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const rows = useMemo(
    () => buildRows(memos, linkData, query, suggestionsEnabled),
    [memos, linkData, query, suggestionsEnabled],
  );
  const searching = query.trim() !== '';

  const confirmDelete = (memo: Memo) => {
    Alert.alert('메모 삭제', `'${rowText(memo).title}' 메모를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(memo) },
    ]);
  };

  // 스레드에 있는 메모는 길게 눌러 연결을 끊거나 지운다.
  const showThreadActions = (memo: Memo) => {
    Alert.alert(`'${rowText(memo).title}'`, undefined, [
      { text: '연결 해제', onPress: () => onLeaveThread(memo) },
      { text: '삭제', style: 'destructive', onPress: () => onDelete(memo) },
      { text: '취소', style: 'cancel' },
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
        <Stack.Toolbar.Menu icon={headerIcons.more} accessibilityLabel="더보기">
          <Stack.Toolbar.MenuAction
            isOn={suggestionsEnabled}
            subtitle="같은 대상을 다루는 메모를 찾아 연결을 제안해요"
            onPress={onToggleSuggestions}
          >
            연관 메모 제안
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Button icon={headerIcons.compose} accessibilityLabel="새 메모" onPress={onCreate} />
      </Stack.Toolbar>

      {/* 큰 제목이 스크롤에 맞춰 줄어들도록 목록이 화면의 첫 스크롤 뷰여야 한다. */}
      <FlatList
        style={styles.screen}
        data={rows}
        keyExtractor={(row) => row.key}
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
        ListHeaderComponent={
          memos.length > 0 ? (
            <Text style={styles.count}>
              {searching ? `${rows.length}개 찾음` : `${memos.length}개의 메모`}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <Text style={styles.empty}>{searching ? '검색 결과가 없습니다' : '메모가 없습니다'}</Text>
        }
        ItemSeparatorComponent={RowSeparator}
        renderItem={({ item: row }) => {
          if (row.type === 'suggestion') {
            return (
              <SuggestionCard
                related={row.related}
                onOpen={() => onSelect(row.related)}
                onLink={() => onLink(row.suggestion)}
                onDismiss={() => onDismiss(row.suggestion)}
              />
            );
          }

          const { memo, inThread, child } = row;
          const { title, preview } = rowText(memo);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityHint={inThread ? '길게 누르면 연결을 해제하거나 삭제합니다' : '길게 누르면 삭제합니다'}
              onPress={() => onSelect(memo)}
              onLongPress={() => (inThread ? showThreadActions(memo) : confirmDelete(memo))}
              style={({ pressed }) => [styles.row, child && styles.childRow, pressed && styles.rowHighlighted]}
            >
              {child && <View style={styles.threadLine} />}
              <Text style={styles.rowTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                <Text style={styles.rowDate}>{formatDate(memo.updatedAt)}</Text>
                {preview ? `  ${preview}` : ''}
              </Text>
            </Pressable>
          );
        }}
      />
    </>
  );
}

function RowSeparator({ leadingItem }: { leadingItem: Row }) {
  if (leadingItem.separator === 'none') return null;
  return <View style={[styles.separator, leadingItem.separator === 'thread' && styles.threadSeparator]} />;
}

type SuggestionCardProps = { related: Memo; onOpen: () => void; onLink: () => void; onDismiss: () => void };

// 방금 고친 메모 바로 아래에 '이 메모와 이어지는 것 같다'는 제안을 띄운다.
// 연결하기 전에 눌러서 그 메모를 열어 볼 수 있다.
function SuggestionCard({ related, onOpen, onLink, onDismiss }: SuggestionCardProps) {
  const { title } = rowText(related);
  return (
    <View style={styles.suggestion}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`연관 메모 제안: ${title}`}
        accessibilityHint="눌러서 메모를 엽니다"
        onPress={onOpen}
        style={({ pressed }) => [styles.suggestionText, pressed && styles.pressed]}
      >
        <Text style={styles.suggestionLabel}>이어지는 메모 같아요</Text>
        <Text style={styles.suggestionTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.suggestionDate}>{formatDate(related.updatedAt)}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="제안 무시"
        hitSlop={8}
        onPress={onDismiss}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
      >
        <Text style={styles.dismissLabel}>무시</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`'${title}'와 연결`}
        hitSlop={8}
        onPress={onLink}
        style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
      >
        <Text style={styles.linkLabel}>연결</Text>
      </Pressable>
    </View>
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
  threadSeparator: {
    marginLeft: SIDE_PADDING + THREAD_INDENT,
  },
  row: {
    paddingHorizontal: SIDE_PADDING,
    paddingVertical: 12,
    gap: 4,
  },
  childRow: {
    paddingLeft: SIDE_PADDING + THREAD_INDENT,
  },
  // 스레드에 이어진 메모 왼쪽의 세로선
  threadLine: {
    position: 'absolute',
    left: SIDE_PADDING + 2,
    top: 0,
    bottom: 0,
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.thread,
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
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: SIDE_PADDING + THREAD_INDENT,
    marginRight: SIDE_PADDING,
    marginBottom: 10,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 12,
    backgroundColor: colors.highlight,
  },
  suggestionText: {
    flex: 1,
    gap: 2,
  },
  suggestionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent,
  },
  suggestionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.ink,
  },
  suggestionDate: {
    fontSize: 13,
    color: colors.muted,
  },
  dismissButton: {
    paddingVertical: 6,
  },
  dismissLabel: {
    fontSize: 15,
    color: colors.muted,
  },
  linkButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: colors.accent,
  },
  linkLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.paper,
  },
  pressed: {
    opacity: 0.4,
  },
});
