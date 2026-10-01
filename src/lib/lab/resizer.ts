/**
 * resizer.ts - find display maths and tables that are wider than the column
 * (the source of `Overfull \hbox` in two-column papers) and shrink them.
 *
 * The width of a formula is ESTIMATED, not measured: there is no TeX engine
 * here. The glyph model is deliberately small and deterministic:
 *
 *   - an ordinary glyph (letter, digit, punctuation) is 0.5em; a space in
 *     text is 0.33em; brackets are 0.4em;
 *   - a binary operator or relation, with the space TeX puts around it, 0.9em;
 *   - Greek letters 0.6em (capitals 0.75em); big operators (\sum, \prod)
 *     1.4em in display style; function names (\log, \max) 0.5em per letter
 *     plus a thin space; named spaces (\quad, \,) their real widths;
 *   - sub/superscripts at 0.7 of the current size (0.5 at the second level);
 *     a sub and superscript on one base take the wider of the two; limits
 *     stacked under \sum or \underbrace take max(base, limit);
 *   - \frac = max(numerator, denominator) + 0.2em, with the parts at text size
 *     in display style and script size inline or under \tfrac;
 *   - \sqrt adds 0.85em for the radical; each \left / \right delimiter 0.45em;
 *   - a matrix is the sum of its widest cell per column plus 1em of column
 *     separation, plus its delimiters; an `align` is its widest row;
 *   - a tabular is the sum of the widest cell per column plus 2\tabcolsep
 *     (12pt) per column, with p{} columns at their declared width.
 *
 * Widths are in em and converted to pt at the document's font size
 * (\documentclass[10pt] etc.). Pure; never throws.
 */
import { maskTex, readGroup } from "./flatten";

export type Strategy = "auto" | "resizebox" | "fontsize";

export interface LayoutPreset {
  id: string;
  label: string;
  columnWidthPt: number;
  /** \textwidth, for table* / figure* floats that span both columns. */
  textWidthPt: number;
  fontPt: number;
}

export const LAYOUTS: ReadonlyArray<LayoutPreset> = [
  { id: "two10", label: "Two-column 10pt (IEEE/ACM, ~241pt)", columnWidthPt: 241, textWidthPt: 506, fontPt: 10 },
  { id: "one10", label: "One-column 10pt (article, ~345pt)", columnWidthPt: 345, textWidthPt: 345, fontPt: 10 },
  { id: "one11", label: "One-column 11pt (article, ~360pt)", columnWidthPt: 360, textWidthPt: 360, fontPt: 11 },
];

export interface ResizeOptions {
  columnWidthPt: number;
  /** Defaults to columnWidthPt (one-column layouts). */
  textWidthPt?: number;
  strategy?: Strategy;
  /** Body font size; defaults to \documentclass[NNpt], else 10. */
  fontPt?: number;
}

export type BlockKind = "equation" | "align" | "gather" | "multline" | "display" | "tabular" | "tabularx" | "array";

export interface BlockReport {
  line: number;
  kind: BlockKind;
  /** The environment as written, e.g. "align*", "\\[", "tabular". */
  env: string;
  estimatedWidthPt: number;
  columnWidthPt: number;
  ratio: number;
  action: string;
}

export interface ResizeResult {
  output: string;
  blocks: BlockReport[];
  changes: string[];
  fontPt: number;
}

/* ----------------------------------------------------------- doc settings */

/** Font size from the class options (10pt default, as for article). */
export function documentFontPt(tex: string): number {
  const m = /\\documentclass\s*\[([^\]]*)\]/.exec(maskTex(tex).masked);
  const pt = m && /(?:^|,)\s*(\d+(?:\.\d+)?)pt\s*(?:,|$)/.exec(m[1]);
  return pt ? parseFloat(pt[1]) : 10;
}

/** Guess the layout preset from the class: IEEEtran, acmart sigconf, or [twocolumn]. */
export function detectLayout(tex: string): string {
  const m = maskTex(tex).masked;
  const cls = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(m);
  if (!cls) return "two10";
  const opts = cls[1] ?? "";
  if (cls[2] === "IEEEtran" || (cls[2] === "acmart" && /sigconf|sigplan|sigchi/.test(opts)) || /twocolumn/.test(opts)) return "two10";
  return /11pt/.test(opts) ? "one11" : "one10";
}

/** Relative size of \small etc. at each base size (the LaTeX size tables). */
function sizeScale(cmd: string, base: number): number {
  const table: Record<string, [number, number, number]> = {
    normalsize: [10, 10.95, 12],
    small: [9, 10, 10.95],
    footnotesize: [8, 9, 10],
    scriptsize: [7, 8, 8],
    tiny: [5, 6, 6],
  };
  const row = table[cmd];
  if (!row) return 1;
  const col = base >= 12 ? 2 : base >= 11 ? 1 : 0;
  return row[col] / [10, 10.95, 12][col];
}

const SHRINK_SIZES = ["small", "footnotesize", "scriptsize"] as const;

/* -------------------------------------------------------------- the model */

type Style = "display" | "text" | "script" | "scriptscript";
const STYLE_SCALE: Record<Style, number> = { display: 1, text: 1, script: 0.7, scriptscript: 0.5 };
const smaller = (s: Style): Style => (s === "display" || s === "text" ? "script" : "scriptscript");
const fracInner = (s: Style): Style => (s === "display" ? "text" : smaller(s));

