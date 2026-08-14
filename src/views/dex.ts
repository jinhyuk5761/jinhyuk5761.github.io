/**
 * 기술 도감 · 특성 도감.
 *
 * 로스터가 실제로 쓰는 기술 539개 · 특성 200개를 검색하고,
 * 하나를 고르면 **그걸 가진 포켓몬 목록**을 보여준다.
 *
 * 역인덱스는 이미 받아둔 인덱스 응답에서 만든다(`core/reverseIndex.ts`).
 * 추가 요청이 없으므로 상류가 갱신되면 목록도 따라 바뀐다.
 */

import { fetchMoveDex, type MoveDex, type MoveInfo } from '../adapters/moveDex';
import { abilityName } from '../adapters/termDex';
import { clear, el, focusIfKeyboardLikely, notice } from '../core/dom';
import { matchesQuery } from '../core/names';
import { buildReverseIndex, type FormRef, type ReverseIndex } from '../core/reverseIndex';
import { moveEffectLines } from '../core/moveEffect';
import { traitsOf } from '../core/moveTraits';
import { navigate, href, type Route } from '../router';
import { state } from '../store';
import type { Pokemon } from '../types';
import { sprite, typeBadge } from './components';

/** 두 도감이 인덱스를 다시 만들지 않도록 한 번만 계산해 둔다. */
let cached: { source: Pokemon[]; index: ReverseIndex } | null = null;

function reverseIndex(): ReverseIndex {
  const pokemon = state.index?.pokemon ?? [];
  if (!cached || cached.source !== pokemon) {
    cached = { source: pokemon, index: buildReverseIndex(pokemon) };
  }
  return cached.index;
}

// ---------------------------------------------------------------------------
// 기술 도감
// ---------------------------------------------------------------------------

let moveQuery = '';

export function renderMoveDexView(container: HTMLElement, route: Route): void {
  clear(container);

  if (!state.ready) {
    container.appendChild(notice('loading', '불러오는 중…'));
    return;
  }

  const section = el('section', {}, el('h2', {}, '기술'));
  container.appendChild(section);

  const host = el('div');
  section.appendChild(host);
  host.appendChild(notice('loading', '기술 도감을 불러오는 중…'));

  void fetchMoveDex().then((result) => {
    const dex = result.status === 'ok' ? result.data : null;
    clear(host);
    if (!dex) {
      host.appendChild(notice('error', '기술 도감을 불러오지 못했습니다.'));
      return;
    }
    const selected = route.query.get('m');
    if (selected) renderMoveDetail(host, dex, selected);
    else renderMoveList(host, dex);
  });
}

function renderMoveList(host: HTMLElement, dex: MoveDex): void {
  const index = reverseIndex();
  const input = el('input', {
    class: 'search__input',
    type: 'search',
    value: moveQuery,
    placeholder: '기술 검색 — 지진 / Earthquake / じしん',
    'aria-label': '기술 검색',
  });
  const summary = el('p', { class: 'results__summary' });
  const list = el('div', { class: 'dexlist' });

  const draw = (): void => {
    clear(list);
    const query = moveQuery.trim();
    const matches = index.moveNames
      .map((name) => dex.get(name))
      .filter((move): move is MoveInfo => Boolean(move))
      .filter((move) =>
        !query ||
        matchesQuery(query, [move.englishName, move.koreanName ?? '', move.japaneseName ?? '']),
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));

    summary.textContent = `${query ? '검색 결과' : '전체'} ${matches.length}개`;
    if (matches.length === 0) {
      list.appendChild(notice('empty', '일치하는 기술이 없습니다.'));
      return;
    }

    for (const move of matches) {
      const users = index.moveUsers.get(move.englishName)?.length ?? 0;
      const row = el(
        'a',
        { class: 'dexrow', href: href(`/moves?m=${encodeURIComponent(move.englishName)}`) },
        move.type ? typeBadge(move.type) : el('span', { class: 'type type--unknown' }, '—'),
        el('span', { class: 'dexrow__name' }, move.displayName),
        el(
          'span',
          { class: 'dexrow__meta' },
          move.power ? `위력 ${move.power}` : '변화',
          move.damageClass && move.damageClass !== 'status'
            ? ` · ${move.damageClass === 'physical' ? '물리' : '특수'}`
            : '',
        ),
        el('span', { class: 'dexrow__count' }, `${users}종`),
      );
      list.appendChild(row);
    }
  };

  input.addEventListener('input', () => {
    moveQuery = input.value;
    draw();
  });

  host.appendChild(input);
  host.appendChild(el('div', { class: 'search__toolbar' }, summary));
  host.appendChild(list);
  draw();
  focusIfKeyboardLikely(input);
}

