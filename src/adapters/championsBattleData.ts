/**
 * A등급 1차 소스 — championsbattledata.com
 *
 * 2026-08 실응답 기준으로 확정한 사실:
 *   - /api        : { pokemon: [...] }  236종. summary.primary 에 타입·특성·종족값이 이미 있다.
 *   - /api/battle/:format/:showdownId : { rows: [...] }
 *   - category 값은 move | held_item | ability | stat_alignment | stat_points | teammate
 *     (설계 문서의 item/nature/spread/tera 와 다름. tera 는 존재하지 않는다 — 이 게임은 메가진화다.)
 *   - teammate 행은 percentage 가 빈 문자열이고 percentage_value 가 null 이다.
 *   - 종족값은 Champions 자체 스케일이다(463~775). PokéAPI 수치로 덮어쓰면 안 된다.
 *
 * 방어 원칙(설계 문서 M2): rows 파싱은 전부 optional chaining + 폴백.
 * 모르는 category 가 와도 버리지 않고 통과시키되, 없는 카테고리는 화면에서 섹션째 숨긴다.
 */

import { TTL, fetchJson } from '../core/http';
import type {
  StatLine,
  EffortPoints,
  Format,
  Pokemon,
  PokemonForm,
  TypeName,
  UsageBlock,
  UsageCategory,
  UsageEntry,
  UsageReport,
} from '../types';

const API_ROOT = 'https://championsbattledata.com';

/** 원시 응답 타입 — 이 파일 밖으로 새어나가지 않는다. */
interface RawForm {
  form_name?: string;
  saved_name?: string;
  slug?: string;
  form_kind?: string;
  types?: string[];
  abilities?: string;
  hidden_ability?: string;
  image_path?: string;
  hp?: number;
  attack?: number;
  defense?: number;
  sp_attack?: number;
  sp_defense?: number;
  speed?: number;
  base_stat_total?: number;
}

interface RawPokemon {
  name?: string;
  slug?: string;
  showdownId?: string;
  learnableMoveNames?: string[];
  summary?: {
    sprite?: string;
    forms?: RawForm[];
    primary?: RawForm;
    /** 시즌 → 포맷 → { position: 사용률 순위 }. 순위 말고도 top/values 가 있지만 여기선 안 쓴다. */
    battleSummary?: Record<string, Partial<Record<Format, { position?: number }>>>;
  };
}

interface RawIndex {
  pokemon?: RawPokemon[];
  defaultSeason?: string;
  battleDataFolders?: string[];
  generatedAt?: string;
}

interface RawBattleRow {
  category?: string;
  rank?: number;
  name?: string;
  percentage?: string;
  percentage_value?: number | null;
  stat_up?: string;
  stat_down?: string;
  hp_points?: number | string;
  attack_points?: number | string;
  defense_points?: number | string;
  sp_atk_points?: number | string;
  sp_def_points?: number | string;
  speed_points?: number | string;
}

interface RawBattle {
  pokemon?: string;
  showdownId?: string;
  format?: string;
  season?: string;
  date?: string;
  source?: string;
  rows?: RawBattleRow[];
}

export interface ChampionsIndex {
  pokemon: Pokemon[];
  byShowdownId: Map<string, Pokemon>;
  defaultSeason: string;
  generatedAt: string;
}

function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

function assetUrl(imagePath: string | undefined): string {
  if (!imagePath) return '';
  // 응답의 image_path 는 루트 상대경로다. 공백이 들어있어 인코딩이 필요하다.
  return `${API_ROOT}/${imagePath.split('/').map(encodeURIComponent).join('/')}`;
}

function normalizeForm(raw: RawForm | undefined): PokemonForm | null {
  const savedName = raw?.saved_name ?? raw?.form_name;
  if (!raw || !savedName) return null;
  const stats: StatLine = {
    hp: num(raw.hp),
    atk: num(raw.attack),
    def: num(raw.defense),
    spa: num(raw.sp_attack),
    spd: num(raw.sp_defense),
    spe: num(raw.speed),
    total: num(raw.base_stat_total),
  };
  return {
    slug: raw.slug ?? '',
    formName: raw.form_name ?? savedName,
    savedName,
    formKind: raw.form_kind ?? 'Base',
    types: (raw.types ?? []).filter(Boolean) as TypeName[],
    // abilities 는 "Snow Warning|Soundproof" 형태의 파이프 구분 문자열이다.
    abilities: (raw.abilities ?? '').split('|').map((a) => a.trim()).filter(Boolean),
    hiddenAbility: raw.hidden_ability ?? '',
    stats: stats,
    spriteUrl: assetUrl(raw.image_path),
  };
}

/**
 * 포맷별 사용률 순위를 꺼낸다.
 *
 * 인덱스가 이미 갖고 있는 값이라 순위를 위해 따로 요청할 필요가 없다.
 * 즉 앱을 다시 배포하지 않아도 상류가 갱신되면 순위도 같이 최신이 된다.
 */
function usageRankOf(entry: RawPokemon, defaultSeason: string | undefined): Record<Format, number | null> {
  const summary = entry.summary?.battleSummary;
  const season = summary?.[defaultSeason ?? 'Current'] ?? summary?.Current;
  const pick = (format: Format): number | null => {
    const value = season?.[format]?.position;
    return typeof value === 'number' && value > 0 ? value : null;
  };
  return { Singles: pick('Singles'), Doubles: pick('Doubles') };
}

