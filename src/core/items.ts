/**
 * 대미지에 관여하는 지닌 도구.
 *
 * **여기 있는 도구는 전부 Champions 에 실재한다.** 목록은 배틀 데이터의 `held_item`
 * 집계(= `public/data/terms.json` 의 141종)와 교차 확인해 만들었다. 본가에는 있지만
 * Champions 에 없는 도구(구애머리띠·구애안경·돌격조끼·진화의휘석 등)는 넣지 않는다.
 * 없는 도구를 목록에 두면 "골랐는데 실제로는 못 드는 조합"을 계산하게 된다.
 *
 * 배율은 Showdown `data/items.ts` 에서 뽑았다(타입 강화 4915/4096 ≈ 1.2 등).
 * 한국어 표기는 여기 적지 않는다 — `terms.json` 의 공식 표기를 `itemName()` 으로 가져온다.
 * 손으로 옮기면 '달인의띠'를 '전문가벨트'라고 쓰는 일이 또 생긴다.
 */

import type { TypeName } from '../types';

export interface ItemEffect {
  /** 도감 조회 키. 한국어 표기는 terms.json 에서 가져온다. */
  name: string;
  /** 무엇을 하는 도구인지 한 줄 설명. 선택지 옆에 붙는다. */
  note: string;

  /** 위력 단계 배율 (최종 대미지 배율과 반올림 시점이 다르다) */
  powerMultiplier?: number;
  /** 이 타입 기술일 때만 powerMultiplier 를 적용한다 */
  boostsType?: TypeName;
  /** 이 분류일 때만 powerMultiplier 를 적용한다 */
  boostsCategory?: 'physical' | 'special';

  /** 최종 대미지 배율 */
  damageMultiplier?: number;
  /** 효과가 굉장할 때만 damageMultiplier 를 적용한다 */
  superEffectiveOnly?: boolean;
  /** 이 타입이면서 효과가 굉장한 기술을 반감한다 (반감 열매) */
  resistsType?: TypeName;

  attackMultiplier?: number;
  defenseMultiplier?: number;
  specialDefenseOnly?: boolean;
  /** 스피드 실수치 배율. 자이로볼·일렉트릭볼의 위력이 달라진다. */
  speedMultiplier?: number;
  /** 만피에서 한 방을 버틴다 */
  endures?: boolean;
}

/** 해당 타입 기술의 위력을 1.2배로 올리는 도구. Showdown 의 chainModify([4915, 4096]). */
const TYPE_BOOST_ITEMS: [string, TypeName][] = [
  ['Silk Scarf', 'Normal'],
  ['Charcoal', 'Fire'],
  ['Mystic Water', 'Water'],
  ['Magnet', 'Electric'],
  ['Miracle Seed', 'Grass'],
  ['Never-Melt Ice', 'Ice'],
  ['Black Belt', 'Fighting'],
  ['Poison Barb', 'Poison'],
  ['Soft Sand', 'Ground'],
  ['Sharp Beak', 'Flying'],
  ['Twisted Spoon', 'Psychic'],
  ['Silver Powder', 'Bug'],
  ['Hard Stone', 'Rock'],
  ['Spell Tag', 'Ghost'],
  ['Dragon Fang', 'Dragon'],
  ['Black Glasses', 'Dark'],
  ['Metal Coat', 'Steel'],
  ['Fairy Feather', 'Fairy'],
];

/** 효과가 굉장한 해당 타입 기술을 반감하는 열매. */
const RESIST_BERRIES: [string, TypeName][] = [
  ['Occa Berry', 'Fire'],
  ['Passho Berry', 'Water'],
  ['Wacan Berry', 'Electric'],
  ['Rindo Berry', 'Grass'],
  ['Yache Berry', 'Ice'],
  ['Chople Berry', 'Fighting'],
  ['Kebia Berry', 'Poison'],
  ['Shuca Berry', 'Ground'],
  ['Coba Berry', 'Flying'],
  ['Payapa Berry', 'Psychic'],
  ['Tanga Berry', 'Bug'],
  ['Charti Berry', 'Rock'],
  ['Kasib Berry', 'Ghost'],
  ['Haban Berry', 'Dragon'],
  ['Colbur Berry', 'Dark'],
  ['Babiri Berry', 'Steel'],
  ['Roseli Berry', 'Fairy'],
];

