/**
 * symbols.ts - inventory every math symbol in a paper and find where (if
 * anywhere) the prose defines it.
 *
 * The pain: reviewers flag "what is $\tau$?" because a symbol was used three
 * sections before - or without - its definition, and venues that want a
 * "List of Symbols" leave authors to compile it by hand. This module reads the
 * math with the engine's own tokenizer, groups occurrences by symbol (base
 * plus decoration, so `x_i`, `x_{t+1}` and `x^2` are all `x` but `\hat{y}` is
 * not `y`), scans the surrounding prose for definitions ("where $x$ is ...",
 * "let $x$ be ...", "$x \in \mathbb{R}^d$"), and prints the result as a
 * table, `nomencl` entries or markdown.
 *
 * Pure: no DOM, no I/O. Heuristic by nature - it reports, it never edits.
 */
import { tokenize, type Token } from "../cleaner";

/* ------------------------------------------------------------------- types */

export type SymbolSort = "appearance" | "alpha";
export type SymbolFormat = "table" | "nomenclature" | "markdown";
export type SymbolKind = "latin" | "greek" | "other";

export interface SymbolOptions {
  sort: SymbolSort;
  /** Hide e, i, \pi and the number sets. */
  excludeConstants: boolean;
  /** Hide i, j, k, l, m, n, t when they only ever appear in subscripts. */
  excludeIndices: boolean;
}

export const DEFAULT_SYMBOL_OPTIONS: SymbolOptions = { sort: "appearance", excludeConstants: true, excludeIndices: true };

export interface SymbolInfo {
  /** Canonical LaTeX, e.g. `\hat{y}`, `\mathbf{W}`, `x`, `\theta`. */
  latex: string;
  kind: SymbolKind;
  count: number;
  firstLine: number;
  /** The math block of the first use, shortened. */
  sample: string;
  defined: boolean;
  /** Short definition text (LaTeX), empty when none could be extracted. */
  description: string;
  defLine: number | null;
  /**
   * How the definition was found: prose ("where $x$ is"), apposition ("the
   * learning rate $\eta$"), a type ($x \in ...$), or `:=` / "where $x = ...$".
   */
  via: "prose" | "apposition" | "typed" | "assign" | null;
  indexOnly: boolean;
  constant: boolean;
}

export interface SymbolReport {
  symbols: SymbolInfo[];
  stats: { symbols: number; defined: number; undefined: number; hidden: number; mathBlocks: number };
  issues: { line: number; message: string }[];
}

/* ------------------------------------------------------------------ tables */

const GREEK_ORDER = [
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu",
  "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
];
const GREEK = new Set<string>([
  ...GREEK_ORDER,
  ...GREEK_ORDER.map((g) => g[0].toUpperCase() + g.slice(1)),
  "varepsilon", "vartheta", "varkappa", "varpi", "varrho", "varsigma", "varphi",
  "varGamma", "varDelta", "varTheta", "varLambda", "varXi", "varPi", "varSigma", "varUpsilon", "varPhi", "varPsi", "varOmega",
]);
const FONTS = new Set(["mathbf", "boldsymbol", "bm", "mathcal", "mathbb", "mathscr", "mathfrak", "mathsf", "mathit", "mathbfit", "pmb", "symbf", "vb"]);
const DECORATIONS = new Set([
  "hat", "widehat", "bar", "overline", "tilde", "widetilde", "vec", "dot", "ddot", "check", "breve", "acute", "grave",
  "mathring", "underline", "overrightarrow",
]);
/** Commands whose argument is not math: blanked before scanning. */
const BLANKED = new Set([
  "text", "textrm", "textbf", "textit", "textsf", "texttt", "textnormal", "textup", "mbox", "hbox", "operatorname",
  "mathrm", "label", "tag", "ref", "eqref", "cite", "citep", "citet", "hspace", "vspace", "color", "begin", "end",
  "intertext", "shortintertext", "textcolor", "phantom", "hphantom", "vphantom", "mathop",
]);
/** Letter runs written without a backslash that are function names, not products of symbols. */
const FUNCTION_WORDS = new Set([
  "sin", "cos", "tan", "sec", "csc", "cot", "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "log", "ln", "lg",
  "exp", "max", "min", "sup", "inf", "lim", "arg", "argmax", "argmin", "det", "tr", "Tr", "diag", "rank", "span",
  "dim", "ker", "deg", "gcd", "lcm", "Pr", "var", "Var", "cov", "Cov", "softmax", "sigmoid", "relu", "ReLU", "mod",
  "sgn", "sign", "erf", "logit", "KL", "MSE", "const",
]);
const CONSTANTS = new Set(["e", "i", "\\pi", "\\mathbb{R}", "\\mathbb{N}", "\\mathbb{Z}", "\\mathbb{Q}", "\\mathbb{C}", "\\mathcal{O}"]);
const INDEX_LETTERS = new Set(["i", "j", "k", "l", "m", "n", "t"]);

