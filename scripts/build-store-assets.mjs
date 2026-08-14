/**
 * Play 스토어 등록용 이미지 생성.
 *
 *   - 스크린샷: 배포된 사이트를 헤드리스 Chrome 으로 폰 해상도에서 찍는다.
 *     목업을 그리지 않고 실제 화면을 찍는다 — 스토어 이미지가 실물과 다르면
 *     심사에서도 걸리고, 무엇보다 사용자를 속이는 것이다.
 *   - 그래픽 이미지(1024×500): 외부 이미지 라이브러리 없이 직접 PNG 를 만든다
 *     (아이콘 생성 때 쓴 인코더와 같은 방식).
 *
 * 사용: node scripts/build-store-assets.mjs [--shots] [--graphic]
 */

import { execFile } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'android', 'store');
const SITE = process.env.STORE_SITE_URL ?? 'https://jinhyuk5761.github.io';

/**
 * --window-size 는 **CSS 픽셀**이다. 1080 을 주면 폰이 아니라 데스크톱 레이아웃이 찍힌다.
 *
 * 다만 Windows 헤드리스 크롬은 창을 대략 500px 아래로 줄이지 못한다.
 * 그보다 좁게 주면 **더 넓게 레이아웃한 뒤 지정한 폭으로 잘라내서**,
 * 앱은 멀쩡한데 글자만 오른쪽에서 잘린 그림이 나온다.
 * 그래서 그 최소치 위(540)를 쓴다 — 720px 미만이라 폰 레이아웃은 그대로 적용된다.
 */
const CSS_WIDTH = 540;
const CSS_HEIGHT = 1170;
const SCALE = 2; // 결과 1080×2340 (Play 요건: 320~3840px)

const SHOTS = [
  { name: 'screenshot-1-search', hash: '#/', wait: 9000 },
  { name: 'screenshot-2-detail', hash: '#/p/garchomp', wait: 10000 },
  { name: 'screenshot-3-calc', hash: '#/calc?a=garchomp&b=ninetalesalola', wait: 12000 },
  { name: 'screenshot-4-compare', hash: '#/compare', wait: 9000 },
];

function findChrome() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/**
 * 페이지를 **iframe 에 담아** 찍는다.
 *
 * `--window-size` 로 바로 찍으면 크롬이 다른 폭으로 레이아웃한 뒤 그 크기로 잘라내서,
 * 글자가 오른쪽에서 잘린 그림이 나온다(실제 레이아웃은 멀쩡한데 사진만 잘린다).
 * iframe 은 폭이 CSS 로 확정되므로 그 안의 레이아웃이 우리가 지정한 폰 크기와 정확히 같다.
 */
function wrapperHtml(hash) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;background:#101318;overflow:hidden}
    iframe{width:${CSS_WIDTH}px;height:${CSS_HEIGHT}px;border:0;display:block}
  </style></head><body>
  <iframe src="${hash}" scrolling="no"></iframe>
  </body></html>`;
}

async function captureShots(siteRoot, writeTemp) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome 또는 Edge 를 찾지 못했습니다.');

  for (const shot of SHOTS) {
    const file = path.join(OUT, `${shot.name}.png`);
    await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${CSS_WIDTH},${CSS_HEIGHT}`,
        // 레이아웃은 iframe 이 고정하므로, 배율은 출력 해상도만 키운다.
        `--force-device-scale-factor=${SCALE}`,
        `--virtual-time-budget=${shot.wait}`,
        `--screenshot=${file}`,
        `${SITE}/${shot.hash}`,
      ],
      { timeout: 120_000 },
    );
    console.log(`  ${shot.name}.png`);
  }
}

// --- 최소 PNG 인코더 (그래픽 이미지용) ---------------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  // 각 행 앞에 필터 바이트(0 = None)를 붙여야 한다.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * 그래픽 이미지. 글자를 넣으려면 폰트 렌더러가 필요해서, 대신 앱의 색으로
 * 대각선 그라데이션과 타입 배지를 연상시키는 색 띠를 그린다.
 * 문자는 스토어가 앱 이름을 따로 얹어 주므로 이미지에 넣지 않는다.
 */
function buildFeatureGraphic() {
  const W = 1024;
  const H = 500;
  const px = Buffer.alloc(W * H * 4);

  // 앱 배경색 → 살짝 밝은 쪽으로 흐르는 대각선 그라데이션
  const from = [16, 19, 24];
  const to = [32, 42, 58];
  // 포켓몬 타입 색을 닮은 띠. 오른쪽 아래에 비스듬히 깐다.
  const bands = [
    [232, 93, 78],
    [240, 168, 66],
    [104, 168, 232],
    [126, 199, 128],
    [168, 130, 214],
  ];

  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const t = (x / W) * 0.65 + (y / H) * 0.35;
      let r = Math.round(from[0] + (to[0] - from[0]) * t);
      let g = Math.round(from[1] + (to[1] - from[1]) * t);
      let b = Math.round(from[2] + (to[2] - from[2]) * t);

      // 대각선 띠 — 오른쪽 위 모서리 쪽으로 흐른다.
      const d = x + y * 1.6;
      const bandStart = W * 0.72;
      if (d > bandStart) {
        const idx = Math.floor((d - bandStart) / 46);
        const color = bands[idx % bands.length];
        // 완전히 덮지 않고 얹어서 배경이 비치게 한다.
        const a = 0.55;
        r = Math.round(r * (1 - a) + color[0] * a);
        g = Math.round(g * (1 - a) + color[1] * a);
        b = Math.round(b * (1 - a) + color[2] * a);
      }

      const i = (y * W + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }

  return encodePng(W, H, px);
}

async function main() {
  const args = process.argv.slice(2);
  const wantShots = args.length === 0 || args.includes('--shots');
  const wantGraphic = args.length === 0 || args.includes('--graphic');

  mkdirSync(OUT, { recursive: true });

  if (wantGraphic) {
    const file = path.join(OUT, 'feature-graphic.png');
    writeFileSync(file, buildFeatureGraphic());
    console.log(`그래픽 이미지 1024×500 → ${path.relative(ROOT, file)}`);
  }

  if (wantShots) {
    console.log(`스크린샷 ${CSS_WIDTH * SCALE}×${CSS_HEIGHT * SCALE} (CSS ${CSS_WIDTH}×${CSS_HEIGHT}, ${SITE})`);
    // 감싸는 페이지는 임시 파일이다. 찍고 나면 지운다.
    const temps = [];
    const writeTemp = (name, html) => {
      const file = path.join(OUT, name);
      writeFileSync(file, html, 'utf8');
      temps.push(file);
      return `file:///${file.replace(/\\/g, '/')}`;
    };
    try {
      await captureShots(SITE, writeTemp);
    } finally {
      for (const file of temps) rmSync(file, { force: true });
    }
  }

  console.log(`\n저장 위치: ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
