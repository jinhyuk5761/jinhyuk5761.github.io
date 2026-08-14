/**
 * 기술 → 배울 수 있는 포켓몬, 특성 → 가진 포켓몬 역인덱스.
 *
 * 둘 다 이미 받아둔 인덱스 응답에서 만든다. 추가 요청이 없으므로
 * 상류가 갱신되면 재배포 없이 목록도 따라 바뀐다.
 *
 * 특성은 **폼 단위**로 모은다. 메가 한카리아스의 모래의힘은 일반 한카리아스에게 없다 —
 * 종 단위로 뭉치면 "이 특성을 가진 포켓몬"이 틀린 답이 된다.
 */

import type { Pokemon, PokemonForm } from '../types';

/** 그 기술·특성을 가진 폼 하나. */
export interface FormRef {
  mon: Pokemon;
  form: PokemonForm;
  /** 대표 폼이면 종 이름만, 아니면 폼 이름을 함께 보여주기 위한 구분 */
  isPrimary: boolean;
}

export interface ReverseIndex {
  /** 영문 기술명 → 배울 수 있는 종 */
  moveUsers: Map<string, Pokemon[]>;
  /** 영문 특성명 → 가진 폼 */
  abilityUsers: Map<string, FormRef[]>;
  /** 로스터에 실제로 등장하는 기술 이름 */
  moveNames: string[];
  /** 로스터에 실제로 등장하는 특성 이름 */
  abilityNames: string[];
}

function abilitiesOf(form: PokemonForm): string[] {
  const names = [...form.abilities];
  if (form.hiddenAbility && !names.includes(form.hiddenAbility)) names.push(form.hiddenAbility);
  return names;
}

export function buildReverseIndex(pokemon: Pokemon[]): ReverseIndex {
  const moveUsers = new Map<string, Pokemon[]>();
  const abilityUsers = new Map<string, FormRef[]>();

  for (const mon of pokemon) {
    for (const move of mon.learnableMoveNames) {
      const list = moveUsers.get(move);
      if (list) list.push(mon);
      else moveUsers.set(move, [mon]);
    }

    // 같은 폼이 두 번 들어오지 않게 막는다 (상류가 forms 배열을 공유하는 종이 있다).
    const seenForms = new Set<string>();
    for (const form of mon.forms) {
      if (seenForms.has(form.slug)) continue;
      seenForms.add(form.slug);
      const isPrimary = form.slug === mon.primary.slug;
      for (const ability of abilitiesOf(form)) {
        const ref: FormRef = { mon, form, isPrimary };
        const list = abilityUsers.get(ability);
        if (list) list.push(ref);
        else abilityUsers.set(ability, [ref]);
      }
    }
  }

  return {
    moveUsers,
    abilityUsers,
    moveNames: [...moveUsers.keys()],
    abilityNames: [...abilityUsers.keys()],
  };
}
