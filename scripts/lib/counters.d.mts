/**
 * scripts/lib/counters.mjs 의 타입 선언.
 * CLI 와 서버 자동 갱신이 공유하는 Smogon C&C 추출 로직.
 */

export type CounterFormat = 'Singles' | 'Doubles';

export interface CounterDatasetFile {
  format: CounterFormat;
  /** 합산에 쓴 Smogon 메타게임. 데이터가 없으면 null. */
  metagame: string | null;
  cutoff: number;
  months: string[];
  battles: number;
  generatedAt: string;
  targets: Record<string, { showdownId: string; entries: unknown[] }>;
  /** Champions 로스터와 못 맞춘 Showdown 표기 목록 */
  unmatched: string[];
}

export interface ChampionsFormRef {
  savedName: string;
  formName: string;
  slug: string;
  showdownId: string;
}

export declare const CUTOFF: number;
export declare const MONTHS_BACK: number;
export declare const FORMATS: CounterFormat[];
export declare const FORMAT_PREFIX: Record<CounterFormat, string>;

export declare function recentMonths(count?: number, now?: Date): string[];
export declare function listMetagames(month: string): Promise<Set<string>>;
export declare function pickMetagame(available: Set<string>, prefix: string): string | null;
export declare function loadChampionsForms(): Promise<ChampionsFormRef[]>;

export declare function buildCounterDataset(options: {
  format: CounterFormat;
  months: string[];
  cacheDir: string;
  log?: (msg: string) => void;
  forms?: ChampionsFormRef[];
}): Promise<CounterDatasetFile>;
