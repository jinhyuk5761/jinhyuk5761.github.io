/**
 * 어댑터 normalize() 스냅샷 테스트 — 설계 문서 7절.
 *
 * 픽스처는 2026-08 실응답을 잘라낸 것이다. 팬 API 는 예고 없이 필드가 바뀌므로
 * (설계 문서 9절 "스키마 드리프트") 여기서 조기에 감지하는 것이 목적이다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { normalizeBattle, normalizeIndex } from '../src/adapters/championsBattleData';
import { normalizeCounters, sharedCounters } from '../src/adapters/smogonCounters';
import { normalizeBuilds } from '../src/adapters/frozenSeason';
import { normalizeRanking } from '../src/adapters/officialRanking';
import { normalizeLearnset } from '../src/adapters/showdownLearnset';
import { normalizeLocales, searchHaystack } from '../src/adapters/pokeApi';
import { defensiveProfile, effectiveness } from '../src/core/typechart';

const readFixture = (name: string) =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));

const rawIndex = readFixture('api-index.sample.json');
const rawBattle = readFixture('battle-singles-garchomp.json');

describe('championsBattleData / normalizeIndex', () => {
  const index = normalizeIndex(rawIndex);

  it('showdownId 중복을 제거한다 (상류에 rotomfan 이 2건 있다)', () => {
    const rotom = rawIndex.pokemon.filter((p: { showdownId: string }) => p.showdownId === 'rotomfan');
    expect(rotom.length).toBe(2);
    expect(index.pokemon.filter((p) => p.showdownId === 'rotomfan').length).toBe(1);
  });

  it('중복 두 건이 반쪽씩 가진 것을 합친다', () => {
    /*
     * 상류의 rotomfan 두 건은 서로 다른 쪽이 반쪽씩 갖고 있다.
     *   Fan Rotom — 사용률 순위는 있는데 폼 1개에 그림 파일이 상류에 없다
     *   Rotom Fan — 폼 6개와 멀쩡한 그림이 있는데 순위가 없다
     * 한쪽만 고르면 순위를 잃거나 그림을 잃는다.
     */
    const merged = normalizeIndex({
      pokemon: [
        {
          slug: 'fan-rotom',
          showdownId: 'rotomfan',
          name: 'Fan Rotom',
          summary: {
            primary: { slug: 'fan-rotom', form_name: 'Fan Rotom', image_path: 'x/Fan Rotom.png' },
            forms: [{ slug: 'fan-rotom', form_name: 'Fan Rotom', image_path: 'x/Fan Rotom.png' }],
            battleSummary: { Current: { Singles: { position: 217 }, Doubles: { position: 216 } } },
          },
        },
        {
          slug: 'rotom-fan',
          showdownId: 'rotomfan',
          name: 'Rotom Fan',
          summary: {
            primary: { slug: 'rotom-fan', form_name: 'Rotom Fan', image_path: 'x/Rotom Fan.png' },
            forms: [
              { slug: 'rotom', form_name: 'Rotom', image_path: 'x/Rotom.png' },
              { slug: 'rotom-fan', form_name: 'Rotom Fan', image_path: 'x/Rotom Fan.png' },
              { slug: 'rotom-wash', form_name: 'Rotom Wash', image_path: 'x/Rotom Wash.png' },
            ],
          },
        },
      ],
    } as never);

    const rotomfan = merged.byShowdownId.get('rotomfan')!;
    expect(merged.pokemon.filter((p) => p.showdownId === 'rotomfan').length).toBe(1);
    // 순위는 앞 건에서, 폼과 그림은 뒤 건에서 온다.
    expect(rotomfan.usageRank).toEqual({ Singles: 217, Doubles: 216 });
    expect(rotomfan.forms.map((f) => f.slug)).toEqual(['rotom', 'rotom-fan', 'rotom-wash']);
    expect(rotomfan.primary.spriteUrl).toContain('Rotom%20Fan.png');
    expect(rotomfan.primary.spriteUrl).not.toContain('Fan%20Rotom.png');
  });

  it('종족값을 Champions 자체 스케일 그대로 읽는다 (본가 수치로 바꾸지 않는다)', () => {
    const garchomp = index.byShowdownId.get('garchomp');
    expect(garchomp).toBeDefined();
    const stats = garchomp!.primary.stats;
    expect(stats.total).toBeGreaterThan(400);
    expect(stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe).toBe(stats.total);
  });

  it('파이프로 구분된 특성 문자열을 배열로 쪼갠다', () => {
    const garchomp = index.byShowdownId.get('garchomp')!;
    expect(garchomp.primary.abilities.length).toBeGreaterThan(0);
    expect(garchomp.primary.abilities.some((a) => a.includes('|'))).toBe(false);
  });

  it('폼을 모두 보존한다 (메가/지역폼)', () => {
    const garchomp = index.byShowdownId.get('garchomp')!;
    expect(garchomp.forms.length).toBeGreaterThan(1);
    expect(garchomp.forms.some((f) => f.formKind === 'Mega')).toBe(true);
  });

  it('스프라이트 URL 의 공백을 인코딩한다', () => {
    const garchomp = index.byShowdownId.get('garchomp')!;
    const mega = garchomp.forms.find((f) => f.formKind === 'Mega')!;
    expect(mega.spriteUrl).toContain('%20');
    expect(mega.spriteUrl.startsWith('https://')).toBe(true);
  });

  it('사용률 순위를 포맷별로 읽는다', () => {
    // 인덱스가 이미 갖고 있는 값이라 순위를 위해 따로 요청하지 않는다.
    const garchomp = index.byShowdownId.get('garchomp')!;
    expect(garchomp.usageRank.Singles).toBe(1);
    expect(garchomp.usageRank.Doubles).toBe(1);

    const ninetales = index.byShowdownId.get('ninetalesalola')!;
    expect(ninetales.usageRank.Singles).toBe(21);
    expect(ninetales.usageRank.Doubles).toBe(29);
  });

  it('순위가 없으면 null 이다 (0 이나 큰 수로 채우지 않는다)', () => {
    const noRank = normalizeIndex({
      pokemon: [{ showdownId: 'x', name: 'X', summary: { primary: rawIndex.pokemon[0].summary.primary } }],
    });
    expect(noRank.pokemon[0]!.usageRank).toEqual({ Singles: null, Doubles: null });
  });

  it('중복 항목 중 순위가 붙은 쪽을 남긴다', () => {
    // rotomfan 은 두 건인데 한쪽에만 position 이 있다.
    // 순서에만 기대면 순위를 통째로 잃는다 — 순서를 뒤집어도 살아남아야 한다.
    const rotoms = rawIndex.pokemon.filter((p: { showdownId: string }) => p.showdownId === 'rotomfan');
    const reversed = normalizeIndex({ pokemon: [...rotoms].reverse() });
    expect(reversed.byShowdownId.get('rotomfan')!.usageRank.Singles).toBe(217);

    // 원래 순서에서도 당연히 유지된다.
    expect(index.byShowdownId.get('rotomfan')!.usageRank.Singles).toBe(217);
  });

  it('빈 응답에도 죽지 않는다', () => {
    expect(normalizeIndex({}).pokemon).toEqual([]);
    expect(normalizeIndex({ pokemon: [{}] }).pokemon).toEqual([]);
  });
});

