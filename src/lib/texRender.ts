/**
 * texRender.ts - a small LaTeX typesetter for the paper preview.
 *
 * Reads a document body (and its preamble, for \newtheorem / \title) into a
 * structured paper: numbered sections, paragraphs of text and inline maths,
 * numbered display maths (rows carry `\tag{n}` so KaTeX prints the numbers),
 * theorem environments, lists, real tables, figures, footnotes and a
 * bibliography - plus a label table that resolves every \ref / \eqref / \cite.
 *
 * It is a reader for well-formed papers, not a TeX engine: unknown commands
 * keep their argument text, unknown environments are transparent, and nothing
 * here ever throws. Pure - the preview renders the result as React elements.
 */

/* ------------------------------------------------------------------ types */

export type Run =
  | { t: "text"; v: string }
  | { t: "math"; v: string }
  | { t: "b" | "i" | "tt" | "sc" | "u" | "sf"; v: Run[] }
  | { t: "cite"; keys: string[] }
  | { t: "ref"; key: string; style: "plain" | "paren" | "auto" }
  | { t: "fn"; n: number }
  | { t: "url"; href: string; v: Run[] }
  | { t: "br" };

export interface Cell {
  runs: Run[];
  span: number;
  align: "l" | "c" | "r";
}

export interface Row {
  cells: Cell[];
  /** Rule drawn above this row: booktabs weights, or a plain \hline. */
  rule: "top" | "mid" | "bottom" | "hline" | null;
}

export type Block =
  | { t: "title"; title: Run[]; authors: Run[][]; date: Run[] | null; src: string }
  | { t: "heading"; level: 1 | 2 | 3 | 4; num: string | null; v: Run[]; id: string; src: string }
  | { t: "p"; v: Run[]; src: string; center?: boolean }
  | { t: "math"; latex: string; tags: string[]; id: string; src: string }
  | { t: "theorem"; name: string; label: string; num: string | null; note: Run[] | null; italic: boolean; body: Block[]; id: string; src: string }
  | { t: "proof"; note: Run[] | null; body: Block[]; src: string }
  | { t: "list"; kind: "itemize" | "enumerate" | "description"; items: Array<{ label: Run[] | null; body: Block[] }>; src: string }
  | { t: "table"; num: string | null; caption: Run[] | null; rows: Row[]; cols: Array<"l" | "c" | "r">; id: string; src: string }
  | { t: "figure"; num: string | null; caption: Run[] | null; images: string[]; id: string; src: string }
  | { t: "algorithm"; num: string | null; caption: Run[] | null; lines: Array<{ depth: number; runs: Run[] }>; id: string; src: string }
  | { t: "abstract"; body: Block[]; src: string }
  | { t: "quote"; body: Block[]; src: string }
  | { t: "code"; v: string; src: string }
  | { t: "bib"; items: Array<{ key: string; num: number; v: Run[] }>; src: string };

export interface LabelTarget {
  /** What \ref prints: "3", "2.1", "A". */
  text: string;
  kind: "equation" | "section" | "table" | "figure" | "theorem" | "algorithm" | "item";
  /** Name for \autoref / \cref: "Section", "Table", "Lemma". */
  name: string;
  /** Anchor id of the block it points to. */
  id: string;
}

export interface Paper {
  blocks: Block[];
  labels: Record<string, LabelTarget>;
  /** Cite key -> number, by bibliography order or first citation. */
  cites: Record<string, number>;
  footnotes: Run[][];
  toc: Array<{ level: number; num: string | null; text: string; id: string }>;
  stats: { words: number; equations: number; tables: number; figures: number };
}

/* ---------------------------------------------------------------- helpers */

/** `{...}` at `i` (after optional spaces): [content, indexAfter], or null. */
function group(s: string, i: number): [string, number] | null {
  let k = i;
  while (k < s.length && (s[k] === " " || s[k] === "\n" || s[k] === "\t")) k++;
  if (s[k] !== "{") return null;
  let depth = 0;
  for (let j = k; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) return [s.slice(k + 1, j), j + 1];
  }
  return null;
}

/** `[...]` at `i` (after optional spaces), respecting nested braces. */
function optional(s: string, i: number): [string, number] | null {
  let k = i;
  while (k < s.length && (s[k] === " " || s[k] === "\t")) k++;
  if (s[k] !== "[") return null;
  let depth = 0;
  for (let j = k + 1; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}") depth--;
    else if (s[j] === "]" && depth === 0) return [s.slice(k + 1, j), j + 1];
  }
  return null;
}

/** Index just past the `\end{name}` matching a `\begin{name}` whose body starts at `from`. */
function envEnd(s: string, from: number, name: string): { bodyEnd: number; after: number } | null {
  const re = new RegExp("\\\\(begin|end)\\s*\\{" + name.replace(/\*/g, "\\*") + "\\}", "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return { bodyEnd: m.index, after: m.index + m[0].length };
  }
  return null;
}

