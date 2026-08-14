/**
 * 기술 도감 — 한국어 기술명, 위력·PP·명중률, 게임 내 설명.
 *
 * 출처는 PokéAPI 다 (scripts/build-moves.mjs 가 빌드타임에 뽑아둔다).
 * 나무위키를 쓰지 않은 이유는 그 스크립트 주석 참고 — 라이선스와 접근 문제다.
 *
 * 키는 **Champions 표기 영문 기술명**이다. 사용률 데이터와 learnset 이 그 이름을
 * 쓰기 때문에, 다른 키를 쓰면 매번 변환해야 한다.
 *
 * 199KB 라 부팅 때 받지 않고, 기술이 실제로 필요한 화면에서 지연 로드한다.
 */

import { TTL, fetchJson } from '../core/http';
import type { Loaded, TypeName } from '../types';

interface RawMove {
  n?: string;
  ko?: string | null;
  ja?: string | null;
  type?: string | null;
  cls?: string | null;
  pow?: number | null;
  acc?: number | null;
  pp?: number | null;
  pri?: number;
  tgt?: string | null;
  desc?: string | null;
  descEn?: string | null;
  sc?: [string, number][];
  ec?: number | null;
  ail?: string | null;
  ailc?: number;
  statc?: number;
  flinch?: number;
  crit?: number;
  drain?: number;
  heal?: number;
  hits?: [number, number] | null;
  turns?: [number, number] | null;
  flags?: string[];
  varPow?: string | null;
  varNote?: string | null;
  varType?: string | null;
  varTypeNote?: string | null;
  effQuirk?: string | null;
  effQuirkNote?: string | null;
}

interface RawMoveFile {
  generatedAt?: string;
  moves?: Record<string, RawMove>;
}

export type DamageClass = 'physical' | 'special' | 'status';

export interface MoveInfo {
  /** Champions 표기 영문명. 라우팅·매칭 키. */
  englishName: string;
  /** 화면 표시명. 한국어가 없으면 영문으로 폴백. */
  displayName: string;
  koreanName: string | null;
  japaneseName: string | null;
  type: TypeName | null;
  damageClass: DamageClass | null;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  target: string | null;
  /** 게임 내 설명 */
  description: string | null;
  /** 설명이 한국어가 아니라 영어 폴백인지 — UI 가 라벨을 붙일 수 있게 */
  descriptionIsFallback: boolean;

  // --- 정밀 효과 원자료. "크게 올린다" 를 "공격 +2랭크" 로 바꾸는 데 쓴다. ---
  /** [스탯 slug, 랭크 변화]. 예: [['attack', 2]] */
  statChanges: [string, number][];
  /** 랭크 변화 확률(%). 0 또는 100 이면 확정. */
  statChance: number;
  ailment: string | null;
  ailmentChance: number;
  flinchChance: number;
  critRate: number;
  /** 양수는 흡수, 음수는 반동 (입힌 데미지 대비 %) */
  drain: number;
  /** 최대 HP 대비 회복 % */
  healing: number;
  hits: [number, number] | null;
  turns: [number, number] | null;
  /**
   * 기술 플래그 (contact/punch/sound/bite/pulse/bullet/slicing/wind/powder).
   * 출처는 Pokémon Showdown — PokéAPI 는 이 정보를 주지 않는다.
   * 철주먹·단단한발톱 같은 특성 판정에 쓴다.
   */
  flags: Set<string>;
  /**
   * 위력이 상황에 따라 달라지는 기술의 공식 식별자. 고정 위력이면 null.
   * 'manual' 은 계산기가 가진 입력만으로는 확정할 수 없어 직접 입력을 받는다는 뜻.
   */
  variablePower: string | null;
  /** 무엇에 따라 달라지는지 한 줄 설명. 화면에 그대로 보여준다. */
  variablePowerNote: string | null;
  /** 타입이 상황에 따라 바뀌는 기술의 식별자 (웨더볼 등). */
  variableType: string | null;
  variableTypeNote: string | null;
  /** 타입표만으로 안 맞는 기술의 식별자 (프리즈드라이 등). */
  effectivenessQuirk: string | null;
  effectivenessQuirkNote: string | null;
}

