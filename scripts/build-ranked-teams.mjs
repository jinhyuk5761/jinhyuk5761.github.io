/**
 * 상위 랭커 구축 데이터를 집계한다.
 *
 * 출처: champs.pokedb.tokyo 공개 데이터(`s{시즌}_{single|double}_ranked_teams.json`).
 * 시즌별 상위 랭커의 **실제 팀 구성**이다 — 래더 전체 사용률(championsbattledata)과
 * 표본이 다르므로 서로 대체하지 않고 나란히 본다.
 *
 * **파일을 여기서 내려받지 않는다.** 발행처가 "불특정 다수가 쓰는 앱이면 자기 서버에
 * 한 번 받아두고 쓰라, 최종 사용자 기기에서 직접 요청하지 말라" 고 명시했다.
 * 사람이 `구축데이터/` 에 받아둔 파일을 읽어 집계 결과만 굽는다.
 *
 * 원본은 일본어다. 한국어는 지어내지 않고 이미 있는 도감에서 되짚는다:
 *   종족  — locales.json 의 ja/jaSpecies
 *   도구  — terms.json 의 ja (PokéAPI 제공)
 *   메가스톤 — PokéAPI 에 없으므로 "종족명 + ナイト" 구조를 이용해 종을 찾고,
 *             그 종의 한국어 돌 이름을 terms.json 에서 찾는다
 *
 * 실행: npm run data:teams
 * 출력: public/data/rankedTeams.json
 */

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(ROOT, '구축데이터');
const OUT_DIR = path.join(ROOT, 'public', 'data');

/** 원본의 규칙 표기 → 앱의 포맷 키. */
const RULE_TO_FORMAT = { シングル: 'Singles', ダブル: 'Doubles' };
/** 도구 칸이 비었음을 뜻하는 원본 값. */
const NO_ITEM = '持ち物なし';

/** 두 문자열이 앞에서 몇 글자나 같은가. */
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

/**
 * 일본어 이름을 한국어로 되짚는 사전.
 *
 * 못 찾은 이름은 **원문 그대로 둔다.** 비슷한 한국어를 지어내면 조용히 틀린다.
 */
/**
 * 일본어 지역폼 표기 → 우리 한국어 접두어.
 *
 * 이름이 아니라 **구조**다 (`formNames.ts` 의 PREFIXES 와 같은 성격).
 * 지역폼은 종이 아예 다른 항목이라(알로라 나인테일) 링크 대상까지 달라진다.
 */
const REGION_PREFIX = [
  [/^アローラのすがた/, '알로라'],
  [/^ガラルのすがた/, '가라르'],
  [/^ヒスイのすがた/, '히스이'],
  [/^パルデアのすがた/, '팔데아'],
];

