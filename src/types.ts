/**
 * 도메인 모델 — 설계 문서 3절.
 *
 * 실응답 검증(2026-08) 결과 문서와 달라진 지점은 주석으로 명시한다.
 * 어댑터는 이 타입으로만 바깥과 대화하고, 원시 응답 타입을 노출하지 않는다.
 */

export type Format = 'Singles' | 'Doubles';

export type TypeName =
  | 'Normal' | 'Fire' | 'Water' | 'Electric' | 'Grass' | 'Ice'
  | 'Fighting' | 'Poison' | 'Ground' | 'Flying' | 'Psychic' | 'Bug'
  | 'Rock' | 'Ghost' | 'Dragon' | 'Dark' | 'Steel' | 'Fairy';

export interface StatLine {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
  total: number;
}

/**
 * 하나의 폼(form). Champions 는 종(species) 아래에 여러 폼을 둔다.
 * 사용률(UsageBlock)은 종 단위, Smogon 카운터는 폼 단위라는 비대칭이 있다.
 */
export interface PokemonForm {
  /** 폼 고유 slug. 예: mega-garchomp */
  slug: string;
  /** 폼 표시명(영). 예: Mega Garchomp */
  formName: string;
  /** 스프라이트/CSV 파일명. 예: Mega Garchomp */
  savedName: string;
  /** Base | Mega | Alolan | Hisuian | ... */
  formKind: string;
  types: TypeName[];
  abilities: string[];
  hiddenAbility: string;
  stats: StatLine;
  spriteUrl: string;
}

/**
 * 종(species) 단위 엔트리. championsbattledata `/api` 의 pokemon[] 1건.
 */
export interface Pokemon {
  /** 배틀 API 라우팅 키. 예: garchomp, ninetalesalola */
  showdownId: string;
  /** 종 slug. 예: garchomp */
  slug: string;
  /** 영문 표시명 */
  name: string;
  /** 로케일 표시명 (ko/ja 없으면 영문 폴백) */
  displayName: string;
  localeNames: { en: string; ko?: string; ja?: string };
  /** 대표 폼 */
  primary: PokemonForm;
  forms: PokemonForm[];
  /** 종이 배울 수 있는 기술 이름 (Showdown learnset 유래, 인덱스에 동봉됨) */
  learnableMoveNames: string[];
  /**
   * 포맷별 사용률 순위 (1위가 가장 많이 쓰임).
   *
   * 인덱스 응답의 `summary.battleSummary.Current.<포맷>.position` 이다.
   * 순위가 없는 종은 null — 지어내지 않는다.
   */
  usageRank: Record<Format, number | null>;
}

/** 실응답에서 확인된 category 값. 문서의 item/nature/spread/tera 와 다르다. */
export type UsageCategory =
  | 'move'
  | 'held_item'
  | 'ability'
  | 'stat_alignment'
  | 'stat_points'
  | 'teammate';

export interface UsageEntry {
  rank: number;
  /** stat_points 행은 name 이 비어 있다 (노력치 분배 자체가 값) */
  name: string;
  /** "99.3%" 원문. teammate 는 빈 문자열 */
  percentage: string;
  /** 99.3. teammate 는 null */
  percentageValue: number | null;
  /** stat_alignment 전용 — 성격 보정 */
  statUp?: string;
  statDown?: string;
  /** stat_points 전용 — 노력치 분배 */
  points?: EffortPoints;
}

export interface EffortPoints {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface UsageBlock {
  category: UsageCategory;
  entries: UsageEntry[];
}

export interface UsageReport {
  showdownId: string;
  pokemon: string;
  format: Format;
  season: string;
  /** Current 시즌은 빈 문자열로 온다 */
  date: string;
  sourcePath: string;
  blocks: UsageBlock[];
}

export interface CounterEntry {
  /** Showdown 표기. 예: Gyarados-Mega */
  smogonName: string;
  /** 매칭된 Champions 폼 savedName. 매칭 실패 시 null */
  championsSavedName: string | null;
  /** 매칭된 Champions 종 showdownId. 라우팅용. 매칭 실패 시 null */
  showdownId: string | null;
  /** 표본 크기 (n 가중 합산) */
  n: number;
  /** 매치업 우위 비율 0..1 */
  p: number;
  /** 표준편차 */
  d: number;
}

export interface CounterBlock {
  /** 이 블록이 어느 폼에 대한 것인지. Smogon 은 메가/지역폼을 별개로 집계한다. */
  targetSavedName: string;
  format: Format;
  /** Smogon 메타게임 식별자. 예: gen9championsbssregmb */
  metagame: string;
  cutoff: number;
  /** 합산에 쓰인 월 목록 */
  months: string[];
  battles: number;
  entries: CounterEntry[];
}

export interface BuildSet {
  id: string;
  title: string;
  season: string;
  format: Format;
  /** 파티 구성 — Champions savedName 기준 */
  pokemon: string[];
  items: string[];
  moves: string[];
  note: string;
  /** 원문 링크 — 필수 (설계 문서 6절) */
  sourceUrl: string;
  sourceLabel: string;
  translated: boolean;
}

export interface TrainerRankRow {
  rank: number;
  points: number | null;
  country: string | null;
  nickname: string;
  wins: number | null;
  losses: number | null;
  winRate: number | null;
  streak: number | null;
}

export interface RankingResult {
  rows: TrainerRankRow[];
  /** 공개 랭킹이 상위 N위까지만 존재함을 UI에 명시하기 위한 값 */
  coverageLimit: number | null;
  fetchedAt: string;
  stale: boolean;
}

/** 어댑터 실패를 앱 전체 실패로 번지지 않게 하는 공통 결과 타입 */
export type Loaded<T> =
  | { status: 'ok'; data: T; stale?: boolean }
  | { status: 'empty'; reason: string }
  | { status: 'error'; reason: string };
