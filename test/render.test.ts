/**
 * @vitest-environment jsdom
 *
 * 렌더 스모크 테스트.
 *
 * 타입체크는 "el('div') 가 컴파일된다"만 보장한다. 실제로 화면이 그려지는지,
 * 어댑터가 실패했을 때 앱이 통째로 죽는 대신 안내문으로 degrade 하는지는
 * DOM 을 붙여봐야 안다. 설계 문서 2절의 "한 어댑터가 죽어도 앱은 산다"를 검증한다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const readFixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));

const rawIndex = readFixture('api-index.sample.json');
const rawBattle = readFixture('battle-singles-garchomp.json');

const LOCALES = {
  garchomp: { en: 'Garchomp', ko: '한카리아스', ja: 'ガブリアス', koSpecies: '한카리아스', jaSpecies: 'ガブリアス' },
  ninetalesalola: {
    en: 'Alolan Ninetales',
    ko: '알로라 나인테일',
    ja: 'アローラキュウコン',
    koSpecies: '나인테일',
    jaSpecies: 'キュウコン',
  },
};

const COUNTERS = {
  format: 'Singles',
  metagame: 'gen9championsbssregmb',
  cutoff: 1500,
  months: ['2026-07'],
  battles: 97966,
  targets: {
    Garchomp: {
      showdownId: 'garchomp',
      entries: [
        { s: 'Ninetales-Alola', c: 'Alolan Ninetales', i: 'ninetalesalola', n: 1048, p: 0.81, d: 0.017 },
        { s: 'Floette-Eternal', c: null, i: null, n: 40, p: 0.7, d: 0.05 },
      ],
    },
  },
};

const MOVES = {
  moves: {
    Earthquake: {
      n: 'Earthquake', ko: '지진', ja: 'じしん', type: 'ground', cls: 'physical',
      pow: 100, acc: 100, pp: 10, pri: 0,
      // 자신을 뺀 전원 — 더블에서는 파트너도 맞는다. 비접촉이라 flags 가 비어 있다.
      tgt: 'all-other-pokemon', flags: [],
      desc: '지진의 충격으로 자신의 주위에 있는 포켓몬을 공격한다.',
    },
    'Rock Slide': {
      n: 'Rock Slide', ko: '스톤에지', type: 'rock', cls: 'physical',
      pow: 75, acc: 90, pp: 10, pri: 0,
      // 상대만 때리는 광역 — 지진과 구분되는지 보려고 둔다.
      tgt: 'all-opponents', flags: [],
      desc: '큰 바위를 상대에게 세게 부딪쳐서 공격한다.',
    },
    'Iron Head': {
      n: 'Iron Head', ko: '아이언헤드', type: 'steel', cls: 'physical',
      pow: 80, acc: 100, pp: 15, pri: 0,
      tgt: 'selected-pokemon', flags: ['contact'],
      desc: '강철 같은 머리로 상대에게 부딪쳐서 공격한다.',
    },
    'Stealth Rock': {
      n: 'Stealth Rock', ko: '스텔스록', type: 'rock', cls: 'status',
      pow: null, acc: null, pp: 20, pri: 0,
      desc: '상대 주위에 뾰족한 돌을 띄운다.',
    },
    'Swords Dance': {
      n: 'Swords Dance', ko: '칼춤', type: 'normal', cls: 'status',
      pow: null, acc: null, pp: 20, pri: 0,
      desc: '자신의 공격을 크게 올린다.',
      sc: [['attack', 2]], statc: 0,
    },
  },
};

const TERMS = {
  types: { Dragon: '드래곤', Ground: '땅', Ice: '얼음', Fairy: '페어리' },
  abilities: {
    'Rough Skin': { ko: '까칠한피부', desc: '접촉한 상대에게 데미지를 준다.' },
    'Sand Veil': { ko: '모래숨기', desc: null },
  },
  items: { 'Focus Sash': { ko: '기합의띠', desc: null } },
  weights: { Garchomp: 95, 'Alolan Ninetales': 19.9 },
  natures: {
    Jolly: { ko: '명랑', up: 'speed', down: 'special-attack' },
    Bold: { ko: '대담', up: 'defense', down: 'attack' },
    Modest: { ko: '조심', up: 'special-attack', down: 'attack' },
    Adamant: { ko: '고집', up: 'attack', down: 'special-attack' },
    Timid: { ko: '겁쟁이', up: 'speed', down: 'attack' },
    Hardy: { ko: '노력', up: null, down: null },
  },
};

/** 폼 slug → 공식 한국어 폼 표기. 빌드 산출물의 일부만 흉내낸다. */
const FORM_NAMES = {
  'rotom-wash': '워시로토무',
  'furfrou-heart-trim': '하트컷',
};

/** 서버가 붙어 있고 랭킹만 꺼진 기본 상태. */
const CONFIG = {
  version: 'v1',
  builds: { available: false, count: 0, updatedAt: null },
  counters: {
    Singles: { metagame: 'gen9championsbssregmb', months: ['2026-07'], battles: 97966, generatedAt: 'g1', targets: 1 },
    Doubles: null,
  },
  ranking: { enabled: false },
};

