/**
 * A등급 — Smogon Checks & Counters
 *
 * 2026-08 확인 결과, 설계 문서의 전제 하나가 바뀌었다:
 * **더블 C&C 가 존재한다.** gen9championsvgc2026regmb 에 실제 C&C 블록이 있다.
 * 따라서 "더블은 싱글로 대체" 규칙은 적용하지 않는다. 각 포맷의 실데이터를 쓴다.
 * 다만 표본은 Showdown 래더이므로 Switch 랭크와 다르다는 경고는 그대로 상시 노출한다.
 *
 * 원본 chaos JSON 은 한 달치가 4~18MB 라 런타임에 못 읽는다.
 * scripts/build-counters.mjs 가 C&C 만 뽑아 압축한 산출물을 여기서 읽는다.
 */

import { TTL, fetchJson } from '../core/http';
import type { CounterBlock, CounterEntry, Format, Loaded } from '../types';

interface RawCounterEntry {
  /** Showdown 표기 */
  s?: string;
  /** 매칭된 Champions savedName */
  c?: string | null;
  /** 매칭된 Champions showdownId */
  i?: string | null;
  n?: number;
  p?: number;
  d?: number;
  /** 95% 하한 — 정렬 기준 */
  lb?: number;
}

interface RawCounterFile {
  format?: string;
  metagame?: string | null;
  cutoff?: number;
  months?: string[];
  battles?: number;
  targets?: Record<string, { showdownId?: string; entries?: RawCounterEntry[] }>;
}

export interface CounterDataset {
  format: Format;
  metagame: string;
  cutoff: number;
  months: string[];
  battles: number;
  /** key: Champions savedName (폼 단위) */
  bySavedName: Map<string, CounterEntry[]>;
  /** key: showdownId (종 단위) → 그 종에 속한 폼 savedName 목록 */
  formsByShowdownId: Map<string, string[]>;
}

export function normalizeCounters(raw: RawCounterFile, format: Format): CounterDataset {
  const bySavedName = new Map<string, CounterEntry[]>();
  const formsByShowdownId = new Map<string, string[]>();

  for (const [savedName, target] of Object.entries(raw?.targets ?? {})) {
    const entries: CounterEntry[] = [];
    for (const item of target?.entries ?? []) {
      if (!item?.s) continue;
      entries.push({
        smogonName: item.s,
        championsSavedName: item.c ?? null,
        showdownId: item.i ?? null,
        n: typeof item.n === 'number' ? item.n : 0,
        p: typeof item.p === 'number' ? item.p : 0,
        d: typeof item.d === 'number' ? item.d : 0,
      });
    }
    bySavedName.set(savedName, entries);

    const owner = target?.showdownId;
    if (owner) {
      const list = formsByShowdownId.get(owner) ?? [];
      list.push(savedName);
      formsByShowdownId.set(owner, list);
    }
  }

  return {
    format,
    metagame: raw?.metagame ?? '',
    cutoff: typeof raw?.cutoff === 'number' ? raw.cutoff : 0,
    months: raw?.months ?? [],
    battles: typeof raw?.battles === 'number' ? raw.battles : 0,
    bySavedName,
    formsByShowdownId,
  };
}

/**
 * URL 로 캐시한다. 서버가 데이터를 갱신하면 config 의 버전이 바뀌고 → URL 이 바뀌고
 * → 이 캐시가 자연히 비켜간다. 별도의 퍼지 로직이 필요 없다.
 */
const cache = new Map<string, Promise<Loaded<CounterDataset>>>();

/**
 * 포맷별 카운터 데이터셋. 실패해도 throw 하지 않는다 —
 * 카운터 탭만 "데이터 없음"이 되고 나머지 화면은 정상 동작해야 한다.
 */
export function fetchCounters(url: string, format: Format): Promise<Loaded<CounterDataset>> {
  const cached = cache.get(url);
  if (cached) return cached;

  const promise = (async (): Promise<Loaded<CounterDataset>> => {
    try {
      const { data } = await fetchJson<RawCounterFile>(url, {
        ttlMs: TTL.buildArtifact,
        timeoutMs: 30_000,
      });
      const dataset = normalizeCounters(data, format);
      if (!dataset.metagame || dataset.bySavedName.size === 0) {
        return { status: 'empty', reason: '이 포맷의 Smogon 통계가 아직 생성되지 않았습니다.' };
      }
      return { status: 'ok', data: dataset };
    } catch (err) {
      return {
        status: 'error',
        reason: err instanceof Error ? err.message : '카운터 데이터를 불러오지 못했습니다.',
      };
    }
  })();

  cache.set(url, promise);
  return promise;
}

/**
 * 한 종(showdownId)의 카운터를 폼별로 묶어 돌려준다.
 * 사용률은 종 단위인데 Smogon C&C 는 폼 단위라, 이 비대칭을 UI 가 아니라 여기서 흡수한다.
 */
export function countersForSpecies(
  dataset: CounterDataset,
  showdownId: string,
  formSavedNames: string[],
): CounterBlock[] {
  const candidates = new Set<string>([
    ...(dataset.formsByShowdownId.get(showdownId) ?? []),
    ...formSavedNames,
  ]);

  const blocks: CounterBlock[] = [];
  for (const savedName of candidates) {
    const entries = dataset.bySavedName.get(savedName);
    if (!entries || entries.length === 0) continue;
    blocks.push({
      targetSavedName: savedName,
      format: dataset.format,
      metagame: dataset.metagame,
      cutoff: dataset.cutoff,
      months: dataset.months,
      battles: dataset.battles,
      entries,
    });
  }
  return blocks;
}

/** M4 비교용 — 두 포켓몬을 함께 잡는 카운터. */
export function sharedCounters(a: CounterEntry[], b: CounterEntry[]): CounterEntry[] {
  const bByName = new Map(b.map((e) => [e.smogonName, e]));
  const shared: CounterEntry[] = [];
  for (const entry of a) {
    const other = bByName.get(entry.smogonName);
    if (!other) continue;
    // 양쪽 우위를 함께 보려면 낮은 쪽이 기준이어야 한다(둘 다 잡아야 '공통 카운터').
    shared.push({ ...entry, p: Math.min(entry.p, other.p), n: Math.min(entry.n, other.n) });
  }
  shared.sort((x, y) => y.p - x.p);
  return shared;
}
