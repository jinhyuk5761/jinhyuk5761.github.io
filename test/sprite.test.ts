/**
 * @vitest-environment jsdom
 *
 * 없는 스프라이트 처리.
 *
 * 상류에 파일이 없는 폼이 있다(트리미앙 트리밍 9종, Fan Rotom). 서버가 404 가 아니라
 * **200 에 HTML** 을 주기 때문에 URL 만 보고는 걸러낼 수 없다. 실제로 그려보고
 * 실패했을 때 같은 종의 다른 폼 그림으로 물러나야 한다.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { sprite, spriteFallbacks } from '../src/views/components';
import type { Pokemon, PokemonForm, StatLine } from '../src/types';

const STATS: StatLine = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, total: 0 };

function form(slug: string, spriteUrl: string): PokemonForm {
  return {
    slug,
    formName: slug,
    savedName: slug,
    formKind: 'Base',
    types: [],
    abilities: [],
    hiddenAbility: '',
    stats: STATS,
    spriteUrl,
  };
}

const natural = form('furfrou-natural-form', 'https://x.test/Furfrou.png');
const heart = form('furfrou-heart-trim', 'https://x.test/Heart.png');
const star = form('furfrou-star-trim', 'https://x.test/Star.png');

const furfrou: Pokemon = {
  showdownId: 'furfrou',
  slug: 'furfrou',
  name: 'Furfrou',
  displayName: '트리미앙',
  localeNames: { en: 'Furfrou' },
  primary: natural,
  forms: [natural, heart, star],
  learnableMoveNames: [],
  usageRank: { Singles: null, Doubles: null },
};

const fail = (img: Element) => img.dispatchEvent(new Event('error'));

afterEach(() => {
  document.body.innerHTML = '';
});

describe('spriteFallbacks', () => {
  it('자기 자신은 빼고 대표 폼을 먼저 둔다', () => {
    expect(spriteFallbacks(furfrou, heart)).toEqual([natural.spriteUrl, star.spriteUrl]);
  });
});

describe('sprite', () => {
  it('그림이 깨지면 다음 후보로 넘어간다', () => {
    const img = sprite(heart, 'lg', spriteFallbacks(furfrou, heart)) as HTMLImageElement;
    document.body.appendChild(img);
    expect(img.getAttribute('src')).toBe(heart.spriteUrl);

    fail(img);
    expect(img.getAttribute('src')).toBe(natural.spriteUrl);
  });

  it('후보가 다 떨어지면 물음표로 바꾼다 — 깨진 아이콘을 남기지 않는다', () => {
    const img = sprite(heart, 'lg', [star.spriteUrl]) as HTMLImageElement;
    document.body.appendChild(img);

    fail(img); // → star
    expect(img.getAttribute('src')).toBe(star.spriteUrl);

    fail(img); // 더 없음
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.sprite--missing')?.textContent).toBe('?');
  });

  it('주소가 아예 없으면 처음부터 물음표', () => {
    const node = sprite(form('x', ''), 'sm');
    expect(node.classList.contains('sprite--missing')).toBe(true);
  });
});
