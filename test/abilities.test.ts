/**
 * 특성 효과 테스트.
 *
 * 두 가지를 함께 본다:
 *   1. 구현한 특성이 정확한 배율을 내는가
 *   2. **구현하지 않은 특성을 조용히 무시하지 않는가** — 기술 플래그가 없어
 *      정확히 구현할 수 없는 특성이 있고, 그건 흉내내는 대신 미반영으로 알려야 한다.
 */

import { describe, expect, it } from 'vitest';
import {
  NO_DAMAGE_EFFECT,
  UNSUPPORTED_ABILITIES,
  affectsDamage,
  attackerAbility,
  defenderAbility,
  resolveAbilities,
  type AbilityContext,
} from '../src/core/abilities';

function ctx(overrides: Partial<AbilityContext> = {}): AbilityContext {
  return {
    moveType: 'Normal',
    movePower: 100,
    category: 'physical',
    isRecoil: false,
    hasSecondaryEffect: false,
    flags: new Set<string>(),
    attackerTypes: ['Normal'],
    defenderTypes: ['Normal'],
    typeEffectiveness: 1,
    weather: 'none',
    isCritical: false,
    attackerLowHp: false,
    defenderFullHp: true,
    attackerBurned: false,
    defenderStatused: false,
    movesLast: false,
    attackerCharged: false,
    fallenAllies: 0,
    genderRelation: 'unknown',
    ...overrides,
  };
}

const resolve = (a: string | null, d: string | null, c = ctx()) => resolveAbilities(a, d, c);

describe('공격측 특성', () => {
  it('적응력은 자속을 2배로 덮어쓴다', () => {
    expect(resolve('Adaptability', null).attacker.stabOverride).toBe(2);
  });

  it('테크니션은 위력 60 이하에만 붙는다', () => {
    expect(resolve('Technician', null, ctx({ movePower: 60 })).attacker.powerMultiplier).toBe(1.5);
    expect(resolve('Technician', null, ctx({ movePower: 61 })).attacker.powerMultiplier).toBe(1);
  });

  it('이판사판은 반동기에만 붙는다', () => {
    expect(resolve('Reckless', null, ctx({ isRecoil: true })).attacker.powerMultiplier).toBe(1.2);
    expect(resolve('Reckless', null, ctx({ isRecoil: false })).attacker.powerMultiplier).toBe(1);
  });

  it('우격다짐은 부가효과가 있는 기술에만 붙는다', () => {
    expect(
      resolve('Sheer Force', null, ctx({ hasSecondaryEffect: true })).attacker.powerMultiplier,
    ).toBe(1.3);
    expect(
      resolve('Sheer Force', null, ctx({ hasSecondaryEffect: false })).attacker.powerMultiplier,
    ).toBe(1);
  });

  it('색안경은 효과가 별로일 때만, 무효일 때는 아니다', () => {
    expect(resolve('Tinted Lens', null, ctx({ typeEffectiveness: 0.5 })).attacker.damageMultiplier).toBe(2);
    expect(resolve('Tinted Lens', null, ctx({ typeEffectiveness: 1 })).attacker.damageMultiplier).toBe(1);
    expect(resolve('Tinted Lens', null, ctx({ typeEffectiveness: 0 })).attacker.damageMultiplier).toBe(1);
  });

  it('심록 계열은 HP 1/3 이하 + 해당 타입일 때만', () => {
    const low = ctx({ attackerLowHp: true, moveType: 'Grass' });
    expect(resolve('Overgrow', null, low).attacker.powerMultiplier).toBe(1.5);
    // 타입이 다르면 안 붙는다
    expect(
      resolve('Overgrow', null, ctx({ attackerLowHp: true, moveType: 'Fire' })).attacker.powerMultiplier,
    ).toBe(1);
    // HP 가 충분하면 안 붙는다
    expect(
      resolve('Overgrow', null, ctx({ attackerLowHp: false, moveType: 'Grass' })).attacker.powerMultiplier,
    ).toBe(1);
  });

  it('근성은 화상일 때 공격을 올리고 화상 반감을 무시한다', () => {
    const burned = resolve('Guts', null, ctx({ attackerBurned: true })).attacker;
    expect(burned.attackMultiplier).toBe(1.5);
    expect(burned.ignoresBurn).toBe(true);

    const healthy = resolve('Guts', null, ctx({ attackerBurned: false })).attacker;
    expect(healthy.attackMultiplier).toBe(1);
    expect(healthy.ignoresBurn).toBe(false);
  });

  it('의욕·괴력집게는 물리에만 공격 보정을 준다', () => {
    expect(resolve('Huge Power', null, ctx({ category: 'physical' })).attacker.attackMultiplier).toBe(2);
    expect(resolve('Huge Power', null, ctx({ category: 'special' })).attacker.attackMultiplier).toBe(1);
  });

  it('선파워는 쾌청 + 특수일 때만', () => {
    expect(
      resolve('Solar Power', null, ctx({ weather: 'sun', category: 'special' })).attacker.attackMultiplier,
    ).toBe(1.5);
    expect(
      resolve('Solar Power', null, ctx({ weather: 'none', category: 'special' })).attacker.attackMultiplier,
    ).toBe(1);
  });

  it('모래의힘은 모래바람에서 세 타입에만', () => {
    const sand = (moveType: AbilityContext['moveType']) =>
      resolve('Sand Force', null, ctx({ weather: 'sand', moveType })).attacker.powerMultiplier;
    expect(sand('Rock')).toBe(1.3);
    expect(sand('Ground')).toBe(1.3);
    expect(sand('Steel')).toBe(1.3);
    expect(sand('Fire')).toBe(1);
  });

  it('스나이퍼는 급소일 때만 추가 배율을 준다', () => {
    expect(resolve('Sniper', null, ctx({ isCritical: true })).attacker.critMultiplier).toBe(1.5);
    expect(resolve('Sniper', null, ctx({ isCritical: false })).attacker.critMultiplier).toBe(1);
  });

  it('스킨 계열은 노말 기술의 타입을 바꾸고 1.2배', () => {
    const out = resolve('Pixilate', null, ctx({ moveType: 'Normal' })).attacker;
    expect(out.moveTypeOverride).toBe('Fairy');
    expect(out.powerMultiplier).toBe(1.2);

    // 노말이 아니면 건드리지 않는다
    const other = resolve('Pixilate', null, ctx({ moveType: 'Water' })).attacker;
    expect(other.moveTypeOverride).toBeNull();
    expect(other.powerMultiplier).toBe(1);
  });
});

