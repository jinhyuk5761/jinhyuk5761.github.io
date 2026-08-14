/**
 * 최소 DOM 헬퍼. 프레임워크를 쓰지 않기로 했으므로(설계 문서 7절)
 * innerHTML 문자열 조립 대신 이걸로 만든다 — 외부 문자열이 마크업으로 해석될 여지를 없앤다.
 */

type Child = Node | string | number | null | undefined | false;

interface Attributes {
  class?: string;
  id?: string;
  href?: string;
  src?: string;
  alt?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  title?: string;
  role?: string;
  target?: string;
  rel?: string;
  loading?: 'lazy' | 'eager';
  style?: string;
  hidden?: 'hidden';
  disabled?: 'disabled';
  [key: `data-${string}`]: string | undefined;
  [key: `aria-${string}`]: string | undefined;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function fragment(...children: Child[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  append(frag, children);
  return frag;
}

/** 로딩/빈 상태/에러를 같은 모양으로 그린다. 어댑터가 죽어도 화면은 말이 되게. */
export function notice(kind: 'loading' | 'empty' | 'error', message: string): HTMLElement {
  return el('p', { class: `notice notice--${kind}`, role: kind === 'error' ? 'alert' : undefined }, message);
}

/**
 * 검색창에 자동으로 커서를 둔다 — **물리 키보드가 있을 때만**.
 *
 * 폰에서 자동 포커스하면 화면에 들어올 때마다 소프트 키보드가 올라온다.
 * 특성 하나를 보고 뒤로 나오면 목록이 다시 그려지면서 키보드가 또 튀어나와,
 * 읽으려는 목록의 절반을 가린다.
 *
 * 마우스·트랙패드 같은 정밀 포인터가 있으면 데스크톱으로 보고 포커스한다.
 */
export function focusIfKeyboardLikely(input: HTMLInputElement): void {
  if (typeof matchMedia !== 'function') return;
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus();
}
