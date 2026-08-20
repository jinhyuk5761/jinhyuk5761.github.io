/**
 * 대미지 계산에 관여하는 특성.
 *
 * **범위를 먼저 못박는다.** PokéAPI 는 기술의 플래그(접촉/펀치/소리/파동/구슬)를
 * 제공하지 않는다(move 응답에 flags 필드 자체가 없다). 그래서 그 플래그에 의존하는
 * 특성은 *정확히* 구현할 수 없고, 흉내내면 틀린 숫자가 확신에 찬 얼굴로 나간다.
 * 그런 특성은 UNSUPPORTED 에 넣고 화면에서 "계산에 반영되지 않음"이라고 밝힌다.
 *
 * 반대로 meta 에서 파생할 수 있는 건 정확히 구현한다:
 *   - 반동기 여부 → drain < 0        (이판사판)
 *   - 부가효과 여부 → ailment/flinch/stat 확률 (우격다짐)
 *   - 위력 → power                    (테크니션)
 */

import type { TypeName } from '../types';
import type { Weather } from './damage';

export interface AbilityContext {
  moveType: TypeName;
  movePower: number;
  category: 'physical' | 'special';
  /**
   * 상대의 어느 **방어 실수치**를 보는가. 보통 분류와 같지만 사이코쇼크는
   * 특수기이면서 '방어'를 본다. 실수치를 올리는 특성(두꺼운털가죽·이상한비늘)은
   * 분류가 아니라 이 값을 따라야 한다. 생략하면 분류와 같다고 본다.
   */
  defenseCategory?: 'physical' | 'special';
  /** 반동기인가 (drain < 0) */
  isRecoil: boolean;
  /** 확률성 부가효과가 있는가 */
  hasSecondaryEffect: boolean;
  /** 기술 플래그 (contact/punch/sound/bite/pulse/bullet/slicing/powder) */
  flags: ReadonlySet<string>;
  attackerTypes: TypeName[];
  defenderTypes: TypeName[];
  /** 특성 적용 전의 타입 상성 */
  typeEffectiveness: number;
  weather: Weather;
  isCritical: boolean;
  /** 공격측 HP 가 1/3 이하인가 (심록·맹화·급류·벌레의알림) */
  attackerLowHp: boolean;
  /** 방어측이 HP 만땅인가 (멀티스케일·옹골참) */
  defenderFullHp: boolean;
  attackerBurned: boolean;
  /** 방어측이 상태이상인가 (이상한비늘) */
  defenderStatused: boolean;
  /** 공격측이 나중에 움직이는가 (애널라이즈) */
  movesLast: boolean;
  /**
   * 공격측이 충전 상태인가 (전기로바꾸기).
   * 이 특성은 **맞은 뒤에** 발동하므로 계산기가 스스로 알 수 없다 — 사람이 켠다.
   */
  attackerCharged: boolean;
  /** 쓰러진 아군 수 0~5 (총대장) */
  fallenAllies: number;
  /** 공격측과 방어측의 성별 관계 (투쟁심) */
  genderRelation: 'same' | 'different' | 'unknown';
}

export interface AbilityOutcome {
  /** 공격 실수치 배율 */
  attackMultiplier: number;
  /** 방어 실수치 배율 */
  defenseMultiplier: number;
  /**
   * **위력 단계** 배율. 대미지 공식에 들어가기 전에 위력에 곱해진다.
   * 철주먹·테크니션처럼 원래 위력을 올리는 특성이 여기 온다.
   */
  powerMultiplier: number;
  /** 최종 대미지 배율. 하드록·색안경처럼 계산 끝에 곱해지는 것들. */
  damageMultiplier: number;
  /** 자속 배율을 덮어쓴다 (적응력) */
  stabOverride: number | null;
  /** 기술 타입을 바꾼다 (스킨 계열) */
  moveTypeOverride: TypeName | null;
  /** 급소 배율에 추가로 곱한다 (스나이퍼) */
  critMultiplier: number;
  /** 대미지를 완전히 막는다 (부유·저수 등) */
  immune: boolean;
  /** 화상 반감을 무시한다 (근성) */
  ignoresBurn: boolean;
  /** 만피에서 한 방에 쓰러지지 않는다 (옹골참) */
  enduresAtFullHp: boolean;
  /** 상대 특성을 무시한다 (틀깨기) */
  ignoresDefenderAbility: boolean;
  /** 상대의 랭크 변화를 무시한다 (천진) */
  ignoresOpponentBoosts: boolean;
  /** 급소를 막는다 (전투무장·조가비갑옷) */
  preventsCritical: boolean;
  /** 고스트의 노말·격투 무효를 뚫는다 (배짱) */
  ignoresGhostImmunity: boolean;
  /** 접촉 판정을 없앤다 (원격) — 복슬복슬·단단한발톱 판정에 영향 */
  removesContact: boolean;
  /** 날씨를 다른 것으로 인식한다 (메가솔라 = 쾌청 취급) */
  weatherOverride: Weather | null;
  /** 연속기의 타격 수를 최대로 고정한다 (스킬링크) */
  forcesMaxHits: boolean;
}

