import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve(process.cwd(), 'public', 'icons');
mkdirSync(outputDir, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function roundedRectContains(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.max(left + radius, Math.min(x, right - radius));
  const cy = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  const sx = x1 + t * dx;
  const sy = y1 + t * dy;
  return Math.hypot(px - sx, py - sy);
}

function drawIcon(size) {
  const scale = 4;
  const pixel = (x, y) => {
    const u = (x + 0.5) / (size * scale);
    const v = (y + 0.5) / (size * scale);
    const s = size * scale;

    // Rounded navy tile with a blue-to-cyan gradient.
    if (!roundedRectContains(x, y, 0.04 * s, 0.04 * s, 0.96 * s, 0.96 * s, 0.22 * s)) {
      return [0, 0, 0, 0];
    }
    const gradient = Math.max(0, Math.min(1, (u + v) / 2));
    let r = Math.round(11 + 13 * gradient);
    let g = Math.round(23 + 85 * gradient);
    let b = Math.round(46 + 165 * gradient);

    // Subtle diagonal glow.
    const glow = Math.max(0, 1 - Math.abs(u - v) * 7) * 0.16;
    r = Math.min(255, Math.round(r + 25 * glow));
    g = Math.min(255, Math.round(g + 80 * glow));
    b = Math.min(255, Math.round(b + 120 * glow));

    // Down-flow arrow.
    const cx = 0.5 * s;
    const shaftTop = 0.23 * s;
    const shaftBottom = 0.61 * s;
    const halfShaft = 0.075 * s;
    const inShaft = Math.abs(x - cx) <= halfShaft && y >= shaftTop && y <= shaftBottom;
    const headLeft = distanceToSegment(x, y, cx, 0.62 * s, 0.29 * s, 0.46 * s);
    const headRight = distanceToSegment(x, y, cx, 0.62 * s, 0.71 * s, 0.46 * s);
    const inHead = (x >= 0.29 * s && x <= 0.71 * s && y >= 0.45 * s && y <= 0.67 * s) &&
      ((x < cx && headLeft < 0.105 * s) || (x >= cx && headRight < 0.105 * s)) &&
      y >= 0.46 * s;
    // Fill the triangle more reliably.
    const arrowHalfWidth = Math.max(0, (0.67 * s - y) * 0.96);
    const inTriangle = y >= 0.46 * s && y <= 0.67 * s && Math.abs(x - cx) <= arrowHalfWidth;

    if (inShaft || inHead || inTriangle) {
      const t = (y - 0.2 * s) / (0.5 * s);
      return [
        Math.round(239 + 16 * t),
        Math.round(248 + 7 * t),
        255,
        255,
      ];
    }

    // Three flow lines under the arrow.
    for (let line = 0; line < 3; line++) {
      const yPos = (0.77 + line * 0.055) * s;
      const width = (0.28 - line * 0.055) * s;
      if (Math.abs(y - yPos) < 0.017 * s && Math.abs(x - cx) < width) {
        return [96, 165, 250, Math.round(210 - line * 35)];
      }
    }
    return [r, g, b, 255];
  };

  const samples = size * scale;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          const [pr, pg, pb, pa] = pixel(x * scale + sx, y * scale + sy);
          const alpha = pa / 255;
          r += pr * alpha;
          g += pg * alpha;
          b += pb * alpha;
          a += pa;
        }
      }
      const count = scale * scale;
      const alpha = a / count;
      const index = y * (size * 4 + 1) + 1 + x * 4;
      raw[index] = alpha > 0 ? Math.round(r / (a / 255 || 1)) : 0;
      raw[index + 1] = alpha > 0 ? Math.round(g / (a / 255 || 1)) : 0;
      raw[index + 2] = alpha > 0 ? Math.round(b / (a / 255 || 1)) : 0;
      raw[index + 3] = Math.round(alpha);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(outputDir, `icon-${size}.png`), drawIcon(size));
  console.log(`Generated icon-${size}.png`);
}
