/**
 * exporters.ts - every way a result leaves the page: clipboard, files, an
 * image, and Overleaf. DOM-bound by nature, so it lives beside the components
 * rather than in lib/.
 */
import katex from "katex";
import { prepareForKatex, segment } from "@/lib/cleaner";
import { KATEX_OPTIONS } from "@/lib/katexOptions";
import type { LatexDocument } from "@/lib/latexDocument";

/** Clipboard write with a fallback for browsers that refuse the async API. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      ta.remove();
    }
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Give the browser a tick to start the download before the URL is revoked.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, filename: string): void {
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
}

/** Only the maths, one block per paragraph - for pasting into an existing .tex. */
export function mathOnly(output: string): string {
  return segment(output)
    .filter((s) => s.type !== "text")
    .map((s) => (s.type === "inline" ? "$" + s.value.trim() + "$" : s.value.trim().startsWith("\\begin") ? s.value.trim() : "\\[\n" + s.value.trim() + "\n\\]"))
    .join("\n\n");
}

/* ------------------------------------------------------------------ Overleaf */

/**
 * Overleaf's documented "open a snippet" endpoint takes a form POST and opens
 * a new project in a new tab. This is the one place text leaves the browser,
 * and only on an explicit click.
 */
export function openInOverleaf(doc: LatexDocument, projectName: string): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = "https://www.overleaf.com/docs";
  form.target = "_blank";
  form.rel = "noopener noreferrer";
  form.style.display = "none";
  const field = (name: string, value: string) => {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  };
  field("encoded_snip", encodeURIComponent(doc.source));
  field("snip_name", projectName);
  field("engine", doc.engine);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

/* --------------------------------------------------------------------- image */

const token = (name: string) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();
  return v ? "rgb(" + v + ")" : "";
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

let katexCss: Promise<string> | null = null;

/**
 * KaTeX's stylesheet with its fonts inlined as data URIs. An SVG drawn into a
 * canvas cannot load external files, so this is the price of an image that
 * looks exactly like the preview. The font files are this site's own static
 * assets - the one same-origin `fetch` in the app, and it carries no user text.
 * Built once, on the first image export.
 */
function loadKatexCss(): Promise<string> {
  katexCss ??= (async () => {
    const parts: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // a cross-origin sheet; KaTeX's is bundled with ours
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          if (!/KaTeX/.test(rule.style.getPropertyValue("font-family"))) continue;
          const url = /url\(["']?([^"')]+\.woff2)["']?\)/.exec(rule.style.getPropertyValue("src"))?.[1];
          if (!url) continue;
          const data = await blobToDataUrl(await (await fetch(new URL(url, sheet.href ?? location.href))).blob());
          parts.push(rule.cssText.replace(/src:[^;]+;?/, 'src: url("' + data + '") format("woff2");'));
        } else if (rule.cssText.includes(".katex")) {
          parts.push(rule.cssText);
        }
      }
    }
    return parts.join("\n");
  })();
  // A failed attempt should not be cached forever.
  katexCss.catch(() => (katexCss = null));
  return katexCss;
}

/**
 * Render the live preview to a PNG with no library: the same KaTeX HTML the
 * preview shows, inside an SVG <foreignObject> with KaTeX's CSS and fonts
 * inlined, drawn onto a canvas at 2-3x for crisp pasting into slides.
 */
export async function renderPreviewPng(output: string, fontSize: number): Promise<Blob> {
  const css = await loadKatexCss();
  const background = token("surface");
  const root = document.createElement("div");
  root.style.cssText = [
    "position:fixed", "left:-10000px", "top:0", "box-sizing:border-box", "display:inline-block", "max-width:900px",
    "padding:28px 32px", "line-height:1.6",
    "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif",
    "font-size:" + (fontSize + 4) + "px", "color:" + token("muted"), "background:" + background,
  ].join(";");
  const style = document.createElement("style");
  style.textContent = css + "\n.katex{color:" + token("math") + "}.katex-display{margin:.5em 0;overflow:visible}";
  root.appendChild(style);

  for (const seg of segment(output)) {
    if (seg.type === "text") {
      const span = document.createElement("span");
      span.style.whiteSpace = "pre-wrap";
      span.textContent = seg.value;
      root.appendChild(span);
      continue;
    }
    const holder = document.createElement(seg.type === "display" ? "div" : "span");
    // Fourth justified HTML sink (see AGENTS.md): renderToString output with
    // `trust` off, the same argument as Katex.tsx. It never reaches the live page.
    holder.innerHTML = katex.renderToString(prepareForKatex(seg.value), {
      ...KATEX_OPTIONS,
      throwOnError: false,
      output: "html",
      displayMode: seg.type === "display",
    });
    root.appendChild(holder);
  }

  document.body.appendChild(root);
  try {
    await document.fonts.ready;
    const { width, height } = root.getBoundingClientRect();
    // A little slack: text inside an SVG image can lay out a hair wider than it
    // measured here, which would wrap the last word onto a line of its own.
    const w = Math.ceil(width) + 3;
    const h = Math.ceil(height);
    // Pin the measured size, then drop the off-screen positioning: inside the
    // SVG the box must lay out exactly as it was measured.
    root.style.width = w + "px";
    root.style.position = "static";
    root.style.left = "";
    const xhtml = new XMLSerializer().serializeToString(root);
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
      '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' + xhtml + "</foreignObject></svg>";

    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    // Fonts inside an SVG image load asynchronously after decode; give them a beat.
    await new Promise((r) => setTimeout(r, 60));

    const scale = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    ctx.scale(scale, scale);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas export failed"))), "image/png"),
    );
  } finally {
    root.remove();
  }
}

/** Put a PNG on the clipboard. The blob is passed as a promise so Safari keeps the user gesture. */
export async function copyPng(png: Promise<Blob>): Promise<void> {
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
