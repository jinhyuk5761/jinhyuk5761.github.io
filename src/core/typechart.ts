/**
 * 타입 상성표 (6세대 이후 규칙) — M4 비교 화면에서 쓴다.
 *
 * 1배는 생략하고 예외만 적는다. 표가 짧을수록 오타를 잡기 쉽다.
 */

import type { TypeName } from '../types';

export const ALL_TYPES: TypeName[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];

/** 공격 타입 → 방어 타입별 배율. 여기 없으면 1배. */
const CHART: Record<TypeName, Partial<Record<TypeName, number>>> = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: {
    Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2,
    Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5,
  },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: {
    Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5,
    Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5,
  },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: {
    Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5,
    Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5,
  },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

/** 공격 타입 하나가 주어진 방어 타입 조합에 내는 최종 배율. */
export function effectiveness(attacking: TypeName, defending: TypeName[]): number {
  let multiplier = 1;
  for (const defender of defending) {
    multiplier *= CHART[attacking]?.[defender] ?? 1;
  }
  return multiplier;
}

export interface DefensiveProfile {
  /** 배율별로 묶은 공격 타입 목록. 1배는 제외한다. */
  weaknesses: { multiplier: number; types: TypeName[] }[];
  resistances: { multiplier: number; types: TypeName[] }[];
  immunities: TypeName[];
}

/** 방어 타입 조합의 약점/내성/무효를 한 번에 정리한다. */
export function defensiveProfile(defending: TypeName[]): DefensiveProfile {
  const byMultiplier = new Map<number, TypeName[]>();
  for (const attacking of ALL_TYPES) {
    const multiplier = effectiveness(attacking, defending);
    if (multiplier === 1) continue;
    const list = byMultiplier.get(multiplier) ?? [];
    list.push(attacking);
    byMultiplier.set(multiplier, list);
  }

  const group = (predicate: (m: number) => boolean, descending: boolean) =>
    [...byMultiplier.entries()]
      .filter(([m]) => predicate(m))
      .sort((a, b) => (descending ? b[0] - a[0] : a[0] - b[0]))
      .map(([multiplier, types]) => ({ multiplier, types }));

  return {
    weaknesses: group((m) => m > 1, true),
    resistances: group((m) => m > 0 && m < 1, false),
    immunities: byMultiplier.get(0) ?? [],
  };
}
