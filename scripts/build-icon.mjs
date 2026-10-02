/**
 * build-icon.mjs - the app icon: the sigma from static/brand-src/sigma.png.
 *   npm run logos   (runs this after the logo scripts)
 *
 * The source is black ink on paper. Each pixel's coverage is recovered from
 * how much darker it is than the paper, and written as alpha over solid ink,
 * so the background disappears and the edges stay anti-aliased. The glyph is
 * cropped, centred in a square with a little margin, and box-filtered down.
 *
 *   public/icon.png        512 px, black sigma on transparent (favicon fallback)
 *   public/icon.svg        the same, turning white in a dark browser theme
 *   public/apple-icon.png  180 px on the paper colour (iOS wants it opaque)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodePng } from "./png.mjs";

const ROOT = process.cwd();
const { w, h, px } = decodePng(readFileSync(join(ROOT, "static", "brand-src", "sigma.png")));

// Paper colour: the corners.
const corners = [px(2, 2), px(w - 3, 2), px(2, h - 3), px(w - 3, h - 3)];
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const paper = corners.reduce((a, c) => a + lum(c), 0) / corners.length;
const PAPER_RGB = corners[0].slice(0, 3);

// Coverage per pixel, and the glyph's bounds.
const cover = new Float32Array(w * h);
let x0 = w, y0 = h, x1 = 0, y1 = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const c = px(x, y);
    const v = Math.max(0, Math.min(1, (paper - lum(c)) / paper)) * (c[3] / 255);
    cover[y * w + x] = v;
    if (v > 0.1) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
}
const gw = x1 - x0 + 1;
const gh = y1 - y0 + 1;
const side = Math.ceil(Math.max(gw, gh) * 1.12); // a little breathing room
const ox = x0 - (side - gw) / 2;
const oy = y0 - (side - gh) / 2;

/** Coverage of the square canvas at `size` px, box-filtered from the source. */
function render(size) {
  const k = side / size;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx0 = ox + x * k, sy0 = oy + y * k;
      let sum = 0, n = 0;
      for (let sy = Math.floor(sy0); sy < Math.ceil(sy0 + k); sy++) {
        for (let sx = Math.floor(sx0); sx < Math.ceil(sx0 + k); sx++) {
          n++;
          if (sx >= 0 && sy >= 0 && sx < w && sy < h) sum += cover[sy * w + sx];
        }
      }
      out[y * size + x] = n ? sum / n : 0;
    }
  }
  return out;
}

function png(size, background) {
  const c = render(size);
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const a = c[i];
    if (background) {
      // Ink over paper, opaque.
      for (let ch = 0; ch < 3; ch++) buf[i * 4 + ch] = Math.round(background[ch] * (1 - a));
      buf[i * 4 + 3] = 255;
    } else {
      buf[i * 4 + 3] = Math.round(a * 255); // black ink, coverage as alpha
    }
  }
  return encodePng(size, size, buf);
}

const icon = png(512, null);
writeFileSync(join(ROOT, "public", "icon.png"), icon);
writeFileSync(join(ROOT, "static", "icon.png"), icon);
writeFileSync(join(ROOT, "public", "apple-icon.png"), png(180, PAPER_RGB));

// SVG wrapper: the PNG as an image, inverted to white when the browser is dark.
const b64 = png(128, null).toString("base64");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><style>@media (prefers-color-scheme: dark){image{filter:invert(1)}}</style><image width="128" height="128" href="data:image/png;base64,${b64}"/></svg>\n`;
writeFileSync(join(ROOT, "public", "icon.svg"), svg);
console.log(`wrote public/icon.png (512), public/icon.svg, public/apple-icon.png (180); glyph ${gw}x${gh} in ${side}x${side}`);
