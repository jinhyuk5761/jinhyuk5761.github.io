/**
 * M1 — 인덱스 & 다국어 검색
 *
 * 완료 기준(설계 문서): "한카리아스" / "garchomp" / "ガブリアス" 가 모두 같은 결과를 낸다.
 * 매칭 규칙은 shared/names.mjs 의 matchesQuery 하나로 통일한다.
 */

import { matchesQuery } from '../core/names';
import { clear, el, focusIfKeyboardLikely, notice } from '../core/dom';
import { searchHaystack } from '../adapters/pokeApi';
import { navigate } from '../router';
import { state } from '../store';
import type { Format, Pokemon } from '../types';
import { monCard } from './components';

/**
 * 정렬 기준. 사용률 순위는 인덱스가 이미 들고 있어서 추가 요청이 없다.
 * 순위가 없는 종은 어느 기준에서든 맨 뒤로 보내고 "순위 없음" 이라고 적는다.
 */
type SortMode = 'usage' | 'name' | 'stats';

const SORT_OPTIONS: [SortMode, string][] = [
  ['usage', '사용률 순위'],
  ['name', '이름순'],
  ['stats', '실수치 합계'],
];

let query = '';
let activeIndex = -1;
let sortMode: SortMode = 'usage';

export function renderSearch(container: HTMLElement): void {
  clear(container);

  if (state.indexError) {
    container.appendChild(
      notice('error', `포켓몬 인덱스를 불러오지 못했습니다: ${state.indexError}`),
    );
    return;
  }
  if (!state.ready) {
    container.appendChild(notice('loading', '포켓몬 인덱스를 불러오는 중…'));
    return;
  }

  const input = el('input', {
    class: 'search__input',
    type: 'search',
    value: query,
    placeholder: '포켓몬 이름 검색 — 한카리아스 / garchomp / ガブリアス',
    'aria-label': '포켓몬 검색',
    'aria-autocomplete': 'list',
  });

  const results = el('div', { class: 'results', role: 'listbox' });
  const summary = el('p', { class: 'results__summary' });

  const sortSelect = el('select', { class: 'search__sort', 'aria-label': '정렬 기준' });
  for (const [value, label] of SORT_OPTIONS) {
    const option = el('option', { value }, label);
    if (value === sortMode) option.setAttribute('selected', 'selected');
    sortSelect.appendChild(option);
  }

  const draw = (): void => {
    const matches = sortPokemon(filterPokemon(query), sortMode, state.format);
    clear(results);

    const unranked = matches.filter((mon) => mon.usageRank[state.format] === null).length;
    const scope = query.trim().length === 0 ? '전체' : '검색 결과';
    // 잘라내지 않으므로 "상위 N종만 표시" 같은 단서가 필요 없다.
    summary.textContent =
      `${scope} ${matches.length}종` +
      (sortMode === 'usage' && unranked > 0 ? ` · 순위 없음 ${unranked}종은 맨 뒤` : '');

    if (matches.length === 0) {
      results.appendChild(notice('empty', '일치하는 포켓몬이 없습니다.'));
      return;
    }
    matches.forEach((mon, i) => {
      const card = monCard(mon, sortMode === 'usage' ? state.format : null);
      if (i === activeIndex) card.classList.add('card--active');
      results.appendChild(card);
    });
  };

  sortSelect.addEventListener('change', () => {
    sortMode = sortSelect.value as SortMode;
    activeIndex = -1;
    draw();
  });

  input.addEventListener('input', () => {
    query = input.value;
    activeIndex = -1;
    draw();
  });

  // 키보드 내비게이션 — 설계 문서 M1 요구사항.
  input.addEventListener('keydown', (event: KeyboardEvent) => {
    const matches = sortPokemon(filterPokemon(query), sortMode, state.format);
    if (matches.length === 0) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + delta + matches.length) % matches.length;
      draw();
      results.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      const target = matches[activeIndex >= 0 ? activeIndex : 0];
      if (target) {
        event.preventDefault();
        navigate(`#/p/${encodeURIComponent(target.showdownId)}`);
      }
      return;
    }
    if (event.key === 'Escape') {
      query = '';
      input.value = '';
      activeIndex = -1;
      draw();
    }
  });

  container.appendChild(
    el(
      'section',
      { class: 'search' },
      el('h2', {}, '포켓몬 검색'),
      el(
        'p',
        { class: 'search__hint' },
        '한국어 · 일본어 · 영어 어느 쪽으로 입력해도 같은 결과가 나옵니다.',
      ),
      input,
      state.localeDegraded
        ? notice('error', '로케일 명칭을 불러오지 못해 영문 검색만 동작합니다.')
        : null,
      el(
        'div',
        { class: 'search__toolbar' },
        el('label', { class: 'search__sort-field' }, el('span', {}, '정렬'), sortSelect),
        summary,
      ),
      results,
    ),
  );

  draw();
  focusIfKeyboardLikely(input);
}

export function filterPokemon(rawQuery: string): Pokemon[] {
  const list = state.index?.pokemon ?? [];
  if (!rawQuery.trim()) return list;
  return list.filter((mon) => matchesQuery(rawQuery, searchHaystack(mon, state.locales)));
}

/**
 * 정렬. 원본 배열을 건드리지 않는다.
 *
 * 순위가 없는 종(상류가 position 을 안 주는 경우)은 0 위로 올라오면 안 되므로
 * 무조건 맨 뒤로 보낸다. 없는 순위를 큰 수로 치환해 섞이게 두면 조용히 틀린 순서가 된다.
 */
export function sortPokemon(list: Pokemon[], mode: SortMode, format: Format): Pokemon[] {
  const sorted = [...list];
  if (mode === 'name') {
    sorted.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));
    return sorted;
  }
  if (mode === 'stats') {
    sorted.sort((a, b) => b.primary.stats.total - a.primary.stats.total);
    return sorted;
  }
  sorted.sort((a, b) => {
    const ra = a.usageRank[format];
    const rb = b.usageRank[format];
    if (ra === null && rb === null) return a.displayName.localeCompare(b.displayName, 'ko');
    if (ra === null) return 1;
    if (rb === null) return -1;
    return ra - rb;
  });
  return sorted;
}
