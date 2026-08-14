/**
 * 대미지 계산 — 설계 문서 1절 "계산기는 로직 포팅이지 패키지 실행 아님".
 *
 * 본가 공식(5세대 이후 계산 순서)을 그대로 구현한다. 공식 자체는 공개된 게임 수식이다.
 *
 * Champions 특유의 유리한 점:
 *   championsbattledata 가 주는 수치는 이미 **레벨 50 실수치**(개체값 31 / 노력치 0 / 무보정)다.
 *   노력치도 "포인트" = 그 스탯이 실제로 오른 양으로 온다(공격 32 = 252노력치).
 *   그래서 종족값 → 실수치 변환 없이 곧바로 더하면 된다.
 *
 * **한계를 분명히 한다.** Champions 는 별도 게임이라 배율이 본가와 다를 수 있고,
 * 특성·도구는 수백 종이라 전부 넣지 않았다. 지원 목록은 아래 상수에 명시돼 있고
 * 화면에도 "적용된 보정"으로 표시된다. 목록에 없는 요소는 '기타 배율'로 직접 넣는다.
 */

import type { TypeName } from '../types';
import { effectiveness } from './typechart';

export const LEVEL = 50;
/** 대미지 난수는 85~100 의 16단계다. */
const ROLLS = Array.from({ length: 16 }, (_, i) => 85 + i);

/** 포켓몬식 반올림: 소수부가 정확히 0.5 면 내린다. */
function pokeRound(value: number): number {
  return value % 1 > 0.5 ? Math.ceil(value) : Math.floor(value);
}

/** 랭크 보정. +n 은 (2+n)/2, -n 은 2/(2+n). */
export function boostMultiplier(stage: number): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return clamped >= 0 ? (2 + clamped) / 2 : 2 / (2 - clamped);
}

export type Nature = 'up' | 'down' | 'neutral';

/**
 * 실수치 계산. Champions 기본 실수치에 노력치 포인트를 더하고 성격·랭크를 적용한다.
 * HP 는 성격·랭크의 영향을 받지 않는다.
 */
export function effectiveStat(
  baseActual: number,
  points: number,
  nature: Nature,
  stage = 0,
): number {
  const withPoints = baseActual + Math.max(0, points);
  const natured =
    nature === 'up'
      ? Math.floor(withPoints * 1.1)
      : nature === 'down'
        ? Math.floor(withPoints * 0.9)
        : withPoints;
  return Math.max(1, Math.floor(natured * boostMultiplier(stage)));
}

export function effectiveHp(baseActualHp: number, points: number): number {
  return Math.max(1, baseActualHp + Math.max(0, points));
}

export type Weather = 'none' | 'sun' | 'rain' | 'sand' | 'snow';
export type Terrain = 'none' | 'electric' | 'grassy' | 'psychic' | 'misty';

/**
 * 필드는 **땅에 있는** 포켓몬에게만 작용한다.
 * 비행 타입이거나 부유 계열 특성이면 필드의 영향을 받지 않는다.
 */
export function isGrounded(types: TypeName[], ability: string | null): boolean {
  if (types.includes('Flying')) return false;
  return !(ability === 'Levitate' || ability === 'Eelevate');
}

/** 그래스필드가 반감하는 지진 계열. */
const GRASSY_HALVED = new Set(['Earthquake', 'Bulldoze', 'Magnitude']);

/**
 * 필드가 위력에 주는 배율.
 *
 * 강화는 **공격측이 땅에 있을 때**, 감쇠는 **방어측이 땅에 있을 때** 적용된다.
 * (미스트필드의 드래곤 반감, 그래스필드의 지진 반감이 후자다.)
 */
export function terrainMultiplier(
  terrain: Terrain,
  moveType: TypeName,
  moveName: string,
  attackerGrounded: boolean,
  defenderGrounded: boolean,
): number {
  if (terrain === 'none') return 1;

  if (attackerGrounded) {
    if (terrain === 'electric' && moveType === 'Electric') return 1.3;
    if (terrain === 'grassy' && moveType === 'Grass') return 1.3;
    if (terrain === 'psychic' && moveType === 'Psychic') return 1.3;
  }
  if (defenderGrounded) {
    if (terrain === 'misty' && moveType === 'Dragon') return 0.5;
    if (terrain === 'grassy' && GRASSY_HALVED.has(moveName)) return 0.5;
  }
  return 1;
}

export interface DamageInput {
  /** 기술 위력. 0 이면 변화기술이라 계산하지 않는다. */
  power: number;
  /**
   * **위력 단계** 보정. 최종 대미지 배율과 다른 단계에서 곱해야 하는 것들이 여기 온다.
   * 필드, 철주먹·테크니션 같은 위력 강화 특성, 검은띠 계열 도구가 해당한다.
   *
   * 최종 배율로 뭉뚱그리면 반올림 단계가 달라져 결과가 1~2 어긋난다.
   */
  powerModifier?: number;
  moveType: TypeName;
  category: 'physical' | 'special';