function renderMoveDetail(host: HTMLElement, dex: MoveDex, englishName: string): void {
  const move = dex.get(englishName);
  if (!move) {
    host.appendChild(notice('empty', '기술을 찾을 수 없습니다.'));
    host.appendChild(backLink('/moves', '기술 목록으로'));
    return;
  }

  const index = reverseIndex();
  const users = index.moveUsers.get(englishName) ?? [];

  host.appendChild(backLink('/moves', '← 기술 목록'));

  const head = el('div', { class: 'dexhead' });
  if (move.type) head.appendChild(typeBadge(move.type));
  head.appendChild(el('h3', { class: 'dexhead__name' }, move.displayName));
  head.appendChild(el('span', { class: 'dexhead__en' }, move.englishName));
  host.appendChild(head);

  host.appendChild(
    el(
      'div',
      { class: 'dexspec' },
      spec('분류', move.damageClass === 'physical' ? '물리' : move.damageClass === 'special' ? '특수' : '변화'),
      spec('위력', move.power ? String(move.power) : '—'),
      spec('명중', move.accuracy ? `${move.accuracy}%` : '—'),
      spec('PP', move.pp ? String(move.pp) : '—'),
      move.priority !== 0 ? spec('우선도', move.priority > 0 ? `+${move.priority}` : String(move.priority)) : null,
    ),
  );

  const traits = traitsOf(move);
  if (traits.length > 0) {
    host.appendChild(
      el('div', { class: 'calc__traits' }, ...traits.map((t) => el('span', { class: `calc__trait calc__trait--${t.kind}` }, t.label))),
    );
  }

  // 기술 설명은 남긴다 — 도감에서는 설명이 본문이다.
  if (move.description) {
    host.appendChild(el('p', { class: 'dexdesc' }, move.description));
    if (move.descriptionIsFallback) {
      host.appendChild(el('p', { class: 'panel__meta' }, '한국어 설명이 없어 영문으로 표시합니다.'));
    }
  }
  // 정밀 효과(랭크·확률)는 공식 설명을 보강한다 — 도감에서는 이게 본문이다.
  for (const line of moveEffectLines(move)) {
    host.appendChild(el('p', { class: 'dexeffect' }, line));
  }

  host.appendChild(
    el('h4', { class: 'dexusers__title' }, `배울 수 있는 포켓몬 ${users.length}종`),
  );
  host.appendChild(monGrid(users.map((mon) => ({ mon, label: mon.displayName }))));
}

// ---------------------------------------------------------------------------
// 특성 도감
// ---------------------------------------------------------------------------

let abilityQuery = '';

export function renderAbilityDexView(container: HTMLElement, route: Route): void {
  clear(container);

  if (!state.ready) {
    container.appendChild(notice('loading', '불러오는 중…'));
    return;
  }

  const section = el('section', {}, el('h2', {}, '특성'));
  container.appendChild(section);

  const selected = route.query.get('a');
  if (selected) renderAbilityDetail(section, selected);
  else renderAbilityList(section);
}

