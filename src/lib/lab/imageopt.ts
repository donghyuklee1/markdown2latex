/**
 * imageopt.ts - decide what to do with each figure of a LaTeX project.
 *
 * Oversized PNG/JPG figures are the usual cause of Overleaf compile timeouts
 * and storage-limit errors: a 4000 px screenshot printed 3.5 inches wide holds
 * ~3.8x more pixels than a 300 dpi printer can use. This module works out, per
 * file, how wide it is printed (from `\includegraphics` in the .tex), how many
 * pixels that needs at the target DPI, and which format to write.
 *
 * Decisions only - no DOM, no canvas. The browser side (decode, sample, resize,
 * encode) is components/lab/imageCodec.ts, which feeds metadata in here and
 * asks `afterEncode` whether the result was worth it.
 */
import { maskSource } from "./arxiv";

export type ImageFormat = "png" | "jpeg" | "gif" | "bmp" | "webp" | "svg" | "pdf" | "eps" | "other";

export interface ImageMeta {
  path: string;
  bytes: number;
  width: number;
  height: number;
  format: ImageFormat;
  /** Distinct colours in a nearest-neighbour sample of the image (capped by the sampler). */
  colors?: number;
  /** How many pixels the colour sample looked at. */
  sampled?: number;
  /** Any pixel not fully opaque. */
  alpha?: boolean;
}

export type LayoutPreset = "two-column" | "one-column";

/** Printed widths in inches: IEEE/ACM-style two-column, and a 1in-margin letter page. */
export const LAYOUTS: Record<LayoutPreset, { column: number; text: number; label: string }> = {
  "two-column": { column: 3.5, text: 7.16, label: "Two-column (3.5 in / 7.16 in)" },
  "one-column": { column: 6.5, text: 6.5, label: "One-column (6.5 in)" },
};

export interface PlanOptions {
  dpi: number;
  layout: LayoutPreset;
  /** 1-100. */
  jpegQuality: number;
  /** Re-encode photographic PNG/BMP as JPEG. */
  convertPhotos: boolean;
  /** Print width for figures the .tex does not mention; defaults to the column width. */
  defaultWidthIn?: number;
}

export type Action = "resize" | "reencode" | "keep" | "passthrough";

export interface ImagePlan {
  path: string;
  /** Path to write: same as `path` unless the format (and so the extension) changes. */
  outPath: string;
  action: Action;
  format: "png" | "jpeg" | null;
  /** JPEG quality 1-100 when format is jpeg. */
  quality: number | null;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  printWidthIn: number;
  printSource: "tex" | "default";
  /** Formats pdfLaTeX cannot include must be converted even if the result is larger. */
  mustConvert: boolean;
  reasons: string[];
}

/* ---------------------------------------------------------------- formats */

const EXT: Record<string, ImageFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  jpe: "jpeg",
  gif: "gif",
  bmp: "bmp",
  webp: "webp",
  svg: "svg",
  pdf: "pdf",
  eps: "eps",
  ps: "eps",
};

export const formatFromPath = (path: string): ImageFormat => EXT[/\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? ""] ?? "other";

/** Magic bytes first (files get misnamed), extension as the fallback. */
export function sniffFormat(data: Uint8Array, path: string): ImageFormat {
  const b = data;
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 2) === "BM" && formatFromPath(path) === "bmp") return "bmp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 5) === "%PDF-") return "pdf";
  if (ascii(0, 4) === "%!PS" || (b[0] === 0xc5 && b[1] === 0xd0 && b[2] === 0xd3 && b[3] === 0xc6)) return "eps";
  return formatFromPath(path);
}

/** Raster formats the browser can decode and we may rewrite. */
export const isRaster = (f: ImageFormat) => f === "png" || f === "jpeg" || f === "gif" || f === "bmp" || f === "webp";

const extFor = (f: "png" | "jpeg") => (f === "png" ? ".png" : ".jpg");
const withExt = (path: string, f: "png" | "jpeg") => {
  const cur = formatFromPath(path);
  if (cur === f) return path;
  return path.replace(/\.[A-Za-z0-9]+$/, "") + extFor(f);
};

