/**
 * texDocument.ts - when the input is a whole LaTeX document, not a chat answer.
 *
 * Three jobs, all pure:
 *  - `documentParts`: find the preamble / body / tail, so the cleaner can leave
 *    the preamble exactly as written and the preview can skip it.
 *  - `katexMacros`: turn the preamble's \newcommand / \def / \DeclareMathOperator
 *    into KaTeX's `macros` option, so `\vr{x}` and `\R` render instead of being
 *    reported as undefined control sequences.
 *  - `parseProse`: a small reader for LaTeX *text* (sections, emphasis, cites,
 *    theorem environments, lists) that the preview renders as React elements.
 */
import { maskSource } from "./lab/arxiv";

/* ------------------------------------------------------------------ parts */

export interface DocumentParts {
  /** Offset just after `\begin{document}`. */
  bodyStart: number;
  /** Offset of `\end{document}` (or the text length). */
  bodyEnd: number;
}

export function documentParts(text: string): DocumentParts | null {
  const masked = maskSource(text);
  const begin = /\\begin\s*\{document\}/.exec(masked);
  if (!begin) return /\\documentclass/.test(masked) ? { bodyStart: text.length, bodyEnd: text.length } : null;
  const endMatch = /\\end\s*\{document\}/.exec(masked.slice(begin.index));
  return {
    bodyStart: begin.index + begin[0].length,
    bodyEnd: endMatch ? begin.index + endMatch.index : text.length,
  };
}

export const isDocument = (text: string) => documentParts(text) !== null;

/* ----------------------------------------------------------------- macros */

/** `{...}` starting at `i` (which must be `{`): returns [content, indexAfter]. */
function group(s: string, i: number): [string, number] | null {
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "\\") {
      k++;
      continue;
    }
    if (s[k] === "{") depth++;
    else if (s[k] === "}" && --depth === 0) return [s.slice(i + 1, k), k + 1];
  }
  return null;
}

const skipWs = (s: string, i: number) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

/** Math-mode body: drop `$...$` / `\ensuremath{}` wrappers and `\xspace`. */
function mathBody(body: string): string {
  let b = body.trim().replace(/\\xspace(?![A-Za-z])/g, "");
  const ens = /^\\ensuremath\s*\{([\s\S]*)\}$/.exec(b);
  if (ens) b = ens[1];
  if (/^\$[^$]*\$$/.test(b)) b = b.slice(1, -1);
  return b.trim();
}

/**
 * KaTeX `macros` from a document's definitions. Optional-argument macros
 * (`\newcommand{\x}[2][d]{...}`) are approximated with their default filled
 * in, since KaTeX macros cannot take optional arguments.
 */
