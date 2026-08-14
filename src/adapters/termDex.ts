/**
 * 용어 도감 — 타입 / 지닌 도구 / 특성 / 성격의 한국어 명칭.
 *
 * 출처는 PokéAPI 다 (scripts/build-terms.mjs 산출물).
 * 키는 **Champions 표기 영문명**이다. 사용률 데이터가 그 이름으로 오기 때문.
 *
 * 못 찾은 항목은 영문명을 그대로 둔다. 이름을 지어내지 않는다.
 */

import { TTL, fetchJson } from '../core/http';
import type { Loaded, TypeName } from '../types';

interface RawTerm {
  ko?: string | null;
  desc?: string | null;
  descEn?: string | null;
}

interface RawNature {
  ko?: string | null;
  up?: string | null;
  down?: string | null;
}

interface RawTermFile {
  generatedAt?: string;
  types?: Record<string, string>;
  abilities?: Record<string, RawTerm>;
  items?: Record<string, RawTerm>;
  natures?: Record<string, RawNature>;
  weights?: Record<string, number>;
}

export interface TermEntry {
  displayName: string;
  koreanName: string | null;
  description: string | null;
  descriptionIsFallback: boolean;
}

export interface NatureEntry {
  displayName: string;
  koreanName: string | null;
  /** 상승 스탯 slug. 무보정 성격은 null. */
  up: string | null;
  down: string | null;
}

export interface TermDex {
  types: Map<string, string>;
  abilities: Map<string, TermEntry>;
  items: Map<string, TermEntry>;
  natures: Map<string, NatureEntry>;
  /**
   * 폼별 몸무게(kg). championsbattledata 가 주지 않아 PokéAPI 에서 받는다.
   * 풀묶기·헤비봄버 계열의 위력이 여기 걸린다.
   */
  weights: Map<string, number>;
}

function toTermEntry(englishName: string, raw: RawTerm | undefined): TermEntry {
  const description = raw?.desc ?? raw?.descEn ?? null;
  return {
    displayName: raw?.ko ?? englishName,
    koreanName: raw?.ko ?? null,
    description,
    descriptionIsFallback: !raw?.desc && Boolean(raw?.descEn),
  };
}

export function normalizeTerms(raw: RawTermFile): TermDex {
  const types = new Map<string, string>();
  for (const [key, value] of Object.entries(raw?.types ?? {})) {
    if (key && typeof value === 'string') types.set(key, value);
  }

  const abilities = new Map<string, TermEntry>();
  for (const [key, value] of Object.entries(raw?.abilities ?? {})) {
    if (key) abilities.set(key, toTermEntry(key, value));
  }

  const items = new Map<string, TermEntry>();
  for (const [key, value] of Object.entries(raw?.items ?? {})) {
    if (key) items.set(key, toTermEntry(key, value));
  }

  const natures = new Map<string, NatureEntry>();
  for (const [key, value] of Object.entries(raw?.natures ?? {})) {
    if (!key) continue;
    natures.set(key, {
      displayName: value?.ko ?? key,
      koreanName: value?.ko ?? null,
      up: value?.up ?? null,
      down: value?.down ?? null,
    });
  }

  const weights = new Map<string, number>();
  for (const [key, value] of Object.entries(raw?.weights ?? {})) {
    if (key && typeof value === 'number' && value > 0) weights.set(key, value);
  }

  return { types, abilities, items, natures, weights };
}

let cached: Promise<Loaded<TermDex>> | null = null;

/** 실패해도 throw 하지 않는다 — 용어가 영문으로 나올 뿐 화면은 정상 동작한다. */
export function fetchTermDex(): Promise<Loaded<TermDex>> {
  if (cached) return cached;

  cached = (async (): Promise<Loaded<TermDex>> => {
    try {
      const { data } = await fetchJson<RawTermFile>(`${import.meta.env.BASE_URL}data/terms.json`, {
        ttlMs: TTL.buildArtifact,
        timeoutMs: 20_000,
      });
      const dex = normalizeTerms(data);
      if (dex.types.size === 0 && dex.abilities.size === 0) {
        return { status: 'empty', reason: '용어 데이터가 비어 있습니다.' };
      }
      return { status: 'ok', data: dex };
    } catch (err) {
      return {
        status: 'error',
        reason: err instanceof Error ? err.message : '용어 데이터를 불러오지 못했습니다.',
      };
    }
  })();

  return cached;
}

export function typeName(dex: TermDex | null, type: TypeName): string {
  return dex?.types.get(type) ?? type;
}

export function abilityName(dex: TermDex | null, englishName: string): string {
  return dex?.abilities.get(englishName)?.displayName ?? englishName;
}

export function itemName(dex: TermDex | null, englishName: string): string {
  return dex?.items.get(englishName)?.displayName ?? englishName;
}

export function natureName(dex: TermDex | null, englishName: string): string {
  return dex?.natures.get(englishName)?.displayName ?? englishName;
}

/** Champions 배틀 데이터의 스탯 표기("Sp. Atk")를 한국어로. */
const STAT_TEXT_KO: Record<string, string> = {
  hp: 'HP',
  attack: '공격',
  defense: '방어',
  'sp. atk': '특수공격',
  'sp.atk': '특수공격',
  'special-attack': '특수공격',
  'sp. def': '특수방어',
  'sp.def': '특수방어',
  'special-defense': '특수방어',
  speed: '스피드',
};

export function statText(raw: string | undefined): string {
  if (!raw) return '—';
  return STAT_TEXT_KO[raw.trim().toLowerCase()] ?? raw;
}

/** 폼의 몸무게(kg). 모르면 null — 호출부는 값을 지어내면 안 된다. */
export function weightOf(dex: TermDex | null, savedName: string): number | null {
  return dex?.weights.get(savedName) ?? null;
}