/** Split at top-level occurrences of `sep` (outside braces and nested environments). */
function splitTop(s: string, sep: "\\\\" | "&"): string[] {
  const out: string[] = [];
  let depth = 0;
  let env = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("\\begin", i)) env++;
    else if (s.startsWith("\\end", i)) env--;
    const c = s[i];
    if (c === "\\") {
      if (sep === "\\\\" && s[i + 1] === "\\" && depth === 0 && env === 0) {
        out.push(s.slice(last, i));
        const opt = /^\\\\(\*)?(\s*\[[^\]]*\])?/.exec(s.slice(i))![0];
        i += opt.length - 1;
        last = i + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "&" && sep === "&" && depth === 0 && env === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

/** Remove `%` comments (keeping `\%`), leaving verbatim-like environments alone. */
export function stripComments(src: string): string {
  const keep: string[] = [];
  const NUL = String.fromCharCode(0);
  const masked = src.replace(/\\begin\{(verbatim|lstlisting|minted|Verbatim)\}[\s\S]*?\\end\{\1\}/g, (m) => {
    keep.push(m);
    return NUL + (keep.length - 1) + NUL;
  });
  const stripped = masked.replace(/(^|[^\\])%[^\n]*/g, "$1");
  return stripped.replace(new RegExp(NUL + "(\\d+)" + NUL, "g"), (_, i: string) => keep[Number(i)]);
}

const ROMAN = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

/* ------------------------------------------------------------- context */

interface Theorem {
  label: string;
  counter: string;
  within: string | null;
  italic: boolean;
}

interface Ctx {
  sec: number[];
  appendix: boolean;
  counters: Record<string, number>;
  eq: number;
  labels: Record<string, LabelTarget>;
  footnotes: Run[][];
  citeOrder: string[];
  theorems: Record<string, Theorem>;
  toc: Paper["toc"];
  ids: number;
  words: number;
  /** Where a stray \label (in a paragraph or theorem) attaches. */
  lastTarget: { text: string; kind: LabelTarget["kind"]; name: string; id: string } | null;
  meta: { title: string | null; authors: string[]; date: string | null };
}

const nextId = (ctx: Ctx, prefix: string) => prefix + "-" + ++ctx.ids;

function sectionNumber(ctx: Ctx, level: number): string {
  const parts = ctx.sec.slice(0, level);
  if (ctx.appendix) return [String.fromCharCode(64 + (parts[0] || 1)), ...parts.slice(1)].join(".");
  return parts.join(".");
}

function bump(ctx: Ctx, counter: string, within: string | null): string {
  ctx.counters[counter] = (ctx.counters[counter] ?? 0) + 1;
  const n = String(ctx.counters[counter]);
  return within === "section" && ctx.sec[0] ? sectionNumber(ctx, 1) + "." + n : n;
}

function setLabel(ctx: Ctx, key: string, target: Ctx["lastTarget"]) {
  if (target) ctx.labels[key.trim()] = { ...target };
}

/* ---------------------------------------------------------- inline runs */

const TEXT_STYLES: Record<string, Run["t"]> = {
  textbf: "b", bfseries: "b", textit: "i", emph: "i", textsl: "i", itshape: "i", texttt: "tt", ttfamily: "tt",
  textsc: "sc", underline: "u", textsf: "sf",
};
const DROP_ARG = /^(label|vspace|hspace|vskip|phantom|hphantom|vphantom|index|addcontentsline|pagenumbering|thispagestyle|setlength|addtolength|bibliographystyle|graphicspath|nocite|captionsetup|includegraphics)$/;
const DROP = /^(noindent|indent|centering|raggedright|raggedleft|small|footnotesize|scriptsize|tiny|large|Large|LARGE|huge|Huge|normalsize|medskip|bigskip|smallskip|newline|linebreak|pagebreak|newpage|clearpage|par|maketitle|hfill|vfill|quad|qquad|protect|relax|null|xspace|ignorespaces|tableofcontents|appendix|bf|it|rm|sf|tt|em|selectfont|nobreak|allowbreak|item|toprule|midrule|bottomrule|hline)$/;
const SYMBOLS: Record<string, string> = {
  ldots: "\u2026", dots: "\u2026", textendash: "\u2013", textemdash: "\u2014", textbullet: "\u2022", S: "\u00A7",
  P: "\u00B6", copyright: "\u00A9", dag: "\u2020", ddag: "\u2021", textasciitilde: "~", textbackslash: "\\",
  LaTeX: "LaTeX", TeX: "TeX", ss: "\u00DF", ae: "\u00E6", o: "\u00F8", aa: "\u00E5", i: "i", textdegree: "\u00B0",
  checkmark: "\u2713", textregistered: "\u00AE", texttrademark: "\u2122", euro: "\u20AC", today: "",
};

export function parseRuns(src: string, ctx: Ctx): Run[] {
  const out: Run[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    // inline maths: $...$ and \(...\)
    if (c === "$" && src[i - 1] !== "\\") {
      const end = src.indexOf("$", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "math", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "\\" && src[i + 1] === "(") {
      const end = src.indexOf("\\)", i + 2);
      if (end > i) {
        flush();
        out.push({ t: "math", v: src.slice(i + 2, end) });
        i = end + 2;
        continue;
      }
    }
    if (c === "\\") {
      const m = /^\\([A-Za-z@]+)\*?|^\\(.)/.exec(src.slice(i));
      if (!m) {
        i++;
        continue;
      }
      const after = i + m[0].length;
      if (m[2] !== undefined) {
        // \\ line break, \% escapes, spacing commands
        if (m[2] === "\\") (flush(), out.push({ t: "br" }));
        else if (" ,;:!/".includes(m[2])) buf += m[2] === "!" ? "" : " ";
        else if (m[2] === "-") buf += "";
        else buf += m[2];
        i = after;
        continue;
      }
      const name = m[1];
      if (SYMBOLS[name] !== undefined) {
        buf += SYMBOLS[name];
        i = after;
        if (src[i] === "{" && src[i + 1] === "}") i += 2;
        continue;
      }
      const opt = optional(src, after);
      const g = group(src, opt ? opt[1] : after);
      const arg = g ? g[0] : null;
      const end = g ? g[1] : opt ? opt[1] : after;
      if (TEXT_STYLES[name] && arg !== null) {
        flush();
        out.push({ t: TEXT_STYLES[name], v: parseRuns(arg, ctx) } as Run);
      } else if (/cite/i.test(name) && arg !== null) {
        flush();
        const keys = arg.split(",").map((k) => k.trim()).filter(Boolean);
        for (const k of keys) if (!ctx.citeOrder.includes(k)) ctx.citeOrder.push(k);
        out.push({ t: "cite", keys });
      } else if (/^(ref|pageref|nameref)$/.test(name) && arg !== null) {
        flush();
        out.push({ t: "ref", key: arg.trim(), style: "plain" });
      } else if (name === "eqref" && arg !== null) {
        flush();
        out.push({ t: "ref", key: arg.trim(), style: "paren" });
      } else if (/^(autoref|cref|Cref|fref|Fref)$/.test(name) && arg !== null) {
        flush();
        for (const [k, key] of arg.split(",").entries()) {
          if (k) out.push({ t: "text", v: ", " });
          out.push({ t: "ref", key: key.trim(), style: "auto" });
        }
      } else if ((name === "footnote" || name === "thanks") && arg !== null) {
        flush();
        ctx.footnotes.push(parseRuns(arg, ctx));
        out.push({ t: "fn", n: ctx.footnotes.length });
      } else if (name === "url" && arg !== null) {
        flush();
        out.push({ t: "url", href: arg, v: [{ t: "text", v: arg }] });
      } else if (name === "href" && arg !== null) {
        const g2 = group(src, end);
        flush();
        out.push({ t: "url", href: arg, v: parseRuns(g2 ? g2[0] : arg, ctx) });
        i = g2 ? g2[1] : end;
        continue;
      } else if (name === "label" && arg !== null) {
        setLabel(ctx, arg, ctx.lastTarget);
      } else if (DROP_ARG.test(name)) {
        /* dropped with its argument */
      } else if (DROP.test(name)) {
        i = after;
        continue;
      } else if (arg !== null) {
        flush();
        out.push(...parseRuns(arg, ctx));
      } else {
        i = after;
        continue;
      }
      i = end;
      continue;
    }
    if (c === "{" || c === "}") {
      i++;
      continue;
    }
    if (c === "~") buf += "\u00A0";
    else if (c === "`" && src[i + 1] === "`") (buf += "\u201C"), i++;
    else if (c === "'" && src[i + 1] === "'") (buf += "\u201D"), i++;
    else if (c === "`") buf += "\u2018";
    else if (c === "'") buf += "\u2019";
    else if (c === "-" && src.startsWith("---", i)) (buf += "\u2014"), (i += 2);
    else if (c === "-" && src[i + 1] === "-") (buf += "\u2013"), i++;
    else if (/\s/.test(c)) {
      if (!buf.endsWith(" ")) buf += " ";
    } else buf += c;
    i++;
  }
  flush();
  return out;
}

const runsText = (runs: Run[]): string =>
  runs
    .map((r) => (r.t === "text" ? r.v : r.t === "math" ? "x" : "v" in r && Array.isArray(r.v) ? runsText(r.v) : ""))
    .join("");

/* -------------------------------------------------------- display maths */

const NUMBERED = /^(equation|align|gather|multline|flalign|alignat|eqnarray)$/;

/**
 * Display maths -> KaTeX-ready source with LaTeX's numbers as \tag{...}, and
 * the labels it defines. Rows with \nonumber / \notag stay unnumbered.
 */
function displayMath(env: string | null, body: string, ctx: Ctx, id: string): { latex: string; tags: string[] } {
  const bare = env ? env.replace(/\*$/, "") : null;
  const numbered = !!bare && NUMBERED.test(bare) && !env!.endsWith("*");
  const tags: string[] = [];
  const takeLabels = (row: string, tag: string | null) => {
    for (const m of row.matchAll(/\\label\s*\{([^}]*)\}/g)) {
      if (tag) ctx.labels[m[1].trim()] = { text: tag, kind: "equation", name: "Equation", id };
    }
  };
  const clean = (row: string) => row.replace(/\\label\s*\{[^}]*\}/g, "").replace(/\\(nonumber|notag)(?![A-Za-z])/g, "");

  const rowTag = (row: string, auto: boolean): string | null => {
    const explicit = /\\tag\*?\s*\{([^}]*)\}/.exec(row);
    if (explicit) return explicit[1];
    if (!auto || /\\(nonumber|notag)(?![A-Za-z])/.test(row)) return null;
    ctx.eq++;
    return String(ctx.eq);
  };

  if (!bare || bare === "equation" || bare === "displaymath") {
    const tag = rowTag(body, numbered);
    takeLabels(body, tag);
    if (tag) tags.push(tag);
    const inner = clean(body).replace(/\\tag\*?\s*\{[^}]*\}/g, "").trim();
    return { latex: inner + (tag ? " \\tag{" + tag + "}" : ""), tags };
  }

  if (bare === "multline") {
    const tag = rowTag(body, numbered);
    takeLabels(body, tag);
    if (tag) tags.push(tag);
    const rows = splitTop(clean(body).replace(/\\tag\*?\s*\{[^}]*\}/g, ""), "\\\\");
    return { latex: "\\begin{gather*}" + rows.join("\\\\") + (tag ? " \\tag{" + tag + "}" : "") + "\\end{gather*}", tags };
  }

  // align / gather / flalign / alignat / eqnarray: number each row.
  const target = bare === "gather" ? "gather*" : "align*";
  let rowsSrc = body;
  if (bare === "alignat") rowsSrc = rowsSrc.replace(/^\s*\{\d+\}/, "");
  const rows = splitTop(rowsSrc, "\\\\").filter((r, k, all) => r.trim() !== "" || k < all.length - 1);
  const out = rows.map((row) => {
    const tag = rowTag(row, numbered);
    takeLabels(row, tag);
    if (tag) tags.push(tag);
    let r = clean(row).replace(/\\tag\*?\s*\{[^}]*\}/g, "");
    if (bare === "eqnarray") r = r.replace(/&\s*([=<>]|\\[a-z]+)\s*&/, "&$1 ");
    return r.trim() + (tag ? " \\tag{" + tag + "}" : "");
  });
  return { latex: "\\begin{" + target + "}" + out.join(" \\\\ ") + "\\end{" + target + "}", tags };
}