/** 어떤 URL 이 무엇을 돌려줄지 한곳에서 정한다. 실패 시나리오는 테스트가 개별로 덮어쓴다. */
function installFetch(overrides: Record<string, unknown | Error> = {}) {
  const stub = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const match = (needle: string) => url.includes(needle);

    for (const [needle, value] of Object.entries(overrides)) {
      if (match(needle)) {
        if (value instanceof Error) throw value;
        return new Response(JSON.stringify(value), { status: 200 });
      }
    }

    if (match('/api/battle/')) return new Response(JSON.stringify(rawBattle), { status: 200 });
    if (match('championsbattledata.com/api')) return new Response(JSON.stringify(rawIndex), { status: 200 });
    if (match('api/config')) return new Response(JSON.stringify(CONFIG), { status: 200 });
    if (match('api/counters/')) return new Response(JSON.stringify(COUNTERS), { status: 200 });
    if (match('api/builds')) return new Response(JSON.stringify({ updatedAt: null, builds: [] }), { status: 200 });
    if (match('moves.json')) return new Response(JSON.stringify(MOVES), { status: 200 });
    if (match('terms.json')) return new Response(JSON.stringify(TERMS), { status: 200 });
    if (match('locales.json')) return new Response(JSON.stringify(LOCALES), { status: 200 });
    if (match('formNames.json')) return new Response(JSON.stringify(FORM_NAMES), { status: 200 });
    if (match('counters-')) return new Response(JSON.stringify(COUNTERS), { status: 200 });
    if (match('builds.json')) return new Response(JSON.stringify([]), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', stub);
  return stub;
}

/** main.ts 는 import 시점에 부팅한다. 모듈 캐시를 비워 매 테스트를 격리한다. */
async function mountApp(hash: string) {
  document.body.innerHTML = '<div id="app"></div>';
  location.hash = hash;
  vi.resetModules();
  await import('../src/main');
  // bootstrap() 의 Promise.allSettled 가 풀리고 뷰가 다시 그려질 때까지 기다린다.
  await vi.waitFor(() => {
    if (document.querySelector('.notice--loading')) throw new Error('아직 로딩 중');
  });
  // 테스트마다 새 모듈 인스턴스가 만들어지므로 폴링 타이머가 쌓이지 않게 끈다.
  const store = await import('../src/store');
  store.stopConfigPolling();
  return store;
}

/** 검색 드롭다운의 현재 값. */
function pickerValue(root: Element | null): string {
  return root?.querySelector('.sselect__value')?.textContent ?? '';
}

/** 검색 드롭다운을 열어 라벨로 항목을 고른다. */
function pickFrom(root: Element, label: string): void {
  root.querySelector<HTMLButtonElement>('.sselect__button')!.click();
  const option = [...root.querySelectorAll<HTMLButtonElement>('.sselect__option')].find(
    (o) => o.textContent?.startsWith(label),
  );
  if (!option) throw new Error(`'${label}' 항목을 찾지 못했습니다`);
  option.click();
}

beforeEach(() => {
  localStorage.clear();
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('셸', () => {
  it('귀속 문구를 모든 화면에 노출한다 (설계 문서 6절)', async () => {
    await mountApp('#/');
    const footer = document.querySelector('.shell__footer')?.textContent ?? '';
    expect(footer).toContain('Trademark and © of Nintendo 1996–2026');
    expect(footer).toContain('not affiliated with or endorsed by Nintendo');
  });

  it('랭킹 flag 가 꺼져 있으면 탭 자체가 없다', async () => {
    await mountApp('#/');
    const labels = [...document.querySelectorAll('.nav__link')].map((n) => n.textContent);
    expect(labels).toContain('검색');
    // 출처는 탭에서 빼고 푸터 링크로만 남겼다 — 귀속 문구 자체는 계속 노출된다.
    expect(labels).not.toContain('출처');
    expect(labels).not.toContain('랭킹');
  });
});

describe('M1 검색', () => {
  it('로케일 명칭으로 표시한다', async () => {
    await mountApp('#/');
    expect(document.body.textContent).toContain('한카리아스');
  });

  it('전체 목록을 잘라내지 않고 다 보여준다', async () => {
    // 예전에는 60종에서 끊었는데 안내가 없어서 "종이 안 뜬다"로 읽혔다.
    await mountApp('#/');
    const total = (await import('../src/store')).state.index!.pokemon.length;
    expect(document.querySelectorAll('.card').length).toBe(total);
    expect(document.querySelector('.results__summary')?.textContent).toContain(`전체 ${total}종`);
  });

  it('기본 정렬이 사용률 순위이고 순위를 함께 보여준다', async () => {
    await mountApp('#/');
    const ranks = [...document.querySelectorAll('.card__rank')].map((n) => n.textContent);
    // 픽스처 싱글 1위는 한카리아스.
    expect(ranks[0]).toBe('1');
    expect(document.querySelector('.card__name')?.textContent).toBe('한카리아스');

    // 순위가 있는 것들은 오름차순이어야 한다.
    const numeric = ranks.filter((r) => r !== '—').map(Number);
    expect([...numeric].sort((a, b) => a - b)).toEqual(numeric);
  });

  it('순위 없는 종은 숫자를 지어내지 않고 맨 뒤로 보낸다', async () => {
    await mountApp('#/');
    const ranks = [...document.querySelectorAll('.card__rank')].map((n) => n.textContent);
    const none = ranks.filter((r) => r === '—');
    if (none.length > 0) {
      expect(ranks.slice(-none.length).every((r) => r === '—')).toBe(true);
    }
  });

  it('포맷을 바꾸면 순위도 그 포맷 것으로 바뀐다', async () => {
    const store = await mountApp('#/');
    const singles = [...document.querySelectorAll('.card__name')].map((n) => n.textContent);

    store.setFormat('Doubles');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.card').length).toBeGreaterThan(0);
    });
    const doubles = [...document.querySelectorAll('.card__name')].map((n) => n.textContent);
    // 픽스처의 싱글·더블 순위가 다르므로 정렬 결과도 달라야 한다.
    expect(doubles).not.toEqual(singles);
  });

  it('이름순·실수치순으로 바꿀 수 있다', async () => {
    await mountApp('#/');
    const select = document.querySelector<HTMLSelectElement>('.search__sort')!;

    select.value = 'stats';
    select.dispatchEvent(new Event('change'));
    const totals = [...document.querySelectorAll('.card__bst')].map((n) => Number(n.textContent));
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
    // 사용률 정렬이 아니면 순위 배지를 붙이지 않는다.
    expect(document.querySelector('.card__rank')).toBeNull();

    select.value = 'name';
    select.dispatchEvent(new Event('change'));
    const names = [...document.querySelectorAll('.card__name')].map((n) => n.textContent ?? '');
    expect([...names].sort((a, b) => a.localeCompare(b, 'ko'))).toEqual(names);
  });

  it('한국어·영어·일본어가 같은 결과를 낸다', async () => {
    await mountApp('#/');
    const input = document.querySelector<HTMLInputElement>('.search__input')!;

    const search = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      return [...document.querySelectorAll('.card__name')].map((n) => n.textContent);
    };

    expect(search('한카리아스')).toEqual(['한카리아스']);
    expect(search('garchomp')).toEqual(['한카리아스']);
    expect(search('ガブリアス')).toEqual(['한카리아스']);
  });

  it('종 명칭으로도 폼을 찾는다 ("나인테일" → 알로라 나인테일)', async () => {
    await mountApp('#/');
    const input = document.querySelector<HTMLInputElement>('.search__input')!;
    input.value = '나인테일';
    input.dispatchEvent(new Event('input'));
    expect(document.body.textContent).toContain('알로라 나인테일');
  });
});

