/**
 * M5 데이터 준비 — 큐레이션 입력을 검증해서 public/data/builds.json 으로 내보낸다.
 *
 * 이 스크립트는 수집기가 아니라 **검증기**다. 설계 문서 6절의 출처 강제 규칙을
 * 런타임이 아니라 빌드타임에 먼저 걸어, 규칙을 어긴 항목이 배포에 섞이지 않게 한다.
 *
 * 왜 크롤링하지 않는가: champs.pokedb.tokyo 를 비롯한 대상들이 자동 요청에 403 을
 * 돌려준다(2026-08 확인). 차단을 우회하는 대신 사람이 옮겨 적는 경로를 택했다.
 * data/README.md 참고.
 *
 * 실행: npm run data:builds
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { toId } from '../shared/names.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'data', 'frozen-season.source.json');
const OUT = path.join(ROOT, 'public', 'data', 'builds.json');

/** 설계 문서 M5: 본문 탑재 제외 호스트. */
const EXCLUDED_HOSTS = ['x.com', 'twitter.com', 'youtube.com', 'youtu.be', 'm.youtube.com'];

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** 로스터 대조용 — 표시명과 savedName 양쪽을 키로 잡는다. */
async function loadRosterNames() {
  try {
    const res = await fetch('https://championsbattledata.com/api', {
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const index = await res.json();
    const names = new Set();
    for (const entry of index?.pokemon ?? []) {
      if (entry?.name) names.add(toId(entry.name));
      for (const form of entry?.summary?.forms ?? []) {
        if (form?.saved_name) names.add(toId(form.saved_name));
      }
    }
    return names;
  } catch (err) {
    process.stdout.write(`로스터 대조 생략 (인덱스 조회 실패: ${err.message})\n`);
    return null;
  }
}

async function main() {
  await mkdir(path.dirname(OUT), { recursive: true });

  if (!existsSync(SOURCE)) {
    process.stdout.write(`${path.relative(ROOT, SOURCE)} 가 없어 빈 목록을 씁니다.\n`);
    await writeFile(OUT, '[]');
    return;
  }

  let raw;
  try {
    raw = JSON.parse(await readFile(SOURCE, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(ROOT, SOURCE)} 파싱 실패: ${err.message}`);
  }
  if (!Array.isArray(raw)) throw new Error('최상위는 배열이어야 합니다.');

  const roster = raw.length > 0 ? await loadRosterNames() : null;

  const accepted = [];
  const rejected = [];
  const warnings = [];

  raw.forEach((item, i) => {
    const label = item?.title || item?.id || `#${i}`;

    if (!item?.sourceUrl) {
      rejected.push(`${label}: sourceUrl 없음 — 출처 없는 구축은 싣지 않습니다.`);
      return;
    }
    const host = hostOf(item.sourceUrl);
    if (!host) {
      rejected.push(`${label}: sourceUrl 이 올바른 URL 이 아닙니다 (${item.sourceUrl}).`);
      return;
    }
    if (EXCLUDED_HOSTS.includes(host)) {
      rejected.push(`${label}: ${host} 링크는 본문 탑재 제외 대상입니다.`);
      return;
    }
    if (!item?.title) {
      rejected.push(`${label}: title 없음.`);
      return;
    }

    if (roster) {
      for (const name of item.pokemon ?? []) {
        if (!roster.has(toId(name))) {
          warnings.push(`${label}: '${name}' 을 로스터에서 찾지 못했습니다 (오타 확인).`);
        }
      }
    }

    accepted.push({
      id: item.id ?? `${item.season ?? 'season'}-${i}`,
      title: item.title,
      season: item.season ?? '',
      format: item.format === 'Doubles' ? 'Doubles' : 'Singles',
      pokemon: (item.pokemon ?? []).filter(Boolean),
      items: (item.items ?? []).filter(Boolean),
      moves: (item.moves ?? []).filter(Boolean),
      note: item.note ?? '',
      sourceUrl: item.sourceUrl,
      sourceLabel: item.sourceLabel || host,
      translated: item.translated === true,
    });
  });

  await writeFile(OUT, JSON.stringify(accepted));

  process.stdout.write(`저장 ${path.relative(ROOT, OUT)} — 채택 ${accepted.length}건\n`);
  for (const message of warnings) process.stdout.write(`  경고: ${message}\n`);
  for (const message of rejected) process.stdout.write(`  제외: ${message}\n`);
  if (accepted.length === 0) {
    process.stdout.write(
      '  (비어 있음 — M5 화면은 안내문으로 degrade 합니다. data/README.md 참고)\n',
    );
  }
}

main().catch((err) => {
  process.stderr.write(`실패: ${err.stack ?? err}\n`);
  process.exitCode = 1;
});
