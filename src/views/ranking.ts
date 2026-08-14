/**
 * M6 — 트레이너 랭킹 (C등급, 옵션)
 *
 * 이 화면이 없어도 M1~M5 는 완전히 동작한다. flag 가 꺼져 있으면 탭 자체가 뜨지 않고,
 * 켜져 있어도 서버가 응답하지 않으면 안내문으로 대체된다.
 *
 * 승/패/승률/연승은 공개 랭킹 범위(상위 N위) 안에서만 존재한다 — 화면에 명시한다.
 */

import { fetchRanking } from '../adapters/officialRanking';
import { clear, el, notice } from '../core/dom';
import { state } from '../store';

export function renderRanking(container: HTMLElement): void {
  clear(container);

  const page = el('section', { class: 'ranking' }, el('h2', {}, '트레이너 랭킹'));
  container.appendChild(page);

  page.appendChild(
    el(
      'div',
      { class: 'disclaimer' },
      el(
        'p',
        {},
        '공식 공개 랭킹을 서버에서 캐싱해 보여줍니다. 비공식 참조이며 언제든 제공이 중단될 수 있습니다.',
      ),
    ),
  );

  if (!state.config.ranking.enabled) {
    page.appendChild(
      notice(
        'empty',
        state.config.serverBacked
          ? '랭킹 데이터가 아직 연결되지 않았습니다. 서버에 CHAMPIONS_RANKING_ENABLED=1 과 CHAMPIONS_RANKING_URL 을 설정하면 자동으로 나타납니다.'
          : '랭킹은 서버가 있어야 동작합니다. npm run serve 로 실행하세요.',
      ),
    );
    return;
  }

  const host = el('div');
  page.appendChild(host);
  host.appendChild(notice('loading', '랭킹을 불러오는 중…'));

  fetchRanking().then((result) => {
    clear(host);

    if (result.status !== 'ok') {
      host.appendChild(notice(result.status === 'empty' ? 'empty' : 'error', result.reason));
      return;
    }

    const { rows, coverageLimit, fetchedAt, stale } = result.data;

    host.appendChild(
      el(
        'p',
        { class: 'panel__meta' },
        coverageLimit ? `공개 범위: 상위 ${coverageLimit}위까지` : '공개 범위 미상',
        fetchedAt ? ` · 수집 ${new Date(fetchedAt).toLocaleString('ko-KR')}` : '',
        stale ? ' · 상류 응답 실패로 이전 캐시를 표시 중' : '',
      ),
    );

    const table = el('table', { class: 'ranking__table' });
    table.appendChild(
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', {}, '순위'),
          el('th', {}, '트레이너'),
          el('th', {}, '점수'),
          el('th', {}, '승'),
          el('th', {}, '패'),
          el('th', {}, '승률'),
          el('th', {}, '연승'),
        ),
      ),
    );

    const body = el('tbody');
    const cell = (value: number | string | null, suffix = '') =>
      el('td', {}, value === null ? '—' : `${value}${suffix}`);

    for (const row of rows) {
      body.appendChild(
        el(
          'tr',
          {},
          el('td', {}, String(row.rank)),
          el(
            'td',
            {},
            row.country ? el('span', { class: 'ranking__country' }, row.country) : null,
            row.nickname,
          ),
          cell(row.points),
          cell(row.wins),
          cell(row.losses),
          cell(row.winRate === null ? null : row.winRate.toFixed(1), '%'),
          cell(row.streak),
        ),
      );
    }
    table.appendChild(body);
    host.appendChild(table);
  });
}