  /** 랭크·성격·노력치가 모두 반영된 최종 공격 실수치 */
  attack: number;
  /** 랭크·성격·노력치가 모두 반영된 최종 방어 실수치 */
  defense: number;
  /** 방어측 최대 HP. 대미지 비율(%) 표시의 기준이다. */
  defenderHp: number;
  /**
   * 방어측의 **남은** HP. 확정/난수 판정은 이 값으로 한다.
   * 생략하면 최대 HP 와 같다고 본다.
   */
  defenderCurrentHp?: number;

  attackerTypes: TypeName[];
  defenderTypes: TypeName[];

  /** 자속 배율. 적응력이면 2. */
  stab?: number;
  isCritical?: boolean;
  /** 더블에서 광범위 기술이면 0.75 */
  isSpread?: boolean;
  weather?: Weather;
  /** 리플렉터/빛의장막. 급소면 무시된다. */
  screen?: boolean;
  /** 더블에서는 스크린 감소폭이 다르다 */
  isDoubles?: boolean;
  /** 공격측 화상 (물리 한정) */
  burned?: boolean;
  /**
   * 위 항목으로 표현되지 않는 배율을 곱한다.
   * 생명의구슬(1.3), 전문가벨트(1.2), 하드록(0.75) 같은 것들이 여기로 들어온다.
   */
  otherModifier?: number;
  /**
   * 옹골참·기합의띠처럼 만피에서 한 방을 버티는 경우.
   * 배율이 아니라 대미지 상한이라 난수마다 잘라내야 해서 여기서 처리한다.
   */
  enduresAtFullHp?: boolean;
  /**
   * 타입 상성을 직접 지정한다.
   *
   * 프리즈드라이(얼음인데 물에 굉장)·플라잉프레스(격투+비행)처럼 타입표만으로
   * 안 맞는 기술이 있다. 표를 왜곡하는 대신 이미 계산된 배율을 받는다.
   */
  typeEffectivenessOverride?: number;
  /**
   * 연속 타격 수. 기본 1.
   *
   * 연속기는 타격마다 난수를 **따로** 뽑는다. 그래서 1회 대미지에 횟수를 곱하는 게 아니라
   * 난수 분포를 횟수만큼 합성해야 확정/난수 판정이 맞는다.
   */
  hits?: number;
  /**
   * 타격마다 위력이 다른 연속기(트리플악셀 20/40/60).
   * 주어지면 hits 대신 이 배열의 길이만큼 때리고, 각 타격을 그 위력으로 계산한다.
   * 같은 위력을 n번 곱하면 안 된다 — 난수도 타격마다 따로 뽑히므로 분포가 달라진다.
   */
  perHitPowers?: number[];
  /**
   * 타격별 방어 실수치. 지구력처럼 **맞을 때마다 방어가 오르는** 경우에 쓴다.
   * 주어지면 각 타격을 해당 방어로 계산한다.
   */
  perHitDefenses?: number[];
}

export interface DamageResult {
  /** 1회 타격의 16개 난수 (오름차순). 타격별 위력이 다르면 첫 타 기준. */
  rolls: number[];
  /** 타격별 [최소, 최대]. 위력이 같으면 모두 같은 값이다. */
  perHitRanges: [number, number][];
  /** 연속 타격 수 */
  hits: number;
  /** 기술 1회 사용의 합계 대미지 (연속기면 전체 타격 합) */
  min: number;
  max: number;
  /** 방어측 최대 HP 대비 % */
  minPercent: number;
  maxPercent: number;
  typeEffectiveness: number;
  /** n발에 쓰러뜨릴 확률. 인덱스 0 이 1발. */
  koChances: number[];
  /** "확정 2타" 같은 한국어 요약 */
  koText: string;
}

/** 날씨가 기술 타입에 주는 배율. */
function weatherMultiplier(weather: Weather, moveType: TypeName): number {
  if (weather === 'sun') {
    if (moveType === 'Fire') return 1.5;
    if (moveType === 'Water') return 0.5;
  }
  if (weather === 'rain') {
    if (moveType === 'Water') return 1.5;
    if (moveType === 'Fire') return 0.5;
  }
  return 1;
}

/**
 * 날씨로 인한 방어 보정 (모래바람의 바위 특방, 눈의 얼음 방어).
 * 공격 계산 전에 방어 실수치에 적용해야 해서 따로 노출한다.
 */
