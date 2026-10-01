/**
 * build-logos.mjs - derives every logo asset from static/logo-source.png.
 *   npm run logos
 *
 * The source wordmark is flat artwork on an opaque cream field, which would
 * read as a pale card when placed on a dark background. So rather than copying
 * it, this un-composites it: for each pixel it solves the alpha that the artwork
 * was blended with, then re-paints that coverage in the ink colour each theme
 * wants. Light keeps the original black, dark swaps it for the logo's own cream,
 * and the orange is untouched in both.
 *
 * Pure node - zlib is the only dependency, so this runs anywhere npm does.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import zlib from "node:zlib";

const ROOT = process.cwd();
const SRC = join(ROOT, "static", "logo-source.png");

/* ----------------------------------------------------------- the palette */
/** Sampled from the source artwork; BG and CREAM match --bg in light and the dark-mode ink. */
const BG = [246, 244, 241];
const BLACK = [0, 0, 0];
const CREAM = [246, 244, 241];
const ORANGE = [255, 117, 31];

/* ---------------------------------------------------------- PNG decoding */

function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, colorType = 0;
  const idat = [];
  let plte = null;
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") plte = data;
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
  }
  const px = (x, y) => {
    const o = y * stride + x * channels;
    if (colorType === 3) { const i = out[o] * 3; return [plte[i], plte[i + 1], plte[i + 2], 255]; }
    if (colorType === 6) return [out[o], out[o + 1], out[o + 2], out[o + 3]];
    if (colorType === 2) return [out[o], out[o + 1], out[o + 2], 255];
    return [out[o], out[o], out[o], 255];
  };
  return { w, h, px };
}

/* ---------------------------------------------------------- PNG encoding */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Buffer of w*h*4. */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const stride = w * 4;
  const rawz = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    rawz[y * (stride + 1)] = 0; // filter: none
    rgba.copy(rawz, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(rawz, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------- un-compositing */

const LUM = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const BG_LUM = LUM(BG);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Decide whether a pixel is part of the orange glyph or the neutral text, and
 * recover how much ink covered it. Orange is separated by its red/blue spread,
 * which the cream background (5) and the black text (0) both lack.
 */
function inkAt(px, x, y) {
  const [r, g, b, a] = px(x, y);
  if (a < 8) return null;
  const warmth = r - b;
  if (warmth > 40) {
    // Blue falls from the background's 241 to the orange's 31 as coverage rises.
    return { orange: true, alpha: clamp01((BG[2] - b) / (BG[2] - ORANGE[2])) };
  }
  return { orange: false, alpha: clamp01((BG_LUM - LUM([r, g, b])) / BG_LUM) };
}

function render(w, h, px, neutralInk) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const ink = inkAt(px, x, y);
      if (!ink || ink.alpha <= 0) continue;
      const [cr, cg, cb] = ink.orange ? ORANGE : neutralInk;
      rgba[o] = cr; rgba[o + 1] = cg; rgba[o + 2] = cb;
      rgba[o + 3] = Math.round(ink.alpha * 255);
    }
  }
  return rgba;
}

/* ------------------------------------------------------------------ run */

const { w, h, px } = decodePng(readFileSync(SRC));
console.log(`source ${w}x${h}`);

const targets = [
  ["logo-light.png", BLACK],
  ["logo-dark.png", CREAM],
];

for (const [name, ink] of targets) {
  const png = encodePng(w, h, render(w, h, px, ink));
  for (const dir of ["static", "public"]) writeFileSync(join(ROOT, dir, name), png);
  console.log(`wrote static/${name} and public/${name} (${(png.length / 1024).toFixed(1)} KB)`);
}

/* The app icon is the orange "2" alone, cropped square and left transparent so
 * it sits on any browser chrome. */
let minX = w, minY = h, maxX = 0, maxY = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const ink = inkAt(px, x, y);
    if (!ink || !ink.orange || ink.alpha < 0.5) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
}
const glyphW = maxX - minX + 1;
const glyphH = maxY - minY + 1;
const side = Math.round(Math.max(glyphW, glyphH) * 1.32); // breathing room
const offX = minX - Math.round((side - glyphW) / 2);
const offY = minY - Math.round((side - glyphH) / 2);
const icon = Buffer.alloc(side * side * 4);
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const sx = offX + x, sy = offY + y;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    const ink = inkAt(px, sx, sy);
    if (!ink || !ink.orange || ink.alpha <= 0) continue;
    const o = (y * side + x) * 4;
    icon[o] = ORANGE[0]; icon[o + 1] = ORANGE[1]; icon[o + 2] = ORANGE[2];
    icon[o + 3] = Math.round(ink.alpha * 255);
  }
}
const iconPng = encodePng(side, side, icon);
writeFileSync(join(ROOT, "public", "icon.png"), iconPng);
writeFileSync(join(ROOT, "static", "icon.png"), iconPng);
console.log(`wrote public/icon.png and static/icon.png (${side}x${side}, glyph ${glyphW}x${glyphH})`);