describe('championsBattleData / normalizeBattle', () => {
  const report = normalizeBattle(rawBattle, 'Singles', 'garchomp');

  it('실응답의 카테고리를 그대로 잡는다 (tera 는 존재하지 않는다)', () => {
    const categories = report.blocks.map((b) => b.category);
    expect(categories).toContain('move');
    expect(categories).toContain('held_item');
    expect(categories).toContain('ability');
    expect(categories).toContain('stat_alignment');
    expect(categories).toContain('stat_points');
    expect(categories).toContain('teammate');
    expect(categories).not.toContain('tera');
  });

  it('정해둔 순서대로 블록을 낸다', () => {
    expect(report.blocks.map((b) => b.category)).toEqual([
      'move',
      'held_item',
      'ability',
      'stat_alignment',
      'stat_points',
      'teammate',
    ]);
  });

  it('teammate 는 비율이 없다 (null 로 떨어뜨리고 0 으로 위조하지 않는다)', () => {
    const teammates = report.blocks.find((b) => b.category === 'teammate')!;
    expect(teammates.entries.every((e) => e.percentageValue === null)).toBe(true);
  });

  it('stat_points 행에만 노력치 분배를 붙인다', () => {
    const spreads = report.blocks.find((b) => b.category === 'stat_points')!;
    expect(spreads.entries[0]?.points).toBeDefined();
    const moves = report.blocks.find((b) => b.category === 'move')!;
    expect(moves.entries[0]?.points).toBeUndefined();
  });

  it('stat_alignment 에 성격 보정을 담는다', () => {
    const natures = report.blocks.find((b) => b.category === 'stat_alignment')!;
    expect(natures.entries[0]?.statUp).toBeTruthy();
  });

  it('처음 보는 카테고리도 버리지 않는다 (스키마 드리프트 대비)', () => {
    const drifted = normalizeBattle(
      { rows: [{ category: 'tera_type', rank: 1, name: 'Steel', percentage: '10%', percentage_value: 10 }] },
      'Singles',
      'x',
    );
    expect(drifted.blocks.map((b) => b.category)).toEqual(['tera_type']);
  });

  it('rows 가 없어도 죽지 않는다', () => {
    expect(normalizeBattle({}, 'Doubles', 'x').blocks).toEqual([]);
  });
});

