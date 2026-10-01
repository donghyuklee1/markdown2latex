/**
 * latexDocument.ts - turn cleaned output into a complete, compilable .tex file.
 *
 * The cleaned output is still markdown around its maths: `# Heading`, `**bold**`,
 * `- lists`. Pasted into Overleaf as-is, a single `#` is a compile error. So for
 * the "Open in Overleaf" / "Download document" path, the prose is converted to
 * LaTeX while the maths - already clean - is passed through untouched:
 *
 *   1. math blocks are swapped for placeholders,
 *   2. the remaining markdown is converted line by line,
 *   3. the maths is put back,
 *   4. it is wrapped in a preamble that loads everything the maths might use.
 *
 * Deliberately a small subset of markdown: the goal is "compiles and reads
 * sensibly", not a typesetting engine.
 */
import { segment } from "./cleaner";

const MASK = String.fromCharCode(0);
const HANGUL = /[가-힣ㄱ-ㆎ]/;
/** Scripts pdfLaTeX cannot typeset without extra packages; XeLaTeX handles them. */
const NEEDS_UNICODE_ENGINE = /[Ͱ-ϿЀ-ӿ぀-ヿ一-鿿가-힣]/;

export type TexEngine = "pdflatex" | "xelatex";

export interface LatexDocument {
  source: string;
  engine: TexEngine;
}

/** Escape LaTeX specials in prose, leaving `\commands` and braces the author wrote. */
function escapeProse(src: string): string {
  return src
    .replace(/(?<!\\)([#%&_$])/g, "\\$1") // a `$` here is one the tokenizer found unclosed
    .replace(/(?<!\\)\^/g, "\\^{}")
    .replace(/(?<!\\)~/g, "\\textasciitilde{}");
}

/** Inline markdown: code, links, bold, italic. Code first, so its contents stay literal. */
function inline(src: string): string {
  const code: string[] = [];
  let out = src.replace(/`([^`\n]+)`/g, (_, c: string) => {
    code.push("\\texttt{" + c.replace(/([\\{}#%&_$^~])/g, (ch) => (ch === "\\" ? "\\textbackslash{}" : ch === "^" || ch === "~" ? "\\" + ch + "{}" : "\\" + ch)) + "}");
    return MASK + "c" + (code.length - 1) + MASK;
  });
  out = escapeProse(out)
    .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, (_, text: string, url: string) => "\\href{" + url.replace(/\\([#%&_])/g, "\\$1") + "}{" + text + "}")
    .replace(/\*\*([^*\n]+)\*\*/g, "\\textbf{$1}")
    .replace(/__([^_\n]+)__/g, "\\textbf{$1}")
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, "\\emph{$1}");
  return out.replace(new RegExp(MASK + "c(\\d+)" + MASK, "g"), (_, i: string) => code[Number(i)]);
}

function convertMarkdown(src: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let list: "itemize" | "enumerate" | null = null;
  let quote = false;

  const closeList = () => {
    if (list) out.push("\\end{" + list + "}");
    list = null;
  };
  const closeQuote = () => {
    if (quote) out.push("\\end{quote}");
    quote = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code: verbatim, untouched, until the closing fence.
    if (/^\s*```/.test(line)) {
      closeList();
      closeQuote();
      out.push("\\begin{verbatim}");
      while (++i < lines.length && !/^\s*```/.test(lines[i])) out.push(lines[i]);
      out.push("\\end{verbatim}");
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      closeList();
      closeQuote();
      const cmd = heading[1].length === 1 ? "section" : heading[1].length === 2 ? "subsection" : "subsubsection";
      out.push("\\" + cmd + "*{" + inline(heading[2]) + "}");
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closeList();
      closeQuote();
      out.push("\\par\\noindent\\rule{\\linewidth}{0.4pt}");
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      closeQuote();
      const kind = bullet ? "itemize" : "enumerate";
      if (list !== kind) {
        closeList();
        out.push("\\begin{" + kind + "}");
        list = kind;
      }
      out.push("  \\item " + inline((bullet ?? numbered)![1]));
      continue;
    }

    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      closeList();
      if (!quote) out.push("\\begin{quote}");
      quote = true;
      out.push(inline(quoted[1]));
      continue;
    }

    // A non-blank line right after a list item continues it; a blank line ends it.
    if (!line.trim()) {
      closeList();
      closeQuote();
      out.push("");
      continue;
    }
    if (!list) closeQuote();
    out.push(inline(line));
  }
  closeList();
  closeQuote();
  return out.join("\n");
}

/**
 * Build a full document from cleaned output - ideally output cleaned in
 * Academic mode, so display maths is already `equation*` / `align*`.
 * Output that is already a whole document is returned unchanged.
 */
export function toLatexDocument(output: string, title = "Clean math"): LatexDocument {
  const engine: TexEngine = NEEDS_UNICODE_ENGINE.test(output) ? "xelatex" : "pdflatex";
  if (/\\documentclass/.test(output)) return { source: output, engine };

  const math: string[] = [];
  let prose = "";
  for (const seg of segment(output)) {
    if (seg.type === "text") {
      prose += seg.value;
    } else {
      math.push(seg.type === "inline" ? "$" + seg.value + "$" : seg.value.startsWith("\\begin") ? seg.value : "\\[" + seg.value + "\\]");
      prose += MASK + "m" + (math.length - 1) + MASK;
    }
  }

  const body = convertMarkdown(prose).replace(new RegExp(MASK + "m(\\d+)" + MASK, "g"), (_, i: string) => math[Number(i)]);

  const preamble = [
    "\\documentclass[11pt]{article}",
    ...(engine === "pdflatex"
      ? ["\\usepackage[utf8]{inputenc}", "\\usepackage[T1]{fontenc}", "\\usepackage{lmodern}"]
      : ["\\usepackage{fontspec}", ...(HANGUL.test(output) ? ["\\usepackage{kotex}"] : [])]),
    "\\usepackage{amsmath,amssymb,amsfonts,mathtools}",
    "\\usepackage{bm}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{hyperref}",
    "",
    "% Generated by markdown2Latex (CleanMath) - " + title,
    "\\begin{document}",
    "",
  ];
  return { source: preamble.join("\n") + body.trim() + "\n\n\\end{document}\n", engine };
}
