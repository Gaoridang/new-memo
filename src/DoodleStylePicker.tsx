import { Fragment } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { DoodleId } from './doodles/catalog';
import { doodleArt, DOODLE_STYLES, type DoodleStyle } from './doodles/presets';
import { CheckIcon } from './icons';
import { saveSettings, useSettings } from './settings';
import { colors } from './theme';

// 그림 세트마다 보여 주는 두들 칩
const SAMPLES: { id: DoodleId; word: string }[] = [
  { id: 'coffee', word: '커피' },
  { id: 'cat', word: '고양이' },
  { id: 'cake', word: '케이크' },
];
// 메모 본문(18pt)보다 조금 작게, 칩 치수는 편집기와 같은 비율로 (MemoDocument.swift의 DoodleMetrics)
const FONT_SIZE = 16;
const DOODLE_SIZE = FONT_SIZE;
const CHIP_HEIGHT = 26;
// 스티커의 흰 테두리와 그림자는 24x24 격자 밖으로 조금 나가므로 그만큼 넓게 그린다.
const ART_OVERFLOW = 3;

/** 두들 그림 세트(파스텔, 스티커) 고르기. 고르면 열려 있는 메모의 두들도 바로 바뀐다. */
export function DoodleStylePicker() {
  const { doodleStyle } = useSettings();
  return (
    <View style={styles.card} accessibilityRole="radiogroup">
      {DOODLE_STYLES.map((style, i) => {
        const selected = style.id === doodleStyle;
        return (
          <Fragment key={style.id}>
            {i > 0 && <View style={styles.divider} />}
            <Pressable
              accessibilityRole="radio"
              accessibilityLabel={style.name}
              accessibilityState={{ checked: selected }}
              onPress={() => saveSettings({ doodleStyle: style.id })}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowText}>
                <Text style={styles.name}>{style.name}</Text>
                <View style={styles.samples}>
                  {SAMPLES.map((sample) => (
                    <DoodleChip key={sample.id} style={style.id} {...sample} />
                  ))}
                </View>
              </View>
              <View style={styles.check}>{selected && <CheckIcon color={colors.accent} />}</View>
            </Pressable>
          </Fragment>
        );
      })}
    </View>
  );
}

/** 편집기가 두들이 붙은 낱말을 그리는 모양 그대로: 낱말과 그 뒤의 그림을 칩으로 감싼다. */
function DoodleChip({ style, id, word }: { style: DoodleStyle; id: DoodleId; word: string }) {
  const art = doodleArt(style).find((entry) => entry.id === id);
  if (!art) return null;
  const drawn = DOODLE_SIZE * ((24 + ART_OVERFLOW * 2) / 24);
  return (
    <View style={[styles.chip, { backgroundColor: art.chipFill }]}>
      <Text style={styles.word}>{word}</Text>
      <Svg
        width={drawn}
        height={drawn}
        viewBox={`${-ART_OVERFLOW} ${-ART_OVERFLOW} ${24 + ART_OVERFLOW * 2} ${24 + ART_OVERFLOW * 2}`}
        style={{ margin: -(drawn - DOODLE_SIZE) / 2 }}
      >
        {art.ops.map((op, i) => (
          <Path
            key={i}
            d={op.d}
            fill={op.fill ?? 'none'}
            stroke={op.stroke ?? 'none'}
            strokeWidth={op.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={op.opacity}
            transform={op.dx || op.dy ? `translate(${op.dx ?? 0} ${op.dy ?? 0})` : undefined}
          />
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  // 메모처럼 흰 바탕에 그려야 칩이 편집기에서와 같아 보인다.
  card: {
    marginHorizontal: 20,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    backgroundColor: colors.paper,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pressed: {
    opacity: 0.4,
  },
  rowText: {
    flex: 1,
    gap: 10,
  },
  name: {
    fontSize: 16,
    color: colors.ink,
  },
  samples: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CHIP_HEIGHT,
    borderRadius: CHIP_HEIGHT / 2,
    paddingLeft: Math.round(FONT_SIZE * 0.28) + 2,
    paddingRight: Math.round(FONT_SIZE * 0.28),
    gap: Math.round(FONT_SIZE * 0.17),
  },
  word: {
    fontSize: FONT_SIZE,
    color: colors.ink,
  },
  check: {
    width: 20,
    alignItems: 'center',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14,
    backgroundColor: colors.divider,
  },
});