function renderAbilityList(host: HTMLElement): void {
  const index = reverseIndex();
  const input = el('input', {
    class: 'search__input',
    type: 'search',
    value: abilityQuery,
    placeholder: '특성 검색 — 부유 / Levitate',
    'aria-label': '특성 검색',
  });
  const summary = el('p', { class: 'results__summary' });
  const list = el('div', { class: 'dexlist' });

  const draw = (): void => {
    clear(list);
    const query = abilityQuery.trim();
    const matches = index.abilityNames
      .map((name) => ({ name, korean: abilityName(state.terms, name) }))
      .filter((entry) => !query || matchesQuery(query, [entry.name, entry.korean]))
      .sort((a, b) => a.korean.localeCompare(b.korean, 'ko'));

    summary.textContent = `${query ? '검색 결과' : '전체'} ${matches.length}개`;
    if (matches.length === 0) {
      list.appendChild(notice('empty', '일치하는 특성이 없습니다.'));
      return;
    }

    for (const entry of matches) {
      const description = state.terms?.abilities.get(entry.name)?.description ?? null;
      list.appendChild(
        el(
          'a',
          // 특성 행은 타입 배지가 없어 열 구성이 기술 행과 다르다.
          // 기술용 격자를 그대로 쓰면 이름이 62px 배지 칸에 들어가 잘린다.
          { class: 'dexrow dexrow--ability', href: href(`/abilities?a=${encodeURIComponent(entry.name)}`) },
          el('span', { class: 'dexrow__name' }, entry.korean),
          description ? el('span', { class: 'dexrow__desc' }, description) : null,
        ),
      );
    }
  };

  input.addEventListener('input', () => {
    abilityQuery = input.value;
    draw();
  });

  host.appendChild(input);
  host.appendChild(el('div', { class: 'search__toolbar' }, summary));
  host.appendChild(list);
  draw();
  focusIfKeyboardLikely(input);
}

function renderAbilityDetail(host: HTMLElement, englishName: string): void {
  const index = reverseIndex();
  const users = index.abilityUsers.get(englishName);
  const entry = state.terms?.abilities.get(englishName);

  host.appendChild(backLink('/abilities', '← 특성 목록'));

  const head = el('div', { class: 'dexhead' });
  head.appendChild(el('h3', { class: 'dexhead__name' }, abilityName(state.terms, englishName)));
  head.appendChild(el('span', { class: 'dexhead__en' }, englishName));
  host.appendChild(head);

  // 특성 설명도 도감에서는 본문이라 남긴다 (계산기에서만 뺀다).
  if (entry?.description) {
    host.appendChild(el('p', { class: 'dexdesc' }, entry.description));
    if (entry.descriptionIsFallback) {
      host.appendChild(el('p', { class: 'panel__meta' }, '한국어 설명이 없어 영문으로 표시합니다.'));
    }
  }

  if (!users || users.length === 0) {
    host.appendChild(notice('empty', '이 특성을 가진 포켓몬이 없습니다.'));
    return;
  }

  host.appendChild(el('h4', { class: 'dexusers__title' }, `가진 포켓몬 ${users.length}종`));
  host.appendChild(
    monGrid(
      users.map((ref: FormRef) => ({
        mon: ref.mon,
        // 폼마다 특성이 다르므로 대표 폼이 아니면 어느 폼인지 밝힌다.
        label: ref.isPrimary ? ref.mon.displayName : `${ref.mon.displayName} · ${ref.form.formName}`,
        form: ref.form,
      })),
    ),
  );
}

// ---------------------------------------------------------------------------
// 공용
// ---------------------------------------------------------------------------

function spec(label: string, value: string): HTMLElement {
  return el('div', { class: 'dexspec__item' }, el('span', {}, label), el('strong', {}, value));
}

function backLink(path: string, label: string): HTMLElement {
  const link = el('a', { class: 'link dexback', href: href(path) }, label);
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(`#${path}`);
  });
  return link;
}

interface MonEntry {
  mon: Pokemon;
  label: string;
  form?: { spriteUrl: string; formName: string; types: string[] } | undefined;
}

function monGrid(entries: MonEntry[]): HTMLElement {
  const grid = el('div', { class: 'dexmons' });
  for (const entry of entries) {
    const form = entry.form ?? entry.mon.primary;
    grid.appendChild(
      el(
        'a',
        { class: 'dexmon', href: href(`/p/${encodeURIComponent(entry.mon.showdownId)}`) },
        sprite(form as never),
        el('span', { class: 'dexmon__name' }, entry.label),
      ),
    );
  }
  return grid;
}
