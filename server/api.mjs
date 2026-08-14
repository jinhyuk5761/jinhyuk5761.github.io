/**
 * /api/* 라우터 — vite 개발 서버와 프로덕션 서버가 같은 핸들러를 쓴다.
 *
 * 엔드포인트:
 *   GET /api/config            어떤 기능에 데이터가 있는지 (클라이언트가 주기적으로 확인)
 *   GET /api/builds            M5 구축 — 큐레이션 파일에서 라이브로 읽는다
 *   GET /api/counters/:format  M3 카운터 — 자동 갱신된 최신본
 *   GET /api/ranking           M6 랭킹 — C등급 소스 프록시
 *
 * 설계 의도: "데이터가 생기면 재배포 없이 붙는다."
 * 그래서 기능 가용 여부를 빌드타임 flag 가 아니라 이 config 응답이 결정한다.
 */

import { createBuildsService } from './builds-service.mjs';
import { createCountersService } from './counters-service.mjs';
import { createRankingService } from './ranking-service.mjs';

function send(res, status, body, { maxAge = 0 } = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  res.end(JSON.stringify(body));
}

export function createApi(rootDir, log = () => {}) {
  const builds = createBuildsService(rootDir);
  const counters = createCountersService(rootDir, log);
  const ranking = createRankingService(log);

  counters.start();

  /**
   * 클라이언트가 이 응답만 보고 탭 노출과 캐시 무효화를 결정한다.
   * version 이 바뀌면 클라이언트는 관련 데이터를 다시 받는다.
   */
  async function config() {
    const buildData = await builds.get();
    const counterSummary = await counters.summary();

    // 데이터가 바뀌었는지 한 문자열로 요약한다. 클라이언트는 이 값만 비교하면 된다.
    const version = [
      buildData.updatedAt ?? 'none',
      counterSummary.Singles?.generatedAt ?? 'none',
      counterSummary.Doubles?.generatedAt ?? 'none',
      ranking.isEnabled() ? 'rank-on' : 'rank-off',
    ].join('|');

    return {
      version,
      builds: {
        available: buildData.builds.length > 0,
        count: buildData.builds.length,
        updatedAt: buildData.updatedAt,
      },
      counters: counterSummary,
      ranking: { enabled: ranking.isEnabled() },
    };
  }

  /**
   * @param {string} subpath '/api' 를 제외한 나머지 경로. 예: 'config', 'counters/singles'
   */
  async function handle(subpath, req, res) {
    const [head, tail] = subpath.replace(/^\/+|\/+$/g, '').split('/');

    if (head === 'config') {
      send(res, 200, await config(), { maxAge: 30 });
      return true;
    }

    if (head === 'builds') {
      const data = await builds.get();
      send(res, 200, { updatedAt: data.updatedAt, builds: data.builds }, { maxAge: 30 });
      return true;
    }

    if (head === 'counters') {
      const format = tail?.toLowerCase() === 'doubles' ? 'Doubles' : 'Singles';
      const dataset = await counters.get(format);
      if (!dataset) {
        send(res, 404, { reason: '카운터 데이터가 아직 생성되지 않았습니다.' });
        return true;
      }
      // 버전이 URL 에 실려 오므로 오래 캐시해도 안전하다.
      send(res, 200, dataset, { maxAge: 3600 });
      return true;
    }

    if (head === 'ranking') {
      await ranking.handle(res);
      return true;
    }

    return false;
  }

  return { handle, config, counters, builds, ranking };
}

/**
 * vite 개발 서버용. `server.middlewares.use('/api', ...)` 는 접두사를 떼고 넘겨준다.
 */
export function createViteApiMiddleware(rootDir, log) {
  const api = createApi(rootDir, log);
  return (req, res, next) => {
    api.handle(req.url ?? '/', req, res).then(
      (handled) => {
        if (!handled) next();
      },
      (err) => {
        send(res, 500, { reason: err?.message ?? '서버 오류' });
      },
    );
  };
}
