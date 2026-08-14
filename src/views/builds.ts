/**
 * M5 — 동결 시즌 구축 (B등급 보강)
 *
 * 설계 문서 6절 규칙을 화면에서도 지킨다:
 *   - 모든 항목에 원문 출처 링크를 반드시 표시한다 (어댑터가 출처 없는 항목을 이미 버린다).
 *   - 번역본에는 "참고용 번역" 라벨을 붙인다.
 */

import { buildsUrl } from '../adapters/appConfig';
import { fetchBuilds } from '../adapters/frozenSeason';
import { clear, el, notice } from '../core/dom';
import { href } from '../router';
import { state } from '../store';
import type { BuildSet } from '../types';
import { sectionTitle } from './components';

export function renderBuilds(container: HTMLElement): void {
  clear(container);

  const page = el(
    'section',
    { class: 'builds' },
    el('h2', {}, '동결 시즌 구축'),
    el(
      'p',
      { class: 'builds__intro' },
      '공개된 구축 기사와 동결 시즌 자료를 정리한 참고 자료입니다. 각 항목의 원문 링크를 함께 표시합니다.',
    ),
    // 자료가 추가되면 새로고침 없이 붙는다는 것을 사용자가 알 수 있게 한다.
    state.config.serverBacked && state.config.builds.updatedAt
      ? el(
          'p',
          { class: 'panel__meta' },
          `자료 갱신 ${new Date(state.config.builds.updatedAt).toLocaleString('ko-KR')} · 새 자료가 등록되면 자동으로 반영됩니다.`,
        )
      : null,
  );
  container.appendChild(page);

  const listHost = el('div');
  page.appendChild(listHost);
  listHost.appendChild(notice('loading', '구축 자료를 불러오는 중…'));

  fetchBuilds(buildsUrl(state.config)).then((result) => {
    clear(listHost);

    if (result.status !== 'ok') {
      listHost.appendChild(notice(result.status === 'empty' ? 'empty' : 'error', result.reason));
      return;
    }

    const forFormat = result.data.filter((build) => build.format === state.format);
    if (forFormat.length === 0) {
      listHost.appendChild(
        notice('empty', `${state.format === 'Singles' ? '싱글' : '더블'} 구축 자료가 아직 없습니다.`),
      );
      return;
    }

    const bySeason = new Map<string, BuildSet[]>();
    for (const build of forFormat) {
      const list = bySeason.get(build.season) ?? [];
      list.push(build);
      bySeason.set(build.season, list);
    }

    for (const [season, builds] of [...bySeason].sort((a, b) => b[0].localeCompare(a[0]))) {
      const section = el('section', { class: 'section' });
      section.appendChild(sectionTitle(season || '시즌 미상', `${builds.length}건`));
      for (const build of builds) section.appendChild(buildCard(build));
      listHost.appendChild(section);
    }
  });
}

function buildCard(build: BuildSet): HTMLElement {
  const monLinks = el('div', { class: 'build__party' });
  for (const name of build.pokemon) {
    const mon = (state.index?.pokemon ?? []).find((p) => p.name === name || p.primary.savedName === name);
    monLinks.appendChild(
      mon
        ? el(
            'a',
            { class: 'chip chip--link', href: href(`/p/${encodeURIComponent(mon.showdownId)}`) },
            mon.displayName,
          )
        : el('span', { class: 'chip' }, name),
    );
  }

  return el(
    'article',
    { class: 'build' },
    el(
      'header',
      { class: 'build__head' },
      el('h4', { class: 'build__title' }, build.title),
      build.translated ? el('span', { class: 'badge badge--warn' }, '참고용 번역') : null,
    ),
    monLinks,
    build.items.length > 0 ? el('p', { class: 'build__line' }, `도구: ${build.items.join(', ')}`) : null,
    build.moves.length > 0 ? el('p', { class: 'build__line' }, `주요 기술: ${build.moves.join(', ')}`) : null,
    build.note ? el('p', { class: 'build__note' }, build.note) : null,
    // 출처는 선택이 아니라 필수다. 이 줄은 어떤 경우에도 렌더된다.
    el(
      'p',
      { class: 'build__source' },
      '출처: ',
      el(
        'a',
        { class: 'link', href: build.sourceUrl, target: '_blank', rel: 'noopener noreferrer' },
        build.sourceLabel,
      ),
    ),
  );
}
