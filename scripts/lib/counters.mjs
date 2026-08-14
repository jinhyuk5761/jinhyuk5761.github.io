/**
 * Smogon C&C 추출 로직 — CLI(`npm run data:counters`)와 서버 자동 갱신이 공유한다.
 *
 * 두 곳이 같은 코드를 써야 하는 이유: 서버가 새 달을 발견해 재생성한 결과와
 * 수동 생성 결과가 다르면, 어느 쪽이 맞는지 아무도 모르게 된다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { KNOWN_ABSENT, buildFormIndex, resolveSmogonName, toId } from '../../shared/names.mjs';

export const CUTOFF = 1500; // 설계 문서 3절 기준
export const MONTHS_BACK = 4;
const MAX_ENTRIES_PER_TARGET = 30;
/** 표본이 이보다 작은 매치업은 통계적으로 의미가 없어 버린다. */
const MIN_SAMPLE = 20;

/**
 * 포맷별 Smogon 메타게임 접두사.
 * 2026-08 확인: 싱글은 BSS(Reg M), 더블은 VGC 2026(Reg M). bo3/4v4uu 변종은 제외.
 */
export const FORMAT_PREFIX = {
  Singles: 'gen9championsbssregm',
  Doubles: 'gen9championsvgc2026regm',
};

export const FORMATS = ['Singles', 'Doubles'];

