/**
 * 서비스워커 캐시 정책 테스트.
 *
 * 실제로 겪은 버그가 있다: 화면 이동 요청이 성공해도 캐시를 갱신하지 않아서,
 * install 때 저장된 **최초** index.html 이 영원히 남았다. 그 결과 오프라인이 되는
 * 순간 몇 번을 새로 배포하든 첫 배포 화면이 떴다(계산기 탭이 사라진 것처럼 보였다).
 *
 * 소스를 문자열로 읽어 정책을 확인한다. 서비스워커를 실제로 돌리려면
 * 브라우저 런타임이 필요한데, 여기서 막고 싶은 건 "정책이 되돌아가는 것"이다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.join(import.meta.dirname, '..', 'public', 'sw.js'),
  'utf8',
);

/** navigate 분기만 잘라낸다. */
function navigateBranch(): string {
  const start = source.indexOf("request.mode === 'navigate'");
  expect(start, 'navigate 분기를 찾지 못했습니다').toBeGreaterThan(-1);
  return source.slice(start, start + 900);
}

describe('화면 이동 캐시', () => {
  it('네트워크가 성공하면 index.html 캐시를 갱신한다', () => {
    // 이걸 빼먹으면 최초 배포 화면이 캐시에 굳어버린다.
    expect(navigateBranch()).toContain("cache.put('./index.html'");
  });

  it('응답을 복제해서 저장한다 (본문을 두 번 읽을 수 없다)', () => {
    expect(navigateBranch()).toContain('response.clone()');
  });

  it('실패했을 때만 캐시로 폴백한다 (네트워크 우선)', () => {
    const branch = navigateBranch();
    // fetch 를 먼저 하고, catch 에서 캐시를 꺼낸다.
    expect(branch.indexOf('fetch(request)')).toBeLessThan(branch.indexOf('.catch('));
    expect(branch).toContain("cache.match('./index.html')");
  });

  it('오류 응답은 캐시에 넣지 않는다', () => {
    expect(navigateBranch()).toContain('response.ok');
  });
});

describe('캐시 버전', () => {
  it('버전이 정의돼 있고 activate 에서 옛 캐시를 지운다', () => {
    expect(/const VERSION = 'v\d+'/.test(source)).toBe(true);
    expect(source).toContain('caches.delete');
  });

  it('index.html 갱신 버그를 고친 뒤이므로 v1 이 아니다', () => {
    // v1 캐시에는 갱신되지 않는 index.html 이 들어 있다. 버전을 올려야 비워진다.
    expect(source).not.toContain("const VERSION = 'v1'");
  });
});

describe('그 밖의 캐시 정책', () => {
  it('해시 붙은 에셋만 캐시 우선이다', () => {
    expect(source).toContain("url.pathname.includes('/assets/')");
    expect(source).toContain('cacheFirst(request, SHELL_CACHE)');
  });

  it('기능 감지와 랭킹은 캐시하지 않는다 (지금 값이어야 의미가 있다)', () => {
    expect(source).toContain("url.pathname.endsWith('/api/config')");
    expect(source).toContain("url.pathname.endsWith('/api/ranking')");
  });

  it('데이터는 네트워크 우선 + 캐시 폴백이다', () => {
    expect(source).toContain('networkFirst(request, DATA_CACHE)');
  });
});

describe('배포 직후 반영', () => {
  it('화면 이동 요청이 HTTP 캐시를 우회해 서버에 물어본다', () => {
    // GitHub Pages 가 index.html 을 max-age=600 으로 준다.
    // 그냥 fetch 하면 최대 10분간 옛 index.html 이 나오고,
    // 그게 옛 번들 해시를 가리켜 배포한 변경이 안 보인다.
    expect(navigateBranch()).toContain("cache: 'no-cache'");
  });

  it('버전을 올려 옛 캐시를 비운다', () => {
    expect(source).toContain("const VERSION = 'v3'");
  });
});