const SPACES: Record<string, number> = { ",": 0.17, ":": 0.22, ">": 0.22, ";": 0.28, "!": -0.17, " ": 0.33, quad: 1, qquad: 2, enspace: 0.5, thinspace: 0.17, medspace: 0.22, thickspace: 0.28 };
const ZERO = new Set([
  "nonumber", "notag", "displaybreak", "allowbreak", "limits", "nolimits", "hfill", "mathstrut", "strut", "centering", "relax", "nobreak", "noindent",
  "label", "tag", "color", "vphantom", "intertext", "shortintertext", "hline", "Hline",
]);
const ONE_ARG_ZERO = new Set(["label", "tag", "color", "vphantom", "intertext", "shortintertext"]);
const OPERATORS = new Set([
  "pm", "mp", "times", "div", "cdot", "ast", "star", "circ", "bullet", "oplus", "ominus", "otimes", "odot", "cup", "cap", "wedge", "vee", "setminus", "land", "lor",
  "leq", "le", "geq", "ge", "neq", "ne", "approx", "sim", "simeq", "cong", "equiv", "propto", "in", "notin", "ni", "subset", "subseteq", "supset", "supseteq",
  "to", "gets", "rightarrow", "leftarrow", "Rightarrow", "Leftarrow", "leftrightarrow", "Leftrightarrow", "iff", "implies", "mapsto", "ll", "gg", "prec", "succ",
  "preceq", "succeq", "perp", "parallel", "mid", "vdash", "models", "triangleq", "coloneqq", "doteq", "lesssim", "gtrsim",
]);
const LONG_ARROWS = new Set(["longrightarrow", "longleftarrow", "Longrightarrow", "Longleftarrow", "longmapsto", "longleftrightarrow", "Longleftrightarrow"]);
const BIG_OPS = new Set(["sum", "prod", "coprod", "bigcup", "bigcap", "bigoplus", "bigotimes", "bigvee", "bigwedge", "bigsqcup", "biguplus"]);
const INTEGRALS = new Set(["int", "iint", "iiint", "oint"]);
const LIMIT_FUNCS = new Set(["lim", "max", "min", "sup", "inf", "limsup", "liminf", "det", "Pr", "gcd", "argmax", "argmin"]);
const FUNCS = new Set(["log", "ln", "exp", "sin", "cos", "tan", "sec", "csc", "cot", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "arg", "ker", "dim", "deg", "hom", "lg", "Tr", "tr"]);
const ARG_AS_IS = new Set([
  "mathbf", "mathrm", "mathit", "mathsf", "mathtt", "mathbb", "mathcal", "mathfrak", "mathscr", "boldsymbol", "bm", "pmb", "hat", "widehat", "bar", "overline",
  "underline", "tilde", "widetilde", "vec", "dot", "ddot", "check", "breve", "acute", "grave", "mathring", "phantom", "hphantom", "overrightarrow", "overleftarrow",
  "boxed", "cancel", "mathop", "mathbin", "mathrel", "mathord", "mathopen", "mathclose", "mathpunct", "smash", "ensuremath",
]);
const TEXT_CMDS = new Set(["text", "textrm", "textbf", "textit", "textsf", "texttt", "textnormal", "mbox", "emph", "textup", "hbox"]);
const FRACS = new Set(["frac", "dfrac", "tfrac", "cfrac", "binom", "dbinom", "tbinom", "genfrac"]);
const DELIM_SIZES: Record<string, number> = { big: 0.45, Big: 0.55, bigg: 0.65, Bigg: 0.75 };
const MATRIX_DELIMS: Record<string, number> = { matrix: 0, pmatrix: 0.9, bmatrix: 0.9, Bmatrix: 1, vmatrix: 0.6, Vmatrix: 0.9, smallmatrix: 0 };
const GREEK = /^(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|ell|hbar|partial|nabla|infty|emptyset|varnothing)$/;
const GREEK_CAP = /^(Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|forall|exists)$/;

type Tok = { k: "cmd"; v: string } | { k: "ch"; v: string } | { k: "grp"; v: string } | { k: "env"; name: string; arg: string; body: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (c === "\\") {
      if (/[A-Za-z]/.test(s[i + 1] ?? "")) {
        let j = i + 1;
        while (j < n && /[A-Za-z]/.test(s[j])) j++;
        const name = s.slice(i + 1, j);
        if (name === "begin") {
          const g = readGroup(s, j);
          if (g) {
            const env = g.value.trim();
            let pos = g.end;
            let arg = "";
            if (/^(array|alignedat|subarray|alignat\*?)$/.test(env)) {
              const a = readGroup(s, pos);
              if (a) {
                arg = a.value;
                pos = a.end;
              }
            }
            const end = matchEnd(s, env, pos);
            out.push({ k: "env", name: env, arg, body: s.slice(pos, end.bodyEnd) });
            i = end.end;
            continue;
          }
        }
        out.push({ k: "cmd", v: name });
        i = j;
        continue;
      }
      out.push({ k: "cmd", v: s[i + 1] ?? "" });
      i += 2;
      continue;
    }
    if (c === "{") {
      const g = readGroup(s, i);
      if (g) {
        out.push({ k: "grp", v: g.value });
        i = g.end;
        continue;
      }
      i++;
      continue;
    }
    if (c === "}" || /\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "%") {
      const nl = s.indexOf("\n", i);
      i = nl < 0 ? n : nl;
      continue;
    }
    out.push({ k: "ch", v: c });
    i++;
  }
  return out;
}