/* --------------------------------------------------------------- tables */

function parseColumns(spec: string): Array<"l" | "c" | "r"> {
  const cols: Array<"l" | "c" | "r"> = [];
  const s = spec.replace(/[@!<>]\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "").replace(/\*\{(\d+)\}\{([^{}]*)\}/g, (_, n: string, p: string) => p.repeat(Number(n)));
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "l" || ch === "c" || ch === "r") cols.push(ch);
    else if (ch === "p" || ch === "m" || ch === "b") {
      cols.push("l");
      const g = group(s, i + 1);
      if (g) i = g[1] - 1;
    } else if (ch === "X" || ch === "S") cols.push(ch === "S" ? "c" : "l");
  }
  return cols;
}

function parseTabular(body: string, cols: Array<"l" | "c" | "r">, ctx: Ctx): Row[] {
  const rows: Row[] = [];
  let pending: Row["rule"] = null;
  for (const raw of splitTop(body, "\\\\")) {
    let r = raw;
    // rules at the start of a row describe the line above it
    for (;;) {
      const m = /^\s*\\(toprule|midrule|bottomrule|hline|cmidrule(?:\([^)]*\))?\s*\{[^}]*\}|cline\s*\{[^}]*\})\s*/.exec(r);
      if (!m) break;
      const kind = m[1].startsWith("toprule") ? "top" : m[1].startsWith("bottomrule") ? "bottom" : m[1].startsWith("hline") ? "hline" : "mid";
      pending = pending === "top" ? "top" : kind;
      r = r.slice(m[0].length);
    }
    if (!r.trim()) continue;
    const cells: Cell[] = [];
    for (const [k, cellSrc] of splitTop(r, "&").entries()) {
      const mc = /^\s*\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{([\s\S]*)\}\s*$/.exec(cellSrc);
      if (mc) {
        const a = parseColumns(mc[2])[0] ?? "c";
        cells.push({ runs: parseRuns(mc[3], ctx), span: Number(mc[1]), align: a });
      } else {
        cells.push({ runs: parseRuns(cellSrc.replace(/\\(multirow)\s*\{[^}]*\}\s*\{[^}]*\}/g, ""), ctx), span: 1, align: cols[k] ?? "l" });
      }
    }
    rows.push({ cells, rule: pending });
    pending = null;
  }
  if (pending && rows.length) rows.push({ cells: [], rule: pending });
  return rows;
}

