/**
 * /sources — 데이터 출처 페이지 (설계 문서 6절, 구현 필수)
 *
 * 매트릭스의 각 소스와 링크를 명시한다. 등급(A/B/C)과 캐비엇도 함께 적어
 * 이용자가 수치의 성격을 오해하지 않게 한다.
 */

import { clear, el } from '../core/dom';

interface SourceRow {
  name: string;
  url: string;
  grade: 'A' | 'B' | 'C';
  provides: string;
  caveat: string;
}

const SOURCES: SourceRow[] = [
  {
    name: 'championsbattledata.com',
    url: 'https://championsbattledata.com/',
    grade: 'A',
    provides: '포켓몬 인덱스, 기술·도구·특성·성격·노력치·파트너 사용률, 종족값, 타입, 스프라이트',
    caveat: '팬 프로젝트입니다. 이 앱의 모든 수치와 이미지의 1차 출처입니다.',
  },
  {
    name: 'PokéAPI',
    url: 'https://pokeapi.co/',
    grade: 'A',
    provides: '한국어·일본어 포켓몬 명칭, 기술 한국어명·위력·PP·명중률·게임 내 설명',
    caveat:
      'championsbattledata 가 주는 수치는 종족값이 아니라 레벨 50 기준 실수치라, PokéAPI 의 종족값과 단위가 달라 섞지 않습니다. 9세대 신규 기술은 공식 한국어 설명이 없어 영문으로 표시됩니다.',
  },
  {
    name: 'champs.pokedb.tokyo 공개 데이터',
    url: 'https://champs.pokedb.tokyo/guide/opendata',
    grade: 'A',
    provides: '시즌별 상위 랭커의 팀 구성 (통계 탭)',
    caveat:
      '발행처 안내에 따라 앱이 직접 요청하지 않습니다 — 빌드 때 한 번 받아 이 사이트에 구워 넣은 집계만 씁니다. 상위 랭커 표본이라 래더 전체 사용률과 다릅니다.',
  },
  {
    name: 'Smogon 사용률 통계',
    url: 'https://www.smogon.com/stats/',
    grade: 'A',
    provides: 'Checks & Counters (싱글 BSS / 더블 VGC)',
    caveat:
      'Pokémon Showdown 래더 기록입니다. Nintendo Switch 랭크전과 표본·규칙·메타가 다릅니다.',
  },
  {
    name: 'smogon/usage-stats',
    url: 'https://github.com/smogon/usage-stats',
    grade: 'A',
    provides: '통계 산출 방식 문서',
    caveat: '집계 규칙 확인용으로 참조합니다.',
  },
  {
    name: 'Pokémon Showdown',
    url: 'https://github.com/smogon/pokemon-showdown',
    grade: 'A',
    provides: '기술 플래그(접촉·펀치·소리·파동·구슬·베기 등), Champions learnset',
    caveat:
      'PokéAPI 가 제공하지 않는 기술 플래그를 여기서 받습니다. 철주먹·단단한발톱 같은 특성 판정에 필요합니다. MIT 라이선스.',
  },
  {
    name: 'champs.pokedb.tokyo',
    url: 'https://champs.pokedb.tokyo/',
    grade: 'B',
    provides: '동결 시즌 트레이너 파티 구성',
    caveat: '동결 시즌 한정 보강 자료입니다.',
  },
  {
    name: '공개 구축 기사 (pokesol.app, note.com 등)',
    url: 'https://pokesol.app/',
    grade: 'B',
    provides: '구축 세트와 해설',
    caveat: '각 항목에 원문 링크를 표시합니다. 번역본은 "참고용 번역"으로 라벨링합니다.',
  },
  {
    name: 'Pikalytics / Limitless',
    url: 'https://www.pikalytics.com/',
    grade: 'B',
    provides: '토너먼트 상위 파티',
    caveat: '참고용입니다.',
  },
  {
    name: '공식 랭킹 (ranking.app.pokemonchampions.jp)',
    url: 'https://www.pokemonchampions.com/',
    grade: 'C',
    provides: '트레이너 랭킹 (M6, 기본 비활성)',
    caveat:
      '비공식 사용이며 서버사이드에서만 호출합니다. 기본값은 꺼짐이고, 꺼져 있어도 나머지 기능은 모두 동작합니다.',
  },
  {
    name: 'Bulbagarden Archives · PokéBase · pokemon-icons',
    url: 'https://archives.bulbagarden.net/',
    grade: 'B',
    provides: '보조 스프라이트·아이콘',
    caveat: '기본 스프라이트를 구하지 못했을 때의 폴백입니다.',
  },
];

export function renderSources(container: HTMLElement): void {
  clear(container);

  const table = el('table', { class: 'sources__table' });
  table.appendChild(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, '소스'),
        el('th', {}, '등급'),
        el('th', {}, '제공 데이터'),
        el('th', {}, '유의사항'),
      ),
    ),
  );

  const body = el('tbody');
  for (const source of SOURCES) {
    body.appendChild(
      el(
        'tr',
        {},
        el(
          'td',
          {},
          el(
            'a',
            { class: 'link', href: source.url, target: '_blank', rel: 'noopener noreferrer' },
            source.name,
          ),
        ),
        el('td', {}, el('span', { class: `badge badge--${source.grade.toLowerCase()}` }, source.grade)),
        el('td', {}, source.provides),
        el('td', { class: 'sources__caveat' }, source.caveat),
      ),
    );
  }
  table.appendChild(body);

  container.appendChild(
    el(
      'section',
      { class: 'sources' },
      el('h2', {}, '데이터 출처'),
      el(
        'p',
        {},
        '이 앱은 공개된 집계 통계를 보여주는 메타 뷰어입니다. 개인 계정 전적은 다루지 않습니다.',
      ),
      table,
      el(
        'div',
        { class: 'sources__legal' },
        el('h3', {}, '상표 및 저작권'),
        el(
          'p',
          {},
          'Pokémon and all respective names are Trademark and © of Nintendo 1996–2026, Creatures Inc. and GAME FREAK inc.',
        ),
        el(
          'p',
          {},
          'This site is not affiliated with or endorsed by Nintendo, The Pokémon Company, or GAME FREAK inc.',
        ),
      ),
    ),
  );
}