function buildDictionary(locales, terms, jaFormLabels) {
  const speciesKo = new Map();
  const idByJa = new Map();
  for (const [showdownId, v] of Object.entries(locales)) {
    if (v.ja && !speciesKo.has(v.ja)) {
      speciesKo.set(v.ja, v.ko ?? v.en);
      idByJa.set(v.ja, showdownId);
    }
    if (v.jaSpecies && !speciesKo.has(v.jaSpecies)) {
      speciesKo.set(v.jaSpecies, v.koSpecies ?? v.ko ?? v.en);
      idByJa.set(v.jaSpecies, showdownId);
    }
  }

  const itemKo = new Map();
  const itemEnByKo = new Map();
  for (const [en, v] of Object.entries(terms.items ?? {})) {
    if (v.ja && v.ko) itemKo.set(v.ja, v.ko);
    if (v.ko) itemEnByKo.set(v.ko, en);
  }

  const jaSpeciesNames = [...speciesKo.keys()];
  const unresolved = new Set();

  /**
   * 메가스톤. PokéAPI 에 Champions 오리지널 돌이 없어 이름 구조로 잇는다.
   * 'カイリュナイト' 의 앞부분은 'カイリュー' 와 완전히 같지 않으므로(장음 탈락)
   * 가장 길게 겹치는 종족명을 고른다.
   */
  function stoneKo(name) {
    const m = /^(.*?)ナイト([ＸＹXY]?)$/.exec(name);
    if (!m) return null;
    const head = m[1];
    const branch = m[2].replace('Ｘ', 'X').replace('Ｙ', 'Y');
    let best = null;
    let bestLen = 0;
    for (const ja of jaSpeciesNames) {
      const n = commonPrefix(head, ja);
      if (n > bestLen && n >= Math.min(3, head.length)) {
        best = ja;
        bestLen = n;
      }
    }
    if (!best) return null;
    const candidate = `${speciesKo.get(best)}나이트${branch}`;
    // 도감에 실재하는 이름일 때만 쓴다.
    return itemEnByKo.has(candidate) ? candidate : null;
  }

  /** 한국어 표시명 → showdownId. 지역폼은 종이 따로 있어 이걸로 찾는다. */
  const idByKo = new Map();
  for (const [showdownId, v] of Object.entries(locales)) {
    if (v.ko && !idByKo.has(v.ko)) idByKo.set(v.ko, showdownId);
    if (v.koSpecies && !idByKo.has(v.koSpecies)) idByKo.set(v.koSpecies, showdownId);
  }

  /**
   * 한 마리를 한국어 이름 + 상세 링크로 옮긴다.
   *
   * 폼 표기는 **알아본 것만** 붙인다. 못 알아본 표기는 떼고 종족명만 남긴다 —
   * 일본어를 그대로 두거나 비슷한 한국어를 지어내는 것보다 낫다.
   * 실제로 못 알아보는 것들(ばけたすがた·ナイーブフォルム 등)은 대부분 기본 폼이라
   * 떼어내도 잃는 정보가 없다.
   */
  function member(p) {
    const baseKo = speciesKo.get(p.pokemon);
    if (!baseKo) unresolved.add(`종족: ${p.pokemon}`);
    const species = baseKo ?? p.pokemon;
    const baseId = idByJa.get(p.pokemon) ?? null;
    if (!p.form) return { name: species, showdownId: baseId };

    // 지역폼: '알로라 나인테일' 처럼 종 자체가 따로 있다.
    for (const [pattern, prefix] of REGION_PREFIX) {
      if (!pattern.test(p.form)) continue;
      const name = `${prefix} ${species}`;
      const id = idByKo.get(name);
      // 도감에 그 종이 실재할 때만 지역폼으로 부른다.
      if (id) return { name, showdownId: id };
      return { name: species, showdownId: baseId };
    }

    // 그 밖의 폼: 공식 한국어 표기가 있을 때만 쓴다.
    const label = jaFormLabels[p.form];
    if (!label) return { name: species, showdownId: baseId };
    const name = label.includes(species) ? label : `${species} ${label}`;
    return { name, showdownId: idByKo.get(name) ?? idByKo.get(label) ?? baseId };
  }

  return {
    member,
    species: (ja) => {
      if (!ja) return null;
      const ko = speciesKo.get(ja);
      if (!ko) unresolved.add(`종족: ${ja}`);
      return ko ?? ja;
    },
    showdownId: (ja) => idByJa.get(ja) ?? null,
    item: (ja) => {
      if (!ja || ja === NO_ITEM) return null;
      const direct = itemKo.get(ja);
      if (direct) return direct;
      const stone = stoneKo(ja);
      if (stone) return stone;
      unresolved.add(`도구: ${ja}`);
      return ja;
    },
    unresolved,
  };
}

/** 등장 횟수를 세어 많은 순으로 돌려준다. */
function tally(counter, total) {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count, share: Math.round((count / total) * 1000) / 10 }));
}

