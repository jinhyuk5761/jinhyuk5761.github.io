/**
 * 여러 화면이 공유하는 조각들.
 */

import { DAMAGE_CLASS_LABEL, type MoveInfo } from '../adapters/moveDex';
import { typeName } from '../adapters/termDex';
import { moveEffectLines } from '../core/moveEffect';
import { el } from '../core/dom';
import { href } from '../router';
import { state } from '../store';
import type {
  CounterEntry,
  Format,
  Pokemon,
  PokemonForm,
  TypeName,
  UsageCategory,
} from '../types';

export const CATEGORY_LABEL: Record<UsageCategory, string> = {
  move: '기술',
  held_item: '지닌 도구',
  ability: '특성',
  stat_alignment: '성격',
  stat_points: '노력치 분배',
  teammate: '자주 함께 쓰인 포켓몬',
};

export const STAT_LABEL: Record<string, string> = {
  hp: 'HP',
  atk: '공격',
  def: '방어',
  spa: '특수공격',
  spd: '특수방어',
  spe: '스피드',
};

/**
 * 타입 배지. 용어 도감이 오면 한국어로 적는다.
 *
 * 도감을 인자로 받지 않고 스토어를 보는 이유: 타입 배지는 카드·헤더·기술 등
 * 거의 모든 곳에서 쓰여서, 호출부마다 도감을 실어 나르면 배관만 늘어난다.
 * 영문명은 title 로 남겨 검색·대조가 가능하게 한다.
 */
export function typeBadge(type: TypeName): HTMLElement {
  return el(
    'span',
    { class: `type type--${type.toLowerCase()}`, title: type },
    typeName(state.terms, type),
  );
}

export function sprite(
  form: PokemonForm,
  size: 'sm' | 'lg' = 'sm',
  fallbacks: string[] = [],
): HTMLElement {
  const missing = (): HTMLElement =>
    el('div', { class: `sprite sprite--${size} sprite--missing` }, '?');

  if (!form.spriteUrl) return missing();

  const img = el('img', {
    class: `sprite sprite--${size}`,
    src: form.spriteUrl,
    alt: form.formName,
    loading: 'lazy',
  }) as HTMLImageElement;

  /*
   * 상류에 없는 스프라이트가 있다(트리미앙 트리밍 9종, Fan Rotom).
   * 404 가 아니라 **200 에 HTML** 이 와서 URL 만 보고는 걸러낼 수 없다.
   * 그래서 실제로 그려보고 실패하면 같은 종의 다른 폼 그림으로 물러난다.
   * 전부 실패하면 '?' 를 둔다 — 깨진 이미지 아이콘보다 낫다.
   */
  const queue = fallbacks.filter((url) => url && url !== form.spriteUrl);
  img.addEventListener('error', () => {
    const next = queue.shift();
    if (next) img.src = next;
    else img.replaceWith(missing());
  });
  return img;
}

/**
 * 이 폼의 그림이 없을 때 대신 쓸 그림들. 대표 폼을 먼저 본다.
 *
 * 트리미앙 트리밍처럼 겉모습만 다른 폼이라 다른 폼의 그림으로 물러나도
 * 다른 포켓몬을 보여주게 되지는 않는다.
 */
export function spriteFallbacks(mon: Pokemon, form: PokemonForm): string[] {
  const urls = [mon.primary.spriteUrl, ...mon.forms.map((f) => f.spriteUrl)];
  return [...new Set(urls)].filter((url) => url && url !== form.spriteUrl);
}

/**
 * 검색 결과·비교 선택 등에서 쓰는 포켓몬 카드.
 *
 * @param rankFormat 사용률 순위를 함께 보여줄 포맷. null 이면 순위를 표시하지 않는다.
 */
