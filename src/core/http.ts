/**
 * 공통 fetch 계층 — 설계 문서 5절(캐싱 & 레이트리밋).
 *
 * 요구사항 세 가지를 여기서만 처리한다:
 *   1. 타임아웃 (어댑터가 매달려 앱 전체를 멈추지 않게)
 *   2. TTL 캐시 (소스별로 다른 신선도)
 *   3. stale-while-revalidate (실패 시 만료된 캐시라도 내놓는다)
 */

interface CacheRecord<T> {
  value: T;
  storedAt: number;
}

const memory = new Map<string, CacheRecord<unknown>>();
const STORAGE_PREFIX = 'pcm:v1:';

function readPersisted<T>(key: string): CacheRecord<T> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheRecord<T>;
    if (typeof parsed?.storedAt !== 'number') return null;
    return parsed;
  } catch {
    // localStorage 가 막혀 있거나(사생활 모드) 값이 깨졌으면 캐시가 없는 것으로 본다.
    return null;
  }
}

function writePersisted<T>(key: string, record: CacheRecord<T>): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(record));
  } catch {
    // 용량 초과는 치명적이지 않다. 메모리 캐시로만 동작시킨다.
  }
}

export interface FetchOptions {
  /** 캐시 신선도(ms). 지나면 재검증하되, 실패 시 오래된 값을 계속 쓴다. */
  ttlMs: number;
  timeoutMs?: number;
  /** true 면 localStorage 에도 저장한다. 큰 응답은 false 로 둔다. */
  persist?: boolean;
}

export interface FetchResult<T> {
  data: T;
  /** TTL 이 지났지만 재검증에 실패해 예전 값을 쓰고 있는 상태 */
  stale: boolean;
}

/**
 * JSON 을 가져온다. 캐시가 신선하면 네트워크를 건드리지 않는다.
 * 네트워크가 실패해도 캐시가 있으면 stale:true 로 반환하고 절대 throw 하지 않는다.
 * 캐시도 없고 네트워크도 실패한 경우에만 throw 한다.
 */
export async function fetchJson<T>(url: string, options: FetchOptions): Promise<FetchResult<T>> {
  const { ttlMs, timeoutMs = 15_000, persist = false } = options;
  const now = Date.now();

  const cached =
    (memory.get(url) as CacheRecord<T> | undefined) ??
    (persist ? readPersisted<T>(url) ?? undefined : undefined);

  if (cached && now - cached.storedAt < ttlMs) {
    return { data: cached.value, stale: false };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const value = (await res.json()) as T;
    const record: CacheRecord<T> = { value, storedAt: now };
    memory.set(url, record);
    if (persist) writePersisted(url, record);
    return { data: value, stale: false };
  } catch (err) {
    if (cached) {
      // stale-while-revalidate: 새로 못 받았으면 옛 값이라도 화면을 채운다.
      return { data: cached.value, stale: true };
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** 소스별 캐시 정책 — 설계 문서 5절 그대로. */
export const TTL = {
  /** 일별 갱신 소스 */
  championsBattleData: 6 * 60 * 60 * 1000,
  /** 빌드 산출물. 배포마다 바뀌므로 짧게 잡을 이유가 없다. */
  buildArtifact: 24 * 60 * 60 * 1000,
  /** 서버가 이미 캐싱하므로 클라이언트는 짧게 */
  ranking: 5 * 60 * 1000,
} as const;