function base(): AbilityOutcome {
  return {
    attackMultiplier: 1,
    defenseMultiplier: 1,
    powerMultiplier: 1,
    damageMultiplier: 1,
    stabOverride: null,
    moveTypeOverride: null,
    critMultiplier: 1,
    immune: false,
    ignoresBurn: false,
    enduresAtFullHp: false,
    ignoresDefenderAbility: false,
    ignoresOpponentBoosts: false,
    preventsCritical: false,
    ignoresGhostImmunity: false,
    removesContact: false,
    weatherOverride: null,
    forcesMaxHits: false,
  };
}

type Effect = (ctx: AbilityContext, out: AbilityOutcome) => void;

/** 실수치를 올리는 특성이 볼 값. 기술이 따로 정하지 않았으면 분류를 그대로 쓴다. */
function defenseSide(ctx: AbilityContext): 'physical' | 'special' {
  return ctx.defenseCategory ?? ctx.category;
}

/** 저위력 강화. 테크니션은 위력 60 이하가 대상이다. */
const technician: Effect = (ctx, out) => {
  if (ctx.movePower <= 60) out.powerMultiplier *= 1.5;
};

/** 심록·맹화·급류·벌레의알림 — HP 1/3 이하에서 해당 타입 1.5배. */
function pinch(type: TypeName): Effect {
  return (ctx, out) => {
    if (ctx.attackerLowHp && ctx.moveType === type) out.powerMultiplier *= 1.5;
  };
}

/** 스킨 계열 — 노말 기술을 해당 타입으로 바꾸고 1.2배. */
function typeChanger(type: TypeName): Effect {
  return (ctx, out) => {
    if (ctx.moveType === 'Normal') {
      out.moveTypeOverride = type;
      out.powerMultiplier *= 1.2;
    }
  };
}

/** 특정 타입을 무효화한다. */
function immuneTo(...types: TypeName[]): Effect {
  return (ctx, out) => {
    if (types.includes(ctx.moveType)) out.immune = true;
  };
}

/** 특정 플래그를 가진 기술의 대미지에 배율을 건다. */
function flagBoost(flag: string, multiplier: number): Effect {
  return (ctx, out) => {
    if (ctx.flags.has(flag)) out.powerMultiplier *= multiplier;
  };
}

/** 특정 타입 기술을 강화한다. */
function typeBoost(type: TypeName, multiplier: number): Effect {
  return (ctx, out) => {
    if (ctx.moveType === type) out.powerMultiplier *= multiplier;
  };
}

export interface AbilityDef {
  /** 영문명 (championsbattledata 표기와 같다) */
  name: string;
  /** 무엇을 하는지 한 줄. 화면에 그대로 보여준다. */
  note: string;
  effect: Effect;
}

