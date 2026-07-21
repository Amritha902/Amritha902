/*
 * Minimal dependency-free GIF89a encoder (same spirit as gen-icons.mjs).
 *
 * encodeGif(frames, { delayCs }) — frames are PNG buffers (RGBA, as produced
 * by ffmpeg's png encoder); output is an animated, infinitely-looping GIF.
 *
 * Pipeline: PNG decode (inflate + de-filter) → global 256-color palette
 * (popularity over 5-bit/channel buckets) → nearest-color indexing → LZW.
 */
import { inflateSync } from "node:zlib";

// --- PNG decode (truecolor 8-bit, the only kind ffmpeg's png encoder emits) --
export function pngDecode(buf) {
  let pos = 8; // skip signature
  let width = 0;
  let height = 0;
  let bpp = 0; // bytes per pixel
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const bitDepth = data[8];
      colorType = data[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`unsupported PNG: bitDepth=${bitDepth} colorType=${colorType}`);
      }
      bpp = colorType === 6 ? 4 : 3;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 3);

  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };

  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? line[i - bpp] : 0;
      const up = prev[i];
      const ul = i >= bpp ? prev[i - bpp] : 0;
      switch (filter) {
        case 1: line[i] = (line[i] + left) & 0xff; break;
        case 2: line[i] = (line[i] + up) & 0xff; break;
        case 3: line[i] = (line[i] + ((left + up) >> 1)) & 0xff; break;
        case 4: line[i] = (line[i] + paeth(left, up, ul)) & 0xff; break;
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = (y * width + x) * 3;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
    }
    prev = line;
  }
  return { width, height, rgb: out };
}

// --- Palette: popularity over 15-bit buckets, then nearest-match indexing ---
function buildPalette(frames) {
  const counts = new Map();
  for (const f of frames) {
    const { rgb } = f;
    for (let i = 0; i < rgb.length; i += 3) {
      const key = ((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256);
  const palette = top.map(([key]) => [
    ((key >> 10) & 31) << 3,
    ((key >> 5) & 31) << 3,
    (key & 31) << 3,
  ]);
  while (palette.length < 256) palette.push([0, 0, 0]);

  // bucket key -> palette index (exact); everything else falls back to search
  const exact = new Map(top.map(([key], i) => [key, i]));
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = exact.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    exact.set(key, best); // memoize the bucket
    return best;
  };
  return { palette, nearest };
}

// --- LZW (GIF variant, 8-bit min code size) ---------------------------------
function lzwEncode(indices) {
  const MIN_CODE_SIZE = 8;
  const CLEAR = 1 << MIN_CODE_SIZE; // 256
  const EOI = CLEAR + 1; // 257
  const MAX_CODE = 4095;

  const bytes = [];
  let cur = 0;
  let curBits = 0;
  let codeSize = MIN_CODE_SIZE + 1;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      bytes.push(cur & 0xff);
      cur >>= 8;
      curBits -= 8;
    }
  };

  let dict = new Map();
  let next = EOI + 1;
  const reset = () => {
    dict = new Map();
    next = EOI + 1;
    codeSize = MIN_CODE_SIZE + 1;
  };

  emit(CLEAR);
  reset();
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix);
    if (next <= MAX_CODE) {
      dict.set(key, next++);
      if (next - 1 === 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(CLEAR);
      reset();
    }
    prefix = k;
  }
  emit(prefix);
  emit(EOI);
  if (curBits > 0) bytes.push(cur & 0xff);

  // Pack into ≤255-byte sub-blocks.
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0); // block terminator
  return Buffer.from(out);
}

// --- Assemble ---------------------------------------------------------------
export function encodeGif(pngBuffers, { delayCs = 10 } = {}) {
  const frames = pngBuffers.map(pngDecode);
  const { width, height } = frames[0];
  const { palette, nearest } = buildPalette(frames);

  const parts = [];
  parts.push(Buffer.from("GIF89a", "ascii"));

  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0);
  lsd.writeUInt16LE(height, 2);
  lsd[4] = 0xf7; // global color table, 8 bits, 256 entries
  parts.push(lsd);

  const gct = Buffer.alloc(256 * 3);
  palette.forEach((p, i) => {
    gct[i * 3] = p[0];
    gct[i * 3 + 1] = p[1];
    gct[i * 3 + 2] = p[2];
  });
  parts.push(gct);

  // NETSCAPE loop-forever extension.
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "ascii"), 3, 1, 0, 0, 0]));

  for (const f of frames) {
    // Graphic Control Extension (per-frame delay).
    const gce = Buffer.from([0x21, 0xf9, 4, 0, delayCs & 0xff, delayCs >> 8, 0, 0]);
    parts.push(gce);
    // Image Descriptor.
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c;
    desc.writeUInt16LE(0, 1);
    desc.writeUInt16LE(0, 3);
    desc.writeUInt16LE(width, 5);
    desc.writeUInt16LE(height, 7);
    parts.push(desc);
    // Pixel data.
    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < idx.length; i++, p += 3) {
      idx[i] = nearest(f.rgb[p], f.rgb[p + 1], f.rgb[p + 2]);
    }
    parts.push(Buffer.from([8]), lzwEncode(idx)); // LZW min code size, data
  }

  parts.push(Buffer.from([0x3b])); // trailer
  return Buffer.concat(parts);
}
