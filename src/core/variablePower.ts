/**
 * 상황에 따라 위력이 달라지는 기술의 실제 위력을 구한다.
 *
 * 왜 필요한가: PokéAPI 는 고정 위력 하나만 준다. 성묘를 항상 50 으로,
 * 자이로볼을 0 으로 계산하면 **계산기가 조용히 틀린 값을 낸다**.
 * Showdown 의 basePowerCallback 에 해당하는 기술이 로스터에만 34개 있다.
 *
 * 여기서 처리하는 것은 계산기가 이미 가진 입력만으로 확정할 수 있는 9개다.
 * 나머지(몸무게·잔여 HP·연속 사용 횟수 등이 필요한 것들)는 확정할 수 없으므로
 * 값을 지어내지 않고 사용자가 직접 넣게 한다 — needsManualPower 가 그 신호다.
 */

import type { MoveInfo } from '../adapters/moveDex';
import type { Terrain, Weather } from './damage';
import type { TypeName } from '../types';

export interface PowerContext {
  /** 쓰러진 아군 수 (성묘) */
  fallenAllies: number;
  /** 공격측의 올라간 랭크 합 (어시스트파워·기어오르기) */
  positiveBoosts: number;
  /** 실제 스피드 실수치 (자이로볼·일렉트릭볼) */
  attackerSpeed: number;
  defenderSpeed: number;
  /** 상대가 상태이상인가 (병상첨병·백귀야행) */
  defenderStatused: boolean;
  /** 공격측이 도구를 안 들었나 (애크러뱃) */
  attackerHasItem: boolean;
  /** 라이징볼트 조건 */
  terrain: Terrain;
  defenderGrounded: boolean;
  /** 몸무게(kg). 모르면 null — 그때는 위력을 확정하지 않는다. */
  attackerWeightKg: number | null;
  defenderWeightKg: number | null;
  /** 날씨 (솔라빔·웨더볼) */
  weather: Weather;
  /** 공격측이 상태이상인가 (객기) */
  attackerStatused: boolean;
  /** 방어측이 도구를 들었는가 (탁쳐서떨구기) */
  defenderHasItem: boolean;
  /** 공격측 폼 이름 (오라휠·레이징불의 타입 판정) */
  attackerFormName: string;
  /** 남은 HP 비율 0~1 (분화·기사회생·하드프레스·소금물) */
  attackerHpRatio: number;
  defenderHpRatio: number;
  /** 방어측이 독·맹독 상태인가 (베놈쇼크·독침천발) */
  defenderPoisoned: boolean;
}

/** 분화·해수스파우팅 — 남은 HP 비율에 그대로 비례한다. */
function hpScaledPower(base: number, ratio: number): number {
  return Math.max(1, Math.floor(base * Math.max(0, Math.min(1, ratio))));
}

/**
 * 기사회생·바둥바둥 — HP 가 적을수록 강해진다.
 * 본가는 남은 비율을 48등분한 값으로 구간을 가른다.
 */
function reversalPower(ratio: number): number {
  const step = Math.max(Math.floor(Math.max(0, Math.min(1, ratio)) * 48), 1);
  if (step < 2) return 200;
  if (step < 5) return 150;
  if (step < 10) return 100;
  if (step < 17) return 80;
  if (step < 33) return 40;
  return 20;
}

/**
 * 풀묶기·안다리걸기 — 상대 몸무게로 정해진다.
 * 본가 임계값은 헥토그램 기준이라 kg 로 환산해 적었다 (2000hg = 200kg).
 */
function weightPower(kg: number): number {
  if (kg >= 200) return 120;
  if (kg >= 100) return 100;
  if (kg >= 50) return 80;
  if (kg >= 25) return 60;
  if (kg >= 10) return 40;
  return 20;
}

/** 헤비봄버·히트스탬프 — 자신이 상대보다 몇 배 무거운가. */
function weightRatioPower(attackerKg: number, defenderKg: number): number {
  if (defenderKg <= 0) return 120;
  const ratio = attackerKg / defenderKg;
  if (ratio >= 5) return 120;
  if (ratio >= 4) return 100;
  if (ratio >= 3) return 80;
  if (ratio >= 2) return 60;
  return 40;
}

/** 이 기술은 사용자가 위력을 직접 넣어야 하는가. */
export function needsManualPower(move: MoveInfo): boolean {
  return move.variablePower === 'manual';
}