/* ---------------------------------------------------------------- content */

export type Content = "line-art" | "photo" | "mixed" | "unknown";

/**
 * Line art (plots, diagrams, screenshots of text) has few distinct colours and
 * compresses losslessly; photographs and renders have thousands and only
 * compress well as JPEG. Ratios rather than counts, so the sampler size can change.
 */
export function classify(meta: Pick<ImageMeta, "colors" | "sampled">): Content {
  if (meta.colors === undefined || !meta.sampled) return "unknown";
  if (meta.colors <= 256) return "line-art";
  if (meta.colors / meta.sampled >= 0.08) return "photo";
  return "mixed";
}

/* ------------------------------------------------------------------- plan */

const r1 = (n: number) => Math.round(n * 100) / 100;

/** What to do with one image, given how wide it prints. */
export function planImage(meta: ImageMeta, printWidthIn: number, options: PlanOptions, printSource: "tex" | "default" = "default", lockFormat = false): ImagePlan {
  const base: ImagePlan = {
    path: meta.path,
    outPath: meta.path,
    action: "passthrough",
    format: null,
    quality: null,
    width: meta.width,
    height: meta.height,
    targetWidth: meta.width,
    targetHeight: meta.height,
    printWidthIn,
    printSource,
    mustConvert: false,
    reasons: [],
  };
  if (meta.format === "pdf" || meta.format === "eps") return { ...base, reasons: ["Vector " + meta.format.toUpperCase() + " - copied unchanged."] };
  if (meta.format === "svg") return { ...base, reasons: ["SVG copied unchanged; pdfLaTeX needs it converted to PDF (or the svg package with Inkscape)."] };
  if (!isRaster(meta.format)) return { ...base, reasons: ["Not an image - copied unchanged."] };
  if (!(meta.width > 0 && meta.height > 0)) return { ...base, reasons: ["Could not read the pixel size - copied unchanged."] };

  const dpi = Math.max(72, Math.min(2400, Math.round(options.dpi) || 300));
  const quality = Math.max(1, Math.min(100, Math.round(options.jpegQuality) || 85));
  const width = Math.max(0.1, printWidthIn || options.defaultWidthIn || LAYOUTS[options.layout].column);
  const reasons: string[] = [];

  // Pixels needed: print width x DPI. Never upscale - that adds bytes, not detail.
  const need = Math.ceil(width * dpi);
  const resize = meta.width > need;
  const targetWidth = resize ? need : meta.width;
  const targetHeight = resize ? Math.max(1, Math.round((meta.height * need) / meta.width)) : meta.height;
  const effective = Math.round(meta.width / width);
  if (resize) reasons.push(meta.width + " px for " + r1(width) + " in is " + effective + " dpi; " + targetWidth + " px gives " + dpi + " dpi.");
  else reasons.push(meta.width + " px for " + r1(width) + " in is " + effective + " dpi (target " + dpi + ") - not upscaled.");

  // Format. pdfLaTeX reads PNG, JPEG and PDF only.
  const content = classify(meta);
  const mustConvert = meta.format === "gif" || meta.format === "bmp" || meta.format === "webp";
  let format: "png" | "jpeg";
  if (meta.alpha) {
    format = "png";
    if (meta.format !== "png") reasons.push("Has transparency: PNG (JPEG would flatten it).");
  } else if (meta.format === "jpeg") {
    format = "jpeg"; // a JPEG's artefacts make it a poor PNG; keep it lossy
  } else if (content === "photo" && options.convertPhotos && !lockFormat) {
    format = "jpeg";
    reasons.push("Photographic content (" + meta.colors + " colours sampled): JPEG q" + quality + ".");
  } else {
    format = "png";
    if (content === "line-art") reasons.push("Line art (" + meta.colors + " colours): lossless PNG.");
  }
  if (mustConvert) reasons.push(meta.format.toUpperCase() + " cannot be included by pdfLaTeX: converted to " + (format === "png" ? "PNG" : "JPEG") + ".");
  if (lockFormat && content === "photo" && options.convertPhotos && !meta.alpha && meta.format === "png") {
    reasons.push("Referenced with its .png extension in the .tex, so it stays PNG.");
  }

  const sameFormat = format === meta.format;
  const action: Action = resize ? "resize" : !sameFormat ? "reencode" : "keep";
  if (action === "keep") reasons.push("Already small enough - kept as is.");
  return {
    ...base,
    outPath: withExt(meta.path, format),
    action,
    format: action === "keep" ? null : format,
    quality: format === "jpeg" && action !== "keep" ? quality : null,
    targetWidth,
    targetHeight,
    mustConvert,
    reasons,
  };
}

