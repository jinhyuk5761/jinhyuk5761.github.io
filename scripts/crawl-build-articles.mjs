/**
 * 랭커 구축글을 모아 노력치·기술·특성까지 읽어 온다.
 *
 * 우리가 가진 랭커 구축 데이터(pokedb 공개 데이터)에는 **종족·폼·도구뿐**이다.
 * 노력치·성격·특성·기술은 사람이 쓴 구축글에 있고, 그건 블로그마다 흩어져 있다.
 *
 * ## 지키는 것
 *
 * 1. **robots.txt 를 호스트마다 확인한다.** `User-agent: *` 규칙을 읽고 막힌 경로는
 *    건너뛴다. X(twitter) 는 `Disallow: /` 라 통째로 빠진다 — 정상이다.
 * 2. **신원을 밝힌다.** UA 에 무엇이고 누구인지 적는다. 브라우저인 척하지 않는다.
 * 3. **간격을 둔다.** `Crawl-delay` 를 따르고, 없으면 1초. 한 번 받은 글은 캐시해
 *    다시 받지 않는다.
 * 4. **막히면 건너뛰고 보고한다.** 403 을 만나면 다른 수를 쓰지 않는다.
 *
 * ## 결과물은 로컬 전용
 *
 * 남이 쓴 글의 내용이라 공개 사이트에 싣지 않는다. 출력 파일과 입력 목록 모두
 * `.gitignore` 에 있어 커밋도 배포도 되지 않는다. PC 에서 `npm run dev` 로 띄웠을 때만 보인다.
 *
 * 실행: npm run data:articles
 * 입력: 구축글목록.txt   (한 줄에 URL 하나, `#` 으로 시작하면 주석)
 * 출력: public/data/localTeams.json
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const LIST_FILE = path.join(ROOT, '구축글목록.txt');
const CACHE_DIR = path.join(ROOT, '.cache', 'articles');
const OUT_FILE = path.join(ROOT, 'public', 'data', 'localTeams.json');
const DATA_DIR = path.join(ROOT, 'public', 'data');

/** 무엇이고 누가 돌리는지 밝힌다. 브라우저인 척하면 그건 우회다. */
const USER_AGENT =
  'pokemon-champions-meta/1.0 (personal build-article collector; +https://jinhyuk5761.github.io/)';
/** Crawl-delay 가 없을 때 쓸 간격. */
const DEFAULT_DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ robots */

/**
 * `User-agent: *` 블록만 읽는다.
 *
 * 우리는 이름 붙은 크롤러가 아니므로 와일드카드 규칙이 우리에게 적용되는 규칙이다.
 * 특정 크롤러(Googlebot 등)에게만 허용된 예외를 가져다 쓰지 않는다.
 */
function parseRobots(text) {
  const rules = { disallow: [], allow: [], delayMs: DEFAULT_DELAY_MS };
  let inStar = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = (keyRaw ?? '').trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      inStar = value === '*';
      continue;
    }
    if (!inStar) continue;
    if (key === 'disallow' && value) rules.disallow.push(value);
    if (key === 'allow' && value) rules.allow.push(value);
    if (key === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) rules.delayMs = Math.max(rules.delayMs, n * 1000);
    }
  }
  return rules;
}

/** 더 긴 규칙이 이긴다 (RFC 9309). 같은 길이면 Allow 가 이긴다. */
function isAllowed(rules, pathname) {
  const match = (list) =>
    list.filter((p) => pathname.startsWith(p)).reduce((max, p) => Math.max(max, p.length), -1);
  const allow = match(rules.allow);
  const disallow = match(rules.disallow);
  if (disallow < 0) return true;
  return allow >= disallow;
}

const robotsByHost = new Map();

async function robotsFor(origin) {
  if (robotsByHost.has(origin)) return robotsByHost.get(origin);
  let rules = { disallow: [], allow: [], delayMs: DEFAULT_DELAY_MS };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    // robots.txt 가 없으면(404) 제한이 없다는 뜻이다.
    if (res.ok) rules = parseRobots(await res.text());
  } catch {
    // 못 받았으면 보수적으로 기본 간격만 두고 진행한다.
  }
  robotsByHost.set(origin, rules);
  return rules;
}

/* ----------------------------------------------------------------- 받아오기 */

const lastHitAt = new Map();

async function fetchArticle(url) {
  const key = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const file = path.join(CACHE_DIR, `${key}.html`);
  if (existsSync(file)) return { html: await readFile(file, 'utf8'), cached: true };

  const { origin, pathname } = new URL(url);
  const rules = await robotsFor(origin);
  if (!isAllowed(rules, pathname)) {
    return { skipped: `robots.txt 가 막음 (${origin})` };
  }

  // 같은 호스트를 연달아 두드리지 않는다.
  const wait = (lastHitAt.get(origin) ?? 0) + rules.delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHitAt.set(origin, Date.now());

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    // 403 을 만나면 다른 수를 쓰지 않는다. 건너뛰고 그대로 적는다.
    return { skipped: `HTTP ${res.status}` };
  }
  const html = await res.text();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(file, html);
  return { html, cached: false };
}