export function weatherDefenseMultiplier(
  weather: Weather,
  defenderTypes: TypeName[],
  category: 'physical' | 'special',
): number {
  if (weather === 'sand' && category === 'special' && defenderTypes.includes('Rock')) return 1.5;
  if (weather === 'snow' && category === 'physical' && defenderTypes.includes('Ice')) return 1.5;
  return 1;
}

export function calculateDamage(input: DamageInput): DamageResult {
  const {
    power: rawPower,
    powerModifier = 1,
    moveType,
    category,
    attack,
    defense,
    defenderHp,
    defenderTypes,
    stab = 1,
    isCritical = false,
    isSpread = false,
    weather = 'none',
    screen = false,
    isDoubles = false,
    burned = false,
    otherModifier = 1,
    enduresAtFullHp = false,
    hits: rawHits = 1,
    typeEffectivenessOverride,
    defenderCurrentHp,
    perHitPowers,
    perHitDefenses,
  } = input;
  const hits = Math.max(1, Math.round(rawHits));

  const typeEff = typeEffectivenessOverride ?? effectiveness(moveType, defenderTypes);

  // 위력 보정은 대미지 공식에 들어가기 **전에** 위력 자체에 적용된다.
  const power = rawPower > 0 ? Math.max(1, pokeRound(rawPower * powerModifier)) : rawPower;

  // 위력이 없거나 타입 무효면 대미지가 없다.
  if (power <= 0 || typeEff === 0) {
    return {
      rolls: new Array(16).fill(0),
      perHitRanges: [],
      hits,
      min: 0,
      max: 0,
      minPercent: 0,
      maxPercent: 0,
      typeEffectiveness: typeEff,
      koChances: [],
      koText: typeEff === 0 ? '효과가 없다' : '대미지 없음',
    };
  }

  /** 위력 하나에 대한 16개 난수. 타격마다 위력이 다르면 타격마다 부른다. */
  const rollsForPower = (hitPower: number, hitDefense: number): number[] => {
  // 1. 기본 대미지
  const base =
    Math.floor(
      Math.floor((Math.floor((2 * LEVEL) / 5) + 2) * hitPower * attack / hitDefense) / 50,
    ) + 2;

  return ROLLS.map((roll) => {
    let damage = base;

    // 2. 광범위 기술 (더블)
    if (isSpread) damage = pokeRound(damage * 0.75);

    // 3. 날씨
    const weatherMod = weatherMultiplier(weather, moveType);
    if (weatherMod !== 1) damage = pokeRound(damage * weatherMod);

    // 4. 급소
    if (isCritical) damage = Math.floor(damage * 1.5);

    // 5. 난수
    damage = Math.floor((damage * roll) / 100);

    // 6. 자속
    if (stab !== 1) damage = pokeRound(damage * stab);

    // 7. 타입 상성
    damage = Math.floor(damage * typeEff);

    // 8. 화상 (물리 한정)
    if (burned && category === 'physical') damage = Math.floor(damage * 0.5);

    // 9. 최종 배율 — 스크린과 기타 보정
    let finalMod = otherModifier;
    // 급소를 맞으면 스크린이 무시된다.
    if (screen && !isCritical) finalMod *= isDoubles ? 2732 / 4096 : 0.5;
    if (finalMod !== 1) damage = pokeRound(damage * finalMod);

    damage = Math.max(1, damage);
    // 만피에서 한 방을 버티는 특성·도구는 대미지를 HP−1 로 자른다.
    // 연속기에는 적용하지 않는다 — 첫 타를 1 로 버텨도 다음 타에 쓰러지기 때문이다.
    if (enduresAtFullHp && hits === 1 && damage >= defenderHp) damage = defenderHp - 1;
    return Math.max(1, damage);
  });
  };

  // 타격별 위력. 주어지지 않으면 같은 위력을 hits 번 때린다.
  const powers =
    perHitPowers && perHitPowers.length > 0
      ? perHitPowers.map((p) => Math.max(1, pokeRound(p * powerModifier)))
      : new Array(hits).fill(power);
  // 지구력처럼 타격마다 방어가 달라지면 그 값을, 아니면 같은 방어를 쓴다.
  const defenses =
    perHitDefenses && perHitDefenses.length > 0
      ? powers.map((_, i) => Math.max(1, perHitDefenses[Math.min(i, perHitDefenses.length - 1)]!))
      : powers.map(() => defense);
  const perHitRolls = powers.map((p, i) => rollsForPower(p, defenses[i]!));
  const rolls = perHitRolls[0] ?? new Array(16).fill(0);

  // 기술 1회 사용의 대미지 분포. 연속기는 타격마다 난수를 따로 뽑으므로 분포를 합성한다.
  const perUse = convolveRolls(perHitRolls);
  const min = perHitRolls.reduce((sum, r) => sum + (r[0] ?? 0), 0);
  const max = perHitRolls.reduce((sum, r) => sum + (r[r.length - 1] ?? 0), 0);
  const perHitRanges: [number, number][] = perHitRolls.map((r) => [r[0] ?? 0, r[r.length - 1] ?? 0]);
  // 남은 HP 가 주어지면 그 값으로 쓰러뜨릴 수 있는지 본다.
  const remainingHp = Math.max(1, Math.min(defenderHp, defenderCurrentHp ?? defenderHp));
  const koChances = knockOutChances(perUse, remainingHp);

  return {
    rolls,
    perHitRanges,
    hits,
    min,
    max,
    minPercent: Number(((min / defenderHp) * 100).toFixed(1)),
    maxPercent: Number(((max / defenderHp) * 100).toFixed(1)),
    typeEffectiveness: typeEff,
    koChances,
    koText: describeKo(koChances),
  };
}

