/**
 * M4 — 두 포켓몬 비교.
 *
 * 좌우 나란히 놓고 세 가지를 강조한다:
 *   1. 타입 상성 — 서로의 타입으로 상대를 때렸을 때 배율
 *   2. 스피드 라인 — 어느 쪽이 먼저 움직이는가
 *   3. 공통 카운터 — 둘 다 잡히는 상대
 *
 * 선택 상태는 URL 쿼리(?a=&b=)에 실어 링크 공유가 되게 한다.
 */

import { countersUrl } from '../adapters/appConfig';
import { countersForSpecies, fetchCounters, sharedCounters } from '../adapters/smogonCounters';
import { searchHaystack } from '../adapters/pokeApi';
import { matchesQuery } from '../core/names';
import { clear, el, notice } from '../core/dom';
import { STAT_BASIS_LABEL, toBaseStats } from '../core/stats';
import { defensiveProfile, effectiveness } from '../core/typechart';
import { navigate, type Route } from '../router';
import { findPokemon, state } from '../store';
import type { CounterEntry, Pokemon } from '../types';
import {
  STAT_LABEL,
  counterLabel,
  sectionTitle,
  smogonDisclaimer,
  sprite,
  typeBadge,
} from './components';

export function renderCompare(container: HTMLElement, route: Route): void {
  clear(container);

  if (!state.ready) {
    container.appendChild(notice('loading', '불러오는 중…'));
    return;
  }

  const left = findPokemon(route.query.get('a') ?? '');
  const right = findPokemon(route.query.get('b') ?? '');

  const page = el('section', { class: 'compare' }, el('h2', {}, '두 포켓몬 비교'));

  page.appendChild(
    el(
      'div',
      { class: 'compare__pickers' },
      picker('a', left, route),
      el('span', { class: 'compare__vs' }, 'VS'),
      picker('b', right, route),
    ),
  );

  if (!left || !right) {
    page.appendChild(notice('empty', '비교할 포켓몬 두 마리를 선택하세요.'));
    container.appendChild(page);
    return;
  }

  page.appendChild(statTable(left, right));
  page.appendChild(matchupSection(left, right));
  const countersSection = el('div');
  page.appendChild(countersSection);
  container.appendChild(page);

  renderSharedCounters(countersSection, left, right);
}

