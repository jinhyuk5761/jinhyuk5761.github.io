/**
 * M1 — 인덱스 & 다국어 검색
 *
 * 완료 기준(설계 문서): "한카리아스" / "garchomp" / "ガブリアス" 가 모두 같은 결과를 낸다.
 * 매칭 규칙은 shared/names.mjs 의 matchesQuery 하나로 통일한다.
 */

import { matchesQuery } from '../core/names';
import { clear, el, focusIfKeyboardLikely, notice } from '../core/dom';
import { formDisplayName, formTagText, nameCarriesForm } from '../core/formNames';
import { isMegaForm } from '../core/megaStones';
import { searchHaystack } from '../adapters/pokeApi';
import { navigate } from '../router';
import { state } from '../store';
import type { Format, Pokemon, PokemonForm } from '../types';
import { monCard } from './components';

/**
 * 정렬 기준. 사용률 순위는 인덱스가 이미 들고 있어서 추가 요청이 없다.
 * 순위가 없는 종은 어느 기준에서든 맨 뒤로 보내고 "순위 없음" 이라고 적는다.
 */
type SortMode = 'usage' | 'name' | 'stats' | 'speed';

const SORT_OPTIONS: [SortMode, string][] = [
  ['usage', '사용률 순위'],
  ['name', '이름순'],
  ['stats', '실수치 합계'],
  ['speed', '스피드 순위'],
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
    const all = filterPokemon(query);
    const matches = sortPokemon(visibleIn(all, sortMode), sortMode, state.format);
    // 사용률 순위에서 빠진 메가가 몇인지. 검색해서 아무것도 안 나오는 이유가 되기도 한다.
    const hiddenMegas = all.length - matches.length;
    clear(results);

    const unranked = matches.filter((e) => e.mon.usageRank[state.format] === null).length;
    const scope = query.trim().length === 0 ? '전체' : '검색 결과';
    const megas = matches.filter((e) => e.isMega).length;
    // 잘라내지 않으므로 "상위 N종만 표시" 같은 단서가 필요 없다.
    // 메가는 종이 아니라 폼이므로 종 수와 섞어 세지 않고 따로 적는다.
    summary.textContent =
      `${scope} ${matches.length - megas}종` +
      (megas > 0 ? ` · 메가 ${megas}폼` : '') +
      (hiddenMegas > 0 ? ` · 메가 ${hiddenMegas}폼은 사용률 순위에서 제외` : '') +
      (sortMode === 'usage' && unranked > 0 ? ` · 순위 없음 ${unranked}종은 맨 뒤` : '');

    if (matches.length === 0) {
      results.appendChild(
        notice(
          'empty',
          hiddenMegas > 0
            ? '메가는 사용률 순위에 없습니다 — 정렬을 바꾸면 나옵니다.'
            : '일치하는 포켓몬이 없습니다.',
        ),
      );
      return;
    }
    matches.forEach((entry, i) => {
      const card = monCard(entry.mon, {
        rankFormat: sortMode === 'usage' ? state.format : null,
        metric: sortMode === 'speed' ? 'speed' : 'bst',
        form: entry.form,
        label: entry.label,
        formTag: entry.formTag,
      });
      if (entry.isMega) card.classList.add('card--mega');
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
    const matches = sortPokemon(visibleIn(filterPokemon(query), sortMode), sortMode, state.format);
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
        const path = `#/p/${encodeURIComponent(target.mon.showdownId)}`;
        // 메가를 고른 것이면 상세 화면에서도 그 폼을 펴 준다.
        navigate(
          target.isMega ? `${path}?form=${encodeURIComponent(target.form.slug)}` : path,
        );
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

/**
 * 목록에 놓는 한 줄.
 *
 * 메가는 종 아래의 폼이라 예전에는 검색에 아예 나오지 않았다. 그런데 타입·수치·특성이
 * 원종과 다른 별개의 카드로 다뤄야 할 것이라, 종 한 줄 + 메가 폼 한 줄씩으로 편다.
 * (알로라·가라르 폼은 상류가 이미 별개의 종으로 주므로 여기서 손댈 게 없다.)
 */
export interface SearchEntry {
  mon: Pokemon;
  form: PokemonForm;
  /** 화면에 적을 이름. 메가면 '메가 한카리아스'. */
  label: string;
  /**
   * 이름 옆에 붙일 폼 표기. 폼이 여러 개인 종에서만 붙는다.
   * 이름이 이미 그 폼을 말하고 있으면(메가 …) 두 번 적지 않는다.
   */
  formTag: string | null;
  isMega: boolean;
}

/** 종 + 메가 폼을 한 줄씩 편 목록. */
export function searchEntries(): SearchEntry[] {
  const list = state.index?.pokemon ?? [];
  const entries: SearchEntry[] = [];
  /*
   * 같은 메가 폼을 여러 종이 물고 있다.
   *
   * 상류는 라이츄와 알로라 라이츄를 **각각의 종**으로 주면서 폼 목록은 똑같이
   * (라이츄 · 알로라 라이츄 · 메가 라이츄 X · Y) 담아 준다. 그대로 펴면 메가 라이츄가
   * 두 번씩 나온다. 폼 slug 로 한 번만 세우고, 원종(Base) 쪽에 붙인다.
   */
  const megaOwner = new Map<string, Pokemon>();
  for (const mon of list) {
    for (const form of mon.forms) {
      if (!isMegaForm(form)) continue;
      const owner = megaOwner.get(form.slug);
      if (!owner || (owner.primary.formKind !== 'Base' && mon.primary.formKind === 'Base')) {
        megaOwner.set(form.slug, mon);
      }
    }
  }

  /** 폼이 여러 개인 종에서만, 그리고 이름과 겹치지 않을 때만 폼을 덧붙인다. */
  const tagFor = (mon: Pokemon, form: PokemonForm, label: string): string | null => {
    if (mon.forms.length <= 1) return null;
    // '알로라 나인테일' 처럼 이름이 이미 폼을 말하고 있으면 두 번 적지 않는다.
    if (nameCarriesForm(label)) return null;
    const tag = formTagText(mon, form, state.formNames);
    return tag && tag !== label ? tag : null;
  };

  for (const mon of list) {
    /*
     * 대표 폼이 메가인 종 엔트리가 하나 있다 (Mega Gallade). 원종(엘레이드)이 같은 폼을
     * 이미 갖고 있어서 그대로 두면 같은 메가가 두 줄이 된다. 게다가 이쪽은 사용률 순위도
     * 없고 한국어 이름도 없다. 폼 줄에 맡기고 종 줄은 세우지 않는다.
     */
    const duplicateMegaSpecies = isMegaForm(mon.primary) && megaOwner.get(mon.primary.slug) !== mon;
    if (!duplicateMegaSpecies) {
      entries.push({
        mon,
        form: mon.primary,
        label: mon.displayName,
        formTag: tagFor(mon, mon.primary, mon.displayName),
        // 대표 폼이 메가면 그 줄도 메가다 — 사용률 순위에서 함께 빠진다.
        isMega: isMegaForm(mon.primary),
      });
    }
    for (const form of mon.forms) {
      if (!isMegaForm(form)) continue;
      if (megaOwner.get(form.slug) !== mon) continue;
      // 방금 종 줄로 세운 폼을 또 세우지 않는다.
      if (form.slug === mon.primary.slug) continue;
      // 메가는 이름 자체가 '메가 …' 라 폼을 또 적지 않는다.
      const label = formDisplayName(mon, form, list, state.formNames);
      entries.push({ mon, form, label, formTag: null, isMega: true });
    }
  }
  return entries;
}

/**
 * 검색 대상 문자열.
 *
 * 메가 줄은 종 이름으로도 찾혀야 한다 — '한카리아스' 를 치면 원종과 메가가 함께 나온다.
 * 거기에 폼 이름('메가 한카리아스' · 'Mega Garchomp' · 'mega-garchomp')을 더한다.
 */
function entryHaystack(entry: SearchEntry): string[] {
  const base = searchHaystack(entry.mon, state.locales);
  if (!entry.isMega) return base;
  return [...base, entry.label, entry.form.formName, entry.form.slug];
}

/**
 * 이 정렬에서 목록에 세울 것들.
 *
 * 사용률은 **종 단위** 집계라 메가에 따로 매길 순위가 없다. 원종의 순위를 빌려 적으면
 * 같은 순위가 두 줄로 늘어서 순위표가 아니게 된다. 그래서 사용률 순위에서는 뺀다.
 * (다른 정렬에서는 그 폼의 수치로 줄을 세우므로 그대로 둔다.)
 */
export function visibleIn(entries: SearchEntry[], mode: SortMode): SearchEntry[] {
  return mode === 'usage' ? entries.filter((entry) => !entry.isMega) : entries;
}

export function filterPokemon(rawQuery: string): SearchEntry[] {
  const entries = searchEntries();
  if (!rawQuery.trim()) return entries;
  return entries.filter((entry) => matchesQuery(rawQuery, entryHaystack(entry)));
}

/**
 * 정렬. 원본 배열을 건드리지 않는다.
 *
 * 순위가 없는 종(상류가 position 을 안 주는 경우)은 0 위로 올라오면 안 되므로
 * 무조건 맨 뒤로 보낸다. 없는 순위를 큰 수로 치환해 섞이게 두면 조용히 틀린 순서가 된다.
 */
export function sortPokemon(list: SearchEntry[], mode: SortMode, format: Format): SearchEntry[] {
  const sorted = [...list];
  const byName = (a: SearchEntry, b: SearchEntry): number =>
    a.label.localeCompare(b.label, 'ko');

  if (mode === 'name') {
    sorted.sort(byName);
    return sorted;
  }
  if (mode === 'stats') {
    sorted.sort((a, b) => b.form.stats.total - a.form.stats.total);
    return sorted;
  }
  if (mode === 'speed') {
    // 스피드가 같은 종이 흔하다(100 만 수십 종). 그때는 이름으로 줄을 세워
    // 목록을 다시 그려도 순서가 흔들리지 않게 한다.
    sorted.sort((a, b) => b.form.stats.spe - a.form.stats.spe || byName(a, b));
    return sorted;
  }
  sorted.sort((a, b) => {
    const ra = a.mon.usageRank[format];
    const rb = b.mon.usageRank[format];
    if (ra === null && rb === null) return byName(a, b);
    if (ra === null) return 1;
    if (rb === null) return -1;
    return ra - rb || byName(a, b);
  });
  return sorted;
}
