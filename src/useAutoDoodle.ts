import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Platform, type AlertButton } from 'react-native';

import type { MemoDoodleChange, MemoLeaveParagraphEvent } from '../modules/memo-editor';
import { DOODLES } from './doodles/catalog';
import { doodleArt, DOODLE_STYLES, type DoodleStyle } from './doodles/presets';
import { DoodleIcon } from './icons';
import { suggestDoodle, type DoodleSuggestion } from './jevApi';
import { memoBlocks, nearbyLines, type MemoBlock } from './memoStorage';
import { loadSettings, saveSettings } from './settings';
import type { ShowToast } from './Toast';
import type { EditorIdle } from './useEditorIdle';

const MIN_LENGTH = 2;
const MAX_LINE_LENGTH = 500;
// 메모 하나에 붙이는 두들 수의 상한 (한 줄에는 하나)
const MAX_PER_MEMO = 30;
// 메모 전체를 훑을 때 묻는 줄 수와, 동시에 보내는 요청 수
const MAX_SCAN_LINES = 60;
const SCAN_CONCURRENCY = 5;
// 판단에 함께 보내는 주변 줄 (위로 몇 줄, 아래로 몇 줄)
const NEARBY_BEFORE = 3;
const NEARBY_AFTER = 2;

const CONSENT =
  '두들을 누르면 이 메모의 줄들과 제목을 TypeSafe AI(Jev)로 보내 그림으로 그릴 낱말을 찾고, 그 낱말을 작은 그림과 함께 칩으로 바꿔요. 두들을 붙인 메모는 새로 쓴 줄도 다 쓰고 넘어가면 같은 방법으로 찾아요. 어떤 그림으로 붙일까요?';

type Pick = DoodleSuggestion & { index: number; text: string };

/**
 * 두들: 메모에서 그림으로 그릴 만한 낱말을 Jev가 고르면, 그 낱말을 그림과 함께 칩으로 바꾼다.
 * - 두들 버튼: 두들이 없는 메모면 메모 전체를 훑어 줄마다 하나씩 붙이고, 있으면 그림 세트를 바꾸거나 모두 뗀다.
 * - 두들이 붙은 메모에서는 새로 쓴 줄도 다 쓰고 넘어가면 붙인다. 알림은 띄우지 않고 되돌리기로 뗄 수 있다.
 * 두들은 메모 내용이라 붙이고 떼는 일은 모두 되돌리기 한 번으로 돌아간다. 되돌리기로 뗀 줄에는 이 화면에서 다시 붙이지 않는다.
 */
