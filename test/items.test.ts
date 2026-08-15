/**
 * 지닌 도구 테스트.
 *
 * 이 파일이 생긴 이유가 두 가지 실수다:
 *   1. 달인의띠를 '전문가벨트'라고 손으로 옮겨 적었다 (공식 표기는 도감에 있었다)
 *   2. Champions 에 없는 구애머리띠·구애안경·돌격조끼·진화의휘석을 목록에 넣었다
 *
 * 그래서 여기서 고정하는 것은 배율보다도 **목록의 출처**다.
 * 도구는 배틀 데이터의 held_item 집계에만 존재해야 하고, 한국어 표기는 손으로 적지 않는다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  ATTACKER_ITEMS,
  DEFENDER_ITEMS,
  UNSUPPORTED_ITEMS,
  findItem,
  itemDamageMultiplier,
  itemPowerMultiplier,
} from '../src/core/items';
import { normalizeTerms } from '../src/adapters/termDex';

const terms = normalizeTerms(
  JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'terms.json'), 'utf8')),
);

const ALL = [...ATTACKER_ITEMS, ...DEFENDER_ITEMS];

describe('목록의 출처 — Champions 에 있는 도구만', () => {
  it('모든 도구가 배틀 데이터 집계에 존재한다', () => {
    for (const item of ALL) {
      expect(terms.items.has(item.name), `${item.name} 은 Champions 도구 목록에 없습니다`).toBe(true);
    }
  });

  it('Champions 에 없는 본가 도구는 고를 수 없다', () => {
    // 실제로 넣었다가 뺀 것들이다. 되돌아오면 여기서 잡힌다.
    for (const absent of ['Choice Band', 'Choice Specs', 'Assault Vest', 'Eviolite']) {
      expect(findItem(ATTACKER_ITEMS, absent), absent).toBeNull();
      expect(findItem(DEFENDER_ITEMS, absent), absent).toBeNull();
    }
  });

  /*
   * 도감(terms.json)과 선택지(items.ts)는 목적이 다르다.
   *
   * 도감은 **이름을 한국어로 옮기기 위한** 표다. 랭커 구축 데이터에는 Champions 배틀
   * 데이터에 없는 도구가 한 번씩 섞여 나오는데, 그걸 일본어로 둘 수는 없으니 도감에는
   * 담는다. 선택지는 그것과 별개로 계속 Champions 에 실재하는 것만 담는다.
   *
   * 그래서 "도감에 없어야 한다" 가 아니라 "고를 수 없어야 한다" 로 못박는다.
   * 표시 전용으로 들어온 항목은 여기 적어서, 모르는 사이에 늘어나면 눈에 띄게 한다.
   */
  it('도감에 표시 전용으로 들어온 도구를 밝혀 둔다', () => {
    const DISPLAY_ONLY = ['Assault Vest'];
    const selectable = new Set(ALL.map((i) => i.name));
    const extra = [...terms.items.keys()].filter((name) => !selectable.has(name));
    for (const name of DISPLAY_ONLY) {
      expect(terms.items.has(name), `${name} 은 표시용으로 도감에 있어야 합니다`).toBe(true);
      expect(selectable.has(name), `${name} 이 계산기 선택지에 들어갔습니다`).toBe(false);
    }
    // 도감이 선택지보다 넓은 것 자체는 정상이다(배틀 데이터에서 모은 141종).
    expect(extra.length).toBeGreaterThan(0);
  });

  it('계산에서 뺀 도구도 실재하는 것들이고 이유가 붙어 있다', () => {
    for (const [name, why] of UNSUPPORTED_ITEMS) {
      expect(terms.items.has(name), name).toBe(true);
      expect(why.length, name).toBeGreaterThan(5);
    }
  });

  it('한국어 표기를 코드에 적어두지 않는다 (도감에서 가져온다)', () => {
    const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'core', 'items.ts'), 'utf8');
    // 주석의 사례 설명을 뺀 실제 코드에는 한글 도구명이 없어야 한다.
    const code = source
      .replace(/\/\*\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('달인의띠');
    expect(code).not.toContain('전문가벨트');
  });

  it('공식 표기를 쓴다 — 달인의띠이지 전문가벨트가 아니다', () => {
    expect(terms.items.get('Expert Belt')?.displayName).toBe('달인의띠');
    expect(terms.items.get('Muscle Band')?.displayName).toBe('힘의머리띠');
  });

  it('계산기에 뜨는 도구는 전부 한국어 표기가 있다', () => {
    // PokéAPI 가 한국어를 안 주는 도구는 빌드 스크립트의 override 로 채운다.
    // 요정의깃털이 그 사례다 — 비면 화면에 영문이 그대로 뜬다.
    for (const item of ALL) {
      const ko = terms.items.get(item.name)?.displayName ?? '';
      expect(/[가-힣]/.test(ko), `${item.name} 에 한국어 표기가 없습니다`).toBe(true);
    }
    expect(terms.items.get('Fairy Feather')?.displayName).toBe('요정의깃털');
  });
});

