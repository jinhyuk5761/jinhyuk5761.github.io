/**
 * 통계 — 상위 랭커 구축 집계.
 *
 * 검색 탭의 사용률은 래더 **전체**를 훑은 값이고, 여기는 시즌 상위 랭커의 **실제 팀**이다.
 * 표본이 다르므로 서로 대체하지 않는다. 상위권에서만 유독 많이 쓰이는 조합이 있어서
 * 두 숫자가 어긋나는 것 자체가 정보다.
 *
 * 시즌은 화면 안에서 고르고, 싱글·더블은 위쪽 공용 토글을 따른다.
 */

import {
  fetchRankedTeams,
  pokedbFormUrl,
  type RankedSet,
  type RankedTeam,
} from '../adapters/rankedTeams';
import { clear, el, notice } from '../core/dom';
import { href } from '../router';
import { findPokemon, state } from '../store';
import { sprite, spriteFallbacks } from './components';
import { searchSelect } from './searchSelect';

/** 한 번에 보여줄 팀 수. 시즌에 따라 500팀이 넘어 전부 그리면 느리다. */
const PAGE = 20;

/** 안내문에 붙일 실패 사유. 무엇이 잘못됐는지 사람이 읽을 수 있어야 고칠 수 있다. */
function reason(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 마지막으로 본 시즌. 포맷을 바꿔도 보던 시즌은 유지한다. */
let activeSeason: number | null = null;

export function renderStats(container: HTMLElement): void {
  clear(container);
  const page = el('section', { class: 'stats' });
  container.appendChild(page);
  page.appendChild(notice('loading', '구축 데이터를 불러오는 중…'));

  /*
   * 받는 것과 그리는 것을 갈라 잡는다.
   *
   * 예전에는 하나의 catch 로 묶어서 "불러오지 못했습니다" 만 띄웠는데,
   * `.catch` 는 `.then` 안에서 난 예외도 잡는다 — 화면을 그리다 터진 것과
   * 네트워크가 끊긴 것이 같은 문구로 보여서 어느 쪽인지 알 수 없었다.
   */
  fetchRankedTeams().then(
    (data) => {
      clear(page);
      if (data.sets.length === 0) {
        page.appendChild(notice('empty', '집계된 구축 데이터가 없습니다.'));
        return;
      }
      try {
        draw(page, data.sets, data.source);
      } catch (error) {
        clear(page);
        page.appendChild(notice('error', `구축 화면을 그리지 못했습니다: ${reason(error)}`));
      }
    },
    (error) => {
      clear(page);
      page.appendChild(notice('error', `구축 데이터를 받지 못했습니다: ${reason(error)}`));
    },
  );
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
    body.appendChild(teamList(set));
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

/** 팀 한 개. 순위·레이팅과 여섯 마리를 보여준다. */
function teamCard(team: RankedTeam): HTMLElement {
  const members = el('div', { class: 'team__members' });
  for (const m of team.members) {
    // 로스터에 있으면 스프라이트를 붙인다. 없으면 이름만 둔다.
    const mon = m.id ? findPokemon(m.id) : null;
    const cell = el('div', { class: 'team__mon' });
    if (mon) cell.appendChild(sprite(mon.primary, 'sm', spriteFallbacks(mon, mon.primary)));
    cell.appendChild(
      el(
        'span',
        { class: 'team__name' },
        m.id
          ? el('a', { class: 'link', href: href(`/p/${encodeURIComponent(m.id)}`) }, m.name)
          : document.createTextNode(m.name),
      ),
    );
    cell.appendChild(el('span', { class: 'team__item' }, m.item ?? '—'));
    /*
     * 이 폼을 쓴 구축글이 모여 있는 곳으로 보낸다.
     *
     * 노력치·기술·닉네임은 우리가 가진 데이터에 없다. 그건 사람이 쓴 구축글에 있고,
     * 그 글들은 호스트마다 약관이 달라 자동으로 가져올 수 없다. 대신 한 번에 갈 수
     * 있게 길만 놓는다 — 가져오는 게 아니라 읽으러 가는 링크다.
     */
    if (m.dex) {
      cell.appendChild(
        el(
          'a',
          {
            class: 'team__more-link',
            href: pokedbFormUrl(m.dex),
            target: '_blank',
            rel: 'noopener noreferrer',
            title: `${m.name} 을 쓴 구축글 보기 (pokedb)`,
          },
          '구축글',
        ),
      );
    }
    members.appendChild(cell);
  }

  return el(
    'article',
    { class: 'team' },
    el(
      'header',
      { class: 'team__head' },
      el('span', { class: 'team__rank' }, `${team.rank}위`),
      el('span', { class: 'team__rating' }, team.rating === null ? '' : `레이팅 ${team.rating}`),
    ),
    members,
  );
}

function teamList(set: RankedSet): HTMLElement {
  const list = el('div', { class: 'team__list' });
  let shown = 0;

  const more = el('button', { class: 'team__more', type: 'button' });
  const step = (): void => {
    const next = set.teams.slice(shown, shown + PAGE);
    for (const team of next) list.appendChild(teamCard(team));
    shown += next.length;
    if (shown >= set.teams.length) {
      more.remove();
      return;
    }
    more.textContent = `더 보기 (${shown} / ${set.teams.length})`;
  };
  more.addEventListener('click', step);
  step();

  return el(
    'section',
    { class: 'stats__section' },
    el('h3', {}, '구축'),
    el('p', { class: 'stats__note' }, '시즌 상위 랭커가 실제로 쓴 팀. 순위가 높은 쪽부터.'),
    list,
    more,
  );
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
