/**
 * 기술 도감 데이터 — PokéAPI 에서 한국어 기술명과 제원을 받아 압축한다.
 *
 * 왜 나무위키가 아닌가:
 *   1. 라이선스. 나무위키 문서는 CC BY-NC-SA 2.0 KR 이다. 본문을 앱에 실으면
 *      앱 전체가 비영리·동일조건 라이선스에 묶인다.
 *   2. 접근. 자동 요청을 차단한다(다른 소스들과 같은 이유로 우회하지 않는다).
 *   3. 정확도. PokéAPI 는 **게임 내 공식 한국어 설명**과 위력/PP/명중률을
 *      구조화된 형태로 준다. 사람이 쓴 산문보다 이쪽이 이 용도에 맞다.
 *
 * 대상은 Champions 로스터가 실제로 배울 수 있는 기술의 합집합이다.
 * 전체 기술 도감을 받으면 쓰지도 않을 데이터가 절반이다.
 *
 * 실행: npm run data:moves
 * 출력: public/data/moves.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toId } from '../shared/names.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'pokeapi-moves');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const CONCURRENCY = 8;

/**
 * 한국어 설명을 고를 버전 우선순위. 최신 세대의 표현을 우선한다.
 * flavor_text_entries 는 정렬 보장이 없어서 명시적으로 골라야 한다.
 */
const VERSION_PRIORITY = [
  'sword-shield',
  'ultra-sun-ultra-moon',
  'sun-moon',
  'omega-ruby-alpha-sapphire',
  'x-y',
  'black-2-white-2',
  'black-white',
];

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} @ ${url}`);
  return res.json();
}

async function fetchText(url, timeoutMs = 60_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} @ ${url}`);
  return res.text();
}

async function cachedJson(key, url) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, `${key}.json`);
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
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results;
}

/** 0 과 null 을 구분해야 하는 자리가 있어 숫자만 통과시킨다. */
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** min/max 가 둘 다 있고 의미가 있을 때만 배열로 남긴다. */
function range(min, max) {
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (min <= 0 || max <= 0) return null;
  return [min, max];
}

function pickName(names, langs) {
  for (const lang of langs) {
    const hit = names?.find((n) => n?.language?.name === lang);
    if (hit?.name) return hit.name;
  }
  return null;
}

/** 게임 내 설명은 줄바꿈·개행문자가 섞여 온다. 한 줄로 편다. */
function cleanText(text) {
  return typeof text === 'string' ? text.replace(/[\n\f\r]+/g, ' ').replace(/\s+/g, ' ').trim() : null;
}

function pickFlavorText(entries, lang) {
  const localized = (entries ?? []).filter((e) => e?.language?.name === lang);
  for (const version of VERSION_PRIORITY) {
    const hit = localized.find((e) => e?.version_group?.name === version);
    if (hit?.flavor_text) return cleanText(hit.flavor_text);
  }
  // 우선순위에 없는 버전이라도 있으면 마지막 것을 쓴다.
  return cleanText(localized.at(-1)?.flavor_text) ?? null;
}

/**
 * 기술 플래그를 Pokémon Showdown 소스에서 뽑는다.
 *
 * 왜 필요한가: PokéAPI 는 접촉·펀치·소리·파동·구슬 같은 **플래그를 제공하지 않는다**.
 * 그런데 철주먹·단단한발톱·펑크록·메가런처·방탄 같은 특성이 전부 이 플래그에 걸린다.
 * 플래그가 없으면 그 특성들을 대미지 계산에 반영할 수 없다.
 *
 * Showdown 은 설계 문서 1절의 A등급 소스이고 MIT 라이선스다.
 * 소스 파일을 재배포하지 않고, 필요한 플래그만 추출해 우리 데이터에 붙인다.
 */