describe('방어측 특성', () => {
  it('하드록·필터는 효과가 굉장할 때만 경감한다', () => {
    expect(resolve(null, 'Solid Rock', ctx({ typeEffectiveness: 2 })).defender.damageMultiplier).toBe(0.75);
    expect(resolve(null, 'Solid Rock', ctx({ typeEffectiveness: 1 })).defender.damageMultiplier).toBe(1);
  });

  it('두꺼운지방은 불꽃·얼음만 반감한다', () => {
    expect(resolve(null, 'Thick Fat', ctx({ moveType: 'Fire' })).defender.damageMultiplier).toBe(0.5);
    expect(resolve(null, 'Thick Fat', ctx({ moveType: 'Ice' })).defender.damageMultiplier).toBe(0.5);
    expect(resolve(null, 'Thick Fat', ctx({ moveType: 'Water' })).defender.damageMultiplier).toBe(1);
  });

  it('멀티스케일은 만피에서만', () => {
    expect(resolve(null, 'Multiscale', ctx({ defenderFullHp: true })).defender.damageMultiplier).toBe(0.5);
    expect(resolve(null, 'Multiscale', ctx({ defenderFullHp: false })).defender.damageMultiplier).toBe(1);
  });

  it('얼음비늘은 특수만 반감한다', () => {
    expect(resolve(null, 'Ice Scales', ctx({ category: 'special' })).defender.damageMultiplier).toBe(0.5);
    expect(resolve(null, 'Ice Scales', ctx({ category: 'physical' })).defender.damageMultiplier).toBe(1);
  });

  it('무효 특성은 immune 을 세운다', () => {
    expect(resolve(null, 'Levitate', ctx({ moveType: 'Ground' })).defender.immune).toBe(true);
    expect(resolve(null, 'Levitate', ctx({ moveType: 'Water' })).defender.immune).toBe(false);
    expect(resolve(null, 'Flash Fire', ctx({ moveType: 'Fire' })).defender.immune).toBe(true);
    expect(resolve(null, 'Sap Sipper', ctx({ moveType: 'Grass' })).defender.immune).toBe(true);
  });

  it('건조피부는 물을 무효화하고 불꽃을 강화한다', () => {
    expect(resolve(null, 'Dry Skin', ctx({ moveType: 'Water' })).defender.immune).toBe(true);
    expect(resolve(null, 'Dry Skin', ctx({ moveType: 'Fire' })).defender.damageMultiplier).toBe(1.25);
  });

  it('불가사의부적은 효과가 굉장하지 않으면 전부 막는다', () => {
    expect(resolve(null, 'Wonder Guard', ctx({ typeEffectiveness: 1 })).defender.immune).toBe(true);
    expect(resolve(null, 'Wonder Guard', ctx({ typeEffectiveness: 2 })).defender.immune).toBe(false);
  });

  it('옹골참은 만피 생존 플래그를 세운다', () => {
    expect(resolve(null, 'Sturdy').defender.enduresAtFullHp).toBe(true);
  });
});