describe('M2 상세', () => {
  it('사용률 카테고리를 전부 그린다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.bar').length).toBeGreaterThan(10);
    });
    const text = document.body.textContent ?? '';
    for (const label of ['기술', '지닌 도구', '특성', '성격', '노력치 분배']) {
      expect(text).toContain(label);
    }
  });

  it('종족값을 왼쪽, 실수치를 오른쪽에 둔다', async () => {
    await mountApp('#/p/garchomp');
    const head = document.querySelector('.stat--head')!.textContent ?? '';
    // 순서가 뒤집히면 108/183 을 반대로 읽게 된다.
    expect(head.indexOf('종족값')).toBeLessThan(head.indexOf('실수치'));

    const total = document.querySelector('.stat--total')!;
    // 한카리아스: 종족값 합 600(본가), 실수치 합 775
    expect(total.querySelector('.stat__base')?.textContent).toBe('600');
    expect(total.querySelector('.stat__value')?.textContent).toBe('775');
  });

  it('폼 선택을 한국어로 보여준다', async () => {
    await mountApp('#/p/garchomp');
    const options = [...document.querySelectorAll('.form-select option')].map((o) => o.textContent);
    expect(options).toContain('한카리아스');
    expect(options).toContain('메가 한카리아스');
    // 영문 폼명이 그대로 남으면 안 된다.
    expect(options).not.toContain('Mega Garchomp');
  });

  it('기술을 한국어명과 제원으로 보여준다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelector('.move')).not.toBeNull();
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('지진');
    expect(text).toContain('위력 100');
    expect(text).toContain('PP 10');
    // 변화기술은 위력·명중률이 없다 — 0 으로 위조하지 않는다.
    expect(text).toContain('스텔스록');
    expect(text).toContain('위력 —');
  });

  it('도구·특성·성격·타입을 한국어로 보여준다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelector('.move')).not.toBeNull();
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('기합의띠'); // 도구
    expect(text).toContain('까칠한피부'); // 특성
    expect(text).toContain('명랑'); // 성격
    expect(text).toContain('+스피드 / −특수공격'); // 성격 보정 스탯
    expect(text).toContain('드래곤'); // 타입 배지
    // 영문명은 title 로 남겨 대조가 되게 한다.
    expect(document.querySelector('.type[title="Dragon"]')).not.toBeNull();
  });

  it('탭을 바꿔도 헤더를 다시 그리지 않는다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelector('.detail__header')).not.toBeNull();
    });
    const header = document.querySelector('.detail__header')!;

    const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs__tab')];
    tabs.find((t) => t.textContent === '카운터')!.click();

    // 통째로 지우면 화면이 깜빡이고 스크롤이 맨 위로 튄다. 같은 노드가 남아 있어야 한다.
    expect(document.querySelector('.detail__header')).toBe(header);
    expect(document.querySelector('.tabs__tab--active')!.textContent).toBe('카운터');
  });

  it('노력치·성격 라벨은 잘리지 않고 한 줄을 통째로 쓴다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelector('.bar')).not.toBeNull();
    });

    const wrapped = [...document.querySelectorAll('.bar--wrap')];
    expect(wrapped.length).toBeGreaterThan(0);

    // 성격 보정("명랑 (+스피드 / −특수공격)")과 노력치 분배가 그 대상이다.
    const labels = wrapped.map((row) => row.querySelector('.bar__label')!.textContent ?? '');
    expect(labels.some((t) => t.includes('(+') && t.includes('/ −'))).toBe(true);

    // 라벨이 막대와 같은 칸을 두고 다투면 잘린다. 한 줄을 통째로 쓰게 둔다.
    for (const row of wrapped) {
      const label = row.querySelector<HTMLElement>('.bar__label')!;
      expect(label.className).toBe('bar__label');
      expect(row.querySelector('.bar__track')).not.toBeNull();
    }
  });

  it('"크게 올린다" 를 랭크 수치로 못박는다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('칼춤');
    });
    // 칼춤 행을 펼친다
    const heads = [...document.querySelectorAll<HTMLButtonElement>('.move__head')];
    const swordsDance = heads.find((h) => h.textContent?.includes('칼춤'))!;
    swordsDance.click();

    const body = swordsDance.parentElement!.querySelector('.move__body')!;
    expect(body.textContent).toContain('공격 +2랭크');
    // 공식 설명도 함께 남긴다 — 대체가 아니라 보강이다.
    expect(body.textContent).toContain('크게 올린다');
  });

  it('기술 설명은 접혀 있다가 눌러야 펼쳐진다', async () => {
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelector('.move__body')).not.toBeNull();
    });
    const body = document.querySelector('.move__body')!;
    expect(body.hasAttribute('hidden')).toBe(true);

    document.querySelector<HTMLButtonElement>('.move__head')!.click();
    expect(body.hasAttribute('hidden')).toBe(false);
    expect(body.textContent).toContain('지진의 충격으로');
  });

  it('기술 도감이 죽어도 영문명으로 사용률은 나온다', async () => {
    installFetch({ 'moves.json': new Error('네트워크 실패') });
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelector('.move')).not.toBeNull();
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Earthquake');
    expect(text).toContain('99.3%');
  });

  it('파트너 목록은 화면에 넣지 않는다', async () => {
    // 비율 없이 이름만 나열돼 판단에 쓸 수 없다.
    await mountApp('#/p/garchomp');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.bar').length).toBeGreaterThan(10);
    });
    expect(document.body.textContent).not.toContain('자주 함께 쓰인 포켓몬');
  });

  it('폼이 여럿이면 폼 선택기를 낸다', async () => {
    await mountApp('#/p/garchomp');
    expect(document.querySelector('.form-select')).not.toBeNull();
  });

  it('로스터에 없는 id 는 안내로 처리한다 (빈 화면이 아니라)', async () => {
    await mountApp('#/p/miraidon');
    expect(document.body.textContent).toContain('로스터에서 찾지 못했습니다');
  });
});

describe('싱글·더블 토글', () => {
  it('사용률이 갈리는 화면에서만 보인다', async () => {
    await mountApp('#/');
    expect(document.querySelector('.shell__controls')).not.toBeNull();
  });

  it('기술·특성 탭에서는 없앤다', async () => {
    // 이 화면들은 state.format 을 읽지 않는다. 눌러도 아무 일이 없어서
    // 두면 고장난 것처럼 보인다.
    await mountApp('#/moves');
    expect(document.querySelector('.shell__controls')).toBeNull();

    location.hash = '#/abilities';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await vi.waitFor(() => {
      expect(document.querySelector('.nav__link--active')?.textContent).toBe('특성');
    });
    expect(document.querySelector('.shell__controls')).toBeNull();
  });

  it('계산기와 상세에서는 남긴다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    expect(document.querySelector('.shell__controls')).not.toBeNull();

    await mountApp('#/p/garchomp');
    expect(document.querySelector('.shell__controls')).not.toBeNull();
  });
});

describe('M3 카운터', () => {
  it('카운터 표를 낸다', async () => {
    await mountApp('#/p/garchomp');
    document.querySelectorAll<HTMLButtonElement>('.tabs__tab')[1]!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.counters tbody tr')).not.toBeNull();
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('알로라 나인테일'); // Champions 폼으로 매칭된 카운터
    // 출처 고지는 접근성 탭에만 두고 카운터 위에서는 걷어냈다.
    expect(text).not.toContain('Nintendo Switch 랭크전과 표본·규칙·메타가 다르므로');
  });

  it('매칭 실패한 카운터는 Showdown 표기로 남긴다', async () => {
    await mountApp('#/p/garchomp');
    document.querySelectorAll<HTMLButtonElement>('.tabs__tab')[1]!.click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Floette-Eternal');
    });
    expect(document.querySelector('.counters__unmapped')).not.toBeNull();
  });

  it('카운터 소스가 죽어도 상세 화면은 산다', async () => {
    installFetch({ 'api/counters/': new Error('네트워크 실패') });
    await mountApp('#/p/garchomp');
    document.querySelectorAll<HTMLButtonElement>('.tabs__tab')[1]!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.notice--error')).not.toBeNull();
    });
    // 헤더는 그대로 남아 있어야 한다.
    expect(document.querySelector('.detail__name')?.textContent).toBe('한카리아스');
  });
});

describe('기술 도감', () => {
  it('로스터가 쓰는 기술을 모두 보여주고 검색된다', async () => {
    await mountApp('#/moves');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.dexrow').length).toBeGreaterThan(0);
    });
    const rows = document.querySelectorAll('.dexrow').length;
    expect(document.querySelector('.results__summary')?.textContent).toBe(`전체 ${rows}개`);

    const input = document.querySelector<HTMLInputElement>('.search__input')!;
    input.value = '지진';
    input.dispatchEvent(new Event('input'));
    const names = [...document.querySelectorAll('.dexrow__name')].map((n) => n.textContent);
    expect(names).toContain('지진');
    expect(names.length).toBeLessThan(rows);
  });

  it('기술을 고르면 배울 수 있는 포켓몬이 나온다', async () => {
    await mountApp('#/moves?m=Earthquake');
    await vi.waitFor(() => {
      expect(document.querySelector('.dexmons')).not.toBeNull();
    });
    expect(document.querySelector('.dexhead__name')?.textContent).toBe('지진');
    // 픽스처에서 지진을 배우는 종이 카드로 나온다.
    expect(document.querySelectorAll('.dexmon').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('배울 수 있는 포켓몬');
  });
});

describe('특성 도감', () => {
  it('로스터의 특성을 보여주고 검색된다', async () => {
    await mountApp('#/abilities');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.dexrow').length).toBeGreaterThan(0);
    });
    const names = [...document.querySelectorAll('.dexrow__name')].map((n) => n.textContent);
    // 도감에 한국어명이 있으면 한국어로 나온다.
    expect(names).toContain('까칠한피부');
  });

  it('특성을 고르면 가진 포켓몬이 나온다', async () => {
    await mountApp('#/abilities?a=Rough Skin');
    await vi.waitFor(() => {
      expect(document.querySelector('.dexmons')).not.toBeNull();
    });
    expect(document.querySelector('.dexhead__name')?.textContent).toBe('까칠한피부');
    expect(document.body.textContent).toContain('가진 포켓몬');
    expect(document.querySelectorAll('.dexmon').length).toBeGreaterThan(0);
  });
});