/** 공격측 특성. */
const ATTACKER_LIST: AbilityDef[] = [
  { name: 'Adaptability', note: '자속 ×2', effect: (_c, o) => { o.stabOverride = 2; } },
  { name: 'Technician', note: '위력 60 이하 ×1.5', effect: technician },
  { name: 'Reckless', note: '반동기 ×1.2', effect: (c, o) => { if (c.isRecoil) o.powerMultiplier *= 1.2; } },
  {
    name: 'Sheer Force',
    note: '부가효과가 있는 기술 ×1.3 (부가효과는 발동하지 않음)',
    effect: (c, o) => { if (c.hasSecondaryEffect) o.powerMultiplier *= 1.3; },
  },
  {
    name: 'Tinted Lens',
    note: '효과가 별로일 때 ×2',
    effect: (c, o) => { if (c.typeEffectiveness < 1 && c.typeEffectiveness > 0) o.damageMultiplier *= 2; },
  },
  { name: 'Sniper', note: '급소 시 추가 ×1.5', effect: (c, o) => { if (c.isCritical) o.critMultiplier *= 1.5; } },
  { name: 'Huge Power', note: '공격 ×2', effect: (c, o) => { if (c.category === 'physical') o.attackMultiplier *= 2; } },
  { name: 'Pure Power', note: '공격 ×2', effect: (c, o) => { if (c.category === 'physical') o.attackMultiplier *= 2; } },
  { name: 'Hustle', note: '공격 ×1.5 (명중률 하락)', effect: (c, o) => { if (c.category === 'physical') o.attackMultiplier *= 1.5; } },
  {
    name: 'Guts',
    note: '상태이상 시 공격 ×1.5, 화상 반감 무시',
    effect: (c, o) => {
      if (!c.attackerBurned) return;
      if (c.category === 'physical') o.attackMultiplier *= 1.5;
      o.ignoresBurn = true;
    },
  },
  { name: 'Overgrow', note: 'HP 1/3 이하에서 풀 기술 ×1.5', effect: pinch('Grass') },
  { name: 'Blaze', note: 'HP 1/3 이하에서 불꽃 기술 ×1.5', effect: pinch('Fire') },
  { name: 'Torrent', note: 'HP 1/3 이하에서 물 기술 ×1.5', effect: pinch('Water') },
  { name: 'Swarm', note: 'HP 1/3 이하에서 벌레 기술 ×1.5', effect: pinch('Bug') },
  {
    name: 'Solar Power',
    note: '쾌청에서 특수공격 ×1.5',
    effect: (c, o) => { if (c.weather === 'sun' && c.category === 'special') o.attackMultiplier *= 1.5; },
  },
  {
    name: 'Sand Force',
    note: '모래바람에서 바위·땅·강철 기술 ×1.3',
    effect: (c, o) => {
      if (c.weather !== 'sand') return;
      if (['Rock', 'Ground', 'Steel'].includes(c.moveType)) o.powerMultiplier *= 1.3;
    },
  },
  { name: 'Analytic', note: '나중에 움직이면 ×1.3', effect: (c, o) => { if (c.movesLast) o.powerMultiplier *= 1.3; } },
  {
    name: 'Neuroforce',
    note: '효과가 굉장할 때 ×1.25',
    effect: (c, o) => { if (c.typeEffectiveness > 1) o.damageMultiplier *= 1.25; },
  },
  // --- 기술 플래그 기반 (출처: Pokémon Showdown) ---
  { name: 'Iron Fist', note: '펀치 기술 ×1.2', effect: flagBoost('punch', 1.2) },
  { name: 'Tough Claws', note: '접촉 기술 ×1.3', effect: flagBoost('contact', 1.3) },
  { name: 'Strong Jaw', note: '깨물기 기술 ×1.5', effect: flagBoost('bite', 1.5) },
  { name: 'Mega Launcher', note: '파동 기술 ×1.5', effect: flagBoost('pulse', 1.5) },
  { name: 'Sharpness', note: '베기 기술 ×1.5', effect: flagBoost('slicing', 1.5) },
  { name: 'Punk Rock', note: '소리 기술 ×1.3', effect: flagBoost('sound', 1.3) },
  { name: 'Steelworker', note: '강철 기술 ×1.5', effect: typeBoost('Steel', 1.5) },
  { name: 'Steely Spirit', note: '강철 기술 ×1.5', effect: typeBoost('Steel', 1.5) },
  { name: 'Transistor', note: '전기 기술 ×1.3', effect: typeBoost('Electric', 1.3) },
  { name: 'Dragons Maw', note: '드래곤 기술 ×1.5', effect: typeBoost('Dragon', 1.5) },
  { name: 'Rocky Payload', note: '바위 기술 ×1.5', effect: typeBoost('Rock', 1.5) },

  {
    name: 'Protean',
    note: '모든 기술에 자속 적용 (교체당 1회)',
    effect: (_c, o) => { o.stabOverride = 1.5; },
  },
  {
    name: 'Libero',
    note: '모든 기술에 자속 적용 (교체당 1회)',
    effect: (_c, o) => { o.stabOverride = 1.5; },
  },
  {
    name: 'Parental Bond',
    note: '2회 공격 (2번째는 0.25배) — 합산 ×1.25',
    effect: (_c, o) => { o.damageMultiplier *= 1.25; },
  },
  {
    name: 'Water Bubble',
    note: '물 기술 ×2',
    effect: (c, o) => { if (c.moveType === 'Water') o.damageMultiplier *= 2; },
  },
  {
    name: 'Fairy Aura',
    note: '페어리 기술 ×1.33',
    effect: (c, o) => { if (c.moveType === 'Fairy') o.powerMultiplier *= 1.33; },
  },
  {
    name: 'Liquid Voice',
    note: '소리 기술이 물 타입이 된다',
    effect: (c, o) => { if (c.flags.has('sound')) o.moveTypeOverride = 'Water'; },
  },
  {
    name: 'Scrappy',
    note: '고스트에게 노말·격투 기술이 통한다',
    effect: (c, o) => {
      if (c.moveType === 'Normal' || c.moveType === 'Fighting') o.ignoresGhostImmunity = true;
    },
  },
  {
    name: 'Unaware',
    note: '상대의 랭크 변화를 무시',
    effect: (_c, o) => { o.ignoresOpponentBoosts = true; },
  },
  { name: 'Long Reach', note: '접촉 판정 없음', effect: (_c, o) => { o.removesContact = true; } },
  {
    name: 'Skill Link',
    note: '연속기가 항상 최대 횟수로 맞는다',
    effect: (_c, o) => { o.forcesMaxHits = true; },
  },

  // --- Champions 에서 풀린 CAP 특성 (Showdown 정의 기준) ---
  {
    name: 'Electromorphosis',
    // 맞으면 충전 상태가 되고, 그 다음 전기 기술의 위력이 2배가 된다.
    note: '충전 시 전기 기술 위력 ×2',
    effect: (c, o) => {
      if (c.attackerCharged && c.moveType === 'Electric') o.powerMultiplier *= 2;
    },
  },
  {
    name: 'Fire Mane',
    // 게임 내 설명은 "불꽃타입 기술의 **위력**이 1.5배" 다.
    // 공격 실수치에 곱하면 반올림 시점이 달라 결과가 어긋난다.
    note: '불꽃 기술 위력 ×1.5',
    effect: (c, o) => { if (c.moveType === 'Fire') o.powerMultiplier *= 1.5; },
  },
  {
    name: 'Mega Sol',
    note: '날씨를 쾌청으로 취급 (불꽃 ×1.5 / 물 ×0.5)',
    effect: (_c, o) => { o.weatherOverride = 'sun'; },
  },
  {
    name: 'Supreme Overlord',
    note: '쓰러진 아군 1마리당 ×1.1 (최대 ×1.5)',
    effect: (c, o) => {
      const fallen = Math.max(0, Math.min(5, c.fallenAllies));
      if (fallen > 0) o.powerMultiplier *= 1 + fallen * 0.1;
    },
  },
  {
    name: 'Rivalry',
    note: '같은 성별 ×1.25 / 다른 성별 ×0.75 (무성이면 변화 없음)',
    effect: (c, o) => {
      if (c.genderRelation === 'same') o.powerMultiplier *= 1.25;
      else if (c.genderRelation === 'different') o.powerMultiplier *= 0.75;
    },
  },
  { name: 'Dragonize', note: '노말 기술을 드래곤 타입으로 ×1.2', effect: typeChanger('Dragon') },

  { name: 'Aerilate', note: '노말 기술을 비행 타입으로 ×1.2', effect: typeChanger('Flying') },
  { name: 'Pixilate', note: '노말 기술을 페어리 타입으로 ×1.2', effect: typeChanger('Fairy') },
  { name: 'Refrigerate', note: '노말 기술을 얼음 타입으로 ×1.2', effect: typeChanger('Ice') },
  { name: 'Galvanize', note: '노말 기술을 전기 타입으로 ×1.2', effect: typeChanger('Electric') },
  {
    name: 'Mold Breaker',
    note: '상대 특성 무시',
    effect: (_c, o) => { o.ignoresDefenderAbility = true; },
  },
  { name: 'Teravolt', note: '상대 특성 무시', effect: (_c, o) => { o.ignoresDefenderAbility = true; } },
  { name: 'Turboblaze', note: '상대 특성 무시', effect: (_c, o) => { o.ignoresDefenderAbility = true; } },
];