/* ------------------------------------------------------------- blocks */

const SECTION_LEVEL: Record<string, 1 | 2 | 3 | 4> = { chapter: 1, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
const DISPLAY_ENVS = /^(equation|align|gather|multline|flalign|alignat|eqnarray|displaymath|math)\*?$/;
const DEFAULT_THEOREMS = /^(theorem|lemma|proposition|corollary|definition|remark|assumption|example|claim|conjecture|observation|fact|hypothesis|problem|exercise|solution|note|property|notation)\*?$/;

function parseBlocks(src: string, ctx: Ctx): Block[] {
  const blocks: Block[] = [];
  let para = "";
  let paraStart = 0;
  const flushPara = () => {
    const text = para.trim();
    if (text) {
      const runs = parseRuns(text, ctx);
      // A \label or \noindent before the text leaves a space at the edges.
      const first = runs[0];
      if (first?.t === "text") runs[0] = { t: "text", v: first.v.replace(/^\s+/, "") };
      const lastRun = runs[runs.length - 1];
      if (lastRun?.t === "text") runs[runs.length - 1] = { t: "text", v: lastRun.v.replace(/\s+$/, "") };
      if (runs.some((r) => r.t !== "text" || r.v.trim())) {
        blocks.push({ t: "p", v: runs, src: text });
        ctx.words += runsText(runs).split(/\s+/).filter(Boolean).length;
      }
    }
    para = "";
  };

  let i = 0;
  while (i < src.length) {
    // paragraph break
    const blank = /^\n[ \t]*\n/.exec(src.slice(i, i + 64));
    if (blank) {
      flushPara();
      i += blank[0].length;
      continue;
    }
    // display maths: \[ \] and $$ $$
    if (src.startsWith("\\[", i) || src.startsWith("$$", i)) {
      const closer = src.startsWith("\\[", i) ? "\\]" : "$$";
      const end = src.indexOf(closer, i + 2);
      if (end > 0) {
        flushPara();
        const id = nextId(ctx, "eq");
        const raw = src.slice(i + 2, end);
        const inner = /^\s*\\begin\{([A-Za-z]+\*?)\}([\s\S]*)\\end\{\1\}\s*$/.exec(raw);
        const { latex, tags } = displayMath(inner && DISPLAY_ENVS.test(inner[1]) ? inner[1] : null, inner && DISPLAY_ENVS.test(inner[1]) ? inner[2] : raw, ctx, id);
        blocks.push({ t: "math", latex, tags, id, src: src.slice(i, end + 2) });
        i = end + 2;
        continue;
      }
    }
    if (src[i] === "\\") {
      const m = /^\\([A-Za-z]+)(\*?)/.exec(src.slice(i));
      const name = m?.[1] ?? "";

      // sectioning
      if (m && SECTION_LEVEL[name]) {
        const opt = optional(src, i + m[0].length);
        const g = group(src, opt ? opt[1] : i + m[0].length);
        if (g) {
          flushPara();
          const level = SECTION_LEVEL[name];
          let num: string | null = null;
          if (!m[2] && level <= 3) {
            ctx.sec[level - 1] = (ctx.sec[level - 1] ?? 0) + 1;
            ctx.sec.length = level;
            num = sectionNumber(ctx, level);
            if (level === 1) for (const k of Object.keys(ctx.counters)) if (ctx.theorems[k]?.within === "section") ctx.counters[k] = 0;
          }
          const id = nextId(ctx, "sec");
          const v = parseRuns(g[0], ctx);
          blocks.push({ t: "heading", level, num, v, id, src: src.slice(i, g[1]) });
          ctx.toc.push({ level, num, text: runsText(v), id });
          ctx.lastTarget = num ? { text: num, kind: "section", name: ctx.appendix && level === 1 ? "Appendix" : "Section", id } : null;
          i = g[1];
          continue;
        }
      }
      if (name === "appendix") {
        flushPara();
        ctx.appendix = true;
        ctx.sec = [];
        i += m![0].length;
        continue;
      }
      if (name === "maketitle") {
        flushPara();
        if (ctx.meta.title || ctx.meta.authors.length) {
          blocks.push({
            t: "title",
            title: parseRuns(ctx.meta.title ?? "", ctx),
            authors: ctx.meta.authors.map((a) => parseRuns(a, ctx)),
            date: ctx.meta.date !== null ? parseRuns(ctx.meta.date, ctx) : null,
            src: "\\maketitle",
          });
        }
        i += m![0].length;
        continue;
      }
      if (name === "bibliography") {
        const g = group(src, i + m![0].length);
        flushPara();
        i = g ? g[1] : i + m![0].length;
        continue;
      }

      // environments
      if (name === "begin") {
        const em = /^\\begin\s*\{([A-Za-z@]+\*?)\}/.exec(src.slice(i));
        if (em) {
          const env = em[1];
          const bodyStart = i + em[0].length;
          const end = envEnd(src, bodyStart, env);
          if (end) {
            flushPara();
            const body = src.slice(bodyStart, end.bodyEnd);
            const whole = src.slice(i, end.after);
            blocks.push(...envBlocks(env, body, whole, ctx));
            i = end.after;
            continue;
          }
        }
      }
    }
    if (!para) paraStart = i;
    para += src[i];
    i++;
  }
  void paraStart;
  flushPara();
  return blocks;
}

function captionOf(body: string, ctx: Ctx): Run[] | null {
  const m = /\\caption\s*(?:\[[^\]]*\])?\s*\{/.exec(body);
  if (!m) return null;
  const g = group(body, m.index + m[0].length - 1);
  return g ? parseRuns(g[0], ctx) : null;
}

function labelsIn(body: string): string[] {
  return [...body.matchAll(/\\label\s*\{([^}]*)\}/g)].map((m) => m[1].trim());
}

