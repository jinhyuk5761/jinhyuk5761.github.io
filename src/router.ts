/**
 * 해시 라우터. 정적 호스팅에서 서버 설정 없이 딥링크가 살아야 하므로 해시를 쓴다.
 *
 * 경로:
 *   #/            검색 (M1)
 *   #/p/:id       포켓몬 상세 (M2, M3)
 *   #/compare     두 포켓몬 비교 (M4)
 *   #/calc        대미지 계산기
 *   #/builds      동결 시즌 구축 (M5)
 *   #/ranking     트레이너 랭킹 (M6, 옵션)
 *   #/sources     데이터 출처 (설계 문서 6절 — 필수)
 */

export interface Route {
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const segments = (pathPart ?? '/').split('/').filter(Boolean);
  const query = new URLSearchParams(queryPart);

  if (segments.length === 0) return { path: '/', params: {}, query };

  if (segments[0] === 'p' && segments[1]) {
    return { path: '/p', params: { id: decodeURIComponent(segments[1]) }, query };
  }

  const known = ['moves', 'abilities', 'calc', 'mini', 'ranking', 'sources'];
  if (known.includes(segments[0] as string)) {
    return { path: `/${segments[0]}`, params: {}, query };
  }

  return { path: '/404', params: {}, query };
}

export function currentRoute(): Route {
  /*
   * 안드로이드 앱 바로가기는 주소의 **프래그먼트(#)** 를 그대로 전달하지 못한다.
   * `/#/mini` 를 넣어도 런처가 무시하고 기본 주소로 앱을 열어버린다.
   * 그래서 프래그먼트 대신 쿼리(`?view=mini`)로도 들어올 수 있게 한다.
   */
  if (!location.hash) {
    const view = new URLSearchParams(location.search).get('view');
    if (view) return parseHash(`#/${view}`);
  }
  return parseHash(location.hash);
}

export function navigate(hash: string): void {
  if (location.hash === hash) return;
  location.hash = hash;
}

export function href(path: string): string {
  return `#${path}`;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener('hashchange', () => handler(currentRoute()));
}
