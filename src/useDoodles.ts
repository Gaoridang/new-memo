import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import type { MemoDoodleChange } from '../modules/memo-editor';
import { doodleArt } from './doodles/presets';
import { DoodleIcon } from './icons';
import { suggestDoodles, type DoodleSuggestion } from './jevApi';
import { memoBlocks, nearbyLines, type MemoBlock } from './memoStorage';
import { loadSettings, saveSettings, useSettings } from './settings';
import type { ShowToast } from './Toast';
import type { EditorIdle } from './useEditorIdle';

const MIN_LENGTH = 2;
const MAX_LINE_LENGTH = 500;
// 메모 하나에 붙이는 두들 수의 상한 (낱말마다 붙으니 한 줄에 여럿일 수 있다)
const MAX_PER_MEMO = 60;
// 메모 전체를 훑을 때 묻는 줄 수와, 동시에 보내는 요청 수
const MAX_SCAN_LINES = 60;
const SCAN_CONCURRENCY = 5;
// 판단에 함께 보내는 주변 줄 (위로 몇 줄, 아래로 몇 줄)
const NEARBY_BEFORE = 3;
const NEARBY_AFTER = 2;

const CONSENT =
  '두들을 누르면 이 메모의 줄들과 제목을 TypeSafe AI(Jev)로 보내 그림으로 그릴 낱말을 찾고, 그 낱말을 작은 그림과 함께 칩으로 바꿔요. 글을 쓰는 사이에는 붙이지 않으니, 새로 쓴 줄에 붙이려면 다시 눌러 주세요. 그림 모양(파스텔, 스티커)은 설정에서 고를 수 있어요.';

type Pick = DoodleSuggestion & { index: number; text: string };

/**
 * 두들: 메모에서 그림으로 그릴 만한 낱말을 Jev가 고르면, 그 낱말을 그림과 함께 칩으로 바꾼다. 그림은 낱말마다 붙는다.
 * 두들은 버튼을 눌렀을 때만 붙는다. 글을 쓰거나 줄을 넘어가는 사이에는 붙이지 않는다.
 * - 두들 버튼은 붙이기만 한다. 메모를 훑어 아직 두들이 없는 낱말마다 한 번에 붙인다. 그림 세트는 설정 화면에서 고른다.
 * 두들은 메모 내용이라 붙이는 일은 되돌리기 한 번으로 돌아간다. 떼려면 칩 바로 뒤에서 지운다.
 */
export function useDoodles(getTitle: () => string, getContent: () => string, idle: EditorIdle, showToast: ShowToast) {
  const style = useSettings().doodleStyle;
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);
  // 훑는 사이 화면이 닫히거나 새로 훑으면 늦게 온 답은 버린다.
  const scanId = useRef(0);
  const suggestions = useRef(new Map<string, DoodleSuggestion[]>());
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

  /** 줄 하나에 붙일 두들들 (이미 두들이 붙은 낱말도 들어 있다). 같은 줄·제목·주변 줄이면 전에 받은 답을 쓴다. 답을 받지 못하면 undefined */
  const suggest = useCallback(
    async (blocks: MemoBlock[], index: number, text: string, title: string): Promise<DoodleSuggestion[] | undefined> => {
      const nearby = nearbyLines(blocks, index, text, NEARBY_BEFORE, NEARBY_AFTER);
      const key = JSON.stringify([title, text, nearby]);
      const known = suggestions.current.get(key);
      if (known) return known;
      const answer = await suggestDoodles(title, text, nearby);
      if (answer === null) return undefined;
      suggestions.current.set(key, answer);
      return answer;
    },
    [],
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
    // 두들이 붙은 줄에도 아직 붙지 않은 낱말이 있을 수 있어 모든 줄을 본다. 줄이 많으면 두들이 없는 줄부터 본다.
    const lines = blocks.map((block, index) => ({ block, index })).filter(({ block }) => eligible(block.text));
    const targets = [
      ...lines.filter(({ block }) => block.doodles.length === 0),
      ...lines.filter(({ block }) => block.doodles.length > 0),
    ].slice(0, MAX_SCAN_LINES);
    const room = MAX_PER_MEMO - countDoodles(blocks);

    const answers = await pool(targets, SCAN_CONCURRENCY, async ({ block, index }) => {
      const doodles = await suggest(blocks, index, block.text, title);
      return doodles && placeable(block, undefined, doodles).map((doodle) => ({ ...doodle, index, text: block.text }));
    });
    if (id !== scanId.current) return;
    // 확실한 낱말부터 자리만큼 고르고, 문서 순서로 붙인다. (칩이 위에서부터 차례로 나타난다)
    const picks = answers
      .flatMap((lineAnswer): Pick[] => lineAnswer ?? [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, Math.max(0, room))
      .sort((a, b) => a.index - b.index || a.start - b.start);
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

  /**
   * 두들 버튼. 묻지 않고 메모를 훑어 두들이 없는 낱말(새로 쓴 줄, 답을 받지 못한 줄)에 붙인다.
   * 처음 한 번만 메모 내용을 보내도 되는지 묻는다.
   */
  const press = useCallback(() => {
    if (scanningRef.current) return;
    if (loadSettings().doodlesConsented) {
      scan();
      return;
    }
    Alert.alert('두들', CONSENT, [
      { text: '취소', style: 'cancel' },
      {
        text: '붙이기',
        onPress: () => {
          saveSettings({ doodlesConsented: true });
          scan();
        },
      },
    ]);
  }, [scan]);

  const art = useMemo(() => doodleArt(style), [style]);

  return { scanning, art, press };
}

const countDoodles = (blocks: MemoBlock[]) => blocks.reduce((sum, block) => sum + block.doodles.length, 0);

const eligible = (text: string) => text.trim().length >= MIN_LENGTH && text.length <= MAX_LINE_LENGTH;

const change = ({ id, word, start, length }: DoodleSuggestion) => ({ id, word, start, length });

/**
 * 그 줄에 지금 붙일 수 있는 두들: 아직 두들이 없는 낱말의 것. text를 주면 그 줄의 내용도 확인한다.
 * 칩은 띄어쓰기 사이 낱말 전체를 감싸므로, 칩과 조금이라도 겹치는 낱말('청소기칫솔'의 '칫솔')은 이미 붙은 것이다.
 */
function placeable<T extends DoodleSuggestion>(block: MemoBlock | undefined, text: string | undefined, doodles: T[]): T[] {
  if (!block || (text !== undefined && block.text !== text)) return [];
  return doodles.filter(
    (doodle) => !block.doodles.some((chip) => doodle.start < chip.start + chip.word.length && chip.start < doodle.start + doodle.length),
  );
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
