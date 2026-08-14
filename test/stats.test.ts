/**
 * Champions 수치의 정체를 고정하는 테스트.
 *
 * 처음 구현에서 이 값들을 '종족값'이라고 라벨링했는데 틀렸다.
 * 실제로는 레벨 50 · 개체값 31 · 노력치 0 · 무보정 성격의 **실수치**다.
 * 같은 오해가 다시 들어오지 않도록 본가 종족값과의 관계를 못박는다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeIndex } from '../src/adapters/championsBattleData';
import { STAT_BASIS, toActualStat, toBaseStat, toBaseStats } from '../src/core/stats';

const rawIndex = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'api-index.sample.json'), 'utf8'),
);

/** 본가 종족값 (공개 자료). 픽스처에 들어 있는 종만 넣는다. */
const OFFICIAL_BASE = {
  Garchomp: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
  'Mega Garchomp': { hp: 108, atk: 170, def: 115, spa: 120, spd: 95, spe: 92 },
  'Alolan Ninetales': { hp: 73, atk: 67, def: 75, spa: 81, spd: 100, spe: 109 },
  'Alolan Raichu': { hp: 60, atk: 85, def: 50, spa: 95, spd: 85, spe: 110 },
} as const;

describe('실수치 ↔ 종족값 환산', () => {
  it('전제를 문서화한 상수가 실제 계산과 맞는다', () => {
    expect(STAT_BASIS).toEqual({ level: 50, iv: 31, ev: 0, natureNeutral: true });
  });

  it('본가 공식과 일치한다 (레벨 50, 개체값 31, 노력치 0)', () => {
    // HP   = floor((2b + 31) * 50/100) + 50 + 10
    // 그외 = floor((2b + 31) * 50/100) + 5
    const byFormula = (base: number, isHp: boolean) =>
      Math.floor((2 * base + 31) * 0.5) + (isHp ? 60 : 5);

    for (const base of [1, 45, 60, 90, 108, 130, 170, 255]) {
      expect(toActualStat(base, true)).toBe(byFormula(base, true));
      expect(toActualStat(base, false)).toBe(byFormula(base, false));
    }
  });

  it('실수치는 종족값 + 20, HP 만 + 75 다', () => {
    expect(toActualStat(130, false)).toBe(150);
    expect(toActualStat(108, true)).toBe(183);
  });

  it('왕복 변환이 정확하다 (floor 손실이 없다)', () => {
    for (const base of [1, 30, 55, 90, 108, 150, 200, 255]) {
      expect(toBaseStat(toActualStat(base, true), true)).toBe(base);
      expect(toBaseStat(toActualStat(base, false), false)).toBe(base);
    }
  });

  it('전제가 깨진 값(너무 작은 수치)은 null 로 알린다', () => {
    expect(toBaseStat(10, true)).toBeNull();
    expect(toBaseStat(5, false)).toBeNull();
    // 경계: 종족값 1 이 나오는 값은 통과해야 한다.
    expect(toBaseStat(76, true)).toBe(1);
    expect(toBaseStat(21, false)).toBe(1);
  });
});

describe('실제 로스터 데이터로 검증', () => {
  const index = normalizeIndex(rawIndex);
  const forms = new Map(
    index.pokemon.flatMap((mon) => mon.forms.map((f) => [f.savedName, f] as const)),
  );

  for (const [name, official] of Object.entries(OFFICIAL_BASE)) {
    it(`${name} 의 API 수치를 종족값으로 되돌리면 본가 값과 같다`, () => {
      const form = forms.get(name);
      expect(form, `${name} 이 픽스처에 없습니다`).toBeDefined();

      const base = toBaseStats(form!.stats);
      expect(base.hp).toBe(official.hp);
      expect(base.atk).toBe(official.atk);
      expect(base.def).toBe(official.def);
      expect(base.spa).toBe(official.spa);
      expect(base.spd).toBe(official.spd);
      expect(base.spe).toBe(official.spe);
    });
  }

  it('환산한 종족값 합계가 본가 종족값 합과 같다', () => {
    const base = toBaseStats(forms.get('Garchomp')!.stats);
    // 한카리아스 본가 종족값 합 = 600
    expect(base.total).toBe(600);
  });

  it('로스터 전체에서 환산이 성립한다 (전제가 일부만 맞는 게 아니다)', () => {
    let converted = 0;
    for (const form of forms.values()) {
      const base = toBaseStats(form.stats);
      expect(base.total).not.toBeNull();
      // 본가 종족값은 1~255 범위를 벗어나지 않는다.
      for (const key of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
        expect(base[key]).toBeGreaterThanOrEqual(1);
        expect(base[key]).toBeLessThanOrEqual(255);
      }
      converted += 1;
    }
    expect(converted).toBeGreaterThan(0);
  });

  it('API 의 total 은 6개 실수치의 단순 합이다', () => {
    for (const form of forms.values()) {
      const s = form.stats;
      expect(s.hp + s.atk + s.def + s.spa + s.spd + s.spe).toBe(s.total);
    }
  });
});