export function katexMacros(text: string): Record<string, string> {
  const parts = documentParts(text);
  if (!parts) return {};
  const src = text.slice(0, parts.bodyEnd);
  const masked = maskSource(src);
  const macros: Record<string, string> = {};

  const cmd = /\\(newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator)(\*?)|\\def(?![A-Za-z])|\\let(?![A-Za-z])/g;
  let m: RegExpExecArray | null;
  while ((m = cmd.exec(masked))) {
    let i = skipWs(masked, m.index + m[0].length);
    // The name: {\name} or \name.
    let name: string | null = null;
    if (masked[i] === "{") {
      const g = group(masked, i);
      if (!g) continue;
      name = g[0].trim();
      i = g[1];
    } else {
      const n = /^\\[A-Za-z@]+/.exec(masked.slice(i));
      if (!n) continue;
      name = n[0];
      i += n[0].length;
    }
    if (!/^\\[A-Za-z@]+$/.test(name)) continue;

    if (m[0].startsWith("\\let")) {
      i = skipWs(masked, i);
      if (masked[i] === "=") i = skipWs(masked, i + 1);
      const target = /^\\[A-Za-z@]+|^./.exec(masked.slice(i));
      if (target) macros[name] = target[0];
      continue;
    }

    if (m[1] === "DeclareMathOperator") {
      const g = group(masked, skipWs(masked, i));
      if (g) macros[name] = "\\operatorname" + (m[2] ? "*" : "") + "{" + src.slice(skipWs(masked, i) + 1, g[1] - 1) + "}";
      continue;
    }

    if (m[0].startsWith("\\def")) {
      // \def\x#1#2{...}: parameters up to the body.
      const params = /^(?:#\d)*/.exec(masked.slice(i))?.[0] ?? "";
      i += params.length;
      const g = group(masked, skipWs(masked, i));
      if (g) macros[name] = mathBody(src.slice(skipWs(masked, i) + 1, g[1] - 1));
      continue;
    }

    // \newcommand{\x}[n][default]{body}
    i = skipWs(masked, i);
    let nargs = 0;
    let def: string | null = null;
    const n = /^\[(\d)\]/.exec(masked.slice(i));
    if (n) {
      nargs = Number(n[1]);
      i = skipWs(masked, i + n[0].length);
      if (masked[i] === "[") {
        const close = masked.indexOf("]", i);
        if (close > 0) {
          def = src.slice(i + 1, close);
          i = skipWs(masked, close + 1);
        }
      }
    }
    const g = group(masked, i);
    if (!g) continue;
    let body = mathBody(src.slice(i + 1, g[1] - 1));
    if (def !== null && nargs > 0) {
      body = body.replace(/#1/g, def).replace(/#(\d)/g, (_, d: string) => "#" + (Number(d) - 1));
    }
    if (m[1] === "providecommand" && macros[name]) continue;
    macros[name] = body;
  }
  return macros;
}

/* ------------------------------------------------------------------ prose */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b" | "i" | "code" | "small"; v: Inline[] }
  | { t: "cite"; v: string }
  | { t: "ref"; v: string }
  | { t: "note"; v: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; v: Inline[] }
  | { t: "p"; v: Inline[] }
  | { t: "env"; name: string; title: Inline[] | null; edge: "begin" | "end" }
  | { t: "li"; v: Inline[]; ordered: boolean }
  | { t: "title"; v: Inline[] };

const DROP_WITH_ARG = /^(label|vspace|hspace|bibliographystyle|bibliography|usepackage|setlength|addtolength|thispagestyle|pagestyle|input|include|graphicspath|newcommand|renewcommand)$/;
const DROP_BARE = /^(maketitle|centering|noindent|newpage|clearpage|small|footnotesize|large|Large|normalsize|medskip|bigskip|smallskip|par|tableofcontents|appendix|qed|hfill|vfill|item)$/;
const THEOREMS = /^(theorem|lemma|proposition|corollary|definition|remark|assumption|example|claim|conjecture|proof|abstract|note|problem|exercise|solution|observation|fact|hypothesis|algorithm|figure|table)\*?$/;

/** Inline LaTeX text -> styled runs. Unknown commands keep their argument text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)\*?|^\\(.)/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      if (m[2]) {
        // \\ line break, \% \& \$ \_ \# \{ \} escapes, \, spaces
        if (m[2] === "\\") (flush(), out.push({ t: "br" }));
        else if (m[2] === "," || m[2] === " " || m[2] === ";") buf += " ";
        else buf += m[2];
        i += m[0].length;
        continue;
      }
      const name = m[1];
      let j = i + m[0].length;
      // optional [..] argument, skipped
      if (src[j] === "[") {
        const close = src.indexOf("]", j);
        if (close > 0) j = close + 1;
      }
      const g = group(src, skipWs(src, j));
      const arg = g ? g[0] : null;
      const after = g ? g[1] : j;
      if (/^(textbf|bfseries|mathbf)$/.test(name) && arg !== null) (flush(), out.push({ t: "b", v: parseInline(arg) }));
      else if (/^(emph|textit|textsl|itshape)$/.test(name) && arg !== null) (flush(), out.push({ t: "i", v: parseInline(arg) }));
      else if (/^(texttt|verb|url|path)$/.test(name) && arg !== null) (flush(), out.push({ t: "code", v: [{ t: "text", v: arg }] }));
      else if (/^(textsc|textsf|textrm|textup|text|mbox|textnormal|underline)$/.test(name) && arg !== null) (flush(), out.push(...parseInline(arg)));
      else if (/cite/i.test(name) && arg !== null) (flush(), out.push({ t: "cite", v: arg }));
      else if (/^(ref|eqref|autoref|cref|Cref|pageref|nameref)$/.test(name) && arg !== null) (flush(), out.push({ t: "ref", v: (name === "eqref" ? "(" : "") + arg + (name === "eqref" ? ")" : "") }));
      else if (/^(footnote|thanks)$/.test(name) && arg !== null) (flush(), out.push({ t: "note", v: parseInline(arg) }));
      else if (/^href$/.test(name) && arg !== null) {
        const g2 = group(src, skipWs(src, after));
        flush();
        out.push(...parseInline(g2 ? g2[0] : arg));
        i = g2 ? g2[1] : after;
        continue;
      } else if (DROP_WITH_ARG.test(name)) {
        /* dropped with its argument */
      } else if (DROP_BARE.test(name)) {
        i += m[0].length;
        continue;
      } else if (/^(LaTeX|TeX)$/.test(name)) buf += name === "LaTeX" ? "LaTeX" : "TeX";
      else if (/^(ldots|dots)$/.test(name)) buf += "\u2026";
      else if (arg !== null) (flush(), out.push(...parseInline(arg)));
      i = arg !== null ? after : i + m[0].length;
      continue;
    }
    if (c === "~") buf += "\u00A0";
    else if (c === "`" && src[i + 1] === "`") (buf += "\u201C", i++);
    else if (c === "'" && src[i + 1] === "'") (buf += "\u201D", i++);
    else if (c === "-" && src.slice(i, i + 3) === "---") (buf += "\u2014", (i += 2));
    else if (c === "-" && src[i + 1] === "-") (buf += "\u2013", i++);
    else if (c !== "{" && c !== "}") buf += c;
    i++;
  }
  flush();
  return out;
}

