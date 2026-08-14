/**
 * M5 구축 데이터 라이브 서빙.
 *
 * 목적: `data/frozen-season.source.json` 을 고치면 **재빌드·재배포 없이** 반영된다.
 * 파일 mtime 을 보고 바뀌었을 때만 다시 읽어 검증한다.
 *
 * 검증 규칙은 설계 문서 6절 그대로다. 빌드 CLI 와 같은 규칙을 여기서도 적용해야
 * "수동 생성 결과 ≠ 라이브 결과" 같은 혼선이 안 생긴다.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** 설계 문서 M5: 본문 탑재 제외 호스트. */
const EXCLUDED_HOSTS = ['x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'm.youtube.com'];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * 원시 배열을 검증해 통과한 항목만 남긴다.
 * 출처 없는 항목은 조용히 버린다 — 화면에 올리는 것 자체가 규칙 위반이다.
 */
export function validateBuilds(raw) {
  const accepted = [];
  const rejected = [];

  if (!Array.isArray(raw)) return { accepted, rejected: ['최상위가 배열이 아닙니다.'] };

  raw.forEach((item, i) => {
    const label = item?.title || item?.id || `#${i}`;

    if (!item?.title) {
      rejected.push(`${label}: title 없음`);
      return;
    }
    const host = hostOf(item?.sourceUrl);
    if (!host) {
      rejected.push(`${label}: sourceUrl 없음 또는 올바르지 않음`);
      return;
    }
    if (EXCLUDED_HOSTS.includes(host)) {
      rejected.push(`${label}: ${host} 는 본문 탑재 제외 대상`);
      return;
    }

    accepted.push({
      id: item.id ?? `${item.season ?? 'season'}-${i}`,
      title: item.title,
      season: item.season ?? '',
      format: item.format === 'Doubles' ? 'Doubles' : 'Singles',
      pokemon: (item.pokemon ?? []).filter(Boolean),
      items: (item.items ?? []).filter(Boolean),
      moves: (item.moves ?? []).filter(Boolean),
      note: item.note ?? '',
      sourceUrl: item.sourceUrl,
      sourceLabel: item.sourceLabel || host,
      translated: item.translated === true,
    });
  });

  return { accepted, rejected };
}

export function createBuildsService(rootDir) {
  const sourceFile = path.join(rootDir, 'data', 'frozen-season.source.json');

  let cache = { builds: [], rejected: [], updatedAt: null, mtimeMs: -1 };

  /** 파일이 안 바뀌었으면 다시 파싱하지 않는다. */
  async function get() {
    let stats;
    try {
      stats = await stat(sourceFile);
    } catch {
      // 파일이 아직 없는 것은 오류가 아니다 — 아직 아무도 안 채웠을 뿐이다.
      cache = { builds: [], rejected: [], updatedAt: null, mtimeMs: -1 };
      return cache;
    }

    if (stats.mtimeMs === cache.mtimeMs) return cache;

    try {
      const raw = JSON.parse(await readFile(sourceFile, 'utf8'));
      const { accepted, rejected } = validateBuilds(raw);
      cache = {
        builds: accepted,
        rejected,
        updatedAt: new Date(stats.mtimeMs).toISOString(),
        mtimeMs: stats.mtimeMs,
      };
    } catch (err) {
      // 편집 중 깨진 JSON 때문에 화면이 죽으면 안 된다. 직전 성공본을 유지한다.
      cache = { ...cache, rejected: [`파싱 실패: ${err.message}`], mtimeMs: stats.mtimeMs };
    }
    return cache;
  }

  return { get, sourceFile };
}