describe('도구 한국어 표기 — 141종 전부', () => {
  const raw = JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'terms.json'), 'utf8'),
  ) as { items: Record<string, { ko: string | null }> };

  it('영문으로 남는 도구가 없다', () => {
    const missing = Object.entries(raw.items)
      .filter(([, v]) => !v.ko)
      .map(([k]) => k);
    expect(missing, `한국어 표기가 없는 도구: ${missing.join(', ')}`).toEqual([]);
  });

  it('메가스톤은 전부 나이트로 끝난다', () => {
    const stones = Object.entries(raw.items).filter(([name]) => /ite( [XY])?$/.test(name));
    expect(stones.length).toBeGreaterThan(50);
    for (const [name, entry] of stones) {
      expect(entry.ko, name).toMatch(/나이트[XY]?$/);
    }
  });

  it('손으로 채운 메가스톤의 종족명이 실제 한국어 종족명과 맞는다', () => {
    // Champions 오리지널 메가스톤은 본가에 없어서 사용자가 알려준 표기를 넣었다.
    // 오타가 나면 조용히 틀린 이름이 화면에 남으므로 로케일 데이터와 대조한다.
    // (공식 메가스톤은 대상이 아니다 — '후딘' 이 '후디나이트' 가 되듯 축약이 섞여 있다.)
    const script = readFileSync(
      path.join(import.meta.dirname, '..', 'scripts', 'build-terms.mjs'),
      'utf8',
    );
    const block = script.slice(
      script.indexOf('const ITEM_KO_OVERRIDE'),
      script.indexOf('};', script.indexOf('const ITEM_KO_OVERRIDE')),
    );
    const curated = [...block.matchAll(/'?([\w ]+)'?: '([^']+)'/g)]
      .map(([, name, ko]) => [name!.trim(), ko!] as const)
      .filter(([, ko]) => ko.includes('나이트'));
    expect(curated.length).toBe(34);

    const locales = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'locales.json'), 'utf8'),
    ) as Record<string, { ko: string; koSpecies?: string }>;
    const speciesNames = new Set(
      Object.values(locales).flatMap((e) => [e.koSpecies, e.ko].filter(Boolean) as string[]),
    );

    for (const [name, ko] of curated) {
      // 도감에 실린 값과 스크립트의 값이 어긋나면 데이터를 다시 만들어야 한다는 뜻이다.
      expect(raw.items[name]?.ko, name).toBe(ko);
      const species = ko.slice(0, ko.indexOf('나이트'));
      expect(speciesNames.has(species), `${name} → ${ko} 의 '${species}' 는 종족명이 아닙니다`).toBe(
        true,
      );
    }
  });

  it('X·Y 표기는 붙여 쓴다 (리자몽나이트X 와 같은 형태)', () => {
    expect(raw.items['Charizardite X']?.ko).toBe('리자몽나이트X');
    expect(raw.items['Raichunite X']?.ko).toBe('라이츄나이트X');
    expect(raw.items['Raichunite Y']?.ko).toBe('라이츄나이트Y');
  });
});

describe('타입 강화 도구', () => {
  it('타입이 맞을 때만 위력이 1.2배가 된다', () => {
    const charcoal = findItem(ATTACKER_ITEMS, 'Charcoal')!;
    expect(itemPowerMultiplier(charcoal, 'Fire', 'special')).toBe(1.2);
    expect(itemPowerMultiplier(charcoal, 'Water', 'special')).toBe(1);
  });

  it('18개 타입이 하나씩 다 있다', () => {
    const types = ATTACKER_ITEMS.filter((i) => i.boostsType).map((i) => i.boostsType);
    expect(new Set(types).size).toBe(18);
    expect(types.length).toBe(18);
  });

  it('최종 대미지가 아니라 위력 단계에 곱한다', () => {
    // 반올림 시점이 달라서 최종 배율로 뭉뚱그리면 결과가 1~2 어긋난다.
    const charcoal = findItem(ATTACKER_ITEMS, 'Charcoal')!;
    expect(charcoal.powerMultiplier).toBe(1.2);
    expect(charcoal.damageMultiplier).toBeUndefined();
  });
});

describe('분류를 가리는 도구', () => {
  it('힘의머리띠는 물리에만, 박식안경은 특수에만 붙는다', () => {
    const band = findItem(ATTACKER_ITEMS, 'Muscle Band')!;
    const glasses = findItem(ATTACKER_ITEMS, 'Wise Glasses')!;
    expect(itemPowerMultiplier(band, 'Normal', 'physical')).toBe(1.1);
    expect(itemPowerMultiplier(band, 'Normal', 'special')).toBe(1);
    expect(itemPowerMultiplier(glasses, 'Normal', 'special')).toBe(1.1);
    expect(itemPowerMultiplier(glasses, 'Normal', 'physical')).toBe(1);
  });
});

describe('반감 열매', () => {
  it('그 타입이면서 효과가 굉장할 때만 반감한다', () => {
    const occa = findItem(DEFENDER_ITEMS, 'Occa Berry')!;
    expect(itemDamageMultiplier(occa, 'Fire', 2)).toBe(0.5);
    // 효과가 굉장하지 않으면 발동하지 않는다.
    expect(itemDamageMultiplier(occa, 'Fire', 1)).toBe(1);
    // 타입이 다르면 굉장해도 발동하지 않는다.
    expect(itemDamageMultiplier(occa, 'Water', 2)).toBe(1);
  });

  it('17종이 서로 다른 타입을 맡는다', () => {
    const types = DEFENDER_ITEMS.filter((i) => i.resistsType).map((i) => i.resistsType);
    expect(new Set(types).size).toBe(17);
  });
});

describe('달인의띠', () => {
  it('타입을 가리지 않고 효과 굉장이면 1.2배', () => {
    const belt = findItem(ATTACKER_ITEMS, 'Expert Belt')!;
    expect(itemDamageMultiplier(belt, 'Water', 2)).toBe(1.2);
    expect(itemDamageMultiplier(belt, 'Fire', 4)).toBe(1.2);
    expect(itemDamageMultiplier(belt, 'Fire', 1)).toBe(1);
  });
});

describe('안 든 경우', () => {
  it('null 이면 어떤 배율도 걸리지 않는다', () => {
    expect(itemPowerMultiplier(null, 'Fire', 'physical')).toBe(1);
    expect(itemDamageMultiplier(null, 'Fire', 2)).toBe(1);
  });
});