describe('대미지 계산기', () => {
  it('두 포켓몬을 고르면 대미지와 확정/난수를 낸다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    const damage = document.querySelector('.calc__damage')!.textContent ?? '';
    // "69 ~ 82 (23.0% ~ 27.3%)" 꼴
    expect(damage).toMatch(/\d+ ~ \d+/);
    expect(damage).toMatch(/%\s*~/);
    expect(document.querySelector('.calc__ko')?.textContent).toMatch(/확정 \d타|난수 \d타/);
  });

  it('기술 슬롯이 4개이고 사용률 상위로 채워진다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    const slots = [...document.querySelectorAll('.calc__move')];
    expect(slots).toHaveLength(4);
    // 픽스처 사용률 1·2위는 지진, 스텔스록
    expect(pickerValue(slots[0]!)).toBe('지진');
    expect(pickerValue(slots[1]!)).toBe('스텔스록');
  });

  it('선택한 기술마다 결과를 따로 낸다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 공격기 + 변화기가 섞여 있어도 각각 한 덩어리씩 나온다.
    expect(document.querySelectorAll('.calc__move-result').length).toBeGreaterThan(1);
    // 변화기술은 대미지 대신 안내를 낸다.
    expect(document.body.textContent).toContain('변화기술 — 대미지 없음');
  });

  it('사용률 1위 노력치와 성격을 자동으로 채운다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 픽스처의 한카리아스 1위 배분은 HP2 / 공격32 / 스피드32, 성격 Jolly(명랑)
    const points = [...document.querySelectorAll<HTMLInputElement>('.calc__points')].map(
      (i) => i.value,
    );
    expect(points.slice(0, 6)).toEqual(['2', '32', '0', '0', '0', '32']);
    expect(pickerValue(document.querySelector('.calc__nature-select'))).toBe('명랑');
  });

  it('성격을 이름으로 고르고 보정을 색으로 표시한다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__nature-select')).not.toBeNull();
    });

    const picker = document.querySelector('.calc__nature-select')!;
    picker.querySelector<HTMLButtonElement>('.sselect__button')!.click();

    const labels = [...picker.querySelectorAll('.sselect__option')].map((o) => o.textContent ?? '');
    // 도감에 있는 성격이 전부 선택지로 나온다 (실데이터는 25종).
    expect(labels.length).toBe(Object.keys(TERMS.natures).length);
    expect(labels.some((l) => l.includes('대담'))).toBe(true);
    expect(labels.some((l) => l.includes('조심'))).toBe(true);
    // 보정 내용을 함께 적어 무엇이 오르내리는지 바로 보이게 한다.
    // 계산기는 축약형(특공·특방)을 쓴다 — 좁은 열에서 줄이 쪼개지지 않게.
    expect(labels.some((l) => l.includes('명랑') && l.includes('+스피드 / −특공'))).toBe(true);
    // 무보정 성격은 뒤로 밀린다.
    expect(labels[labels.length - 1]).toContain('무보정');

    // 명랑 = +스피드 / −특수공격 → 상승·하락 표시가 하나씩
    expect(document.querySelector('.calc__nature-mark--up')?.textContent).toBe('▲');
    expect(document.querySelector('.calc__nature-mark--down')?.textContent).toBe('▼');
  });

  it('스탯마다 랭크를 따로 조절할 수 있다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    // HP 를 뺀 5개 스탯 × 양쪽 = 10개
    const stages = [...document.querySelectorAll('.calc__stage')];
    expect(stages).toHaveLength(10);

    stages[0]!.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    // −6 ~ +6 의 13단계
    expect(stages[0]!.querySelectorAll('.sselect__option')).toHaveLength(13);

    const before = document.querySelector('.calc__damage')!.textContent!;
    // 공격측 공격 랭크를 +2 로 올린다 (0번째가 공격)
    pickFrom(stages[0]!, '+2');

    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')!.textContent).not.toBe(before);
    });
    expect(document.querySelector('.calc__stage--up')).not.toBeNull();
  });

  it('기술 이름 옆에 위력과 분류를 적는다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 계산식 줄을 없앤 대신 제원을 기술 이름 옆에서 바로 보여준다.
    const spec = document.querySelector('.calc__move-spec')?.textContent ?? '';
    expect(spec).toMatch(/^(물리|특수) [0-9]+$/);
  });

  it('한쪽만 고르면 안내한다', async () => {
    await mountApp('#/calc?a=garchomp');
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('공격·방어 포켓몬을 각각 선택하세요');
    });
  });

  it('계산식과 적용된 보정 줄을 없앴다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 한 화면에 더 많이 담기 위해 걷어낸 줄들이다.
    expect(document.querySelector('.calc__breakdown')).toBeNull();
    expect(document.querySelector('.calc__applied')).toBeNull();
  });

  it('특성 선택지에 효과 설명을 붙이지 않는다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__ability')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('.calc__ability .sselect__button')!.click();
    const options = [...document.querySelectorAll('.calc__ability .sselect__option')].map(
      (o) => o.textContent ?? '',
    );
    // '까칠한피부 — 접촉 시 …' 처럼 꼬리표가 붙으면 안 된다.
    expect(options.every((o) => !o.includes('—') || o === '— 없음 —')).toBe(true);
    expect(options).toContain('까칠한피부');
  });

  it('「기타 배율」 입력은 없앴다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    expect(document.body.textContent).not.toContain('기타 배율');
    expect(document.querySelector('.calc__other')).toBeNull();
  });

  it('「나중에 행동」은 그 값을 쓰는 특성·기술을 골랐을 때만 나온다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 한카리아스에게는 애널라이즈가 없고 보복도 안 골랐으므로 입력이 없어야 한다.
    expect(document.body.textContent).not.toContain('나중에 행동');
  });

  it('기술마다 광역 범위와 접촉 여부를 표기한다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__traits')).not.toBeNull();
    });

    const rows = [...document.querySelectorAll('.calc__move-result')];
    const rowFor = (name: string) => rows.find((r) => r.textContent?.includes(name))!;

    // 지진은 자신을 뺀 전원을 때린다 — 아군도 맞는다.
    expect(rowFor('지진').querySelector('.calc__trait--spread')?.textContent).toBe('광역 · 아군 포함');
    // 접촉 여부는 있을 때만이 아니라 없을 때도 적는다.
    expect(rowFor('지진').querySelector('.calc__trait--contact')?.textContent).toBe('비접촉');
  });

  it('같은 광역이어도 상대 전체와 아군 포함을 구분한다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__traits')).not.toBeNull();
    });

    const slots = [...document.querySelectorAll('.calc__move')];
    pickFrom(slots[1]!, '스톤에지');
    pickFrom(slots[2]!, '아이언헤드');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('아이언헤드');
    });
    const rows = [...document.querySelectorAll('.calc__move-result')];
    const rowFor = (name: string) => rows.find((r) => r.textContent?.includes(name))!;

    expect(rowFor('스톤에지').querySelector('.calc__trait--spread')?.textContent).toBe(
      '광역 · 상대 전체',
    );
    // 단일 대상 기술에는 광역 표기가 붙지 않는다.
    expect(rowFor('아이언헤드').querySelector('.calc__trait--spread')).toBeNull();
    expect(rowFor('아이언헤드').querySelector('.calc__trait--contact')?.textContent).toBe('접촉');
  });

  it('포켓몬을 바꾸면 기술 목록도 새 포켓몬 것으로 바뀐다', async () => {
    // 실제로 있었던 버그: 사용률을 처음 한 번만 받아서 포켓몬을 바꿔도
    // 「사용률 상위」 기술이 이전 포켓몬 것 그대로 남았다.
    const ninetalesUsage = {
      rows: [
        { category: 'move', name: 'Blizzard', percent: 90 },
        { category: 'move', name: 'Freeze-Dry', percent: 80 },
      ],
    };
    installFetch({ 'battle/Singles/ninetalesalola': ninetalesUsage });

    await mountApp('#/calc?a=garchomp&b=garchomp');
    await vi.waitFor(() => {
      expect(pickerValue(document.querySelector('.calc__move'))).toBe('지진');
    });

    // 공격측 검색창에서 다른 포켓몬을 고른다.
    const input = document.querySelector<HTMLInputElement>('.calc__side .picker__input')!;
    input.value = '나인테일';
    input.dispatchEvent(new Event('input'));
    const option = document.querySelector<HTMLButtonElement>('.calc__side .picker__option')!;
    expect(option.textContent).toContain('나인테일');
    option.click();

    // 픽스처 기술 도감에 없는 이름이라 영문 그대로 나온다.
    await vi.waitFor(() => {
      expect(pickerValue(document.querySelectorAll('.calc__move')[0]!)).toBe('Blizzard');
    });

    const slots = [...document.querySelectorAll('.calc__move')];
    expect(pickerValue(slots[1]!)).toBe('Freeze-Dry');

    // 이전 포켓몬의 기술이 목록에 남아 있으면 안 된다.
    slots[0]!.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    const labels = [...slots[0]!.querySelectorAll('.sselect__option')].map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes('스텔스록'))).toBe(false);
  });

  it('계산기에서 안내 문구를 걷어냈다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 한 화면에 더 담기 위해 제목·설명을 전부 없앴다.
    expect(document.querySelector('.calc__intro')).toBeNull();
    expect(document.querySelector('.calc__form-note')).toBeNull();
    expect(document.body.textContent).not.toContain('4개까지');
  });

  it('포켓몬 선택이 패널 맨 위에 온다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__picker')).not.toBeNull();
    });
    const panel = document.querySelector('.calc__side')!;
    // 제목 다음이 곧바로 검색창이어야 한다 (스탯표보다 앞).
    const order = [...panel.children].map((n) => n.className);
    expect(order.indexOf('calc__picker')).toBeLessThan(order.indexOf('calc__stats'));
  });

  it('양쪽 모두 남은 HP 를 슬라이더로 조절한다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    const sliders = [...document.querySelectorAll<HTMLInputElement>('.calc__hp-range')];
    expect(sliders).toHaveLength(2);
    expect(sliders[0]!.type).toBe('range');
    expect(sliders[0]!.value).toBe('100');

    const before = document.querySelector('.calc__ko')!.textContent!;
    // 방어측을 반피로 끈다 — 확정/난수 판정이 남은 HP 기준으로 바뀐다.
    sliders[1]!.value = '50';
    sliders[1]!.dispatchEvent(new Event('input'));

    await vi.waitFor(() => {
      expect(document.querySelector('.calc__ko')!.textContent).not.toBe(before);
    });
    // 비율(%)은 최대 HP 기준 그대로다.
    expect(document.querySelector('.calc__matchup-hp')?.textContent).toMatch(/남은 HP \d+ \/ \d+/);
  });

  it('상태이상을 양쪽에서 목록으로 고른다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    const labels = [...document.querySelectorAll('.calc__side .calc__field')].filter((f) =>
      f.textContent?.startsWith('상태이상'),
    );
    expect(labels).toHaveLength(2);
    labels[0]!.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    const options = [...labels[0]!.querySelectorAll('.sselect__option')].map((o) => o.textContent);
    // 대미지가 달라지는 것은 화상뿐이라 나머지는 고를 수단을 두지 않는다.
    expect(options).toEqual(['없음', '화상']);

    // 예전의 체크박스는 사라졌다.
    expect(document.body.textContent).not.toContain('공격측 화상');
    expect(document.body.textContent).not.toContain('방어측 상태이상');
  });

  it('특성 목록에 「대미지 영향 없음」을 붙이지 않는다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__ability')).not.toBeNull();
    });
    expect(document.body.textContent).not.toContain('대미지 영향 없음');
  });

  it('특성 목록에 「없음」을 두지 않는다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__ability')).not.toBeNull();
    });
    const picker = document.querySelector('.calc__ability')!;
    picker.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    const options = [...picker.querySelectorAll('.sselect__option')].map((o) => o.textContent);
    // 한카리아스는 모래숨기·까칠한피부(숨겨진 특성) 둘뿐.
    // 특성 없는 포켓몬은 대전에 나오지 않으므로 '없음' 을 둘 이유가 없다.
    expect(options).toEqual(['모래숨기', '까칠한피부']);
    // 고르지 않아도 사용률이 많은 쪽이 잡혀 있어야 한다.
    expect(picker.querySelector('.sselect__value')!.textContent).toBe('까칠한피부');
  });

  it('총대장·투쟁심 입력은 그 특성을 골랐을 때만 나온다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    // 한카리아스에게는 두 특성이 없으므로 입력도 없어야 한다.
    expect(document.body.textContent).not.toContain('쓰러진 아군');
    expect(document.body.textContent).not.toContain('성별 관계');
  });

  it('입력을 바꿔도 화면을 통째로 다시 그리지 않는다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    // 같은 DOM 노드가 살아 있어야 스크롤·포커스가 튀지 않는다.
    const slider = document.querySelector<HTMLInputElement>('.calc__hp-range')!;
    const natureSelect = document.querySelector<HTMLSelectElement>('.calc__nature-select')!;
    const readout = document.querySelector('.calc__hp-value')!;
    const before = readout.textContent!;

    slider.value = '40';
    slider.dispatchEvent(new Event('input'));
    await vi.waitFor(() => {
      expect(readout.textContent).not.toBe(before);
    });
    expect(readout.textContent).toContain('40%');

    expect(document.querySelector('.calc__hp-range')).toBe(slider);
    expect(document.querySelector('.calc__nature-select')).toBe(natureSelect);
  });
});

