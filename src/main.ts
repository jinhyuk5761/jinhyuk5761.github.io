/**
 * 앱 진입점 — 셸(헤더/네비/푸터)을 그리고 라우트에 맞는 뷰를 붙인다.
 *
 * 푸터의 귀속 문구는 설계 문서 6절에 따라 **모든 화면에 항상** 노출된다.
 */

import { clear, el } from './core/dom';
import { currentRoute, href, onRouteChange, type Route } from './router';
import { applyTheme, bootstrap, setFormat, setTheme, state, subscribe } from './store';
import type { Format } from './types';
import { renderCalculator } from './views/calculator';
import { renderAbilityDexView, renderMoveDexView } from './views/dex';
import { renderDetail } from './views/detail';
import { renderRanking } from './views/ranking';
import { renderSearch } from './views/search';
import { renderSources } from './views/sources';
import './styles.css';

const app = document.getElementById('app');
if (!app) throw new Error('#app 요소를 찾지 못했습니다.');

const main = el('main', { class: 'main', id: 'main' });

function navLink(path: string, label: string, route: Route): HTMLElement {
  const link = el('a', { class: 'nav__link', href: href(path) }, label);
  if (route.path === path) link.classList.add('nav__link--active');
  return link;
}

function formatToggle(): HTMLElement {
  const group = el('div', { class: 'toggle', role: 'group', 'aria-label': '대전 포맷' });
  for (const format of ['Singles', 'Doubles'] as Format[]) {
    const button = el(
      'button',
      {
        class: `toggle__button${state.format === format ? ' toggle__button--active' : ''}`,
        type: 'button',
        'aria-pressed': String(state.format === format),
      },
      format === 'Singles' ? '싱글' : '더블',
    );
    button.addEventListener('click', () => setFormat(format));
    group.appendChild(button);
  }
  return group;
}

/** 화이트 / 다크 전환. 오른쪽 맨 위에 둔다. */
function themeToggle(): HTMLElement {
  const dark = state.theme === 'dark';
  const button = el(
    'button',
    {
      class: 'themebtn',
      type: 'button',
      title: dark ? '화이트 모드로' : '다크 모드로',
      'aria-label': dark ? '화이트 모드로 전환' : '다크 모드로 전환',
    },
    dark ? '☀' : '☾',
  );
  button.addEventListener('click', () => setTheme(dark ? 'light' : 'dark'));
  return button;
}

function shellHeader(route: Route): HTMLElement {
  return el(
    'header',
    { class: 'shell__header' },
    // 제목과 테마 버튼을 한 줄에 둔다 — 버튼은 그 줄의 오른쪽 끝.
    el(
      'div',
      { class: 'shell__top' },
      el('a', { class: 'brand', href: href('/') }, 'Pokémon Champions 메타'),
      themeToggle(),
    ),
    el(
      'nav',
      { class: 'nav' },
      navLink('/', '검색', route),
      navLink('/moves', '기술', route),
      navLink('/abilities', '특성', route),
      navLink('/calc', '계산기', route),
      // 랭킹 탭은 서버가 "데이터 있음"이라고 알려줄 때만 나타난다.
      // config 를 주기적으로 다시 확인하므로, 랭킹이 붙으면 새로고침 없이 탭이 생긴다.
      state.config.ranking.enabled ? navLink('/ranking', '랭킹', route) : null,
      navLink('/sources', '출처', route),
    ),
    el('div', { class: 'shell__controls' }, formatToggle()),
  );
}

function shellFooter(): HTMLElement {
  return el(
    'footer',
    { class: 'shell__footer' },
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
    el(
      'p',
      {},
      '데이터 출처: ',
      el('a', { class: 'link', href: href('/sources') }, 'championsbattledata · PokéAPI · Smogon 외'),
    ),
  );
}

function renderRoute(route: Route): void {
  clear(main);

  switch (route.path) {
    case '/':
      renderSearch(main);
      break;
    case '/p':
      renderDetail(main, route.params.id ?? '');
      break;
    case '/moves':
      renderMoveDexView(main, route);
      break;
    case '/abilities':
      renderAbilityDexView(main, route);
      break;
    case '/calc':
      renderCalculator(main, route);
      break;
    case '/ranking':
      renderRanking(main);
      break;
    case '/sources':
      renderSources(main);
      break;
    default:
      main.appendChild(el('p', { class: 'notice notice--empty' }, '없는 페이지입니다.'));
      main.appendChild(el('a', { class: 'link', href: href('/') }, '← 검색으로'));
  }
}

function renderShell(): void {
  const route = currentRoute();
  clear(app!);
  app!.appendChild(shellHeader(route));
  app!.appendChild(main);
  app!.appendChild(shellFooter());
  renderRoute(route);
}

renderShell();
// 포맷 토글과 config 갱신은 셸과 현재 뷰를 모두 다시 그려야 한다.
subscribe(renderShell);
onRouteChange(renderShell);

// 저장된 테마를 화면에 먼저 반영한다. 부팅을 기다리면 잠깐 흰 화면이 번쩍인다.
applyTheme(state.theme);

void bootstrap();

/**
 * 서비스워커 등록 — 폰에 설치했을 때 PC 서버가 꺼져 있어도 앱이 뜨게 한다.
 *
 * 개발 중에는 등록하지 않는다. 캐시가 끼면 코드 수정이 화면에 안 붙어 디버깅이 괴로워진다.
 * 보안 컨텍스트(https 또는 localhost)에서만 동작하므로, USB adb reverse 로
 * localhost 에 붙이면 그대로 설치된다.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      // 등록 실패는 치명적이지 않다 — 오프라인 지원만 없는 평범한 웹앱이 된다.
    });
  });
}
