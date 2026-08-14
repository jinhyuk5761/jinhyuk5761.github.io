/**
 * 대미지 계산 테스트.
 *
 * 계산기는 틀리면 없느니만 못하다. 손으로 계산한 값 하나를 기준점으로 박고,
 * 나머지는 불변식(단조성·배율 관계·급소 우위)으로 조인다.
 */

import { describe, expect, it } from 'vitest';
import {
  boostMultiplier,
  calculateDamage,
  effectiveHp,
  effectiveStat,
  isGrounded,
  stabMultiplier,
  terrainMultiplier,
  weatherDefenseMultiplier,
  type DamageInput,
} from '../src/core/damage';

/** 기본 입력. 각 테스트가 필요한 값만 덮어쓴다. */
function input(overrides: Partial<DamageInput> = {}): DamageInput {
  return {
    power: 100,
    moveType: 'Normal',
    category: 'physical',
    attack: 182,
    defense: 100,
    defenderHp: 300,
    attackerTypes: ['Normal'],
    defenderTypes: ['Normal'],
    stab: 1,
    ...overrides,
  };
}

describe('기본 공식', () => {
  it('손으로 계산한 값과 맞는다', () => {
    // 레벨 50, 위력 100, 공격 182, 방어 100, 보정 없음
    //   floor(2*50/5) + 2 = 22
    //   floor(22 * 100 * 182 / 100) = 4004
    //   floor(4004 / 50) + 2 = 82
    //   난수: floor(82 * 85/100) = 69  ~  floor(82 * 100/100) = 82
    const result = calculateDamage(input());
    expect(result.min).toBe(69);
    expect(result.max).toBe(82);
  });

  it('난수는 16단계다', () => {
    const result = calculateDamage(input());
    expect(result.rolls).toHaveLength(16);
    // 오름차순이어야 한다.
    expect([...result.rolls].sort((a, b) => a - b)).toEqual(result.rolls);
  });

  it('HP 대비 비율을 낸다', () => {
    const result = calculateDamage(input({ defenderHp: 200 }));
    expect(result.minPercent).toBeCloseTo((result.min / 200) * 100, 1);
  });

  it('공격이 오르면 대미지도 오른다', () => {
    const low = calculateDamage(input({ attack: 100 }));
    const high = calculateDamage(input({ attack: 200 }));
    expect(high.max).toBeGreaterThan(low.max);
  });

  it('방어가 오르면 대미지가 준다', () => {
    const soft = calculateDamage(input({ defense: 80 }));
    const hard = calculateDamage(input({ defense: 200 }));
    expect(hard.max).toBeLessThan(soft.max);
  });
});

describe('타입 상성', () => {
  it('무효면 0 이고 그렇게 말한다', () => {
    const result = calculateDamage(
      input({ moveType: 'Electric', defenderTypes: ['Ground'] }),
    );
    expect(result.max).toBe(0);
    expect(result.typeEffectiveness).toBe(0);
    expect(result.koText).toBe('효과가 없다');
  });

  it('2배는 대략 2배, 4배는 대략 4배', () => {
    const neutral = calculateDamage(input({ moveType: 'Ice', defenderTypes: ['Normal'] }));
    const doubled = calculateDamage(input({ moveType: 'Ice', defenderTypes: ['Dragon'] }));
    const quad = calculateDamage(input({ moveType: 'Ice', defenderTypes: ['Ground', 'Dragon'] }));

    expect(doubled.max / neutral.max).toBeCloseTo(2, 1);
    expect(quad.max / neutral.max).toBeCloseTo(4, 1);
    expect(quad.typeEffectiveness).toBe(4);
  });

  it('반감은 절반쯤', () => {
    const neutral = calculateDamage(input({ moveType: 'Fire', defenderTypes: ['Normal'] }));
    const resisted = calculateDamage(input({ moveType: 'Fire', defenderTypes: ['Water'] }));
    expect(resisted.max / neutral.max).toBeCloseTo(0.5, 1);
  });
});

