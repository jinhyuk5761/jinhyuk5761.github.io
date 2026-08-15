/**
 * 상위 랭커 구축 집계.
 *
 * `scripts/build-ranked-teams.mjs` 가 구운 산출물을 읽는다. 원본(champs.pokedb.tokyo)에는
 * **앱이 직접 요청하지 않는다** — 발행처가 최종 사용자 기기에서의 직접 요청을 금지했고,
 * 그래서 우리 배포에 구워 넣은 파일만 본다.
 */

import { TTL, fetchJson } from '../core/http';
import type { Format } from '../types';

/** 한 팀에 몇 번 들어갔는지. `share` 는 백분율(소수 첫째 자리). */
export interface TeamCount {
  name: string;
  count: number;
  share: number;
}

export interface RankedPokemon {
  name: string;
  /** 상세 화면으로 넘어갈 키. 로스터에 없으면 null. */
  showdownId: string | null;
  teams: number;
  share: number;
  /** 이 포켓몬이 가장 많이 든 도구 셋. */
  items: TeamCount[];
}

export interface RankedPair {
  a: string;
  b: string;
  count: number;
  share: number;
}

/** 팀에 들어간 한 마리. */
export interface TeamMember {
  name: string;
  /** 상세 화면으로 넘어갈 키. 로스터에 없으면 null. */
  id: string | null;
  /** 지닌 도구. 없으면 null. */
  item: string | null;
}

export interface RankedTeam {
  rank: number;
  /** 최종 레이팅. 원본이 안 주면 null. */
  rating: number | null;
  members: TeamMember[];
}

export interface RankedSet {
  /** 'M-4' 처럼 시즌 표기. */
  season: string;
  seasonNumber: number;
  format: Format;
  /** 원본이 집계된 시각. 우리가 받은 시각이 아니다. */
  updatedAt: string;
  teamCount: number;
  slotCount: number;
  /** 순위대로 정렬된 팀 목록. */
  teams: RankedTeam[];
  pokemon: RankedPokemon[];
  items: TeamCount[];
  pairs: RankedPair[];
}

export interface RankedTeams {
  source: string;
  sets: RankedSet[];
}

export async function fetchRankedTeams(): Promise<RankedTeams> {
  const { data } = await fetchJson<RankedTeams>(
    `${import.meta.env.BASE_URL}data/rankedTeams.json`,
    { ttlMs: TTL.buildArtifact, timeoutMs: 20_000, persist: true },
  );
  return { source: data?.source ?? '', sets: data?.sets ?? [] };
}
