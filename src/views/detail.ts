/**
 * M2 포켓몬 상세 + M3 카운터 탭.
 *
 * 방어 규칙(설계 문서 M2): 없는 카테고리는 섹션째 숨긴다. 한 탭이 실패해도
 * 나머지 탭과 헤더는 정상적으로 남는다.
 *
 * 모델링 주의: 사용률은 **종(species)** 단위인데 Smogon C&C 는 **폼(form)** 단위다.
 * 헤더의 폼 선택은 수치·타입·카운터에만 영향을 주고, 사용률에는 영향을 주지 않는다.
 * 이 비대칭을 UI 에서 숨기지 않고 라벨로 명시한다.
 */

import { fetchUsage } from '../adapters/championsBattleData';
import { fetchMoveDex, type DamageClass, type MoveDex } from '../adapters/moveDex';
import { abilityName, natureName, statText, typeName, type TermDex } from '../adapters/termDex';
import { normalizeLearnset } from '../adapters/showdownLearnset';
import { countersUrl } from '../adapters/appConfig';
import { countersForSpecies, fetchCounters } from '../adapters/smogonCounters';
import { clear, el, fragment, notice } from '../core/dom';
import { matchesQuery } from '../core/names';
import { statRatio, toBaseStats } from '../core/stats';
import { formDisplayName } from '../core/formNames';
import { defensiveProfile } from '../core/typechart';
import { href } from '../router';
import { findPokemon, state } from '../store';
import type { CounterBlock, Pokemon, PokemonForm, TypeName, UsageReport } from '../types';
import {
  CATEGORY_LABEL,
  STAT_LABEL,
  counterLabel,
  moveRow,
  sectionTitle,
  termBar,
  smogonDisclaimer,
  sprite,
  typeBadge,
  usageBar,
} from './components';

type Tab = 'usage' | 'counters' | 'moves';

const TAB_LABEL: Record<Tab, string> = {
  usage: '사용률',
  counters: '카운터',
  moves: '기술 목록',
};

let activeTab: Tab = 'usage';
let activeFormSlug: string | null = null;

export function renderDetail(container: HTMLElement, showdownId: string): void {
  clear(container);

  if (!state.ready) {
    container.appendChild(notice('loading', '불러오는 중…'));
    return;
  }

  const mon = findPokemon(showdownId);
  if (!mon) {
    container.appendChild(
      fragment(
        notice('empty', `'${showdownId}' 를 로스터에서 찾지 못했습니다.`),
        el('a', { class: 'link', href: href('/') }, '← 검색으로 돌아가기'),
      ),
    );
    return;
  }

  // 다른 포켓몬으로 이동하면 폼 선택을 초기화한다.
  if (!mon.forms.some((f) => f.slug === activeFormSlug)) {
    activeFormSlug = mon.primary.slug || (mon.forms[0]?.slug ?? null);
  }

  const page = el('article', { class: 'detail' });
  container.appendChild(page);
  draw(page, mon);
}

function activeForm(mon: Pokemon): PokemonForm {
  return mon.forms.find((f) => f.slug === activeFormSlug) ?? mon.primary;
}