/** Re-encoding must save at least this share of the bytes to be worth a lossy pass. */
export const MIN_SAVING = 0.1;

/**
 * After encoding: keep the new file, or fall back to the original? Formats
 * pdfLaTeX cannot read are always replaced.
 */
export function afterEncode(plan: ImagePlan, originalBytes: number, encodedBytes: number): { keepOriginal: boolean; reason: string | null } {
  if (plan.mustConvert) return { keepOriginal: false, reason: null };
  if (encodedBytes <= 0) return { keepOriginal: true, reason: "Encoder returned nothing - original kept." };
  const saving = 1 - encodedBytes / Math.max(1, originalBytes);
  if (saving < MIN_SAVING) {
    return { keepOriginal: true, reason: "Re-encoding saved only " + Math.max(0, Math.round(saving * 100)) + "% - original kept." };
  }
  return { keepOriginal: false, reason: null };
}

/* ----------------------------------------------------------- tex widths */

export interface WidthSpec {
  /** Absolute printed width, when the .tex gives one. */
  widthIn?: number;
  heightIn?: number;
  scale?: number;
  /** The option text, for the reason column. */
  spec: string;
  /** Referenced with an explicit extension (so renaming would break it). */
  explicitExt: boolean;
  file: string;
}

const UNIT_IN: Record<string, number> = { in: 1, cm: 1 / 2.54, mm: 1 / 25.4, pt: 1 / 72.27, bp: 1 / 72, pc: 12 / 72.27, em: 10 / 72.27, ex: 4.3 / 72.27, dd: 1238 / 1157 / 72.27, px: 1 / 72 };

/** A TeX length like `0.48\linewidth`, `.8\textwidth`, `5cm`, `\columnwidth` in inches. */
export function lengthIn(spec: string, lw: number, layout: LayoutPreset): number | null {
  const s = spec.replace(/\s+/g, "");
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))?\\?([A-Za-z]+)$/.exec(s);
  if (!m) return null;
  const k = m[1] === undefined ? 1 : parseFloat(m[1]);
  if (!(k > 0)) return null;
  const unit = m[2];
  const L = LAYOUTS[layout];
  const rel: Record<string, number> = { linewidth: lw, columnwidth: L.column, hsize: lw, textwidth: L.text, paperwidth: 8.5 };
  if (s.includes("\\")) return unit in rel ? k * rel[unit] : null;
  return unit in UNIT_IN && m[1] !== undefined ? k * UNIT_IN[unit] : null;
}

function keyval(opts: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of opts.split(",")) {
    const eq = part.indexOf("=");
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    else if (part.trim()) out[part.trim()] = "";
  }
  return out;
}