describe('틀깨기', () => {
  it('방어측 특성을 통째로 무시한다', () => {
    const withoutBreaker = resolve(null, 'Multiscale').defender.damageMultiplier;
    expect(withoutBreaker).toBe(0.5);

    const withBreaker = resolve('Mold Breaker', 'Multiscale').defender.damageMultiplier;
    expect(withBreaker).toBe(1);
  });

  it('무효 특성도 뚫는다', () => {
    expect(resolve('Mold Breaker', 'Levitate', ctx({ moveType: 'Ground' })).defender.immune).toBe(false);
  });
});

describe('기술 플래그 기반 특성', () => {
  const withFlag = (flag: string, extra: Partial<AbilityContext> = {}) =>
    ctx({ flags: new Set([flag]), ...extra });

  it('철주먹은 펀치 기술에만 ×1.2', () => {
    expect(resolve('Iron Fist', null, withFlag('punch')).attacker.powerMultiplier).toBe(1.2);
    // 펀치가 아니면 안 붙는다
    expect(resolve('Iron Fist', null, ctx()).attacker.powerMultiplier).toBe(1);
  });

  it('단단한발톱은 접촉 기술에 ×1.3', () => {
    expect(resolve('Tough Claws', null, withFlag('contact')).attacker.powerMultiplier).toBe(1.3);
    expect(resolve('Tough Claws', null, withFlag('punch')).attacker.powerMultiplier).toBe(1);
  });

  it('옹골찬턱·메가런처·예리함은 각 플래그에 ×1.5', () => {
    expect(resolve('Strong Jaw', null, withFlag('bite')).attacker.powerMultiplier).toBe(1.5);
    expect(resolve('Mega Launcher', null, withFlag('pulse')).attacker.powerMultiplier).toBe(1.5);
    expect(resolve('Sharpness', null, withFlag('slicing')).attacker.powerMultiplier).toBe(1.5);
  });

  it('펑크록은 공격이면 강화, 방어면 경감', () => {
    expect(resolve('Punk Rock', null, withFlag('sound')).attacker.powerMultiplier).toBe(1.3);
    expect(resolve(null, 'Punk Rock', withFlag('sound')).defender.damageMultiplier).toBe(0.5);
  });

  it('방탄은 구슬 기술을 무효화한다', () => {
    expect(resolve(null, 'Bulletproof', withFlag('bullet')).defender.immune).toBe(true);
    expect(resolve(null, 'Bulletproof', withFlag('punch')).defender.immune).toBe(false);
  });

  it('복슬복슬은 접촉을 반감하고 불꽃을 배로 받는다', () => {
    expect(resolve(null, 'Fluffy', withFlag('contact')).defender.damageMultiplier).toBe(0.5);
    expect(resolve(null, 'Fluffy', ctx({ moveType: 'Fire' })).defender.damageMultiplier).toBe(2);
    // 접촉 + 불꽃이면 상쇄된다
    expect(
      resolve(null, 'Fluffy', withFlag('contact', { moveType: 'Fire' })).defender.damageMultiplier,
    ).toBe(1);
  });

  it('플래그 정보가 없으면 조용히 넘어간다', () => {
    // 플래그가 비어 있어도 죽지 않고 배율 1 을 낸다
    expect(resolve('Iron Fist', null, ctx({ flags: new Set() })).attacker.powerMultiplier).toBe(1);
  });
});