function draw(page: HTMLElement, mon: Pokemon): void {
  clear(page);
  const form = activeForm(mon);

  page.appendChild(header(mon, form, () => draw(page, mon)));

  const tabBar = el('nav', { class: 'tabs', role: 'tablist' });
  for (const tab of ['usage', 'counters', 'moves'] as Tab[]) {
    const button = el(
      'button',
      {
        class: `tabs__tab${tab === activeTab ? ' tabs__tab--active' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(tab === activeTab),
      },
      TAB_LABEL[tab],
    );
    button.addEventListener('click', () => {
      activeTab = tab;
      draw(page, mon);
    });
    tabBar.appendChild(button);
  }
  page.appendChild(tabBar);

  const panel = el('div', { class: 'tabs__panel', role: 'tabpanel' });
  page.appendChild(panel);

  if (activeTab === 'usage') renderUsagePanel(panel, mon);
  else if (activeTab === 'counters') renderCountersPanel(panel, mon, form);
  else renderMovesPanel(panel, mon);
}

function header(mon: Pokemon, form: PokemonForm, onFormChange: () => void): HTMLElement {
  const stats = form.stats;
  const base = toBaseStats(stats);
  const statRows = (['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const).map((key) => {
    const value = stats[key];
    return el(
      'div',
      { class: 'stat' },
      el('span', { class: 'stat__label' }, STAT_LABEL[key] ?? key),
      // 왼쪽이 종족값, 오른쪽이 실수치.
      el('span', { class: 'stat__base' }, base[key] === null ? '—' : String(base[key])),
      el(
        'span',
        { class: 'stat__track' },
        el('span', { class: 'stat__fill', style: `width:${statRatio(value)}%` }),
      ),
      el('span', { class: 'stat__value' }, String(value)),
    );
  });

  const formSelector =
    mon.forms.length > 1
      ? (() => {
          const select = el('select', { class: 'form-select', 'aria-label': '폼 선택' });
          for (const candidate of mon.forms) {
            const option = el('option', { value: candidate.slug }, formDisplayName(mon, candidate, state.index?.pokemon ?? []));
            if (candidate.slug === form.slug) option.setAttribute('selected', 'selected');
            select.appendChild(option);
          }
          select.addEventListener('change', () => {
            activeFormSlug = select.value;
            onFormChange();
          });
          return select;
        })()
      : null;

  const profile = defensiveProfile(form.types);

  return el(
    'header',
    { class: 'detail__header' },
    sprite(form, 'lg'),
    el(
      'div',
      { class: 'detail__meta' },
      el('h2', { class: 'detail__name' }, mon.displayName),
      mon.displayName !== mon.name ? el('p', { class: 'detail__alias' }, mon.name) : null,
      el('div', { class: 'detail__types' }, ...form.types.map(typeBadge)),
      formSelector,
      // 사용률을 보다가 바로 계산기로 넘어가는 흐름을 만든다.
      el(
        'p',
        { class: 'detail__actions' },
        el(
          'a',
          { class: 'link', href: href(`/calc?a=${encodeURIComponent(mon.showdownId)}`) },
          '이 포켓몬으로 대미지 계산 →',
        ),
      ),
      el(
        'p',
        { class: 'detail__abilities' },
        `특성: ${form.abilities.map((a) => abilityName(state.terms,a)).join(', ') || '—'}`,
        form.hiddenAbility
          ? ` · 숨겨진 특성: ${abilityName(state.terms,form.hiddenAbility)}`
          : '',
      ),
      el(
        'div',
        { class: 'stats' },
        el(
          'div',
          { class: 'stat stat--head' },
          el('span', { class: 'stat__label' }, ''),
          el('span', { class: 'stat__base' }, '종족값'),
          el('span', {}, ''),
          el('span', { class: 'stat__value' }, '실수치'),
        ),
        ...statRows,
        el(
          'div',
          { class: 'stat stat--total' },
          el('span', { class: 'stat__label' }, '합계'),
          el('span', { class: 'stat__base' }, base.total === null ? '—' : String(base.total)),
          el('span', {}, ''),
          el('span', { class: 'stat__value' }, String(stats.total)),
        ),
      ),
      weaknessSummary(profile),
    ),
  );
}

function weaknessSummary(profile: ReturnType<typeof defensiveProfile>): HTMLElement {
  const group = (label: string, items: { multiplier: number; types: string[] }[]) =>
    items.length === 0
      ? null
      : el(
          'div',
          { class: 'weak__group' },
          el('span', { class: 'weak__label' }, label),
          ...items.map((entry) =>
            el(
              'span',
              { class: 'weak__item' },
              // 타입 배지는 한국어인데 여기만 영문이면 같은 화면에서 표기가 갈린다.
              `×${entry.multiplier} ${entry.types.map((t) => typeName(state.terms, t as TypeName)).join(', ')}`,
            ),
          ),
        );

  return el(
    'div',
    { class: 'weak' },
    group('약점', profile.weaknesses),
    group('내성', profile.resistances),
    profile.immunities.length > 0
      ? el(
          'div',
          { class: 'weak__group' },
          el('span', { class: 'weak__label' }, '무효'),
          el(
            'span',
            { class: 'weak__item' },
            profile.immunities.map((t) => typeName(state.terms, t as TypeName)).join(', '),
          ),
        )
      : null,
  );
}

function renderUsagePanel(panel: HTMLElement, mon: Pokemon): void {
  panel.appendChild(notice('loading', `${state.format === 'Singles' ? '싱글' : '더블'} 사용률을 불러오는 중…`));

  // 기술 도감은 있으면 좋은 보강이지 필수가 아니다. 실패해도 사용률은 그린다.
  // 용어 도감은 부팅 때 이미 받아 스토어에 있다.
  Promise.all([fetchUsage(mon.showdownId, state.format), fetchMoveDex()])
    .then(([report, moveResult]) => {
      clear(panel);
      panel.appendChild(
        usageSections(report, mon, moveResult.status === 'ok' ? moveResult.data : null, state.terms),
      );
    })
    .catch((err: unknown) => {
      clear(panel);
      panel.appendChild(
        notice(
          'error',
          `사용률 데이터를 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    });
}

function usageSections(
  report: UsageReport,
  mon: Pokemon,
  dex: MoveDex | null,
  terms: TermDex | null,
): DocumentFragment {
  if (report.blocks.length === 0) {
    return fragment(notice('empty', '이 포맷에서는 집계된 사용률이 없습니다.'));
  }

  const frag = document.createDocumentFragment();
  frag.appendChild(
    el(
      'p',
      { class: 'panel__meta' },
      `${report.season} 시즌 · ${report.format === 'Singles' ? '싱글' : '더블'}`,
      report.date ? ` · ${report.date}` : '',
      mon.forms.length > 1 ? ' · 사용률은 폼 구분 없이 종 단위로 집계됩니다.' : '',
    ),
  );

  for (const block of report.blocks) {
    const section = el('section', { class: 'section' });
    section.appendChild(
      sectionTitle(
        CATEGORY_LABEL[block.category] ?? block.category,
        block.category === 'teammate' ? 'championsbattledata 는 파트너 비율을 제공하지 않습니다' : undefined,
      ),
    );

    for (const entry of block.entries) {
      if (block.category === 'move' && entry.name) {
        // 기술은 이름만으로 부족하다 — 위력·명중·PP·설명을 함께 붙인다.
        section.appendChild(
          moveRow(entry.name, dex?.get(entry.name) ?? null, {
            percentage: entry.percentage,
            percentageValue: entry.percentageValue,
          }),
        );
        continue;
      }
      if (block.category === 'stat_points' && entry.points) {
        // 노력치 행은 이름이 비어 있어 분배 자체를 라벨로 만든다.
        const spread = (['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const)
          .map((key) => `${STAT_LABEL[key]} ${entry.points?.[key] ?? 0}`)
          .filter((text) => !text.endsWith(' 0'))
          .join(' / ');
        section.appendChild(usageBar(spread || '분배 없음', entry.percentage, entry.percentageValue));
        continue;
      }
      if (block.category === 'held_item' && entry.name) {
        const item = terms?.items.get(entry.name) ?? null;
        section.appendChild(
          termBar(item?.displayName ?? entry.name, entry, item?.description ?? null),
        );
        continue;
      }
      if (block.category === 'ability' && entry.name) {
        const ability = terms?.abilities.get(entry.name) ?? null;
        section.appendChild(
          termBar(ability?.displayName ?? entry.name, entry, ability?.description ?? null),
        );
        continue;
      }
      if (block.category === 'stat_alignment' && entry.statUp) {
        // 성격명과 보정 스탯을 모두 한국어로. "Jolly (+Speed / −Sp. Atk)" → "명랑 (+스피드 / −특수공격)"
        const label = `${natureName(terms, entry.name)} (+${statText(entry.statUp)} / −${statText(entry.statDown)})`;
        section.appendChild(usageBar(label, entry.percentage, entry.percentageValue));
        continue;
      }
      if (block.category === 'teammate' && entry.name) {
        const mate = findByName(entry.name);
        const row = usageBar(entry.name, entry.percentage, entry.percentageValue);
        if (mate) {
          const link = el(
            'a',
            { class: 'bar__link', href: href(`/p/${encodeURIComponent(mate.showdownId)}`) },
            entry.name,
          );
          row.replaceChild(link, row.firstChild as Node);
        }
        section.appendChild(row);
        continue;
      }
      section.appendChild(usageBar(entry.name, entry.percentage, entry.percentageValue));
    }

    frag.appendChild(section);
  }

  return frag;
}

/** 파트너 이름(영문 표시명)으로 로스터를 되짚는다. 못 찾으면 링크 없이 텍스트로 둔다. */
function findByName(name: string): Pokemon | null {
  const list = state.index?.pokemon ?? [];
  return list.find((mon) => mon.name === name) ?? null;
}

function renderCountersPanel(panel: HTMLElement, mon: Pokemon, form: PokemonForm): void {
  panel.appendChild(notice('loading', '카운터 데이터를 불러오는 중…'));

  fetchCounters(countersUrl(state.config, state.format), state.format).then((result) => {
    clear(panel);

    if (result.status !== 'ok') {
      panel.appendChild(smogonDisclaimer(null));
      panel.appendChild(
        notice(result.status === 'empty' ? 'empty' : 'error', result.reason),
      );
      return;
    }

    const blocks = countersForSpecies(
      result.data,
      mon.showdownId,
      mon.forms.map((f) => f.savedName),
    );
    if (blocks.length === 0) {
      panel.appendChild(smogonDisclaimer(null));
      panel.appendChild(
        notice('empty', 'Smogon 통계에 이 포켓몬의 Checks & Counters 표본이 없습니다.'),
      );
      return;
    }

    panel.appendChild(smogonDisclaimer(blocks[0] ?? null));

    // 폼별로 나눠 보여준다 — Smogon 은 메가/지역폼을 별개 개체로 집계하기 때문.
    // 현재 선택된 폼을 맨 앞으로 올려 헤더와 시선이 이어지게 한다.
    const ordered = [...blocks].sort((a, b) => {
      if (a.targetSavedName === form.savedName) return -1;
      if (b.targetSavedName === form.savedName) return 1;
      return a.targetSavedName.localeCompare(b.targetSavedName);
    });
    for (const block of ordered) {
      panel.appendChild(counterSection(block.targetSavedName, block));
    }
  });
}

function counterSection(targetName: string, block: CounterBlock): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(sectionTitle(`${targetName} 를 상대하는 포켓몬`, '95% 하한 기준 정렬'));

  const table = el('table', { class: 'counters' });
  table.appendChild(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, '포켓몬'),
        el('th', {}, '우위'),
        el('th', {}, '표본'),
      ),
    ),
  );

  const body = el('tbody');
  for (const entry of block.entries) {
    const nameCell = el('td');
    nameCell.appendChild(counterLabel(entry));

    body.appendChild(
      el(
        'tr',
        {},
        nameCell,
        el('td', {}, `${(entry.p * 100).toFixed(1)}%`),
        el('td', { class: 'counters__n' }, entry.n.toLocaleString('ko-KR')),
      ),
    );
  }
  table.appendChild(body);
  section.appendChild(table);
  return section;
}

