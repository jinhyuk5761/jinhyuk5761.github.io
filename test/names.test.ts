/**
 * 이름 정규화 테스트.
 *
 * 여기가 깨지면 Smogon 카운터가 엉뚱한 포켓몬에 붙는다. 빌드 스크립트가
 * "미매칭 0건" 을 보고해도 *잘못된* 매칭은 잡아주지 못하므로, 대표 케이스를 고정한다.
 */

import { describe, expect, it } from 'vitest';
import {
  buildFormIndex,
  matchesQuery,
  orderlessKey,
  resolveSmogonName,
  toId,
} from '../shared/names.mjs';

const FORMS = [
  { savedName: 'Garchomp', formName: 'Garchomp', slug: 'garchomp', showdownId: 'garchomp' },
  { savedName: 'Mega Garchomp', formName: 'Mega Garchomp', slug: 'mega-garchomp', showdownId: 'garchomp' },
  { savedName: 'Mega Gyarados', formName: 'Mega Gyarados', slug: 'mega-gyarados', showdownId: 'gyarados' },
  { savedName: 'Mega Raichu Y', formName: 'Mega Raichu Y', slug: 'mega-raichu-y', showdownId: 'raichualola' },
  { savedName: 'Alolan Ninetales', formName: 'Alolan Ninetales', slug: 'alolan-ninetales', showdownId: 'ninetalesalola' },
  { savedName: 'Hisuian Arcanine', formName: 'Hisuian Arcanine', slug: 'hisuian-arcanine', showdownId: 'arcanine' },
  { savedName: 'Aegislash Shield Forme', formName: 'Aegislash Shield Forme', slug: 'aegislash-shield-forme', showdownId: 'aegislash' },
  { savedName: 'Aegislash Blade Forme', formName: 'Aegislash Blade Forme', slug: 'aegislash-blade-forme', showdownId: 'aegislash' },
  { savedName: 'Gourgeist Jumbo Variety', formName: 'Gourgeist Jumbo Variety', slug: 'gourgeist-jumbo-variety', showdownId: 'gourgeistsuper' },
  { savedName: 'Gourgeist Large Variety', formName: 'Gourgeist Large Variety', slug: 'gourgeist-large-variety', showdownId: 'gourgeistlarge' },
  { savedName: 'Furfrou Natural Form', formName: 'Furfrou Natural Form', slug: 'furfrou-natural-form', showdownId: 'furfrou' },
  { savedName: 'Furfrou Dandy Trim', formName: 'Furfrou Dandy Trim', slug: 'furfrou-dandy-trim', showdownId: 'furfrou' },
  { savedName: 'Alcremie Ruby Cream', formName: 'Alcremie Ruby Cream', slug: 'alcremie-ruby-cream', showdownId: 'alcremie' },
  { savedName: 'Alcremie Ruby Swirl', formName: 'Alcremie Ruby Swirl', slug: 'alcremie-ruby-swirl', showdownId: 'alcremie' },
  { savedName: 'Vivillon Meadow Pattern', formName: 'Vivillon Meadow Pattern', slug: 'vivillon-meadow-pattern', showdownId: 'vivillonmeadow' },
  { savedName: 'Palafin Zero Form', formName: 'Palafin Zero Form', slug: 'palafin-zero-form', showdownId: 'palafin' },
  { savedName: 'Basculegion Male', formName: 'Basculegion Male', slug: 'basculegion-male', showdownId: 'basculegion' },
  { savedName: 'Basculegion Female', formName: 'Basculegion Female', slug: 'basculegion-female', showdownId: 'basculegionf' },
];

const index = buildFormIndex(FORMS);
const resolve = (name: string) => resolveSmogonName(name, index)?.savedName ?? null;

describe('toId', () => {
  it('악센트를 벗기고 영숫자만 남긴다', () => {
    expect(toId('Poké Ball Pattern')).toBe('pokeballpattern');
    expect(toId('Mega Raichu Y')).toBe('megaraichuy');
  });

  it('숫자를 지우지 않는다', () => {
    expect(toId('Porygon2')).toBe('porygon2');
  });

  it('문자열이 아니면 빈 문자열', () => {
    expect(toId(null)).toBe('');
    expect(toId(undefined)).toBe('');
  });
});