describe('자속·타입을 바꾸는 특성', () => {
  it('변환자재는 모든 기술에 자속을 준다', () => {
    // 자속이 없는 조합 — 노말 타입이 물 기술을 쓰는 상황
    const out = resolve('Protean', null, ctx({ moveType: 'Water', attackerTypes: ['Normal'] }));
    expect(out.attacker.stabOverride).toBe(1.5);
  });

  it('변환자재는 원래 자속이던 기술도 1.5 로 유지한다', () => {
    const out = resolve('Protean', null, ctx({ moveType: 'Normal', attackerTypes: ['Normal'] }));
    expect(out.attacker.stabOverride).toBe(1.5);
  });

  it('리베로도 같은 효과다', () => {
    expect(resolve('Libero', null).attacker.stabOverride).toBe(1.5);
  });

  it('적응력과 변환자재는 서로 다른 값을 준다', () => {
    expect(resolve('Adaptability', null).attacker.stabOverride).toBe(2);
    expect(resolve('Protean', null).attacker.stabOverride).toBe(1.5);
  });

  it('촉촉보이스는 소리 기술을 물 타입으로 바꾼다', () => {
    const sound = ctx({ flags: new Set(['sound']), moveType: 'Normal' });
    expect(resolve('Liquid Voice', null, sound).attacker.moveTypeOverride).toBe('Water');
    // 소리 기술이 아니면 그대로
    expect(resolve('Liquid Voice', null, ctx()).attacker.moveTypeOverride).toBeNull();
  });

  it('드래곤스킨은 노말을 드래곤으로 바꾸고 1.2배', () => {
    const out = resolve('Dragonize', null, ctx({ moveType: 'Normal' })).attacker;
    expect(out.moveTypeOverride).toBe('Dragon');
    expect(out.powerMultiplier).toBe(1.2);
  });
});

describe('그 밖의 대미지 특성', () => {
  it('부자유친은 2회 공격을 합산해 ×1.25', () => {
    expect(resolve('Parental Bond', null).attacker.damageMultiplier).toBe(1.25);
  });

  it('퍼코트는 물리 방어를 2배로', () => {
    expect(resolve(null, 'Fur Coat', ctx({ category: 'physical' })).defender.defenseMultiplier).toBe(2);
    expect(resolve(null, 'Fur Coat', ctx({ category: 'special' })).defender.defenseMultiplier).toBe(1);
  });

  it('수포는 물 기술을 2배로 (공격측)', () => {
    expect(resolve('Water Bubble', null, ctx({ moveType: 'Water' })).attacker.damageMultiplier).toBe(2);
  });

  it('페어리오라는 페어리 기술만 강화한다', () => {
    expect(resolve('Fairy Aura', null, ctx({ moveType: 'Fairy' })).attacker.powerMultiplier).toBe(1.33);
    expect(resolve('Fairy Aura', null, ctx({ moveType: 'Water' })).attacker.powerMultiplier).toBe(1);
  });

  it('천진은 양쪽 모두에서 상대 랭크를 무시한다', () => {
    expect(resolve('Unaware', null).attacker.ignoresOpponentBoosts).toBe(true);
    expect(resolve(null, 'Unaware').defender.ignoresOpponentBoosts).toBe(true);
  });

  it('전투무장·조가비갑옷은 급소를 막는다', () => {
    expect(resolve(null, 'Battle Armor').defender.preventsCritical).toBe(true);
    expect(resolve(null, 'Shell Armor').defender.preventsCritical).toBe(true);
  });

  it('배짱은 노말·격투일 때만 고스트 무효를 뚫는다', () => {
    expect(resolve('Scrappy', null, ctx({ moveType: 'Normal' })).attacker.ignoresGhostImmunity).toBe(true);
    expect(resolve('Scrappy', null, ctx({ moveType: 'Fighting' })).attacker.ignoresGhostImmunity).toBe(true);
    expect(resolve('Scrappy', null, ctx({ moveType: 'Water' })).attacker.ignoresGhostImmunity).toBe(false);
  });

  it('흙먹기는 땅 기술을 무효화한다', () => {
    expect(resolve(null, 'Earth Eater', ctx({ moveType: 'Ground' })).defender.immune).toBe(true);
  });

  it('원격은 접촉 판정을 없앤다', () => {
    expect(resolve('Long Reach', null).attacker.removesContact).toBe(true);
  });
});

