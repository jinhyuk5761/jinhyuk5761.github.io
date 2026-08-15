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
  /** 원본의 '도감번호-폼번호'(예: 0670-05). pokedb 폼 페이지로 넘어갈 때 쓴다. */
  dex: string | null;
}

/**
 * 이 폼을 쓴 구축글이 모여 있는 pokedb 페이지.
 *
 * 우리가 그쪽 내용을 가져오지는 않는다 — 사람이 눌러서 읽으러 가는 링크다.
 * 규칙(`?rule=`) 은 붙이지 않는다. 어느 숫자가 싱글인지 확인하지 않았고,
 * 틀린 링크를 보내느니 사이트 기본값에 맡기는 편이 낫다.
 */
export function pokedbFormUrl(dex: string): string {
  return `https://champs.pokedb.tokyo/pokemon/show/${encodeURIComponent(dex)}`;
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
    /*
     * localStorage 에 담지 않는다(`persist: false`).
     *
     * 800KB 짜리라 다른 캐시를 밀어낼 만큼 크고, 무엇보다 **모양이 바뀌면 발이 묶인다** —
     * 팀 목록을 넣기 전 응답이 24시간 동안 남아 화면이 통째로 터졌다.
     * 오프라인 대비는 서비스워커의 DATA_CACHE 가 이미 맡고 있다.
     */
    { ttlMs: TTL.buildArtifact, timeoutMs: 20_000 },
  );
  return normalizeRankedTeams(data);
}

/**
 * 빠진 칸을 채워 화면이 터지지 않게 한다.
 *
 * 산출물의 모양은 앞으로도 바뀐다. 그때마다 옛 응답을 들고 있는 사람의 화면이
 * 깨지면 안 되므로, 없는 것은 빈 목록으로 보고 있는 것만 그린다.
 */
export function normalizeRankedTeams(data: RankedTeams | null | undefined): RankedTeams {
  return {
    source: data?.source ?? '',
    sets: (data?.sets ?? []).map((set) => ({
      ...set,
      teams: set.teams ?? [],
      pokemon: set.pokemon ?? [],
      items: set.items ?? [],
      pairs: set.pairs ?? [],
    })),
  };
}
