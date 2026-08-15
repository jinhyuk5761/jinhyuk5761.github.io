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

  /**
   * 지금 고른 값. 컴포넌트가 스스로 들고 있어야 한다.
   *
   * 부모가 결과만 다시 그리는 경우(도구·성격·기술)가 많아서, 표시를 부모에게 맡기면
   * 계산은 바뀌었는데 버튼에는 예전 값이 남아 "안 들어갔다" 로 보인다.
   */
  let current = value;

  const root = el('div', { class: `sselect${className ? ' ' + className : ''}` });
  const valueLabel = el('span', { class: 'sselect__value' });
  const hintLabel = el('span', { class: 'sselect__hint' });

  const paint = (): void => {
    const selected = options.find((o) => o.value === current);
    valueLabel.textContent = selected ? selected.label : placeholder;
    valueLabel.classList.toggle('sselect__value--empty', !selected);
    hintLabel.textContent = selected?.hint ?? '';
  };

  const button = el(
    'button',
    { class: 'sselect__button', type: 'button', 'aria-label': ariaLabel, 'aria-haspopup': 'listbox' },
    valueLabel,
    hintLabel,
    el('span', { class: 'sselect__caret' }, '▾'),
  );
  paint();

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
          class: `sselect__option${option.value === current ? ' sselect__option--on' : ''}`,
          type: 'button',
          role: 'option',
        },
        el('span', {}, option.label),
        option.hint ? el('span', { class: 'sselect__hint' }, option.hint) : null,
      );
      row.addEventListener('click', () => {
        current = option.value;
        // 부모가 결과만 다시 그려도 버튼에는 고른 값이 남아야 한다.
        paint();
        close();
        onPick(option.value);
      });
      list.appendChild(row);
    }
  };

  /** 화면 가장자리에서 띄우는 여백. */
  const GAP = 8;
  /** 좁은 칸(랭크)에 붙어도 목록이 읽히도록 하는 최소 너비. */
  const MIN_WIDTH = 220;
  /** 이만큼도 안 나오는 쪽으로는 펴지 않는다. 목록이 두어 줄만 보이면 못 쓴다. */
  const MIN_HEIGHT = 180;

  /**
   * 패널을 버튼 바로 위에 붙인다.
   *
   * 버튼 아래로 펴면 검색창 포커스로 올라온 키보드가 그대로 덮는다. 위로 펴면
   * 키보드는 늘 패널보다 아래에 있고, 고른 값이 들어갈 버튼도 눈에 같이 들어온다.
   *
   * 자리가 안 나오는 경우(화면 꼭대기의 버튼)에만 아래로 내린다. 어느 쪽이든
   * 높이는 `visualViewport` 로 잰다 — 키보드가 뜨면 이 값이 줄어들므로
   * 목록이 키보드 밑으로 흘러 들어가지 않는다.
   */
  function place(): void {
    const rect = button.getBoundingClientRect();
    const view = window.visualViewport;
    const viewTop = view?.offsetTop ?? 0;
    const viewLeft = view?.offsetLeft ?? 0;
    const viewWidth = view?.width ?? window.innerWidth;
    const viewHeight = view?.height ?? window.innerHeight;

    // 좁은 버튼에는 버튼보다 넓게, 화면보다는 좁게.
    const width = Math.max(0, Math.min(viewWidth - GAP * 2, Math.max(MIN_WIDTH, rect.width)));
    // 버튼과 가로로 맞추되 화면 밖으로 나가지 않게 민다.
    const left = Math.min(
      Math.max(viewLeft + GAP, rect.left),
      Math.max(viewLeft + GAP, viewLeft + viewWidth - width - GAP),
    );

    /*
     * 패널이 걸릴 자리. 버튼에 맞추되 보이는 영역 밖으로는 나가지 않는다 —
     * 키보드가 이미 버튼을 덮고 있으면 버튼이 아니라 키보드 윗선에 건다.
     */
    const viewBottom = viewTop + viewHeight;
    const upEdge = Math.min(rect.top - GAP, viewBottom - GAP);
    const downEdge = Math.max(rect.bottom + GAP, viewTop + GAP);
    const above = upEdge - viewTop - GAP;
    const below = viewBottom - GAP - downEdge;
    // 위가 좁으면(화면 꼭대기의 버튼) 아래로 내린다.
    const up = above >= MIN_HEIGHT || above >= below;

    if (up) {
      // 아래 끝을 버튼에 걸어두면 항목이 몇 개든 버튼 바로 위에서 자란다.
      // fixed 의 bottom 은 레이아웃 뷰포트 기준이라 innerHeight 에서 뺀다.
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - upEdge}px`;
    } else {
      panel.style.bottom = 'auto';
      panel.style.top = `${downEdge}px`;
    }
    panel.style.left = `${left}px`;
    panel.style.right = 'auto';
    panel.style.width = `${width}px`;
    panel.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
  }

  function close(): void {
    panel.hidden = true;
    root.classList.remove('sselect--open');
    panel.removeAttribute('style');
    if (openPanel === close) openPanel = null;
    document.removeEventListener('click', onOutside, true);
    window.removeEventListener('scroll', place, true);
    window.visualViewport?.removeEventListener('resize', place);
    window.visualViewport?.removeEventListener('scroll', place);
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
    place();
    if (!search.hidden) search.focus();
    document.addEventListener('click', onOutside, true);
    // 키보드가 오르내리거나 화면이 움직이면 버튼 위치와 남는 높이가 바뀐다.
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
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
