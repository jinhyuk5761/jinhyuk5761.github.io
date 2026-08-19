/**
 * 삭제된 기술.
 *
 * 상류(championsbattledata)의 학습 목록에는 남아 있지만 게임에 없는 기술이 있다.
 * 남겨두면 계산기에서 성립하지 않는 조합을 계산하고, 기술 탭에서 쓸 수 없는 기술을
 * 뒤지게 된다. 상류 데이터로는 가려낼 수 없어 손으로 적은 목록으로 막는다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeIndex, normalizeBattle } from '../src/adapters/championsBattleData';
import { normalizeMoves } from '../src/adapters/moveDex';
import { REMOVED_MOVES, isPlayableMove } from '../src/core/removedMoves';

const moves = JSON.parse(readFileSync('public/data/moves.json', 'utf8'));

describe('REMOVED_MOVES', () => {
  it('싸라기눈이 목록에 있다', () => {
    expect(REMOVED_MOVES.has('Hail')).toBe(true);
    expect(isPlayableMove('Hail')).toBe(false);
    expect(isPlayableMove('Earthquake')).toBe(true);
  });

  it('한국어 표기를 코드에 적어두지 않는다 (도감에서 가져온다)', () => {
    const source = readFileSync('src/core/removedMoves.ts', 'utf8');
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/[가-힣]/);
  });
});

describe('삭제된 기술은 어디에도 새어나가지 않는다', () => {
  it('기술 도감에서 빠진다', () => {
    // 원본 파일에는 아직 남아 있다 — 걸러내는 쪽이 어댑터라는 뜻이다.
    expect(moves.moves.Hail).toBeDefined();
    const dex = normalizeMoves(moves);
    expect(dex.has('Hail')).toBe(false);
    expect(dex.size).toBeGreaterThan(500);
  });

  it('종별 학습 목록에서 빠진다', () => {
    const index = normalizeIndex({
      pokemon: [
        {
          slug: 'sharpedo',
          showdownId: 'sharpedo',
          name: 'Sharpedo',
          learnableMoveNames: ['Hail', 'Crunch', 'Snowscape'],
          summary: { primary: { slug: 'sharpedo', form_name: 'Sharpedo' }, forms: [] },
        },
      ],
    } as never);
    const mon = index.byShowdownId.get('sharpedo')!;
    expect(mon.learnableMoveNames).toEqual(['Crunch', 'Snowscape']);
  });

  it('사용률 집계에서도 빠진다', () => {
    const report = normalizeBattle(
      {
        rows: [
          { category: 'move', rank: 1, name: 'Crunch', percentage: '90%', percentage_value: 90 },
          { category: 'move', rank: 2, name: 'Hail', percentage: '5%', percentage_value: 5 },
        ],
      } as never,
      'Singles',
      'sharpedo',
    );
    const names = report.blocks.find((b) => b.category === 'move')!.entries.map((e) => e.name);
    expect(names).toEqual(['Crunch']);
  });
});