export function monCard(mon: Pokemon, rankFormat: Format | null = null): HTMLElement {
  const rank = rankFormat ? mon.usageRank[rankFormat] : null;
  const card = el(
    'a',
    { class: 'card', href: href(`/p/${encodeURIComponent(mon.showdownId)}`) },
    rankFormat
      ? el(
          'span',
          {
            class: `card__rank${rank === null ? ' card__rank--none' : ''}`,
            title: `${rankFormat === 'Singles' ? '싱글' : '더블'} 사용률 순위`,
          },
          // 순위가 없으면 비슷한 숫자를 지어내지 않고 없다고 적는다.
          rank === null ? '—' : String(rank),
        )
      : null,
    sprite(mon.primary, 'sm', spriteFallbacks(mon, mon.primary)),
    el(
      'div',
      { class: 'card__body' },
      el('span', { class: 'card__name' }, mon.displayName),
      // 로케일 표시명이 영문과 다를 때만 영문을 덧붙인다(중복 표기 방지).
      mon.displayName !== mon.name ? el('span', { class: 'card__sub' }, mon.name) : null,
      el('div', { class: 'card__types' }, ...mon.primary.types.map(typeBadge)),
    ),
    el(
      'span',
      { class: 'card__bst', title: '실수치 합계 (레벨 50 · 개체값 31 · 노력치 0)' },
      String(mon.primary.stats.total),
    ),
  );
  return card;
}

/**
 * 사용률 막대. percentageValue 가 null 인 카테고리(teammate)는 막대 없이 순위만 보여준다.
 */
export function usageBar(
  name: string,
  percentage: string,
  value: number | null,
  options: { wrap?: boolean } = {},
): HTMLElement {
  // wrap: 한 줄에 담기지 않는 긴 라벨(성격 보정·노력치 분배)은 잘라내지 않고 막대 위에 통째로 놓는다.
  const row = el('div', { class: options.wrap ? 'bar bar--wrap' : 'bar' });
  row.appendChild(el('span', { class: 'bar__label' }, name || '—'));
  if (value === null) {
    row.appendChild(el('span', { class: 'bar__novalue' }, '비율 미제공'));
    return row;
  }
  const track = el('span', { class: 'bar__track' });
  track.appendChild(
    el('span', { class: 'bar__fill', style: `width:${Math.max(0, Math.min(100, value))}%` }),
  );
  row.appendChild(track);
  row.appendChild(el('span', { class: 'bar__value' }, percentage || `${value}%`));
  return row;
}

/**
 * 카운터 표에 쓸 표시명.
 *
 * Smogon 은 폼 단위(Mega Gyarados)로 집계하고 로케일 명칭은 종 단위(갸라도스)로만 있다.
 * 종 표시명만 쓰면 메가/지역폼 구분이 사라지므로, 기본 폼이 아닐 때만 폼 이름을 덧붙인다.
 * 매칭 자체가 실패한 항목은 Showdown 표기를 그대로 둔다 — 없는 이름을 지어내지 않는다.
 */
export function counterDisplayName(entry: CounterEntry): string {
  const fallback = entry.championsSavedName ?? entry.smogonName;
  if (!entry.showdownId) return fallback;

  const mon = state.index?.byShowdownId.get(entry.showdownId);
  if (!mon) return fallback;

  // 종 엔트리 자체가 이미 그 폼인 경우(예: ninetalesalola)는 표시명만으로 충분하다.
  if (!entry.championsSavedName || entry.championsSavedName === mon.primary.savedName) {
    return mon.displayName;
  }
  return `${mon.displayName} (${entry.championsSavedName})`;
}

/** 카운터 항목 한 줄을 링크로 만든다. 로스터에 없으면 링크 없이 텍스트로 둔다. */
export function counterLabel(entry: CounterEntry): DocumentFragment {
  const frag = document.createDocumentFragment();
  const label = counterDisplayName(entry);

  frag.appendChild(
    entry.showdownId
      ? el('a', { class: 'link', href: href(`/p/${encodeURIComponent(entry.showdownId)}`) }, label)
      : document.createTextNode(label),
  );
  if (!entry.championsSavedName) {
    frag.appendChild(el('span', { class: 'counters__unmapped' }, ' (Showdown 표기)'));
  }
  return frag;
}

/**
 * 기술 한 줄. 사용률 화면과 기술 목록 화면이 같은 모양을 쓴다.
 *
 * 설명은 접어둔다. 한 화면에 기술이 10개 넘게 오는데 설명까지 펴면
 * 정작 보러 온 사용률 분포가 스크롤 밖으로 밀려난다. 눌러서 편다.
 *
 * @param usage 사용률 화면에서만 전달한다. 없으면 막대와 비율을 그리지 않는다.
 */