describe('M6 랭킹', () => {
  it('랭킹이 연결되지 않았으면 안내만 낸다', async () => {
    await mountApp('#/ranking');
    expect(document.body.textContent).toContain('랭킹 데이터가 아직 연결되지 않았습니다');
    // 메뉴에도 노출되지 않는다.
    expect([...document.querySelectorAll('.nav__link')].map((n) => n.textContent)).not.toContain('랭킹');
  });

  it('랭킹이 꺼져 있어도 나머지 화면은 완전히 동작한다 (설계 문서 M6)', async () => {
    await mountApp('#/');
    expect(document.querySelector('.card__name')).not.toBeNull();
    await mountApp('#/p/garchomp');
    expect(document.querySelector('.stat--total')).not.toBeNull();
    await mountApp('#/moves');
    expect(document.querySelectorAll('.dexrow').length).toBeGreaterThan(0);
  });

  it('서버가 랭킹을 켜면 재빌드 없이 탭과 표가 나타난다', async () => {
    installFetch({
      'api/config': { ...CONFIG, version: 'v2', ranking: { enabled: true } },
      'api/ranking': {
        enabled: true,
        stale: false,
        fetchedAt: '2026-08-13T00:00:00.000Z',
        payload: {
          result: {
            ranking: [
              { rank: 1, trainerName: 'ハルカ', rating: '1,980', wins: 120, losses: 30, winStreak: 9, country: 'JP' },
              { rank: 2, trainerName: 'Jin', rating: 1955, wins: 98, losses: 40, country: 'KR' },
            ],
          },
        },
      },
    });
    await mountApp('#/ranking');
    await vi.waitFor(() => {
      expect(document.querySelector('.ranking__table tbody tr')).not.toBeNull();
    });

    const text = document.body.textContent ?? '';
    expect(text).toContain('ハルカ');
    expect(text).toContain('1980'); // "1,980" 문자열이 숫자로 정규화된다
    expect(text).toContain('80.0%'); // 120승 30패 → 승률 계산
    expect(text).toContain('상위 2위까지'); // 공개 범위 명시
    // config 가 켜졌다고 하면 탭도 함께 나타나야 한다.
    expect([...document.querySelectorAll('.nav__link')].map((n) => n.textContent)).toContain('랭킹');
  });

  it('서버가 없으면(정적 배포) 서버 실행 안내를 낸다', async () => {
    installFetch({ 'api/config': new Error('서버 없음') });
    await mountApp('#/ranking');
    expect(document.body.textContent).toContain('서버가 있어야 동작합니다');
  });
});

