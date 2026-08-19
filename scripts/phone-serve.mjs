/**
 * USB 로 연결한 폰에서 개발 서버를 보게 한다.
 *
 * 와이파이로 붙이려면 세 가지가 다 맞아야 한다 — 방화벽이 열려 있고, 네트워크가
 * Public 이 아니고, 공유기가 기기 간 통신을 막지 않아야 한다. 회사망에서는
 * 마지막 하나가 대개 막혀 있어서 손을 쓸 수가 없다.
 *
 * `adb reverse` 는 그 셋을 전부 비켜간다. 폰의 localhost:5173 으로 온 요청을
 * USB 케이블을 타고 PC 의 5173 으로 넘긴다. 덤으로 localhost 는 보안 컨텍스트라
 * 서비스워커도 그대로 동작한다.
 *
 * 실행: npm run phone:serve   (먼저 다른 창에서 npm run dev 를 켜 둘 것)
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 5173;

/** SDK 를 어디에 깔았든 찾도록 흔한 자리를 훑는다. */
function findAdb() {
  const candidates = [
    process.env.ADB_PATH,
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
    'adb',
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'adb' || existsSync(c)) return c;
  }
  return null;
}

const adb = findAdb();
if (!adb) {
  console.error('adb 를 찾지 못했습니다. ADB_PATH 환경변수로 경로를 알려주세요.');
  process.exit(1);
}

const run = (...args) => execFileSync(adb, args, { encoding: 'utf8' });

const devices = run('devices')
  .split('\n')
  .slice(1)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('*'));

const ready = devices.filter((l) => l.endsWith('device'));
if (ready.length === 0) {
  console.error('연결된 폰이 없습니다.');
  console.error('  1) USB 로 연결');
  console.error('  2) 폰에서 개발자 옵션 > USB 디버깅 켜기');
  console.error('  3) 폰에 뜨는 "USB 디버깅을 허용하시겠습니까?" 에서 허용');
  if (devices.length > 0) console.error(`\n지금 상태: ${devices.join(' / ')}`);
  process.exit(1);
}

run('reverse', `tcp:${PORT}`, `tcp:${PORT}`);

console.log(`연결됨: ${ready[0]}`);
console.log(`\n폰 브라우저에서 열어 주세요:  http://localhost:${PORT}`);
console.log('\n(다른 창에서 npm run dev 가 켜져 있어야 합니다.)');
console.log('되돌리기: adb reverse --remove-all');
