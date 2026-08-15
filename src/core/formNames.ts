/**
 * 폼 이름을 한국어로.
 *
 * 상류의 폼 이름은 영문이다("Mega Garchomp", "Alolan Ninetales").
 * 화면 전체가 한국어인데 폼 선택 드롭다운만 영문으로 남아 있었다.
 *
 * 폼 이름은 **접두어 + 종족명** 구조라 사전을 따로 두지 않고 규칙으로 만든다.
 * 종족 한국어명은 이미 로케일 데이터에 있으므로 지어내지 않는다.
 * 규칙에 안 맞는 폼은 영문을 그대로 둔다 — 틀린 한국어를 만드는 것보다 낫다.
 */

import type { Pokemon, PokemonForm } from '../types';

/** 폼 slug → 공식 한국어 폼 표기. `scripts/build-form-names.mjs` 산출물. */
export type FormNameMap = Map<string, string>;

/** 영문 접두어 → 한국어 접두어. 뒤에 종족명이 붙는다. */
const PREFIXES: [RegExp, string][] = [
  [/^Mega\s+/i, '메가 '],
  [/^Alolan\s+/i, '알로라 '],
  [/^Galarian\s+/i, '가라르 '],
  [/^Hisuian\s+/i, '히스이 '],
  [/^Paldean\s+/i, '팔데아 '],
];

/** 'Mega Charizard X' 처럼 뒤에 붙는 갈래 표기. */
function branchSuffix(formName: string): string {
  const match = /\s+([XY])$/.exec(formName);
  return match ? ` ${match[1]}` : '';
}

/**
 * 이 폼의 한국어 표시명.
 *
 * @param mon    폼이 속한 종 (한국어 종족명을 여기서 가져온다)
 * @param index  전체 목록. 다른 항목이 이 폼을 대표 폼으로 갖고 있으면 그 이름을 그대로 쓴다
 *               (알로라 나인테일처럼 상류가 이미 한국어명을 아는 경우).
 */
export function formDisplayName(
  mon: Pokemon,
  form: PokemonForm,
  index: Pokemon[] = [],
  formNames: FormNameMap | null = null,
): string {
  // 1) 대표 폼이면 종 이름 그대로.
  if (form.slug === mon.primary.slug) return mon.displayName;

  // 2) 접두어 규칙. 종 한국어명에서 지역 접두어를 떼어 '순수 종족명' 을 얻는다.
  const speciesKo = stripRegion(mon.displayName);
  for (const [pattern, korean] of PREFIXES) {
    if (pattern.test(form.formName)) {
      return `${korean}${speciesKo}${branchSuffix(form.formName)}`;
    }
  }

  // 3) 공식 폼 표기(PokéAPI). 트리밍·무늬·크림처럼 접두어 규칙이 안 통하는 폼들이다.
  //    '워시로토무' 처럼 종족명을 이미 품고 있으면 그대로, '하트컷' 처럼 수식어만
  //    있으면 종족명을 앞에 붙인다.
  const official = formNames?.get(form.slug);
  if (official) {
    return official.includes(speciesKo) ? official : `${speciesKo} ${official}`;
  }

  // 4) 이 폼을 대표로 갖는 종이 따로 있으면 그 종의 한국어명을 쓴다.
  //    로토무처럼 종 이름이 폼마다 같으면 서로 구분이 안 되므로 3) 다음에 본다.
  const owner = index.find((candidate) => candidate.primary.slug === form.slug);
  if (owner && owner.displayName !== owner.name) return owner.displayName;

  // 5) 공식 표기를 못 찾은 폼은 영문 그대로 둔다. 지어낸 번역보다 낫다.
  return form.formName;
}

/** '알로라 나인테일' → '나인테일'. 접두어가 없으면 그대로. */
function stripRegion(korean: string): string {
  return korean.replace(/^(메가|알로라|가라르|히스이|팔데아)\s+/, '');
}