/**
 * 실제 위력. 계산할 수 없으면 null 을 돌려준다 —
 * 호출부는 그때 사용자 입력값을 쓰고, 없으면 계산을 보류해야 한다.
 */
export function resolvePower(move: MoveInfo, ctx: PowerContext): number | null {
  const base = move.power ?? 0;

  switch (move.variablePower) {
    case null:
      return base;

    case 'fallenAllies':
      // 성묘: 50 + 50 × 쓰러진 아군
      return 50 + 50 * Math.max(0, Math.min(5, ctx.fallenAllies));

    case 'positiveBoosts':
      // 어시스트파워·기어오르기: 20 + 20 × 올라간 랭크 합
      return 20 + 20 * Math.max(0, ctx.positiveBoosts);

    case 'gyroBall': {
      // 자이로볼: 상대가 느릴수록 강해진다. 최대 150.
      if (ctx.attackerSpeed <= 0) return 1;
      const power = Math.floor((25 * ctx.defenderSpeed) / ctx.attackerSpeed) + 1;
      return Math.max(1, Math.min(150, power));
    }

    case 'electroBall': {
      // 일렉트릭볼: 스피드 비율을 구간으로 나눈다.
      if (ctx.defenderSpeed <= 0) return 150;
      const ratio = Math.floor(ctx.attackerSpeed / ctx.defenderSpeed);
      const tiers = [40, 60, 80, 120, 150];
      return tiers[Math.min(Math.max(ratio, 0), 4)] ?? 40;
    }

    case 'targetStatus':
      // 병상첨병·백귀야행: 상대가 상태이상이면 2배
      return ctx.defenderStatused ? base * 2 : base;

    case 'noItem':
      // 애크러뱃: 도구가 없으면 2배
      return ctx.attackerHasItem ? base : base * 2;

    case 'electricTerrain':
      // 라이징볼트: 일렉트릭필드 위의 상대에게 2배
      return ctx.terrain === 'electric' && ctx.defenderGrounded ? base * 2 : base;

    case 'targetWeight':
      // 풀묶기·안다리걸기. 몸무게를 모르면 지어내지 않는다.
      return ctx.defenderWeightKg === null ? null : weightPower(ctx.defenderWeightKg);

    case 'weightRatio':
      // 헤비봄버·히트스탬프
      return ctx.attackerWeightKg === null || ctx.defenderWeightKg === null
        ? null
        : weightRatioPower(ctx.attackerWeightKg, ctx.defenderWeightKg);

    case 'solarBeam':
      // 솔라빔·솔라블레이드: 쾌청이 아닌 날씨에서 절반. 날씨가 없으면 그대로.
      return ctx.weather === 'none' || ctx.weather === 'sun' ? base : Math.floor(base / 2);

    case 'psychicTerrain':
      return ctx.terrain === 'psychic' ? Math.floor(base * 1.5) : base;

    case 'mistyTerrain':
      return ctx.terrain === 'misty' ? Math.floor(base * 1.5) : base;

    case 'anyTerrain':
      // 대지의파동: 필드가 깔려 있으면 2배 (타입도 바뀐다)
      return ctx.terrain === 'none' ? base : base * 2;

    case 'anyWeather':
      // 웨더볼: 날씨가 있으면 2배 (타입도 바뀐다)
      return ctx.weather === 'none' ? base : base * 2;

    case 'targetHasItem':
      // 탁쳐서떨구기: 상대가 뺏을 수 있는 도구를 들었으면 1.5배
      return ctx.defenderHasItem ? Math.floor(base * 1.5) : base;

    case 'userStatus':
      // 객기: 자신이 상태이상이면 2배
      return ctx.attackerStatused ? base * 2 : base;

    case 'userHp':
      // 분화·해수스파우팅
      return hpScaledPower(base, ctx.attackerHpRatio);

    case 'userHpInverse':
      // 기사회생·바둥바둥
      return reversalPower(ctx.attackerHpRatio);

    case 'targetHp':
      // 하드프레스 — 상대의 남은 HP 비율에 비례 (최대 100)
      return Math.max(1, Math.floor(100 * Math.max(0, Math.min(1, ctx.defenderHpRatio))));

    case 'targetHalfHp':
      // 소금물 — 상대 HP 가 절반 이하면 2배
      return ctx.defenderHpRatio <= 0.5 ? base * 2 : base;

    case 'targetPoisoned':
      // 베놈쇼크·독침천발 — 독 상태에만 붙는다 (다른 상태이상은 해당 없음)
      return ctx.defenderPoisoned ? base * 2 : base;

    case 'escalating':
      // 트리플악셀 — 첫 타의 위력만 돌려준다.
      // 실제 계산은 escalatingPowers() 로 타격별 위력을 만들어 넘긴다.
      return base;

    case 'manual':
      // 확정할 수 없다. 사용자 입력이 필요하다.
      return null;

    default:
      // 모르는 식별자는 고정 위력으로 둔다 (데이터가 앞서갔을 때의 안전장치).
      return base;
  }
}

