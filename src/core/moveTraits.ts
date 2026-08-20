/**
 * 기술의 성질 표기 — 광역 범위와 플래그(펀치·접촉·소리…).
 *
 * 왜 필요한가:
 *   1. 광역기는 더블에서 대미지가 0.75배가 된다. 그런데 **상대만 때리는 광역**과
 *      **아군까지 때리는 광역**은 쓰임이 완전히 다르다(지진은 파트너도 맞는다).
 *   2. 펀치·접촉·소리 같은 플래그는 철주먹·불꽃몸·방음처럼 특성 판정을 좌우한다.
 *      이미 계산에는 쓰고 있었는데 화면에는 안 보여서, 왜 그 배율이 붙었는지 알 수 없었다.
 *
 * 범위는 PokéAPI 의 target, 플래그는 Showdown 의 flags 에서 온다. 둘 다 이미 받아둔 값이다.
 */

import type { MoveInfo } from '../adapters/moveDex';

/** 광역 범위. null 이면 단일 대상이다. */
export type SpreadScope = 'foes' | 'allAdjacent' | 'all';

const SPREAD_BY_TARGET: Record<string, SpreadScope> = {
  // 상대만 전부 (눈보라·암석봉인 등)
  'all-opponents': 'foes',
  // 자신을 뺀 전원 — 아군도 맞는다 (지진·폭발 등)
  'all-other-pokemon': 'allAdjacent',
  // 자신을 포함한 전원
  'all-pokemon': 'all',
};

const SPREAD_LABEL: Record<SpreadScope, string> = {
  foes: '광역 · 상대 전체',
  allAdjacent: '광역 · 아군 포함',
  all: '광역 · 자신 포함 전원',
};

/**
 * 플래그 한국어 표기. Showdown 의 flags 이름을 그대로 키로 쓴다.
 *
 * 계산이나 특성 판정에 실제로 얽히는 것만 둔다. 표시용 잡다한 플래그
 * (protect·mirror·metronome 등)는 화면을 시끄럽게만 해서 뺐다.
 */
const FLAG_LABELS: [string, string][] = [
  ['punch', '펀치'],
  ['sound', '소리'],
  ['slicing', '참격'],
  ['bullet', '탄환'],
  ['wind', '바람'],
  ['bite', '물기'],
  ['pulse', '파동'],
  ['powder', '가루'],
];

export function spreadScopeOf(move: MoveInfo): SpreadScope | null {
  return SPREAD_BY_TARGET[move.target ?? ''] ?? null;
}

/** 더블에서 대미지가 0.75배가 되는가. 싱글에서는 광역이어도 줄지 않는다. */
export function isSpreadMove(move: MoveInfo): boolean {
  return spreadScopeOf(move) !== null;
}

export interface MoveTrait {
  /** 화면에 찍을 말 */
  label: string;
  /** 스타일 구분용 종류 */
  kind: 'spread' | 'contact' | 'flag' | 'defense';
}

/**
 * 이 기술에 붙일 표기들.
 *
 * 접촉 여부는 **있을 때만이 아니라 없을 때도** 적는다. 방어측 특성(까칠한피부·불꽃몸)
 * 판정이 갈리는 지점이라 "표기가 없는 것"과 "비접촉인 것"을 구별할 수 있어야 한다.
 */
export function traitsOf(move: MoveInfo): MoveTrait[] {
  const traits: MoveTrait[] = [];

  const scope = spreadScopeOf(move);
  if (scope) traits.push({ label: SPREAD_LABEL[scope], kind: 'spread' });

  // 분류와 다른 방어를 보는 기술(사이코쇼크)은 그 사실이 안 보이면 숫자가 틀린 줄 안다.
  if (readsOppositeDefense(move)) {
    traits.push({
      label: defensiveCategory(move) === 'physical' ? '상대 방어로 계산' : '상대 특방으로 계산',
      kind: 'defense',
    });
  }

  // 변화기술에는 접촉 개념을 붙이지 않는다 (대미지를 주지 않으므로 의미가 없다).
  if (move.damageClass === 'physical' || move.damageClass === 'special') {
    traits.push(
      move.flags.has('contact')
        ? { label: '접촉', kind: 'contact' }
        : { label: '비접촉', kind: 'contact' },
    );
  }

  for (const [flag, label] of FLAG_LABELS) {
    if (move.flags.has(flag)) traits.push({ label, kind: 'flag' });
  }

  return traits;
}

/**
 * 특수기인데 상대의 **방어**를 보고 계산하는 기술.
 *
 * 사이코쇼크는 특수 기술이라 공격은 특공으로 하지만, 나누는 값이 특방이 아니라 방어다.
 * 그냥 특수기로 계산하면 특방만 두꺼운 상대에게 실제보다 훨씬 적은 대미지가 나온다.
 *
 * 목록에 두는 셋 중 지금 로스터에 있는 건 사이코쇼크뿐이지만, 나머지 둘도 같은 규칙이라
 * 나중에 들어와도 그대로 맞는다.
 */
const DEFENSE_READ_AS_PHYSICAL = new Set(['Psyshock', 'Psystrike', 'Secret Sword']);

/**
 * 이 기술이 상대의 어느 방어 실수치를 보는가.
 *
 * 기술 분류(물리/특수)와 **다를 수 있다**. 공격 실수치·화상·장막 판정은 분류를 따르고,
 * 방어 실수치와 그 실수치를 건드리는 보정(두꺼운털가죽·모래바람 바위 특방 등)만 이 값을 따른다.
 */
export function defensiveCategory(move: MoveInfo): 'physical' | 'special' {
  if (move.damageClass === 'special' && DEFENSE_READ_AS_PHYSICAL.has(move.englishName)) {
    return 'physical';
  }
  return move.damageClass === 'physical' ? 'physical' : 'special';
}

/** 분류와 보는 방어가 어긋나는가. 화면에 그 사실을 적어 주기 위한 판정이다. */
export function readsOppositeDefense(move: MoveInfo): boolean {
  return (
    (move.damageClass === 'physical' || move.damageClass === 'special') &&
    defensiveCategory(move) !== move.damageClass
  );
}
