/**
 * Champions 수치의 정체와 환산.
 *
 * championsbattledata 가 주는 hp/attack/... 은 **종족값이 아니다.**
 * 레벨 50 · 개체값 31 · 노력치 0 · 무보정 성격일 때의 **실수치**다.
 *
 * 본가 공식:
 *   HP   = floor((2*종족값 + 개체값 + 노력치/4) * 레벨/100) + 레벨 + 10
 *   그외 = (floor((2*종족값 + 개체값 + 노력치/4) * 레벨/100) + 5) * 성격보정
 *
 * 레벨 50, 개체값 31, 노력치 0 을 넣으면 floor 가 깔끔하게 떨어져서 상수 덧셈이 된다:
 *   HP   = floor((2b + 31)/2) + 60 = b + 15 + 60 = b + 75
 *   그외 = floor((2b + 31)/2) + 5  = b + 15 + 5  = b + 20
 * (b 가 정수이므로 floor(b + 15.5) = b + 15)
 *
 * 로스터 표본으로 검증했다 — test/stats.test.ts 참고.
 * 덕분에 역환산이 정확하다: 종족값 = 실수치 − 20 (HP 는 −75).
 */

import type { StatLine } from '../types';

/** 실수치 계산에 쓰인 전제. 화면에 그대로 노출해 오해를 막는다. */
export const STAT_BASIS = {
  level: 50,
  iv: 31,
  ev: 0,
  natureNeutral: true,
} as const;

export const STAT_BASIS_LABEL = '레벨 50 · 개체값 31 · 노력치 0 · 성격 보정 없음';

const HP_OFFSET = 75;
const OTHER_OFFSET = 20;

/** 실수치 → 종족값. 음수가 나오면(전제가 깨졌다는 뜻) null 로 알린다. */
export function toBaseStat(actual: number, isHp: boolean): number | null {
  const base = actual - (isHp ? HP_OFFSET : OTHER_OFFSET);
  return base >= 1 ? base : null;
}

/** 종족값 → 실수치. 검증용. */
export function toActualStat(base: number, isHp: boolean): number {
  return base + (isHp ? HP_OFFSET : OTHER_OFFSET);
}

export interface BaseStatLine {
  hp: number | null;
  atk: number | null;
  def: number | null;
  spa: number | null;
  spd: number | null;
  spe: number | null;
  /** 6개가 모두 환산됐을 때만 합계를 낸다. 하나라도 실패하면 null. */
  total: number | null;
}

/** 실수치 한 줄을 통째로 종족값으로 환산한다. */
export function toBaseStats(stats: StatLine): BaseStatLine {
  const hp = toBaseStat(stats.hp, true);
  const atk = toBaseStat(stats.atk, false);
  const def = toBaseStat(stats.def, false);
  const spa = toBaseStat(stats.spa, false);
  const spd = toBaseStat(stats.spd, false);
  const spe = toBaseStat(stats.spe, false);
  const parts = [hp, atk, def, spa, spd, spe];
  const total = parts.every((v): v is number => v !== null)
    ? parts.reduce((sum, v) => sum + v, 0)
    : null;
  return { hp, atk, def, spa, spd, spe, total };
}

/** 막대 그래프용 비율. 실수치 관측 범위(대략 60~230)에 맞춘다. */
export function statRatio(value: number): number {
  return Math.max(0, Math.min(100, (value / 230) * 100));
}
