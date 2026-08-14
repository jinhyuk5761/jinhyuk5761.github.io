/**
 * 기술 도감 어댑터 테스트.
 *
 * 핵심 계약 두 가지:
 *   1. 키는 Champions 표기 영문명이다 (사용률·learnset 이 그 이름을 쓴다).
 *   2. 없는 값을 지어내지 않는다 — 변화기술의 위력/명중률은 null 로 남는다.
 */

import { describe, expect, it } from 'vitest';
import { DAMAGE_CLASS_LABEL, moveDisplayName, normalizeMoves } from '../src/adapters/moveDex';

const RAW = {
  generatedAt: '2026-08-14T00:00:00.000Z',
  moves: {
    Earthquake: {
      n: 'Earthquake',
      ko: '지진',
      ja: 'じしん',
      type: 'ground',
      cls: 'physical',
      pow: 100,
      acc: 100,
      pp: 10,
      pri: 0,
      tgt: 'all-other-pokemon',
      desc: '지진의 충격으로 자신의 주위에 있는 포켓몬을 공격한다.',
      descEn: 'The user sets off an earthquake.',
    },
    'Aurora Veil': {
      n: 'Aurora Veil',
      ko: '오로라베일',
      type: 'ice',
      cls: 'status',
      pow: null,
      acc: null,
      pp: 20,
      pri: 0,
      desc: '5턴 동안 물리와 특수 기술의 데미지를 약하게 한다.',
    },
    'Ice Shard': {
      n: 'Ice Shard',
      ko: '얼음뭉치',
      type: 'ice',
      cls: 'physical',
      pow: 40,
      acc: 100,
      pp: 30,
      pri: 1,
      desc: '반드시 선제공격을 할 수 있다.',
    },
    // 9세대 신규 기술 — 공식 한국어 설명이 아직 없다
    Trailblaze: {
      n: 'Trailblaze',
      ko: '개척하기',
      type: 'grass',
      cls: 'physical',
      pow: 50,
      acc: 100,
      pp: 20,
      pri: 0,
      desc: null,
      descEn: 'The user attacks and raises Speed.',
    },
  },
};

describe('normalizeMoves', () => {
  const dex = normalizeMoves(RAW);

  it('Champions 영문명을 키로 쓴다', () => {
    expect(dex.has('Earthquake')).toBe(true);
    expect(dex.has('Aurora Veil')).toBe(true);
    expect(dex.get('Earthquake')?.englishName).toBe('Earthquake');
  });

  it('한국어 이름을 표시명으로 삼는다', () => {
    expect(dex.get('Earthquake')?.displayName).toBe('지진');
    expect(dex.get('Ice Shard')?.displayName).toBe('얼음뭉치');
  });

  it('제원을 그대로 옮긴다', () => {
    const eq = dex.get('Earthquake')!;
    expect(eq.power).toBe(100);
    expect(eq.accuracy).toBe(100);
    expect(eq.pp).toBe(10);
    expect(eq.damageClass).toBe('physical');
    expect(eq.type).toBe('Ground');
  });

  it('변화기술의 위력·명중률을 0 으로 위조하지 않는다', () => {
    const veil = dex.get('Aurora Veil')!;
    expect(veil.power).toBeNull();
    expect(veil.accuracy).toBeNull();
    expect(veil.pp).toBe(20);
    expect(veil.damageClass).toBe('status');
  });

  it('우선도를 보존한다 (선제공격 판단에 필요하다)', () => {
    expect(dex.get('Ice Shard')?.priority).toBe(1);
    expect(dex.get('Earthquake')?.priority).toBe(0);
  });

  it('타입 slug 를 앱 표기로 맞춘다', () => {
    expect(dex.get('Aurora Veil')?.type).toBe('Ice');
    expect(dex.get('Trailblaze')?.type).toBe('Grass');
  });

  it('한국어 설명이 없으면 영문으로 폴백하고 그 사실을 표시한다', () => {
    const trail = dex.get('Trailblaze')!;
    expect(trail.description).toBe('The user attacks and raises Speed.');
    expect(trail.descriptionIsFallback).toBe(true);
    // 이름은 한국어가 있다 — 설명만 없는 것이다.
    expect(trail.displayName).toBe('개척하기');
  });

  it('한국어 설명이 있으면 폴백으로 표시하지 않는다', () => {
    expect(dex.get('Earthquake')?.descriptionIsFallback).toBe(false);
  });

  it('빈 파일에도 죽지 않는다', () => {
    expect(normalizeMoves({}).size).toBe(0);
    expect(normalizeMoves({ moves: {} }).size).toBe(0);
  });

  it('알 수 없는 분류는 null 로 둔다', () => {
    const odd = normalizeMoves({ moves: { X: { n: 'X', cls: 'weird' } } });
    expect(odd.get('X')?.damageClass).toBeNull();
  });
});

describe('moveDisplayName', () => {
  const dex = normalizeMoves(RAW);

  it('도감에 있으면 한국어명을 준다', () => {
    expect(moveDisplayName(dex, 'Earthquake')).toBe('지진');
  });

  it('도감에 없으면 영문명을 그대로 둔다 (이름을 지어내지 않는다)', () => {
    expect(moveDisplayName(dex, 'Unknown Move')).toBe('Unknown Move');
  });

  it('도감 로딩이 실패했어도 영문명으로 동작한다', () => {
    expect(moveDisplayName(null, 'Earthquake')).toBe('Earthquake');
  });
});

describe('분류 라벨', () => {
  it('세 분류를 한국어로 적는다', () => {
    expect(DAMAGE_CLASS_LABEL.physical).toBe('물리');
    expect(DAMAGE_CLASS_LABEL.special).toBe('특수');
    expect(DAMAGE_CLASS_LABEL.status).toBe('변화');
  });
});
