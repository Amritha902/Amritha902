/*
 * Generates PromptComplete's PNG icons (16/32/48/128) with no image libraries.
 * Draws a rounded coral tile with a "typed bar + ghost continuation + cursor"
 * glyph — a literal picture of inline autocomplete.
 *
 *   node tools/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(outDir, { recursive: true });

// --- CRC32 + PNG chunk writer -------------------------------------------
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // filter byte 0 per scanline
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// --- Drawing helpers -----------------------------------------------------
function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function drawIcon(S) {
  const buf = Buffer.alloc(S * S * 4);
  const radius = S * 0.22;
  const top = [0xe0, 0x8a, 0x6e]; // warm coral
  const bot = [0xc0, 0x60, 0x40]; // deeper terracotta

  const inRounded = (x, y) => {
    const r = radius;
    if (x >= r && x <= S - r) return y >= 0 && y <= S;
    if (y >= r && y <= S - r) return x >= 0 && x <= S;
    // corners
    const cx = x < r ? r : S - r;
    const cy = y < r ? r : S - r;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  const put = (x, y, rgb, a) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const bg = [buf[i], buf[i + 1], buf[i + 2]];
    const out = mix(bg, rgb, a);
    buf[i] = out[0];
    buf[i + 1] = out[1];
    buf[i + 2] = out[2];
    buf[i + 3] = Math.max(buf[i + 3], Math.round(a * 255));
  };

  // Background tile.
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!inRounded(x + 0.5, y + 0.5)) continue;
      const rgb = mix(top, bot, y / S);
      const i = (y * S + x) * 4;
      buf[i] = rgb[0];
      buf[i + 1] = rgb[1];
      buf[i + 2] = rgb[2];
      buf[i + 3] = 255;
    }
  }

  // Glyph: a solid "typed" bar, a translucent "ghost" continuation, a cursor.
  const barY0 = Math.round(S * 0.44);
  const barY1 = Math.round(S * 0.56);
  const white = [255, 251, 246];

  const bar = (x0, x1, alpha) => {
    for (let y = barY0; y < barY1; y++)
      for (let x = x0; x < x1; x++) put(x, y, white, alpha);
  };

  bar(Math.round(S * 0.2), Math.round(S * 0.48), 1.0); // typed text
  bar(Math.round(S * 0.54), Math.round(S * 0.8), 0.42); // ghost suggestion

  // Cursor between them.
  const cx0 = Math.round(S * 0.49);
  const cx1 = Math.round(S * 0.515);
  for (let y = Math.round(S * 0.4); y < Math.round(S * 0.6); y++)
    for (let x = cx0; x < cx1; x++) put(x, y, white, 1.0);

  return buf;
}

for (const S of [16, 32, 48, 128]) {
  const png = encodePNG(S, S, drawIcon(S));
  writeFileSync(join(outDir, `icon-${S}.png`), png);
  console.log(`wrote icons/icon-${S}.png (${png.length} bytes)`);
}
