/**
 * @vitest-environment jsdom
 *
 * 드롭다운 패널이 뜨는 자리.
 *
 * 버튼 아래에 펴면 검색창 포커스로 올라온 키보드가 목록을 덮는다. 그래서 버튼이
 * 어디 있든 패널은 화면 맨 위에 붙인다.
 *
 * jsdom 은 레이아웃을 계산하지 않으므로 버튼 위치와 화면 크기를 직접 심어서 잰다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { searchSelect } from '../src/views/searchSelect';

/** 버튼이 화면 어디에 있는지 심는다. */
function put(root: HTMLElement, box: { top: number; left: number; width: number }): void {
  const button = root.querySelector<HTMLElement>('.sselect__button')!;
  button.getBoundingClientRect = () =>
    ({
      top: box.top,
      bottom: box.top + 32,
      left: box.left,
      right: box.left + box.width,
      width: box.width,
      height: 32,
      x: box.left,
      y: box.top,
    }) as DOMRect;
}

/** 키보드가 올라온 상태를 흉내낸다 — 보이는 높이가 줄어든다. */
function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'visualViewport', {
    value: { width, height, offsetTop: 0, offsetLeft: 0, addEventListener() {}, removeEventListener() {} },
    configurable: true,
  });
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

const panelOf = (root: HTMLElement) => root.querySelector<HTMLElement>('.sselect__panel')!;
const open = (root: HTMLElement) => root.querySelector<HTMLButtonElement>('.sselect__button')!.click();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('드롭다운 자리', () => {
  it('버튼이 화면 아래에 있어도 패널은 맨 위에 뜬다', () => {
    setViewport(400, 800);
    const root = build();
    put(root, { top: 700, left: 20, width: 300 });
    open(root);
    expect(panelOf(root).style.top).toBe('8px');
  });

  it('키보드가 올라오면 그만큼 높이를 줄인다', () => {
    setViewport(400, 800);
    const root = build();
    put(root, { top: 700, left: 20, width: 300 });
    open(root);
    expect(panelOf(root).style.maxHeight).toBe('784px');

    // 키보드가 올라와 보이는 높이가 400px 로 줄었다.
    setViewport(400, 400);
    window.dispatchEvent(new Event('scroll'));
    expect(panelOf(root).style.maxHeight).toBe('384px');
  });

  it('좁은 버튼(랭크)에도 목록이 읽히게 넓힌다', () => {
    setViewport(400, 800);
    const root = build();
    put(root, { top: 100, left: 10, width: 48 });
    open(root);
    expect(panelOf(root).style.width).toBe('220px');
  });

  it('오른쪽 끝에 붙은 버튼이어도 화면 밖으로 나가지 않는다', () => {
    setViewport(400, 800);
    const root = build();
    put(root, { top: 100, left: 360, width: 40 });
    open(root);
    const panel = panelOf(root);
    const left = Number.parseFloat(panel.style.left);
    const width = Number.parseFloat(panel.style.width);
    expect(left + width).toBeLessThanOrEqual(400 - 8);
    expect(left).toBeGreaterThanOrEqual(8);
  });

  it('닫으면 심어둔 자리를 지운다', () => {
    setViewport(400, 800);
    const root = build();
    put(root, { top: 100, left: 20, width: 300 });
    open(root);
    open(root); // 다시 눌러 닫기
    expect(panelOf(root).hidden).toBe(true);
    expect(panelOf(root).getAttribute('style')).toBeNull();
  });
});
