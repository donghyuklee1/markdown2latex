import { check, finish } from "../harness";
import { bytesOf } from "../../src/lib/lab/archive";
import {
  afterEncode,
  classify,
  lengthIn,
  planImage,
  planProject,
  sniffFormat,
  texWidths,
  type ImageMeta,
  type PlanOptions,
} from "../../src/lib/lab/imageopt";

const opts: PlanOptions = { dpi: 300, layout: "two-column", jpegQuality: 85, convertPhotos: true };
const photo: ImageMeta = { path: "fig/photo.png", bytes: 8_000_000, width: 4000, height: 3000, format: "png", colors: 9000, sampled: 16384, alpha: false };
const plot: ImageMeta = { path: "fig/plot.png", bytes: 900_000, width: 3000, height: 2000, format: "png", colors: 40, sampled: 16384, alpha: false };
const small: ImageMeta = { path: "fig/small.png", bytes: 30_000, width: 600, height: 400, format: "png", colors: 30, sampled: 16384, alpha: false };

function main() {
  // sizing
  const p = planImage(photo, 3.5, opts);
  check("resize to print width x dpi, keep aspect", p.targetWidth + "x" + p.targetHeight + " " + p.action, "1050x788 resize");
  const s = planImage(small, 3.5, opts);
  check("never upscale; an already-small image is kept", s.targetWidth + " " + s.action + " " + s.format, "600 keep null");
  check("600 dpi needs more pixels than 300", planImage(photo, 3.5, { ...opts, dpi: 600 }).targetWidth + "", "2100");

  // format
  check("photographic PNG -> JPEG, renamed to .jpg", p.format + " q" + p.quality + " " + p.outPath, "jpeg q85 fig/photo.jpg");
  check("line art stays PNG", planImage(plot, 3.5, opts).format + "", "png");
  check("photo stays PNG when the switch is off", planImage(photo, 3.5, { ...opts, convertPhotos: false }).format + "", "png");
  check("transparency forces PNG even for photos", planImage({ ...photo, alpha: true }, 3.5, opts).format + "", "png");
  check("JPEG source stays JPEG", planImage({ ...photo, path: "a.jpg", format: "jpeg" }, 3.5, opts).format + "", "jpeg");
  const webp = planImage({ ...small, path: "a.webp", format: "webp" }, 3.5, opts);
  check("WebP must become PNG/JPEG (pdfLaTeX cannot read it), never WebP", webp.action + " " + webp.format + " " + webp.outPath + " " + webp.mustConvert, "reencode png a.png true");
  check("PDF and EPS pass through", [planImage({ ...small, path: "a.pdf", format: "pdf" }, 3.5, opts).action, planImage({ ...small, path: "a.eps", format: "eps" }, 3.5, opts).action].join(), "passthrough,passthrough");
  check("classify: few colours is line art, many is photo", [classify({ colors: 40, sampled: 16384 }), classify({ colors: 9000, sampled: 16384 }), classify({ colors: 900, sampled: 16384 })].join(), "line-art,photo,mixed");

  // keep-original rule
  check("re-encode saving < 10% keeps the original", afterEncode(p, 100_000, 95_000).keepOriginal + "", "true");
  check("re-encode saving >= 10% uses the new file", afterEncode(p, 100_000, 60_000).keepOriginal + "", "false");
  check("forced conversions are kept even if larger", afterEncode(webp, 10_000, 20_000).keepOriginal + "", "false");

  // lengths
  check(
    "lengths: \\linewidth, \\textwidth, cm, mm, pt, bare \\columnwidth",
    [lengthIn("0.5\\linewidth", 3.5, "two-column"), lengthIn(".8\\textwidth", 3.5, "two-column"), lengthIn("2.54cm", 3.5, "two-column"), lengthIn("25.4mm", 3.5, "two-column"), lengthIn("72.27pt", 3.5, "two-column"), lengthIn("\\columnwidth", 3.5, "two-column")].map((x) => (x ?? -1).toFixed(3)).join(" "),
    "1.750 5.728 1.000 1.000 1.000 3.500",
  );
  check("lengths: nonsense is null, not a throw", String(lengthIn("\\foo", 3.5, "one-column")) + " " + String(lengthIn("abc", 3.5, "one-column")), "null null");

  // tex parsing
  const tex = [
    {
      path: "main.tex",
      text: String.raw`\graphicspath{{fig/}}
\begin{figure}\includegraphics[width=0.5\linewidth]{plot}\end{figure}
\begin{figure*}\includegraphics[width=\linewidth]{photo.png}\end{figure*}
\begin{figure}\begin{subfigure}[b]{0.5\linewidth}\includegraphics[width=\linewidth]{fig/a}\end{subfigure}\end{figure}
% \includegraphics[width=\textwidth]{small}
\includegraphics[scale=0.5]{b.jpg}`,
    },
  ];
  const w = texWidths(tex, ["fig/plot.png", "fig/photo.png", "fig/a.png", "fig/small.png", "fig/b.jpg"], "two-column");
  const show = (k: string) => (w.get(k)?.widthIn ?? 0).toFixed(2);
  check("\\graphicspath + no extension + fraction of \\linewidth", show("fig/plot.png"), "1.75");
  check("figure* in two-column is full text width", show("fig/photo.png"), "7.16");
  check("\\linewidth inside a subfigure is the subfigure's width", show("fig/a.png"), "1.75");
  check("commented-out \\includegraphics is ignored", w.has("fig/small.png") ? "found" : "absent", "absent");
  check("scale= recorded for later", String(w.get("fig/b.jpg")?.scale), "0.5");

  const plans = planProject([{ ...photo }, { ...small }, { ...plot }], tex, opts);
  check("project: figure* photo printed 7.16 in -> 2148 px", plans[0].targetWidth + " " + plans[0].printSource, "2148 tex");
  check("project: explicit .png reference keeps PNG so \\includegraphics still resolves", plans[0].format + " " + plans[0].outPath, "png fig/photo.png");
  check("project: unreferenced image falls back to the default column width", plans[1].printSource + " " + plans[1].printWidthIn, "default 3.5");
  check("project: one-column layout widens the default", planProject([{ ...plot, path: "x.png" }], [], { ...opts, layout: "one-column" })[0].targetWidth + "", "1950");

  // sniffing
  check("sniff by magic bytes, not the name", [sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), "x.jpg"), sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "x.png"), sniffFormat(bytesOf("%PDF-1.4"), "x"), sniffFormat(bytesOf("hello"), "a.tex")].join(), "png,jpeg,pdf,other");

  finish("imageopt");
}
main();
