/**
 * 메가 폼 ↔ 메가스톤 연결 테스트.
 *
 * 이름으로 잇는 방식이라 추측이 섞인다. 그래서 **로스터의 모든 메가 폼**을 전수로 확인한다.
 * 한 종이라도 엉뚱한 돌에 붙으면 계산기가 성립하지 않는 조합을 만들어 낸다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeIndex } from '../src/adapters/championsBattleData';
import { isMegaForm, isMegaStoneName, megaStoneFor } from '../src/core/megaStones';

const rawIndex = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'api-index.sample.json'), 'utf8'),
);
const index = normalizeIndex(rawIndex);

const terms = JSON.parse(
  readFileSync(path.join(import.meta.dirname, '..', 'public', 'data', 'terms.json'), 'utf8'),
) as { items: Record<string, unknown> };
const STONES = Object.keys(terms.items).filter(isMegaStoneName);

describe('메가스톤 판별', () => {
  it('돌 이름을 알아본다 (X·Y 갈래 포함)', () => {
    expect(isMegaStoneName('Garchompite')).toBe(true);
    expect(isMegaStoneName('Charizardite X')).toBe(true);
    expect(isMegaStoneName('Life Orb')).toBe(false);
    expect(isMegaStoneName('Focus Sash')).toBe(false);
  });

  it('로스터에 돌이 충분히 있다', () => {
    expect(STONES.length).toBeGreaterThan(50);
  });
});

describe('폼 연결', () => {
  it('메가가 아니면 돌을 요구하지 않는다', () => {
    const garchomp = index.byShowdownId.get('garchomp')!;
    expect(megaStoneFor(garchomp, garchomp.primary, STONES)).toBeNull();
  });

  it('메가 폼에 맞는 돌을 찾는다', () => {
    const garchomp = index.byShowdownId.get('garchomp')!;
    const mega = garchomp.forms.find(isMegaForm)!;
    expect(megaStoneFor(garchomp, mega, STONES)).toBe('Garchompite');
  });

  it('X·Y 는 서로 다른 돌이다', () => {
    // form_kind 가 'Mega X' / 'Mega Y' 로 오므로 'Mega' 완전일치로 보면 놓친다.
    const fake = (formName: string, formKind: string) => ({
      ...index.byShowdownId.get('garchomp')!.primary,
      formName,
      formKind,
    });
    const charizard = { ...index.byShowdownId.get('garchomp')!, name: 'Charizard' };
    expect(megaStoneFor(charizard, fake('Mega Charizard X', 'Mega X'), STONES)).toBe(
      'Charizardite X',
    );
    expect(megaStoneFor(charizard, fake('Mega Charizard Y', 'Mega Y'), STONES)).toBe(
      'Charizardite Y',
    );
  });

  it('지역폼 종이어도 폼 이름으로 찾는다', () => {
    // 'Galarian Slowbro' 종의 'Mega Slowbro' 는 종 이름과 한 글자도 안 겹친다.
    const slowbro = { ...index.byShowdownId.get('garchomp')!, name: 'Galarian Slowbro' };
    const form = {
      ...index.byShowdownId.get('garchomp')!.primary,
      formName: 'Mega Slowbro',
      formKind: 'Mega',
    };
    expect(megaStoneFor(slowbro, form, STONES)).toBe('Slowbronite');
  });

  it('로스터의 메가 폼이 전부 정확히 하나의 돌로 이어진다', () => {
    // 이름으로 잇는 방식이라 여기서 전수로 확인한다. 실제 인덱스에서 뽑은 목록이다.
    const forms = JSON.parse(
      readFileSync(path.join(import.meta.dirname, 'fixtures', 'mega-forms.json'), 'utf8'),
    ) as { species: string; formName: string; formKind: string }[];
    expect(forms.length).toBeGreaterThan(70);

    const base = index.byShowdownId.get('garchomp')!;
    const unresolved: string[] = [];
    const used = new Set<string>();

    for (const row of forms) {
      const mon = { ...base, name: row.species };
      const form = { ...base.primary, formName: row.formName, formKind: row.formKind };
      const stone = megaStoneFor(mon, form, STONES);
      if (stone === null) unresolved.push(`${row.species} / ${row.formName}`);
      else used.add(stone);
    }

    expect(unresolved, `돌을 못 찾은 폼: ${unresolved.join(', ')}`).toEqual([]);
    // 같은 돌에 여러 폼이 몰리면 매칭이 뭉개진 것이다.
    // (지역폼 종이 같은 forms 배열을 공유해서 폼 수보다는 적다.)
    expect(used.size).toBeGreaterThanOrEqual(60);
  });

  it('짧게 겹치는 우연한 일치는 받아들이지 않는다', () => {
    const odd = { ...index.byShowdownId.get('garchomp')!, name: 'Zzzz' };
    const form = {
      ...index.byShowdownId.get('garchomp')!.primary,
      formName: 'Mega Zzzz',
      formKind: 'Mega',
    };
    expect(megaStoneFor(odd, form, STONES)).toBeNull();
  });
});
