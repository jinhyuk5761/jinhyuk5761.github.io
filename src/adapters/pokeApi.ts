/**
 * A등급 — PokéAPI (로케일 명칭 전용)
 *
 * 런타임에 PokéAPI 를 직접 때리지 않는다. scripts/build-locales.mjs 가 만든
 * public/data/locales.json 을 읽는다. 이유는 설계 문서 5절(레이트리밋 → 빌드타임 캐싱).
 *
 * 중요: 종족값·타입은 여기서 절대 가져오지 않는다.
 * Champions 는 자체 밸런스 스케일을 쓰기 때문에(Abomasnow 669 vs 본가 494)
 * PokéAPI 수치를 섞으면 틀린 값이 화면에 나간다. 수치의 유일한 출처는 championsbattledata 다.
 */

import type { FormNameMap } from '../core/formNames';
import { TTL, fetchJson } from '../core/http';
import type { Pokemon } from '../types';

interface RawLocaleEntry {
  en?: string;
  ko?: string | null;
  ja?: string | null;
  /** 폼 수식어가 빠진 종 명칭. 검색이 "나인테일"로도 걸리게 하려고 따로 둔다. */
  koSpecies?: string | null;
  jaSpecies?: string | null;
}

export interface LocaleNames {
  en: string;
  ko?: string;
  ja?: string;
  koSpecies?: string;
  jaSpecies?: string;
}

export type LocaleMap = Map<string, LocaleNames>;

export function normalizeLocales(raw: Record<string, RawLocaleEntry>): LocaleMap {
  const map: LocaleMap = new Map();
  for (const [showdownId, entry] of Object.entries(raw ?? {})) {
    if (!showdownId) continue;
    const names: LocaleNames = { en: entry?.en ?? showdownId };
    if (entry?.ko) names.ko = entry.ko;
    if (entry?.ja) names.ja = entry.ja;
    if (entry?.koSpecies) names.koSpecies = entry.koSpecies;
    if (entry?.jaSpecies) names.jaSpecies = entry.jaSpecies;
    map.set(showdownId, names);
  }
  return map;
}

/**
 * 폼 이름의 공식 한국어 표기.
 *
 * 빌드 산출물이라 실패해도 앱은 산다 — 그때는 폼 이름이 영문으로 남을 뿐이다.
 */
interface RawFormNames {
  /** Champions 폼 slug → 한국어 폼 표기. */
  forms?: Record<string, string>;
  /** 일본어 폼 표기 → 한국어. 빌드 스크립트가 쓰는 표라 화면에서는 안 본다. */
  jaLabels?: Record<string, string>;
}

export async function fetchFormNames(): Promise<FormNameMap> {
  const { data } = await fetchJson<RawFormNames>(
    `${import.meta.env.BASE_URL}data/formNames.json`,
    { ttlMs: TTL.buildArtifact, timeoutMs: 15_000, persist: true },
  );
  const map: FormNameMap = new Map();
  for (const [slug, korean] of Object.entries(data?.forms ?? {})) {
    if (slug && korean) map.set(slug, korean);
  }
  return map;
}

export async function fetchLocales(): Promise<LocaleMap> {
  const { data } = await fetchJson<Record<string, RawLocaleEntry>>(
    `${import.meta.env.BASE_URL}data/locales.json`,
    { ttlMs: TTL.buildArtifact, timeoutMs: 15_000, persist: true },
  );
  return normalizeLocales(data);
}

/**
 * 인덱스에 한국어 표시명을 입힌다.
 *
 * 표시는 한국어 단일이다. 일본어·영어 명칭은 화면에 쓰지 않지만 **검색에는 계속 쓴다**
 * (searchHaystack 참고) — M1 완료 기준이 "한카리아스/garchomp/ガブリアス 가 같은 결과"이기 때문.
 *
 * 한국어 명칭이 없으면 영문으로 폴백한다. 로케일 데이터가 통째로 없어도
 * 영문으로 정상 동작한다 — 어댑터 하나가 죽어도 앱은 산다(설계 문서 2절).
 */
export function applyLocales(pokemon: Pokemon[], locales: LocaleMap): void {
  for (const mon of pokemon) {
    const names = locales.get(mon.showdownId);
    if (!names) continue;
    mon.localeNames = {
      en: names.en,
      ...(names.ko ? { ko: names.ko } : {}),
      ...(names.ja ? { ja: names.ja } : {}),
    };
    mon.displayName = names.ko ?? names.en ?? mon.name;
  }
}

/** 검색 대상 문자열 묶음. 로케일 전환과 무관하게 항상 전부 뒤진다. */
export function searchHaystack(mon: Pokemon, locales: LocaleMap): string[] {
  const names = locales.get(mon.showdownId);
  return [
    mon.name,
    mon.showdownId,
    mon.slug,
    names?.ko,
    names?.ja,
    names?.koSpecies,
    names?.jaSpecies,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
}