/** Position of the `\end{env}` matching an already-consumed `\begin{env}`. */
function matchEnd(s: string, env: string, from: number): { bodyEnd: number; end: number } {
  const esc = env.replace(/\*/g, "\\*");
  const re = new RegExp("\\\\(begin|end)\\s*\\{" + esc + "\\}", "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return { bodyEnd: m.index, end: m.index + m[0].length };
  }
  return { bodyEnd: s.length, end: s.length };
}

/** Split at top level (outside braces and nested environments) on `\\` or `&`. */
export function splitTop(s: string, sep: "\\\\" | "&"): string[] {
  const out: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      if (s.startsWith("\\begin", i)) envDepth++;
      else if (s.startsWith("\\end", i)) envDepth--;
      else if (sep === "\\\\" && s[i + 1] === "\\" && depth === 0 && envDepth === 0) {
        out.push(s.slice(last, i));
        let j = i + 2;
        const opt = /^\s*\[[^\]]*\]/.exec(s.slice(j));
        if (opt) j += opt[0].length;
        last = j;
        i = j - 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "&" && sep === "&" && depth === 0 && envDepth === 0) {
      out.push(s.slice(last, i));
      last = i + 1;
    }
  }
  out.push(s.slice(last));
  return out;
}

const textCharsWidth = (s: string) => {
  let w = 0;
  for (const ch of s.replace(/\\[A-Za-z]+\s*/g, "").replace(/[{}$\\]/g, "")) w += /\s/.test(ch) ? 0.33 : 0.5;
  return w;
};

/** Width in em of a math string, at `style`. */
export function mathWidthEm(src: string, style: Style = "display"): number {
  return seqWidth(tokenize(src), style);
}

function argWidth(t: Tok | undefined, style: Style): number {
  if (!t) return 0;
  return seqWidth(t.k === "grp" ? tokenize(t.v) : [t], style);
}