/* ---------------------------------------------------------------- scanning */

interface Occ {
  id: string;
  kind: SymbolKind;
  /** Innermost letter or Greek name, for sorting. */
  base: string;
  start: number;
  end: number;
  script: "none" | "sub" | "sup";
}

function braceEnd(s: string, open: number, to = s.length): number {
  let depth = 0;
  for (let i = open; i < to; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

const spaces = (s: string) => s.replace(/[^\n]/g, " ");

/** Replace `\text{...}`, `\label{...}`, environment names etc. with spaces, keeping offsets. */
function blankIgnored(m: string): string {
  let out = m;
  const re = /\\([a-zA-Z]+)\*?/g;
  let hit: RegExpExecArray | null;
  while ((hit = re.exec(out))) {
    const name = hit[1];
    if (!BLANKED.has(name)) continue;
    let j = hit.index + hit[0].length;
    // \begin{array}{cc}: the column spec goes too.
    const args = name === "begin" && /^\s*\{(array|tabular|alignat\*?|alignedat)\}/.test(out.slice(j)) ? 2 : 1;
    for (let a = 0; a < args; a++) {
      while (j < out.length && out[j] === " ") j++;
      if (out[j] === "{") {
        const e = braceEnd(out, j);
        j = e === -1 ? out.length : e;
      } else if (j < out.length && name !== "begin" && name !== "end") j++;
    }
    out = out.slice(0, hit.index) + spaces(out.slice(hit.index, j)) + out.slice(j);
    re.lastIndex = j;
  }
  return out;
}

interface Arg {
  start: number;
  end: number;
  innerStart: number;
  innerEnd: number;
}

/** The next macro argument at `i`: a brace group, a control word, or one character. */
function readArg(s: string, i: number, to: number): Arg | null {
  while (i < to && /\s/.test(s[i])) i++;
  if (i >= to) return null;
  if (s[i] === "{") {
    const e = braceEnd(s, i, to);
    const end = e === -1 ? to : e;
    return { start: i, end, innerStart: i + 1, innerEnd: e === -1 ? to : e - 1 };
  }
  if (s[i] === "\\") {
    const m = /^\\([a-zA-Z]+|.)/.exec(s.slice(i, to));
    const end = i + (m ? m[0].length : 1);
    return { start: i, end, innerStart: i, innerEnd: end };
  }
  return { start: i, end: i + 1, innerStart: i, innerEnd: i + 1 };
}

const TRANSPOSE = /^\s*(T|\\top|\\intercal|\\mathsf\s*\{\s*T\s*\}|\\mathbf\s*\{\s*T\s*\}|\\prime|'|\*|\\ast|\\star|\\dagger|-1|\s*)\s*$/;

/** `d` in `dx`, `d\theta`, or `\frac{d}{dt}`: a differential, not a symbol. */
function isDifferential(s: string, p: number, runEnd: number, to: number): boolean {
  if (s[p] !== "d") return false;
  if (runEnd - p === 2 && !/[A-Za-z]/.test(s[runEnd] ?? "")) return true;
  if (runEnd - p === 1) {
    const g = /^\\([a-zA-Z]+)/.exec(s.slice(runEnd, to));
    if (g && GREEK.has(g[1])) return true;
    if (s.slice(Math.max(0, p - 6), p) === "\\frac{") return true;
  }
  return false;
}

/** Scan [from, to) of an already-blanked math string for symbol occurrences. */
function scan(s: string, from: number, to: number, script: Occ["script"], out: Occ[]): void {
  let i = from;
  while (i < to) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(s.slice(i, to));
      if (!m) {
        i += 2;
        continue;
      }
      const name = m[1];
      const j = i + m[0].length;
      if (FONTS.has(name) || DECORATIONS.has(name)) {
        const a = readArg(s, j, to);
        if (!a) {
          i = j;
          continue;
        }
        const inner = innerSymbol(s, a);
        if (inner) out.push({ id: "\\" + name + "{" + inner.id + "}", kind: inner.kind, base: inner.base, start: i, end: a.end, script });
        i = a.end;
        continue;
      }
      if (GREEK.has(name)) out.push({ id: "\\" + name, kind: "greek", base: name, start: i, end: j, script });
      else if (name === "ell") out.push({ id: "\\ell", kind: "latin", base: "l", start: i, end: j, script });
      i = j;
      continue;
    }
    if (c === "_" || c === "^") {
      const a = readArg(s, i + 1, to);
      if (!a) {
        i++;
        continue;
      }
      if (!(c === "^" && TRANSPOSE.test(s.slice(a.innerStart, a.innerEnd)))) {
        scan(s, a.innerStart, a.innerEnd, script !== "none" ? script : c === "_" ? "sub" : "sup", out);
      }
      i = a.end;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < to && /[A-Za-z]/.test(s[j])) j++;
      const run = s.slice(i, j);
      const isWord = (run.length >= 2 && FUNCTION_WORDS.has(run)) || (run.length >= 4 && /^[a-z]+$/.test(run));
      if (!isWord) {
        for (let p = i; p < j; p++) {
          if (p === i && isDifferential(s, p, j, to)) continue;
          out.push({ id: s[p], kind: "latin", base: s[p], start: p, end: p + 1, script });
        }
      }
      i = j;
      continue;
    }
    i++;
  }
}

