/**
 * M6 트레이너 랭킹 — C등급 소스 격리 계층 (서버사이드 전용)
 *
 * 설계 문서 9절의 리스크를 코드로 강제한다:
 *   - 클라이언트는 /api/ranking 만 호출한다. 공식 도메인을 직접 때리지 않는다.
 *   - flag 가 꺼져 있으면(기본값) 아예 네트워크를 타지 않는다.
 *   - TTL 30분 이상 서버 캐시. 429/5xx 를 받으면 이전 캐시를 계속 내보낸다.
 *   - 연속 실패 시 지수 백오프로 상류를 두드리지 않는다.
 *
 * 활성화하려면 두 환경변수가 모두 필요하다:
 *   CHAMPIONS_RANKING_ENABLED=1
 *   CHAMPIONS_RANKING_URL=<공개 랭킹 JSON 엔드포인트>
 *
 * 중요: 이 값들은 **런타임에** 읽는다. 프로세스를 다시 띄우면 바로 반영되고,
 * 클라이언트는 /api/config 를 주기적으로 확인해 탭을 자동으로 띄운다.
 * URL 을 코드에 박아두지 않은 이유는 DEVIATIONS.md 9절 참고.
 */

const TTL_MS = 30 * 60 * 1000; // 설계 문서 5절: 최소 30분
const TIMEOUT_MS = 15_000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export function createRankingService(log = () => {}) {
  let cache = null;
  let consecutiveFailures = 0;
  let nextAttemptAt = 0;
  let inFlight = null;

  const isEnabled = () =>
    process.env.CHAMPIONS_RANKING_ENABLED === '1' && Boolean(process.env.CHAMPIONS_RANKING_URL);

  const backoffMs = () =>
    consecutiveFailures === 0
      ? 0
      : Math.min(MAX_BACKOFF_MS, 2 ** (consecutiveFailures - 1) * 60_000);

  async function refresh() {
    const res = await fetch(process.env.CHAMPIONS_RANKING_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const payload = await res.json();
    cache = { payload, fetchedAt: Date.now() };
    consecutiveFailures = 0;
    nextAttemptAt = 0;
    log('[ranking] 상류 갱신 완료');
  }

  /**
   * 캐시가 신선하면 그대로, 아니면 갱신을 시도한다.
   * 갱신에 실패해도 캐시가 있으면 stale 로 내보낸다(설계 문서 5절).
   */
  async function get() {
    const now = Date.now();
    if (cache && now - cache.fetchedAt < TTL_MS) {
      return { payload: cache.payload, fetchedAt: cache.fetchedAt, stale: false };
    }

    // 백오프 중이면 상류를 두드리지 않는다.
    if (now < nextAttemptAt) {
      if (cache) return { payload: cache.payload, fetchedAt: cache.fetchedAt, stale: true };
      throw new Error('상류 장애로 재시도 대기 중입니다.');
    }

    // 동시 요청이 몰려도 상류에는 한 번만 나간다.
    if (!inFlight) {
      inFlight = refresh()
        .catch((err) => {
          consecutiveFailures += 1;
          nextAttemptAt = Date.now() + backoffMs();
          throw err;
        })
        .finally(() => {
          inFlight = null;
        });
    }

    try {
      await inFlight;
      return { payload: cache.payload, fetchedAt: cache.fetchedAt, stale: false };
    } catch (err) {
      if (cache) return { payload: cache.payload, fetchedAt: cache.fetchedAt, stale: true };
      throw err;
    }
  }

  function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.end(JSON.stringify(body));
  }

  async function handle(res) {
    if (!isEnabled()) {
      send(res, 200, {
        enabled: false,
        reason:
          'M6 랭킹이 비활성화되어 있습니다. CHAMPIONS_RANKING_ENABLED=1 과 CHAMPIONS_RANKING_URL 을 설정하세요.',
      });
      return;
    }
    try {
      const { payload, fetchedAt, stale } = await get();
      send(res, 200, {
        enabled: true,
        stale,
        fetchedAt: new Date(fetchedAt).toISOString(),
        payload,
      });
    } catch (err) {
      send(res, 502, { enabled: true, reason: err?.message ?? '상류 호출 실패' });
    }
  }

  return { isEnabled, get, handle };
}