function envBlocks(env: string, body: string, whole: string, ctx: Ctx): Block[] {
  const bare = env.replace(/\*$/, "");

  if (DISPLAY_ENVS.test(env)) {
    const id = nextId(ctx, "eq");
    const { latex, tags } = displayMath(env, body, ctx, id);
    return [{ t: "math", latex, tags, id, src: whole }];
  }

  if (bare === "abstract") return [{ t: "abstract", body: parseBlocks(body, ctx), src: whole }];
  if (/^(quote|quotation|verse)$/.test(bare)) return [{ t: "quote", body: parseBlocks(body, ctx), src: whole }];
  if (/^(verbatim|lstlisting|minted|Verbatim)$/.test(bare)) {
    return [{ t: "code", v: body.replace(/^\s*(\[[^\]]*\])?(\{[^}]*\})?\n?/, "").replace(/\s+$/, ""), src: whole }];
  }
  if (/^(center|flushleft|flushright|minipage|document|small|footnotesize)$/.test(bare)) {
    const inner = parseBlocks(bare === "minipage" ? body.replace(/^\s*(\[[^\]]*\])?\s*\{[^}]*\}/, "") : body, ctx);
    return bare === "center" ? inner.map((b) => (b.t === "p" ? { ...b, center: true } : b)) : inner;
  }

  if (/^(itemize|enumerate|description)$/.test(bare)) {
    const items: Array<{ label: Run[] | null; body: Block[] }> = [];
    // split at top-level \item
    let depth = 0;
    let last = -1;
    const starts: number[] = [];
    for (let k = 0; k < body.length; k++) {
      if (body.startsWith("\\begin", k)) depth++;
      else if (body.startsWith("\\end", k)) depth--;
      else if (depth === 0 && /^\\item(?![A-Za-z])/.test(body.slice(k, k + 6))) starts.push(k);
    }
    for (const [n, s] of starts.entries()) {
      const e = n + 1 < starts.length ? starts[n + 1] : body.length;
      let itemSrc = body.slice(s + 5, e);
      let label: Run[] | null = null;
      const opt = optional(itemSrc, 0);
      if (opt) {
        label = parseRuns(opt[0], ctx);
        itemSrc = itemSrc.slice(opt[1]);
      }
      const target = bare === "enumerate" ? { text: String(n + 1), kind: "item" as const, name: "Item", id: nextId(ctx, "item") } : null;
      const prev = ctx.lastTarget;
      if (target) ctx.lastTarget = target;
      items.push({ label, body: parseBlocks(itemSrc, ctx) });
      ctx.lastTarget = prev;
      last = e;
    }
    void last;
    return [{ t: "list", kind: bare as "itemize" | "enumerate" | "description", items, src: whole }];
  }

  if (bare === "table" || bare === "figure" || bare === "algorithm") {
    const kind = bare;
    const id = nextId(ctx, kind);
    const hasCaption = /\\caption/.test(body);
    const num = hasCaption ? bump(ctx, kind, null) : null;
    const name = kind === "table" ? "Table" : kind === "figure" ? "Figure" : "Algorithm";
    const prev = ctx.lastTarget;
    ctx.lastTarget = num ? { text: num, kind, name, id } : prev;
    for (const key of labelsIn(body)) setLabel(ctx, key, ctx.lastTarget);
    const caption = captionOf(body, ctx);
    let block: Block;
    if (kind === "table") {
      const tab = /\\begin\s*\{(tabular\*?|tabularx|longtable|tabulary|array)\}/.exec(body);
      let rows: Row[] = [];
      let cols: Array<"l" | "c" | "r"> = [];
      if (tab) {
        const start = tab.index + tab[0].length;
        const end = envEnd(body, start, tab[1]);
        let rest = body.slice(start, end ? end.bodyEnd : body.length);
        if (tab[1] === "tabularx" || tab[1] === "tabular*" || tab[1] === "tabulary") {
          const w = group(rest, 0);
          if (w) rest = rest.slice(w[1]);
        }
        const spec = group(rest, 0);
        cols = spec ? parseColumns(spec[0]) : [];
        rows = parseTabular(spec ? rest.slice(spec[1]) : rest, cols, ctx);
      }
      block = { t: "table", num, caption, rows, cols, id, src: whole };
    } else if (kind === "figure") {
      const images = [...body.matchAll(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].map((m) => m[1]);
      block = { t: "figure", num, caption, images, id, src: whole };
    } else {
      block = { t: "algorithm", num, caption, lines: algorithmLines(body, ctx), id, src: whole };
    }
    ctx.lastTarget = prev;
    return [block];
  }

  if (bare === "proof") {
    const opt = optional(body, 0);
    return [{ t: "proof", note: opt ? parseRuns(opt[0], ctx) : null, body: parseBlocks(opt ? body.slice(opt[1]) : body, ctx), src: whole }];
  }

  const th = ctx.theorems[bare] ?? (DEFAULT_THEOREMS.test(env) ? { label: bare.charAt(0).toUpperCase() + bare.slice(1), counter: bare, within: null, italic: /^(theorem|lemma|proposition|corollary|conjecture|claim)$/.test(bare) } : null);
  if (th) {
    const id = nextId(ctx, "thm");
    const num = env.endsWith("*") ? null : bump(ctx, th.counter, th.within);
    const opt = optional(body, 0);
    const prev = ctx.lastTarget;
    ctx.lastTarget = num ? { text: num, kind: "theorem", name: th.label, id } : prev;
    const inner = parseBlocks(opt ? body.slice(opt[1]) : body, ctx);
    ctx.lastTarget = prev;
    return [{ t: "theorem", name: bare, label: th.label, num, note: opt ? parseRuns(opt[0], ctx) : null, italic: th.italic, body: inner, id, src: whole }];
  }

  if (bare === "thebibliography") {
    const items: Array<{ key: string; num: number; v: Run[] }> = [];
    const parts = body.split(/\\bibitem\s*/).slice(1);
    for (const [n, part] of parts.entries()) {
      const opt = optional(part, 0);
      const g = group(part, opt ? opt[1] : 0);
      const key = g ? g[0].trim() : "ref" + (n + 1);
      items.push({ key, num: n + 1, v: parseRuns(g ? part.slice(g[1]) : part, ctx) });
    }
    return [{ t: "bib", items, src: whole }];
  }

  if (/^(figure|table|subfigure|wrapfigure)\*?$/.test(env) === false && /^(tabular|tabularx|array)$/.test(bare)) {
    const spec = group(body, 0);
    const cols = spec ? parseColumns(spec[0]) : [];
    return [{ t: "table", num: null, caption: null, rows: parseTabular(spec ? body.slice(spec[1]) : body, cols, ctx), cols, id: nextId(ctx, "tab"), src: whole }];
  }

  // anything else (subfigure, frame, custom environments): transparent
  return parseBlocks(body.replace(/^\s*(\[[^\]]*\])?(\{[^}]*\})?/, ""), ctx);
}

