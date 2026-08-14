/**
 * 서비스워커 — 폰에 설치했을 때 PC 서버가 꺼져 있어도 앱이 뜨게 한다.
 *
 * 이 앱의 데이터 출처는 두 종류다:
 *   1. 외부 공개 API (championsbattledata.com 등) — 폰이 인터넷만 있으면 직접 받는다.
 *   2. 우리 서버 /api/* — PC 가 켜져 있고 USB/네트워크로 연결됐을 때만 닿는다.
 *
 * 그래서 2번이 끊겨도 1번과 캐시로 앱이 굴러가야 한다.
 * 실제로 클라이언트는 /api/config 가 실패하면 정적 파일 경로로 폴백하도록 짜여 있고,
 * 그 정적 파일을 여기서 캐시해 둔다.
 *
 * 사전 캐시(precache)를 쓰지 않는 이유: 번들 파일명에 해시가 붙어서
 * 이 파일을 쓰는 시점에는 이름을 알 수 없다. 대신 처음 받을 때 캐시에 넣는다.
 */

// 이 값을 올리면 activate 단계에서 예전 캐시가 통째로 버려진다.
// index.html 이 갱신되지 않던 버그를 고쳤으므로, 그 버그로 굳어버린 캐시를 비우려면 올려야 한다.
const VERSION = 'v3';
const SHELL_CACHE = `pcm-shell-${VERSION}`;
const DATA_CACHE = `pcm-data-${VERSION}`;
const IMAGE_CACHE = `pcm-img-${VERSION}`;

/** 이미지 캐시가 무한정 커지지 않게 막는다. 스프라이트가 수백 장이다. */
const MAX_IMAGES = 400;

self.addEventListener('install', (event) => {
  // 최소한 진입점은 미리 확보해 둔다. 나머지는 런타임에 채운다.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(['./', './index.html', './manifest.webmanifest']))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // 오래된 것부터 버린다(Cache API 는 삽입 순서를 유지한다).
  for (let i = 0; i < keys.length - maxEntries; i += 1) await cache.delete(keys[i]);
}

/** 캐시 우선. 해시 붙은 에셋처럼 내용이 안 바뀌는 것에만 쓴다. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

/** 네트워크 우선, 실패하면 캐시. 최신이 낫지만 없으면 옛것이라도 보여야 하는 데이터용. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

/** 캐시를 즉시 주고 뒤에서 갱신. 스프라이트처럼 즉시성이 중요한 것에 쓴다. */
async function staleWhileRevalidate(request, cacheName, { trim } = {}) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) {
        cache.put(request, res.clone()).then(() => {
          if (trim) trimCache(cacheName, trim);
        });
      }
      return res;
    })
    .catch(() => null);
  return hit ?? (await network) ?? Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 화면 이동: 네트워크 우선, 끊기면 캐시된 index.html 로 앱을 띄운다.
  //
  // 성공했을 때 캐시를 **반드시 갱신**해야 한다. 예전에는 이걸 빼먹어서
  // install 때 저장된 최초 index.html 이 영원히 남았고, 오프라인이 되는 순간
  // 몇 번을 새로 배포하든 첫 배포 화면이 떴다(계산기 탭이 사라진 원인).
  //
  // `cache: 'no-cache'` 를 붙이는 이유: GitHub Pages 가 index.html 을
  // `max-age=600` 으로 내려준다. 그냥 fetch 하면 브라우저 HTTP 캐시가 최대 10분간
  // 옛 index.html 을 돌려주고, 그게 옛 번들 해시를 가리켜 배포한 변경이 안 보인다.
  // no-cache 는 캐시를 끄는 게 아니라 **매번 서버에 물어보게** 한다(ETag 로 304 면 그대로 재사용).
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match('./index.html')) ?? (await cache.match('./')) ?? Response.error();
        }),
    );
    return;
  }

  if (sameOrigin) {
    // 해시가 붙어 있어 내용이 절대 안 바뀐다.
    if (url.pathname.includes('/assets/')) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
      return;
    }

    // 기능 가용 여부와 랭킹은 '지금 값'이 아니면 의미가 없다. 캐시하지 않는다.
    if (url.pathname.endsWith('/api/config') || url.pathname.endsWith('/api/ranking')) {
      return; // 브라우저 기본 동작 — 실패하면 앱이 정적 폴백으로 degrade 한다.
    }

    // 서버가 주는 데이터. 끊기면 마지막으로 받은 값을 쓴다.
    if (url.pathname.includes('/api/')) {
      event.respondWith(networkFirst(request, DATA_CACHE));
      return;
    }

    // 번들 동봉 데이터(정적 폴백 경로). 서버가 없을 때 이게 화면을 채운다.
    if (url.pathname.includes('/data/')) {
      event.respondWith(networkFirst(request, DATA_CACHE));
      return;
    }

    event.respondWith(networkFirst(request, SHELL_CACHE));
    return;
  }

  // 외부 스프라이트 — 폰 인터넷으로 직접 받고 캐시한다.
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, { trim: MAX_IMAGES }));
    return;
  }

  // 외부 API(championsbattledata 등)는 그대로 통과시킨다.
  // 앱의 http 계층이 자체 TTL 캐시와 stale-while-revalidate 를 이미 갖고 있다.
});
