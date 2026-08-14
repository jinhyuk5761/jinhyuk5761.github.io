/**
 * 가변 위력 기술 테스트.
 *
 * 이 기능이 생긴 이유가 "성묘가 항상 위력 50 으로 계산되던" 버그이므로,
 * 검증도 거기서 출발한다. 그리고 **확정할 수 없는 것을 지어내지 않는지**를 함께 본다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeMoves, type MoveInfo } from '../src/adapters/moveDex';
import {
  applyEffectivenessQuirk,
  needsManualPower,
  resolveMoveType,
  resolvePower,
  sumPositiveBoosts,
} from '../src/core/variablePower';
import { effectiveness } from '../src/core/typechart';
import type { PowerContext } from '../src/core/variablePower';

const dex = normalizeMoves(
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'moves.json'), 'utf8')),
);

function move(name: string): MoveInfo {
  const found = dex.get(name);
  expect(found, `${name} 이 기술 도감에 없습니다`).toBeDefined();
  return found!;
}

function ctx(overrides: Partial<PowerContext> = {}): PowerContext {
  return {
    fallenAllies: 0,
    positiveBoosts: 0,
    attackerSpeed: 100,
    defenderSpeed: 100,
    defenderStatused: false,
    attackerHasItem: true,
    terrain: 'none',
    defenderGrounded: true,
    attackerWeightKg: 100,
    defenderWeightKg: 100,
    weather: 'none',
    attackerStatused: false,
    defenderHasItem: false,
    attackerFormName: 'Pikachu',
    attackerHpRatio: 1,
    defenderHpRatio: 1,
    defenderPoisoned: false,
    ...overrides,
  };
}

describe('성묘 — 이 기능이 생긴 계기', () => {
  it('데이터에 가변 위력으로 표시돼 있다', () => {
    const m = move('Last Respects');
    expect(m.variablePower).toBe('fallenAllies');
    expect(m.variablePowerNote).toContain('쓰러진 아군');
  });

  it('쓰러진 아군 1마리당 50 씩 오른다', () => {
    const m = move('Last Respects');
    expect(resolvePower(m, ctx({ fallenAllies: 0 }))).toBe(50);
    expect(resolvePower(m, ctx({ fallenAllies: 1 }))).toBe(100);
    expect(resolvePower(m, ctx({ fallenAllies: 3 }))).toBe(200);
    expect(resolvePower(m, ctx({ fallenAllies: 5 }))).toBe(300);
  });

  it('5마리를 넘겨도 상한이 걸린다', () => {
    expect(resolvePower(move('Last Respects'), ctx({ fallenAllies: 9 }))).toBe(300);
  });
});

describe('랭크로 강해지는 기술', () => {
  it('어시스트파워는 올라간 랭크 1당 20 씩 오른다', () => {
    const m = move('Stored Power');
    expect(resolvePower(m, ctx({ positiveBoosts: 0 }))).toBe(20);
    expect(resolvePower(m, ctx({ positiveBoosts: 3 }))).toBe(80);
    expect(resolvePower(m, ctx({ positiveBoosts: 6 }))).toBe(140);
  });

  it('내려간 랭크는 세지 않는다', () => {
    expect(sumPositiveBoosts({ atk: 2, def: -3, spe: 1 })).toBe(3);
    expect(sumPositiveBoosts({ atk: -2, def: -1 })).toBe(0);
  });
});

describe('스피드로 정해지는 기술', () => {
  it('자이로볼은 상대가 느릴수록 강해진다', () => {
    const m = move('Gyro Ball');
    // 상대가 훨씬 느리면 상한 150
    expect(resolvePower(m, ctx({ attackerSpeed: 50, defenderSpeed: 500 }))).toBe(150);
    // 같은 속도면 약하다
    const even = resolvePower(m, ctx({ attackerSpeed: 100, defenderSpeed: 100 }))!;
    expect(even).toBeGreaterThan(0);
    expect(even).toBeLessThan(50);
  });

  it('자이로볼은 상한 150 을 넘지 않는다', () => {
    const m = move('Gyro Ball');
    expect(resolvePower(m, ctx({ attackerSpeed: 1, defenderSpeed: 999 }))).toBe(150);
  });

  it('일렉트릭볼은 구간으로 나뉜다', () => {
    const m = move('Electro Ball');
    // 자신이 4배 이상 빠르면 최대
    expect(resolvePower(m, ctx({ attackerSpeed: 400, defenderSpeed: 100 }))).toBe(150);
    // 같은 속도면 최소 구간
    expect(resolvePower(m, ctx({ attackerSpeed: 100, defenderSpeed: 100 }))).toBe(60);
    // 자신이 더 느리면 가장 약하다
    expect(resolvePower(m, ctx({ attackerSpeed: 50, defenderSpeed: 100 }))).toBe(40);
  });

  it('0 으로 나누는 상황에도 죽지 않는다', () => {
    expect(resolvePower(move('Gyro Ball'), ctx({ attackerSpeed: 0 }))).toBe(1);
    expect(resolvePower(move('Electro Ball'), ctx({ defenderSpeed: 0 }))).toBe(150);
  });
});

describe('조건부로 2배가 되는 기술', () => {
  it('병상첨병은 상대가 상태이상이면 2배', () => {
    const m = move('Hex');
    const base = m.power!;
    expect(resolvePower(m, ctx({ defenderStatused: false }))).toBe(base);
    expect(resolvePower(m, ctx({ defenderStatused: true }))).toBe(base * 2);
  });

  it('애크러뱃은 도구가 없으면 2배', () => {
    const m = move('Acrobatics');
    const base = m.power!;
    expect(resolvePower(m, ctx({ attackerHasItem: true }))).toBe(base);
    expect(resolvePower(m, ctx({ attackerHasItem: false }))).toBe(base * 2);
  });

  it('라이징볼트는 일렉트릭필드 위의 상대에게만 2배', () => {
    const m = move('Rising Voltage');
    const base = m.power!;
    expect(resolvePower(m, ctx({ terrain: 'electric', defenderGrounded: true }))).toBe(base * 2);
    // 상대가 떠 있으면 안 오른다
    expect(resolvePower(m, ctx({ terrain: 'electric', defenderGrounded: false }))).toBe(base);
    // 다른 필드면 안 오른다
    expect(resolvePower(m, ctx({ terrain: 'grassy', defenderGrounded: true }))).toBe(base);
  });
});

describe('몸무게로 정해지는 기술', () => {
  it('풀묶기는 상대 몸무게 구간에 따라 20~120', () => {
    const m = move('Grass Knot');
    const at = (kg: number) => resolvePower(m, ctx({ defenderWeightKg: kg }));
    expect(at(5)).toBe(20);
    expect(at(10)).toBe(40);
    expect(at(25)).toBe(60);
    expect(at(50)).toBe(80);
    expect(at(100)).toBe(100);
    expect(at(200)).toBe(120);
    expect(at(999)).toBe(120);
  });

  it('구간 경계 바로 아래는 낮은 값이다', () => {
    const m = move('Low Kick');
    expect(resolvePower(m, ctx({ defenderWeightKg: 9.9 }))).toBe(20);
    expect(resolvePower(m, ctx({ defenderWeightKg: 199.9 }))).toBe(100);
  });

  it('헤비봄버는 몸무게 비율로 정해진다', () => {
    const m = move('Heavy Slam');
    const ratio = (a: number, d: number) =>
      resolvePower(m, ctx({ attackerWeightKg: a, defenderWeightKg: d }));
    expect(ratio(100, 100)).toBe(40); // 1배
    expect(ratio(200, 100)).toBe(60); // 2배
    expect(ratio(300, 100)).toBe(80); // 3배
    expect(ratio(400, 100)).toBe(100); // 4배
    expect(ratio(500, 100)).toBe(120); // 5배
    // 상대가 더 무거우면 최소
    expect(ratio(50, 100)).toBe(40);
  });

  it('몸무게를 모르면 지어내지 않고 null 을 준다', () => {
    expect(resolvePower(move('Grass Knot'), ctx({ defenderWeightKg: null }))).toBeNull();
    expect(resolvePower(move('Heavy Slam'), ctx({ attackerWeightKg: null }))).toBeNull();
  });
});

describe('basePowerCallback 이 아닌 방식의 조건부 기술', () => {
  it('솔라빔은 쾌청이 아닌 날씨에서 절반이 된다', () => {
    const m = move('Solar Beam');
    const base = m.power!;
    expect(resolvePower(m, ctx({ weather: 'none' }))).toBe(base);
    expect(resolvePower(m, ctx({ weather: 'sun' }))).toBe(base);
    expect(resolvePower(m, ctx({ weather: 'rain' }))).toBe(Math.floor(base / 2));
    expect(resolvePower(m, ctx({ weather: 'sand' }))).toBe(Math.floor(base / 2));
  });

  it('와이드포스는 사이코필드에서만 1.5배', () => {
    const m = move('Expanding Force');
    const base = m.power!;
    expect(resolvePower(m, ctx({ terrain: 'psychic' }))).toBe(Math.floor(base * 1.5));
    expect(resolvePower(m, ctx({ terrain: 'electric' }))).toBe(base);
  });

  it('탁쳐서떨구기는 상대가 도구를 들었을 때만 1.5배', () => {
    const m = move('Knock Off');
    const base = m.power!;
    expect(resolvePower(m, ctx({ defenderHasItem: true }))).toBe(Math.floor(base * 1.5));
    expect(resolvePower(m, ctx({ defenderHasItem: false }))).toBe(base);
  });

  it('객기는 자신이 상태이상일 때 2배', () => {
    const m = move('Facade');
    const base = m.power!;
    expect(resolvePower(m, ctx({ attackerStatused: true }))).toBe(base * 2);
    expect(resolvePower(m, ctx({ attackerStatused: false }))).toBe(base);
  });

  it('웨더볼·대지의파동은 날씨/필드가 있으면 2배', () => {
    expect(resolvePower(move('Weather Ball'), ctx({ weather: 'rain' }))).toBe(
      move('Weather Ball').power! * 2,
    );
    expect(resolvePower(move('Terrain Pulse'), ctx({ terrain: 'grassy' }))).toBe(
      move('Terrain Pulse').power! * 2,
    );
  });
});

describe('타입이 바뀌는 기술', () => {
  it('웨더볼은 날씨에 따라 타입이 바뀐다', () => {
    const m = move('Weather Ball');
    expect(resolveMoveType(m, ctx({ weather: 'sun' }))).toBe('Fire');
    expect(resolveMoveType(m, ctx({ weather: 'rain' }))).toBe('Water');
    expect(resolveMoveType(m, ctx({ weather: 'sand' }))).toBe('Rock');
    expect(resolveMoveType(m, ctx({ weather: 'snow' }))).toBe('Ice');
    // 날씨가 없으면 원래 타입을 쓴다
    expect(resolveMoveType(m, ctx({ weather: 'none' }))).toBeNull();
  });

  it('대지의파동은 필드에 따라 타입이 바뀐다', () => {
    const m = move('Terrain Pulse');
    expect(resolveMoveType(m, ctx({ terrain: 'electric' }))).toBe('Electric');
    expect(resolveMoveType(m, ctx({ terrain: 'misty' }))).toBe('Fairy');
    expect(resolveMoveType(m, ctx({ terrain: 'none' }))).toBeNull();
  });

  it('오라휠은 모르페코 폼에 따라 전기/악', () => {
    const m = move('Aura Wheel');
    expect(resolveMoveType(m, ctx({ attackerFormName: 'Morpeko' }))).toBe('Electric');
    expect(resolveMoveType(m, ctx({ attackerFormName: 'Morpeko Hangry Mode' }))).toBe('Dark');
  });

  it('타입이 안 바뀌는 기술은 null 이다', () => {
    expect(resolveMoveType(move('Earthquake'), ctx())).toBeNull();
  });
});

describe('타입표만으로 안 맞는 기술', () => {
  it('프리즈드라이는 물에 효과가 굉장하다', () => {
    const m = move('Freeze-Dry');
    // 표대로면 얼음 → 물은 0.5 배다. 그대로 두면 정반대 결론이 나온다.
    expect(effectiveness('Ice', ['Water'])).toBe(0.5);
    expect(applyEffectivenessQuirk(m, ['Water'], 0.5, effectiveness)).toBe(2);
  });

  it('복합타입에서도 나머지 상성은 그대로 곱한다', () => {
    const m = move('Freeze-Dry');
    // 물/땅 — 물은 2배로 갈아끼우고 땅(얼음에 2배)은 유지 → 4배
    expect(applyEffectivenessQuirk(m, ['Water', 'Ground'], 1, effectiveness)).toBe(4);
    // 물/불꽃 — 불꽃은 얼음을 반감 → 2 × 0.5 = 1배
    expect(applyEffectivenessQuirk(m, ['Water', 'Fire'], 0.25, effectiveness)).toBe(1);
  });

  it('물 타입이 아니면 건드리지 않는다', () => {
    const m = move('Freeze-Dry');
    const base = effectiveness('Ice', ['Dragon']);
    expect(applyEffectivenessQuirk(m, ['Dragon'], base, effectiveness)).toBe(base);
  });

  it('플라잉프레스는 격투에 비행 상성을 곱한다', () => {
    const m = move('Flying Press');
    // 풀 — 격투만 보면 1배지만 비행이 2배라 합쳐서 2배가 된다.
    expect(effectiveness('Fighting', ['Grass'])).toBe(1);
    expect(applyEffectivenessQuirk(m, ['Grass'], 1, effectiveness)).toBe(2);

    // 강철 — 격투 2배 × 비행 0.5배 = 1배로 상쇄된다.
    expect(applyEffectivenessQuirk(m, ['Steel'], effectiveness('Fighting', ['Steel']), effectiveness)).toBe(1);
  });

  it('예외가 없는 기술은 그대로 통과한다', () => {
    expect(applyEffectivenessQuirk(move('Earthquake'), ['Fire'], 2, effectiveness)).toBe(2);
  });
});

describe('확정할 수 없는 것은 지어내지 않는다', () => {
  it('직접 입력이 필요한 기술은 null 을 준다', () => {
    // 분화·기사회생은 남은 HP 슬라이더가 생기면서 자동 계산으로 옮겨갔다.
    for (const name of ['Rage Fist', 'Payback', 'Round']) {
      const m = move(name);
      expect(needsManualPower(m), `${name}`).toBe(true);
      expect(resolvePower(m, ctx()), `${name}`).toBeNull();
    }
  });

  it('무엇에 따라 달라지는지 설명이 붙어 있다', () => {
    expect(move('Eruption').variablePowerNote).toContain('HP');
    expect(move('Reversal').variablePowerNote).toContain('HP');
    expect(move('Rage Fist').variablePowerNote).toContain('맞은 횟수');
  });
});

describe('남은 HP 로 정해지는 위력', () => {
  it('분화는 남은 HP 비율에 그대로 비례한다', () => {
    const m = move('Eruption');
    expect(m.variablePower).toBe('userHp');
    expect(resolvePower(m, ctx({ attackerHpRatio: 1 }))).toBe(150);
    expect(resolvePower(m, ctx({ attackerHpRatio: 0.5 }))).toBe(75);
    // 위력 0 이 되면 대미지가 사라져 계산이 무의미해진다. 최소 1 로 둔다.
    expect(resolvePower(m, ctx({ attackerHpRatio: 0.001 }))).toBe(1);
  });

  it('기사회생은 HP 가 적을수록 강해진다', () => {
    const m = move('Reversal');
    expect(m.variablePower).toBe('userHpInverse');
    // 본가는 남은 비율을 48등분해 구간을 가른다.
    expect(resolvePower(m, ctx({ attackerHpRatio: 1 }))).toBe(20);
    expect(resolvePower(m, ctx({ attackerHpRatio: 0.5 }))).toBe(40);
    expect(resolvePower(m, ctx({ attackerHpRatio: 0.25 }))).toBe(80);
    expect(resolvePower(m, ctx({ attackerHpRatio: 0.01 }))).toBe(200);
  });

  it('하드프레스는 상대의 남은 HP 를 본다 (자기 HP 가 아니다)', () => {
    const m = move('Hard Press');
    expect(m.variablePower).toBe('targetHp');
    expect(resolvePower(m, ctx({ defenderHpRatio: 1, attackerHpRatio: 0.1 }))).toBe(100);
    expect(resolvePower(m, ctx({ defenderHpRatio: 0.25 }))).toBe(25);
  });

  it('소금물은 상대 HP 가 절반 이하일 때만 2배다', () => {
    const m = move('Brine');
    expect(m.variablePower).toBe('targetHalfHp');
    const full = resolvePower(m, ctx({ defenderHpRatio: 0.51 }))!;
    expect(resolvePower(m, ctx({ defenderHpRatio: 0.5 }))).toBe(full * 2);
  });

  it('베놈쇼크는 독 상태에만 붙는다 (다른 상태이상은 아니다)', () => {
    const m = move('Venoshock');
    expect(m.variablePower).toBe('targetPoisoned');
    const plain = resolvePower(m, ctx({ defenderPoisoned: false }))!;
    expect(resolvePower(m, ctx({ defenderPoisoned: true }))).toBe(plain * 2);
    // 상태이상이긴 해도 독이 아니면 오르지 않는다.
    expect(resolvePower(m, ctx({ defenderStatused: true, defenderPoisoned: false }))).toBe(plain);
  });
});

describe('고정 위력 기술은 그대로', () => {
  it('가변 표시가 없으면 저장된 위력을 쓴다', () => {
    const m = move('Earthquake');
    expect(m.variablePower).toBeNull();
    expect(needsManualPower(m)).toBe(false);
    expect(resolvePower(m, ctx())).toBe(100);
  });

  it('조건을 바꿔도 값이 흔들리지 않는다', () => {
    const m = move('Earthquake');
    expect(resolvePower(m, ctx({ fallenAllies: 5, positiveBoosts: 6 }))).toBe(100);
  });
});

describe('데이터 정합성', () => {
  it('로스터의 가변 위력 기술이 모두 표시돼 있다', () => {
    const variable = [...dex.values()].filter((m) => m.variablePower);
    expect(variable.length).toBeGreaterThanOrEqual(30);
    // 표시된 것에는 전부 설명이 붙어야 한다.
    for (const m of variable) {
      expect(m.variablePowerNote, m.englishName).toBeTruthy();
    }
  });

  it('자동 계산 대상은 직접 입력을 요구하지 않는다', () => {
    const auto = [...dex.values()].filter((m) => m.variablePower && m.variablePower !== 'manual');
    expect(auto.length).toBe(29);
    for (const m of auto) {
      expect(needsManualPower(m), m.englishName).toBe(false);
      expect(resolvePower(m, ctx()), m.englishName).not.toBeNull();
    }
  });
});