export function normalizeIndex(raw: RawIndex): ChampionsIndex {
  const pokemon: Pokemon[] = [];
  const byShowdownId = new Map<string, Pokemon>();

  for (const entry of raw?.pokemon ?? []) {
    const showdownId = entry?.showdownId;
    if (!showdownId) continue;

    const rank = usageRankOf(entry, raw?.defaultSeason);
    // 상류 데이터에 showdownId 중복이 있다(rotomfan: "Fan Rotom" / "Rotom Fan").
    // 배틀 API 는 어차피 같은 응답을 주므로 어느 쪽이든 되지만, **순위가 붙은 쪽**을 고른다.
    // 실제로 한쪽에만 position 이 있어서, 순서에 기대면 순위를 통째로 잃는다.
    const existing = byShowdownId.get(showdownId);
    if (existing) {
      const existingHasRank = Object.values(existing.usageRank).some((n) => n !== null);
      const incomingHasRank = Object.values(rank).some((n) => n !== null);
      if (incomingHasRank && !existingHasRank) existing.usageRank = rank;
      continue;
    }

    const primary = normalizeForm(entry.summary?.primary);
    if (!primary) continue;

    const forms = (entry.summary?.forms ?? [])
      .map(normalizeForm)
      .filter((f): f is PokemonForm => f !== null);

    const model: Pokemon = {
      showdownId,
      slug: entry.slug ?? showdownId,
      name: entry.name ?? primary.formName,
      displayName: entry.name ?? primary.formName,
      localeNames: { en: entry.name ?? primary.formName },
      primary,
      forms: forms.length > 0 ? forms : [primary],
      learnableMoveNames: (entry.learnableMoveNames ?? []).filter(Boolean),
      usageRank: rank,
    };
    pokemon.push(model);
    byShowdownId.set(showdownId, model);
  }

  pokemon.sort((a, b) => a.name.localeCompare(b.name));

  return {
    pokemon,
    byShowdownId,
    defaultSeason: raw?.defaultSeason ?? 'Current',
    generatedAt: raw?.generatedAt ?? '',
  };
}

/** 화면에 보여줄 순서. 실응답에 없는 카테고리는 normalize 단계에서 그냥 빠진다. */
const CATEGORY_ORDER: UsageCategory[] = [
  'move',
  'held_item',
  'ability',
  'stat_alignment',
  'stat_points',
  'teammate',
];

function normalizeRow(raw: RawBattleRow, index: number): UsageEntry {
  const entry: UsageEntry = {
    rank: num(raw?.rank) || index + 1,
    name: raw?.name ?? '',
    percentage: raw?.percentage ?? '',
    percentageValue:
      typeof raw?.percentage_value === 'number' && Number.isFinite(raw.percentage_value)
        ? raw.percentage_value
        : null,
  };

  if (raw?.stat_up || raw?.stat_down) {
    entry.statUp = raw.stat_up ?? '';
    entry.statDown = raw.stat_down ?? '';
  }

  // stat_points 행만 노력치 컬럼이 채워진다. 전부 0이면 의미 없는 행이라 붙이지 않는다.
  const points: EffortPoints = {
    hp: num(raw?.hp_points),
    atk: num(raw?.attack_points),
    def: num(raw?.defense_points),
    spa: num(raw?.sp_atk_points),
    spd: num(raw?.sp_def_points),
    spe: num(raw?.speed_points),
  };
  if (Object.values(points).some((v) => v > 0)) entry.points = points;

  return entry;
}

export function normalizeBattle(raw: RawBattle, requested: Format, showdownId: string): UsageReport {
  const grouped = new Map<UsageCategory, UsageEntry[]>();

  (raw?.rows ?? []).forEach((row, i) => {
    const category = row?.category as UsageCategory | undefined;
    if (!category) return;
    const list = grouped.get(category) ?? [];
    list.push(normalizeRow(row, i));
    grouped.set(category, list);
  });

  const blocks: UsageBlock[] = [];
  // 알려진 순서 먼저, 그다음 처음 보는 카테고리(스키마 드리프트 대비)를 뒤에 붙인다.
  const seen = new Set<string>();
  for (const category of CATEGORY_ORDER) {
    const entries = grouped.get(category);
    seen.add(category);
    if (!entries || entries.length === 0) continue;
    entries.sort((a, b) => a.rank - b.rank);
    blocks.push({ category, entries });
  }
  for (const [category, entries] of grouped) {
    if (seen.has(category) || entries.length === 0) continue;
    entries.sort((a, b) => a.rank - b.rank);
    blocks.push({ category, entries });
  }

  return {
    showdownId: raw?.showdownId ?? showdownId,
    pokemon: raw?.pokemon ?? showdownId,
    format: (raw?.format as Format) ?? requested,
    season: raw?.season ?? 'Current',
    date: raw?.date ?? '',
    sourcePath: raw?.source ?? '',
    blocks,
  };
}

export async function fetchIndex(): Promise<ChampionsIndex> {
  const { data } = await fetchJson<RawIndex>(`${API_ROOT}/api`, {
    ttlMs: TTL.championsBattleData,
    timeoutMs: 20_000,
  });
  return normalizeIndex(data);
}

export async function fetchUsage(showdownId: string, format: Format): Promise<UsageReport> {
  const { data } = await fetchJson<RawBattle>(
    `${API_ROOT}/api/battle/${format}/${encodeURIComponent(showdownId)}`,
    { ttlMs: TTL.championsBattleData, timeoutMs: 20_000 },
  );
  return normalizeBattle(data, format, showdownId);
}
