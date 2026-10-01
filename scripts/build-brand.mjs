/**
 * build-brand.mjs - turns the Overleaf and LaTeX logos into UI masks.
 *   npm run logos   (runs this after build-logos.mjs)
 *
 * Both sources are dark artwork on white. Each pixel's coverage is recovered
 * from its distance to white and written as alpha over solid ink, then the
 * result is cropped to the artwork. The UI uses them as CSS masks, so the
 * colour comes from CSS: the LaTeX mark follows the text colour in both
 * themes, the Overleaf mark is its brand green until its button fills.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodePng, encodePng } from "./png.mjs";

const ROOT = process.cwd();

for (const name of ["overleaf", "latex"]) {
  const { w, h, px } = decodePng(readFileSync(join(ROOT, "static", "brand-src", name + ".png")));
  const alpha = new Uint8Array(w * h);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = px(x, y);
      // Coverage = how far the pixel is from white, on its darkest channel.
      const cover = Math.max(0, Math.min(1, (255 - Math.min(r, g, b)) / 255)) * (a / 255);
      const v = Math.round(cover * 255);
      alpha[y * w + x] = v;
      if (v > 20) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const m = 4;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const out = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const o = (y * cw + x) * 4;
      out[o + 3] = alpha[(y0 + y) * w + (x0 + x)]; // black ink, coverage as alpha
    }
  }
  const png = encodePng(cw, ch, out);
  writeFileSync(join(ROOT, "public", "brand", name + ".png"), png);
  console.log(`wrote public/brand/${name}.png (${cw}x${ch}, ${(png.length / 1024).toFixed(1)} KB)`);
}