function seqWidth(toks: Tok[], startStyle: Style): number {
  let style = startStyle;
  let w = 0;
  /** Width of the last base whose scripts stack (limits), or null. */
  let stack: number | null = null;
  let stackMax = 0;
  let lastScript: { type: string; w: number } | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const sc = STYLE_SCALE[style];
    if (t.k === "ch" && (t.v === "^" || t.v === "_")) {
      const sw = argWidth(toks[++i], smaller(style));
      if (stack !== null) {
        // Limits sit above/below the operator: only the overhang adds width.
        w += Math.max(0, sw - stackMax);
        stackMax = Math.max(stackMax, sw);
      } else if (lastScript && lastScript.type !== t.v) {
        w += Math.max(0, sw - lastScript.w);
        lastScript = null;
      } else {
        w += sw;
        lastScript = { type: t.v, w: sw };
      }
      continue;
    }
    if (!(t.k === "ch" && t.v === "'")) lastScript = null;
    stack = null;

    if (t.k === "ch") {
      const c = t.v;
      if ("+-=<>".includes(c)) w += 0.9 * sc;
      else if (c === ":") w += 0.9 * sc;
      else if (c === "," || c === ";") w += 0.45 * sc;
      else if ("()[]|".includes(c)) w += 0.4 * sc;
      else if (c === "." || c === "!" || c === "'") w += 0.28 * sc;
      else if (c === "~") w += 0.33 * sc;
      else if (c === "&") w += 0;
      else w += 0.5 * sc;
      continue;
    }
    if (t.k === "grp") {
      w += seqWidth(tokenize(t.v), style);
      continue;
    }
    if (t.k === "env") {
      w += envWidth(t.name, t.arg, t.body, style);
      continue;
    }
    const v = t.v;
    if (v in SPACES) w += SPACES[v] * sc;
    else if (v === "displaystyle") style = "display";
    else if (v === "textstyle") style = "text";
    else if (v === "scriptstyle") style = "script";
    else if (v === "scriptscriptstyle") style = "scriptscript";
    else if (ONE_ARG_ZERO.has(v)) {
      if (toks[i + 1]?.k === "grp") i++;
    } else if (ZERO.has(v)) {
      /* zero width */
    } else if (FRACS.has(v)) {
      const inner = v === "dfrac" || v === "dbinom" || v === "cfrac" ? "text" : v === "tfrac" || v === "tbinom" ? smaller(style === "display" ? "text" : style) : fracInner(style);
      if (v === "genfrac") i += 4;
      const a = argWidth(toks[++i], inner);
      const b = argWidth(toks[++i], inner);
      w += Math.max(a, b) + 0.2 * sc + (v.includes("binom") ? 0.8 * sc : 0);
    } else if (v === "sqrt") {
      const next = toks[i + 1];
      if (next?.k === "ch" && next.v === "[") {
        let idx = "";
        i += 2;
        while (i < toks.length && !(toks[i].k === "ch" && (toks[i] as { v: string }).v === "]")) {
          const tk = toks[i];
          idx += tk.k === "ch" ? tk.v : "x";
          i++;
        }
        w += Math.max(0, idx.length * 0.5 * 0.5 - 0.3) * sc;
      }
      w += argWidth(toks[++i], style) + 0.85 * sc;
    } else if (v === "left" || v === "right" || v === "middle") {
      const d = toks[++i];
      w += d && d.k === "ch" && d.v === "." ? 0 : 0.45 * sc;
    } else if (/^(big|Big|bigg|Bigg)[lmr]?$/.test(v)) {
      i++;
      w += DELIM_SIZES[v.replace(/[lmr]$/, "")] * sc;
    } else if (TEXT_CMDS.has(v)) {
      const a = toks[++i];
      w += (a ? textWidthEm(a.k === "grp" ? a.v : a.k === "ch" ? a.v : "x") : 0) * sc;
    } else if (v === "operatorname") {
      if (toks[i + 1]?.k === "ch" && (toks[i + 1] as { v: string }).v === "*") i++;
      w += argWidth(toks[++i], style) + 0.17 * sc;
    } else if (v === "underbrace" || v === "overbrace" || v === "underset" || v === "overset" || v === "stackrel") {
      if (v === "underbrace" || v === "overbrace") {
        const a = argWidth(toks[++i], style);
        w += a;
        stack = a;
        stackMax = a;
      } else {
        const top = argWidth(toks[++i], smaller(style));
        const base = argWidth(toks[++i], style);
        w += Math.max(top, base);
      }
      continue;
    } else if (ARG_AS_IS.has(v)) {
      w += argWidth(toks[++i], style);
    } else if (BIG_OPS.has(v)) {
      const ow = (style === "display" ? 1.4 : 1.0) * sc;
      w += ow + 0.17 * sc;
      if (style === "display") {
        stack = ow;
        stackMax = ow;
      }
      continue;
    } else if (INTEGRALS.has(v)) {
      w += (style === "display" ? 1.0 : 0.6) * sc * (v === "iint" ? 1.6 : v === "iiint" ? 2.2 : 1) + 0.17 * sc;
    } else if (LIMIT_FUNCS.has(v)) {
      const ow = (v.length * 0.5 + 0.17) * sc;
      w += ow;
      if (style === "display") {
        stack = ow;
        stackMax = ow;
      }
      continue;
    } else if (FUNCS.has(v)) w += (v.length * 0.5 + 0.17) * sc;
    else if (OPERATORS.has(v)) w += 0.9 * sc;
    else if (LONG_ARROWS.has(v)) w += 1.6 * sc;
    else if (GREEK.test(v)) w += 0.6 * sc;
    else if (GREEK_CAP.test(v)) w += 0.75 * sc;
    else if (v === "cdots" || v === "ldots" || v === "dots" || v === "vdots" || v === "ddots" || v === "cdotp") w += (v === "vdots" ? 0.4 : 1.2) * sc;
    else if (v === "\\" || v === "&") w += 0;
    else if (v === "{" || v === "}" || v === "langle" || v === "rangle" || v === "lvert" || v === "rvert" || v === "|" || v === "lfloor" || v === "rfloor" || v === "lceil" || v === "rceil") w += 0.45 * sc;
    else w += 0.6 * sc;
  }
  return w;
}

/** Width of a text-mode string (table cells, \text{}): 0.5em glyphs, 0.33em spaces, $..$ as inline maths. */
export function textWidthEm(s: string): number {
  let w = 0;
  const parts = s.split(/(\$[^$]*\$|\\\([^]*?\\\))/);
  for (const p of parts) {
    if (/^\$|^\\\(/.test(p)) {
      w += mathWidthEm(p.replace(/^\$|\$$|^\\\(|\\\)$/g, ""), "text");
      continue;
    }
    let t = p
      .replace(/\\(?:cite[tp]?|citep|citet)\*?\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, "[00]")
      .replace(/\\(?:ref|eqref|cref|Cref)\s*\{[^}]*\}/g, "00")
      .replace(/\\(?:hline|toprule|midrule|bottomrule|centering|raggedright|raggedleft|small|footnotesize|scriptsize|tiny|bfseries|itshape|normalsize|large|Large)(?![A-Za-z])/g, "")
      .replace(/\\(?:cline|cmidrule)\s*(?:\([^)]*\))?\s*\{[^}]*\}/g, "")
      .replace(/\\(?:rowcolor|cellcolor|color)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, "")
      .replace(/\\[%&_#$]/g, "x")
      .replace(/~/g, " ")
      .replace(/\\(?:quad)/g, "  ");
    // \makecell{a \\ b} and friends: the widest line.
    if (/\\\\/.test(t)) {
      w += Math.max(...t.split(/\\\\/).map(textCharsWidth));
      continue;
    }
    t = t.replace(/\s+/g, " ").trim();
    w += textCharsWidth(t);
  }
  return w;
}

