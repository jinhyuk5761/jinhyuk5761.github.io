/**
 * 통계 — 상위 랭커 구축 집계.
 *
 * 검색 탭의 사용률은 래더 **전체**를 훑은 값이고, 여기는 시즌 상위 랭커의 **실제 팀**이다.
 * 표본이 다르므로 서로 대체하지 않는다. 상위권에서만 유독 많이 쓰이는 조합이 있어서
 * 두 숫자가 어긋나는 것 자체가 정보다.
 *
 * 시즌은 화면 안에서 고르고, 싱글·더블은 위쪽 공용 토글을 따른다.
 */

import { fetchRankedTeams, type RankedSet } from '../adapters/rankedTeams';
import { clear, el, notice } from '../core/dom';
import { href } from '../router';
import { state } from '../store';
import { searchSelect } from './searchSelect';

/** 마지막으로 본 시즌. 포맷을 바꿔도 보던 시즌은 유지한다. */
let activeSeason: number | null = null;

export function renderStats(container: HTMLElement): void {
  clear(container);
  const page = el('section', { class: 'stats' });
  container.appendChild(page);
  page.appendChild(notice('loading', '구축 데이터를 불러오는 중…'));

  fetchRankedTeams()
    .then((data) => {
      clear(page);
      if (data.sets.length === 0) {
        page.appendChild(notice('empty', '집계된 구축 데이터가 없습니다.'));
        return;
      }
      draw(page, data.sets, data.source);
    })
    .catch(() => {
      clear(page);
      page.appendChild(notice('error', '구축 데이터를 불러오지 못했습니다.'));
    });
}

function draw(page: HTMLElement, sets: RankedSet[], source: string): void {
  const seasons = [...new Set(sets.map((s) => s.seasonNumber))].sort((a, b) => b - a);
  if (activeSeason === null || !seasons.includes(activeSeason)) {
    activeSeason = seasons[0] ?? null;
  }

  const body = el('div', { class: 'stats__body' });

  const pick = (): RankedSet | null =>
    sets.find((s) => s.seasonNumber === activeSeason && s.format === state.format) ?? null;

  const paint = (): void => {
    clear(body);
    const set = pick();
    if (!set) {
      body.appendChild(
        notice('empty', `${state.format === 'Singles' ? '싱글' : '더블'} 집계가 이 시즌에는 없습니다.`),
      );
      return;
    }
    body.appendChild(summary(set, source));
    body.appendChild(pokemonTable(set));
    body.appendChild(itemTable(set));
    body.appendChild(pairTable(set));
  };

  const seasonPicker = searchSelect({
    options: seasons.map((n) => {
      const label = sets.find((s) => s.seasonNumber === n)?.season ?? `M-${n}`;
      return { value: String(n), label: `시즌 ${label}` };
    }),
    value: String(activeSeason),
    placeholder: '시즌',
    ariaLabel: '시즌 선택',
    className: 'stats__season',
    onPick: (raw) => {
      activeSeason = Number(raw);
      paint();
    },
  });

  page.appendChild(
    el(
      'header',
      { class: 'stats__head' },
      el('h2', {}, '상위 랭커 구축'),
      seasonPicker,
    ),
  );
  page.appendChild(body);
  paint();
  // 싱글·더블 토글은 store 가 셸을 통째로 다시 그리므로 여기서 따로 구독하지 않는다.
  // 시즌 선택은 모듈 변수에 남아 있어 포맷을 바꿔도 보던 시즌이 유지된다.
}

function summary(set: RankedSet, source: string): HTMLElement {
  return el(
    'p',
    { class: 'stats__meta' },
    `${set.season} · ${set.format === 'Singles' ? '싱글' : '더블'} · 상위 ${set.teamCount}팀 ${set.slotCount}마리`,
    el('br', {}),
    // 우리가 받은 시각이 아니라 원본이 집계된 시각이다. 헷갈리지 않게 밝힌다.
    el('span', { class: 'stats__source' }, `${source} · ${set.updatedAt} 집계`),
  );
}

/** 이름을 누르면 상세로. 로스터에 없으면 글자만 둔다. */
function monLink(name: string, showdownId: string | null): HTMLElement | Text {
  if (!showdownId) return document.createTextNode(name);
  return el('a', { class: 'link', href: href(`/p/${encodeURIComponent(showdownId)}`) }, name);
}

function shareCell(share: number): HTMLElement {
  return el(
    'span',
    { class: 'stats__bar' },
    el('span', { class: 'stats__fill', style: `width:${Math.min(100, share)}%` }),
    el('span', { class: 'stats__pct' }, `${share}%`),
  );
}

function pokemonTable(set: RankedSet): HTMLElement {
  const rows = set.pokemon.slice(0, 40);
  const list = el('div', { class: 'stats__list' });
  rows.forEach((row, i) => {
    list.appendChild(
      el(
        'div',
        { class: 'stats__row' },
        el('span', { class: 'stats__rank' }, String(i + 1)),
        el('span', { class: 'stats__name' }, monLink(row.name, row.showdownId)),
        shareCell(row.share),
        // 이 포켓몬이 실제로 뭘 들었는지가 채용률만큼 중요하다.
        el(
          'span',
          { class: 'stats__sub' },
          row.items.map((it) => `${it.name} ${it.share}%`).join(' · ') || '—',
        ),
      ),
    );
  });
  return el(
    'section',
    { class: 'stats__section' },
    el('h3', {}, '채용률'),
    el('p', { class: 'stats__note' }, `${set.teamCount}팀 중 몇 팀에 들어갔는지. 아래는 그 안에서 많이 든 도구.`),
    list,
  );
}

function itemTable(set: RankedSet): HTMLElement {
  const list = el('div', { class: 'stats__list' });
  set.items.slice(0, 20).forEach((row, i) => {
    list.appendChild(
      el(
        'div',
        { class: 'stats__row stats__row--slim' },
        el('span', { class: 'stats__rank' }, String(i + 1)),
        el('span', { class: 'stats__name' }, row.name),
        shareCell(row.share),
      ),
    );
  });
  return el(
    'section',
    { class: 'stats__section' },
    el('h3', {}, '도구'),
    el('p', { class: 'stats__note' }, `${set.slotCount}마리 중 몇 마리가 들었는지.`),
    list,
  );
}

function pairTable(set: RankedSet): HTMLElement {
  const list = el('div', { class: 'stats__list' });
  set.pairs.slice(0, 20).forEach((row, i) => {
    list.appendChild(
      el(
        'div',
        { class: 'stats__row stats__row--slim' },
        el('span', { class: 'stats__rank' }, String(i + 1)),
        el('span', { class: 'stats__name' }, `${row.a} + ${row.b}`),
        shareCell(row.share),
      ),
    );
  });
  return el(
    'section',
    { class: 'stats__section' },
    el('h3', {}, '함께 쓰인 조합'),
    el('p', { class: 'stats__note' }, '같은 팀에 함께 들어간 두 마리.'),
    list,
  );
}
