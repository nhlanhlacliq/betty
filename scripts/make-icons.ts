/**
 * Draws Betty's app icons (the yellow companion: a gradient blob with two eyes) as PNGs for the web app manifest and
 * the iPhone home screen. No dependencies: shapes are sampled 4x4 per pixel and written with node:zlib.
 * Run: npx tsx scripts/make-icons.ts   (writes public/icons/*.png)
 */
import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync } from 'node:fs';

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const BG = hex('#f7f6f0'), EYE = hex('#716542');
const STOPS: Array<[number, RGB]> = [[0.03, hex('#fff4b9')], [0.55, hex('#f3da80')], [1, hex('#c9ae62')]];
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
function gradient(t: number): RGB {
  if (t <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) return mix(STOPS[i - 1][1], STOPS[i][1], (t - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
  return STOPS[STOPS.length - 1][1];
}

/** One icon. scale = how much of the square the companion fills (smaller for maskable icons). bg = opaque background. */
function draw(size: number, scale: number, bg: boolean): Buffer {
  const rx = 0.42 * scale, ry = 0.40 * scale, rot = (-8 * Math.PI) / 180;
  const eyeW = 0.053 * scale, eyeH = 0.094 * scale, eyeGap = 0.083 * scale;
  const px = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
      const u = (x + (sx + 0.5) / N) / size - 0.5, v = (y + (sy + 0.5) / N) / size - 0.5;
      const ru = u * Math.cos(rot) + v * Math.sin(rot), rv = -u * Math.sin(rot) + v * Math.cos(rot);
      let c: RGB | null = null;
      if ((ru / rx) ** 2 + (rv / ry) ** 2 <= 1) {
        const inEye = (cx: number) => Math.abs(u - cx) <= eyeW / 2 && Math.abs(v - 0.0) <= eyeH / 2;
        if (inEye(-eyeGap) || inEye(eyeGap)) c = EYE;
        else {
          const gx = (u + rx) / (2 * rx) - 0.32, gy = (v + ry) / (2 * ry) - 0.23;
          c = gradient(Math.min(1, Math.hypot(gx, gy) / 0.85));
        }
      } else if (bg) c = BG;
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
    }
    const i = (y * size + x) * 4, n = N * N;
    px[i] = a ? r / a : 0; px[i + 1] = a ? g / a : 0; px[i + 2] = a ? b / a : 0; px[i + 3] = Math.round((a / n) * 255);
  }
  return png(size, px);
}

function png(size: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../public/icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), draw(192, 1, false));
writeFileSync(new URL('icon-512.png', out), draw(512, 1, false));
writeFileSync(new URL('maskable-512.png', out), draw(512, 0.72, true)); // launchers crop to a circle or squircle: keep her in the safe zone
writeFileSync(new URL('apple-touch-icon.png', out), draw(180, 0.86, true)); // iPhone fills transparency with black
console.log('icons written');
