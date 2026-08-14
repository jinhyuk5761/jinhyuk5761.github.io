/**
 * 이름 정규화 — 설계 문서 7절 "showdownId/displayName/savedName 매핑을 단일 모듈로".
 *
 * 해결해야 하는 실제 문제:
 *   Smogon(Showdown) 표기   Champions 표기
 *   Gyarados-Mega       →   Mega Gyarados
 *   Raichu-Mega-Y       →   Mega Raichu Y
 *   Ninetales-Alola     →   Alolan Ninetales
 *   Arcanine-Hisui      →   Hisuian Arcanine
 *   Aegislash-Blade     →   Aegislash Blade Forme
 *
 * 전략: 하드코딩된 1:1 표 대신 "정렬된 토큰 키"로 맞춘다.
 *   {Gyarados, Mega} 와 {Mega, Gyarados} 는 정렬하면 같아진다.
 * 지역폼 어미(alolan→alola)와 무의미 토큰(forme/form/mode)을 먼저 흡수시키고,
 * 그래도 남는 잔여분만 ALIASES 로 명시한다. 잔여분은 빌드 스크립트가 로그로 뱉는다.
 *
 * 이 파일은 plain JS 다. 빌드 스크립트(node)와 앱(TS)이 같은 구현을 공유해야 하기 때문.
 */