/** 통계는 월말에 확정되므로 지난달부터 거슬러 올라간다. */
export function recentMonths(count = MONTHS_BACK, now = new Date()) {
  const out = [];
  for (let i = 1; i <= count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function fetchText(url, timeoutMs = 300_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} @ ${url}`);
  return res.text();
}

/** 해당 월 chaos 디렉터리에 존재하는 메타게임 목록. */
export async function listMetagames(month) {
  const html = await fetchText(`https://www.smogon.com/stats/${month}/chaos/`, 60_000);
  const names = new Set();
  for (const m of html.matchAll(/href="([a-z0-9]+)-(\d+)\.json"/g)) {
    if (Number(m[2]) === CUTOFF) names.add(m[1]);
  }
  return names;
}

/**
 * 접두사에 맞는 메타게임 중 가장 최신 규정(알파벳 뒤쪽)을 고른다.
 * bo3 등 변종은 접두사 뒤에 한 글자만 오는 것으로 걸러낸다.
 */
export function pickMetagame(available, prefix) {
  const candidates = [...available].filter((n) => new RegExp(`^${prefix}[a-z]$`).test(n));
  candidates.sort();
  return candidates.at(-1) ?? null;
}

async function loadChaos(month, metagame, cacheDir, log) {
  await mkdir(cacheDir, { recursive: true });
  const cached = path.join(cacheDir, `${month}-${metagame}-${CUTOFF}.json`);
  if (existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8'));

  const url = `https://www.smogon.com/stats/${month}/chaos/${metagame}-${CUTOFF}.json`;
  log(`  다운로드 ${url}`);
  const text = await fetchText(url);
  await writeFile(cached, text);
  return JSON.parse(text);
}

/** championsbattledata 인덱스에서 폼 목록을 평탄화한다. */
export async function loadChampionsForms() {
  const res = await fetch('https://championsbattledata.com/api', {
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`champions index ${res.status}`);
  const index = await res.json();
  const forms = [];
  for (const entry of index?.pokemon ?? []) {
    for (const form of entry?.summary?.forms ?? []) {
      if (!form?.saved_name) continue;
      forms.push({
        savedName: form.saved_name,
        formName: form.form_name ?? form.saved_name,
        slug: form.slug ?? '',
        showdownId: entry.showdownId ?? '',
      });
    }
  }
  return forms;
}

/**
 * 여러 달의 C&C 를 n 가중 합산한다.
 * p 는 매치업 우위 비율이므로 단순 평균이 아니라 표본수 가중 평균이어야 한다.
 */
function mergeCounters(monthlyData) {
  const merged = new Map();
  for (const chaos of monthlyData) {
    for (const [target, stats] of Object.entries(chaos.data ?? {})) {
      const cc = stats?.['Checks and Counters'];
      if (!cc) continue;
      let bucket = merged.get(target);
      if (!bucket) {
        bucket = new Map();
        merged.set(target, bucket);
      }
      for (const [counter, raw] of Object.entries(cc)) {
        // chaos 포맷은 {n,p,d} 객체 또는 [n,p,d] 배열 두 가지가 관측된다.
        const n = Number(Array.isArray(raw) ? raw[0] : raw?.n);
        const p = Number(Array.isArray(raw) ? raw[1] : raw?.p);
        const d = Number(Array.isArray(raw) ? raw[2] : raw?.d);
        if (!Number.isFinite(n) || !Number.isFinite(p) || n <= 0) continue;
        const acc = bucket.get(counter) ?? { n: 0, pn: 0, dn: 0 };
        acc.n += n;
        acc.pn += p * n;
        acc.dn += (Number.isFinite(d) ? d : 0) * n;
        bucket.set(counter, acc);
      }
    }
  }
  return merged;
}

/**
 * 한 포맷의 카운터 데이터셋을 만든다.
 *
 * @param {object} options
 * @param {'Singles'|'Doubles'} options.format
 * @param {string[]} options.months 최신순 월 목록
 * @param {string} options.cacheDir chaos 원본 캐시 위치
 * @param {(msg: string) => void} [options.log]
 * @param {Array} [options.forms] 이미 받아둔 Champions 폼 목록 (재사용해 호출 절약)
 */
export async function buildCounterDataset({ format, months, cacheDir, log = () => {}, forms }) {
  log(`[${format}] 메타게임 탐색`);

  const perMonth = [];
  let metagame = null;

  for (const month of months) {
    let available;
    try {
      available = await listMetagames(month);
    } catch (err) {
      log(`  ${month}: 목록 실패 (${err.message})`);
      continue;
    }
    const picked = pickMetagame(available, FORMAT_PREFIX[format]);
    if (!picked) {
      log(`  ${month}: 해당 포맷 없음`);
      continue;
    }
    // 최신 규정을 기준으로 삼고, 규정이 다른 달은 섞지 않는다(룰이 다르면 메타도 다르다).
    if (metagame === null) metagame = picked;
    if (picked !== metagame) {
      log(`  ${month}: ${picked} — 규정이 달라 제외`);
      continue;
    }
    perMonth.push({ month, chaos: await loadChaos(month, picked, cacheDir, log) });
    log(`  ${month}: ${picked} 포함`);
  }

  if (perMonth.length === 0) {
    return {
      format,
      metagame: null,
      cutoff: CUTOFF,
      months: [],
      battles: 0,
      generatedAt: new Date().toISOString(),
      targets: {},
      unmatched: [],
    };
  }

  const formIndex = buildFormIndex(forms ?? (await loadChampionsForms()));
  const merged = mergeCounters(perMonth.map((m) => m.chaos));

  const targets = {};
  const unmatched = new Set();
  /** Champions 로스터에 없는 폼은 매칭 실패가 정상이라 경고하지 않는다. */
  const noteUnmatched = (name) => {
    if (!KNOWN_ABSENT.has(toId(name))) unmatched.add(name);
  };

  for (const [targetName, bucket] of merged) {
    const targetForm = resolveSmogonName(targetName, formIndex);
    if (!targetForm) {
      noteUnmatched(targetName);
      continue;
    }
    const entries = [];
    for (const [counterName, acc] of bucket) {
      if (acc.n < MIN_SAMPLE) continue;
      const p = acc.pn / acc.n;
      const d = acc.dn / acc.n;
      const counterForm = resolveSmogonName(counterName, formIndex);
      if (!counterForm) noteUnmatched(counterName);
      entries.push({
        s: counterName,
        c: counterForm?.savedName ?? null,
        i: counterForm?.showdownId ?? null,
        n: Math.round(acc.n),
        p: Number(p.toFixed(4)),
        d: Number(d.toFixed(4)),
        // 95% 하한. 표본이 적은 매치업이 상위를 차지하지 않도록 이 값으로 정렬한다.
        lb: Number(Math.max(0, p - 1.96 * d).toFixed(4)),
      });
    }
    entries.sort((a, b) => b.lb - a.lb);
    targets[targetForm.savedName] = { showdownId: targetForm.showdownId, entries: entries.slice(0, MAX_ENTRIES_PER_TARGET) };
  }

  return {
    format,
    metagame,
    cutoff: CUTOFF,
    months: perMonth.map((m) => m.month),
    battles: perMonth.reduce(
      (sum, m) => sum + (Number(m.chaos?.info?.['number of battles']) || 0),
      0,
    ),
    generatedAt: new Date().toISOString(),
    targets,
    unmatched: [...unmatched].sort(),
  };
}