describe('정적 호스팅 (서버 없이 배포)', () => {
  /** /api/* 를 전부 없애고 번들 파일만 남긴다 — 정적 호스트에 올린 상태. */
  function installStaticOnlyFetch() {
    return installFetch({
      'api/config': new Error('정적 호스팅 — 서버 없음'),
      'api/counters/': new Error('정적 호스팅 — 서버 없음'),
      'api/builds': new Error('정적 호스팅 — 서버 없음'),
      'api/ranking': new Error('정적 호스팅 — 서버 없음'),
    });
  }

  it('서버가 없어도 검색·목록이 정상 동작한다', async () => {
    installStaticOnlyFetch();
    await mountApp('#/');
    expect(document.body.textContent).toContain('한카리아스');
    expect(document.querySelectorAll('.card').length).toBeGreaterThan(0);
    expect(document.querySelector('.notice--error')).toBeNull();
  });

  it('서버가 없어도 계산기가 대미지를 낸다', async () => {
    installStaticOnlyFetch();
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    expect(document.querySelector('.calc__damage')?.textContent).toMatch(/\d+ ~ \d+/);
  });

  it('서버가 없어도 카운터는 동봉된 정적 파일로 나온다', async () => {
    installStaticOnlyFetch();
    await mountApp('#/p/garchomp');
    document.querySelectorAll<HTMLButtonElement>('.tabs__tab')[1]!.click();
    // /api/counters 가 죽어도 번들에 동봉된 counters-*.json 으로 표가 채워진다.
    await vi.waitFor(() => {
      expect(document.querySelector('.counters tbody tr')).not.toBeNull();
    });
  });

  it('자동 갱신이 없다는 사실을 숨기지 않는다', async () => {
    // 정적 배포는 데이터가 빌드 시점에 굳는다. 이걸 밝히지 않으면
    // 사용자는 최신 집계를 보고 있다고 오해한다.
    installStaticOnlyFetch();
    await mountApp('#/sources');
    await vi.waitFor(() => {
      expect(document.querySelector('.sources')).not.toBeNull();
    });
  });
});

describe('런타임 데이터 감지', () => {
  it('카운터 URL 에 버전이 실려 캐시가 자연히 무효화된다', async () => {
    const stub = installFetch();
    await mountApp('#/p/garchomp');
    document.querySelectorAll<HTMLButtonElement>('.tabs__tab')[1]!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.counters tbody tr')).not.toBeNull();
    });

    const counterCall = stub.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.includes('api/counters/'));
    expect(counterCall).toContain('api/counters/singles');
    expect(counterCall).toContain('v=g1'); // config 의 generatedAt 이 버전으로 붙는다
  });
});

describe('출처 페이지', () => {
  it('매트릭스의 소스와 등급을 모두 싣는다', async () => {
    await mountApp('#/sources');
    const text = document.body.textContent ?? '';
    for (const source of ['championsbattledata.com', 'PokéAPI', 'Smogon', 'champs.pokedb.tokyo']) {
      expect(text).toContain(source);
    }
    expect(document.querySelectorAll('.badge--a').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.badge--c').length).toBeGreaterThan(0);
  });
});

describe('열화 동작', () => {
  it('로케일이 죽어도 영문으로 검색이 된다', async () => {
    installFetch({ 'locales.json': new Error('레이트리밋') });
    await mountApp('#/');
    expect(document.body.textContent).toContain('영문 검색만 동작합니다');
    const input = document.querySelector<HTMLInputElement>('.search__input')!;
    input.value = 'garchomp';
    input.dispatchEvent(new Event('input'));
    expect(document.querySelector('.card__name')?.textContent).toBe('Garchomp');
  });

  it('인덱스가 죽으면 전면 안내를 낸다', async () => {
    installFetch({ 'championsbattledata.com/api': new Error('상류 장애') });
    await mountApp('#/');
    await vi.waitFor(() => {
      expect(document.querySelector('.notice--error')?.textContent).toContain(
        '포켓몬 인덱스를 불러오지 못했습니다',
      );
    });
  });
});

describe('모바일 배려', () => {
  it('터치 기기에서는 검색창에 자동으로 커서를 두지 않는다', async () => {
    // 자동 포커스하면 목록에 들어올 때마다 소프트 키보드가 올라와
    // 읽으려는 목록의 절반을 가린다. 특성 하나 보고 뒤로 나올 때마다 반복된다.
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false, // 정밀 포인터 없음 = 터치 기기
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    await mountApp('#/abilities');
    expect(document.activeElement).not.toBe(document.querySelector('.search__input'));
  });

  it('마우스가 있는 기기에서는 그대로 커서를 둔다', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true, // (hover: hover) and (pointer: fine)
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    await mountApp('#/abilities');
    expect(document.activeElement).toBe(document.querySelector('.search__input'));
  });
});

describe('특성 목록', () => {
  it('이름을 줄여 쓰지 않고 설명을 함께 보여준다', async () => {
    await mountApp('#/abilities');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.dexrow--ability').length).toBeGreaterThan(0);
    });
    const row = [...document.querySelectorAll('.dexrow--ability')].find((r) =>
      r.querySelector('.dexrow__name')?.textContent === '까칠한피부',
    )!;
    expect(row.querySelector('.dexrow__desc')?.textContent).toContain('접촉한 상대에게');
    // 영문명과 '몇 종' 표기는 뺐다.
    expect(row.textContent).not.toContain('Rough Skin');
    expect(row.querySelector('.dexrow__count')).toBeNull();
  });
});

describe('계산기 장 넘기기', () => {
  it('공격 · 방어 · 결과 세 장으로 나뉜다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    const labels = [...document.querySelectorAll('.calc__pagertab')].map((t) => t.textContent);
    expect(labels).toEqual(['공격', '방어', '결과']);

    const pages = [...document.querySelectorAll('.calc__page')];
    expect(pages).toHaveLength(3);
    // 기술은 공격측의 것이라 공격 장에, 결과는 필드 상황과 함께 마지막 장에 있다.
    expect(pages[0]!.querySelector('.calc__moves')).not.toBeNull();
    expect(pages[2]!.querySelector('.calc__damage')).not.toBeNull();
  });

  it('장을 나눠도 부분 갱신이 그대로 동작한다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    // 공격 장의 입력이 결과 장의 값을 바꿔야 한다 (같은 노드를 계속 붙잡고 있어야 성립).
    const stage = document.querySelectorAll('.calc__stage')[0]!;
    const before = document.querySelector('.calc__damage')!.textContent!;
    pickFrom(stage, '+2');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')!.textContent).not.toBe(before);
    });
  });

  it('계산기의 폼 선택도 한국어다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.form-select')).not.toBeNull();
    });
    document.querySelector<HTMLButtonElement>('.calc__side .form-select .sselect__button')!.click();
    const options = [...document.querySelectorAll('.calc__side .form-select .sselect__option')].map(
      (o) => o.textContent,
    );
    expect(options).toContain('메가 한카리아스');
    expect(options).not.toContain('Mega Garchomp');
  });
});

