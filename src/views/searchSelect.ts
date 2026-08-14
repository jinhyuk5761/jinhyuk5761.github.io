/**
 * 검색되는 드롭다운.
 *
 * 네이티브 `<select>` 는 목록이 길면 못 쓴다. 기술은 539개라 스크롤로 찾아야 하고,
 * 안드로이드에서는 시스템 팝업으로 떠서 위아래 이동 버튼밖에 없다.
 * 그래서 목록 위에 검색창을 붙인 자체 드롭다운을 쓴다.
 *
 * 짧은 목록(랭크·상태이상·날씨)에는 쓰지 않는다 — 검색창이 방해만 된다.
 */

import { clear, el } from '../core/dom';
import { matchesQuery } from '../core/names';

export interface SearchOption {
  /** 값. 선택 시 onPick 으로 그대로 넘어간다. */
  value: string;
  /** 화면에 보이는 글자 */
  label: string;
  /** 오른쪽에 작게 붙는 부가 정보 (위력·분류 등) */
  hint?: string;
  /** 검색어와 대조할 문자열들. 없으면 label 만 본다. */
  haystack?: string[];
}

export interface SearchSelectOptions {
  options: SearchOption[];
  value: string;
  placeholder: string;
  ariaLabel: string;
  onPick: (value: string) => void;
  /** 이 개수 이하면 검색창을 숨긴다. */
  searchThreshold?: number;
  /** 바깥에서 잡을 수 있게 붙이는 클래스 (자리별 스타일·테스트용) */
  className?: string;
}

/** 열려 있는 패널은 하나뿐이다. 새로 열 때 이전 것을 닫는다. */
let openPanel: (() => void) | null = null;

export function searchSelect(config: SearchSelectOptions): HTMLElement {
  const { options, value, placeholder, ariaLabel, onPick, searchThreshold = 8, className } = config;

  const selected = options.find((o) => o.value === value);
  const root = el('div', { class: `sselect${className ? ' ' + className : ''}` });

  const button = el(
    'button',
    { class: 'sselect__button', type: 'button', 'aria-label': ariaLabel, 'aria-haspopup': 'listbox' },
    el(
      'span',
      { class: `sselect__value${selected ? '' : ' sselect__value--empty'}` },
      selected ? selected.label : placeholder,
    ),
    selected?.hint ? el('span', { class: 'sselect__hint' }, selected.hint) : null,
    el('span', { class: 'sselect__caret' }, '▾'),
  );

  const search = el('input', {
    class: 'sselect__search',
    type: 'search',
    placeholder: '검색',
    'aria-label': `${ariaLabel} 검색`,
  });
  const list = el('div', { class: 'sselect__list', role: 'listbox' });
  const panel = el('div', { class: 'sselect__panel' }, search, list);
  panel.hidden = true;

  const draw = (): void => {
    clear(list);
    const query = search.value.trim();
    const matches = query
      ? options.filter((o) => matchesQuery(query, o.haystack ?? [o.label]))
      : options;

    if (matches.length === 0) {
      list.appendChild(el('p', { class: 'sselect__empty' }, '일치하는 항목이 없습니다.'));
      return;
    }

    for (const option of matches) {
      const row = el(
        'button',
        {
          class: `sselect__option${option.value === value ? ' sselect__option--on' : ''}`,
          type: 'button',
          role: 'option',
        },
        el('span', {}, option.label),
        option.hint ? el('span', { class: 'sselect__hint' }, option.hint) : null,
      );
      row.addEventListener('click', () => {
        close();
        onPick(option.value);
      });
      list.appendChild(row);
    }
  };

  function close(): void {
    panel.hidden = true;
    root.classList.remove('sselect--open');
    if (openPanel === close) openPanel = null;
    document.removeEventListener('click', onOutside, true);
  }

  function onOutside(event: Event): void {
    if (!root.contains(event.target as Node)) close();
  }

  button.addEventListener('click', () => {
    if (!panel.hidden) {
      close();
      return;
    }
    openPanel?.();
    panel.hidden = false;
    root.classList.add('sselect--open');
    openPanel = close;
    // 검색창은 목록이 길 때만 쓸모가 있다.
    search.hidden = options.length <= searchThreshold;
    search.value = '';
    draw();
    if (!search.hidden) search.focus();
    document.addEventListener('click', onOutside, true);
  });

  search.addEventListener('input', draw);
  search.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      button.focus();
    }
  });

  root.appendChild(button);
  root.appendChild(panel);
  return root;
}