function envWidth(name: string, arg: string, body: string, style: Style): number {
  const sc = STYLE_SCALE[style];
  const base = name.replace(/\*$/, "");
  const rows = splitTop(body, "\\\\").filter((r) => r.trim());
  if (base in MATRIX_DELIMS || base === "array" || base === "subarray") {
    const small = base === "smallmatrix";
    const cellStyle: Style = small ? smaller(style) : style === "display" ? "text" : style;
    const cols: number[] = [];
    for (const r of rows)
      splitTop(r, "&").forEach((cell, k) => {
        cols[k] = Math.max(cols[k] ?? 0, mathWidthEm(cell, cellStyle));
      });
    const n = cols.length;
    const sep = (small ? 0.5 : 1) * sc;
    const inner = cols.reduce((a, b) => a + b, 0) + Math.max(0, n - 1) * sep;
    if (base === "array") return inner + sep + (arg.match(/\|/g)?.length ?? 0) * 0.05;
    return inner + (MATRIX_DELIMS[base] ?? 0) * sc;
  }
  if (base === "cases" || base === "dcases" || base === "rcases") {
    const cols: number[] = [];
    for (const r of rows) splitTop(r, "&").forEach((cell, k) => (cols[k] = Math.max(cols[k] ?? 0, mathWidthEm(cell, base === "dcases" ? "display" : style === "display" ? "text" : style))));
    return 0.6 * sc + cols.reduce((a, b) => a + b, 0) + Math.max(0, cols.length - 1) * sc;
  }
  // aligned, split, gathered, alignedat, multlined, and anything else: the widest row.
  return rowsWidth(rows, style);
}

/** The widest row; in alignment rows each pair of columns after the first adds 1em. */
function rowsWidth(rows: string[], style: Style): number {
  let max = 0;
  for (const r of rows) {
    const cells = splitTop(r, "&");
    const pairs = Math.max(0, Math.ceil(cells.length / 2) - 1);
    max = Math.max(max, cells.reduce((a, c) => a + mathWidthEm(c, style), 0) + pairs * STYLE_SCALE[style]);
  }
  return max;
}

/* ------------------------------------------------------- tables */

function dimToPt(d: string, columnPt: number, textPt: number): number | null {
  const m = /^\s*(-?\d*\.?\d+)?\s*(pt|cm|mm|in|em|ex|bp|\\linewidth|\\columnwidth|\\textwidth|\\hsize)\s*$/.exec(d);
  if (!m) return null;
  const k = m[1] === undefined ? 1 : parseFloat(m[1]);
  const unit: Record<string, number> = { pt: 1, bp: 1.00375, cm: 28.4528, mm: 2.84528, in: 72.27, em: 10, ex: 4.3, "\\linewidth": columnPt, "\\columnwidth": columnPt, "\\hsize": columnPt, "\\textwidth": textPt };
  return k * unit[m[2]];
}

interface ColSpec {
  /** Declared width in pt (p/m/b columns), or null for natural-width columns. */
  fixed: Array<number | null>;
  x: boolean[];
  /** Vertical rules and @{} adjustments, in pt. */
  extraPt: number;
}

function parseColSpec(spec: string, columnPt: number, textPt: number): ColSpec {
  const out: ColSpec = { fixed: [], x: [], extraPt: 0 };
  let s = spec;
  // Expand *{n}{spec} first; bounded so a malformed spec cannot loop.
  for (let guard = 0; guard < 20 && /\*\s*\{/.test(s); guard++)
    s = s.replace(/\*\s*\{\s*(\d+)\s*\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/, (_m, n: string, inner: string) => inner.repeat(Math.min(50, parseInt(n, 10))));
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[lcrXSJLCR]/.test(c)) {
      out.fixed.push(null);
      out.x.push(c === "X" || c === "L" || c === "C" || c === "R" || c === "J");
      i++;
    } else if (/[pmbw]/.test(c)) {
      // w{align}{width} has the width second; p/m/b{width} first.
      const g = c === "w" ? readGroup(s, readGroup(s, i + 1)?.end ?? i + 1) : readGroup(s, i + 1);
      out.fixed.push(g ? dimToPt(g.value, columnPt, textPt) : null);
      out.x.push(false);
      i = g ? g.end : i + 1;
    } else if (c === "|") {
      out.extraPt += 0.4;
      i++;
    } else if (c === "@" || c === "!" || c === ">" || c === "<") {
      const g = readGroup(s, i + 1);
      if (c === "@") out.extraPt += -6 + (g ? textWidthEm(g.value) * 10 : 0);
      i = g ? g.end : i + 1;
    } else i++;
  }
  return out;
}

/** Natural width (pt) of a tabular body under `spec`. */
function tabularWidthPt(spec: string, body: string, fontPt: number, scale: number, columnPt: number, textPt: number): number {
  const cs = parseColSpec(spec, columnPt, textPt);
  const n = Math.max(1, cs.fixed.length);
  const cols = new Array<number>(n).fill(0);
  const rows = splitTop(body.replace(/\\tabularnewline/g, "\\\\"), "\\\\");
  for (const r of rows) {
    let k = 0;
    for (const cell of splitTop(r, "&")) {
      const mc = /^\s*\\multicolumn\s*\{\s*(\d+)\s*\}\s*\{[^{}]*\}\s*\{([^]*)\}\s*$/.exec(cell);
      if (mc) {
        const span = Math.max(1, parseInt(mc[1], 10));
        const each = (textWidthEm(mc[2]) * fontPt * scale - (span - 1) * 12) / span;
        for (let j = 0; j < span && k + j < n; j++) cols[k + j] = Math.max(cols[k + j], each);
        k += span;
        continue;
      }
      if (k < n) cols[k] = Math.max(cols[k], textWidthEm(cell) * fontPt * scale);
      k++;
    }
  }
  const content = cols.reduce((a, w, k) => a + (cs.fixed[k] ?? (cs.x[k] ? 0 : w)), 0);
  return content + n * 12 + cs.extraPt;
}