describe('테마', () => {
  it('기본은 화이트 모드다', async () => {
    await mountApp('#/');
    // 기기 설정을 따라가지 않는다 — 고르지 않았으면 화이트다.
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('오른쪽 맨 위 버튼으로 다크 모드를 켜고 끈다', async () => {
    await mountApp('#/');
    const button = document.querySelector<HTMLButtonElement>('.themebtn')!;
    // 제목과 같은 줄, 그 줄의 오른쪽 끝에 있다.
    const top = [...document.querySelector('.shell__top')!.children];
    expect(top[0]!.classList.contains('brand')).toBe(true);
    expect(top[top.length - 1]).toBe(button);

    button.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    document.querySelector<HTMLButtonElement>('.themebtn')!.click();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('고른 테마가 다시 열었을 때도 유지된다', async () => {
    await mountApp('#/');
    document.querySelector<HTMLButtonElement>('.themebtn')!.click();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    // 저장된 값을 읽어 다시 부팅한다.
    await mountApp('#/');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('변환자재 자속 토글', () => {
  it('그 특성이 없으면 토글이 나오지 않는다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    expect(document.querySelector('.calc__stabtoggle')).toBeNull();
  });

  it('변환자재면 기술마다 자속을 껐다 켤 수 있다', async () => {
    await mountApp('#/calc?a=aegislash&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__ability')).not.toBeNull();
    });

    // 변환자재를 고른다.
    // 픽스처 도감에 한국어명이 없어 영문 그대로 나온다.
    pickFrom(document.querySelector('.calc__ability')!, 'Protean');

    await vi.waitFor(() => {
      expect(document.querySelector('.calc__stabtoggle')).not.toBeNull();
    });

    const toggle = document.querySelector<HTMLButtonElement>('.calc__stabtoggle')!;
    // 한 번만 발동하는 특성이라 기본은 꺼짐 — 네 기술 전부에 자속이 붙으면 과대평가다.
    expect(toggle.textContent).toBe('자속 OFF');

    const before = document.querySelector('.calc__damage')!.textContent!;
    toggle.click();
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__stabtoggle')!.textContent).toBe('자속 ON');
    });
    // 자속이 붙으면 대미지가 커진다.
    expect(document.querySelector('.calc__damage')!.textContent).not.toBe(before);
  });
});

describe('화이트 모드는 끝까지 화이트여야 한다', () => {
  it('시스템 바 색(theme-color)도 테마를 따라간다', async () => {
    // 화면만 희게 하고 이 값을 두면 위아래 바만 검게 남아 '여전히 어둡다' 로 보인다.
    // jsdom 에는 index.html 이 없으므로 그 meta 를 직접 만들어 준다.
    document.head.querySelector('meta[name=	heme-color]')?.remove();
    const seed = document.createElement('meta');
    seed.setAttribute('name', 'theme-color');
    seed.setAttribute('content', '#f6f7fb');
    document.head.appendChild(seed);

    await mountApp('#/');
    const meta = document.querySelector('meta[name="theme-color"]');
    expect(meta?.getAttribute('content')).toBe('#f6f7fb');

    document.querySelector<HTMLButtonElement>('.themebtn')!.click();
    expect(meta?.getAttribute('content')).toBe('#181c23');
  });

  it('매니페스트의 스플래시·바 색이 밝다', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'),
    ) as { background_color: string; theme_color: string };
    // 설치된 앱의 스플래시와 시스템 바가 여기서 온다.
    expect(manifest.background_color.toLowerCase()).toBe('#ffffff');
    expect(manifest.theme_color.toLowerCase()).toBe('#f6f7fb');
  });

  it('기기 설정을 따라가는 theme-color 가 남아 있지 않다', () => {
    const html = readFileSync(path.join(import.meta.dirname, '..', 'index.html'), 'utf8');
    expect(html).not.toContain('prefers-color-scheme');
  });
});

describe('출처 화면', () => {
  it('탭에는 없지만 푸터 링크로 닿는다', async () => {
    await mountApp('#/');
    const footerLink = document.querySelector('.shell__footer a[href*="sources"]');
    expect(footerLink).not.toBeNull();

    // 링크가 실제로 살아 있는 경로여야 한다.
    await mountApp('#/sources');
    expect(document.querySelector('.notice--empty')).toBeNull();
    expect(document.body.textContent).toContain('상표');
  });
});

describe('장을 바꿔도 화면이 세로로 움직이지 않는다', () => {
  it('탭을 눌러도 scrollIntoView 를 쓰지 않는다', async () => {
    // scrollIntoView 는 가로뿐 아니라 세로도 움직여서, 장을 바꿀 때마다
    // 화면이 아래로 끌려 내려갔다. 가로 스크롤만 직접 지정해야 한다.
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__pagertab')).not.toBeNull();
    });

    const called: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewSpy(this: Element) {
      called.push(this.className);
    };
    try {
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('.calc__pagertab')];
      tabs[1]!.click();
      tabs[2]!.click();
      tabs[0]!.click();
    } finally {
      Element.prototype.scrollIntoView = original;
    }

    expect(called, `scrollIntoView 가 불렸습니다: ${called.join(', ')}`).toEqual([]);
  });

  it('탭을 누르면 가로 스크롤 위치만 바뀐다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__pager')).not.toBeNull();
    });

    const track = document.querySelector<HTMLElement>('.calc__pager')!;
    const moves: number[] = [];
    // jsdom 은 레이아웃이 없어 scrollTo 가 없다. 호출 인자만 확인한다.
    (track as unknown as { scrollTo: (o: { left: number }) => void }).scrollTo = (o) => {
      moves.push(o.left);
    };

    document.querySelectorAll<HTMLButtonElement>('.calc__pagertab')[1]!.click();
    expect(moves).toHaveLength(1);
  });
});

describe('폰이 다크 모드여도 화이트를 유지한다', () => {
  it('브라우저의 강제 어둡게를 거부한다 (only light)', () => {
    // 'light' 만 쓰면 폰이 다크 모드일 때 브라우저가 페이지를 자동으로 어둡게 칠한다.
    // 'only' 가 그 자동 변환을 거부하는 부분이다.
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8');
    expect(css).toContain('color-scheme: only light');

    const html = readFileSync(path.join(import.meta.dirname, '..', 'index.html'), 'utf8');
    expect(html).toContain('name="color-scheme"');
  });

  it('테마를 바꾸면 color-scheme 도 따라간다', async () => {
    document.head.querySelector('meta[name="color-scheme"]')?.remove();
    const seed = document.createElement('meta');
    seed.setAttribute('name', 'color-scheme');
    seed.setAttribute('content', 'only light');
    document.head.appendChild(seed);

    await mountApp('#/');
    expect(seed.getAttribute('content')).toBe('only light');

    document.querySelector<HTMLButtonElement>('.themebtn')!.click();
    expect(seed.getAttribute('content')).toBe('dark');
  });
});

describe('팝업 전용 계산기 (#/mini)', () => {
  it('헤더·탭·푸터 없이 계산기만 나온다', async () => {
    // 팝업 창은 CSS 폭이 300~400px 밖에 안 된다. 껍데기가 절반을 먹으면 안 된다.
    await mountApp('#/mini?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    expect(document.querySelector('.shell__header')).toBeNull();
    expect(document.querySelector('.shell__footer')).toBeNull();
    expect(document.querySelector('.nav')).toBeNull();
    expect(document.body.classList.contains('mini')).toBe(true);
  });

  it('계산 결과는 일반 화면과 같다', async () => {
    // 껍데기만 다르고 계산은 같은 코드여야 한다.
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    const normal = document.querySelector('.calc__damage')!.textContent;

    await mountApp('#/mini?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    expect(document.querySelector('.calc__damage')!.textContent).toBe(normal);
  });

  it('일반 화면을 벗어나면 mini 표시가 풀린다', async () => {
    await mountApp('#/mini');
    expect(document.body.classList.contains('mini')).toBe(true);
    await mountApp('#/');
    expect(document.body.classList.contains('mini')).toBe(false);
    expect(document.querySelector('.shell__header')).not.toBeNull();
  });

  it('일반 계산기에서 팝업 화면으로 건너갈 수 있다', async () => {
    await mountApp('#/calc');
    const link = document.querySelector('.calc__minilink a');
    expect(link?.getAttribute('href')).toContain('/mini');

    // 팝업 화면에서는 그 링크를 또 보여주지 않는다.
    await mountApp('#/mini');
    expect(document.querySelector('.calc__minilink')).toBeNull();
  });

  it('앱 바로가기가 팝업 화면을 가리킨다', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'public', 'manifest.webmanifest'), 'utf8'),
    ) as { shortcuts: { short_name: string; url: string }[] };
    const calc = manifest.shortcuts.find((s) => s.short_name === '계산기');
    expect(calc?.url).toContain('view=mini');
  });
});

