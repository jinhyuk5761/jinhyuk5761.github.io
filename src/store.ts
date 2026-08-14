/**
 * 앱 상태. 검색·선택·포맷 토글 정도라 가벼운 구독 스토어면 충분하다(설계 문서 7절).
 *
 * 인덱스와 로케일은 앱 수명 동안 한 번만 로드한다. 로케일 로딩이 실패해도
 * 인덱스만으로 앱은 완전히 동작해야 한다 — 어댑터 격리 원칙.
 *
 * config 는 다르다. **주기적으로 다시 확인한다.** 서버에 새 데이터가 붙으면
 * (구축 파일 수정, 새 달 Smogon 통계, 랭킹 URL 활성화) 새로고침 없이 화면에 반영되어야 하기 때문.
 */

import { fetchIndex, type ChampionsIndex } from './adapters/championsBattleData';
import { OFFLINE_CONFIG, fetchAppConfig, type AppConfig } from './adapters/appConfig';
import { applyLocales, fetchLocales, type LocaleMap } from './adapters/pokeApi';
import { fetchTermDex, type TermDex } from './adapters/termDex';
import type { Format } from './types';

export interface AppState {
  format: Format;
  index: ChampionsIndex | null;
  locales: LocaleMap;
  /** 타입·도구·특성·성격의 한국어 명칭. 없으면 영문으로 열화한다. */
  terms: TermDex | null;
  config: AppConfig;
  /** 인덱스 로딩 실패 사유. 이게 차면 앱의 코어가 죽은 것이라 전면 안내한다. */
  indexError: string | null;
  /** 로케일만 실패한 경우. 검색이 영문만 되는 정도의 열화라 배너로만 알린다. */
  localeDegraded: boolean;
  ready: boolean;
}

const STORAGE_KEY = 'pcm:prefs';
/** 새 데이터가 붙었는지 확인하는 주기. */
const CONFIG_POLL_MS = 60_000;

function loadFormat(): Format {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { format?: string };
      return parsed.format === 'Doubles' ? 'Doubles' : 'Singles';
    }
  } catch {
    // 저장값이 깨졌으면 기본값으로 간다.
  }
  return 'Singles';
}

export const state: AppState = {
  format: loadFormat(),
  index: null,
  locales: new Map(),
  terms: null,
  config: OFFLINE_CONFIG,
  indexError: null,
  localeDegraded: false,
  ready: false,
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function setFormat(format: Format): void {
  if (state.format === format) return;
  state.format = format;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ format }));
  } catch {
    // 저장 실패는 기능에 영향 없다.
  }
  emit();
}

/** 앱 부팅. 인덱스는 필수, 로케일과 config 는 선택적 보강이다. */
export async function bootstrap(): Promise<void> {
  const [indexResult, localeResult, configResult, termResult] = await Promise.allSettled([
    fetchIndex(),
    fetchLocales(),
    fetchAppConfig(),
    // 타입 배지가 검색 목록부터 한국어로 나와야 해서 부팅 때 함께 받는다 (47KB).
    fetchTermDex(),
  ]);

  if (indexResult.status === 'fulfilled') {
    state.index = indexResult.value;
  } else {
    state.indexError =
      indexResult.reason instanceof Error
        ? indexResult.reason.message
        : '포켓몬 인덱스를 불러오지 못했습니다.';
  }

  if (localeResult.status === 'fulfilled') {
    state.locales = localeResult.value;
  } else {
    state.localeDegraded = true;
  }

  if (configResult.status === 'fulfilled') state.config = configResult.value;

  if (termResult.status === 'fulfilled' && termResult.value.status === 'ok') {
    state.terms = termResult.value.data;
  }

  if (state.index) applyLocales(state.index.pokemon, state.locales);

  state.ready = true;
  emit();

  startConfigPolling();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * config 를 주기적으로 확인해 버전이 바뀌면 화면을 다시 그린다.
 * 데이터 URL 에 버전이 실려 있으므로, 다시 그리는 것만으로 새 데이터를 받아온다.
 */
export function startConfigPolling(intervalMs = CONFIG_POLL_MS): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => {
    void fetchAppConfig().then((next) => {
      if (next.version === state.config.version && next.serverBacked === state.config.serverBacked) {
        return;
      }
      state.config = next;
      emit();
    });
  }, intervalMs);
}

export function stopConfigPolling(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

export function findPokemon(showdownId: string) {
  return state.index?.byShowdownId.get(showdownId) ?? null;
}
