/**
 * imageCodec.ts - the browser half of the Figure Optimizer: decode, sample,
 * resize and encode one raster image with canvas APIs.
 *
 * Every decision (target size, format, whether the result is worth keeping)
 * lives in lib/lab/imageopt.ts; this file only does pixel work. Callers handle
 * one image at a time and `close()` the bitmap, so memory stays bounded by the
 * largest single figure rather than the whole project.
 */
import { sniffFormat, isRaster, type ImageMeta } from "@/lib/lab/imageopt";

/** Side of the nearest-neighbour colour sample. 128x128 = 16384 pixels. */
const SAMPLE = 128;
/** Stop counting colours here; past it the image is photographic anyway. */
const COLOR_CAP = 20000;

export interface Decoded {
  meta: ImageMeta;
  /** Present for rasters the browser could decode. The caller must close() it. */
  bitmap: ImageBitmap | null;
  error?: string;
}

const MIME: Record<string, string> = { png: "image/png", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", webp: "image/webp" };

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function context(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  return ctx;
}

/** Distinct colours and alpha presence, from a small unsmoothed copy (no blended edge colours). */
function sample(bitmap: ImageBitmap): { colors: number; sampled: number; alpha: boolean } {
  const scale = Math.min(1, SAMPLE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = canvas(w, h);
  const ctx = context(c);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const seen = new Set<number>();
  let alpha = false;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 250) alpha = true;
    if (seen.size < COLOR_CAP) seen.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
  }
  c.width = c.height = 0; // release the backing store now, not at GC
  return { colors: seen.size, sampled: w * h, alpha };
}

/** Read one file's metadata, decoding it if it is a raster image. */
export async function decode(path: string, data: Uint8Array): Promise<Decoded> {
  const format = sniffFormat(data, path);
  const meta: ImageMeta = { path, bytes: data.length, width: 0, height: 0, format };
  if (!isRaster(format)) return { meta, bitmap: null };
  try {
    const blob = new Blob([data as BlobPart], { type: MIME[format] });
    const bitmap = await createImageBitmap(blob);
    meta.width = bitmap.width;
    meta.height = bitmap.height;
    Object.assign(meta, sample(bitmap));
    return { meta, bitmap };
  } catch (err) {
    return { meta, bitmap: null, error: "Browser could not decode it (" + (err instanceof Error ? err.message : String(err)) + ")" };
  }
}

/**
 * Resize and encode. Halve repeatedly first, then one high-quality final draw:
 * a single large downscale skips source pixels and aliases fine lines.
 */
export async function encode(bitmap: ImageBitmap, width: number, height: number, format: "png" | "jpeg", quality: number): Promise<Uint8Array> {
  let src: CanvasImageSource = bitmap;
  let sw = bitmap.width;
  let sh = bitmap.height;
  const scratch: HTMLCanvasElement[] = [];
  while (sw / 2 >= width && sh / 2 >= height) {
    const c = canvas(Math.round(sw / 2), Math.round(sh / 2));
    const ctx = context(c);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, c.width, c.height);
    scratch.push(c);
    src = c;
    sw = c.width;
    sh = c.height;
  }
  const out = canvas(width, height);
  const ctx = context(out);
  if (format === "jpeg") {
    // JPEG has no alpha; transparent pixels would turn black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);
  for (const c of scratch) c.width = c.height = 0;

  const blob = await new Promise<Blob | null>((resolve) =>
    out.toBlob(resolve, format === "png" ? "image/png" : "image/jpeg", format === "jpeg" ? Math.max(0.01, Math.min(1, quality / 100)) : undefined),
  );
  out.width = out.height = 0;
  if (!blob) throw new Error("Encoder returned no data");
  return new Uint8Array(await blob.arrayBuffer());
}