function algorithmLines(body: string, ctx: Ctx): Array<{ depth: number; runs: Run[] }> {
  const lines: Array<{ depth: number; runs: Run[] }> = [];
  let depth = 0;
  const KEY: Record<string, [string, number, number]> = {
    // command: [keyword, depth change before, depth change after]
    If: ["if", 0, 1], ElsIf: ["else if", -1, 1], Else: ["else", -1, 1], EndIf: ["end if", -1, 0],
    For: ["for", 0, 1], ForAll: ["for all", 0, 1], EndFor: ["end for", -1, 0], While: ["while", 0, 1], EndWhile: ["end while", -1, 0],
    Repeat: ["repeat", 0, 1], Until: ["until", -1, 0], Function: ["function", 0, 1], EndFunction: ["end function", -1, 0],
    Procedure: ["procedure", 0, 1], EndProcedure: ["end procedure", -1, 0], Return: ["return", 0, 0], Require: ["Require:", 0, 0],
    Ensure: ["Ensure:", 0, 0], State: ["", 0, 0], Statex: ["", 0, 0], Comment: ["\u25B7", 0, 0], Input: ["Input:", 0, 0], Output: ["Output:", 0, 0],
  };
  const inner = /\\begin\{algorithmic\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{algorithmic\}/.exec(body)?.[1] ?? body.replace(/\\caption[\s\S]*?\}\s*/, "");
  const re = /\\(If|ElsIf|Else|EndIf|For|ForAll|EndFor|While|EndWhile|Repeat|Until|Function|EndFunction|Procedure|EndProcedure|Return|Require|Ensure|State|Statex|Comment|Input|Output)(?![A-Za-z])/g;
  const marks = [...inner.matchAll(re)];
  for (const [n, m] of marks.entries()) {
    const [kw, before, after] = KEY[m[1]];
    depth = Math.max(0, depth + before);
    const rest = inner.slice(m.index! + m[0].length, n + 1 < marks.length ? marks[n + 1].index : inner.length);
    let args = rest;
    const g = group(rest, 0);
    let runs: Run[] = [];
    if (g && /^(If|ElsIf|For|ForAll|While|Until|Function|Procedure|Comment)$/.test(m[1])) {
      args = rest.slice(g[1]);
      const g2 = m[1] === "Function" || m[1] === "Procedure" ? group(args, 0) : null;
      runs = [...parseRuns(g[0], ctx), ...(g2 ? [{ t: "text" as const, v: "(" }, ...parseRuns(g2[0], ctx), { t: "text" as const, v: ")" }] : [])];
      if (g2) args = args.slice(g2[1]);
      if (/^(If|ElsIf|For|ForAll|While)$/.test(m[1])) runs.push({ t: "b", v: [{ t: "text", v: m[1].startsWith("For") || m[1] === "While" ? " do" : " then" }] });
    }
    const tail = parseRuns(args.trim(), ctx);
    lines.push({ depth, runs: [...(kw ? [{ t: "b" as const, v: [{ t: "text" as const, v: kw + " " }] }] : []), ...runs, ...(tail.length ? [{ t: "text" as const, v: " " }, ...tail] : [])] });
    depth = Math.max(0, depth + after);
  }
  return lines;
}

