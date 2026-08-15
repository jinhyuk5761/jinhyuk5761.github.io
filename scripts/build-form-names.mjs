/**
 * 폼 이름의 공식 한국어 표기를 PokéAPI 에서 받아 둔다.
 *
 * `formNames.ts` 의 접두어 규칙(메가·알로라·가라르…)은 "접두어 + 종족명" 구조에만
 * 통한다. 트리밍(트리미앙)·무늬(비비용)·크림(마휘핑)처럼 구조가 다른 폼은 규칙으로
 * 못 만들어서 영문이 그대로 남았다 — 52개였다.
 *
 * 손으로 옮겨 적지 않는다. 공식 표기가 있는 것을 지어낸 번역으로 덮으면
 * '달인의띠' 를 '전문가벨트' 로 쓰던 실수를 반복하게 된다.
 * PokéAPI 에 한국어가 없는 폼은 **비워 둔다** — 영문으로 남는 편이 낫다.
 *
 * 실행: npm run data:forms
 * 출력: public/data/formNames.json  { Champions 폼 slug: 한국어 폼 표기 }
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'pokeapi');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const CHAMPIONS_API = 'https://championsbattledata.com/api';
const CONCURRENCY = 8;

/**
 * Champions 폼 slug 를 PokéAPI 폼 slug 로 옮기는 후보들.
 *
 * 두 쪽 표기가 조금씩 다르다:
 *   furfrou-heart-trim     → furfrou-heart          (꼬리표를 뗀다)
 *   vivillon-meadow-pattern→ vivillon-meadow
 *   alcremie-ruby-cream    → alcremie-ruby-cream-strawberry-sweet  (사탕까지 붙어야 있다)
 * 어느 규칙이 맞는지 미리 못 정하므로 후보를 순서대로 대보고 실재하는 것을 쓴다.
 */
const TAIL_WORDS = ['trim', 'pattern', 'form', 'forme', 'mode', 'flower', 'style', 'face'];
/** 마휘핑은 사탕 종류까지 붙은 slug 만 존재한다. Champions 는 크림만 구분한다. */
const DEFAULT_SWEET = '-strawberry-sweet';

function candidates(slug) {
  const out = [slug, slug + DEFAULT_SWEET];
  for (const word of TAIL_WORDS) {
    if (slug.endsWith(`-${word}`)) {
      const trimmed = slug.slice(0, -(word.length + 1));
      out.push(trimmed, trimmed + DEFAULT_SWEET);
    }
  }
  return out;
}

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

/** 여러 건을 동시에, 다만 상대 서버가 견딜 만큼만. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await worker(items[i], i);
      }
    }),
  );
  return out;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const index = await fetchJson(CHAMPIONS_API);
  /** @type {Set<string>} */
  const championsForms = new Set();
  for (const entry of index?.pokemon ?? []) {
    for (const form of entry?.summary?.forms ?? []) {
      if (form?.slug) championsForms.add(form.slug);
    }
    if (entry?.summary?.primary?.slug) championsForms.add(entry.summary.primary.slug);
  }

  const list = await cachedJson(
    '_form-index',
    'https://pokeapi.co/api/v2/pokemon-form?limit=3000',
  );
  const known = new Set((list?.results ?? []).map((r) => r.name));

  const slugs = [...championsForms].sort();
  const matched = [];
  const unmatched = [];
  for (const slug of slugs) {
    const hit = candidates(slug).find((c) => known.has(c));
    if (hit) matched.push([slug, hit]);
    else unmatched.push(slug);
  }

  const out = {};
  const noKorean = [];
  await mapLimit(matched, CONCURRENCY, async ([slug, apiSlug]) => {
    const form = await cachedJson(`form-${apiSlug}`, `https://pokeapi.co/api/v2/pokemon-form/${apiSlug}`);
    const ko = (form?.form_names ?? []).find((n) => n?.language?.name === 'ko')?.name;
    // 한국어가 없으면 비워 둔다. 영문 폼 이름이 그대로 남는다.
    if (ko) out[slug] = ko;
    else noKorean.push(slug);
  });

  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(path.join(OUT_DIR, 'formNames.json'), JSON.stringify(sorted));

  console.log(`Champions 폼 ${slugs.length}개`);
  console.log(`  한국어 확보 ${Object.keys(sorted).length}개`);
  console.log(`  PokéAPI 에 폼이 없음 ${unmatched.length}개: ${unmatched.join(', ') || '-'}`);
  console.log(`  폼은 있으나 한국어 없음 ${noKorean.length}개: ${noKorean.sort().join(', ') || '-'}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