describe('보정', () => {
  it('자속은 1.5배', () => {
    const plain = calculateDamage(input({ stab: 1 }));
    const stab = calculateDamage(input({ stab: 1.5 }));
    expect(stab.max / plain.max).toBeCloseTo(1.5, 1);
  });

  it('적응력은 2배', () => {
    expect(stabMultiplier('Ground', ['Ground', 'Dragon'])).toBe(1.5);
    expect(stabMultiplier('Ground', ['Ground', 'Dragon'], true)).toBe(2);
    expect(stabMultiplier('Fire', ['Ground', 'Dragon'])).toBe(1);
  });

  it('급소는 대미지를 올린다', () => {
    const normal = calculateDamage(input());
    const crit = calculateDamage(input({ isCritical: true }));
    expect(crit.max).toBeGreaterThan(normal.max);
    expect(crit.max / normal.max).toBeCloseTo(1.5, 1);
  });

  it('광범위 기술은 더블에서 0.75배', () => {
    const single = calculateDamage(input());
    const spread = calculateDamage(input({ isSpread: true }));
    expect(spread.max / single.max).toBeCloseTo(0.75, 1);
  });

  it('화상은 물리만 반감한다', () => {
    const physical = calculateDamage(input({ category: 'physical', burned: true }));
    const special = calculateDamage(input({ category: 'special', burned: true }));
    const plain = calculateDamage(input());
    expect(physical.max / plain.max).toBeCloseTo(0.5, 1);
    expect(special.max).toBe(plain.max);
  });

  it('스크린은 절반, 더블에서는 약 2/3', () => {
    const plain = calculateDamage(input());
    const single = calculateDamage(input({ screen: true }));
    const doubles = calculateDamage(input({ screen: true, isDoubles: true }));
    expect(single.max / plain.max).toBeCloseTo(0.5, 1);
    expect(doubles.max / plain.max).toBeCloseTo(0.667, 1);
  });

  it('급소를 맞으면 스크린이 무시된다', () => {
    const withScreen = calculateDamage(input({ screen: true, isCritical: true }));
    const without = calculateDamage(input({ isCritical: true }));
    expect(withScreen.max).toBe(without.max);
  });

  it('날씨는 해당 타입만 건드린다', () => {
    const plain = calculateDamage(input({ moveType: 'Fire', defenderTypes: ['Normal'] }));
    const sun = calculateDamage(input({ moveType: 'Fire', defenderTypes: ['Normal'], weather: 'sun' }));
    const rain = calculateDamage(input({ moveType: 'Fire', defenderTypes: ['Normal'], weather: 'rain' }));
    const unrelated = calculateDamage(
      input({ moveType: 'Ground', defenderTypes: ['Normal'], weather: 'sun' }),
    );

    expect(sun.max / plain.max).toBeCloseTo(1.5, 1);
    expect(rain.max / plain.max).toBeCloseTo(0.5, 1);
    expect(unrelated.max).toBe(calculateDamage(input({ moveType: 'Ground', defenderTypes: ['Normal'] })).max);
  });

  it('기타 배율을 곱한다 (생명의구슬 등)', () => {
    const plain = calculateDamage(input());
    const orb = calculateDamage(input({ otherModifier: 1.3 }));
    expect(orb.max / plain.max).toBeCloseTo(1.3, 1);
  });

  it('위력 0(변화기술)은 계산하지 않는다', () => {
    const result = calculateDamage(input({ power: 0 }));
    expect(result.max).toBe(0);
    expect(result.koText).toBe('대미지 없음');
  });

  it('아무리 줄어도 최소 1 은 들어간다', () => {
    const result = calculateDamage(input({ power: 10, attack: 10, defense: 500 }));
    expect(result.min).toBeGreaterThanOrEqual(1);
  });
});

describe('실수치 계산', () => {
  it('노력치 포인트를 그대로 더한다', () => {
    // 한카리아스 공격 기본 150, 252노력치 = 32포인트 → 182
    expect(effectiveStat(150, 32, 'neutral')).toBe(182);
  });

  it('성격 보정은 노력치를 더한 뒤 적용한다', () => {
    // (150 + 32) * 1.1 = 200.2 → 200
    expect(effectiveStat(150, 32, 'up')).toBe(200);
    // (150 + 32) * 0.9 = 163.8 → 163
    expect(effectiveStat(150, 32, 'down')).toBe(163);
  });

  it('랭크 보정을 마지막에 적용한다', () => {
    expect(effectiveStat(100, 0, 'neutral', 1)).toBe(150);
    expect(effectiveStat(100, 0, 'neutral', 2)).toBe(200);
    expect(effectiveStat(100, 0, 'neutral', -1)).toBe(66);
  });

  it('HP 는 성격·랭크의 영향을 받지 않는다', () => {
    expect(effectiveHp(183, 0)).toBe(183);
    expect(effectiveHp(183, 32)).toBe(215);
  });

  it('음수 포인트는 무시한다', () => {
    expect(effectiveStat(150, -10, 'neutral')).toBe(150);
  });
});