describe('Champions 에서 풀린 CAP 특성', () => {
  it('파이어메인은 불꽃 기술의 위력을 1.5배로', () => {
    expect(resolve('Fire Mane', null, ctx({ moveType: 'Fire' })).attacker.powerMultiplier).toBe(1.5);
    expect(resolve('Fire Mane', null, ctx({ moveType: 'Water' })).attacker.powerMultiplier).toBe(1);
  });

  it('메가솔라는 날씨를 쾌청으로 취급한다', () => {
    expect(resolve('Mega Sol', null).attacker.weatherOverride).toBe('sun');
    // 방어측이 갖고 있어도 마찬가지다
    expect(resolve(null, 'Mega Sol').defender.weatherOverride).toBe('sun');
  });

  it('Eelevate 는 부유처럼 땅 기술을 무효화한다', () => {
    expect(resolve(null, 'Eelevate', ctx({ moveType: 'Ground' })).defender.immune).toBe(true);
    expect(resolve(null, 'Eelevate', ctx({ moveType: 'Water' })).defender.immune).toBe(false);
  });

  it('관통드릴·하바네로분출은 대미지와 무관하다고 분류한다', () => {
    // 미구현이 아니라 원래 대미지에 영향이 없는 것들이다.
    expect(NO_DAMAGE_EFFECT.has('Piercing Drill')).toBe(true);
    expect(NO_DAMAGE_EFFECT.has('Spicy Spray')).toBe(true);
    expect(UNSUPPORTED_ABILITIES.has('Piercing Drill')).toBe(false);
    expect(affectsDamage('Piercing Drill')).toBe(false);
  });
});

describe('배틀 상황이 필요한 특성', () => {
  it('총대장은 쓰러진 아군 1마리당 10% 씩 올린다', () => {
    const of = (fallenAllies: number) =>
      resolve('Supreme Overlord', null, ctx({ fallenAllies })).attacker.powerMultiplier;
    expect(of(0)).toBe(1);
    expect(of(1)).toBeCloseTo(1.1, 5);
    expect(of(3)).toBeCloseTo(1.3, 5);
    expect(of(5)).toBeCloseTo(1.5, 5);
    // 5마리를 넘겨도 상한이 걸린다
    expect(of(9)).toBeCloseTo(1.5, 5);
  });

  it('투쟁심은 성별 관계에 따라 오르내린다', () => {
    const of = (genderRelation: AbilityContext['genderRelation']) =>
      resolve('Rivalry', null, ctx({ genderRelation })).attacker.powerMultiplier;
    expect(of('same')).toBe(1.25);
    expect(of('different')).toBe(0.75);
    // 무성이면 변화가 없다
    expect(of('unknown')).toBe(1);
  });
});

describe('스킬링크', () => {
  it('연속기 타격 수를 최대로 고정하는 플래그를 세운다', () => {
    expect(resolve('Skill Link', null).attacker.forcesMaxHits).toBe(true);
    expect(resolve(null, null).attacker.forcesMaxHits).toBe(false);
  });

  it('더 이상 미지원이 아니다', () => {
    expect(UNSUPPORTED_ABILITIES.has('Skill Link')).toBe(false);
    expect(affectsDamage('Skill Link')).toBe(true);
  });
});