/* ------------------------------------------------------------ the scan */

const MATH_ENVS = /^(equation|align|gather|multline|displaymath|eqnarray|flalign)\*?$/;
const TABLE_ENVS = /^(tabular|tabularx|tabular\*|tabulary)$/;
const SCALERS = /\\(?:resizebox|scalebox|adjustbox)\*?|\\begin\s*\{adjustbox\}/;

interface Block {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  env: string;
  kind: BlockKind;
  /** tabular column spec / tabularx width. */
  spec?: string;
  width?: string;
  /** Inside table* / figure*: measured against \textwidth. */
  wide: boolean;
  /** Inside a float environment (table, figure, ...): font size switches are scoped. */
  inFloat: boolean;
  scaled: boolean;
  fontScale: number;
  sizeCmd?: string;
}

function kindOf(env: string): BlockKind {
  const b = env.replace(/\*$/, "");
  if (b === "equation" || b === "displaymath" || env === "\\[" || env === "$$") return env === "\\[" || env === "$$" || b === "displaymath" ? "display" : "equation";
  if (b === "align" || b === "flalign" || b === "eqnarray") return "align";
  if (b === "gather") return "gather";
  if (b === "multline") return "multline";
  if (b === "tabularx" || b === "tabulary" || env === "tabular*") return "tabularx";
  if (b === "array") return "array";
  return "tabular";
}