export function useAutoDoodle(getTitle: () => string, getContent: () => string, idle: EditorIdle, showToast: ShowToast) {
  const [style, setStyle] = useState<DoodleStyle>(() => loadSettings().doodleStyle);
  const [decorated, setDecorated] = useState(() => hasDoodles(memoBlocks(getContent())));
  const [scanning, setScanning] = useState(false);
  const decoratedRef = useRef(decorated);
  const scanningRef = useRef(false);
  // 훑는 사이 화면이 닫히거나 새로 훑으면 늦게 온 답은 버린다.
  const scanId = useRef(0);
  const suggestions = useRef(new Map<string, DoodleSuggestion | null>());
  const undone = useRef(new Set<string>());
  const { whenIdle } = idle;

  useEffect(
    () => () => {
      scanId.current++;
    },
    [],
  );

  const setBusy = useCallback((busy: boolean) => {
    scanningRef.current = busy;
    setScanning(busy);
  }, []);

  /** 줄 하나에 붙일 두들. 같은 줄·제목·주변 줄이면 전에 받은 답을 쓴다. 답을 받지 못하면 undefined */
  const suggest = useCallback(
    async (blocks: MemoBlock[], index: number, text: string, title: string): Promise<DoodleSuggestion | null | undefined> => {
      const nearby = nearbyLines(blocks, index, text, NEARBY_BEFORE, NEARBY_AFTER);
      const key = JSON.stringify([title, text, nearby]);
      if (suggestions.current.has(key)) return suggestions.current.get(key);
      const answer = await suggestDoodle(title, text, nearby);
      if (answer === null) return undefined;
      suggestions.current.set(key, answer.doodle);
      return answer.doodle;
    },
    [],
  );

  const onLeaveParagraph = useCallback(
    async ({ index, text }: MemoLeaveParagraphEvent) => {
      if (!decoratedRef.current || scanningRef.current) return;
      // 줄을 나누며 떠나면 본문 변경보다 이 알림이 먼저 올 수 있어, 줄 내용은 붙이기 직전에 확인한다.
      const blocks = memoBlocks(getContent());
      if (!canPlace(blocks, index) || !eligible(text) || undone.current.has(text.trim())) return;

      const doodle = await suggest(blocks, index, text, getTitle().trim());
      if (!doodle) return;
      whenIdle(async (editor) => {
        if (!decoratedRef.current || !canPlace(memoBlocks(getContent()), index, text)) return;
        const [added] = await editor.setDoodles([{ index, text, ...change(doodle) }], false);
        // 화면에는 알림을 띄우지 않으니 화면 읽기 사용자에게만 알린다.
        if (added) AccessibilityInfo.announceForAccessibility(`${doodle.word} 옆에 ${doodleName(doodle.id)} 두들을 붙였어요`);
      });
    },
    [getContent, getTitle, suggest, whenIdle],
  );

  /**
   * 메모 전체를 훑어 두들이 없는 줄에 붙인다. 모두 한 번에 붙여 되돌리기 한 번으로 떨어진다.
   * 누른 동작이라 되돌렸던 줄도 다시 본다.
   */
  const scan = useCallback(async () => {
    const id = ++scanId.current;
    setBusy(true);
    const blocks = memoBlocks(getContent());
    const title = getTitle().trim();
    const targets = blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => !block.doodle && eligible(block.text))
      .slice(0, MAX_SCAN_LINES);
    const room = MAX_PER_MEMO - blocks.filter((block) => block.doodle).length;

    const answers = await pool(targets, SCAN_CONCURRENCY, async ({ block, index }) => {
      const doodle = await suggest(blocks, index, block.text, title);
      return doodle ? { ...doodle, index, text: block.text } : doodle;
    });
    if (id !== scanId.current) return;
    // 확실한 줄부터 자리만큼 고르고, 문서 순서로 붙인다. (칩이 위에서부터 차례로 나타난다)
    const picks = answers
      .filter((pick): pick is Pick => !!pick)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, Math.max(0, room))
      .sort((a, b) => a.index - b.index);
    if (picks.length === 0) {
      setBusy(false);
      // 답을 하나도 받지 못했으면 찾지 못한 게 아니라 서버에 닿지 못한 것이다.
      const unreachable = answers.length > 0 && answers.every((answer) => answer === undefined);
      const message = unreachable ? '지금은 두들을 찾을 수 없어요. 잠시 뒤에 다시 해 주세요' : '두들로 바꿀 낱말을 찾지 못했어요';
      showToast(message, { muted: true, icon: DoodleIcon });
      return;
    }
    whenIdle(async (editor) => {
      if (id !== scanId.current) return;
      const changes: MemoDoodleChange[] = picks.map((pick) => ({ index: pick.index, text: pick.text, ...change(pick) }));
      try {
        const applied = await editor.setDoodles(changes, true);
        if (id !== scanId.current) return;
        const count = applied.filter(Boolean).length;
        if (count === 0) {
          showToast('그 사이 메모가 바뀌어 두들을 붙이지 못했어요', { muted: true, icon: DoodleIcon });
        } else {
          AccessibilityInfo.announceForAccessibility(`낱말 ${count}개를 두들로 바꿨어요`);
        }
      } finally {
        if (id === scanId.current) setBusy(false);
      }
    });
  }, [getContent, getTitle, setBusy, showToast, suggest, whenIdle]);

  const removeAll = useCallback(() => {
    scanId.current++;
    setBusy(false);
    whenIdle(async (editor) => {
      const removed = await editor.removeDoodles();
      if (removed > 0) AccessibilityInfo.announceForAccessibility(`두들 ${removed}개를 뗐어요`);
    });
  }, [setBusy, whenIdle]);

  const changeStyle = useCallback((next: DoodleStyle) => {
    saveSettings({ doodleStyle: next });
    setStyle(next);
  }, []);

  /** 두들 버튼. 두들이 없으면 메모 전체를 훑고, 있으면 다시 훑거나 그림 세트를 바꾸거나 모두 뗀다. */
  const press = useCallback(() => {
    if (scanningRef.current) return;
    if (decoratedRef.current) {
      const other = DOODLE_STYLES.find((item) => item.id !== style) ?? DOODLE_STYLES[0];
      // 두들이 없는 줄(새로 쓴 줄, 답을 받지 못한 줄)만 다시 본다.
      const rescan: AlertButton = { text: '다시 훑기', onPress: scan };
      const restyle: AlertButton = { text: `${other.name}로 바꾸기`, onPress: () => changeStyle(other.id) };
      const remove: AlertButton = { text: '모두 떼기', style: 'destructive', onPress: removeAll };
      // Android 알림은 버튼을 셋(왼쪽부터 중립·부정·긍정)까지만 보여 주므로 취소는 뒤로 가기나 바깥 누르기로 한다.
      const buttons =
        Platform.OS === 'android' ? [remove, restyle, rescan] : [rescan, restyle, remove, { text: '취소', style: 'cancel' as const }];
      Alert.alert('두들', '이 메모의 두들을 어떻게 할까요?', buttons, { cancelable: true });
      return;
    }
    if (loadSettings().doodlesConsented) {
      scan();
      return;
    }
    Alert.alert('두들', CONSENT, [
      { text: '취소', style: 'cancel' },
      ...DOODLE_STYLES.map((item) => ({
        text: item.name,
        onPress: () => {
          saveSettings({ doodleStyle: item.id, doodlesConsented: true });
          setStyle(item.id);
          scan();
        },
      })),
    ]);
  }, [changeStyle, removeAll, scan, style]);

  /** 본문이 바뀔 때마다 부른다. 두들이 있는 메모인지 살피고, 되돌리기로 두들이 떨어진 줄은 기억해 둔다. */
  const onChangeContent = useCallback((previous: string, next: string, fromHistory: boolean) => {
    const blocks = memoBlocks(next);
    const has = hasDoodles(blocks);
    if (has !== decoratedRef.current) {
      decoratedRef.current = has;
      setDecorated(has);
    }
    if (!fromHistory) return;
    for (const line of removedDoodles(memoBlocks(previous), blocks)) undone.current.add(line);
  }, []);

  const art = useMemo(() => doodleArt(style), [style]);

  return { decorated, scanning, art, press, onLeaveParagraph, onChangeContent };
}