describe('smogonCounters / normalizeCounters', () => {
  const raw = {
    format: 'Singles',
    metagame: 'gen9championsbssregmb',
    cutoff: 1500,
    months: ['2026-07'],
    battles: 97966,
    targets: {
      Garchomp: {
        showdownId: 'garchomp',
        entries: [
          { s: 'Ninetales-Alola', c: 'Alolan Ninetales', i: 'ninetalesalola', n: 1048, p: 0.81, d: 0.017 },
          { s: 'Mamoswine', c: 'Mamoswine', i: 'mamoswine', n: 270, p: 0.83, d: 0.032 },
        ],
      },
    },
  };

  it('폼 단위 키와 종 단위 역인덱스를 함께 만든다', () => {
    const dataset = normalizeCounters(raw, 'Singles');
    expect(dataset.bySavedName.get('Garchomp')?.length).toBe(2);
    expect(dataset.formsByShowdownId.get('garchomp')).toEqual(['Garchomp']);
  });

  it('매칭 실패한 항목도 Showdown 표기로 살려둔다', () => {
    const dataset = normalizeCounters(
      { targets: { X: { entries: [{ s: 'Floette-Eternal', c: null, i: null, n: 30, p: 0.5, d: 0.1 }] } } },
      'Singles',
    );
    const entry = dataset.bySavedName.get('X')![0]!;
    expect(entry.smogonName).toBe('Floette-Eternal');
    expect(entry.championsSavedName).toBeNull();
  });

  it('빈 파일에도 죽지 않는다', () => {
    expect(normalizeCounters({}, 'Doubles').bySavedName.size).toBe(0);
  });
});

describe('smogonCounters / sharedCounters', () => {
  it('공통 카운터는 두 상대 중 낮은 우위를 쓴다', () => {
    const a = [{ smogonName: 'Mamoswine', championsSavedName: 'Mamoswine', showdownId: 'mamoswine', n: 300, p: 0.9, d: 0 }];
    const b = [{ smogonName: 'Mamoswine', championsSavedName: 'Mamoswine', showdownId: 'mamoswine', n: 120, p: 0.6, d: 0 }];
    const shared = sharedCounters(a, b);
    expect(shared.length).toBe(1);
    // 0.9 가 아니라 0.6 — '둘 다' 잡아야 공통 카운터다.
    expect(shared[0]!.p).toBe(0.6);
    expect(shared[0]!.n).toBe(120);
  });

  it('한쪽에만 있는 카운터는 제외한다', () => {
    const a = [{ smogonName: 'Mamoswine', championsSavedName: null, showdownId: null, n: 1, p: 0.9, d: 0 }];
    const b = [{ smogonName: 'Scizor', championsSavedName: null, showdownId: null, n: 1, p: 0.9, d: 0 }];
    expect(sharedCounters(a, b)).toEqual([]);
  });
});

describe('frozenSeason / normalizeBuilds', () => {
  it('출처 없는 항목을 버린다 (설계 문서 6절)', () => {
    expect(normalizeBuilds([{ title: '출처 없음' }])).toEqual([]);
  });

  it('X / YouTube 링크를 버린다 (설계 문서 M5)', () => {
    const rejected = normalizeBuilds([
      { title: 'a', sourceUrl: 'https://x.com/post/1' },
      { title: 'b', sourceUrl: 'https://www.youtube.com/watch?v=1' },
      { title: 'c', sourceUrl: 'https://youtu.be/1' },
    ]);
    expect(rejected).toEqual([]);
  });

  it('정상 항목은 통과시키고 번역 라벨을 보존한다', () => {
    const builds = normalizeBuilds([
      { title: '구축', sourceUrl: 'https://note.com/a/b', translated: true, format: 'Doubles' },
    ]);
    expect(builds.length).toBe(1);
    expect(builds[0]!.translated).toBe(true);
    expect(builds[0]!.format).toBe('Doubles');
    expect(builds[0]!.sourceLabel).toBe('note.com');
  });

  it('올바르지 않은 URL 을 버린다', () => {
    expect(normalizeBuilds([{ title: 'a', sourceUrl: 'not-a-url' }])).toEqual([]);
  });
});