function findBlocks(masked: string, base: number): Block[] {
  const blocks: Block[] = [];
  const scaledRanges: Array<[number, number]> = [];
  // Every \resizebox/\scalebox/\adjustbox argument, and adjustbox environments.
  const sre = /\\(resizebox|scalebox|adjustbox)\*?/g;
  let m: RegExpExecArray | null;
  while ((m = sre.exec(masked))) {
    let pos = m.index + m[0].length;
    const nGroups = m[1] === "resizebox" ? 3 : 2;
    let last: { start: number; end: number } | null = null;
    for (let k = 0; k < nGroups; k++) {
      const opt = /^\s*\[[^\]]*\]/.exec(masked.slice(pos));
      if (opt) pos += opt[0].length;
      const g = readGroup(masked, pos);
      if (!g) break;
      last = g;
      pos = g.end;
    }
    if (last) scaledRanges.push([last.start, last.end]);
  }
  const floats: Array<{ start: number; end: number; wide: boolean; name: string }> = [];
  const envRe = /\\begin\s*\{([^{}]+)\}/g;
  envRe.lastIndex = base;
  while ((m = envRe.exec(masked))) {
    const env = m[1].trim();
    const after = m.index + m[0].length;
    if (env === "adjustbox") {
      const e = matchEnd(masked, env, after);
      scaledRanges.push([after, e.end]);
      continue;
    }
    if (/^(table|figure|table\*|figure\*|wraptable|sidewaystable)$/.test(env)) {
      const e = matchEnd(masked, env, after);
      floats.push({ start: m.index, end: e.end, wide: env.endsWith("*"), name: env });
      continue;
    }
    const isMath = MATH_ENVS.test(env);
    const isTable = TABLE_ENVS.test(env);
    const isArray = env === "array";
    if (!isMath && !isTable && !isArray) continue;
    let bodyStart = after;
    let spec: string | undefined;
    let width: string | undefined;
    if (isTable || isArray) {
      if (env !== "tabular" && env !== "array") {
        const wg = readGroup(masked, bodyStart);
        if (wg) {
          width = wg.value.trim();
          bodyStart = wg.end;
        }
      }
      const opt = /^\s*\[[^\]]*\]/.exec(masked.slice(bodyStart));
      if (opt) bodyStart += opt[0].length;
      const sg = readGroup(masked, bodyStart);
      if (sg) {
        spec = sg.value;
        bodyStart = sg.end;
      }
    }
    const e = matchEnd(masked, env, bodyStart);
    blocks.push({ start: m.index, end: e.end, bodyStart, bodyEnd: e.bodyEnd, env, kind: kindOf(env), spec, width, wide: false, inFloat: false, scaled: false, fontScale: 1 });
    if (isMath) envRe.lastIndex = e.end;
  }
  // \[ ... \] and $$ ... $$
  const dre = /\\\[|\$\$/g;
  dre.lastIndex = base;
  while ((m = dre.exec(masked))) {
    if (m[0] === "\\[" && masked[m.index - 1] === "\\") continue;
    const close = m[0] === "\\[" ? "\\]" : "$$";
    const endAt = masked.indexOf(close, m.index + 2);
    if (endAt < 0) break;
    blocks.push({ start: m.index, end: endAt + 2, bodyStart: m.index + 2, bodyEnd: endAt, env: m[0], kind: "display", wide: false, inFloat: false, scaled: false, fontScale: 1 });
    dre.lastIndex = endAt + 2;
  }
  blocks.sort((a, b) => a.start - b.start);
  // Keep outermost blocks only; an array is a block only outside maths (i.e. in a table).
  const top: Block[] = [];
  for (const b of blocks) {
    if (top.some((t) => b.start >= t.start && b.end <= t.end)) continue;
    if (b.kind === "array") {
      const fl = floats.find((f) => b.start > f.start && b.end < f.end && f.name.startsWith("table"));
      if (!fl) continue;
    }
    top.push(b);
  }
  for (const b of top) {
    const fl = floats.find((f) => b.start > f.start && b.end < f.end);
    b.wide = !!fl?.wide;
    b.inFloat = !!fl;
    b.scaled = scaledRanges.some(([s, e]) => b.start >= s && b.end <= e) || SCALERS.test(masked.slice(b.bodyStart, b.bodyEnd));
    // A size switch already in force: the last one in the enclosing float before the
    // block, or the innermost of the `{\small` groups opened right before it.
    const before = fl ? masked.slice(fl.start, b.start) : (/(?:\{\s*\\(?:normalsize|small|footnotesize|scriptsize|tiny)(?![A-Za-z])\s*)+$/.exec(masked.slice(Math.max(0, b.start - 200), b.start))?.[0] ?? "");
    const sizes = [...before.matchAll(/\\(normalsize|small|footnotesize|scriptsize|tiny)(?![A-Za-z])/g)];
    if (sizes.length) b.sizeCmd = sizes[sizes.length - 1][1];
  }
  return top;
}

/* --------------------------------------------------------------- fixing */

const LABEL_RE = /\\(?:label|tag\*?)\s*\{[^{}]*\}/g;

function lineAt(text: string, idx: number): number {
  let n = 1;
  for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function resizeOverflow(tex: string, options: ResizeOptions): ResizeResult {
  const columnPt = options.columnWidthPt > 0 ? options.columnWidthPt : 241;
  const textPt = options.textWidthPt && options.textWidthPt > 0 ? options.textWidthPt : columnPt;
  const strategy = options.strategy ?? "auto";
  const fontPt = options.fontPt && options.fontPt > 0 ? options.fontPt : documentFontPt(tex);
  const { masked } = maskTex(tex);
  const docStart = /\\begin\s*\{document\}/.exec(masked);
  const base = docStart ? docStart.index + docStart[0].length : 0;

  const blocks = findBlocks(masked, base);
  const reports: BlockReport[] = [];
  const changes: string[] = [];
  const edits: Array<{ start: number; end: number; rep: string }> = [];
  let usedResizebox = false;

  for (const b of blocks) {
    const limit = b.wide ? textPt : columnPt;
    const scale = b.sizeCmd ? sizeScale(b.sizeCmd, fontPt) : 1;
    const body = masked.slice(b.bodyStart, b.bodyEnd);
    let est: number;
    if (b.kind === "tabular" || b.kind === "tabularx" || b.kind === "array") {
      const natural = tabularWidthPt(b.spec ?? "", body, fontPt, scale, limit, textPt);
      const declared = b.width ? dimToPt(b.width, limit, textPt) : null;
      est = declared !== null ? Math.max(declared, b.kind === "tabularx" ? natural : 0) : natural;
    } else {
      const rows = splitTop(body, "\\\\").filter((r) => r.trim());
      est = (rows.length > 1 ? rowsWidth(rows, "display") : mathWidthEm(body, "display")) * fontPt * scale;
    }
    est = Math.round(est * 10) / 10;
    const ratio = Math.round((est / limit) * 1000) / 1000;
    const report: BlockReport = { line: lineAt(tex, b.start), kind: b.kind, env: b.env, estimatedWidthPt: est, columnWidthPt: limit, ratio, action: "fits" };
    reports.push(report);
    if (b.scaled) {
      report.action = "already scaled";
      continue;
    }
    if (ratio <= 1) continue;

    const isTable = b.kind === "tabular" || b.kind === "tabularx" || b.kind === "array";
    const isMulti = b.kind === "align" || b.kind === "gather" || b.kind === "multline";
    const numbered = !b.env.endsWith("*") && b.env !== "\\[" && b.env !== "$$" && b.env !== "displaymath";
    const rawBody = tex.slice(b.bodyStart, b.bodyEnd);
    const rows = splitTop(masked.slice(b.bodyStart, b.bodyEnd), "\\\\").filter((r) => r.trim());
    const numberedRows = numbered ? (isMulti ? rows.filter((r) => !/\\(nonumber|notag)(?![A-Za-z])/.test(r)).length : 1) : 0;

    let want: "resizebox" | "fontsize" = strategy === "fontsize" ? "fontsize" : strategy === "resizebox" ? "resizebox" : ratio <= 1.15 ? "fontsize" : "resizebox";
    let why = "";
    if (want === "resizebox" && isMulti && numberedRows > 1) {
      want = "fontsize";
      why = " (each line is numbered; one \\resizebox would merge the numbers)";
    }
    if (want === "resizebox" && (b.kind === "tabularx" || b.env === "eqnarray" || b.env.startsWith("flalign"))) {
      want = "fontsize";
      why = b.kind === "tabularx" ? " (tabularx sets its own width)" : " (" + b.env + " cannot go in a box)";
    }
    const where = "Line " + report.line + ": " + b.env + " ~" + Math.round(est) + "pt > " + limit + "pt (" + Math.round(ratio * 100) + "%)";

    if (want === "fontsize") {
      // Pick the largest size that fits, from the size the block is in now.
      const unscaled = est / scale;
      const current = b.sizeCmd ? sizeScale(b.sizeCmd, fontPt) : 1;
      const pick = SHRINK_SIZES.find((s) => unscaled * sizeScale(s, fontPt) <= limit) ?? "scriptsize";
      if (sizeScale(pick, fontPt) >= current - 1e-9) {
        report.action = "none (already \\" + b.sizeCmd + ")";
        changes.push(where + ": already \\" + b.sizeCmd + " and still too wide - split it by hand.");
        continue;
      }
      const fits = unscaled * sizeScale(pick, fontPt) <= limit;
      report.action = "\\" + pick + why;
      if (isTable && b.inFloat) {
        const ls = tex.lastIndexOf("\n", b.start - 1) + 1;
        const indent = /^[ \t]*/.exec(tex.slice(ls))![0];
        edits.push({ start: ls, end: ls, rep: indent + "\\" + pick + "\n" });
      } else {
        edits.push({ start: b.start, end: b.end, rep: "{\\" + pick + "\n" + tex.slice(b.start, b.end) + "\n}" });
      }
      changes.push(where + ": set in \\" + pick + why + (fits ? "." : " - still too wide; consider splitting it."));
      continue;
    }

    usedResizebox = true;
    if (isTable) {
      const target = b.wide ? "\\textwidth" : "\\columnwidth";
      const lead = /[ \t]*$/.exec(tex.slice(tex.lastIndexOf("\n", b.start - 1) + 1, b.start))![0];
      edits.push({ start: b.start, end: b.end, rep: "\\resizebox{" + target + "}{!}{%\n" + lead + tex.slice(b.start, b.end) + "%\n" + lead + "}" });
      report.action = "\\resizebox{" + target + "}";
      changes.push(where + ": wrapped in \\resizebox{" + target + "}{!}{...}.");
      continue;
    }
    // Maths: labels and tags must stay outside the box; split/aligned rows go into `aligned`.
    const labels = rawBody.match(LABEL_RE) ?? [];
    let content = rawBody.replace(LABEL_RE, "").replace(/\\(nonumber|notag)(?![A-Za-z])/g, "");
    content = content.replace(/\\(begin|end)\s*\{split\}/g, "\\$1{aligned}").trim();
    const boxWidth = numberedRows ? "0.92\\columnwidth" : "\\columnwidth";
    const indent = "  ";
    let inner: string;
    if (isMulti) {
      const innerEnv = b.kind === "align" ? "aligned" : "gathered";
      // multline puts rows flush left/right; gathered centres them - noted in changes.
      inner = "\\begin{" + innerEnv + "}\n" + content.replace(/^/gm, indent + indent) + "\n" + indent + "\\end{" + innerEnv + "}";
    } else inner = content;
    const box = indent + "\\resizebox{" + boxWidth + "}{!}{$\\displaystyle " + inner + "$}" + (labels.length ? "\n" + indent + labels.join(" ") : "");
    let rep: string;
    if (isMulti) rep = numberedRows ? "\\begin{equation}\n" + box + "\n\\end{equation}" : "\\[\n" + box + "\n\\]";
    else rep = tex.slice(b.start, b.bodyStart).replace(/\s+$/, "") + "\n" + box + "\n" + tex.slice(b.bodyEnd, b.end).replace(/^\s+/, "");
    edits.push({ start: b.start, end: b.end, rep });
    report.action = "\\resizebox{" + boxWidth + "}";
    changes.push(where + ": scaled with \\resizebox{" + boxWidth + "}{!}" + (isMulti ? " around an " + (b.kind === "align" ? "aligned" : "gathered") + " block" + (b.kind === "multline" ? " (multline's left/right placement becomes centred)" : "") : "") + (numberedRows ? ", label kept on the equation" : "") + ".");
  }

  // Apply edits back to front so offsets stay valid.
  let output = tex;
  for (const e of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, e.start) + e.rep + output.slice(e.end);

  if (usedResizebox) {
    const pre = maskTex(output).masked;
    const docClass = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(pre);
    const hasGraphicx = /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*\b(graphicx|graphics|adjustbox)\b[^}]*\}/.test(pre.slice(0, base));
    if (docClass && !hasGraphicx && docClass[1].trim() !== "acmart") {
      const at = docClass.index + docClass[0].length;
      const eol = output.indexOf("\n", at);
      const pos = eol < 0 ? output.length : eol;
      output = output.slice(0, pos) + "\n\\usepackage{graphicx} % for \\resizebox (added by auto-resizer)" + output.slice(pos);
      changes.push("Added \\usepackage{graphicx} for \\resizebox.");
    }
  }
  return { output, blocks: reports, changes, fontPt };
}
