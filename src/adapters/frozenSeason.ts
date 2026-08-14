/**
 * B등급 — 동결 시즌 구축 (M5)
 *
 * 설계 문서 6절의 강제 규칙을 코드로 박아둔다:
 *   - sourceUrl 이 없는 항목은 **로드 단계에서 버린다.** 출처 없는 구축은 표시하지 않는다.
 *   - X(트위터)/YouTube 링크는 본문에 싣지 않는다 → 해당 호스트는 걸러낸다.
 *   - 번역본은 translated:true 로 표시해 UI 가 "참고용 번역" 라벨을 붙일 수 있게 한다.
 *
 * 데이터는 public/data/builds.json (scripts/build-frozen-season.mjs 산출물)에서 읽는다.
 */

import { TTL, fetchJson } from '../core/http';
import type { BuildSet, Format, Loaded } from '../types';

interface RawBuild {
  id?: string;
  title?: string;
  season?: string;
  format?: string;
  pokemon?: string[];
  items?: string[];
  moves?: string[];
  note?: string;
  sourceUrl?: string;
  sourceLabel?: string;
  translated?: boolean;
}

/** 본문 탑재 제외 대상 호스트 — 설계 문서 M5. */
const EXCLUDED_HOSTS = ['x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'm.youtube.com'];

function hasUsableSource(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return !EXCLUDED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

export function normalizeBuilds(raw: RawBuild[]): BuildSet[] {
  const out: BuildSet[] = [];
  for (const item of raw ?? []) {
    // 출처 없는 항목은 조용히 버린다. 화면에 올리는 것 자체가 규칙 위반이다.
    if (!hasUsableSource(item?.sourceUrl)) continue;
    const format = item?.format === 'Doubles' ? 'Doubles' : 'Singles';
    out.push({
      id: item.id ?? `${item.season ?? 'unknown'}-${out.length}`,
      title: item.title ?? '(제목 없음)',
      season: item.season ?? '',
      format: format as Format,
      pokemon: (item.pokemon ?? []).filter(Boolean),
      items: (item.items ?? []).filter(Boolean),
      moves: (item.moves ?? []).filter(Boolean),
      note: item.note ?? '',
      sourceUrl: item.sourceUrl as string,
      sourceLabel: item.sourceLabel || new URL(item.sourceUrl as string).hostname,
      translated: item.translated === true,
    });
  }
  return out;
}

/** 서버는 {updatedAt, builds} 봉투로, 정적 파일은 배열 그대로 준다. 둘 다 받는다. */
function unwrap(data: RawBuild[] | { builds?: RawBuild[] }): RawBuild[] {
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.builds) ? data.builds : [];
}

export async function fetchBuilds(url: string): Promise<Loaded<BuildSet[]>> {
  try {
    const { data } = await fetchJson<RawBuild[] | { builds?: RawBuild[] }>(url, {
      ttlMs: TTL.buildArtifact,
      timeoutMs: 15_000,
    });
    const builds = normalizeBuilds(unwrap(data));
    if (builds.length === 0) {
      return { status: 'empty', reason: '출처가 확인된 동결 시즌 구축이 아직 없습니다.' };
    }
    return { status: 'ok', data: builds };
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : '구축 데이터를 불러오지 못했습니다.',
    };
  }
}