/**
 * 위력이 상황에 따라 달라지는 기술.
 *
 * Showdown 은 이런 기술에 `basePowerCallback` 을 둔다. PokéAPI 는 고정 위력 하나만
 * 주므로, 그대로 쓰면 **계산기가 조용히 틀린 값을 낸다** (성묘가 항상 50 으로 나오는 식).
 *
 * 그래서 어떤 기술이 가변인지 표시해두고, 계산기가
 *   - 계산할 수 있는 것은 자동으로 구하고
 *   - 나머지는 사용자가 직접 위력을 넣도록
 * 유도한다. 어느 쪽이든 고정값을 사실인 척 보여주지 않는다.
 *
 * `kind` 는 계산기가 아는 공식 식별자. 모르는 것은 'manual' 이다.
 */
const VARIABLE_POWER = {
  'Last Respects': { kind: 'fallenAllies', note: '쓰러진 아군 1마리당 +50' },
  'Stored Power': { kind: 'positiveBoosts', note: '올라간 랭크 1당 +20' },
  'Power Trip': { kind: 'positiveBoosts', note: '올라간 랭크 1당 +20' },
  'Gyro Ball': { kind: 'gyroBall', note: '상대가 느릴수록 강해짐 (최대 150)' },
  'Electro Ball': { kind: 'electroBall', note: '상대가 느릴수록 강해짐 (40~150)' },
  Hex: { kind: 'targetStatus', note: '상대가 상태이상이면 2배' },
  'Infernal Parade': { kind: 'targetStatus', note: '상대가 상태이상이면 2배' },
  Acrobatics: { kind: 'noItem', note: '도구가 없으면 2배' },
  'Rising Voltage': { kind: 'electricTerrain', note: '일렉트릭필드 위의 상대에게 2배' },

  // 아래는 계산기가 가진 입력만으로 확정할 수 없다. 직접 입력을 받는다.
  'Grass Knot': { kind: 'targetWeight', note: '상대 몸무게에 따라 20~120' },
  'Low Kick': { kind: 'targetWeight', note: '상대 몸무게에 따라 20~120' },
  'Heavy Slam': { kind: 'weightRatio', note: '몸무게 비율에 따라 40~120' },
  'Heat Crash': { kind: 'weightRatio', note: '몸무게 비율에 따라 40~120' },
  Eruption: { kind: 'userHp', note: '자신의 남은 HP 비율에 비례 (최대 150)' },
  'Water Spout': { kind: 'userHp', note: '자신의 남은 HP 비율에 비례 (최대 150)' },
  Reversal: { kind: 'userHpInverse', note: '자신의 HP 가 적을수록 강해짐 (최대 200)' },
  Flail: { kind: 'userHpInverse', note: '자신의 HP 가 적을수록 강해짐 (최대 200)' },
  'Hard Press': { kind: 'targetHp', note: '상대의 남은 HP 비율에 비례 (최대 100)' },
  Payback: { kind: 'manual', note: '나중에 움직이면 2배' },
  Assurance: { kind: 'manual', note: '상대가 이미 대미지를 받았으면 2배' },
  Avalanche: { kind: 'manual', note: '먼저 공격받았으면 2배' },
  'Rage Fist': { kind: 'manual', note: '맞은 횟수 1회당 +50 (최대 350)' },
  'Fury Cutter': { kind: 'manual', note: '연속 성공할수록 배가' },
  Rollout: { kind: 'manual', note: '연속 성공할수록 배가' },
  'Echoed Voice': { kind: 'manual', note: '연속 사용할수록 강해짐' },
  'Temper Flare': { kind: 'manual', note: '직전 기술이 실패했으면 2배' },
  'Stomping Tantrum': { kind: 'manual', note: '직전 기술이 실패했으면 2배' },
  'Tera Blast': { kind: 'manual', note: '테라스탈 상태에 따라 달라짐' },
  'Spit Up': { kind: 'manual', note: '비축 횟수에 비례' },
  'Triple Axel': { kind: 'manual', note: '타격마다 20 / 40 / 60 으로 증가' },
  'Beat Up': { kind: 'manual', note: '아군 각각의 공격 종족값으로 계산' },
  Round: { kind: 'manual', note: '아군이 이어서 쓰면 2배' },
  'Fire Pledge': { kind: 'manual', note: '다른 맹세 기술과 조합하면 달라짐' },
  'Water Shuriken': { kind: 'manual', note: '한 폼(사토개굴닌자)에서만 위력이 다름' },

  // --- basePowerCallback 이 아닌 방식(onBasePower)으로 조건이 붙는 기술 ---
  // 이쪽을 놓치면 계산이 조용히 틀린다. 실제로 처음엔 전부 빠져 있었다.
  'Solar Beam': { kind: 'solarBeam', note: '쾌청이 아닌 날씨에서 절반' },
  'Solar Blade': { kind: 'solarBeam', note: '쾌청이 아닌 날씨에서 절반' },
  'Expanding Force': { kind: 'psychicTerrain', note: '사이코필드에서 1.5배' },
  'Misty Explosion': { kind: 'mistyTerrain', note: '미스트필드에서 1.5배' },
  'Terrain Pulse': { kind: 'anyTerrain', note: '필드가 있으면 2배 (타입도 바뀜)' },
  'Weather Ball': { kind: 'anyWeather', note: '날씨가 있으면 2배 (타입도 바뀜)' },
  'Knock Off': { kind: 'targetHasItem', note: '상대가 도구를 들었으면 1.5배' },
  Facade: { kind: 'userStatus', note: '자신이 상태이상이면 2배' },
  Venoshock: { kind: 'targetPoisoned', note: '상대가 독 상태면 2배' },
  'Barb Barrage': { kind: 'targetPoisoned', note: '상대가 독 상태면 2배' },

  Brine: { kind: 'targetHalfHp', note: '상대 HP 가 절반 이하면 2배' },
  'Grav Apple': { kind: 'manual', note: '중력 상태에서 1.5배' },
  Retaliate: { kind: 'manual', note: '직전 턴에 아군이 쓰러졌으면 2배' },
  'Lash Out': { kind: 'manual', note: '이번 턴에 능력이 떨어졌으면 2배' },
  'Fickle Beam': { kind: 'manual', note: '30% 확률로 2배' },
  'Shell Side Arm': { kind: 'manual', note: '물리·특수 중 유리한 쪽으로 판정' },
};