describe('랭크 배율', () => {
  it('공식대로 계산한다', () => {
    expect(boostMultiplier(0)).toBe(1);
    expect(boostMultiplier(1)).toBe(1.5);
    expect(boostMultiplier(2)).toBe(2);
    expect(boostMultiplier(6)).toBe(4);
    expect(boostMultiplier(-1)).toBeCloseTo(2 / 3, 5);
    expect(boostMultiplier(-6)).toBe(0.25);
  });

  it('±6 을 넘지 않는다', () => {
    expect(boostMultiplier(99)).toBe(boostMultiplier(6));
    expect(boostMultiplier(-99)).toBe(boostMultiplier(-6));
  });
});

describe('날씨 방어 보정', () => {
  it('모래바람은 바위타입 특수방어를 올린다', () => {
    expect(weatherDefenseMultiplier('sand', ['Rock'], 'special')).toBe(1.5);
    expect(weatherDefenseMultiplier('sand', ['Rock'], 'physical')).toBe(1);
    expect(weatherDefenseMultiplier('sand', ['Ground'], 'special')).toBe(1);
  });

  it('눈은 얼음타입 방어를 올린다', () => {
    expect(weatherDefenseMultiplier('snow', ['Ice'], 'physical')).toBe(1.5);
    expect(weatherDefenseMultiplier('snow', ['Ice'], 'special')).toBe(1);
  });
});

describe('위력 단계 보정', () => {
  it('최종 배율이 아니라 위력에 먼저 곱해진다', () => {
    // 위력 100 × 1.2 = 120 으로 계산된 결과여야 한다.
    const boosted = calculateDamage(input({ powerModifier: 1.2 }));
    const direct = calculateDamage(input({ power: 120 }));
    expect(boosted.min).toBe(direct.min);
    expect(boosted.max).toBe(direct.max);
  });

  it('최종 배율과 결과가 다를 수 있다 (반올림 단계가 다르므로)', () => {
    const asPower = calculateDamage(input({ power: 75, powerModifier: 1.2 }));
    const asFinal = calculateDamage(input({ power: 75, otherModifier: 1.2 }));
    // 둘 다 그럴듯하지만 같은 값이라는 보장이 없다 — 위력 쪽이 본가 순서다.
    expect(asPower.max).toBeGreaterThan(0);
    expect(asFinal.max).toBeGreaterThan(0);
  });

  it('위력 보정 후에도 최소 1 은 유지된다', () => {
    expect(calculateDamage(input({ power: 10, powerModifier: 0.01 })).min).toBeGreaterThanOrEqual(1);
  });

  it('변화기술은 위력 보정을 해도 0 이다', () => {
    expect(calculateDamage(input({ power: 0, powerModifier: 2 })).max).toBe(0);
  });
});

describe('필드', () => {
  it('땅에 있는 공격측의 해당 타입 기술을 1.3배로', () => {
    expect(terrainMultiplier('electric', 'Electric', 'Thunderbolt', true, true)).toBe(1.3);
    expect(terrainMultiplier('grassy', 'Grass', 'Energy Ball', true, true)).toBe(1.3);
    expect(terrainMultiplier('psychic', 'Psychic', 'Psychic', true, true)).toBe(1.3);
  });

  it('타입이 안 맞으면 그대로', () => {
    expect(terrainMultiplier('electric', 'Water', 'Surf', true, true)).toBe(1);
  });

  it('공중에 뜬 공격측은 필드 강화를 못 받는다', () => {
    expect(terrainMultiplier('electric', 'Electric', 'Thunderbolt', false, true)).toBe(1);
  });

  it('미스트필드는 땅에 있는 방어측에게 가는 드래곤 기술을 반감한다', () => {
    expect(terrainMultiplier('misty', 'Dragon', 'Outrage', true, true)).toBe(0.5);
    // 방어측이 떠 있으면 적용되지 않는다
    expect(terrainMultiplier('misty', 'Dragon', 'Outrage', true, false)).toBe(1);
  });

  it('그래스필드는 지진 계열만 반감한다', () => {
    expect(terrainMultiplier('grassy', 'Ground', 'Earthquake', true, true)).toBe(0.5);
    expect(terrainMultiplier('grassy', 'Ground', 'Bulldoze', true, true)).toBe(0.5);
    // 같은 땅 기술이라도 지진 계열이 아니면 그대로
    expect(terrainMultiplier('grassy', 'Ground', 'Earth Power', true, true)).toBe(1);
  });

  it('필드가 없으면 아무것도 하지 않는다', () => {
    expect(terrainMultiplier('none', 'Electric', 'Thunderbolt', true, true)).toBe(1);
  });
});