const hasDoodles = (blocks: MemoBlock[]) => blocks.some((block) => block.doodle);

const eligible = (text: string) => text.trim().length >= MIN_LENGTH && text.length <= MAX_LINE_LENGTH;

const change = ({ id, word, start, length }: DoodleSuggestion) => ({ id, word, start, length });

/** 한 줄에 하나, 메모에 아직 자리가 남았을 때만. text를 주면 그 줄의 내용도 확인한다. */
function canPlace(blocks: MemoBlock[], index: number, text?: string) {
  const block = blocks[index];
  if (!block || block.doodle || (text !== undefined && block.text !== text)) return false;
  return blocks.filter((item) => item.doodle).length < MAX_PER_MEMO;
}

/** 두들이 붙어 있다가 떨어진 줄들 */
function removedDoodles(previous: MemoBlock[], next: MemoBlock[]): string[] {
  const had = new Set(previous.filter((block) => block.doodle).map((block) => block.text.trim()));
  return next.filter((block) => !block.doodle && had.has(block.text.trim())).map((block) => block.text.trim());
}

/** 한 번에 size개씩 실행한다. 결과는 items 순서대로 */
async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
      }
    }),
  );
  return results;
}

const doodleName = (id: keyof typeof DOODLES) => DOODLES[id].split(/[·(]/)[0].trim();