/**
 * 타입이 상황에 따라 바뀌는 기술.
 * 타입이 바뀌면 상성과 자속이 통째로 달라지므로 위력보다 영향이 크다.
 */
const VARIABLE_TYPE = {
  'Weather Ball': { kind: 'weather', note: '날씨에 따라 타입이 바뀜' },
  'Terrain Pulse': { kind: 'terrain', note: '필드에 따라 타입이 바뀜' },
  'Aura Wheel': { kind: 'morpeko', note: '모르페코 폼에 따라 전기/악' },
  'Raging Bull': { kind: 'tauros', note: '탄젠 폼에 따라 타입이 바뀜' },
};

/**
 * 타입 상성표만으로는 안 맞는 기술.
 * 프리즈드라이는 얼음인데 물에 효과가 굉장하다 — 표대로 계산하면 반대로 나온다.
 */
const EFFECTIVENESS_QUIRK = {
  'Freeze-Dry': { kind: 'freezeDry', note: '물 타입에게 효과가 굉장하다' },
  'Flying Press': { kind: 'flyingPress', note: '격투와 비행 상성을 함께 계산한다' },
};

const FLAGS_OF_INTEREST = [
  'contact',
  'punch',
  'sound',
  'bite',
  'pulse',
  'bullet',
  'slicing',
  'wind',
  'powder',
];

async function loadShowdownFlags() {
  const url = 'https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/moves.ts';
  const source = await fetchText(url, 120_000);

  const byMoveId = new Map();
  // 각 기술 항목에서 name 과 flags 만 집어낸다.
  // 항목은 `\tkey: {` 로 시작하고 그 안에 name/flags 가 들어 있다.
  const entryPattern = /\n\t([a-z0-9]+): \{([\s\S]*?)\n\t\},/g;
  for (const entry of source.matchAll(entryPattern)) {
    const body = entry[2];
    const name = /\n\t\tname: "([^"]+)"/.exec(body)?.[1];
    if (!name) continue;

    const flagBlock = /\n\t\tflags: \{([^}]*)\}/.exec(body)?.[1] ?? '';
    const flags = [];
    for (const flag of FLAGS_OF_INTEREST) {
      if (new RegExp(`\\b${flag}: 1\\b`).test(flagBlock)) flags.push(flag);
    }
    byMoveId.set(toId(name), flags);
  }
  return byMoveId;
}

