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
): string {
  // 1) 이 폼을 대표로 갖는 종이 따로 있으면 그 종의 한국어명이 정답이다.
  const owner = index.find((candidate) => candidate.primary.slug === form.slug);
  if (owner && owner.displayName !== owner.name) return owner.displayName;

  // 2) 대표 폼이면 종 이름 그대로.
  if (form.slug === mon.primary.slug) return mon.displayName;

  // 3) 접두어 규칙. 종 한국어명에서 지역 접두어를 떼어 '순수 종족명' 을 얻는다.
  const speciesKo = stripRegion(mon.displayName);
  for (const [pattern, korean] of PREFIXES) {
    if (pattern.test(form.formName)) {
      return `${korean}${speciesKo}${branchSuffix(form.formName)}`;
    }
  }

  // 4) 규칙에 없는 폼은 영문 그대로 둔다.
  return form.formName;
}

/** '알로라 나인테일' → '나인테일'. 접두어가 없으면 그대로. */
function stripRegion(korean: string): string {
  return korean.replace(/^(메가|알로라|가라르|히스이|팔데아)\s+/, '');
}