/** 방어측 특성. */
const DEFENDER_LIST: AbilityDef[] = [
  {
    name: 'Solid Rock',
    note: '효과가 굉장할 때 받는 대미지 ×0.75',
    effect: (c, o) => { if (c.typeEffectiveness > 1) o.damageMultiplier *= 0.75; },
  },
  {
    name: 'Filter',
    note: '효과가 굉장할 때 받는 대미지 ×0.75',
    effect: (c, o) => { if (c.typeEffectiveness > 1) o.damageMultiplier *= 0.75; },
  },
  {
    name: 'Prism Armor',
    note: '효과가 굉장할 때 받는 대미지 ×0.75',
    effect: (c, o) => { if (c.typeEffectiveness > 1) o.damageMultiplier *= 0.75; },
  },
  {
    name: 'Thick Fat',
    note: '불꽃·얼음 기술 ×0.5',
    effect: (c, o) => { if (c.moveType === 'Fire' || c.moveType === 'Ice') o.damageMultiplier *= 0.5; },
  },
  { name: 'Heatproof', note: '불꽃 기술 ×0.5', effect: (c, o) => { if (c.moveType === 'Fire') o.damageMultiplier *= 0.5; } },
  {
    name: 'Water Bubble',
    note: '불꽃 기술 ×0.5',
    effect: (c, o) => { if (c.moveType === 'Fire') o.damageMultiplier *= 0.5; },
  },
  {
    name: 'Purifying Salt',
    note: '고스트 기술 ×0.5',
    effect: (c, o) => { if (c.moveType === 'Ghost') o.damageMultiplier *= 0.5; },
  },
  {
    name: 'Multiscale',
    note: 'HP 만땅일 때 ×0.5',
    effect: (c, o) => { if (c.defenderFullHp) o.damageMultiplier *= 0.5; },
  },
  {
    name: 'Shadow Shield',
    note: 'HP 만땅일 때 ×0.5',
    effect: (c, o) => { if (c.defenderFullHp) o.damageMultiplier *= 0.5; },
  },
  {
    name: 'Ice Scales',
    note: '특수 기술로 받는 대미지 ×0.5',
    effect: (c, o) => { if (c.category === 'special') o.damageMultiplier *= 0.5; },
  },
  {
    name: 'Marvel Scale',
    note: '상태이상일 때 방어 ×1.5',
    effect: (c, o) => {
      if (c.defenderStatused && defenseSide(c) === 'physical') o.defenseMultiplier *= 1.5;
    },
  },
  {
    name: 'Sturdy',
    note: 'HP 만땅이면 한 방에 쓰러지지 않음',
    effect: (_c, o) => { o.enduresAtFullHp = true; },
  },
  // --- 기술 플래그 기반 (출처: Pokémon Showdown) ---
  {
    name: 'Fluffy',
    note: '접촉 기술 ×0.5, 불꽃 기술 ×2',
    effect: (c, o) => {
      if (c.flags.has('contact')) o.damageMultiplier *= 0.5;
      if (c.moveType === 'Fire') o.damageMultiplier *= 2;
    },
  },
  {
    name: 'Punk Rock',
    note: '소리 기술로 받는 대미지 ×0.5',
    effect: (c, o) => { if (c.flags.has('sound')) o.damageMultiplier *= 0.5; },
  },
  {
    name: 'Bulletproof',
    note: '구슬·폭탄 기술 무효',
    effect: (c, o) => { if (c.flags.has('bullet')) o.immune = true; },
  },
  {
    name: 'Overcoat',
    note: '가루 기술 무효',
    effect: (c, o) => { if (c.flags.has('powder')) o.immune = true; },
  },
  {
    name: 'Wind Rider',
    note: '바람 기술 무효',
    effect: (c, o) => { if (c.flags.has('wind')) o.immune = true; },
  },

  {
    name: 'Fur Coat',
    note: '물리 기술로 받는 대미지 ×0.5',
    // 방어 실수치를 2배로 만드는 특성이다. 그래서 방어를 보는 특수기(사이코쇼크)도 막는다.
    effect: (c, o) => { if (defenseSide(c) === 'physical') o.defenseMultiplier *= 2; },
  },
  {
    name: 'Unaware',
    note: '상대의 랭크 변화를 무시',
    effect: (_c, o) => { o.ignoresOpponentBoosts = true; },
  },
  {
    name: 'Battle Armor',
    note: '급소를 맞지 않는다',
    effect: (_c, o) => { o.preventsCritical = true; },
  },
  {
    name: 'Shell Armor',
    note: '급소를 맞지 않는다',
    effect: (_c, o) => { o.preventsCritical = true; },
  },
  { name: 'Earth Eater', note: '땅 기술 무효', effect: immuneTo('Ground') },
  { name: 'Levitate', note: '땅 기술 무효', effect: immuneTo('Ground') },
  // Eelevate 는 부유와 같은 공중 판정을 준다 (쓰러뜨렸을 때의 능력 상승은 랭크로 조절).
  { name: 'Eelevate', note: '땅 기술 무효 (공중 판정)', effect: immuneTo('Ground') },
  {
    name: 'Mega Sol',
    note: '날씨를 쾌청으로 취급',
    effect: (_c, o) => { o.weatherOverride = 'sun'; },
  },
  { name: 'Flash Fire', note: '불꽃 기술 무효', effect: immuneTo('Fire') },
  { name: 'Water Absorb', note: '물 기술 무효', effect: immuneTo('Water') },
  { name: 'Storm Drain', note: '물 기술 무효', effect: immuneTo('Water') },
  { name: 'Volt Absorb', note: '전기 기술 무효', effect: immuneTo('Electric') },
  { name: 'Lightning Rod', note: '전기 기술 무효', effect: immuneTo('Electric') },
  { name: 'Motor Drive', note: '전기 기술 무효', effect: immuneTo('Electric') },
  { name: 'Sap Sipper', note: '풀 기술 무효', effect: immuneTo('Grass') },
  {
    name: 'Dry Skin',
    note: '물 기술 무효, 불꽃 기술 ×1.25',
    effect: (c, o) => {
      if (c.moveType === 'Water') o.immune = true;
      if (c.moveType === 'Fire') o.damageMultiplier *= 1.25;
    },
  },
  {
    name: 'Wonder Guard',
    note: '효과가 굉장한 기술만 통한다',
    effect: (c, o) => { if (c.typeEffectiveness <= 1) o.immune = true; },
  },
];