/**
 * LaTeX text (between maths) -> blocks. Line-oriented: headings, theorem-like
 * environment edges and list items are recognised per line; everything else
 * is paragraph text. Comments are removed first.
 */
export function parseProse(src: string): Block[] {
  const text = src.replace(/(^|[^\\])%[^\n]*/g, "$1");
  const blocks: Block[] = [];
  let ordered = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      blocks.push({ t: "p", v: [] });
      continue;
    }
    const h = /^\\(section|subsection|subsubsection|paragraph|chapter)\*?\s*(?:\[[^\]]*\])?\s*\{(.*)\}\s*$/.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1] === "section" || h[1] === "chapter" ? 1 : h[1] === "subsection" ? 2 : 3, v: parseInline(h[2]) });
      continue;
    }
    const title = /^\\title\s*\{(.*)\}\s*$/.exec(line);
    if (title) {
      blocks.push({ t: "title", v: parseInline(title[1]) });
      continue;
    }
    const env = /^\\(begin|end)\s*\{([A-Za-z]+\*?)\}(?:\s*\[([^\]]*)\])?(.*)$/.exec(line);
    if (env) {
      const name = env[2];
      if (name === "itemize" || name === "enumerate" || name === "description") {
        ordered = env[1] === "begin" && name === "enumerate";
        if (env[4].trim()) blocks.push({ t: "p", v: parseInline(env[4]) });
        continue;
      }
      if (THEOREMS.test(name)) {
        blocks.push({ t: "env", name: name.replace(/\*$/, ""), title: env[3] ? parseInline(env[3]) : null, edge: env[1] as "begin" | "end" });
        if (env[4].trim()) blocks.push({ t: "p", v: parseInline(env[4]) });
        continue;
      }
      if (env[1] === "end" || /^(document|center|flushleft|flushright|minipage|algorithmic|tabular)$/.test(name)) {
        if (env[4].trim()) blocks.push({ t: "p", v: parseInline(env[4]) });
        continue;
      }
    }
    const item = /^\\item\s*(?:\[([^\]]*)\])?\s*(.*)$/.exec(line);
    if (item) {
      blocks.push({ t: "li", ordered, v: [...(item[1] ? [{ t: "b" as const, v: parseInline(item[1]) }, { t: "text" as const, v: " " }] : []), ...parseInline(item[2])] });
      continue;
    }
    blocks.push({ t: "p", v: parseInline(line) });
  }
  return blocks;
}
