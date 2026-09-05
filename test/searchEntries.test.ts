/**
 * @vitest-environment jsdom
 *
 * 검색 목록에 무엇이 몇 줄로 서는가.
 *
 * 상류 데이터의 두 가지 버릇을 여기서 흡수한다:
 *   1. 같은 메가 폼을 여러 종이 물고 있다 (라이츄 / 알로라 라이츄가 폼 목록을 공유).
 *   2. 폼 이름이 종 이름과 같고 한국어 종족명까지 같은 종이 있다 (팔데아 켄타로스 3종).
 * 둘 다 그대로 두면 목록에 구별 안 되는 줄이 늘어선다.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { searchEntries, visibleIn } from '../src/views/search';
import { state } from '../src/store';
import type { Pokemon, PokemonForm, StatLine } from '../src/types';

const STATS: StatLine = { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1, total: 6 };

function form(slug: string, formName: string, formKind: string): PokemonForm {
  return {
    slug,
    formName,
    savedName: formName,
    formKind,
    types: ['Normal'],
    abilities: [],
    hiddenAbility: '',
    stats: STATS,
    spriteUrl: `https://example.test/${slug}.png`,
  };
}

function species(
  showdownId: string,
  name: string,
  displayName: string,
  forms: PokemonForm[],
  primary = forms[0]!,
): Pokemon {
  return {
    showdownId,
    slug: primary.slug,
    name,
    displayName,
    localeNames: { en: name, ko: displayName },
    primary,
    forms,
    learnableMoveNames: [],
    usageRank: { Singles: 1, Doubles: null },
  };
}

/** 라이츄·알로라 라이츄는 폼 목록을 통째로 공유한다 — 실데이터 그대로의 모양이다. */
const RAICHU_FORMS = [
  form('raichu', 'Raichu', 'Base'),
  form('alolan-raichu', 'Alolan Raichu', 'Alolan'),
  form('mega-raichu-x', 'Mega Raichu X', 'Mega X'),
  form('mega-raichu-y', 'Mega Raichu Y', 'Mega Y'),
];

/** 대표 폼이 메가인 종 엔트리. 상류에 Mega Gallade 하나가 이런 모양이다. */
const GALLADE_FORMS = [
  form('gallade', 'Gallade', 'Base'),
  form('mega-gallade', 'Mega Gallade', 'Mega'),
];

const TAUROS_FORMS = [
  form('tauros', 'Tauros', 'Base'),
  form('paldean-tauros-aqua-breed', 'Paldean Tauros Aqua Breed', 'Paldean Aqua Breed'),
  form('paldean-tauros-blaze-breed', 'Paldean Tauros Blaze Breed', 'Paldean Blaze Breed'),
];

function setIndex(pokemon: Pokemon[]): void {
  state.index = {
    pokemon,
    byShowdownId: new Map(pokemon.map((mon) => [mon.showdownId, mon])),
    defaultSeason: 'M5',
    generatedAt: '2026-09-06',
  };
  state.formNames = new Map();
}

beforeEach(() => {
  setIndex([
    species('raichu', 'Raichu', '라이츄', RAICHU_FORMS),
    species('raichualola', 'Alolan Raichu', '알로라 라이츄', RAICHU_FORMS, RAICHU_FORMS[1]),
    species('gallade', 'Gallade', '엘레이드', GALLADE_FORMS),
    species('gallademega', 'Mega Gallade', 'Mega Gallade', GALLADE_FORMS, GALLADE_FORMS[1]),
    species('tauros', 'Tauros', '켄타로스', TAUROS_FORMS),
    species(
      'taurospaldeaaqua',
      'Paldean Tauros Aqua Breed',
      '켄타로스',
      TAUROS_FORMS,
      TAUROS_FORMS[1],
    ),
  ]);
});

describe('메가 줄', () => {
  it('여러 종이 같은 메가를 물고 있어도 한 번만 세운다', () => {
    const slugs = searchEntries()
      .filter((e) => e.isMega)
      .map((e) => e.form.slug);
    // 라이츄와 알로라 라이츄가 같은 폼 목록을 물고 있어도 X·Y 는 한 번씩이다.
    expect(slugs).toEqual([...new Set(slugs)]);
    expect(slugs).toContain('mega-raichu-x');
    expect(slugs).toContain('mega-raichu-y');
  });

  it('메가는 원종 쪽에 붙는다 — 알로라 라이츄가 아니라 라이츄', () => {
    const raichu = searchEntries().filter((e) => e.form.slug.startsWith('mega-raichu'));
    expect(raichu.map((e) => e.mon.showdownId)).toEqual(['raichu', 'raichu']);
    expect(raichu.map((e) => e.label)).toEqual(['메가 라이츄 X', '메가 라이츄 Y']);
  });

  it('메가가 대표 폼인 종 엔트리는 폼 줄에 맡긴다', () => {
    // 그대로 두면 메가 엘레이드가 종 줄과 폼 줄로 두 번 선다.
    const gallade = searchEntries().filter((e) => e.form.slug === 'mega-gallade');
    expect(gallade).toHaveLength(1);
    expect(gallade[0]!.label).toBe('메가 엘레이드');
    expect(gallade[0]!.mon.showdownId).toBe('gallade');
    expect(searchEntries().some((e) => e.mon.showdownId === 'gallademega')).toBe(false);
  });

  it('사용률 순위에서는 빠진다', () => {
    // 사용률은 종 단위 집계라 메가에 매길 순위가 없다.
    const entries = searchEntries();
    expect(visibleIn(entries, 'usage').some((e) => e.isMega)).toBe(false);
    expect(visibleIn(entries, 'speed').filter((e) => e.isMega)).toHaveLength(3);
    expect(visibleIn(entries, 'name').filter((e) => e.isMega)).toHaveLength(3);
  });
});

describe('폼 표기', () => {
  it('이름이 이미 폼을 말하면 또 적지 않는다', () => {
    // '알로라 라이츄 [알로라의 모습]' 은 같은 말을 두 번 하는 꼴이다.
    const alolan = searchEntries().find((e) => e.label === '알로라 라이츄')!;
    expect(alolan.formTag).toBeNull();
  });

  it('한국어 이름이 같은 팔데아 켄타로스는 폼으로 갈린다', () => {
    const tauros = searchEntries().filter((e) => e.label === '켄타로스');
    expect(tauros).toHaveLength(2);
    // 원종은 그대로, 팔데아 종은 어느 갈래인지 적힌다.
    expect(tauros.map((e) => e.formTag)).toEqual([null, 'Paldean Aqua Breed']);
  });
});