function joinPath(dir: string, name: string): string {
  const parts: string[] = [];
  for (const seg of (dir ? dir + "/" + name : name).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

const GRAPHIC_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".eps", ".PNG", ".JPG", ".JPEG", ".PDF", ".gif", ".bmp", ".webp", ".svg"];

/**
 * Map each image file to how wide it is printed, from every
 * `\includegraphics[...]{name}` in the .tex files. Honours `\graphicspath`,
 * `figure*` (full text width in two-column layouts), and the width of an
 * enclosing `subfigure`/`minipage` for `\linewidth`. A figure used twice gets
 * its widest use.
 */
export function texWidths(tex: ReadonlyArray<{ path: string; text: string }>, imagePaths: ReadonlyArray<string>, layout: LayoutPreset): Map<string, WidthSpec> {
  const out = new Map<string, WidthSpec>();
  const known = new Set(imagePaths);
  const L = LAYOUTS[layout];
  const graphicsPath: string[] = [];
  const sources = tex.map((t) => ({ path: t.path, m: maskSource(t.text.replace(/\r\n?/g, "\n")) }));

  for (const t of sources) {
    for (const g of t.m.matchAll(/\\graphicspath\s*\{((?:\s*\{[^{}]*\})*)\s*\}/g)) {
      for (const d of g[1].matchAll(/\{([^{}]*)\}/g)) graphicsPath.push(joinPath(dirOf(t.path), d[1]));
    }
  }

  const resolve = (from: string, name: string): { path: string; explicitExt: boolean } | null => {
    const n = name.trim().replace(/^"|"$/g, "");
    const explicitExt = /\.[A-Za-z]{2,4}$/.test(n) && formatFromPath(n) !== "other";
    const dirs = [dirOf(from), "", ...graphicsPath];
    for (const d of dirs) {
      const p = joinPath(d, n);
      if (known.has(p)) return { path: p, explicitExt };
      for (const e of GRAPHIC_EXTS) if (known.has(p + e)) return { path: p + e, explicitExt: false };
    }
    // Last resort: unique suffix match (projects zipped inside a top folder).
    const tail = "/" + n.replace(/^\.\//, "");
    const hits = imagePaths.filter((p) => p.endsWith(tail) || GRAPHIC_EXTS.some((e) => p.endsWith(tail + e)));
    return hits.length === 1 ? { path: hits[0], explicitExt } : null;
  };

  const TOKEN = /\\(begin|end)\s*\{(figure\*?|subfigure|minipage|wrapfigure|table\*?)\}|\\includegraphics\s*\*?|\\resizebox\s*\*?/g;
  for (const t of sources) {
    const m = t.m;
    const stack: Array<{ env: string; lw: number }> = [];
    const lw = () => (stack.length ? stack[stack.length - 1].lw : L.column);
    let resizeWidth: { at: number; w: number | null; spec: string } | null = null;
    for (let tok = TOKEN.exec(m); tok; tok = TOKEN.exec(m)) {
      const at = TOKEN.lastIndex;
      if (tok[1] === "begin") {
        const env = tok[2];
        let w = lw();
        if (env === "figure*" || env === "table*") w = L.text;
        else if (env === "figure" || env === "table") w = L.column;
        else {
          // subfigure/minipage/wrapfigure: optional [pos] args, then {width}
          // (wrapfigure puts its placement in braces first: {r}{0.4\textwidth})
          const rest = m.slice(at, at + 200);
          const b = env === "wrapfigure"
            ? /^\s*(?:\[[^\]]*\]\s*)?\{[^{}]*\}\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/.exec(rest)
            : /^\s*(?:\[[^\]]*\]\s*)*\{([^{}]*)\}/.exec(rest);
          const len = b ? lengthIn(b[1], lw(), layout) : null;
          if (len) w = len;
        }
        stack.push({ env, lw: w });
        continue;
      }
      if (tok[1] === "end") {
        const idx = stack.map((s) => s.env).lastIndexOf(tok[2]);
        if (idx >= 0) stack.length = idx;
        continue;
      }
      if (tok[0].startsWith("\\resizebox")) {
        const a = /^\s*\{([^{}]*)\}/.exec(m.slice(at, at + 120));
        resizeWidth = a ? { at, w: a[1].trim() === "!" ? null : lengthIn(a[1], lw(), layout), spec: "\\resizebox{" + a[1].trim() + "}" } : null;
        continue;
      }
      // \includegraphics[opts]{name}
      const g = /^\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/.exec(m.slice(at, at + 400));
      if (!g) continue;
      const opts = keyval(g[1] ?? "");
      const hit = resolve(t.path, g[2]);
      if (!hit) continue;
      const spec: WidthSpec = { spec: g[1] ? "[" + g[1].trim() + "]" : "no width", explicitExt: hit.explicitExt, file: t.path };
      if (opts.width) spec.widthIn = lengthIn(opts.width, lw(), layout) ?? undefined;
      if (opts.height && spec.widthIn === undefined) spec.heightIn = lengthIn(opts.height, lw(), layout) ?? undefined;
      if (opts.scale && spec.widthIn === undefined) spec.scale = parseFloat(opts.scale) || undefined;
      if (spec.widthIn === undefined && spec.heightIn === undefined && spec.scale === undefined && resizeWidth && at - resizeWidth.at < 80 && resizeWidth.w) {
        spec.widthIn = resizeWidth.w;
        spec.spec = resizeWidth.spec;
      }
      if (spec.widthIn !== undefined) spec.widthIn = Math.min(spec.widthIn, L.text * 1.2);
      const prev = out.get(hit.path);
      const prevW = prev?.widthIn ?? 0;
      if (!prev || (spec.widthIn ?? 0) > prevW || (prev.widthIn === undefined && spec.widthIn !== undefined)) {
        out.set(hit.path, { ...spec, explicitExt: spec.explicitExt || !!prev?.explicitExt });
      } else if (spec.explicitExt) prev.explicitExt = true;
    }
  }
  return out;
}

