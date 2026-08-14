/**
 * 런타임 기능 감지 — /api/config
 *
 * 왜 필요한가: 기능 가용 여부를 빌드타임 flag 로 박아두면, 데이터가 생겨도
 * 재빌드·재배포를 해야 화면에 붙는다. 그래서 "무엇에 데이터가 있는지"를
 * 서버가 런타임에 알려주고, 클라이언트는 이 응답만 보고 탭 노출과 캐시를 결정한다.
 *
 * 서버가 없어도(정적 호스팅) 죽지 않는다 — 번들에 동봉된 정적 파일로 폴백한다.
 */

import type { Format } from '../types';

export interface CounterSummary {
  metagame: string | null;
  months: string[];
  battles: number;
  generatedAt: string | null;
  targets: number;
}

export interface AppConfig {
  /** 데이터가 바뀌면 달라지는 요약 문자열. 이 값만 비교하면 갱신 여부를 안다. */
  version: string;
  builds: { available: boolean; count: number; updatedAt: string | null };
  counters: Partial<Record<Format, CounterSummary | null>>;
  ranking: { enabled: boolean };
  /** 서버 /api 가 응답했는지. false 면 정적 파일 폴백 모드다. */
  serverBacked: boolean;
}

/** 서버가 없을 때의 기본값. 번들 동봉 정적 파일만 쓰고 랭킹은 숨긴다. */
export const OFFLINE_CONFIG: AppConfig = {
  version: 'static',
  builds: { available: true, count: 0, updatedAt: null },
  counters: {},
  ranking: { enabled: false },
  serverBacked: false,
};

export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    // config 는 캐시하지 않는다 — 갱신을 감지하는 게 목적이라 항상 최신이어야 한다.
    const res = await fetch(`${import.meta.env.BASE_URL}api/config`, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) return OFFLINE_CONFIG;

    const raw = (await res.json()) as Partial<AppConfig>;
    return {
      version: typeof raw?.version === 'string' ? raw.version : 'unknown',
      builds: {
        available: raw?.builds?.available === true,
        count: typeof raw?.builds?.count === 'number' ? raw.builds.count : 0,
        updatedAt: raw?.builds?.updatedAt ?? null,
      },
      counters: raw?.counters ?? {},
      ranking: { enabled: raw?.ranking?.enabled === true },
      serverBacked: true,
    };
  } catch {
    // 서버가 없거나 응답이 이상하면 정적 모드로 간다. 앱은 계속 동작한다.
    return OFFLINE_CONFIG;
  }
}

/**
 * 데이터 URL 을 만든다.
 *
 * 서버가 있으면 /api 경로 + 버전 쿼리를 쓴다. 버전이 바뀌면 URL 이 달라지므로
 * http 계층의 URL 키 캐시가 자연히 무효화된다 — 별도 캐시 퍼지 로직이 필요 없다.
 */
export function countersUrl(config: AppConfig, format: Format): string {
  const base = import.meta.env.BASE_URL;
  if (!config.serverBacked) return `${base}data/counters-${format.toLowerCase()}.json`;
  const version = config.counters[format]?.generatedAt ?? config.version;
  return `${base}api/counters/${format.toLowerCase()}?v=${encodeURIComponent(version)}`;
}

export function buildsUrl(config: AppConfig): string {
  const base = import.meta.env.BASE_URL;
  if (!config.serverBacked) return `${base}data/builds.json`;
  return `${base}api/builds?v=${encodeURIComponent(config.builds.updatedAt ?? config.version)}`;
}
