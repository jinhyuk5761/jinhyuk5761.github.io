/**
 * @vitest-environment jsdom
 *
 * 드롭다운이 펼쳐지는 방향.
 *
 * 검색창에 포커스가 가면 키보드가 화면 아래를 덮는다. 아래로 편 패널은 그대로
 * 가려져서 목록을 볼 수 없다. 자리가 있으면 위로 펴야 한다.
 *
 * jsdom 은 레이아웃을 계산하지 않으므로 버튼 위치와 화면 높이를 직접 심어서 잰다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { searchSelect } from '../src/views/searchSelect';

/** 버튼이 화면 어디에 있는지 심는다. `top` 은 화면 위쪽에서의 거리. */
function place(root: HTMLElement, top: number, viewHeight: number): void {
  const button = root.querySelector<HTMLElement>('.sselect__button')!;
  button.getBoundingClientRect = () =>
    ({ top, bottom: top + 32, left: 0, right: 100, width: 100, height: 32, x: 0, y: top }) as DOMRect;
  Object.defineProperty(window, 'innerHeight', { value: viewHeight, configurable: true });
}

function build(): HTMLElement {
  const root = searchSelect({
    options: [
      { value: 'a', label: '가' },
      { value: 'b', label: '나' },
    ],
    value: 'a',
    placeholder: '없음',
    ariaLabel: '테스트',
    onPick: () => {},
  });
  document.body.appendChild(root);
  return root;
}

function open(root: HTMLElement): void {
  root.querySelector<HTMLButtonElement>('.sselect__button')!.click();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('드롭다운 방향', () => {
  it('위에 자리가 있으면 위로 펼친다', () => {
    const root = build();
    place(root, 500, 800);
    open(root);
    expect(root.classList.contains('sselect--up')).toBe(true);
  });

  it('화면 맨 위에 붙어 있으면 아래로 펼친다', () => {
    const root = build();
    place(root, 20, 800);
    open(root);
    expect(root.classList.contains('sselect--up')).toBe(false);
  });

  it('아래가 더 넓어도 위에 자리가 있으면 위로 펼친다', () => {
    const root = build();
    // 위 312px, 아래 440px. 아래가 넓지만 키보드가 덮는 쪽이라 위를 택해야 한다.
    place(root, 320, 800);
    open(root);
    expect(root.classList.contains('sselect--up')).toBe(true);
  });

  it('키보드가 올라오면 남은 자리를 다시 잰다', () => {
    const root = build();
    // 위 12px 뿐이라 키보드가 없을 때는 아래로 편다.
    place(root, 20, 800);
    open(root);
    expect(root.classList.contains('sselect--up')).toBe(false);
    // 아래 748px 을 그대로 쓰지는 않는다 — 패널 최대 높이는 320px.
    expect(root.querySelector<HTMLElement>('.sselect__panel')!.style.maxHeight).toBe('320px');
  });

  it('닫으면 방향 표시를 지운다', () => {
    const root = build();
    place(root, 500, 800);
    open(root);
    open(root); // 다시 눌러 닫기
    expect(root.classList.contains('sselect--up')).toBe(false);
    expect(root.querySelector<HTMLElement>('.sselect__panel')!.hidden).toBe(true);
  });
});