/** 접근성/검색용 ID: 소문자 영숫자만 남긴다. 악센트는 먼저 분해해 제거. */
export function toId(value) {
  if (typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** 토큰 분리: 공백/하이픈/언더스코어 기준. 악센트 제거 후 소문자. */
function tokenize(value) {
  if (typeof value !== 'string') return [];
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * 지역폼 어미 통일. Champions 는 형용사형(Alolan), Showdown 은 지명형(Alola)을 쓴다.
 */
const REGION_CANON = {
  alolan: 'alola',
  galarian: 'galar',
  hisuian: 'hisui',
  paldean: 'paldea',
};

/**
 * 한쪽 표기에만 붙는 분류 명사. 제거해도 같은 종의 폼끼리 충돌하지 않는 것만 넣는다.
 * (Alcremie 의 cream/swirl 처럼 폼 자체를 구분하는 토큰은 절대 넣지 않는다.)
 *
 * 이 목록 덕분에 아래가 alias 없이 자동 매칭된다:
 *   Gourgeist-Large  ↔ Gourgeist Large Variety   (variety 제거)
 *   Furfrou-Dandy    ↔ Furfrou Dandy Trim        (trim 제거)
 *   Vivillon-Polar   ↔ Vivillon Polar Pattern    (pattern 제거)
 *   Morpeko-Hangry   ↔ Morpeko Hangry Mode       (mode 제거)
 */
const NOISE_TOKENS = new Set([
  'forme',
  'form',
  'mode',
  'breed',
  'pattern',
  'variety',
  'trim',
]);

/**
 * 정렬 토큰 키. 어순 차이를 흡수하는 것이 목적.
 * "Mega Gyarados" 와 "Gyarados-Mega" 둘 다 "gyarados|mega" 가 된다.
 */
export function orderlessKey(value) {
  const tokens = tokenize(value)
    .map((t) => REGION_CANON[t] ?? t)
    .filter((t) => !NOISE_TOKENS.has(t));
  return tokens.sort().join('|');
}

/**
 * 정렬 키로도 안 맞는 잔여분. key 는 Showdown 이름의 toId, value 는 Champions savedName.
 * 전부 2026-08 실데이터에서 미매칭으로 뜬 것만 실제 표기를 확인해 넣었다.
 * 빌드 스크립트가 미매칭 목록을 출력하므로, 데이터가 바뀌면 여기에 추가한다.
 *
 * 대부분 "Showdown 은 기본 폼을 접미사 없이 쓰는데 Champions 는 폼 이름을 명시"하는 경우다.
 *   Showdown "Palafin" = 기본 폼 → Champions "Palafin Zero Form"
 */
export const ALIASES = {
  aegislash: 'Aegislash Shield Forme',
  basculegion: 'Basculegion Male',
  basculegionf: 'Basculegion Female',
  florges: 'Florges Red Flower',
  furfrou: 'Furfrou Natural Form',
  palafin: 'Palafin Zero Form',
  // Showdown 무접미 Vivillon 의 기본 무늬는 Meadow 다.
  vivillon: 'Vivillon Meadow Pattern',
  // Showdown 은 Jumbo 를 Super 로 부른다.
  gourgeistsuper: 'Gourgeist Jumbo Variety',
  // Champions 의 메가 메워스틱은 성별 구분이 없다.
  meowsticfmega: 'Mega Meowstic',
  meowsticmmega: 'Mega Meowstic',
};

/**
 * Champions 로스터에 아예 없는 Showdown 폼. 매칭 실패가 정상이므로 경고에서 제외한다.
 * (Floette-Eternal 은 이터널플라워 전용 폼이라 Champions 에 대응 폼이 없다.)
 */
export const KNOWN_ABSENT = new Set(['floetteeternal']);

/**
 * Champions 폼들로부터 조회 인덱스를 만든다.
 *
 * @param {Array<{savedName:string, formName:string, slug:string, showdownId:string}>} forms
 * @returns {{byKey: Map<string, object>, byId: Map<string, object>}}
 */
export function buildFormIndex(forms) {
  const byKey = new Map();
  const byId = new Map();
  for (const form of forms) {
    if (!form || !form.savedName) continue;
    // 한 폼에 여러 키를 걸어둔다. 먼저 등록된 쪽을 이긴 것으로 본다(선착순).
    for (const candidate of [form.savedName, form.formName, form.slug]) {
      const key = orderlessKey(candidate);
      if (key && !byKey.has(key)) byKey.set(key, form);
      const id = toId(candidate);
      if (id && !byId.has(id)) byId.set(id, form);
    }
  }
  return { byKey, byId };
}

/**
 * Showdown 표기 이름 하나를 Champions 폼으로 해석한다.
 *
 * @param {string} smogonName 예: "Gyarados-Mega"
 * @param {{byKey: Map<string, object>, byId: Map<string, object>}} index
 * @returns {object|null} 매칭된 Champions 폼, 없으면 null
 */
export function resolveSmogonName(smogonName, index) {
  if (!smogonName) return null;

  const aliasTarget = ALIASES[toId(smogonName)];
  if (aliasTarget) {
    const viaAlias = index.byId.get(toId(aliasTarget));
    if (viaAlias) return viaAlias;
  }

  const direct = index.byId.get(toId(smogonName));
  if (direct) return direct;

  const orderless = index.byKey.get(orderlessKey(smogonName));
  if (orderless) return orderless;

  // 마지막 시도: 성별 접미(-F/-M)를 떼고 기본 폼으로 폴백.
  const genderStripped = smogonName.replace(/-(F|M)$/i, '');
  if (genderStripped !== smogonName) {
    const base = index.byId.get(toId(genderStripped));
    if (base) return base;
  }

  return null;
}

/**
 * 검색 매칭. 표시명/영문명/showdownId/로케일명 어디든 부분일치하면 통과.
 * M1 완료 기준("한카리아스"/"garchomp"/"ガブリアス" 동일 결과)을 만족시키는 지점.
 *
 * @param {string} query
 * @param {string[]} haystacks
 */
export function matchesQuery(query, haystacks) {
  const raw = query.trim();
  if (!raw) return true;
  const id = toId(raw);
  for (const hay of haystacks) {
    if (!hay) continue;
    // 한글/가나는 toId 로 지워지므로 원문 비교를 함께 돌린다.
    if (hay.toLowerCase().includes(raw.toLowerCase())) return true;
    if (id && toId(hay).includes(id)) return true;
  }
  return false;
}
