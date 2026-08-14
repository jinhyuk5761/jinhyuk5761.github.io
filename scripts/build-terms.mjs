/**
 * 용어 번역 데이터 — 타입 / 지닌 도구 / 특성 / 성격의 한국어 명칭.
 *
 * 대상은 Champions 데이터에 **실제로 등장하는 것만**이다.
 * PokéAPI 의 전체 도구 목록은 2천 개가 넘는데 대부분 대전에 안 나온다.
 *   - 특성: 인덱스의 forms[].abilities / hidden_ability 에서 수집 (추가 호출 없음)
 *   - 도구·성격: 배틀 데이터(held_item / stat_alignment)에서 수집
 *
 * 실행: npm run data:terms
 * 출력: public/data/terms.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { orderlessKey, toId } from '../shared/names.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'pokeapi-terms');
const BATTLE_CACHE = path.join(ROOT, '.cache', 'champions-battle');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const CONCURRENCY = 8;

const VERSION_PRIORITY = [
  'sword-shield',
  'ultra-sun-ultra-moon',
  'sun-moon',
  'omega-ruby-alpha-sapphire',
  'x-y',
  'black-2-white-2',
];

async function fetchJson(url, timeoutMs = 60_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} @ ${url}`);
  return res.json();
}

async function cachedJson(dir, key, url) {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${encodeURIComponent(key)}.json`);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const data = await fetchJson(url);
  await writeFile(file, JSON.stringify(data));
  return data;
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor;
        cursor += 1;
        results[i] = await worker(items[i]);
      }
    }),
  );
  return results;
}

function pickName(names, langs) {
  for (const lang of langs) {
    const hit = names?.find((n) => n?.language?.name === lang);
    if (hit?.name) return hit.name;
  }
  return null;
}

function cleanText(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : null;
}

function pickFlavor(entries, lang, versionKey) {
  const localized = (entries ?? []).filter((e) => e?.language?.name === lang);
  for (const version of VERSION_PRIORITY) {
    const hit = localized.find((e) => e?.[versionKey]?.name === version);
    if (hit) return cleanText(hit.flavor_text ?? hit.effect ?? hit.short_effect);
  }
  const last = localized.at(-1);
  return cleanText(last?.flavor_text ?? last?.effect ?? last?.short_effect) ?? null;
}

/** 슬러그 목록을 한 번 받아 toId 조회표를 만든다. */
async function loadSlugIndex(resource, limit = 3000) {
  const list = await cachedJson(CACHE_DIR, `_${resource}-index`, `https://pokeapi.co/api/v2/${resource}?limit=${limit}`);
  const byId = new Map();
  for (const item of list?.results ?? []) {
    if (item?.name) byId.set(toId(item.name), item.name);
  }
  return byId;
}

/**
 * 폼 이름에서 PokéAPI 종 slug 를 역산한다.
 * 가장 긴 접두사가 이기도록 해서 mew/mewtwo 같은 충돌을 피한다.
 */
function resolveSpecies(savedName, showdownId, speciesIndex) {
  for (const candidate of [toId(showdownId), toId(savedName)]) {
    if (speciesIndex.has(candidate)) return speciesIndex.get(candidate);
    let best = null;
    for (const [id, slug] of speciesIndex) {
      if (!candidate.startsWith(id)) continue;
      if (best === null || id.length > toId(best).length) best = slug;
    }
    if (best) return best;
  }
  return null;
}

