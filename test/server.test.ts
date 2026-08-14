/**
 * 서버 런타임 데이터 계층 테스트.
 *
 * 이 계층의 존재 이유가 "재배포 없이 새 데이터가 붙는다"이므로,
 * 검증할 것도 정확히 그것이다: 파일을 고치면 다음 요청이 새 값을 본다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createBuildsService, validateBuilds } from '../server/builds-service.mjs';
import { createRankingService } from '../server/ranking-service.mjs';
import { pickMetagame, recentMonths } from '../scripts/lib/counters.mjs';

/** node:http 응답 대역. 실제 소켓 없이 상태·본문만 받아낸다. */
function fakeRes() {
  const captured: { status: number; headers: Record<string, string>; body: string } = {
    status: 0,
    headers: {},
    body: '',
  };
  return {
    captured,
    res: {
      set statusCode(v: number) {
        captured.status = v;
      },
      get statusCode() {
        return captured.status;
      },
      setHeader(k: string, v: string) {
        captured.headers[k] = v;
      },
      end(body: string) {
        captured.body = body;
      },
    },
    json: () => JSON.parse(captured.body),
  };
}

describe('validateBuilds', () => {
  it('출처 없는 항목을 버린다 (설계 문서 6절)', () => {
    const { accepted, rejected } = validateBuilds([{ title: '출처 없음' }]);
    expect(accepted).toEqual([]);
    expect(rejected[0]).toContain('sourceUrl');
  });

  it('X / YouTube 링크를 버린다 (설계 문서 M5)', () => {
    const { accepted, rejected } = validateBuilds([
      { title: 'a', sourceUrl: 'https://x.com/p/1' },
      { title: 'b', sourceUrl: 'https://www.youtube.com/watch?v=1' },
    ]);
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(2);
  });

  it('정상 항목을 통과시키고 라벨을 채워준다', () => {
    const { accepted } = validateBuilds([
      { title: '구축', sourceUrl: 'https://note.com/a/b', format: 'Doubles', translated: true },
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.sourceLabel).toBe('note.com');
    expect(accepted[0]!.format).toBe('Doubles');
    expect(accepted[0]!.translated).toBe(true);
  });

  it('배열이 아니면 거부한다', () => {
    expect(validateBuilds({ nope: true } as never).accepted).toEqual([]);
  });
});

describe('buildsService — 파일을 고치면 재시작 없이 반영된다', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'pcm-builds-'));
    await mkdir(path.join(root, 'data'), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const sourceFile = () => path.join(root, 'data', 'frozen-season.source.json');

  it('파일이 없으면 빈 목록 — 오류가 아니다', async () => {
    const service = createBuildsService(root);
    const result = await service.get();
    expect(result.builds).toEqual([]);
    expect(result.updatedAt).toBeNull();
  });

  it('파일이 생기면 다음 요청이 바로 읽는다', async () => {
    const service = createBuildsService(root);
    expect((await service.get()).builds).toEqual([]);

    await writeFile(
      sourceFile(),
      JSON.stringify([{ title: '새 구축', sourceUrl: 'https://note.com/a' }]),
    );

    const after = await service.get();
    expect(after.builds).toHaveLength(1);
    expect(after.builds[0]!.title).toBe('새 구축');
    expect(after.updatedAt).not.toBeNull();
  });

  it('내용이 바뀌면 다시 파싱한다', async () => {
    await writeFile(sourceFile(), JSON.stringify([{ title: 'v1', sourceUrl: 'https://note.com/a' }]));
    const service = createBuildsService(root);
    expect((await service.get()).builds[0]!.title).toBe('v1');

    // mtime 해상도 때문에 같은 밀리초에 두 번 쓰면 변경을 놓칠 수 있다.
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(sourceFile(), JSON.stringify([{ title: 'v2', sourceUrl: 'https://note.com/a' }]));

    expect((await service.get()).builds[0]!.title).toBe('v2');
  });

  it('편집 중 JSON 이 깨져도 직전 성공본을 유지한다', async () => {
    await writeFile(sourceFile(), JSON.stringify([{ title: '정상', sourceUrl: 'https://note.com/a' }]));
    const service = createBuildsService(root);
    expect((await service.get()).builds).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 20));
    await writeFile(sourceFile(), '{ 깨진 JSON');

    const after = await service.get();
    // 화면이 비지 않는다.
    expect(after.builds).toHaveLength(1);
    expect(after.rejected[0]).toContain('파싱 실패');
  });
});

describe('rankingService — 런타임 환경변수로 켜고 끈다', () => {
  const OLD = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD };
    vi.unstubAllGlobals();
  });

  it('환경변수가 없으면 꺼진 상태이고 네트워크를 타지 않는다', async () => {
    delete process.env.CHAMPIONS_RANKING_ENABLED;
    const stub = vi.fn();
    vi.stubGlobal('fetch', stub);

    const service = createRankingService();
    expect(service.isEnabled()).toBe(false);

    const { res, json } = fakeRes();
    await service.handle(res);
    expect(json().enabled).toBe(false);
    expect(stub).not.toHaveBeenCalled();
  });

  it('환경변수를 켜면 같은 인스턴스가 바로 활성으로 바뀐다', async () => {
    const service = createRankingService();
    expect(service.isEnabled()).toBe(false);

    // 프로세스 재시작 없이 환경이 바뀐 상황 (isEnabled 는 매번 env 를 읽는다).
    process.env.CHAMPIONS_RANKING_ENABLED = '1';
    process.env.CHAMPIONS_RANKING_URL = 'https://example.test/r.json';
    expect(service.isEnabled()).toBe(true);
  });

  it('상류를 한 번만 부르고 캐시한다', async () => {
    process.env.CHAMPIONS_RANKING_ENABLED = '1';
    process.env.CHAMPIONS_RANKING_URL = 'https://example.test/r.json';

    const stub = vi.fn(async () => new Response(JSON.stringify({ ranking: [] }), { status: 200 }));
    vi.stubGlobal('fetch', stub);

    const service = createRankingService();
    const a = fakeRes();
    await service.handle(a.res);
    const b = fakeRes();
    await service.handle(b.res);

    expect(stub).toHaveBeenCalledTimes(1);
    expect(a.json().enabled).toBe(true);
    expect(b.json().stale).toBe(false);
  });

  it('상류가 죽으면 502 로 알리고 앱을 죽이지 않는다', async () => {
    process.env.CHAMPIONS_RANKING_ENABLED = '1';
    process.env.CHAMPIONS_RANKING_URL = 'https://example.test/r.json';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));

    const service = createRankingService();
    const { res, json } = fakeRes();
    await service.handle(res);

    expect(json().enabled).toBe(true);
    expect(json().reason).toContain('503');
  });
});

describe('counters lib', () => {
  it('최신 규정을 고르고 bo3 변종을 배제한다', () => {
    const available = new Set([
      'gen9championsvgc2026regma',
      'gen9championsvgc2026regmb',
      'gen9championsvgc2026regmbbo3',
    ]);
    expect(pickMetagame(available, 'gen9championsvgc2026regm')).toBe('gen9championsvgc2026regmb');
  });

  it('해당 포맷이 없으면 null', () => {
    expect(pickMetagame(new Set(['gen9ou']), 'gen9championsbssregm')).toBeNull();
  });

  it('지난달부터 거슬러 올라간다 (이번 달 통계는 아직 미확정)', () => {
    const months = recentMonths(3, new Date(Date.UTC(2026, 0, 15)));
    expect(months).toEqual(['2025-12', '2025-11', '2025-10']);
  });
});
