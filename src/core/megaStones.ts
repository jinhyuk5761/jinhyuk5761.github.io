/**
 * 메가 포켓몬 ↔ 메가스톤 연결.
 *
 * 메가진화는 그 종의 메가스톤을 들어야만 되므로, 메가 폼을 고른 순간
 * 지닌 도구는 그 돌로 **고정**된다. 생명의구슬을 든 메가 한카리아스는 존재할 수 없다.
 * 이걸 안 막으면 계산기가 성립하지 않는 조합의 대미지를 내놓는다.
 *
 * 상류 데이터에 "이 폼은 이 돌" 이라는 필드가 없어서 이름으로 잇는다.
 * 규칙은 하나뿐이다 — 돌 이름의 앞부분이 종 영문명의 앞부분과 가장 길게 겹치는 종을 고른다
 * (Garchompite→Garchomp, Feraligite→Feraligatr, Sablenite→Sableye).
 * 추측이 섞이는 방식이라 test/megaStones.test.ts 에서 **모든 메가 폼**이 정확히 하나의
 * 돌로 이어지는지 전수 확인한다. 하나라도 어긋나면 테스트가 깨진다.
 */

import type { Pokemon, PokemonForm } from '../types';

/** form_kind 는 'Mega' 말고 'Mega X' · 'Mega Y' 로도 온다. */
export function isMegaForm(form: PokemonForm): boolean {
  return form.formKind.startsWith('Mega');
}

/** 메가스톤처럼 생긴 이름인가. 'Charizardite X' 처럼 뒤에 X·Y 가 붙기도 한다. */
export function isMegaStoneName(name: string): boolean {
  return /ite( [XY])?$/.test(name);
}

/** 'Mega Raichu X' → 'X'. 갈래가 없으면 null. */
function branchOf(text: string): 'X' | 'Y' | null {
  const match = /\b([XY])$/.exec(text.trim());
  return match ? (match[1] as 'X' | 'Y') : null;
}

/** 두 문자열이 앞에서부터 몇 글자나 같은가 (대소문자 무시). */
function commonPrefixLength(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const limit = Math.min(x.length, y.length);
  let i = 0;
  while (i < limit && x[i] === y[i]) i += 1;
  return i;
}

/** 돌 이름에서 갈래 표기를 뗀 몸통. 'Charizardite X' → 'Charizardite'. */
function stemOf(stone: string): string {
  return stone.replace(/\s+[XY]$/, '');
}

/**
 * 이 메가 폼이 요구하는 메가스톤 이름. 못 찾으면 null.
 *
 * @param stoneNames Champions 에 실재하는 도구 이름들 (terms.json 의 키)
 */
export function megaStoneFor(
  mon: Pokemon,
  form: PokemonForm,
  stoneNames: Iterable<string>,
): string | null {
  if (!isMegaForm(form)) return null;

  const wantBranch = branchOf(form.formName);
  // 종 이름보다 폼 이름이 낫다. 지역폼 종(Galarian Slowbro)은 종 이름에 지역이 붙어 있어서
  // 'Slowbronite' 와 한 글자도 안 겹친다. 'Mega Slowbro' 에서 'Mega ' 만 떼면 정확히 맞는다.
  const targets = [form.formName.replace(/^Mega\s+/i, '').replace(/\s+[XY]$/, ''), mon.name];

  let best: string | null = null;
  let bestScore = 0;

  for (const stone of stoneNames) {
    if (!isMegaStoneName(stone)) continue;
    // X 폼에는 X 돌, 갈래가 없는 폼에는 갈래 없는 돌.
    if (branchOf(stone) !== wantBranch) continue;

    const stem = stemOf(stone);
    const score = Math.max(...targets.map((target) => commonPrefixLength(stem, target)));
    // 너무 짧게 겹치는 건 우연이다 (Ampharosite ↔ Absol 같은 오인을 막는다).
    if (score >= 4 && score > bestScore) {
      bestScore = score;
      best = stone;
    }
  }

  return best;
}