export function moveRow(
  englishName: string,
  move: MoveInfo | null,
  usage?: { percentage: string; percentageValue: number | null },
): HTMLElement {
  const wrap = el('div', { class: 'move' });

  const head = el('button', {
    class: 'move__head',
    type: 'button',
    'aria-expanded': 'false',
  });

  head.appendChild(
    move?.type
      ? typeBadge(move.type)
      : el('span', { class: 'type type--unknown' }, '?'),
  );
  head.appendChild(
    el('span', { class: 'move__name' }, move?.displayName ?? englishName),
  );

  // 위력/명중률은 변화기술이면 아예 없다. 없는 값을 0 으로 위조하지 않고 '—' 로 둔다.
  const meta = el('span', { class: 'move__meta' });
  if (move) {
    const parts = [
      move.damageClass ? DAMAGE_CLASS_LABEL[move.damageClass] : null,
      `위력 ${move.power ?? '—'}`,
      `명중 ${move.accuracy ?? '—'}`,
      `PP ${move.pp ?? '—'}`,
      move.priority !== 0 ? `우선도 ${move.priority > 0 ? '+' : ''}${move.priority}` : null,
    ].filter(Boolean);
    meta.textContent = parts.join(' · ');
  } else {
    meta.textContent = '제원 없음';
  }
  head.appendChild(meta);

  if (usage) {
    const track = el('span', { class: 'move__track' });
    if (usage.percentageValue !== null) {
      track.appendChild(
        el('span', {
          class: 'move__fill',
          style: `width:${Math.max(0, Math.min(100, usage.percentageValue))}%`,
        }),
      );
    }
    head.appendChild(track);
    head.appendChild(el('span', { class: 'move__value' }, usage.percentage || '—'));
  }

  wrap.appendChild(head);

  const effectLines = move ? moveEffectLines(move) : [];

  if (move && (move.description || effectLines.length > 0)) {
    const body = el('div', { class: 'move__body', hidden: 'hidden' });

    // 숫자로 확정할 수 있는 효과를 먼저 보여준다.
    // 공식 설명이 "크게 올린다" 라고만 하는 부분을 여기서 "공격 +2랭크" 로 못박는다.
    if (effectLines.length > 0) {
      body.appendChild(
        el('ul', { class: 'move__effects' }, ...effectLines.map((line) => el('li', {}, line))),
      );
    }

    if (move.description) body.appendChild(el('p', { class: 'move__desc' }, move.description));
    if (move.descriptionIsFallback) {
      // 9세대 신규 기술은 공식 한국어 설명이 아직 없다. 숨기지 않고 밝힌다.
      body.appendChild(
        el('p', { class: 'move__fallback' }, '한국어 설명이 없어 영문 설명을 표시합니다.'),
      );
    }
    body.appendChild(
      el(
        'p',
        { class: 'move__alias' },
        [move.englishName, move.japaneseName].filter(Boolean).join(' · '),
      ),
    );
    wrap.appendChild(body);

    head.addEventListener('click', () => {
      const open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden');
      else body.setAttribute('hidden', 'hidden');
      head.setAttribute('aria-expanded', String(open));
      wrap.classList.toggle('move--open', open);
    });
  } else {
    head.setAttribute('aria-disabled', 'true');
    head.classList.add('move__head--flat');
  }

  return wrap;
}

/**
 * 도구·특성 한 줄. 설명이 있으면 눌러서 펼친다.
 * 기술과 달리 제원이 없어서 moveRow 를 재사용하지 않고 따로 둔다.
 */
export function termBar(
  label: string,
  usage: { percentage: string; percentageValue: number | null },
  description: string | null,
): HTMLElement {
  const row = usageBar(label, usage.percentage, usage.percentageValue);
  if (!description) return row;

  const wrap = el('div', { class: 'term' });
  const button = el('button', { class: 'term__toggle', type: 'button', 'aria-expanded': 'false' });
  button.appendChild(row);

  const body = el('p', { class: 'term__desc', hidden: 'hidden' }, description);
  button.addEventListener('click', () => {
    const open = body.hasAttribute('hidden');
    if (open) body.removeAttribute('hidden');
    else body.setAttribute('hidden', 'hidden');
    button.setAttribute('aria-expanded', String(open));
  });

  wrap.appendChild(button);
  wrap.appendChild(body);
  return wrap;
}

/** 포맷 토글이 바뀌면 화면을 다시 그려야 하는 뷰들이 공통으로 쓰는 라벨. */
export function formatLabel(): string {
  return state.format === 'Singles' ? '싱글' : '더블';
}

export function sectionTitle(text: string, hint?: string): HTMLElement {
  return el(
    'h3',
    { class: 'section__title' },
    text,
    hint ? el('span', { class: 'section__hint' }, hint) : null,
  );
}