describe('officialRanking / normalizeRanking', () => {
  it('중첩된 배열을 찾아낸다 (공식 스키마는 계약이 아니다)', () => {
    const result = normalizeRanking({
      payload: { data: { ranking: [{ rank: 1, name: 'A', wins: 30, losses: 10 }] } },
    });
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.nickname).toBe('A');
  });

  it('승률이 없으면 승패로 계산한다', () => {
    const result = normalizeRanking({ payload: [{ rank: 1, name: 'A', wins: 30, losses: 10 }] });
    expect(result.rows[0]!.winRate).toBeCloseTo(75);
  });

  it('필드명이 달라도 후보를 훑어 찾는다', () => {
    const result = normalizeRanking({ payload: [{ position: 3, trainerName: 'B', rating: '1,850' }] });
    expect(result.rows[0]!.rank).toBe(3);
    expect(result.rows[0]!.nickname).toBe('B');
    expect(result.rows[0]!.points).toBe(1850);
  });

  it('공개 범위(상위 N위)를 보고한다', () => {
    const result = normalizeRanking({ payload: [{ rank: 1, name: 'A' }, { rank: 50, name: 'B' }] });
    expect(result.coverageLimit).toBe(50);
  });

  it('알 수 없는 형태에는 빈 표를 준다', () => {
    expect(normalizeRanking({}).rows).toEqual([]);
    expect(normalizeRanking({ payload: 'nope' }).rows).toEqual([]);
  });
});

describe('showdownLearnset / normalizeLearnset', () => {
  const index = normalizeIndex(rawIndex);
  const garchomp = index.byShowdownId.get('garchomp')!;
  const usage = normalizeBattle(rawBattle, 'Singles', 'garchomp');

  it('채택 기술과 미채택 기술을 가른다', () => {
    const view = normalizeLearnset(garchomp, usage);
    expect(view.used.length).toBeGreaterThan(0);
    expect(view.total).toBe(garchomp.learnableMoveNames.length);
    const usedNames = new Set(view.used.map((m) => m.name));
    expect(view.unused.every((name) => !usedNames.has(name))).toBe(true);
  });

  it('사용률이 없으면 전부 미채택으로 떨어뜨린다', () => {
    const view = normalizeLearnset(garchomp, null);
    expect(view.used).toEqual([]);
    expect(view.unused.length).toBe(view.total);
  });
});

describe('pokeApi / normalizeLocales', () => {
  it('로케일 명칭과 종 명칭을 함께 담는다', () => {
    const map = normalizeLocales({
      ninetalesalola: {
        en: 'Alolan Ninetales',
        ko: '알로라 나인테일',
        ja: 'アローラキュウコン',
        koSpecies: '나인테일',
        jaSpecies: 'キュウコン',
      },
    });
    expect(map.get('ninetalesalola')?.ko).toBe('알로라 나인테일');
    expect(map.get('ninetalesalola')?.koSpecies).toBe('나인테일');
  });

  it('검색 대상에 종 명칭까지 넣는다 (수식어 없이도 걸리게)', () => {
    const index = normalizeIndex(rawIndex);
    const mon = index.byShowdownId.get('ninetalesalola')!;
    const map = normalizeLocales({
      ninetalesalola: { en: 'Alolan Ninetales', ko: '알로라 나인테일', koSpecies: '나인테일' },
    });
    expect(searchHaystack(mon, map)).toContain('나인테일');
  });

  it('로케일이 없어도 영문으로 동작한다', () => {
    const index = normalizeIndex(rawIndex);
    const mon = index.byShowdownId.get('garchomp')!;
    expect(searchHaystack(mon, new Map())).toContain('Garchomp');
  });
});

describe('typechart', () => {
  it('이중 약점을 곱한다', () => {
    // 한카리아스는 땅/드래곤 — 얼음에 4배.
    expect(effectiveness('Ice', ['Ground', 'Dragon'])).toBe(4);
  });

  it('무효를 0 으로 처리한다', () => {
    expect(effectiveness('Electric', ['Ground', 'Dragon'])).toBe(0);
    expect(effectiveness('Dragon', ['Fairy'])).toBe(0);
  });

  it('약점/내성/무효를 나눠 정리한다', () => {
    const profile = defensiveProfile(['Ground', 'Dragon']);
    expect(profile.weaknesses[0]).toEqual({ multiplier: 4, types: ['Ice'] });
    expect(profile.immunities).toEqual(['Electric']);
    expect(profile.resistances.length).toBeGreaterThan(0);
  });

  it('1배는 어디에도 넣지 않는다', () => {
    const profile = defensiveProfile(['Normal']);
    expect(profile.weaknesses.flatMap((w) => w.types)).toEqual(['Fighting']);
    expect(profile.immunities).toEqual(['Ghost']);
  });
});