function picker(slot: 'a' | 'b', selected: Pokemon | null, route: Route): HTMLElement {
  const wrap = el('div', { class: 'picker' });

  if (selected) {
    wrap.appendChild(sprite(selected.primary, 'lg'));
    wrap.appendChild(el('p', { class: 'picker__name' }, selected.displayName));
    wrap.appendChild(el('div', { class: 'picker__types' }, ...selected.primary.types.map(typeBadge)));
  }

  const input = el('input', {
    class: 'picker__input',
    type: 'search',
    placeholder: selected ? '다른 포켓몬으로 변경' : '포켓몬 검색',
    'aria-label': slot === 'a' ? '왼쪽 포켓몬' : '오른쪽 포켓몬',
  });
  const suggestions = el('div', { class: 'picker__suggestions' });

  input.addEventListener('input', () => {
    clear(suggestions);
    const query = input.value.trim();
    if (query.length === 0) return;
    const matches = (state.index?.pokemon ?? [])
      .filter((mon) => matchesQuery(query, searchHaystack(mon, state.locales)))
      .slice(0, 8);
    for (const mon of matches) {
      const button = el('button', { class: 'picker__option', type: 'button' }, mon.displayName);
      button.addEventListener('click', () => {
        const next = new URLSearchParams(route.query);
        next.set(slot, mon.showdownId);
        navigate(`#/compare?${next.toString()}`);
      });
      suggestions.appendChild(button);
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(suggestions);
  return wrap;
}

function statTable(left: Pokemon, right: Pokemon): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(sectionTitle('실수치', STAT_BASIS_LABEL));

  const table = el('table', { class: 'compare__table' });
  const body = el('tbody');

  const baseLeft = toBaseStats(left.primary.stats);
  const baseRight = toBaseStats(right.primary.stats);

  const keys = ['hp', 'atk', 'def', 'spa', 'spd', 'spe', 'total'] as const;
  for (const key of keys) {
    const a = left.primary.stats[key];
    const b = right.primary.stats[key];
    // 종족값을 괄호로 덧붙인다 — 본가 수치와 대조하려면 이쪽이 필요하다.
    const cell = (value: number, base: number | null, win: boolean, lose: boolean) =>
      el(
        'td',
        { class: win ? 'compare__win' : lose ? 'compare__lose' : '' },
        String(value),
        base === null ? null : el('span', { class: 'compare__base' }, ` (${base})`),
      );
    body.appendChild(
      el(
        'tr',
        {},
        cell(a, baseLeft[key], a > b, a < b),
        el('th', {}, key === 'total' ? '합계' : STAT_LABEL[key] ?? key),
        cell(b, baseRight[key], b > a, b < a),
      ),
    );
  }
  table.appendChild(body);
  section.appendChild(table);
  section.appendChild(
    el('p', { class: 'compare__hint' }, '괄호 안은 역산한 종족값입니다.'),
  );

  // 스피드 라인은 선공 여부를 결정하므로 따로 문장으로 못박는다.
  const speedA = left.primary.stats.spe;
  const speedB = right.primary.stats.spe;
  const verdict =
    speedA === speedB
      ? '스피드 실수치가 같습니다. 노력치·성격·도구가 선공을 가릅니다.'
      : `${(speedA > speedB ? left : right).displayName} 가 스피드 ${Math.abs(speedA - speedB)} 만큼 빠릅니다 (같은 노력치·성격 기준).`;
  section.appendChild(el('p', { class: 'compare__verdict' }, verdict));

  return section;
}

function matchupSection(left: Pokemon, right: Pokemon): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(sectionTitle('타입 상성', '자신의 타입으로 상대를 때렸을 때'));

  const line = (attacker: Pokemon, defender: Pokemon) => {
    const rows = attacker.primary.types.map((type) => {
      const multiplier = effectiveness(type, defender.primary.types);
      const tone = multiplier > 1 ? 'good' : multiplier < 1 ? 'bad' : 'flat';
      return el(
        'li',
        { class: `matchup matchup--${tone}` },
        `${type} → ${defender.displayName} : ×${multiplier}`,
      );
    });
    return el(
      'div',
      { class: 'matchup__side' },
      el('h4', {}, `${attacker.displayName} 공격`),
      el('ul', {}, ...rows),
    );
  };

  section.appendChild(el('div', { class: 'matchup__grid' }, line(left, right), line(right, left)));

  const weakLine = (mon: Pokemon) => {
    const profile = defensiveProfile(mon.primary.types);
    const worst = profile.weaknesses[0];
    return el(
      'p',
      { class: 'matchup__weak' },
      `${mon.displayName} 최대 약점: ${worst ? `×${worst.multiplier} ${worst.types.join(', ')}` : '없음'}`,
    );
  };
  section.appendChild(weakLine(left));
  section.appendChild(weakLine(right));

  return section;
}

function renderSharedCounters(container: HTMLElement, left: Pokemon, right: Pokemon): void {
  container.appendChild(notice('loading', '공통 카운터를 계산하는 중…'));

  fetchCounters(countersUrl(state.config, state.format), state.format).then((result) => {
    clear(container);
    if (result.status !== 'ok') {
      container.appendChild(notice(result.status === 'empty' ? 'empty' : 'error', result.reason));
      return;
    }

    const flatten = (mon: Pokemon): CounterEntry[] =>
      countersForSpecies(result.data, mon.showdownId, mon.forms.map((f) => f.savedName)).flatMap(
        (block) => block.entries,
      );

    const shared = sharedCounters(flatten(left), flatten(right));

    const section = el('section', { class: 'section' });
    section.appendChild(sectionTitle('공통 카운터', '두 마리 모두를 상대로 우위인 포켓몬'));
    section.appendChild(smogonDisclaimer(null));

    if (shared.length === 0) {
      section.appendChild(notice('empty', '두 포켓몬을 동시에 잡는 공통 카운터가 표본에 없습니다.'));
    } else {
      const list = el('ul', { class: 'shared' });
      for (const entry of shared.slice(0, 20)) {
        const item = el('li', { class: 'shared__item' });
        item.appendChild(counterLabel(entry));
        // 양쪽 중 낮은 우위를 쓴다 — '둘 다' 잡아야 공통 카운터다.
        item.appendChild(el('span', { class: 'shared__p' }, ` 최소 우위 ${(entry.p * 100).toFixed(1)}%`));
        list.appendChild(item);
      }
      section.appendChild(list);
    }

    container.appendChild(section);
  });
}