/** What a font or decoration command wraps: one symbol, or a short literal like `AB`. */
function innerSymbol(s: string, a: Arg): { id: string; kind: SymbolKind; base: string } | null {
  const sub: Occ[] = [];
  scan(s, a.innerStart, a.innerEnd, "none", sub);
  const main = sub.filter((o) => o.script === "none");
  if (main.length === 1 && sub.length === 1) return main[0];
  const content = s.slice(a.innerStart, a.innerEnd).replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]/.test(content)) return null;
  if (main.length === 1) return main[0];
  return { id: content, kind: "other", base: content };
}

/** Symbol occurrences in one math string (offsets refer to that string). */
export function scanMath(math: string): Occ[] {
  const out: Occ[] = [];
  const b = blankIgnored(math);
  scan(b, 0, b.length, "none", out);
  return out;
}

/* ------------------------------------------------------- definition heads */

const REL = /\\in(?![a-zA-Z])|\\subseteq?(?![a-zA-Z])|\\sim(?![a-zA-Z])|:=|\\coloneqq|\\triangleq|\\doteq|\\stackrel\s*\{[^}]*\}\s*\{=\}|\\overset\s*\{[^}]*\}\s*\{=\}|(?<![<>!=])=(?!=)/;

/**
 * The symbols a math snippet names on its own: `x_i` -> x, `x, y` -> x and y,
 * `W \in \mathbb{R}^{d}` -> W (typed), `f(x)` -> f. Anything more complex
 * (`x + y`) names nothing.
 */
export function heads(math: string): { ids: string[]; rel: "typed" | "assign" | "equals" | null; rhs: string } {
  const b = blankIgnored(math);
  const occs: Occ[] = [];
  scan(b, 0, b.length, "none", occs);
  const r = REL.exec(b);
  const lhsEnd = r ? r.index : b.length;
  const rel = !r ? null : r[0] === "=" ? "equals" : /^\\(in|subset|sim)/.test(r[0]) ? "typed" : "assign";
  const rhs = r ? math.slice(r.index + r[0].length).trim() : "";
  const ids: string[] = [];
  // Split the left side at depth-0 commas.
  const parts: Array<[number, number]> = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < lhsEnd; i++) {
    const c = b[i];
    if (c === "\\") i++;
    else if (c === "{" || c === "(") depth++;
    else if (c === "}" || c === ")") depth--;
    else if (c === "," && depth === 0) {
      parts.push([from, i]);
      from = i + 1;
    }
  }
  parts.push([from, lhsEnd]);
  for (const [ps, pe] of parts) {
    let st = ps;
    while (st < pe && /\s/.test(b[st])) st++;
    const head = occs.find((o) => o.start === st && o.script === "none");
    if (!head) continue;
    let j = head.end;
    for (;;) {
      while (j < pe && /\s/.test(b[j])) j++;
      if (b[j] === "_" || b[j] === "^") {
        const a = readArg(b, j + 1, pe);
        if (!a) break;
        j = a.end;
      } else if (b[j] === "(") {
        const close = b.indexOf(")", j);
        if (close === -1 || close >= pe) break;
        j = close + 1;
      } else break;
    }
    if (b.slice(j, pe).trim() === "") ids.push(head.id);
  }
  return { ids, rel, rhs };
}

