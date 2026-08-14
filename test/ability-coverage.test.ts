/**
 * 로스터 특성 커버리지 점검.
 *
 * 테스트라기보다 **현황 보고**에 가깝다. Champions 로스터가 실제로 가진 특성 중
 * 몇 개가 계산에 반영되는지, 어떤 것이 왜 빠졌는지를 눈에 보이게 남긴다.
 * 커버리지가 떨어지면(새 특성이 로스터에 추가되면) 여기서 드러난다.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { UNSUPPORTED_ABILITIES, affectsDamage } from '../src/core/abilities';
import { normalizeTerms } from '../src/adapters/termDex';

const termsPath = path.join(import.meta.dirname, '..', 'public', 'data', 'terms.json');

describe('로스터 특성 커버리지', () => {
  it('현황을 집계한다', () => {
    const terms = normalizeTerms(JSON.parse(readFileSync(termsPath, 'utf8')));
    const all = [...terms.abilities.keys()];
    expect(all.length).toBeGreaterThan(100);

    const implemented = all.filter((name) => affectsDamage(name));
    const unsupported = all.filter((name) => UNSUPPORTED_ABILITIES.has(name));

    const ko = (name: string) => terms.abilities.get(name)?.displayName ?? name;
    process.stdout.write(
      `\n  로스터 특성 ${all.length}종\n` +
        `    계산 반영 ${implemented.length}종: ${implemented.map(ko).join(', ')}\n` +
        `    미지원 ${unsupported.length}종: ${unsupported.map(ko).join(', ')}\n`,
    );

    // 구현한 것과 미지원 목록이 겹치면 안 된다 — 둘 중 하나여야 한다.
    for (const name of implemented) {
      expect(UNSUPPORTED_ABILITIES.has(name)).toBe(false);
    }
  });

  it('대표적인 대미지 특성이 빠져 있지 않다', () => {
    // 실전에서 계산에 자주 걸리는 것들. 하나라도 빠지면 계산이 조용히 틀린다.
    for (const name of [
      'Adaptability',
      'Technician',
      'Sheer Force',
      'Guts',
      'Thick Fat',
      'Multiscale',
      'Solid Rock',
      'Filter',
      'Levitate',
      'Flash Fire',
      'Mold Breaker',
      'Sturdy',
      'Ice Scales',
      // 기술 플래그 기반 (Showdown 에서 받아온다)
      'Iron Fist',
      'Tough Claws',
      'Bulletproof',
      // 사용자 지적으로 뒤늦게 발견한 것들 — 다시 빠지지 않게 고정한다
      'Protean',
      'Parental Bond',
      'Fur Coat',
      'Unaware',
    ]) {
      expect(affectsDamage(name), `${name} 이 구현되지 않았습니다`).toBe(true);
    }
  });
});