function aggregate(file, dict) {
  const format = RULE_TO_FORMAT[file.rule];
  const teams = file.teams ?? [];

  const monTeams = new Map();
  const monItems = new Map();
  /** 표시명 → showdownId. 이름으로 다시 찾지 않고 해석 단계의 결과를 그대로 쓴다. */
  const monIds = new Map();
  const items = new Map();
  const pairs = new Map();
  let slots = 0;

  const teamList = [];

  for (const team of teams) {
    const members = (team.team ?? []).filter((p) => p?.pokemon);
    const seen = new Set();
    const row = [];
    for (const p of members) {
      slots += 1;
      const resolved = dict.member(p);
      // 집계도 팀 목록과 같은 이름을 쓴다. 예전에는 종족명만 세서
      // '히스이 윈디' 가 '윈디' 로 뭉뚱그려졌다.
      const ko = resolved.name;
      if (resolved.showdownId && !monIds.has(ko)) monIds.set(ko, resolved.showdownId);
      seen.add(ko);
      row.push({
        name: resolved.name,
        id: resolved.showdownId,
        item: dict.item(p.item),
        // 원본의 '도감번호-폼번호'. pokedb 의 그 폼 페이지로 넘어가는 열쇠다.
        // 거기에 이 폼을 쓴 구축글 링크가 모여 있다.
        dex: p.id || null,
      });
      monTeams.set(ko, (monTeams.get(ko) ?? 0) + 1);

      const item = dict.item(p.item);
      if (item) {
        items.set(item, (items.get(item) ?? 0) + 1);
        const perMon = monItems.get(ko) ?? new Map();
        perMon.set(item, (perMon.get(item) ?? 0) + 1);
        monItems.set(ko, perMon);
      }
    }
    teamList.push({
      rank: team.rank,
      // 원본은 소수점 셋째 자리까지 준다. 표시에는 그만큼 필요 없다.
      rating: typeof team.rating_value === 'number' ? Math.round(team.rating_value) : null,
      members: row,
    });

    // 같은 팀에 함께 들어간 조합. 순서를 없애 한 쌍으로 센다.
    const list = [...seen].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]} ${list[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }

  const teamCount = teams.length;
  const pokemon = tally(monTeams, teamCount).map((row) => {
    const perMon = monItems.get(row.name);
    const topItems = perMon ? tally(perMon, row.count).slice(0, 3) : [];
    return {
      name: row.name,
      showdownId: monIds.get(row.name) ?? null,
      teams: row.count,
      share: row.share,
      items: topItems,
    };
  });

  return {
    season: file.season,
    seasonNumber: file.season_number,
    format,
    updatedAt: file.updated_at,
    teamCount,
    slotCount: slots,
    teams: teamList.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)),
    pokemon,
    items: tally(items, slots),
    pairs: [...pairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([key, count]) => {
        const [a, b] = key.split(' ');
        return { a, b, count, share: Math.round((count / teamCount) * 1000) / 10 };
      }),
  };
}

async function main() {
  const [locales, terms, formNames] = await Promise.all([
    readFile(path.join(OUT_DIR, 'locales.json'), 'utf8').then(JSON.parse),
    readFile(path.join(OUT_DIR, 'terms.json'), 'utf8').then(JSON.parse),
    readFile(path.join(OUT_DIR, 'formNames.json'), 'utf8').then(JSON.parse),
  ]);
  if (!formNames?.jaLabels) {
    throw new Error('formNames.json 에 jaLabels 가 없습니다. npm run data:forms 를 먼저 실행하세요.');
  }
  const dict = buildDictionary(locales, terms, formNames.jaLabels);

  const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`${SRC_DIR} 에 파일이 없습니다.`);

  const sets = [];
  for (const name of files) {
    const raw = JSON.parse(await readFile(path.join(SRC_DIR, name), 'utf8'));
    if (!RULE_TO_FORMAT[raw.rule]) throw new Error(`알 수 없는 규칙: ${raw.rule} (${name})`);
    sets.push(aggregate(raw, dict));
  }

  sets.sort((a, b) => b.seasonNumber - a.seasonNumber || a.format.localeCompare(b.format));

  const out = {
    source: 'champs.pokedb.tokyo 공개 데이터',
    sets,
  };
  await writeFile(path.join(OUT_DIR, 'rankedTeams.json'), JSON.stringify(out));

  const linked = sets.reduce((n, s) => n + s.pokemon.filter((p) => p.showdownId).length, 0);
  const total = sets.reduce((n, s) => n + s.pokemon.length, 0);
  console.log(`구축 ${sets.length}세트 · 팀 ${sets.reduce((n, s) => n + s.teamCount, 0)}개`);
  console.log(`  상세 링크 연결 ${linked}/${total}`);
  console.log(`  못 되짚은 이름 ${dict.unresolved.size}개${dict.unresolved.size ? ': ' + [...dict.unresolved].join(', ') : ''}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