/* ------------------------------------------------------------- preparation */

/** Blank `%` comments and the preamble, keeping every offset and line number. */
function prepare(src: string): string {
  const looksTex = /\\(documentclass|usepackage|section|begin\{document\})\b/.test(src);
  let out = src
    .split("\n")
    .map((line) => {
      for (let i = 0; i < line.length; i++) {
        if (line[i] !== "%") continue;
        let k = 0;
        while (i - 1 - k >= 0 && line[i - 1 - k] === "\\") k++;
        if (k % 2 === 1) continue;
        // "50%" in markdown prose is a percent sign, not a comment.
        if (!looksTex && /[0-9]/.test(line[i - 1] ?? "")) continue;
        return line.slice(0, i) + spaces(line.slice(i));
      }
      return line;
    })
    .join("\n");
  const b = out.indexOf("\\begin{document}");
  if (b !== -1) out = spaces(out.slice(0, b + 16)) + out.slice(b + 16);
  const e = out.indexOf("\\end{document}");
  if (e !== -1) out = out.slice(0, e) + spaces(out.slice(e));
  return out;
}

/* ------------------------------------------------------------ definitions */

const PH = /\u0001(\d+)\u0002/g;
const LIST = /\u0001\d+\u0002(?:\s*(?:,\s*(?:and\s+|or\s+)?|and\s+|or\s+)\u0001\d+\u0002)*/g;
const VERB = /^\s*,?\s*(?:which\s+|that\s+)?(?:denotes?|represents?|refers?\s+to|stands?\s+for|indicates?|corresponds?\s+to|(?:is|are)\s+(?:defined\s+as|given\s+by|called|known\s+as|the|a|an|our|its|their))\b/i;
const LOOSE_VERB = /^\s*,?\s*(?:is|are|be|denotes?)\b/i;
const LOOSE_PREFIX = /\b(?:where|here|whereas|let|with|and|in\s+which)\s*,?\s*$/i;
const ARTICLE = /^(?:the|a|an)\s+/i;
/** "the learning rate $\eta$", "with step size $\alpha$": a short noun phrase right before the symbol. */
const APPOSITION = /\b(?:the|a|an|our|its|their|with|using)\s+((?:[A-Za-z][\w-]*\s+){0,3}[A-Za-z][\w-]*)\s*$/;
const NOT_NOUN = new Set([
  "is", "are", "be", "of", "to", "in", "by", "for", "on", "at", "from", "as", "that", "which", "and", "or", "where",
  "we", "then", "with", "using", "than", "over", "into", "if", "when", "all", "each", "every", "some", "any",
]);

interface Candidate {
  id: string;
  line: number;
  desc: string;
  via: "prose" | "apposition" | "typed" | "assign";
}

/**
 * Detect definitions in prose and in the math itself. Returns candidates in
 * source order; the caller keeps the best one per symbol.
 */
