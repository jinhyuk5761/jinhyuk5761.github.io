/**
 * Smogon 카운터 자동 갱신.
 *
 * Smogon 은 매월 초에 지난달 통계를 올린다. 서버가 주기적으로 확인해서
 * **새 달(또는 새 규정)이 올라오면 재빌드·재배포 없이** 카운터를 다시 만든다.
 *
 * 산출물은 `var/data/` 에 쓴다. `dist/` 를 건드리지 않는 이유는 빌드 산출물과
 * 런타임 산출물을 섞으면 다음 배포가 조용히 덮어써 버리기 때문이다.
 * 읽을 때는 var/data → dist/data(번들 동봉본) 순으로 폴백한다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FORMATS,
  FORMAT_PREFIX,
  MONTHS_BACK,
  buildCounterDataset,
  listMetagames,
  loadChampionsForms,
  pickMetagame,
  recentMonths,
} from '../scripts/lib/counters.mjs';

/** 새 달 확인 주기. Smogon 갱신은 월 1회라 이보다 자주 볼 이유가 없다. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** 상류 장애가 이어질 때 재시도 최소 간격. */
const RETRY_BACKOFF_MS = 30 * 60 * 1000;

export function createCountersService(rootDir, log = () => {}) {
  const cacheDir = path.join(rootDir, '.cache', 'smogon');
  const runtimeDir = path.join(rootDir, 'var', 'data');
  const bundledDir = path.join(rootDir, 'dist', 'data');
  const publicDir = path.join(rootDir, 'public', 'data');

  /** @type {Map<string, object>} format → dataset */
  const memory = new Map();
  let lastCheckedAt = 0;
  let checking = false;

  function fileFor(dir, format) {
    return path.join(dir, `counters-${format.toLowerCase()}.json`);
  }

  /** var/data → dist/data → public/data 순으로 찾는다. */
  async function readFromDisk(format) {
    for (const dir of [runtimeDir, bundledDir, publicDir]) {
      try {
        return JSON.parse(await readFile(fileFor(dir, format), 'utf8'));
      } catch {
        // 다음 후보로 넘어간다.
      }
    }
    return null;
  }

  async function get(format) {
    const cached = memory.get(format);
    if (cached) return cached;
    const fromDisk = await readFromDisk(format);
    if (fromDisk) memory.set(format, fromDisk);
    return fromDisk;
  }

  /**
   * 지금 가진 데이터가 최신인지 확인한다.
   * 최신 규정이 바뀌었거나, 합산 대상 월이 더 생겼으면 낡은 것으로 본다.
   */
  async function findStaleFormats() {
    const months = recentMonths(MONTHS_BACK);
    const stale = [];

    for (const format of FORMATS) {
      const current = await get(format);
      let latestMetagame = null;
      const availableMonths = [];

      for (const month of months) {
        let available;
        try {
          available = await listMetagames(month);
        } catch {
          continue;
        }
        const picked = pickMetagame(available, FORMAT_PREFIX[format]);
        if (!picked) continue;
        if (latestMetagame === null) latestMetagame = picked;
        if (picked === latestMetagame) availableMonths.push(month);
      }

      if (!latestMetagame) continue;
      if (!current) {
        stale.push({ format, months });
        continue;
      }
      const changedRegulation = current.metagame !== latestMetagame;
      const newMonth = availableMonths.some((m) => !(current.months ?? []).includes(m));
      if (changedRegulation || newMonth) {
        log(
          `[counters] ${format} 갱신 필요 — ` +
            (changedRegulation
              ? `규정 ${current.metagame} → ${latestMetagame}`
              : `새 월 ${availableMonths.filter((m) => !(current.months ?? []).includes(m)).join(', ')}`),
        );
        stale.push({ format, months });
      }
    }
    return stale;
  }

  async function regenerate(format, months, forms) {
    const dataset = await buildCounterDataset({
      format,
      months,
      cacheDir,
      log: (msg) => log(`[counters] ${msg}`),
      forms,
    });
    if (!dataset.metagame) {
      log(`[counters] ${format} 재생성 결과가 비어 있어 기존 데이터를 유지합니다.`);
      return false;
    }
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(fileFor(runtimeDir, format), JSON.stringify(dataset));
    memory.set(format, dataset);
    log(
      `[counters] ${format} 갱신 완료 — ${dataset.metagame} (${dataset.months.join(', ')}), ` +
        `대상 ${Object.keys(dataset.targets).length}종, 미매칭 ${dataset.unmatched.length}건`,
    );
    return true;
  }

  /** 주기 확인. 이미 확인 중이거나 간격이 안 됐으면 아무것도 안 한다. */
  async function checkNow({ force = false } = {}) {
    if (checking) return false;
    const now = Date.now();
    if (!force && now - lastCheckedAt < CHECK_INTERVAL_MS) return false;

    checking = true;
    let changed = false;
    try {
      const stale = await findStaleFormats();
      if (stale.length > 0) {
        const forms = await loadChampionsForms();
        for (const { format, months } of stale) {
          changed = (await regenerate(format, months, forms)) || changed;
        }
      }
      lastCheckedAt = Date.now();
    } catch (err) {
      log(`[counters] 확인 실패: ${err.message}`);
      // 실패 시 곧바로 다시 시도하지 않도록 다음 확인 시각을 뒤로 민다.
      lastCheckedAt = Date.now() - CHECK_INTERVAL_MS + RETRY_BACKOFF_MS;
    } finally {
      checking = false;
    }
    return changed;
  }

  /** 백그라운드 주기 확인 시작. 프로세스 종료를 막지 않도록 unref 한다. */
  function start() {
    void checkNow({ force: true });
    const timer = setInterval(() => void checkNow(), CHECK_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  async function summary() {
    const out = {};
    for (const format of FORMATS) {
      const dataset = await get(format);
      out[format] = dataset
        ? {
            metagame: dataset.metagame,
            months: dataset.months ?? [],
            battles: dataset.battles ?? 0,
            generatedAt: dataset.generatedAt ?? null,
            targets: Object.keys(dataset.targets ?? {}).length,
          }
        : null;
    }
    return out;
  }

  return { get, checkNow, start, summary };
}
