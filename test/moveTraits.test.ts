/**
 * 기술 성질 표기 테스트.
 *
 * 핵심은 광역기의 두 갈래를 섞지 않는 것이다.
 * 지진(아군도 맞음)과 눈보라(상대만)를 같은 「광역」으로 뭉뚱그리면
 * 더블에서 판단이 정반대로 갈린다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeMoves, type MoveInfo } from '../src/adapters/moveDex';
import { isSpreadMove, spreadScopeOf, traitsOf } from '../src/core/moveTraits';

const dex = normalizeMoves(
  JSON.parse(
    readFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'moves.json'), 'utf8'),
  ),
);

function move(name: string): MoveInfo {
  const found = dex.get(name);
  expect(found, `${name} 이 기술 도감에 없습니다`).toBeDefined();
  return found!;
}

const labels = (name: string) => traitsOf(move(name)).map((t) => t.label);

describe('광역 범위', () => {
  it('아군까지 때리는 광역과 상대만 때리는 광역을 구분한다', () => {
    expect(spreadScopeOf(move('Earthquake'))).toBe('allAdjacent');
    expect(spreadScopeOf(move('Blizzard'))).toBe('foes');
    expect(labels('Earthquake')).toContain('광역 · 아군 포함');
    expect(labels('Blizzard')).toContain('광역 · 상대 전체');
  });

  it('단일 대상 기술에는 광역 표기가 없다', () => {
    expect(spreadScopeOf(move('Close Combat'))).toBeNull();
    expect(isSpreadMove(move('Close Combat'))).toBe(false);
    expect(labels('Close Combat').some((l) => l.startsWith('광역'))).toBe(false);
  });

  it('더블 0.75배 판정이 두 갈래 모두에 걸린다', () => {
    // 아군을 때리든 안 때리든, 대상이 여럿이면 대미지는 줄어든다.
    expect(isSpreadMove(move('Earthquake'))).toBe(true);
    expect(isSpreadMove(move('Blizzard'))).toBe(true);
  });
});

describe('접촉 여부', () => {
  it('접촉기와 비접촉기를 둘 다 적는다', () => {
    // "표기 없음"과 "비접촉"이 구별돼야 방어측 특성 판정을 읽을 수 있다.
    expect(labels('Close Combat')).toContain('접촉');
    expect(labels('Earthquake')).toContain('비접촉');
  });

  it('변화기술에는 접촉 개념을 붙이지 않는다', () => {
    const swords = labels('Swords Dance');
    expect(swords).not.toContain('접촉');
    expect(swords).not.toContain('비접촉');
  });
});

describe('플래그', () => {
  it('펀치·소리·참격·탄환을 표기한다', () => {
    expect(labels('Fire Punch')).toContain('펀치');
    expect(labels('Boomburst')).toContain('소리');
    expect(labels('Sacred Sword')).toContain('참격');
    expect(labels('Shadow Ball')).toContain('탄환');
  });

  it('펀치기는 접촉 표기와 함께 나온다 (철주먹 판정과 겹친다)', () => {
    const punch = labels('Fire Punch');
    expect(punch).toContain('접촉');
    expect(punch).toContain('펀치');
  });

  it('해당 없는 플래그는 붙이지 않는다', () => {
    expect(labels('Earthquake')).not.toContain('펀치');
    expect(labels('Earthquake')).not.toContain('소리');
  });
});

describe('데이터 정합성', () => {
  it('광역기가 로스터에 실제로 존재한다', () => {
    const spread = [...dex.values()].filter(isSpreadMove);
    expect(spread.length).toBeGreaterThan(30);
    // 두 갈래가 모두 있어야 구분에 의미가 있다.
    const scopes = new Set(spread.map(spreadScopeOf));
    expect(scopes.has('foes')).toBe(true);
    expect(scopes.has('allAdjacent')).toBe(true);
  });
});
