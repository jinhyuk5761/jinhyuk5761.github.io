/**
 * PWA 아이콘 생성 — 의존성 없이 PNG 를 직접 인코딩한다.
 *
 * sharp/canvas 같은 이미지 라이브러리를 넣지 않는 이유: 아이콘 몇 장 만들자고
 * 네이티브 빌드가 필요한 무거운 의존성을 추가할 이유가 없다. PNG 는
 * (IHDR + zlib deflate 한 IDAT + IEND) 구조라 직접 쓰는 편이 오히려 짧다.
 *
 * 도안: 앱의 핵심 화면인 '사용률 막대'를 그대로 마크로 쓴다.
 * 포켓볼 같은 상표 요소는 쓰지 않는다(설계 문서 6절 비제휴 원칙).
 *
 * 실행: npm run data:icons
 * 출력: public/icon-192.png, icon-512.png, icon-maskable-512.png, favicon.png
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** RGBA 픽셀 버퍼(size*size*4)를 PNG 로 인코딩한다. */
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10~12 = compression/filter/interlace, 전부 0

  // 스캔라인마다 필터 바이트(0 = None)를 앞에 붙인다.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createCanvas(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const put = (x, y, [r, g, b], a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    // 단순 알파 합성. 배경 위에 도형을 얹는 정도라 이 이상은 필요 없다.
    const src = a / 255;
    const dst = rgba[i + 3] / 255;
    const out = src + dst * (1 - src);
    if (out === 0) return;
    rgba[i] = Math.round((r * src + rgba[i] * dst * (1 - src)) / out);
    rgba[i + 1] = Math.round((g * src + rgba[i + 1] * dst * (1 - src)) / out);
    rgba[i + 2] = Math.round((b * src + rgba[i + 2] * dst * (1 - src)) / out);
    rgba[i + 3] = Math.round(out * 255);
  };
  return { rgba, put };
}

/** 안티에일리어싱된 둥근 사각형. 가장자리 1px 를 부분 알파로 채운다. */
function roundedRect(canvas, x0, y0, w, h, radius, color) {
  const x1 = x0 + w;
  const y1 = y0 + h;
  for (let y = Math.floor(y0) - 1; y <= Math.ceil(y1); y += 1) {
    for (let x = Math.floor(x0) - 1; x <= Math.ceil(x1); x += 1) {
      // 사각형 안쪽까지의 거리(모서리는 원호로 처리)
      const dx = Math.max(x0 + radius - x, 0, x - (x1 - radius));
      const dy = Math.max(y0 + radius - y, 0, y - (y1 - radius));
      const dist = Math.hypot(dx, dy);
      const coverage = Math.max(0, Math.min(1, radius + 0.5 - dist));
      const inside = x >= x0 - 1 && x <= x1 && y >= y0 - 1 && y <= y1;
      if (inside && coverage > 0) canvas.put(x, y, color, Math.round(coverage * 255));
    }
  }
}

const BG = [24, 28, 35]; // styles.css 의 --surface(다크)와 같은 계열
const TRACK = [45, 52, 64];
const BARS = [
  { ratio: 1.0, color: [122, 162, 247] }, // --accent
  { ratio: 0.72, color: [92, 132, 220] },
  { ratio: 0.46, color: [70, 104, 180] },
];

/**
 * @param size 한 변 픽셀
 * @param padRatio 아이콘 가장자리 여백 비율. maskable 은 크게 잡아야 잘려도 안전하다.
 * @param cornerRatio 모서리 반경 비율. maskable 은 배경을 꽉 채운다.
 */
function drawIcon(size, { padRatio, cornerRatio }) {
  const canvas = createCanvas(size);

  // 배경
  roundedRect(canvas, 0, 0, size, size, size * cornerRatio, BG);

  // 사용률 막대 3줄
  const pad = size * padRatio;
  const inner = size - pad * 2;
  const gap = inner * 0.14;
  const barH = (inner - gap * 2) / 3;
  const radius = barH / 2;

  BARS.forEach((bar, i) => {
    const y = pad + i * (barH + gap);
    // 막대가 놓이는 트랙 — styles.css 의 --surface-alt 계열
    roundedRect(canvas, pad, y, inner, barH, radius, TRACK);
    // 채워진 값 부분
    roundedRect(canvas, pad, y, Math.max(barH, inner * bar.ratio), barH, radius, bar.color);
  });

  return encodePng(size, canvas.rgba);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const targets = [
    // 일반 아이콘: 모서리를 둥글게 깎고 여백은 좁게.
    { file: 'icon-192.png', size: 192, padRatio: 0.22, cornerRatio: 0.22 },
    { file: 'icon-512.png', size: 512, padRatio: 0.22, cornerRatio: 0.22 },
    // maskable: 런처가 원형 등으로 잘라내므로 배경을 꽉 채우고 여백을 넉넉히.
    { file: 'icon-maskable-512.png', size: 512, padRatio: 0.3, cornerRatio: 0 },
    { file: 'favicon.png', size: 64, padRatio: 0.2, cornerRatio: 0.2 },
  ];

  for (const t of targets) {
    const png = drawIcon(t.size, { padRatio: t.padRatio, cornerRatio: t.cornerRatio });
    await writeFile(path.join(OUT_DIR, t.file), png);
    process.stdout.write(`생성 public/${t.file} — ${t.size}px, ${(png.length / 1024).toFixed(1)}KB\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`실패: ${err.stack ?? err}\n`);
  process.exitCode = 1;
});
