/**
 * M1 데이터 준비 — PokéAPI 에서 한/일/영 종 명칭을 받아 showdownId 에 붙인다.
 *
 * 왜 빌드타임인가: 236종을 런타임에 매번 조회하면 PokéAPI 레이트리밋에 걸리고
 * 첫 검색까지 수 초가 걸린다. 명칭은 거의 변하지 않으므로 빌드 산출물로 고정한다.
 *
 * 주의: Champions 의 종족값·타입은 PokéAPI 와 다르다(자체 밸런스 스케일).
 *       따라서 이 스크립트는 *명칭만* 가져온다. 수치는 절대 가져오지 않는다.
 *
 * 실행: npm run data:locales
 * 출력: public/data/locales.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toId } from '../shared/names.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'pokeapi');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const CONCURRENCY = 8;

/**
 * 폼 수식어. PokéAPI 의 form_names 는 한국어 커버리지가 고르지 않아
 * 종 명칭 + 수식어 조합으로 표시명을 만든다. 표시 전용이며 검색은 종 명칭으로도 걸린다.
 */
const FORM_QUALIFIER = {
  Mega: { ko: '메가', ja: 'メガ' },
  'Mega X': { ko: '메가 X', ja: 'メガX' },
  'Mega Y': { ko: '메가 Y', ja: 'メガY' },
  Alolan: { ko: '알로라', ja: 'アローラ' },
  Galarian: { ko: '가라르', ja: 'ガラル' },
  Hisuian: { ko: '히스이', ja: 'ヒスイ' },
  Paldean: { ko: '팔데아', ja: 'パルデア' },
};

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} @ ${url}`);
  return res.json();
}

async function cachedJson(key, url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const data = await fetchJson(url);
  await writeFile(file, JSON.stringify(data));
  return data;
}

/** PokéAPI 종 slug 전체를 받아 toId 기준 조회표를 만든다. */
async function loadSpeciesSlugs() {
  const list = await cachedJson(
    '_species-index',
    'https://pokeapi.co/api/v2/pokemon-species?limit=2000',
  );
  const byId = new Map();
  for (const item of list?.results ?? []) {
    if (item?.name) byId.set(toId(item.name), item.name);
  }
  return byId;
}

/**
 * Champions showdownId 에서 PokéAPI 종 slug 를 역산한다.
 * showdownId 는 폼 접미가 붙어 있다: ninetalesalola → ninetales.
 * 가장 긴 접두사가 이기도록 해서 mew/mewtwo 같은 충돌을 피한다.
 */
function resolveSpeciesSlug(showdownId, slugsById) {
  const id = toId(showdownId);
  if (slugsById.has(id)) return slugsById.get(id);
  let best = null;
  for (const [candidateId, slug] of slugsById) {
    if (!id.startsWith(candidateId)) continue;
    if (best === null || candidateId.length > toId(best).length) best = slug;
  }
  return best;
}

function pickName(names, langs) {
  for (const lang of langs) {
    const hit = names?.find((n) => n?.language?.name === lang);
    if (hit?.name) return hit.name;
  }
  return null;
}

/** 동시 실행 수를 제한한 map. PokéAPI 를 예의 있게 두드리기 위함. */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const index = await fetchJson('https://championsbattledata.com/api');
  const entries = index?.pokemon ?? [];
  process.stdout.write(`Champions 로스터: ${entries.length}종\n`);

  const slugsById = await loadSpeciesSlugs();
  process.stdout.write(`PokéAPI 종 목록: ${slugsById.size}건\n`);

  const targets = entries.map((entry) => ({
    showdownId: entry.showdownId,
    englishName: entry.name,
    formKind: entry?.summary?.primary?.form_kind ?? 'Base',
    speciesSlug: resolveSpeciesSlug(entry.showdownId, slugsById),
  }));

  const unresolved = targets.filter((t) => !t.speciesSlug);
  if (unresolved.length > 0) {
    process.stdout.write(
      `종 slug 미해결 ${unresolved.length}건: ${unresolved.map((t) => t.showdownId).join(', ')}\n`,
    );
  }

  let failures = 0;
  const resolved = await mapLimit(targets, CONCURRENCY, async (target) => {
    if (!target.speciesSlug) return { ...target, ko: null, ja: null };
    try {
      const species = await cachedJson(
        target.speciesSlug,
        `https://pokeapi.co/api/v2/pokemon-species/${target.speciesSlug}`,
      );
      return {
        ...target,
        ko: pickName(species?.names, ['ko']),
        ja: pickName(species?.names, ['ja', 'ja-Hrkt']),
      };
    } catch (err) {
      failures += 1;
      process.stdout.write(`  ${target.showdownId}: ${err.message}\n`);
      return { ...target, ko: null, ja: null };
    }
  });

  const out = {};
  for (const item of resolved) {
    const qualifier = FORM_QUALIFIER[item.formKind];
    const decorate = (base, lang) => {
      if (!base) return null;
      if (!qualifier) return base;
      return lang === 'ko' ? `${qualifier.ko} ${base}` : `${qualifier.ja}${base}`;
    };
    out[item.showdownId] = {
      en: item.englishName,
      ko: decorate(item.ko, 'ko'),
      ja: decorate(item.ja, 'ja'),
      // 검색은 수식어 없는 종 명칭으로도 걸려야 한다 ("나인테일" → 알로라 나인테일).
      koSpecies: item.ko,
      jaSpecies: item.ja,
    };
  }

  const file = path.join(OUT_DIR, 'locales.json');
  await writeFile(file, JSON.stringify(out));
  const withKo = Object.values(out).filter((v) => v.ko).length;
  process.stdout.write(
    `저장 ${path.relative(ROOT, file)} — ${Object.keys(out).length}종, 한국어 ${withKo}종, 실패 ${failures}건\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`실패: ${err.stack ?? err}\n`);
  process.exitCode = 1;
});
