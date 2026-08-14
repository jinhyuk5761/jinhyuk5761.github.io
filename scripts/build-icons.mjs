/**
 * PWA · Android 아이콘 생성 — 의존성 없이 PNG 를 직접 읽고 쓴다.
 *
 * sharp/canvas 같은 이미지 라이브러리를 넣지 않는 이유: 아이콘 몇 장 만들자고
 * 네이티브 빌드가 필요한 무거운 의존성을 들이면 설치가 환경을 탄다.
 * PNG 는 zlib 만 있으면 읽고 쓸 수 있다.
 *
 * 원본: assets/app-icon-source.png (검은 도형 + 흰 배경)
 * 산출: public/icon-192.png, icon-512.png, icon-maskable-512.png, favicon.png
 *
 * 원본을 도형의 경계까지 잘라낸 뒤 정사각형 가운데에 다시 앉힌다.
 * 원본의 여백이 제각각이라 그대로 줄이면 아이콘마다 크기가 달라 보인다.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public');
const SOURCE = path.join(ROOT, 'assets', 'app-icon-source.png');

/** 도형 뒤에 깔 배경. 원본이 흰 배경이라 그대로 흰색을 쓴다. */
const BACKGROUND = [255, 255, 255];

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

/**
 * PNG 디코더. 8비트 RGB/RGBA 무인터레이스만 다룬다 — 원본이 그 형식이고,
 * 아닌 파일이 들어오면 조용히 이상한 그림을 내는 대신 에러를 던진다.
 */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 가 아닙니다.');

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.slice(offset + 4, offset + 8).toString('ascii');
    const data = buffer.slice(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`8비트 채널만 지원합니다 (현재 ${data[8]}비트).`);
      colorType = data[9];
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`RGB/RGBA 만 지원합니다 (color type ${colorType}).`);
      }
      if (data[12] !== 0) throw new Error('인터레이스 PNG 는 지원하지 않습니다.');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);
  let p = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    raw.copy(line, 0, p, p + stride);
    p += stride;

    // 필터 해제. 사양 그대로다 (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth).
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = value & 0xff;
    }
    line.copy(prev);

    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
  }

  return { width, height, rgba: out };
}

/**
 * 도형이 실제로 차지하는 범위를 찾는다.
 *
 * 배경보다 뚜렷하게 어둡거나 반투명한 픽셀만 내용으로 친다.
 * JPEG 로 한 번 저장됐던 그림은 배경이 완전한 흰색이 아니라 249 근처라
 * 임계값을 넉넉히 잡아야 테두리의 압축 잡티를 내용으로 오인하지 않는다.
 */
function contentBounds(image) {
  const { width, height, rgba } = image;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const alpha = rgba[i + 3];
      const luma = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
      const isContent = alpha > 32 && luma < 200;
      if (!isContent) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error('내용을 찾지 못했습니다 — 원본이 비어 있나요?');
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * 잘라낸 도형을 정사각형 한가운데에 앉힌다.
 *
 * 축소는 면적 평균(box filter)으로 한다. 최근접으로 줄이면 가는 선이 끊겨
 * 작은 크기에서 도형이 부서진다.
 */
function render(image, bounds, size, padRatio) {
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    canvas[i * 4] = BACKGROUND[0];
    canvas[i * 4 + 1] = BACKGROUND[1];
    canvas[i * 4 + 2] = BACKGROUND[2];
    canvas[i * 4 + 3] = 255;
  }

  const box = Math.round(size * (1 - padRatio * 2));
  // 가로세로 비율을 지킨다. 늘리면 도형이 찌그러진다.
  const scale = Math.min(box / bounds.width, box / bounds.height);
  const drawW = Math.max(1, Math.round(bounds.width * scale));
  const drawH = Math.max(1, Math.round(bounds.height * scale));
  const offsetX = Math.round((size - drawW) / 2);
  const offsetY = Math.round((size - drawH) / 2);

  for (let y = 0; y < drawH; y += 1) {
    for (let x = 0; x < drawW; x += 1) {
      // 목적지 픽셀 하나가 원본에서 덮는 사각형을 평균낸다.
      const sx0 = bounds.minX + (x * bounds.width) / drawW;
      const sx1 = bounds.minX + ((x + 1) * bounds.width) / drawW;
      const sy0 = bounds.minY + (y * bounds.height) / drawH;
      const sy1 = bounds.minY + ((y + 1) * bounds.height) / drawH;

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.max(Math.ceil(sy1), Math.floor(sy0) + 1); sy += 1) {
        for (let sx = Math.floor(sx0); sx < Math.max(Math.ceil(sx1), Math.floor(sx0) + 1); sx += 1) {
          if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
          const i = (sy * image.width + sx) * 4;
          r += image.rgba[i];
          g += image.rgba[i + 1];
          b += image.rgba[i + 2];
          a += image.rgba[i + 3];
          n += 1;
        }
      }
      if (n === 0) continue;

      const src = a / n / 255;
      const dx = offsetX + x;
      const dy = offsetY + y;
      if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
      const d = (dy * size + dx) * 4;
      // 배경 위에 얹는다. 원본이 불투명이면 그대로 덮어쓰는 것과 같다.
      canvas[d] = Math.round((r / n) * src + canvas[d] * (1 - src));
      canvas[d + 1] = Math.round((g / n) * src + canvas[d + 1] * (1 - src));
      canvas[d + 2] = Math.round((b / n) * src + canvas[d + 2] * (1 - src));
      canvas[d + 3] = 255;
    }
  }

  return canvas;
}

function main() {
  const image = decodePng(readFileSync(SOURCE));
  const bounds = contentBounds(image);
  console.log(`원본 ${image.width}×${image.height} · 도형 ${bounds.width}×${bounds.height}`);

  const targets = [
    // 일반 아이콘은 여백을 좁게 — 런처가 그대로 보여준다.
    { file: 'icon-512.png', size: 512, pad: 0.1 },
    { file: 'icon-192.png', size: 192, pad: 0.1 },
    { file: 'favicon.png', size: 64, pad: 0.06 },
    // maskable 은 런처가 원/사각형으로 잘라낸다. 안전 영역(가운데 80%) 안에 넣어야 한다.
    { file: 'icon-maskable-512.png', size: 512, pad: 0.22 },
  ];

  for (const target of targets) {
    const rgba = render(image, bounds, target.size, target.pad);
    writeFileSync(path.join(OUT_DIR, target.file), encodePng(target.size, rgba));
    console.log(`  ${target.file} (${target.size}×${target.size}, 여백 ${target.pad * 100}%)`);
  }

  // Play 스토어 등록용 512×512 도 같은 그림으로 맞춘다.
  const storeDir = path.join(ROOT, 'android');
  writeFileSync(
    path.join(storeDir, 'store_icon.png'),
    encodePng(512, render(image, bounds, 512, 0.1)),
  );
  console.log('  android/store_icon.png (512×512)');
}

main();