/* ---------------------------------------------------------------- API */

/** Read title/author/date and \newtheorem declarations from the whole document. */
function readMeta(full: string): { meta: Ctx["meta"]; theorems: Record<string, Theorem> } {
  const text = stripComments(full);
  const arg = (cmd: string) => {
    const m = new RegExp("\\\\" + cmd + "\\s*(?:\\[[^\\]]*\\])?\\s*\\{").exec(text);
    if (!m) return null;
    const g = group(text, m.index + m[0].length - 1);
    return g ? g[0] : null;
  };
  const author = arg("author");
  const theorems: Record<string, Theorem> = {};
  let style = "plain";
  const re = /\\theoremstyle\s*\{([^}]*)\}|\\newtheorem(\*?)\s*\{([^}]*)\}\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}\s*(?:\[([^\]]*)\])?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) {
      style = m[1].trim();
      continue;
    }
    const name = m[3].trim();
    theorems[name] = {
      label: m[5].trim(),
      counter: m[2] ? name + "*" : (m[4] ?? name).trim(),
      within: (m[6] ?? (m[4] ? theorems[m[4].trim()]?.within ?? null : null))?.trim() ?? null,
      italic: style === "plain",
    };
  }
  return {
    meta: { title: arg("title"), authors: author ? author.split(/\\and(?![A-Za-z])/).map((a) => a.trim()) : [], date: arg("date") },
    theorems,
  };
}