/**
 * Printed width of one image given its spec and pixel size. pdfTeX sizes a
 * bitmap without density info at 72 dpi, which `scale=` multiplies.
 */
export function printWidth(spec: WidthSpec | undefined, meta: Pick<ImageMeta, "width" | "height">, options: PlanOptions): { widthIn: number; source: "tex" | "default"; note: string } {
  const L = LAYOUTS[options.layout];
  const fallback = options.defaultWidthIn || L.column;
  if (!spec) return { widthIn: fallback, source: "default", note: "Not found in the .tex - assumed " + r1(fallback) + " in." };
  if (spec.widthIn) return { widthIn: spec.widthIn, source: "tex", note: spec.file + ": " + spec.spec + " = " + r1(spec.widthIn) + " in." };
  if (spec.heightIn && meta.height > 0) {
    const w = Math.min(L.text, (spec.heightIn * meta.width) / meta.height);
    return { widthIn: w, source: "tex", note: spec.file + ": " + spec.spec + " = " + r1(w) + " in wide." };
  }
  if (spec.scale && meta.width > 0) {
    const w = Math.min(L.text, (spec.scale * meta.width) / 72);
    return { widthIn: w, source: "tex", note: spec.file + ": " + spec.spec + " = " + r1(w) + " in wide." };
  }
  // No size given: printed at natural size, but anything wider than the text overflows anyway.
  const natural = meta.width > 0 ? Math.min(L.text, meta.width / 72) : fallback;
  return { widthIn: natural, source: "tex", note: spec.file + ": no width option - natural size, capped at the text width (" + r1(natural) + " in)." };
}

/** Plan one image from its .tex width spec (if any). The panel calls this per image as it decodes. */
export function planWithSpec(meta: ImageMeta, spec: WidthSpec | undefined, options: PlanOptions): ImagePlan {
  if (!isRaster(meta.format)) return planImage(meta, 0, options);
  const pw = printWidth(spec, meta, options);
  const plan = planImage(meta, pw.widthIn, options, pw.source, !!spec?.explicitExt);
  return { ...plan, reasons: [pw.note, ...plan.reasons] };
}

/** One plan per image: widths from the .tex where possible, the default otherwise. */
export function planProject(images: ReadonlyArray<ImageMeta>, tex: ReadonlyArray<{ path: string; text: string }>, options: PlanOptions): ImagePlan[] {
  const specs = texWidths(tex, images.map((i) => i.path), options.layout);
  return images.map((meta) => planWithSpec(meta, specs.get(meta.path), options));
}
