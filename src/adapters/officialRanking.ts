/**
 * C등급 (옵션) — 공식 트레이너 랭킹
 *
 * 클라이언트는 공식 도메인을 절대 직접 호출하지 않는다. 항상 우리 서버의
 * /api/ranking 만 부른다(설계 문서 M6). 서버가 꺼져 있거나 flag 가 off 면
 * 이 어댑터는 status:'empty' 를 돌려주고, 랭킹 탭만 안내문으로 대체된다.
 *
 * 탭 노출 여부는 빌드타임 flag 가 아니라 /api/config 가 런타임에 결정한다 —
 * 랭킹 URL 을 확보해 서버를 재시작하면 재빌드 없이 탭이 붙는다.
 *
 * 공식 응답 스키마는 계약이 아니다(예고 없이 바뀐다). 그래서 normalize 는
 * 여러 후보 필드명을 순서대로 훑고, 못 찾으면 null 로 떨어뜨린다.
 */

import { TTL, fetchJson } from '../core/http';
import type { Loaded, RankingResult, TrainerRankRow } from '../types';

interface RawEnvelope {
  enabled?: boolean;
  stale?: boolean;
  fetchedAt?: string;
  reason?: string;
  payload?: unknown;
}

function pick(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,%\s]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** payload 안 어디에 배열이 있는지 모른다. 흔한 위치를 순서대로 뒤진다. */
function findRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['ranking', 'rankings', 'list', 'rows', 'data', 'items', 'result']) {
      const candidate = obj[key];
      if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
      if (candidate && typeof candidate === 'object') {
        const nested = findRows(candidate);
        if (nested.length > 0) return nested;
      }
    }
  }
  return [];
}

export function normalizeRanking(envelope: RawEnvelope): RankingResult {
  const rows: TrainerRankRow[] = [];

  findRows(envelope?.payload).forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const wins = toNumber(pick(raw, ['wins', 'win', 'winCount', 'win_count']));
    const losses = toNumber(pick(raw, ['losses', 'lose', 'loseCount', 'lose_count']));
    let winRate = toNumber(pick(raw, ['winRate', 'win_rate', 'winningRate']));
    // 승률이 없어도 승/패가 있으면 계산해준다.
    if (winRate === null && wins !== null && losses !== null && wins + losses > 0) {
      winRate = (wins / (wins + losses)) * 100;
    }

    rows.push({
      rank: toNumber(pick(raw, ['rank', 'ranking', 'order', 'position'])) ?? i + 1,
      points: toNumber(pick(raw, ['points', 'point', 'rate', 'score', 'rating'])),
      country: (pick(raw, ['country', 'countryCode', 'region', 'nation']) as string) ?? null,
      nickname:
        (pick(raw, ['nickname', 'name', 'trainerName', 'playerName', 'userName']) as string) ??
        '(이름 없음)',
      wins,
      losses,
      winRate,
      streak: toNumber(pick(raw, ['streak', 'winStreak', 'consecutiveWins'])),
    });
  });

  rows.sort((a, b) => a.rank - b.rank);

  return {
    rows,
    // 공개 랭킹은 상위 N위까지만 존재한다. 그 N 을 UI 가 명시할 수 있게 넘긴다.
    coverageLimit: rows.length > 0 ? (rows.at(-1)?.rank ?? null) : null,
    fetchedAt: envelope?.fetchedAt ?? '',
    stale: envelope?.stale === true,
  };
}

export async function fetchRanking(): Promise<Loaded<RankingResult>> {
  try {
    const { data } = await fetchJson<RawEnvelope>(`${import.meta.env.BASE_URL}api/ranking`, {
      ttlMs: TTL.ranking,
      timeoutMs: 20_000,
    });
    if (data?.enabled === false) {
      return { status: 'empty', reason: data.reason ?? '서버에서 랭킹이 비활성화되어 있습니다.' };
    }
    const result = normalizeRanking(data);
    if (result.rows.length === 0) {
      return { status: 'empty', reason: '랭킹 응답에서 표를 찾지 못했습니다.' };
    }
    return { status: 'ok', data: result, stale: result.stale };
  } catch (err) {
    return {
      status: 'error',
      reason:
        err instanceof Error
          ? `랭킹 서버에 접근하지 못했습니다 (${err.message}).`
          : '랭킹을 불러오지 못했습니다.',
    };
  }
}
