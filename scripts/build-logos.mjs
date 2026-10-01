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

const ROOT = process.cwd();
const SRC = join(ROOT, "static", "logo-source.png");

/* ----------------------------------------------------------- the palette */
/** Sampled from the source artwork; BG and CREAM match --bg in light and the dark-mode ink. */
const BG = [246, 244, 241];
const BLACK = [0, 0, 0];
const CREAM = [246, 244, 241];
const ORANGE = [255, 117, 31];

import { decodePng, encodePng } from "./png.mjs";

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

/* The source artwork sits in generous empty margins. Shipped as-is, the
 * wordmark looks smaller than its box and sits visibly right of whatever it is
 * aligned with, so both PNGs are cropped to the ink plus a hairline margin. */
const MARGIN = 6;
let cx0 = w, cy0 = h, cx1 = 0, cy1 = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const ink = inkAt(px, x, y);
    if (!ink || ink.alpha < 0.08) continue;
    if (x < cx0) cx0 = x;
    if (x > cx1) cx1 = x;
    if (y < cy0) cy0 = y;
    if (y > cy1) cy1 = y;
  }
}
cx0 = Math.max(0, cx0 - MARGIN);
cy0 = Math.max(0, cy0 - MARGIN);
cx1 = Math.min(w - 1, cx1 + MARGIN);
cy1 = Math.min(h - 1, cy1 + MARGIN);
const cw = cx1 - cx0 + 1;
const ch = cy1 - cy0 + 1;

function crop(rgba) {
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) rgba.copy(out, y * cw * 4, ((cy0 + y) * w + cx0) * 4, ((cy0 + y) * w + cx0 + cw) * 4);
  return out;
}

for (const [name, ink] of targets) {
  const png = encodePng(cw, ch, crop(render(w, h, px, ink)));
  for (const dir of ["static", "public"]) writeFileSync(join(ROOT, dir, name), png);
  console.log(`wrote static/${name} and public/${name} (${cw}x${ch}, ${(png.length / 1024).toFixed(1)} KB)`);
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