describe('orderlessKey', () => {
  it('어순이 달라도 같은 키를 만든다', () => {
    expect(orderlessKey('Gyarados-Mega')).toBe(orderlessKey('Mega Gyarados'));
  });

  it('지역폼 형용사형과 지명형을 통일한다', () => {
    expect(orderlessKey('Ninetales-Alola')).toBe(orderlessKey('Alolan Ninetales'));
    expect(orderlessKey('Arcanine-Hisui')).toBe(orderlessKey('Hisuian Arcanine'));
  });

  it('폼을 구분하는 토큰은 지우지 않는다', () => {
    expect(orderlessKey('Alcremie Ruby Cream')).not.toBe(orderlessKey('Alcremie Ruby Swirl'));
  });
});

describe('resolveSmogonName', () => {
  it('기본 폼을 그대로 찾는다', () => {
    expect(resolve('Garchomp')).toBe('Garchomp');
  });

  it('메가 어순 차이를 흡수한다', () => {
    expect(resolve('Gyarados-Mega')).toBe('Mega Gyarados');
    expect(resolve('Garchomp-Mega')).toBe('Mega Garchomp');
    expect(resolve('Raichu-Mega-Y')).toBe('Mega Raichu Y');
  });

  it('지역폼을 찾는다', () => {
    expect(resolve('Ninetales-Alola')).toBe('Alolan Ninetales');
    expect(resolve('Arcanine-Hisui')).toBe('Hisuian Arcanine');
  });

  it('분류 명사(Variety/Trim/Pattern/Forme)를 흡수한다', () => {
    expect(resolve('Gourgeist-Large')).toBe('Gourgeist Large Variety');
    expect(resolve('Furfrou-Dandy')).toBe('Furfrou Dandy Trim');
    expect(resolve('Aegislash-Blade')).toBe('Aegislash Blade Forme');
  });

  it('Showdown 의 무접미 기본 폼을 alias 로 해석한다', () => {
    expect(resolve('Aegislash')).toBe('Aegislash Shield Forme');
    expect(resolve('Palafin')).toBe('Palafin Zero Form');
    expect(resolve('Furfrou')).toBe('Furfrou Natural Form');
    expect(resolve('Vivillon')).toBe('Vivillon Meadow Pattern');
    expect(resolve('Gourgeist-Super')).toBe('Gourgeist Jumbo Variety');
  });

  it('성별 폼을 구분한다', () => {
    expect(resolve('Basculegion')).toBe('Basculegion Male');
    expect(resolve('Basculegion-F')).toBe('Basculegion Female');
  });

  it('서로 다른 Alcremie 폼을 섞지 않는다', () => {
    expect(resolve('Alcremie-Ruby-Cream')).toBe('Alcremie Ruby Cream');
    expect(resolve('Alcremie-Ruby-Swirl')).toBe('Alcremie Ruby Swirl');
  });

  it('로스터에 없는 이름은 null 을 준다', () => {
    expect(resolve('Miraidon')).toBeNull();
    expect(resolve('')).toBeNull();
  });
});

describe('matchesQuery', () => {
  const haystack = ['Garchomp', 'garchomp', '한카리아스', 'ガブリアス'];

  it('한국어·일본어·영어 어느 쪽으로도 같은 결과를 낸다 (M1 완료 기준)', () => {
    expect(matchesQuery('한카리아스', haystack)).toBe(true);
    expect(matchesQuery('garchomp', haystack)).toBe(true);
    expect(matchesQuery('ガブリアス', haystack)).toBe(true);
  });

  it('부분 일치와 대소문자 무시가 된다', () => {
    expect(matchesQuery('GARCH', haystack)).toBe(true);
    expect(matchesQuery('카리아', haystack)).toBe(true);
  });

  it('빈 질의는 전부 통과시킨다', () => {
    expect(matchesQuery('   ', haystack)).toBe(true);
  });

  it('관계없는 질의는 걸러낸다', () => {
    expect(matchesQuery('피카츄', haystack)).toBe(false);
  });
});