const ATTACKER_MAP = new Map(ATTACKER_LIST.map((a) => [a.name, a]));
const DEFENDER_MAP = new Map(DEFENDER_LIST.map((a) => [a.name, a]));

/**
 * 기술 플래그가 있어야 정확히 구현할 수 있는 특성.
 * PokéAPI 가 플래그를 주지 않으므로 흉내내지 않고 "미반영"으로 알린다.
 */
export const UNSUPPORTED_ABILITIES = new Map<string, string>([
  // 상대의 교체 여부에 따라 배율이 달라져 한 턴 계산으로는 확정할 수 없다.
  ['Stakeout', '상대 교체 여부에 따라 달라집니다'],
]);

/**
 * 대미지에 아무 영향이 없는 특성 중, "왜 반영이 안 되지?" 하고 헷갈리기 쉬운 것들.
 * 미구현이 아니라 **원래 대미지와 무관**하다는 걸 화면에서 구분해 주기 위한 목록이다.
 */
export const NO_DAMAGE_EFFECT = new Map<string, string>([
  ['Piercing Drill', '접촉 기술이 방어를 관통합니다 (대미지 자체는 그대로)'],
  ['Spicy Spray', '공격받으면 상대를 화상 상태로 만듭니다'],
  ['Intimidate', '등장 시 상대 공격을 1랭크 낮춥니다 — 랭크 칸에서 직접 조절하세요'],
]);