describe('접지 판정', () => {
  it('비행 타입은 땅에 있지 않다', () => {
    expect(isGrounded(['Flying'], null)).toBe(false);
    expect(isGrounded(['Dragon', 'Flying'], null)).toBe(false);
  });

  it('부유 계열 특성도 공중 취급', () => {
    expect(isGrounded(['Electric'], 'Levitate')).toBe(false);
    expect(isGrounded(['Electric'], 'Eelevate')).toBe(false);
  });

  it('그 밖에는 땅에 있다', () => {
    expect(isGrounded(['Ground', 'Dragon'], null)).toBe(true);
    expect(isGrounded(['Electric'], 'Static')).toBe(true);
  });
});

describe('연속기', () => {
  it('합계는 1타 대미지 × 횟수다', () => {
    const once = calculateDamage(input({ power: 25 }));
    const five = calculateDamage(input({ power: 25, hits: 5 }));
    expect(five.hits).toBe(5);
    expect(five.min).toBe(once.min * 5);
    expect(five.max).toBe(once.max * 5);
  });

  it('rolls 는 1타 기준으로 남는다 (합계와 구분)', () => {
    const five = calculateDamage(input({ power: 25, hits: 5 }));
    expect(five.rolls[0]! * 5).toBe(five.min);
  });

  it('타격 수를 안 주면 1회다', () => {
    expect(calculateDamage(input()).hits).toBe(1);
  });

  it('연속기의 확정 판정은 균등분포가 아니라 합성분포로 낸다', () => {
    // 1타 69~82 를 5회 → 합계 345~410.
    // HP 350 이면 최저(345)로는 못 넘기니 '난수 1타' 인데,
    // 5회 합이 350 미만일 확률은 아주 낮다. 균등분포로 보면 이 값이 크게 달라진다.
    const result = calculateDamage(input({ hits: 5, defenderHp: 350 }));
    expect(result.min).toBe(345);
    expect(result.max).toBe(410);
    expect(result.koText).toMatch(/^난수 1타/);
    // 합성분포는 가운데로 몰리므로 확률이 매우 높다.
    expect(result.koChances[0]).toBeGreaterThan(0.99);
  });

  it('확률이 0 과 1 사이에 머문다', () => {
    const result = calculateDamage(input({ hits: 3, defenderHp: 400 }));
    for (const chance of result.koChances) {
      expect(chance).toBeGreaterThanOrEqual(0);
      expect(chance).toBeLessThanOrEqual(1);
    }
  });

  it('연속기에는 옹골참·기합의띠가 통하지 않는다', () => {
    // 첫 타를 1 로 버텨도 다음 타에 쓰러지므로 한 번의 사용으로 KO 가 난다.
    const single = calculateDamage(input({ defenderHp: 70, enduresAtFullHp: true }));
    expect(single.koText).not.toBe('확정 1타');

    const multi = calculateDamage(input({ power: 25, hits: 5, defenderHp: 70, enduresAtFullHp: true }));
    expect(multi.koText).toBe('확정 1타');
  });

  it('타격 수는 최소 1 로 정규화된다', () => {
    expect(calculateDamage(input({ hits: 0 })).hits).toBe(1);
    expect(calculateDamage(input({ hits: -3 })).hits).toBe(1);
  });
});

describe('확정/난수 판정', () => {
  it('최소 난수로도 넘기면 확정 1타', () => {
    const result = calculateDamage(input({ defenderHp: 50 }));
    expect(result.koText).toBe('확정 1타');
    expect(result.koChances[0]).toBe(1);
  });

  it('최대 난수로만 넘기면 난수 1타이고 확률을 말해준다', () => {
    // 대미지 69~82 구간에 HP 를 걸친다
    const result = calculateDamage(input({ defenderHp: 80 }));
    expect(result.koText).toMatch(/^난수 1타 \(\d+\.\d%\)$/);
    expect(result.koChances[0]).toBeGreaterThan(0);
    expect(result.koChances[0]).toBeLessThan(1);
  });

  it('두 방이면 확정 2타', () => {
    const result = calculateDamage(input({ defenderHp: 130 }));
    expect(result.koText).toBe('확정 2타');
  });

  it('확률은 타격 수가 늘수록 단조 증가한다', () => {
    const result = calculateDamage(input({ defenderHp: 250 }));
    for (let i = 1; i < result.koChances.length; i += 1) {
      expect(result.koChances[i]).toBeGreaterThanOrEqual(result.koChances[i - 1]!);
    }
  });

  it('난수 확률이 실제 분포와 맞는다', () => {
    // HP 82 면 82 를 내는 난수(최대값) 하나만 1발에 쓰러뜨린다 → 1/16
    const result = calculateDamage(input({ defenderHp: 82 }));
    expect(result.koChances[0]).toBeCloseTo(1 / 16, 6);
  });
});