/* -------------------------------------------------------------------- 파싱 */

/** 본문만 남기고 태그를 줄바꿈으로 바꾼다. */
function toLines(html) {
  const body =
    /<div[^>]*class="[^"]*entry-content[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*entry-footer)/.exec(html)?.[0] ??
    /<article[\s\S]*?<\/article>/.exec(html)?.[0] ??
    html;
  return body
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 실수치 줄. `157(32)-83-186(14)-65-200(20+)-55` 형태다.
 *
 * 괄호 안이 노력치, `+`/`-` 는 성격 보정. 노력치를 안 적은 칸도 있어서
 * **없으면 없는 대로 둔다** — 0 으로 채우면 안 쓴 것과 구별이 안 된다.
 */
const STAT_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

function parseStatLine(line) {
  /*
   * `-` 로 쪼개면 안 된다. 성격 하락 표기가 `78(-)` 이라 괄호 안에도 `-` 가 들어간다.
   * 여섯 칸을 통째로 집어내고, 그 여섯이 줄 전체를 덮는지 확인한다.
   */
  const cells = line.match(/\d+(?:\([^)]*\))?/g);
  if (!cells || cells.length !== 6) return null;
  if (cells.join('-') !== line.trim()) return null;

  const stats = {};
  for (let i = 0; i < 6; i += 1) {
    const m = /^(\d+)(?:\(\s*(\d+)?\s*([+-])?\s*\))?$/.exec(cells[i]);
    if (!m) return null;
    stats[STAT_KEYS[i]] = {
      value: Number(m[1]),
      // 안 적은 칸은 null 로 둔다. 0 으로 채우면 '안 씀' 과 구별이 안 된다.
      ev: m[2] === undefined ? null : Number(m[2]),
      nature: m[3] ?? null,
    };
  }
  return stats;
}

function parseArticle(lines, dict) {
  const members = [];
  for (let i = 0; i < lines.length; i += 1) {
    // 개체 시작은 '<종족> @ <도구>' 한 줄이다.
    const head = /^(.+?)\s*[@＠]\s*(.+)$/.exec(lines[i]);
    if (!head) continue;
    const speciesJa = head[1].trim();
    if (!dict.isSpecies(speciesJa)) continue;

    const speciesKo = dict.species(speciesJa);
    const member = {
      species: speciesKo,
      item: dict.itemFor(head[2].trim(), speciesKo),
      ability: null,
      nature: null,
      stats: null,
      moves: [],
    };

    // 개체 하나가 차지하는 범위는 다음 개체 머리 전까지다. 넉넉히 12줄만 본다.
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
      const line = lines[j];
      if (/^(.+?)\s*[@＠]\s*(.+)$/.test(line) && dict.isSpecies(RegExp.$1.trim())) break;

      const ability = /^特性\s*[:：]\s*(.+)$/.exec(line);
      if (ability) {
        member.ability = dict.ability(ability[1].trim());
        continue;
      }
      const nature = /^性格\s*[:：]\s*(.+)$/.exec(line);
      if (nature) {
        member.nature = dict.nature(nature[1].trim());
        continue;
      }
      if (!member.stats) {
        const stats = parseStatLine(line);
        if (stats) {
          member.stats = stats;
          continue;
        }
      }
      if (member.moves.length === 0 && line.includes('/')) {
        const names = line.split('/').map((s) => s.trim()).filter(Boolean);
        if (names.length >= 2 && names.length <= 4 && names.every((n) => dict.isMove(n))) {
          member.moves = names.map((n) => dict.move(n));
        }
      }
    }
    members.push(member);
  }
  return members;
}

/* -------------------------------------------------------------------- 사전 */