export function attackerAbility(name: string | null): AbilityDef | null {
  return name ? (ATTACKER_MAP.get(name) ?? null) : null;
}

export function defenderAbility(name: string | null): AbilityDef | null {
  return name ? (DEFENDER_MAP.get(name) ?? null) : null;
}

/** 이 특성이 대미지에 관여하는지 (어느 쪽이든). */
export function affectsDamage(name: string): boolean {
  return ATTACKER_MAP.has(name) || DEFENDER_MAP.has(name);
}

/**
 * 양쪽 특성을 적용해 최종 보정을 낸다.
 * 틀깨기가 있으면 방어측 특성을 통째로 무시한다.
 */
export function resolveAbilities(
  attackerName: string | null,
  defenderName: string | null,
  ctx: AbilityContext,
): { attacker: AbilityOutcome; defender: AbilityOutcome } {
  const attackerOut = base();
  const attackerDef = attackerAbility(attackerName);
  if (attackerDef) attackerDef.effect(ctx, attackerOut);

  const defenderOut = base();
  const defenderDef = defenderAbility(defenderName);
  if (defenderDef && !attackerOut.ignoresDefenderAbility) {
    defenderDef.effect(ctx, defenderOut);
  }

  return { attacker: attackerOut, defender: defenderOut };
}
