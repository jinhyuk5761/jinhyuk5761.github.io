/**
 * M3 데이터 준비 CLI — Smogon chaos 에서 Checks & Counters 를 뽑아 압축한다.
 *
 * 추출 로직 자체는 scripts/lib/counters.mjs 에 있다. 서버의 자동 갱신이
 * 같은 코드를 쓰기 때문에, 수동 생성 결과와 자동 갱신 결과가 갈라지지 않는다.
 *
 * 실행: npm run data:counters
 * 출력: public/data/counters-singles.json, public/data/counters-doubles.json
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FORMATS,
  MONTHS_BACK,
  buildCounterDataset,
  loadChampionsForms,
  recentMonths,
} from './lib/counters.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(ROOT, '.cache', 'smogon');
const OUT_DIR = path.join(ROOT, 'public', 'data');

const log = (msg) => process.stdout.write(`${msg}\n`);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const months = recentMonths(MONTHS_BACK);
  log(`대상 월: ${months.join(', ')}`);

  // 폼 목록은 포맷마다 같으므로 한 번만 받아 재사용한다.
  const forms = await loadChampionsForms();

  for (const format of FORMATS) {
    log('');
    const result = await buildCounterDataset({ format, months, cacheDir: CACHE_DIR, log, forms });
    const file = path.join(OUT_DIR, `counters-${format.toLowerCase()}.json`);
    await writeFile(file, JSON.stringify(result));

    const targetCount = Object.keys(result.targets).length;
    log(
      `[${format}] 저장 ${path.relative(ROOT, file)} — 대상 ${targetCount}종, ` +
        `미매칭 ${result.unmatched.length}건`,
    );
    if (result.unmatched.length > 0) log(`  미매칭: ${result.unmatched.join(', ')}`);
  }
}

main().catch((err) => {
  process.stderr.write(`실패: ${err.stack ?? err}\n`);
  process.exitCode = 1;
});