/** 공격측이 들면 대미지가 달라지는 도구. */
export const ATTACKER_ITEMS: ItemEffect[] = [
  { name: 'Life Orb', note: '대미지 ×1.3', damageMultiplier: 1.3 },
  { name: 'Expert Belt', note: '효과 굉장 시 ×1.2', damageMultiplier: 1.2, superEffectiveOnly: true },
  { name: 'Muscle Band', note: '물리 위력 ×1.1', powerMultiplier: 1.1, boostsCategory: 'physical' },
  { name: 'Wise Glasses', note: '특수 위력 ×1.1', powerMultiplier: 1.1, boostsCategory: 'special' },
  // 대미지 배율은 없지만 스피드를 바꿔 자이로볼·일렉트릭볼의 위력을 흔든다.
  { name: 'Choice Scarf', note: '스피드 ×1.5', speedMultiplier: 1.5 },
  ...TYPE_BOOST_ITEMS.map(([name, type]) => ({
    name,
    note: `${type} 기술 위력 ×1.2`,
    powerMultiplier: 1.2,
    boostsType: type,
  })),
];

/** 방어측이 들면 대미지가 달라지는 도구. */
export const DEFENDER_ITEMS: ItemEffect[] = [
  { name: 'Focus Sash', note: '만피에서 한 방 버팀', endures: true },
  ...RESIST_BERRIES.map(([name, type]) => ({
    name,
    note: `효과 굉장한 ${type} 기술 ×0.5`,
    damageMultiplier: 0.5,
    superEffectiveOnly: true,
    resistsType: type,
  })),
];

/**
 * 계산에는 넣지 않는 도구와 그 이유. 화면에 그대로 밝힌다.
 *
 * 목록에서 조용히 빼면 "지원하는데 안 걸리는 건지, 아예 없는 건지" 알 수 없다.
 */
export const UNSUPPORTED_ITEMS = new Map<string, string>([
  ['Focus Band', '10% 확률로 버텨서 한 번의 계산으로 확정할 수 없습니다'],
  ['Light Ball', '피카츄 전용이라 종 판정이 필요합니다'],
  ['Scope Lens', '급소율만 올립니다 — 급소 항목을 켜서 확인하세요'],
  ["King's Rock", '풀죽음 확률이라 대미지에는 영향이 없습니다'],
  ['Leftovers', '턴마다 회복이라 한 방 대미지에는 영향이 없습니다'],
  ['Shell Bell', '공격 후 회복이라 대미지 자체는 그대로입니다'],
]);

/** 위력 단계에 곱할 배율. 조건이 안 맞으면 1. */
export function itemPowerMultiplier(
  item: ItemEffect | null,
  moveType: TypeName,
  category: 'physical' | 'special',
): number {
  if (!item?.powerMultiplier) return 1;
  if (item.boostsType && item.boostsType !== moveType) return 1;
  if (item.boostsCategory && item.boostsCategory !== category) return 1;
  return item.powerMultiplier;
}

/** 최종 대미지에 곱할 배율. 조건이 안 맞으면 1. */
export function itemDamageMultiplier(
  item: ItemEffect | null,
  moveType: TypeName,
  typeEffectiveness: number,
): number {
  if (!item?.damageMultiplier) return 1;
  // 반감 열매는 "그 타입" 이면서 "효과가 굉장" 해야 발동한다.
  if (item.resistsType && item.resistsType !== moveType) return 1;
  if (item.superEffectiveOnly && typeEffectiveness <= 1) return 1;
  return item.damageMultiplier;
}

export function findItem(list: ItemEffect[], name: string): ItemEffect | null {
  return list.find((item) => item.name === name) ?? null;
}
