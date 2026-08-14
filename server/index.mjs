/**
 * 프로덕션 서버 — dist/ 정적 서빙 + /api/* 런타임 데이터 계층.
 *
 * 이 서버가 있으면 재배포 없이 다음이 반영된다:
 *   - data/frozen-season.source.json 을 고치면 M5 구축이 즉시 갱신
 *   - Smogon 에 새 달 통계가 올라오면 카운터가 자동 재생성
 *   - CHAMPIONS_RANKING_* 를 켜고 재시작하면 랭킹 탭이 자동 노출
 *
 * 실행: npm run build && npm run serve
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi } from './api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT ?? 5173);

const log = (msg) => process.stdout.write(`${msg}\n`);
const api = createApi(ROOT, log);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // 이 타입으로 안 주면 안드로이드가 manifest 를 무시해 설치 배너가 안 뜬다.
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  res.statusCode = 200;
  res.setHeader('content-type', MIME[ext] ?? 'application/octet-stream');
  // 해시 붙은 에셋만 길게 캐시한다. index.html 은 항상 새로 받아야 배포가 반영된다.
  res.setHeader(
    'cache-control',
    filePath.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  );
  createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname.startsWith('/api/')) {
    api.handle(url.pathname.slice('/api/'.length), req, res).then(
      (handled) => {
        if (handled) return;
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ reason: '없는 엔드포인트입니다.' }));
      },
      (err) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ reason: err?.message ?? '서버 오류' }));
      },
    );
    return;
  }

  // 경로 이탈 방지: dist 바깥으로 나가는 요청은 전부 index.html 로 떨군다.
  const resolved = path.resolve(path.join(DIST, decodeURIComponent(url.pathname)));
  if (resolved.startsWith(DIST) && existsSync(resolved) && statSync(resolved).isFile()) {
    serveFile(res, resolved);
    return;
  }

  const indexHtml = path.join(DIST, 'index.html');
  if (!existsSync(indexHtml)) {
    res.statusCode = 500;
    res.end('dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.');
    return;
  }
  serveFile(res, indexHtml);
});

server.listen(PORT, () => {
  log(`http://localhost:${PORT} 에서 서비스 중`);
  log(`M6 랭킹: ${api.ranking.isEnabled() ? '활성 (서버사이드 캐시)' : '비활성 — M1~M5 는 정상 동작'}`);
  log('Smogon 카운터 자동 갱신: 6시간 주기로 새 달 확인');
});
