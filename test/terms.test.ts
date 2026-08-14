/**
 * 용어 도감 어댑터 테스트.
 *
 * 계약: 키는 Champions 표기 영문명이고, 못 찾은 항목은 영문을 그대로 둔다.
 * 도감이 통째로 없어도(로딩 실패) 모든 조회 함수가 영문으로 동작해야 한다.
 */

import { describe, expect, it } from 'vitest';
import {
  abilityName,
  itemName,
  natureName,
  normalizeTerms,
  statText,
  typeName,
} from '../src/adapters/termDex';

const RAW = {
  types: { Ground: '땅', Dragon: '드래곤', Fire: '불꽃' },
  abilities: {
    'Rough Skin': { ko: '까칠한피부', desc: '접촉한 상대에게 데미지를 준다.' },
    'Sand Veil': { ko: '모래숨기', desc: null, descEn: 'Boosts evasion in a sandstorm.' },
  },
  items: {
    'Focus Sash': { ko: '기합의띠', desc: null },
    'Choice Scarf': { ko: '구애스카프', desc: '스피드가 올라가지만 같은 기술만 쓸 수 있다.' },
  },
  natures: {
    Jolly: { ko: '명랑', up: 'speed', down: 'special-attack' },
    Hardy: { ko: '노력', up: null, down: null },
  },
};

const dex = normalizeTerms(RAW);

describe('normalizeTerms', () => {
  it('네 종류를 모두 담는다', () => {
    expect(dex.types.size).toBe(3);
    expect(dex.abilities.size).toBe(2);
    expect(dex.items.size).toBe(2);
    expect(dex.natures.size).toBe(2);
  });

  it('한국어 설명이 없으면 영문으로 폴백하고 그 사실을 표시한다', () => {
    const sandVeil = dex.abilities.get('Sand Veil')!;
    expect(sandVeil.displayName).toBe('모래숨기');
    expect(sandVeil.description).toBe('Boosts evasion in a sandstorm.');
    expect(sandVeil.descriptionIsFallback).toBe(true);
  });

  it('한국어 설명이 있으면 폴백으로 표시하지 않는다', () => {
    expect(dex.abilities.get('Rough Skin')?.descriptionIsFallback).toBe(false);
  });

  it('설명이 아예 없어도 이름은 살린다', () => {
    const sash = dex.items.get('Focus Sash')!;
    expect(sash.displayName).toBe('기합의띠');
    expect(sash.description).toBeNull();
  });

  it('성격의 보정 스탯을 보존한다', () => {
    expect(dex.natures.get('Jolly')).toMatchObject({
      displayName: '명랑',
      up: 'speed',
      down: 'special-attack',
    });
  });

  it('무보정 성격은 up/down 이 null 이다', () => {
    expect(dex.natures.get('Hardy')?.up).toBeNull();
  });

  it('빈 파일에도 죽지 않는다', () => {
    const empty = normalizeTerms({});
    expect(empty.types.size).toBe(0);
    expect(empty.items.size).toBe(0);
  });
});

describe('조회 함수 — 없으면 영문을 그대로 둔다', () => {
  it('타입', () => {
    expect(typeName(dex, 'Ground')).toBe('땅');
    expect(typeName(dex, 'Fairy')).toBe('Fairy');
  });

  it('특성', () => {
    expect(abilityName(dex, 'Rough Skin')).toBe('까칠한피부');
    expect(abilityName(dex, 'Unknown Ability')).toBe('Unknown Ability');
  });

  it('도구', () => {
    expect(itemName(dex, 'Choice Scarf')).toBe('구애스카프');
    expect(itemName(dex, 'Unknown Item')).toBe('Unknown Item');
  });

  it('성격', () => {
    expect(natureName(dex, 'Jolly')).toBe('명랑');
    expect(natureName(dex, 'Unknown')).toBe('Unknown');
  });

  it('도감이 통째로 없어도 영문으로 동작한다', () => {
    expect(typeName(null, 'Ground')).toBe('Ground');
    expect(abilityName(null, 'Rough Skin')).toBe('Rough Skin');
    expect(itemName(null, 'Focus Sash')).toBe('Focus Sash');
    expect(natureName(null, 'Jolly')).toBe('Jolly');
  });
});

describe('statText — 배틀 데이터의 스탯 표기를 한국어로', () => {
  it('Champions 표기를 옮긴다', () => {
    expect(statText('Speed')).toBe('스피드');
    expect(statText('Sp. Atk')).toBe('특수공격');
    expect(statText('Sp. Def')).toBe('특수방어');
    expect(statText('Attack')).toBe('공격');
    expect(statText('Defense')).toBe('방어');
  });

  it('대소문자·공백에 흔들리지 않는다', () => {
    expect(statText(' speed ')).toBe('스피드');
    expect(statText('SP. ATK')).toBe('특수공격');
  });

  it('빈 값은 대시로', () => {
    expect(statText(undefined)).toBe('—');
    expect(statText('')).toBe('—');
  });

  it('모르는 표기는 원문을 둔다', () => {
    expect(statText('Wat')).toBe('Wat');
  });
});