function findDefinitions(tokens: Token[]): Candidate[] {
  const flat = tokens.map((t, k) => (t.kind === "text" ? t.value : "\u0001" + k + "\u0002")).join("");
  const restore = (s: string) => s.replace(PH, (_, k: string) => "$" + tokens[Number(k)].value.replace(/\s+/g, " ").trim() + "$");
  const shorten = (s: string) => {
    const words = s.replace(/\s+/g, " ").trim().split(" ");
    return words.slice(0, 12).join(" ");
  };
  const tidy = (s: string) => restore(shorten(s.replace(ARTICLE, ""))).replace(ARTICLE, "").trim();
  // Description following a verb: up to the next clause boundary or the next "and $y$".
  const descAfter = (s: string) => {
    const stop = /[.;:!?](?=\s|$)|,|\n\s*\n|\(|\s+(?:and|or)\s+(?=\u0001)|\s*\u0001\d+\u0002\s*(?:is|are|denotes?)\b/.exec(s);
    return tidy(stop ? s.slice(0, stop.index) : s);
  };

  const out: Candidate[] = [];
  // `$Q = XW$` in a list names nothing a verb could define; it only counts after "where" (below).
  const idsOf = (list: string) => {
    const ids: string[] = [];
    for (const m of list.matchAll(PH)) {
      const h = heads(tokens[Number(m[1])].value);
      if (h.rel !== "equals") ids.push(...h.ids);
    }
    return ids;
  };
  const lineOf = (list: string) => tokens[Number(/\u0001(\d+)\u0002/.exec(list)![1])].line;

  for (const m of flat.matchAll(LIST)) {
    const ls = m.index!;
    const le = ls + m[0].length;
    const ids = idsOf(m[0]);
    // The clause before the list, cut at the previous sentence boundary.
    let before = flat.slice(Math.max(0, ls - 160), ls);
    const cut = before.search(/[.!?]\s(?![\s\S]*[.!?]\s)|\n\s*\n(?![\s\S]*\n\s*\n)/);
    if (cut !== -1) before = before.slice(cut + 1);
    // "where $Q = XW_Q$, $K = XW_K$": each equation defines its left side.
    if (/\b(?:where|let|with|whereas)\s*,?\s*$/i.test(before)) {
      for (const p of m[0].matchAll(PH)) {
        const t = tokens[Number(p[1])];
        const h = heads(t.value);
        if (h.rel === "equals") for (const id of h.ids) out.push({ id, line: t.line, desc: ("$= " + h.rhs + "$").replace(/\s+/g, " "), via: "assign" });
      }
    }
    if (!ids.length) continue;
    const after = flat.slice(le, le + 400);
    let desc: string | null = null;
    const verb = VERB.exec(after);
    const loose = LOOSE_VERB.exec(after);
    let denote: RegExpExecArray | null;
    if (verb) desc = descAfter(after.slice(verb[0].length));
    else if (loose && LOOSE_PREFIX.test(before)) desc = descAfter(after.slice(loose[0].length));
    else if (/\bhere\s*,?\s*$/i.test(before)) desc = descAfter(after.replace(/^\s*,?\s*/, ""));
    else if ((denote = /\bdenote\s+([^.;\u0001\u0002]{1,100}?)\s+(?:by|as|with)\s*$/i.exec(before))) desc = tidy(denote[1]);
    else if ((denote = /([^.;,:\u0001\u0002()]*?)\s*,?\s*\b(?:denoted|written|referred\s+to\s+as)(?:\s+(?:by|as))?\s*$/i.exec(before))) desc = tidy(denote[1]);
    if (desc === null) {
      const ap = APPOSITION.exec(before);
      if (ap && !ap[1].toLowerCase().split(/\s+/).some((w) => NOT_NOUN.has(w))) {
        for (const id of ids) out.push({ id, line: lineOf(m[0]), desc: ap[1].replace(ARTICLE, "").replace(/\s+/g, " "), via: "apposition" });
      }
      continue;
    }
    for (const id of ids) out.push({ id, line: lineOf(m[0]), desc, via: "prose" });
  }

  // Definitions carried by the math itself: $x \in \mathbb{R}^d$, $f := ...$.
  for (const t of tokens) {
    if (t.kind === "text") continue;
    const h = heads(t.value);
    if (!h.rel || h.rel === "equals" || !h.ids.length) continue;
    const op = /^\\[a-zA-Z]+/.exec(t.value.slice(t.value.search(REL)))?.[0] ?? "\\in";
    const desc = h.rel === "typed" ? ("$" + op + " " + h.rhs + "$").replace(/\s+/g, " ") : "";
    for (const id of h.ids) out.push({ id, line: t.line, desc, via: h.rel });
  }
  return out;
}

/* -------------------------------------------------------------------- main */

/** Inventory the symbols of a .tex (or markdown) document. Never throws. */
export function extractSymbols(src: string, options: SymbolOptions = DEFAULT_SYMBOL_OPTIONS): SymbolReport {
  const prepared = prepare(src);
  const { tokens, issues } = tokenize(prepared);
  const map = new Map<string, SymbolInfo & { order: number; base: string; scripts: Set<string> }>();
  let mathBlocks = 0;
  for (const t of tokens) {
    if (t.kind === "text") continue;
    mathBlocks++;
    const sample = t.value.replace(/\s+/g, " ").trim();
    for (const o of scanMath(t.value)) {
      let s = map.get(o.id);
      if (!s) {
        s = {
          latex: o.id, kind: o.kind, base: o.base, count: 0,
          firstLine: t.line + (t.value.slice(0, o.start).match(/\n/g)?.length ?? 0),
          sample: sample.length > 64 ? sample.slice(0, 61) + "..." : sample,
          defined: false, description: "", defLine: null, via: null, indexOnly: false, constant: CONSTANTS.has(o.id),
          order: map.size, scripts: new Set(),
        };
        map.set(o.id, s);
      }
      s.count++;
      s.scripts.add(o.script);
    }
  }

  const rank = { prose: 0, apposition: 1, typed: 2, assign: 3 } as const;
  for (const c of findDefinitions(tokens)) {
    const s = map.get(c.id);
    if (!s) continue;
    if (s.via && (rank[s.via] < rank[c.via] || (rank[s.via] === rank[c.via] && (s.description || !c.desc)))) continue;
    s.defined = true;
    s.via = c.via;
    s.description = c.desc;
    s.defLine = c.line;
  }

  let hidden = 0;
  const visible: Array<SymbolInfo & { order: number; base: string }> = [];
  for (const s of map.values()) {
    s.indexOnly = s.kind === "latin" && INDEX_LETTERS.has(s.latex) && s.scripts.size === 1 && s.scripts.has("sub");
    if ((options.excludeConstants && s.constant) || (options.excludeIndices && s.indexOnly)) {
      hidden++;
      continue;
    }
    visible.push(s);
  }
  if (options.sort === "alpha") visible.sort(alphaCompare);
  else visible.sort((a, b) => a.order - b.order);

  const symbols: SymbolInfo[] = visible.map((s) => ({
    latex: s.latex, kind: s.kind, count: s.count, firstLine: s.firstLine, sample: s.sample, defined: s.defined,
    description: s.description, defLine: s.defLine, via: s.via, indexOnly: s.indexOnly, constant: s.constant,
  }));
  const defined = symbols.filter((s) => s.defined).length;
  return {
    symbols,
    stats: { symbols: symbols.length, defined, undefined: symbols.length - defined, hidden, mathBlocks },
    issues: issues.map((i) => ({ line: i.line, message: i.message })),
  };
}

/** Latin before Greek before anything else; Greek in Greek order; x before X; plain before decorated. */
function alphaCompare(a: { kind: SymbolKind; base: string; latex: string }, b: { kind: SymbolKind; base: string; latex: string }): number {
  const kr = { latin: 0, greek: 1, other: 2 };
  if (kr[a.kind] !== kr[b.kind]) return kr[a.kind] - kr[b.kind];
  const key = (s: { kind: SymbolKind; base: string }) => {
    if (s.kind !== "greek") return s.base.toLowerCase();
    const g = s.base.replace(/^var/, "").toLowerCase();
    return String(GREEK_ORDER.indexOf(g)).padStart(2, "0");
  };
  const ka = key(a);
  const kb = key(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const upper = (s: { base: string }) => (/^(var)?[A-Z]/.test(s.base) ? 1 : 0);
  if (upper(a) !== upper(b)) return upper(a) - upper(b);
  return a.latex.length - b.latex.length || (a.latex < b.latex ? -1 : a.latex > b.latex ? 1 : 0);
}

/* -------------------------------------------------------------- generators */

/** Print the list as a LaTeX table, `nomencl` entries, or a markdown table. */
export function generateSymbols(symbols: ReadonlyArray<SymbolInfo>, format: SymbolFormat): string {
  if (!symbols.length) return "";
  if (format === "markdown") {
    const cell = (s: string) => s.replace(/\|/g, "\\|");
    return [
      "| Symbol | Description |",
      "| --- | --- |",
      ...symbols.map((s) => "| " + cell("$" + s.latex + "$") + " | " + (s.description ? cell(s.description) : "*TODO*") + " |"),
    ].join("\n") + "\n";
  }
  if (format === "nomenclature") {
    const width = String(symbols.length).length;
    return [
      "% Preamble:",
      "\\usepackage{nomencl}",
      "\\makenomenclature",
      "",
      "% Body. nomencl sorts by the [prefix]; these keep the order below.",
      "% Compile with makeindex (Overleaf: add a latexmkrc rule for .nlo -> .nls).",
      ...symbols.map((s, i) => "\\nomenclature[s" + String(i + 1).padStart(width, "0") + "]{$" + s.latex + "$}{" + (s.description || "\\textit{TODO}") + "}"),
      "\\printnomenclature",
    ].join("\n") + "\n";
  }
  return [
    "\\begin{table}[ht]",
    "  \\centering",
    "  \\caption{Notation.}",
    "  \\label{tab:notation}",
    "  \\begin{tabular}{ll}",
    "    \\hline",
    "    Symbol & Description \\\\",
    "    \\hline",
    ...symbols.map((s) => "    $" + s.latex + "$ & " + (s.description || "\\textit{TODO}") + " \\\\"),
    "    \\hline",
    "  \\end{tabular}",
    "\\end{table}",
  ].join("\n") + "\n";
}