function renderMovesPanel(panel: HTMLElement, mon: Pokemon): void {
  panel.appendChild(notice('loading', '기술 목록을 정리하는 중…'));

  Promise.all([fetchUsage(mon.showdownId, state.format).catch(() => null), fetchMoveDex()])
    .then(([report, dexResult]) => {
      clear(panel);
      const dex = dexResult.status === 'ok' ? dexResult.data : null;
      const view = normalizeLearnset(mon, report);

      if (view.total === 0) {
        panel.appendChild(notice('empty', '기술 목록 데이터가 없습니다.'));
        return;
      }

      if (dex === null) {
        panel.appendChild(
          notice('error', '기술 도감을 불러오지 못해 영문 이름만 표시합니다.'),
        );
      }

      if (view.used.length > 0) {
        const section = el('section', { class: 'section' });
        section.appendChild(sectionTitle('실전에서 채택된 기술', `${view.used.length}개`));
        for (const move of view.used) {
          section.appendChild(
            moveRow(move.name, dex?.get(move.name) ?? null, {
              percentage: move.percentage,
              percentageValue: move.percentageValue,
            }),
          );
        }
        panel.appendChild(section);
      }

      panel.appendChild(learnsetSection(view.unused, view.total, dex));
    });
}

/**
 * 배울 수 있는 나머지 기술. 종당 수십 개라 그냥 나열하면 훑기 어려워
 * 검색과 분류 필터를 붙인다. 검색은 한국어·영어 둘 다 걸린다.
 */