/** Champions 배틀 데이터에서 도구·성격 이름을 모은다. */
async function collectFromBattleData(entries, log) {
  const items = new Set();
  const natures = new Set();

  const jobs = [];
  for (const entry of entries) {
    for (const format of ['Singles', 'Doubles']) {
      jobs.push({ showdownId: entry.showdownId, format });
    }
  }

  let done = 0;
  await mapLimit(jobs, CONCURRENCY, async (job) => {
    try {
      const data = await cachedJson(
        BATTLE_CACHE,
        `${job.format}-${job.showdownId}`,
        `https://championsbattledata.com/api/battle/${job.format}/${encodeURIComponent(job.showdownId)}`,
      );
      for (const row of data?.rows ?? []) {
        if (row?.category === 'held_item' && row.name) items.add(row.name);
        if (row?.category === 'stat_alignment' && row.name) natures.add(row.name);
      }
    } catch {
      // 개별 실패는 무시한다 — 다른 포켓몬에서 같은 도구가 또 나온다.
    }
    done += 1;
    if (done % 100 === 0) log(`  배틀 데이터 ${done}/${jobs.length}`);
  });

  return { items: [...items].sort(), natures: [...natures].sort() };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const log = (msg) => process.stdout.write(`${msg}\n`);

  const index = await fetchJson('https://championsbattledata.com/api');
  const entries = (index?.pokemon ?? []).filter((e) => e?.showdownId);

  // --- 특성: 인덱스에서 바로 모은다 ---
  const abilityNames = new Set();
  for (const entry of entries) {
    for (const form of entry?.summary?.forms ?? []) {
      for (const ability of (form?.abilities ?? '').split('|')) {
        const trimmed = ability.trim();
        if (trimmed) abilityNames.add(trimmed);
      }
      const hidden = (form?.hidden_ability ?? '').trim();
      if (hidden) abilityNames.add(hidden);
    }
  }
  log(`특성 ${abilityNames.size}개`);

  // --- 도구·성격: 배틀 데이터에서 모은다 ---
  log(`배틀 데이터 수집 시작 (${entries.length}종 × 2포맷)`);
  const { items: itemNames, natures: natureNames } = await collectFromBattleData(entries, log);
  log(`도구 ${itemNames.length}개, 성격 ${natureNames.length}개`);

  // --- 타입 (18종) ---
  const typeIndex = await loadSlugIndex('type', 100);
  const typeSlugs = [
    'normal', 'fire', 'water', 'electric', 'grass', 'ice',
    'fighting', 'poison', 'ground', 'flying', 'psychic', 'bug',
    'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
  ].filter((s) => typeIndex.has(s));

  const types = {};
  await mapLimit(typeSlugs, CONCURRENCY, async (slug) => {
    const t = await cachedJson(CACHE_DIR, `type-${slug}`, `https://pokeapi.co/api/v2/type/${slug}`);
    // 앱 내부 표기는 첫 글자 대문자(Fire)다. 그 키로 저장한다.
    types[slug.charAt(0).toUpperCase() + slug.slice(1)] = pickName(t.names, ['ko']) ?? slug;
  });
  log(`타입 ${Object.keys(types).length}개`);

  // --- 특성 상세 ---
  const abilityIndex = await loadSlugIndex('ability');
  const abilities = {};
  const abilityMissing = [];

  /**
   * PokéAPI 가 한국어 설명을 주지 않는 특성.
   *
   * Champions 오리지널이거나 9세대 신규라 아직 한국어 텍스트가 없다.
   * **사용자가 게임에서 확인해 알려준 문구만** 넣는다 — 번역하거나 추측하지 않는다.
   * ko 가 비어 있으면 이름도 여기서 채운다.
   */
  const ABILITY_KO_OVERRIDE = {
    'Supersweet Syrup': { desc: '등장 시 상대의 회피율을 1단계 떨어트린다. 배틀 중 한 번만 발동한다.' },
    'Piercing Drill': {
      desc: '접촉 기술을 사용할 때 상대의 방어 효과를 무시하고 본래 데미지의 1/4만큼 데미지를 준다. 상대의 방어 효과 이외에는 발동된다.',
    },
    Hospitality: { desc: '등장했을 때 같은 편을 대접해서 HP를 조금 회복시킨다.' },
    'Toxic Debris': { desc: '물리 기술로 데미지를 받으면 상대의 발밑에 독압정을 뿌린다.' },
    Dragonize: { desc: '노말타입의 기술이 드래곤타입이 된다. 위력이 조금 올라간다.' },
    'Cud Chew': {
      desc: '한 번에 한하여 나무열매를 먹으면 다음 턴이 끝날 때 위에서 꺼내서 또 먹는다.',
    },
    'Zero to Hero': { desc: '지닌 포켓몬으로 돌아오면 마이티폼으로 변한다.' },
    'Mega Sol': { desc: '기술을 사용할 때 쾌청 상태일 때와 동일한 효과를 얻는다.' },
    Sharpness: { desc: '상대를 베는 기술의 위력이 올라간다.' },
    Electromorphosis: { desc: '공격을 받을 시 충전 상태가 되어 전기 타입 기술의 위력을 높인다.' },
    'Purifying Salt': { desc: '상태 이상에 걸리지 않으며 고스트 타입 기술의 데미지를 절반만 받는다.' },
    'Supreme Overlord': {
      desc: '전투에 등장했을 때 지금까지 쓰러진 같은 편의 수가 많을수록 조금씩 공격과 특수공격이 상승한다.',
    },
    'Armor Tail': { desc: '상대 포켓몬이 선제공격기술을 사용할 수 없게 된다.' },
    Opportunist: { desc: '상대의 능력이 올라가면 자신도 편승해서 똑같이 자신도 올린다.' },
    'Spicy Spray': { desc: '기술로 데미지를 입으면 상대를 화상 상태로 만든다.' },
    // 아래 둘은 Champions 오리지널이라 한국어 이름도 없다.
    Eelevate: { ko: '부유', desc: '땅타입의 기술을 받지 않는다.' },
    'Fire Mane': { ko: '불꽃의갈기', desc: '불꽃타입 기술의 위력이 1.5배 오른다.' },
  };

  /** override 를 적용한다. PokéAPI 가 준 값이 있으면 그쪽을 우선한다. */
  const withOverride = (name, entry) => {
    const extra = ABILITY_KO_OVERRIDE[name];
    if (!extra) return entry;
    return {
      ko: entry?.ko ?? extra.ko ?? null,
      desc: entry?.desc ?? extra.desc ?? null,
      descEn: entry?.descEn ?? null,
    };
  };
  await mapLimit([...abilityNames].sort(), CONCURRENCY, async (name) => {
    const slug = abilityIndex.get(toId(name));
    if (!slug) {
      abilityMissing.push(name);
      // PokéAPI 에 없는 Champions 오리지널 특성도 override 가 있으면 살린다.
      const only = withOverride(name, null);
      if (only.ko || only.desc) abilities[name] = only;
      return;
    }
    try {
      const a = await cachedJson(CACHE_DIR, `ability-${slug}`, `https://pokeapi.co/api/v2/ability/${slug}`);
      abilities[name] = withOverride(name, {
        ko: pickName(a.names, ['ko']),
        desc: pickFlavor(a.flavor_text_entries, 'ko', 'version_group'),
        descEn: pickFlavor(a.flavor_text_entries, 'en', 'version_group'),
      });
    } catch {
      abilityMissing.push(name);
    }
  });
  log(`특성 번역 ${Object.keys(abilities).length}개 (미매칭 ${abilityMissing.length})`);

  // --- 도구 상세 ---
  const itemIndex = await loadSlugIndex('item');
  const items = {};
  const itemMissing = [];
  // PokéAPI 에 한국어가 없어서 사용자가 직접 알려준 표기만 여기 둔다.
  // **추측해서 채우지 않는다** — 모르면 영문명이 그대로 뜨는 편이 낫다.
  // 띄어쓰기 없는 표기는 도감의 다른 도구(달인의띠·기적의씨·힘의머리띠)를 따른 것이다.
  //
  // 아래 34종은 Champions 오리지널 메가스톤이라 본가에 대응이 없다.
  // 전부 '한국어 종족명 + 나이트' 형태이므로, 종족명 부분을 로케일 데이터와 대조해 확인했다
  // (locales.json 의 koSpecies). 리자몽나이트X 를 따라 X·Y 는 붙여 쓴다.
  const ITEM_KO_OVERRIDE = {
    'Fairy Feather': '요정의깃털',

    Barbaracite: '거북손데스나이트',
    Chandelurite: '샹델라나이트',
    Chesnaughtite: '브리가론나이트',
    Chimechite: '치렁나이트',
    Clefablite: '픽시나이트',
    Crabominite: '모단단게나이트',
    Delphoxite: '마폭시나이트',
    Dragalgite: '드래캄나이트',
    Dragoninite: '망나뇽나이트',
    Drampanite: '할비롱나이트',
    Eelektrossite: '저리더프나이트',
    Emboarite: '염무왕나이트',
    Excadrite: '몰드류나이트',
    Falinksite: '대여르나이트',
    Feraligite: '장크로다일나이트',
    Floettite: '플라엣테나이트',
    Froslassite: '눈여아나이트',
    Golurkite: '골루그나이트',
    Glimmoranite: '킬라플로르나이트',
    Greninjite: '개굴닌자나이트',
    Hawluchanite: '루차불나이트',
    Malamarite: '칼라마네로나이트',
    Meganiumite: '메가니움나이트',
    Meowsticite: '냐오닉스나이트',
    Pyroarite: '화염레오나이트',
    'Raichunite X': '라이츄나이트X',
    'Raichunite Y': '라이츄나이트Y',
    Scolipite: '펜드라나이트',
    Scovillainite: '스코빌런나이트',
    Scraftinite: '곤율거니나이트',
    Skarmorite: '무장조나이트',
    Starminite: '아쿠스타나이트',
    Staraptite: '찌르호크나이트',
    Victreebelite: '우츠보트나이트',
  };
  await mapLimit(itemNames, CONCURRENCY, async (name) => {
    const slug = itemIndex.get(toId(name));
    if (!slug) {
      itemMissing.push(name);
      if (ITEM_KO_OVERRIDE[name]) items[name] = { ko: ITEM_KO_OVERRIDE[name], desc: null, descEn: null };
      return;
    }
    try {
      const it = await cachedJson(CACHE_DIR, `item-${slug}`, `https://pokeapi.co/api/v2/item/${slug}`);
      items[name] = {
        // PokéAPI 가 한국어를 안 주는 도구가 있다 (요정의깃털 등 최신 도구).
        ko: pickName(it.names, ['ko']) ?? ITEM_KO_OVERRIDE[name] ?? null,
        desc: pickFlavor(it.flavor_text_entries, 'ko', 'version_group'),
        descEn: pickFlavor(it.flavor_text_entries, 'en', 'version_group'),
      };
    } catch {
      itemMissing.push(name);
      if (ITEM_KO_OVERRIDE[name]) items[name] = { ko: ITEM_KO_OVERRIDE[name], desc: null, descEn: null };
    }
  });
  const itemNoKo = Object.entries(items).filter(([, v]) => !v.ko).length;
  log(`도구 번역 ${Object.keys(items).length}개 (미매칭 ${itemMissing.length} · 한국어 없음 ${itemNoKo})`);

  // --- 성격 ---
  // 사용률에 나온 것만 받지 않고 **전부** 받는다. 계산기에서 임의의 성격을 골라야 하는데
  // 관측된 23종만 있으면 나머지를 선택할 수 없다.
  const natureIndex = await loadSlugIndex('nature', 100);
  const natures = {};
  const natureMissing = [];
  await mapLimit([...natureIndex.values()], CONCURRENCY, async (slug) => {
    const n = await cachedJson(CACHE_DIR, `nature-${slug}`, `https://pokeapi.co/api/v2/nature/${slug}`);
    // 키는 Champions/Showdown 표기(첫 글자 대문자)에 맞춘다.
    const englishName = slug.charAt(0).toUpperCase() + slug.slice(1);
    const ko = pickName(n.names, ['ko']);
    if (!ko) natureMissing.push(englishName);
    natures[englishName] = {
      ko,
      up: n.increased_stat?.name ?? null,
      down: n.decreased_stat?.name ?? null,
    };
  });
  log(`성격 ${Object.keys(natures).length}종 (한국어명 없음 ${natureMissing.length})`);
  // 사용률에 등장했는데 목록에 없으면 표기가 어긋난 것이라 알린다.
  for (const observed of natureNames) {
    if (!natures[observed]) log(`  경고: 사용률의 성격 '${observed}' 를 PokéAPI 에서 못 찾음`);
  }

  // --- 폼별 몸무게 ---
  // championsbattledata 는 몸무게를 주지 않는데, 풀묶기·헤비봄버 계열의 위력이 여기 걸린다.
  // PokéAPI 는 폼마다 별도 항목이 있어(garchomp-mega 등) 폼 단위로 받을 수 있다.
  const pokemonIndex = await loadSlugIndex('pokemon', 2000);
  const speciesIndex = await loadSlugIndex('pokemon-species', 2000);
  // 정렬 토큰 키 조회표를 미리 만든다 (폼마다 전체 목록을 훑으면 느리다).
  const byOrderless = new Map();
  for (const slug of pokemonIndex.values()) {
    const key = orderlessKey(slug);
    if (!byOrderless.has(key)) byOrderless.set(key, slug);
  }

  const formTargets = [];
  for (const entry of entries) {
    for (const form of entry?.summary?.forms ?? []) {
      if (form?.saved_name) {
        formTargets.push({ savedName: form.saved_name, showdownId: entry.showdownId });
      }
    }
  }
  const seenForms = new Set();
  const uniqueForms = formTargets.filter((f) => {
    if (seenForms.has(f.savedName)) return false;
    seenForms.add(f.savedName);
    return true;
  });

  async function weightOf(slug) {
    const p = await cachedJson(CACHE_DIR, `pokemon-${slug}`, `https://pokeapi.co/api/v2/pokemon/${slug}`);
    // PokéAPI 는 헥토그램으로 준다. 킬로그램으로 바꿔 저장한다.
    return typeof p?.weight === 'number' ? p.weight / 10 : null;
  }

  const weights = {};
  const weightMissing = [];
  await mapLimit(uniqueForms, CONCURRENCY, async ({ savedName, showdownId }) => {
    // "Mega Garchomp" ↔ "garchomp-mega" 처럼 어순이 다르므로 정렬 토큰 키로 맞춘다.
    const slug = pokemonIndex.get(toId(savedName)) ?? byOrderless.get(orderlessKey(savedName));
    try {
      if (slug) {
        const kg = await weightOf(slug);
        if (kg !== null) {
          weights[savedName] = kg;
          return;
        }
      }
      // 외형만 다른 폼(알크레미 맛, 트리미앙 트림 등)은 PokéAPI 에 별도 항목이 없다.
      // 몸무게는 기본 폼과 같으므로 종 단위로 폴백한다.
      const speciesSlug = pokemonIndex.get(toId(showdownId)) ?? byOrderless.get(orderlessKey(showdownId));
      if (speciesSlug) {
        const kg = await weightOf(speciesSlug);
        if (kg !== null) {
          weights[savedName] = kg;
          return;
        }
      }

      // 마지막 폴백: PokéAPI 가 기본 폼에도 접미사를 붙이는 종이 있다
      // (lycanroc-midday, mimikyu-disguised, vivillon-meadow …).
      // 종 정보에서 기본 variety 를 찾아 그 몸무게를 쓴다.
      const species = resolveSpecies(savedName, showdownId, speciesIndex);
      if (species) {
        const info = await cachedJson(
          CACHE_DIR,
          `species-${species}`,
          `https://pokeapi.co/api/v2/pokemon-species/${species}`,
        );
        const primary =
          (info?.varieties ?? []).find((v) => v?.is_default)?.pokemon?.name ??
          info?.varieties?.[0]?.pokemon?.name;
        if (primary) {
          const kg = await weightOf(primary);
          if (kg !== null) {
            weights[savedName] = kg;
            return;
          }
        }
      }
      weightMissing.push(savedName);
    } catch {
      weightMissing.push(savedName);
    }
  });
  log(`몸무게 ${Object.keys(weights).length}폼 (미매칭 ${weightMissing.length})`);
  if (weightMissing.length > 0) {
    log(`  몸무게 없음: ${weightMissing.slice(0, 20).join(', ')}${weightMissing.length > 20 ? ` 외 ${weightMissing.length - 20}` : ''}`);
  }

  const file = path.join(OUT_DIR, 'terms.json');
  await writeFile(
    file,
    JSON.stringify({ generatedAt: new Date().toISOString(), types, abilities, items, natures, weights }),
  );
  log(`저장 ${path.relative(ROOT, file)}`);

  for (const [label, list] of [
    ['특성', abilityMissing],
    ['도구', itemMissing],
    ['성격', natureMissing],
  ]) {
    if (list.length > 0) log(`PokéAPI 에 없는 ${label}: ${list.join(', ')}`);
  }
}

main().catch((err) => {
  process.stderr.write(`실패: ${err.stack ?? err}\n`);
  process.exitCode = 1;
});