/** Champions 로스터가 배우는 기술 이름의 합집합. */
async function loadRosterMoveNames() {
  const index = await fetchJson('https://championsbattledata.com/api');
  const names = new Set();
  for (const entry of index?.pokemon ?? []) {
    for (const move of entry?.learnableMoveNames ?? []) {
      if (move) names.add(move);
    }
  }
  return [...names].sort();
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const rosterMoves = await loadRosterMoveNames();
  process.stdout.write(`Champions 로스터가 배우는 기술: ${rosterMoves.length}개\n`);

  const list = await cachedJson('_move-index', 'https://pokeapi.co/api/v2/move?limit=2000');
  const slugById = new Map();
  for (const item of list?.results ?? []) {
    if (item?.name) slugById.set(toId(item.name), item.name);
  }
  process.stdout.write(`PokéAPI 기술 목록: ${slugById.size}개\n`);

  const targets = rosterMoves.map((name) => ({ name, slug: slugById.get(toId(name)) ?? null }));
  const unmatched = targets.filter((t) => !t.slug).map((t) => t.name);

  let flagsById = new Map();
  try {
    flagsById = await loadShowdownFlags();
    process.stdout.write(`Showdown 기술 플래그: ${flagsById.size}개 기술\n`);
  } catch (err) {
    // 플래그가 없어도 나머지는 만들어진다. 관련 특성만 미반영으로 남는다.
    process.stdout.write(`Showdown 플래그 로드 실패 (${err.message}) — 플래그 없이 진행합니다\n`);
  }

  let failures = 0;
  const resolved = await mapLimit(
    targets.filter((t) => t.slug),
    CONCURRENCY,
    async (target) => {
      try {
        const m = await cachedJson(target.slug, `https://pokeapi.co/api/v2/move/${target.slug}`);
        return {
          // Champions 표기를 키로 쓴다. 앱이 갖고 있는 이름이 이것이기 때문.
          n: target.name,
          ko: pickName(m.names, ['ko']),
          ja: pickName(m.names, ['ja', 'ja-Hrkt']),
          type: m.type?.name ?? null,
          // physical | special | status
          cls: m.damage_class?.name ?? null,
          pow: typeof m.power === 'number' ? m.power : null,
          acc: typeof m.accuracy === 'number' ? m.accuracy : null,
          pp: typeof m.pp === 'number' ? m.pp : null,
          pri: typeof m.priority === 'number' ? m.priority : 0,
          tgt: m.target?.name ?? null,
          // 게임 내 공식 한국어 설명 (출처: PokéAPI)
          desc: pickFlavorText(m.flavor_text_entries, 'ko'),
          // 한국어 설명이 없는 기술을 위한 폴백
          descEn: pickFlavorText(m.flavor_text_entries, 'en'),
          // --- 정밀 효과: 게임 텍스트의 "크게 올린다" 같은 표현을 숫자로 대체하기 위한 원자료 ---
          // 랭크 변화. [[스탯, 변화량], ...] 예: [['attack', 2]]
          sc: (m.stat_changes ?? [])
            .filter((c) => c?.stat?.name && typeof c.change === 'number' && c.change !== 0)
            .map((c) => [c.stat.name, c.change]),
          // 부가효과 발동 확률 (%)
          ec: typeof m.effect_chance === 'number' ? m.effect_chance : null,
          // 상태이상과 그 확률
          ail: m.meta?.ailment?.name && m.meta.ailment.name !== 'none' ? m.meta.ailment.name : null,
          ailc: num(m.meta?.ailment_chance),
          // 랭크 변화가 확정(100)인지 확률인지
          statc: num(m.meta?.stat_chance),
          flinch: num(m.meta?.flinch_chance),
          crit: num(m.meta?.crit_rate),
          // 양수는 흡수, 음수는 반동 (입힌 데미지 대비 %)
          drain: num(m.meta?.drain),
          // 최대 HP 대비 회복 %
          heal: num(m.meta?.healing),
          hits: range(m.meta?.min_hits, m.meta?.max_hits),
          turns: range(m.meta?.min_turns, m.meta?.max_turns),
          // 기술 플래그 (출처: Pokémon Showdown). 철주먹·단단한발톱 같은 특성 판정에 쓴다.
          flags: flagsById.get(toId(target.name)) ?? [],
          // 위력이 상황에 따라 달라지면 그 사실과 근거를 남긴다. 고정값을 사실인 척하지 않는다.
          varPow: VARIABLE_POWER[target.name]?.kind ?? null,
          varNote: VARIABLE_POWER[target.name]?.note ?? null,
          // 타입이 바뀌는 기술 (웨더볼·대지의파동 등)
          varType: VARIABLE_TYPE[target.name]?.kind ?? null,
          varTypeNote: VARIABLE_TYPE[target.name]?.note ?? null,
          // 타입표만으로 안 맞는 기술 (프리즈드라이 등)
          effQuirk: EFFECTIVENESS_QUIRK[target.name]?.kind ?? null,
          effQuirkNote: EFFECTIVENESS_QUIRK[target.name]?.note ?? null,
        };
      } catch (err) {
        failures += 1;
        process.stdout.write(`  ${target.name}: ${err.message}\n`);
        return null;
      }
    },
  );

  const moves = {};
  for (const move of resolved) {
    if (move) moves[move.n] = move;
  }

  const file = path.join(OUT_DIR, 'moves.json');
  await writeFile(file, JSON.stringify({ generatedAt: new Date().toISOString(), moves }));

  const total = Object.keys(moves).length;
  const withKo = Object.values(moves).filter((m) => m.ko).length;
  const withDesc = Object.values(moves).filter((m) => m.desc).length;
  process.stdout.write(
    `저장 ${path.relative(ROOT, file)} — ${total}개, 한국어명 ${withKo}개, 한국어 설명 ${withDesc}개, 실패 ${failures}건\n`,
  );

  // 플래그별 개수를 보고한다. 0 이면 파싱이 깨진 것이라 바로 드러난다.
  const flagCounts = new Map();
  for (const move of Object.values(moves)) {
    for (const flag of move.flags ?? []) flagCounts.set(flag, (flagCounts.get(flag) ?? 0) + 1);
  }
  if (flagCounts.size > 0) {
    const summary = [...flagCounts].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`);
    process.stdout.write(`  기술 플래그: ${summary.join(' · ')}\n`);
  }

  // 가변 위력 기술이 표에서 빠지지 않았는지 확인한다.
  const variable = Object.values(moves).filter((m) => m.varPow);
  const auto = variable.filter((m) => m.varPow !== 'manual').length;
  process.stdout.write(
    `  가변 위력: ${variable.length}개 (자동 계산 ${auto} · 직접 입력 ${variable.length - auto})\n`,
  );
  const typed = Object.values(moves).filter((m) => m.varType).length;
  const quirks = Object.values(moves).filter((m) => m.effQuirk).length;
  process.stdout.write(`  타입 가변: ${typed}개 · 상성 예외: ${quirks}개\n`);

  const missing = [
    ...Object.keys(VARIABLE_POWER),
    ...Object.keys(VARIABLE_TYPE),
    ...Object.keys(EFFECTIVENESS_QUIRK),
  ].filter((name) => !moves[name]);
  if (missing.length > 0) {
    process.stdout.write(`  (로스터에 없어 건너뜀: ${[...new Set(missing)].join(', ')})\n`);
  }
  if (unmatched.length > 0) {
    process.stdout.write(`PokéAPI 에 없는 기술 ${unmatched.length}개: ${unmatched.join(', ')}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`실패: ${err.stack ?? err}\n`);
  process.exitCode = 1;
});
