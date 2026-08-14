/**
 * A등급 — Pokémon Showdown learnset
 *
 * 설계 문서는 smogon/pokemon-showdown 저장소에서 learnset 을 가져오는 그림이었으나,
 * 실응답 확인 결과 championsbattledata 인덱스가 이미 `learnableMoveNames` 를 동봉한다
 * (Showdown Champions 모드에서 파생된 목록). 같은 데이터를 두 번 받을 이유가 없으므로
 * 이 어댑터는 인덱스에 실려온 값을 도메인 용도로 가공하는 역할만 한다.
 *
 * 이 결정이 뒤집힐 경우(인덱스에서 필드가 사라짐) 여기만 교체하면 된다 —
 * 호출부는 fetchRaw/normalize 계약만 알고 있다.
 */

import type { Pokemon, UsageReport } from '../types';

export interface LearnsetView {
  /** 실제 메타에서 채택된 기술 (사용률 데이터에 등장) */
  used: { name: string; percentage: string; percentageValue: number | null }[];
  /** 배울 수는 있으나 상위 사용률에 없는 기술 */
  unused: string[];
  total: number;
}

/**
 * learnset 과 사용률을 교차해 "배울 수 있는데 안 쓰는 기술"을 분리한다.
 * 사용률 데이터가 없으면 전부 unused 로 떨어뜨린다(빈 화면보다 낫다).
 */
export function normalizeLearnset(mon: Pokemon, usage: UsageReport | null): LearnsetView {
  const learnable = mon.learnableMoveNames ?? [];
  const moveBlock = usage?.blocks.find((b) => b.category === 'move');

  const usedNames = new Set<string>();
  const used: LearnsetView['used'] = [];
  for (const entry of moveBlock?.entries ?? []) {
    if (!entry.name) continue;
    usedNames.add(entry.name);
    used.push({
      name: entry.name,
      percentage: entry.percentage,
      percentageValue: entry.percentageValue,
    });
  }

  const unused = learnable.filter((name) => !usedNames.has(name)).sort();

  return { used, unused, total: learnable.length };
}