describe('미구현 특성을 감추지 않는다', () => {
  it('한 턴 계산으로 확정할 수 없는 것만 미지원으로 남는다', () => {
    for (const [name, reason] of UNSUPPORTED_ABILITIES) {
      expect(reason).toBeTruthy();
      // 미지원 목록에 있으면 구현 목록에는 없어야 한다
      expect(affectsDamage(name)).toBe(false);
    }
    // 남은 미지원은 한 턴 계산으로 확정할 수 없는 것뿐이다.
    expect(UNSUPPORTED_ABILITIES.has('Stakeout')).toBe(true);
  });

  it('미지원 특성은 배율을 만들지 않는다 (흉내내지 않는다)', () => {
    const out = resolve('Stakeout', null).attacker;
    expect(out.damageMultiplier).toBe(1);
    expect(out.powerMultiplier).toBe(1);
    expect(out.attackMultiplier).toBe(1);
  });

  it('모르는 특성 이름에도 죽지 않는다', () => {
    const out = resolve('Totally Made Up', 'Also Fake');
    expect(out.attacker.damageMultiplier).toBe(1);
    expect(out.defender.damageMultiplier).toBe(1);
  });

  it('특성이 없어도 동작한다', () => {
    const out = resolve(null, null);
    expect(out.attacker.stabOverride).toBeNull();
    expect(out.defender.immune).toBe(false);
  });
});

describe('조회 함수', () => {
  it('공격·방어 특성을 각각 찾는다', () => {
    expect(attackerAbility('Adaptability')?.note).toContain('자속');
    expect(defenderAbility('Multiscale')?.note).toContain('만땅');
    // 방어 전용 특성을 공격측에서 찾으면 없다
    expect(attackerAbility('Multiscale')).toBeNull();
    expect(defenderAbility('Adaptability')).toBeNull();
  });

  it('대미지에 관여하는지 판별한다', () => {
    expect(affectsDamage('Adaptability')).toBe(true);
    expect(affectsDamage('Multiscale')).toBe(true);
    // 대미지와 무관한 특성
    expect(affectsDamage('Frisk')).toBe(false);
  });
});

describe('사용자가 게임에서 확인해 준 Champions 특성', () => {
  it('불꽃의갈기는 공격이 아니라 위력을 1.5배 한다', () => {
    // 게임 내 설명이 "위력이 1.5배" 다. 공격 실수치에 곱하면 반올림 시점이 달라진다.
    const out = resolveAbilities('Fire Mane', null, ctx({ moveType: 'Fire' }));
    expect(out.attacker.powerMultiplier).toBe(1.5);
    expect(out.attacker.attackMultiplier).toBe(1);
  });

  it('불꽃의갈기는 불꽃 기술에만 붙는다', () => {
    const out = resolveAbilities('Fire Mane', null, ctx({ moveType: 'Water' }));
    expect(out.attacker.powerMultiplier).toBe(1);
  });

  it('메가솔라는 날씨를 쾌청으로 취급한다', () => {
    // "기술을 사용할 때 쾌청 상태일 때와 동일한 효과를 얻는다"
    const out = resolveAbilities('Mega Sol', null, ctx({ moveType: 'Fire', weather: 'none' }));
    expect(out.attacker.weatherOverride).toBe('sun');
  });

  it('Eelevate 는 부유와 같이 땅 기술을 무효로 한다', () => {
    const out = resolveAbilities(null, 'Eelevate', ctx({ moveType: 'Ground' }));
    expect(out.defender.immune).toBe(true);
  });

  it('드래곤스킨은 노말 기술을 드래곤으로 바꾸고 위력을 올린다', () => {
    const out = resolveAbilities('Dragonize', null, ctx({ moveType: 'Normal' }));
    expect(out.attacker.moveTypeOverride).toBe('Dragon');
    expect(out.attacker.powerMultiplier).toBeGreaterThan(1);
  });
});

describe('전기로바꾸기 — 충전 상태', () => {
  it('충전되면 전기 기술 위력이 2배', () => {
    const out = resolveAbilities(
      'Electromorphosis',
      null,
      ctx({ moveType: 'Electric', attackerCharged: true }),
    );
    expect(out.attacker.powerMultiplier).toBe(2);
  });

  it('충전 전에는 아무 일도 없다', () => {
    // 맞아야 충전되는 특성이라 기본은 꺼짐이어야 한다.
    const out = resolveAbilities(
      'Electromorphosis',
      null,
      ctx({ moveType: 'Electric', attackerCharged: false }),
    );
    expect(out.attacker.powerMultiplier).toBe(1);
  });

  it('충전돼도 전기 기술이 아니면 그대로다', () => {
    const out = resolveAbilities(
      'Electromorphosis',
      null,
      ctx({ moveType: 'Water', attackerCharged: true }),
    );
    expect(out.attacker.powerMultiplier).toBe(1);
  });
});
