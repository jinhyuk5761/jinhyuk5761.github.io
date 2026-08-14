/**
 * 정밀 효과 문장 생성기 테스트.
 *
 * 이 기능의 존재 이유가 "크게 올린다" 같은 모호한 표현을 숫자로 바꾸는 것이므로,
 * 검증할 것도 정확히 그것이다. 그리고 **없는 값은 만들지 않는지**를 함께 본다.
 */

import { describe, expect, it } from 'vitest';
import { normalizeMoves, type MoveInfo } from '../src/adapters/moveDex';
import { moveEffectLines } from '../src/core/moveEffect';

/** 한 기술만 담은 도감을 만들어 MoveInfo 를 얻는다. */
function move(raw: Record<string, unknown>): MoveInfo {
  return normalizeMoves({ moves: { X: { n: 'X', ...raw } } }).get('X')!;
}

describe('랭크 변화', () => {
  it('"크게 올린다" 를 랭크 수치로 적는다', () => {
    // 칼춤: 공격을 크게 올린다 → +2랭크
    const lines = moveEffectLines(move({ sc: [['attack', 2]], statc: 0 }));
    expect(lines).toContain('공격 +2랭크');
  });

  it('감소는 마이너스 기호로 적는다', () => {
    // 오버히트: 특수공격을 크게 떨어뜨린다 → −2랭크
    const lines = moveEffectLines(move({ sc: [['special-attack', -2]], statc: 100 }));
    expect(lines).toContain('특수공격 −2랭크');
  });

  it('여러 스탯이 바뀌면 한 줄에 모은다', () => {
    // 인파이트: 방어와 특수방어가 떨어진다
    const lines = moveEffectLines(move({ sc: [['defense', -1], ['special-defense', -1]], statc: 100 }));
    expect(lines).toContain('방어 −1랭크 · 특수방어 −1랭크');
  });

  it('확률이 100 미만이면 확률을 앞에 붙인다', () => {
    const lines = moveEffectLines(move({ sc: [['special-defense', -1]], statc: 10 }));
    expect(lines).toContain('10% 확률로 특수방어 −1랭크');
  });

  it('확률이 100 이면 확정으로 적는다 (100% 라고 적지 않는다)', () => {
    const lines = moveEffectLines(move({ sc: [['speed', -1]], statc: 100 }));
    expect(lines).toContain('스피드 −1랭크');
    expect(lines.some((l) => l.includes('100%'))).toBe(false);
  });

  it('변화량 0 은 빌드 단계에서 걸러진 것으로 보고 무시한다', () => {
    expect(moveEffectLines(move({ sc: [] }))).toEqual([]);
  });
});

describe('상태이상과 확률', () => {
  it('"때때로 마비" 를 확률로 적는다', () => {
    const lines = moveEffectLines(move({ ail: 'paralysis', ailc: 10 }));
    expect(lines).toContain('10% 확률로 마비');
  });

  it('확정 상태이상은 확률 없이 적는다', () => {
    const lines = moveEffectLines(move({ ail: 'burn', ailc: 100 }));
    expect(lines).toContain('화상 상태로 만든다');
  });

  it('flinch 는 "풀죽음" 이다 (국내 정식 명칭)', () => {
    const lines = moveEffectLines(move({ flinch: 30 }));
    expect(lines).toContain('30% 확률로 풀죽음');
    // '풀림' 은 오역이었다. 다시 들어오지 않게 못박는다.
    expect(lines.some((l) => l.includes('풀림'))).toBe(false);
  });

  it('주요 상태이상 명칭을 정식 표기로 쓴다', () => {
    const of = (ail: string) => moveEffectLines(move({ ail, ailc: 50 }))[0];
    expect(of('paralysis')).toBe('50% 확률로 마비');
    expect(of('sleep')).toBe('50% 확률로 잠듦');
    expect(of('freeze')).toBe('50% 확률로 얼음');
    expect(of('burn')).toBe('50% 확률로 화상');
    expect(of('bad-poison')).toBe('50% 확률로 맹독');
    expect(of('confusion')).toBe('50% 확률로 혼란');
    expect(of('infatuation')).toBe('50% 확률로 헤롱헤롱');
  });

  it('모르는 상태이상은 원문 그대로 둔다 (잘못 옮기느니 영문이 낫다)', () => {
    expect(moveEffectLines(move({ ail: 'some-new-status', ailc: 50 }))).toContain(
      '50% 확률로 some-new-status',
    );
  });
});

describe('수치 효과', () => {
  it('흡수와 반동을 구분한다', () => {
    expect(moveEffectLines(move({ drain: 50 }))).toContain('입힌 데미지의 50% 회복');
    expect(moveEffectLines(move({ drain: -33 }))).toContain('입힌 데미지의 33% 반동');
  });

  it('회복량을 최대 HP 기준으로 적는다', () => {
    expect(moveEffectLines(move({ heal: 50 }))).toContain('최대 HP의 50% 회복');
  });

  it('급소율 단계를 적는다', () => {
    expect(moveEffectLines(move({ crit: 1 }))).toContain('급소율 +1단계');
  });

  it('연속 공격 횟수를 적는다', () => {
    expect(moveEffectLines(move({ hits: [2, 5] }))).toContain('2~5회 연속 공격');
    expect(moveEffectLines(move({ hits: [2, 2] }))).toContain('2회 연속 공격');
  });

  it('지속 턴을 적는다', () => {
    expect(moveEffectLines(move({ turns: [2, 3] }))).toContain('2~3턴 지속');
  });
});

describe('없는 정보는 만들지 않는다', () => {
  it('구조화 데이터가 없으면 빈 배열 — 공식 설명이 그 역할을 한다', () => {
    // 배북(+6)이나 역린 지속턴처럼 PokéAPI 에 없는 정보가 실제로 있다.
    expect(moveEffectLines(move({}))).toEqual([]);
  });

  it('0 인 값들을 효과로 적지 않는다', () => {
    const lines = moveEffectLines(
      move({ flinch: 0, crit: 0, drain: 0, heal: 0, statc: 0, ailc: 0 }),
    );
    expect(lines).toEqual([]);
  });

  it('잘못된 형태의 값은 조용히 무시한다', () => {
    const lines = moveEffectLines(
      move({ sc: [['attack', 'two'], [1, 2], ['defense', -1]], hits: [1], turns: 'x' }),
    );
    // 형태가 맞는 것만 살아남는다
    expect(lines).toEqual(['방어 −1랭크']);
  });
});

describe('실제 기술 조합', () => {
  it('스케일샷: 연속타 + 랭크 변화를 모두 적는다', () => {
    const lines = moveEffectLines(
      move({ hits: [2, 5], sc: [['speed', 1], ['defense', -1]], statc: 100 }),
    );
    expect(lines).toContain('스피드 +1랭크 · 방어 −1랭크');
    expect(lines).toContain('2~5회 연속 공격');
  });

  it('껍질깨기: 다섯 스탯 변화를 한 줄에 적는다', () => {
    const lines = moveEffectLines(
      move({
        sc: [
          ['defense', -1],
          ['special-defense', -1],
          ['attack', 2],
          ['special-attack', 2],
          ['speed', 2],
        ],
      }),
    );
    expect(lines[0]).toBe(
      '방어 −1랭크 · 특수방어 −1랭크 · 공격 +2랭크 · 특수공격 +2랭크 · 스피드 +2랭크',
    );
  });
});