/**
 * 상황에 따라 바뀌는 기술 타입.
 *
 * 타입이 바뀌면 상성과 자속이 통째로 달라져서 위력 변화보다 영향이 크다.
 * 확정할 수 없으면 null 을 돌려주고, 호출부는 원래 타입을 쓴다.
 */
export function resolveMoveType(move: MoveInfo, ctx: PowerContext): TypeName | null {
  switch (move.variableType) {
    case 'weather': {
      // 웨더볼
      const byWeather: Record<Weather, TypeName | null> = {
        none: null,
        sun: 'Fire',
        rain: 'Water',
        sand: 'Rock',
        snow: 'Ice',
      };
      return byWeather[ctx.weather];
    }
    case 'terrain': {
      // 대지의파동
      const byTerrain: Record<Terrain, TypeName | null> = {
        none: null,
        electric: 'Electric',
        grassy: 'Grass',
        psychic: 'Psychic',
        misty: 'Fairy',
      };
      return byTerrain[ctx.terrain];
    }
    case 'morpeko':
      // 오라휠 — 배고픈모양이면 악, 아니면 전기
      return /hangry/i.test(ctx.attackerFormName) ? 'Dark' : 'Electric';
    case 'tauros':
      // 레이징불 — 탄젠 폼에 따라
      if (/aqua/i.test(ctx.attackerFormName)) return 'Water';
      if (/blaze/i.test(ctx.attackerFormName)) return 'Fire';
      if (/combat/i.test(ctx.attackerFormName)) return 'Fighting';
      return null;
    default:
      return null;
  }
}

/**
 * 타입 상성표만으로 안 맞는 기술을 바로잡는다.
 *
 * 프리즈드라이는 얼음 기술인데 물에 효과가 굉장하다. 표대로 계산하면 0.5배가 나와
 * **정반대 결론**이 나온다. 이런 예외는 표를 고치는 게 아니라 여기서 덧씌운다.
 *
 * @param base 타입표로 구한 배율
 * @returns 보정된 배율. 예외가 없으면 base 그대로.
 */
export function applyEffectivenessQuirk(
  move: MoveInfo,
  defenderTypes: TypeName[],
  base: number,
  effectivenessOf: (type: TypeName, against: TypeName[]) => number,
): number {
  switch (move.effectivenessQuirk) {
    case 'freezeDry':
      // 물 타입에 대한 상성만 2배로 갈아끼운다. 나머지 타입 상성은 그대로 곱한다.
      if (!defenderTypes.includes('Water')) return base;
      return (
        effectivenessOf('Ice', defenderTypes.filter((t) => t !== 'Water')) * 2
      );
    case 'flyingPress':
      // 격투 상성에 비행 상성을 곱한다.
      return base * effectivenessOf('Flying', defenderTypes);
    default:
      return base;
  }
}

/** 랭크 중 올라간 것만 합산. 어시스트파워 계열이 쓴다. */
export function sumPositiveBoosts(stages: Record<string, number>): number {
  return Object.values(stages).reduce((sum, stage) => sum + Math.max(0, stage), 0);
}

/**
 * 타격마다 위력이 커지는 연속기의 타격별 위력.
 *
 * 트리플악셀은 20 / 40 / 60 으로 오른다. 같은 위력을 3번 곱하면 총합도,
 * 난수 분포도 틀린다 — 그래서 타격별 위력 목록을 만들어 대미지 계산에 넘긴다.
 */
export function escalatingPowers(move: MoveInfo, hits: number): number[] {
  const step = move.power ?? 0;
  return Array.from({ length: Math.max(1, hits) }, (_, i) => step * (i + 1));
}

/** 타격마다 위력이 커지는 기술인가. */
export function isEscalating(move: MoveInfo): boolean {
  return move.variablePower === 'escalating';
}