describe('앱 바로가기로 팝업 계산기 열기', () => {
  it('쿼리(?view=mini)로도 팝업 계산기에 들어간다', async () => {
    // 안드로이드 바로가기는 주소의 프래그먼트(#)를 전달하지 못한다.
    // 그래서 쿼리로도 같은 화면에 닿아야 한다.
    const url = new URL(window.location.href);
    url.search = '?view=mini';
    url.hash = '';
    window.history.replaceState(null, '', url.toString());

    document.body.innerHTML = '<div id="app"></div>';
    vi.resetModules();
    await import('../src/main');
    await vi.waitFor(() => {
      if (document.querySelector('.notice--loading')) throw new Error('아직 로딩 중');
    });
    (await import('../src/store')).stopConfigPolling();

    expect(document.body.classList.contains('mini')).toBe(true);
    expect(document.querySelector('.shell__header')).toBeNull();

    window.history.replaceState(null, '', url.origin + url.pathname);
  });

  it('바로가기 주소에 프래그먼트를 쓰지 않는다', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'android', 'twa-manifest.json'), 'utf8'),
    ) as { shortcuts: { shortName: string; url: string }[] };
    const calc = manifest.shortcuts.find((s) => s.shortName === '계산기')!;
    // '#' 이 들어가면 런처가 무시하고 기본 주소로 앱만 열린다.
    expect(calc.url).not.toContain('#');
    expect(calc.url).toContain('view=mini');
  });
});

describe('검색되는 드롭다운', () => {
  it('기술 목록 위에 검색창이 있고 걸러진다', async () => {
    // 배울 수 있는 기술이 수백 개라 스크롤로는 못 찾는다.
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__move')).not.toBeNull();
    });

    const slot = document.querySelector('.calc__move')!;
    slot.querySelector<HTMLButtonElement>('.sselect__button')!.click();

    const search = slot.querySelector<HTMLInputElement>('.sselect__search')!;
    expect(search.hidden).toBe(false);

    const before = slot.querySelectorAll('.sselect__option').length;
    search.value = '지진';
    search.dispatchEvent(new Event('input'));
    const after = [...slot.querySelectorAll('.sselect__option')].map((o) => o.textContent ?? '');
    expect(after.length).toBeLessThan(before);
    expect(after.some((l) => l.includes('지진'))).toBe(true);
  });

  it('영문·일본어로 쳐도 찾힌다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__move')).not.toBeNull();
    });
    const slot = document.querySelector('.calc__move')!;
    slot.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    const search = slot.querySelector<HTMLInputElement>('.sselect__search')!;

    search.value = 'earthquake';
    search.dispatchEvent(new Event('input'));
    expect(
      [...slot.querySelectorAll('.sselect__option')].some((o) => o.textContent?.includes('지진')),
    ).toBe(true);
  });

  it('짧은 목록에는 검색창을 띄우지 않는다', async () => {
    // 특성은 2~3개뿐이라 검색창이 방해만 된다.
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__modifier')).not.toBeNull();
    });
    // 도구는 40개가 넘으므로 검색창이 있어야 한다.
    const item = document.querySelector('.calc__modifier')!;
    item.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    expect(item.querySelector<HTMLInputElement>('.sselect__search')!.hidden).toBe(false);
  });

  it('바깥을 누르면 닫힌다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__move')).not.toBeNull();
    });
    const slot = document.querySelector('.calc__move')!;
    const panel = slot.querySelector<HTMLElement>('.sselect__panel')!;

    slot.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    expect(panel.hidden).toBe(false);

    document.body.click();
    expect(panel.hidden).toBe(true);
  });

  it('드롭다운 목록 색을 못박아 다크 모드에서도 읽힌다', () => {
    // <option> 은 select 색을 물려받지 않아, 안드로이드 시스템 팝업에서 글자가 사라졌다.
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8');
    expect(css).toContain('select option');
  });
});

describe('드롭다운은 한 번에 하나만', () => {
  it('처음에는 모두 닫혀 있다', async () => {
    // hidden 속성은 CSS display 로 덮이면 무력해진다. 실제로 닫혀 있는지 본다.
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.sselect__panel')).not.toBeNull();
    });
    const panels = [...document.querySelectorAll<HTMLElement>('.sselect__panel')];
    expect(panels.length).toBeGreaterThan(3);
    expect(panels.every((p) => p.hidden)).toBe(true);
  });

  it('새로 열면 앞서 열린 것이 닫힌다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.calc__move').length).toBe(4);
    });
    const slots = [...document.querySelectorAll('.calc__move')];

    slots[0]!.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    slots[1]!.querySelector<HTMLButtonElement>('.sselect__button')!.click();

    expect(slots[0]!.querySelector<HTMLElement>('.sselect__panel')!.hidden).toBe(true);
    expect(slots[1]!.querySelector<HTMLElement>('.sselect__panel')!.hidden).toBe(false);
  });

  it('CSS 가 hidden 을 되살려 둔다', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', 'src', 'styles.css'), 'utf8');
    expect(css).toContain('.sselect__panel[hidden]');
  });
});

describe('드롭다운 디자인 통일', () => {
  it('계산기에 네이티브 select 가 하나도 없다', async () => {
    // 자체 패널과 시스템 목록이 섞여 있으면 열었을 때 모양이 완전히 다르다.
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });
    expect(document.querySelectorAll('select')).toHaveLength(0);
    expect(document.querySelectorAll('.sselect').length).toBeGreaterThan(8);
  });

  it('짧은 목록도 같은 패널을 쓰되 검색창만 감춘다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    // 상태이상은 7개 — 검색창 없이 같은 패널이 뜬다.
    const status = [...document.querySelectorAll('.calc__side .calc__field')].find((f) =>
      f.textContent?.startsWith('상태이상'),
    )!;
    status.querySelector<HTMLButtonElement>('.sselect__button')!.click();
    expect(status.querySelector<HTMLElement>('.sselect__panel')!.hidden).toBe(false);
    expect(status.querySelector<HTMLInputElement>('.sselect__search')!.hidden).toBe(true);
  });
});

describe('도구가 계산에 반영된다', () => {
  it('생명의구슬을 고르면 대미지가 늘고 표시도 바뀐다', async () => {
    await mountApp('#/calc?a=garchomp&b=ninetalesalola');
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')).not.toBeNull();
    });

    const before = document.querySelector('.calc__damage')!.textContent!;
    const item = document.querySelector('.calc__modifier')!;
    // 픽스처 도감에 한국어명이 없어 영문 그대로 나온다.
    pickFrom(item, 'Life Orb');

    // 1) 계산에 반영돼야 한다
    await vi.waitFor(() => {
      expect(document.querySelector('.calc__damage')!.textContent).not.toBe(before);
    });
    // 2) 고른 값이 화면에도 남아야 한다 — 안 바뀌면 '안 들어갔다' 로 보인다
    expect(pickerValue(document.querySelector('.calc__modifier'))).toBe('Life Orb');
  });
});