async function buildDictionary() {
  const [locales, terms, moves] = await Promise.all([
    readFile(path.join(DATA_DIR, 'locales.json'), 'utf8').then(JSON.parse),
    readFile(path.join(DATA_DIR, 'terms.json'), 'utf8').then(JSON.parse),
    readFile(path.join(DATA_DIR, 'moves.json'), 'utf8').then(JSON.parse),
  ]);

  const unresolved = new Set();
  const build = (pairs, label) => {
    const map = new Map(pairs.filter(([ja]) => ja));
    return {
      has: (ja) => map.has(ja),
      get: (ja) => {
        const hit = map.get(ja);
        if (!hit) unresolved.add(`${label}: ${ja}`);
        // 못 찾으면 원문 그대로 둔다. 비슷한 한국어를 지어내지 않는다.
        return hit ?? ja;
      },
    };
  };

  const speciesPairs = Object.values(locales).flatMap((v) => [
    [v.ja, v.ko ?? v.en],
    [v.jaSpecies, v.koSpecies ?? v.ko ?? v.en],
  ]);
  const species = build(speciesPairs, '종족');

  /** 한국어 종족명이 실재하는지 확인할 표. 지역폼은 종이 따로 있다. */
  const koSpecies = new Set(
    Object.values(locales).flatMap((v) => [v.ko, v.koSpecies].filter(Boolean)),
  );

  /*
   * 구축글은 종족명을 꾸며서 적는다.
   *   メガフラエッテ      메가 접두어
   *   ダイケンキ(ヒスイ)  지역 접미어
   * 꾸밈을 떼어 본체를 찾고, 우리 표기법으로 다시 붙인다.
   * 붙여 만든 이름이 도감에 실재할 때만 쓴다 — 없으면 본체 이름만 남긴다.
   */
  const REGION_SUFFIX = [
    ['ヒスイ', '히스이'],
    ['アローラ', '알로라'],
    ['ガラル', '가라르'],
    ['パルデア', '팔데아'],
  ];

  function resolveSpecies(raw) {
    if (species.has(raw)) return { ko: species.get(raw), ja: raw };

    // 'ダイケンキ(ヒスイ)' — 괄호 안이 지역명이다.
    const tail = /^(.+?)[（(]\s*([^）)]+?)\s*[）)]$/.exec(raw);
    if (tail && species.has(tail[1])) {
      const base = species.get(tail[1]);
      const region = REGION_SUFFIX.find(([ja]) => tail[2].startsWith(ja));
      const name = region ? `${region[1]} ${base}` : base;
      return { ko: koSpecies.has(name) ? name : base, ja: tail[1] };
    }

    // 'メガフラエッテ'
    if (raw.startsWith('メガ')) {
      const rest = raw.slice(2);
      if (species.has(rest)) return { ko: `메가 ${species.get(rest)}`, ja: rest, mega: true };
    }
    return null;
  }
  const item = build(
    Object.values(terms.items ?? {}).map((v) => [v.ja, v.ko]),
    '도구',
  );
  /** 한국어 도구명이 실재하는지 확인할 표. */
  const koItems = new Set(Object.values(terms.items ?? {}).map((v) => v.ko).filter(Boolean));

  /**
   * 구축글은 메가스톤을 'メガストーン' 이라고 총칭으로만 적는 일이 많다.
   * 메가 폼이면 어떤 돌인지 정해져 있으므로 종족명으로 되짚는다.
   * 도감에 실재하는 이름일 때만 쓴다 — 없으면 총칭 그대로 둔다.
   */
  function resolveItem(raw, speciesKoName) {
    if (raw === 'メガストーン' && speciesKoName?.startsWith('메가 ')) {
      const stone = `${speciesKoName.slice(3)}나이트`;
      if (koItems.has(stone)) return stone;
      return '메가스톤';
    }
    return item.get(raw);
  }
  const ability = build(
    Object.values(terms.abilities ?? {}).map((v) => [v.ja, v.ko]),
    '특성',
  );
  const nature = build(
    Object.values(terms.natures ?? {}).map((v) => [v.ja, v.ko]),
    '성격',
  );
  const move = build(
    Object.values(moves.moves ?? {}).map((v) => [v.ja, v.ko]),
    '기술',
  );

  return {
    isSpecies: (ja) => resolveSpecies(ja) !== null,
    isMove: move.has,
    species: (ja) => resolveSpecies(ja)?.ko ?? species.get(ja),
    itemFor: resolveItem,
    item: item.get,
    ability: ability.get,
    nature: nature.get,
    move: move.get,
    unresolved,
  };
}

/* -------------------------------------------------------------------- 실행 */

async function main() {
  if (!existsSync(LIST_FILE)) {
    console.log(`${LIST_FILE} 이 없습니다.`);
    console.log('구축글 URL 을 한 줄에 하나씩 적어 주세요. (# 으로 시작하면 주석)');
    return;
  }

  const urls = (await readFile(LIST_FILE, 'utf8'))
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));
  if (urls.length === 0) {
    console.log('목록이 비어 있습니다.');
    return;
  }

  const dict = await buildDictionary();
  const articles = [];
  const skipped = [];

  for (const url of urls) {
    let result;
    try {
      result = await fetchArticle(url);
    } catch (error) {
      skipped.push([url, error instanceof Error ? error.message : String(error)]);
      continue;
    }
    if (result.skipped) {
      skipped.push([url, result.skipped]);
      continue;
    }
    const lines = toLines(result.html);
    const title = /<title>([^<]*)<\/title>/.exec(result.html)?.[1]?.trim() ?? url;
    const members = parseArticle(lines, dict);
    if (members.length === 0) {
      skipped.push([url, '개체 정보를 찾지 못함 (글 형식이 다름)']);
      continue;
    }
    articles.push({ url, title, members });
    console.log(`  ${members.length}마리  ${title.slice(0, 50)}${result.cached ? ' (캐시)' : ''}`);
  }

  await writeFile(OUT_FILE, JSON.stringify({ articles }, null, 1));

  console.log(`\n구축글 ${articles.length}건 · 개체 ${articles.reduce((n, a) => n + a.members.length, 0)}마리`);
  if (skipped.length) {
    console.log(`건너뜀 ${skipped.length}건:`);
    for (const [url, why] of skipped) console.log(`  ${why}  ${url}`);
  }
  if (dict.unresolved.size) {
    console.log(`못 되짚은 이름 ${dict.unresolved.size}개: ${[...dict.unresolved].join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