export type MoveDex = Map<string, MoveInfo>;

const DAMAGE_CLASSES: DamageClass[] = ['physical', 'special', 'status'];

function toTypeName(raw: string | null | undefined): TypeName | null {
  if (!raw) return null;
  // PokéAPI 는 소문자 slug, 앱은 첫 글자 대문자를 쓴다.
  return (raw.charAt(0).toUpperCase() + raw.slice(1)) as TypeName;
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [min, max] = value;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  return [min, max];
}

export function normalizeMoves(raw: RawMoveFile): MoveDex {
  const dex: MoveDex = new Map();

  for (const [key, move] of Object.entries(raw?.moves ?? {})) {
    if (!key) continue;
    const englishName = move?.n ?? key;
    const koreanName = move?.ko ?? null;
    const description = move?.desc ?? move?.descEn ?? null;

    dex.set(key, {
      englishName,
      displayName: koreanName ?? englishName,
      koreanName,
      japaneseName: move?.ja ?? null,
      type: toTypeName(move?.type),
      damageClass: DAMAGE_CLASSES.includes(move?.cls as DamageClass)
        ? (move?.cls as DamageClass)
        : null,
      power: typeof move?.pow === 'number' ? move.pow : null,
      accuracy: typeof move?.acc === 'number' ? move.acc : null,
      pp: typeof move?.pp === 'number' ? move.pp : null,
      priority: typeof move?.pri === 'number' ? move.pri : 0,
      target: move?.tgt ?? null,
      description,
      // 한국어 설명이 없어서 영어로 채운 경우 (9세대 신규 기술이 여기 해당한다)
      descriptionIsFallback: !move?.desc && Boolean(move?.descEn),
      statChanges: Array.isArray(move?.sc)
        ? move.sc.filter(
            (c): c is [string, number] =>
              Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'number',
          )
        : [],
      statChance: num(move?.statc),
      ailment: move?.ail ?? null,
      ailmentChance: num(move?.ailc),
      flinchChance: num(move?.flinch),
      critRate: num(move?.crit),
      drain: num(move?.drain),
      healing: num(move?.heal),
      hits: pair(move?.hits),
      turns: pair(move?.turns),
      flags: new Set(Array.isArray(move?.flags) ? move.flags.filter((f) => typeof f === 'string') : []),
      variablePower: move?.varPow ?? null,
      variablePowerNote: move?.varNote ?? null,
      variableType: move?.varType ?? null,
      variableTypeNote: move?.varTypeNote ?? null,
      effectivenessQuirk: move?.effQuirk ?? null,
      effectivenessQuirkNote: move?.effQuirkNote ?? null,
    });
  }

  return dex;
}

let cached: Promise<Loaded<MoveDex>> | null = null;

/**
 * 기술 도감. 실패해도 throw 하지 않는다 — 기술명이 영문으로 나올 뿐
 * 사용률·카운터 화면은 정상 동작해야 한다.
 */
export function fetchMoveDex(): Promise<Loaded<MoveDex>> {
  if (cached) return cached;

  cached = (async (): Promise<Loaded<MoveDex>> => {
    try {
      const { data } = await fetchJson<RawMoveFile>(`${import.meta.env.BASE_URL}data/moves.json`, {
        ttlMs: TTL.buildArtifact,
        timeoutMs: 20_000,
      });
      const dex = normalizeMoves(data);
      if (dex.size === 0) return { status: 'empty', reason: '기술 데이터가 비어 있습니다.' };
      return { status: 'ok', data: dex };
    } catch (err) {
      return {
        status: 'error',
        reason: err instanceof Error ? err.message : '기술 데이터를 불러오지 못했습니다.',
      };
    }
  })();

  return cached;
}

/** 도감이 없거나 못 찾은 기술은 영문명을 그대로 쓴다. 이름을 지어내지 않는다. */
export function moveDisplayName(dex: MoveDex | null, englishName: string): string {
  return dex?.get(englishName)?.displayName ?? englishName;
}

export const DAMAGE_CLASS_LABEL: Record<DamageClass, string> = {
  physical: '물리',
  special: '특수',
  status: '변화',
};
