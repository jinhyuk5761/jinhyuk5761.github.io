/**
 * USB 로 연결된 안드로이드 폰에 앱을 띄운다.
 *
 * 핵심은 `adb reverse` 다. 폰의 localhost:5173 요청을 USB 로 PC 의 5173 에 넘긴다.
 *   - Wi-Fi 도, 공인 IP 도, 방화벽 설정도 필요 없다.
 *   - 폰이 보기에 주소가 http://localhost 라서 **보안 컨텍스트**로 취급된다.
 *     서비스워커와 PWA 설치가 http 로도 동작하는 이유가 이것이다
 *     (http://192.168.x.x 로는 안 된다).
 *
 * 실행: npm run phone
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.PORT ?? 5173);

const log = (msg) => process.stdout.write(`${msg}\n`);

/** adb 를 PATH 와 표준 SDK 위치에서 찾는다. */
function findAdb() {
  const candidates = [
    process.env.ADB_PATH,
    'adb',
    path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', 'Android', 'Sdk', 'platform-tools', 'adb'),
    '/usr/local/bin/adb',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // 다음 후보
    }
  }
  return null;
}

function adb(adbPath, args) {
  return execFileSync(adbPath, args, { encoding: 'utf8' }).trim();
}

function listDevices(adbPath) {
  return adb(adbPath, ['devices'])
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return { serial, state };
    });
}

function main() {
  const adbPath = findAdb();
  if (!adbPath) {
    log('adb 를 찾지 못했습니다.');
    log('Android SDK Platform Tools 를 설치하거나 ADB_PATH 환경변수로 경로를 지정하세요.');
    process.exitCode = 1;
    return;
  }

  const devices = listDevices(adbPath);
  const ready = devices.filter((d) => d.state === 'device');

  if (ready.length === 0) {
    log('연결된 기기가 없습니다.');
    if (devices.some((d) => d.state === 'unauthorized')) {
      log('→ 폰 화면에 뜬 "USB 디버깅을 허용하시겠습니까?" 를 허용하세요.');
    } else {
      log('→ USB 케이블 연결 + 개발자 옵션 > USB 디버깅 활성화를 확인하세요.');
    }
    process.exitCode = 1;
    return;
  }
  if (ready.length > 1) {
    log(`기기가 여러 대입니다: ${ready.map((d) => d.serial).join(', ')}`);
    log('한 대만 연결한 뒤 다시 실행하세요.');
    process.exitCode = 1;
    return;
  }

  const serial = ready[0].serial;
  const model = (() => {
    try {
      return adb(adbPath, ['-s', serial, 'shell', 'getprop', 'ro.product.model']);
    } catch {
      return serial;
    }
  })();
  log(`기기: ${model} (${serial})`);

  if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) {
    log('dist/ 가 없습니다. 먼저 `npm run build` 를 실행하세요.');
    process.exitCode = 1;
    return;
  }

  // 폰의 localhost:PORT → PC 의 localhost:PORT
  adb(adbPath, ['-s', serial, 'reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
  log(`포트 전달 설정: 폰의 localhost:${PORT} → PC:${PORT}`);

  const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'inherit',
  });

  // 서버가 뜰 시간을 잠깐 준 뒤 폰 브라우저를 연다.
  setTimeout(() => {
    try {
      adb(adbPath, [
        '-s',
        serial,
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        `http://localhost:${PORT}`,
      ]);
      log('');
      log(`폰에서 브라우저를 열었습니다: http://localhost:${PORT}`);
      log('');
      log('홈 화면에 앱으로 설치하려면:');
      log('  삼성 인터넷 : 하단 ≡ 메뉴 > "현재 페이지 추가" > 홈 화면');
      log('  Chrome      : 우측 상단 ⋮ > "홈 화면에 추가" / "앱 설치"');
      log('');
      log('종료하려면 Ctrl+C. (포트 전달은 자동으로 해제됩니다)');
    } catch (err) {
      log(`폰 브라우저 자동 실행 실패: ${err.message}`);
      log(`폰 브라우저에서 직접 http://localhost:${PORT} 로 접속하세요.`);
    }
  }, 1500);

  const cleanup = () => {
    try {
      adb(adbPath, ['-s', serial, 'reverse', '--remove', `tcp:${PORT}`]);
      log('\n포트 전달을 해제했습니다.');
    } catch {
      // 기기가 이미 빠졌으면 해제할 것도 없다.
    }
    server.kill();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  server.on('exit', (code) => process.exit(code ?? 0));
}

main();
