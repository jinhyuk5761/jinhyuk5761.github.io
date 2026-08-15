/**
 * 폼 이름의 한국어 표기.
 *
 * 접두어 규칙(메가·알로라…)은 "접두어 + 종족명" 구조에만 통한다. 트리밍·무늬·크림처럼
 * 구조가 다른 폼은 규칙으로 못 만들어 영문이 그대로 남았다. 공식 표기는
 * `scripts/build-form-names.mjs` 가 PokéAPI 에서 받아 `formNames.json` 에 넣는다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formDisplayName, type FormNameMap } from '../src/core/formNames';
import type { Pokemon, PokemonForm, StatLine } from '../src/types';

const file = JSON.parse(readFileSync('public/data/formNames.json', 'utf8')) as {
  forms: Record<string, string>;
  jaLabels: Record<string, string>;
};
const raw = file.forms;
const FORM_NAMES: FormNameMap = new Map(Object.entries(raw));

const STATS: StatLine = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, total: 0 };

function form(slug: string, formName: string): PokemonForm {
  return {
    slug,
    formName,
    savedName: formName,
    formKind: 'Base',
    types: [],
    abilities: [],
    hiddenAbility: '',
    stats: STATS,
    spriteUrl: `https://example.test/${formName}.png`,
  };
}

function species(displayName: string, name: string, forms: PokemonForm[]): Pokemon {
  return {
    showdownId: name.toLowerCase(),
    slug: forms[0]!.slug,
    name,
    displayName,
    localeNames: { en: name },
    primary: forms[0]!,
    forms,
    learnableMoveNames: [],
    usageRank: { Singles: null, Doubles: null },
  };
}

describe('formNames.json', () => {
  it('빌드 산출물이 비어 있지 않다', () => {
    expect(Object.keys(raw).length).toBeGreaterThan(50);
  });

  it('공식 표기를 그대로 담는다 — 손번역이 아니다', () => {
    expect(raw['rotom-wash']).toBe('워시로토무');
    expect(raw['furfrou-heart-trim']).toBe('하트컷');
    expect(raw['vivillon-meadow-pattern']).toBe('화원의 모양');
  });
});

describe('formDisplayName', () => {
  const rotom = species('로토무', 'Rotom', [
    form('rotom', 'Rotom'),
    form('rotom-wash', 'Rotom Wash'),
    form('rotom-heat', 'Rotom Heat'),
  ]);
  const furfrou = species('트리미앙', 'Furfrou', [
    form('furfrou-natural-form', 'Furfrou Natural Form'),
    form('furfrou-heart-trim', 'Furfrou Heart Trim'),
    form('furfrou-pharaoh-trim', 'Furfrou Pharaoh Trim'),
  ]);

  it('종족명을 이미 품은 표기는 그대로 쓴다', () => {
    // '로토무 워시로토무' 가 되면 안 된다.
    expect(formDisplayName(rotom, rotom.forms[1]!, [], FORM_NAMES)).toBe('워시로토무');
    expect(formDisplayName(rotom, rotom.forms[2]!, [], FORM_NAMES)).toBe('히트로토무');
  });

  it('수식어만 있는 표기는 종족명을 앞에 붙인다', () => {
    expect(formDisplayName(furfrou, furfrou.forms[1]!, [], FORM_NAMES)).toBe('트리미앙 하트컷');
    expect(formDisplayName(furfrou, furfrou.forms[2]!, [], FORM_NAMES)).toBe('트리미앙 킹덤컷');
  });

  it('대표 폼이어도 공식 표기가 있으면 그것을 쓴다', () => {
    // 종 이름이 폼마다 같은 로토무·트리미앙은 대표 폼만 '로토무' 로 적으면
    // 목록에서 어느 것이 무엇인지 알 수 없다.
    expect(formDisplayName(rotom, rotom.forms[0]!, [], FORM_NAMES)).toBe('로토무의 모습');
    expect(formDisplayName(furfrou, furfrou.forms[0]!, [], FORM_NAMES)).toBe('트리미앙 야생의 모습');
  });

  it('공식 표기가 없는 대표 폼은 종 이름 그대로', () => {
    const garchomp = species('한카리아스', 'Garchomp', [
      form('garchomp', 'Garchomp'),
      form('mega-garchomp', 'Mega Garchomp'),
    ]);
    expect(FORM_NAMES.has('garchomp')).toBe(false);
    expect(formDisplayName(garchomp, garchomp.forms[0]!, [], FORM_NAMES)).toBe('한카리아스');
  });

  it('접두어 규칙이 공식 표기보다 앞선다', () => {
    const garchomp = species('한카리아스', 'Garchomp', [
      form('garchomp', 'Garchomp'),
      form('mega-garchomp', 'Mega Garchomp'),
    ]);
    expect(formDisplayName(garchomp, garchomp.forms[1]!, [], FORM_NAMES)).toBe('메가 한카리아스');
  });

  it('공식 표기가 없으면 영문을 남긴다 — 지어내지 않는다', () => {
    const unknown = species('아무개', 'Whatever', [
      form('whatever', 'Whatever'),
      form('whatever-mystery', 'Whatever Mystery'),
    ]);
    expect(formDisplayName(unknown, unknown.forms[1]!, [], FORM_NAMES)).toBe('Whatever Mystery');
  });

  it('폼마다 서로 다른 이름이 나온다', () => {
    // 예전에는 로토무 폼 다섯 개가 전부 '로토무' 로 나와 구분이 안 됐다.
    const labels = rotom.forms.map((f) => formDisplayName(rotom, f, [], FORM_NAMES));
    expect(new Set(labels).size).toBe(labels.length);
  });
});