/**
 * 난수를 n회 합성한 분포. 연속기 1회 사용의 총 대미지 분포가 된다.
 *
 * 최소×n ~ 최대×n 을 균등분포로 보면 안 된다. 여러 번 뽑으면 가운데로 몰리기 때문에
 * "확정 1타"인지 "난수 1타"인지가 달라진다.
 */
function convolveRolls(perHitRolls: number[][]): Map<number, number> {
  let distribution = new Map<number, number>([[0, 1]]);

  for (const rolls of perHitRolls) {
    const probability = 1 / rolls.length;
    const next = new Map<number, number>();
    for (const [sum, chance] of distribution) {
      for (const roll of rolls) {
        const total = sum + roll;
        next.set(total, (next.get(total) ?? 0) + chance * probability);
      }
    }
    distribution = next;
  }
  return distribution;
}

/**
 * n발에 쓰러뜨릴 확률을 정확히 구한다.
 *
 * 난수 16개가 매번 균등하게 뽑히므로, 누적 대미지 분포를 컨볼루션으로 굴린다.
 * 근사(min/max 비교)로 처리하면 "난수 2타"의 실제 확률을 못 말해준다.
 */
function knockOutChances(
  perUse: Map<number, number>,
  hp: number,
  maxUses = 4,
): number[] {
  const chances: number[] = [];
  // key: 누적 대미지, value: 확률
  let distribution = new Map<number, number>([[0, 1]]);

  for (let use = 1; use <= maxUses; use += 1) {
    const next = new Map<number, number>();
    let koProbability = 0;

    for (const [damage, probability] of distribution) {
      for (const [roll, rollProbability] of perUse) {
        const total = damage + roll;
        const p = probability * rollProbability;
        if (total >= hp) {
          koProbability += p;
        } else {
          next.set(total, (next.get(total) ?? 0) + p);
        }
      }
    }

    // 이전 타격까지의 누적 확률에 이번 타격 확률을 더한다.
    const cumulative = (chances[chances.length - 1] ?? 0) + koProbability;
    chances.push(cumulative);
    distribution = next;

    if (cumulative >= 0.999999 || distribution.size === 0) break;
  }

  return chances;
}

/** 한국어 확정/난수 표기. */
function describeKo(chances: number[]): string {
  for (let i = 0; i < chances.length; i += 1) {
    const chance = chances[i] ?? 0;
    const hits = i + 1;
    if (chance >= 0.999999) return `확정 ${hits}타`;
    if (chance > 0) return `난수 ${hits}타 (${(chance * 100).toFixed(1)}%)`;
  }
  return chances.length > 0 ? '5타 이상' : '쓰러뜨릴 수 없음';
}

/** 자속 배율. 적응력이면 2배. */
export function stabMultiplier(
  moveType: TypeName,
  attackerTypes: TypeName[],
  adaptability = false,
): number {
  if (!attackerTypes.includes(moveType)) return 1;
  return adaptability ? 2 : 1.5;
}

/**
 * 한 스탯에 넣을 수 있는 노력치 포인트의 상한.
 *
 * Champions 는 노력치를 "그 스탯이 실제로 오른 양"으로 표시한다.
 * 레벨 50 에서 252노력치 = 32포인트다 (한카리아스 공격: 0노력 150 → 252노력 182).
 * 사용률 데이터에서 관측된 최대값도 32라 이 값을 상한으로 쓴다.
 *
 * 총합 상한은 두지 않는다. 포인트→노력치 환산이 종족값 홀짝에 따라 달라져서
 * "총 몇 포인트까지"가 딱 떨어지지 않기 때문이다. 검증할 수 없는 제약을 걸지 않는다.
 */
export const MAX_STAT_POINTS = 32;