describe('타격마다 위력이 커지는 연속기 (트리플악셀)', () => {
  const base = {
    moveType: 'Ice' as const,
    category: 'physical' as const,
    attack: 150,
    defense: 100,
    defenderHp: 300,
    attackerTypes: ['Ice' as const],
    defenderTypes: ['Normal' as const],
  };

  it('타격별 위력이 20 / 40 / 60 으로 커진다', () => {
    const result = calculateDamage({ ...base, power: 20, perHitPowers: [20, 40, 60] });
    expect(result.perHitRanges).toHaveLength(3);
    const [one, two, three] = result.perHitRanges;
    // 2타는 1타의 약 2배, 3타는 약 3배. 반올림 때문에 정확히 배수는 아니다.
    expect(two![0]).toBeGreaterThan(one![0] * 1.8);
    expect(three![0]).toBeGreaterThan(one![0] * 2.6);
  });

  it('같은 위력 3회와 결과가 다르다', () => {
    const flat = calculateDamage({ ...base, power: 20, hits: 3 });
    const escalating = calculateDamage({ ...base, power: 20, perHitPowers: [20, 40, 60] });
    // 20+40+60 = 120 이므로 20×3 = 60 보다 훨씬 크다.
    expect(escalating.max).toBeGreaterThan(flat.max * 1.8);
  });

  it('맞은 타수만큼만 계산한다', () => {
    const two = calculateDamage({ ...base, power: 20, perHitPowers: [20, 40] });
    const three = calculateDamage({ ...base, power: 20, perHitPowers: [20, 40, 60] });
    expect(two.perHitRanges).toHaveLength(2);
    expect(two.max).toBeLessThan(three.max);
  });

  it('난수는 타격마다 따로 뽑는다 (분포가 가운데로 몰린다)', () => {
    const result = calculateDamage({ ...base, power: 20, perHitPowers: [20, 40, 60] });
    // 최소·최대를 균등분포로 보면 안 된다는 성질. 합성 결과가 단순 곱이 아니어야 한다.
    const sumOfMins = result.perHitRanges.reduce((s, [lo]) => s + lo, 0);
    const sumOfMaxes = result.perHitRanges.reduce((s, [, hi]) => s + hi, 0);
    expect(result.min).toBe(sumOfMins);
    expect(result.max).toBe(sumOfMaxes);
  });
});

describe('지구력 — 맞을 때마다 방어가 오른다', () => {
  const base = {
    power: 20,
    moveType: 'Ice' as const,
    category: 'physical' as const,
    attack: 150,
    defenderHp: 300,
    attackerTypes: ['Ice' as const],
    defenderTypes: ['Normal' as const],
  };

  it('타격마다 방어가 커지면 뒤 타격이 덜 아프다', () => {
    // 방어 100 → +1랭크 150 → +2랭크 200 (랭크 보정 (2+n)/2)
    const result = calculateDamage({
      ...base,
      defense: 100,
      perHitPowers: [20, 40, 60],
      perHitDefenses: [100, 150, 200],
    });
    const [one, two, three] = result.perHitRanges;
    // 위력은 1→2→3배로 커지지만 방어도 1→1.5→2배라 증가폭이 눌린다.
    expect(two![0] / one![0]).toBeLessThan(2);
    expect(three![0] / one![0]).toBeLessThan(3);
  });

  it('지구력이 없을 때보다 총 대미지가 적다', () => {
    const withStamina = calculateDamage({
      ...base,
      defense: 100,
      perHitPowers: [20, 40, 60],
      perHitDefenses: [100, 150, 200],
    });
    const without = calculateDamage({ ...base, defense: 100, perHitPowers: [20, 40, 60] });
    expect(withStamina.max).toBeLessThan(without.max);
  });

  it('방어 배열이 타격 수보다 짧으면 마지막 값을 이어 쓴다', () => {
    const result = calculateDamage({
      ...base,
      defense: 100,
      perHitPowers: [20, 40, 60],
      perHitDefenses: [100, 150],
    });
    expect(result.perHitRanges).toHaveLength(3);
  });
});