/**
 * Typeset a document body. `full` (optional) is the whole document, so the
 * preamble's \title and \newtheorem declarations are known.
 */
export function renderPaper(body: string, full: string = body): Paper {
  const { meta, theorems } = readMeta(full);
  const ctx: Ctx = {
    sec: [], appendix: false, counters: {}, eq: 0, labels: {}, footnotes: [], citeOrder: [], theorems, toc: [], ids: 0, words: 0,
    lastTarget: null, meta,
  };
  let blocks: Block[] = [];
  try {
    blocks = parseBlocks(stripComments(body), ctx);
  } catch {
    blocks = [{ t: "p", v: [{ t: "text", v: "The preview could not read this document." }], src: "" }];
  }
  const bib = blocks.find((b): b is Extract<Block, { t: "bib" }> => b.t === "bib");
  const cites: Record<string, number> = {};
  if (bib) for (const it of bib.items) cites[it.key] = it.num;
  for (const k of ctx.citeOrder) if (cites[k] === undefined) cites[k] = Object.keys(cites).length + 1;
  const count = (t: Block["t"]) => {
    let n = 0;
    const walk = (bs: Block[]) => {
      for (const b of bs) {
        if (b.t === t) n++;
        if ("body" in b && Array.isArray(b.body)) walk(b.body);
        if (b.t === "list") for (const it of b.items) walk(it.body);
      }
    };
    walk(blocks);
    return n;
  };
  return {
    blocks,
    labels: ctx.labels,
    cites,
    footnotes: ctx.footnotes,
    toc: ctx.toc,
    stats: { words: ctx.words, equations: ctx.eq, tables: count("table"), figures: count("figure") },
  };
}

/** What a reference prints, LaTeX-style; "??" when the label does not exist. */
export function refText(paper: Paper, key: string, style: "plain" | "paren" | "auto"): { text: string; ok: boolean } {
  const target = paper.labels[key];
  if (!target) return { text: "??", ok: false };
  if (style === "paren") return { text: "(" + target.text + ")", ok: true };
  if (style === "auto") return { text: target.kind === "equation" ? "Eq.\u00A0(" + target.text + ")" : target.name + "\u00A0" + target.text, ok: true };
  return { text: target.text, ok: true };
}

export { ROMAN };