function learnsetSection(unused: string[], total: number, dex: MoveDex | null): HTMLElement {
  const section = el('section', { class: 'section' });
  section.appendChild(
    sectionTitle('배울 수 있는 나머지 기술', `${unused.length} / 전체 ${total}개`),
  );

  let query = '';
  let damageClass: DamageClass | 'all' = 'all';

  const list = el('div', { class: 'movelist' });

  const draw = (): void => {
    clear(list);
    const matched = unused.filter((name) => {
      const move = dex?.get(name) ?? null;
      if (damageClass !== 'all' && move?.damageClass !== damageClass) return false;
      if (!query.trim()) return true;
      return matchesQuery(query, [name, move?.koreanName, move?.japaneseName]);
    });

    if (matched.length === 0) {
      list.appendChild(notice('empty', '조건에 맞는 기술이 없습니다.'));
      return;
    }
    for (const name of matched) list.appendChild(moveRow(name, dex?.get(name) ?? null));
  };

  const search = el('input', {
    class: 'movelist__search',
    type: 'search',
    placeholder: '기술 검색 — 지진 / Earthquake',
    'aria-label': '기술 검색',
  });
  search.addEventListener('input', () => {
    query = search.value;
    draw();
  });

  const filters = el('div', { class: 'movelist__filters', role: 'group', 'aria-label': '분류 필터' });
  const options: [DamageClass | 'all', string][] = [
    ['all', '전체'],
    ['physical', '물리'],
    ['special', '특수'],
    ['status', '변화'],
  ];
  const buttons = new Map<DamageClass | 'all', HTMLElement>();
  for (const [value, label] of options) {
    const button = el('button', { class: 'movelist__filter', type: 'button' }, label);
    if (value === damageClass) button.classList.add('movelist__filter--active');
    button.addEventListener('click', () => {
      damageClass = value;
      for (const [key, node] of buttons) node.classList.toggle('movelist__filter--active', key === value);
      draw();
    });
    buttons.set(value, button);
    filters.appendChild(button);
  }

  section.appendChild(search);
  section.appendChild(filters);
  section.appendChild(list);
  draw();
  return section;
}
