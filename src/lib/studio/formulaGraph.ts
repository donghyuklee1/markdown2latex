/**
 * formulaGraph.ts - the formula dependency graph behind the Studio's graph view.
 *
 * Reads a document (markdown with math, or a .tex file) and answers "which
 * equation defines this symbol, and what depends on it?":
 *
 *   tokenize  ->  equations (display blocks, align rows, optionally inline
 *                 relations) with input line spans, \label, \tag, numbers
 *             ->  per equation: LHS symbols are DEFINED, RHS symbols are USED
 *             ->  nodes + edges (eq -defines-> sym, sym -uses-> eq,
 *                 eq -feeds-> eq), lineage queries
 *             ->  a deterministic layered layout (Sugiyama-lite).
 *
 * Pure like the engine: no DOM, no React, no I/O, never throws. Everything here
 * is a heuristic over LaTeX source, not a parser for mathematics - the goal is
 * a map that is right for the common shapes of papers and LLM output, and
 * degrades to "all symbols used" rather than to wrong definitions.
 */
import { autoEscapeText, tokenize } from "../cleaner";

/* ------------------------------------------------------------------- types */

export type NodeKind = "equation" | "symbol";
export type EdgeKind = "defines" | "uses" | "feeds";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** "Eq. 3", "(A.1)", a label key or a source snippet; symbols: their LaTeX. */
  label: string;
  /** Equations: the cleaned row source. Symbols: the canonical symbol LaTeX. */
  latex: string;
  /** 1-indexed inclusive input lines. Symbols: their primary definition's lines. */
  lines: [number, number] | null;
  /** Symbols: defined by some equation. Equations: always true. */
  defined: boolean;
  /** Symbols: equations that use it. Equations: distinct symbols they use. */
  uses: number;
  /** Equations: estimated LaTeX equation number (null when unnumbered). */
  number: number | null;
  /** Equations: the `\label{...}` key, if any. */
  key: string | null;
  /** Equations: the `\tag{...}` text, if any. */
  tag: string | null;
  /** Equations: came from an inline `$...$` block. */
  inline: boolean;
  /** Symbols: id of the first (primary) defining equation. */
  primary: string | null;
  /** Equations: the lines of the whole display block the row belongs to. */
  blockLines: [number, number] | null;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

export interface FormulaGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes without incoming edges. */
  roots: string[];
  /** Nodes without outgoing edges. */
  leaves: string[];
}

export interface GraphOptions {
  /** Also treat inline `$...$` blocks containing a relation as equations. */
  includeInline?: boolean;
}

/* ------------------------------------------------------------ vocabularies */

const words = (s: string) => new Set(s.split(" "));

const GREEK = words(
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa varkappa " +
    "lambda mu nu xi omicron pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi " +
    "psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega ell hbar",
);
/** Font commands: `\mathbf{W}` is a different symbol from `W`. */
const FONTS = words("mathbf mathcal boldsymbol mathbb mathfrak mathscr bm mathsf mathit mathbfit pmb vb");
/** Accents: `\hat{y}` (the estimate) is a different symbol from `y`. */
const DECOR = words(
  "hat bar tilde vec dot ddot widehat widetilde overline check breve mathring underline overrightarrow",
);
/** Commands whose argument is a word: a named quantity, a function or prose. */
const WORDCMDS = words("text textrm textit textbf textsf texttt mbox mathrm operatorname");
/** Function names: never quantities, and their scripts are limits, not indices. */
const FUNCS = words(
  "sin cos tan cot sec csc arcsin arccos arctan sinh cosh tanh coth log ln lg exp max min " +
    "arg argmax argmin sup inf lim liminf limsup det dim ker deg gcd lcm Pr hom mod bmod pmod " +
    "sgn sign tr Tr diag softmax relu ReLU sigmoid erf var Var cov Cov",
);
const BIGOPS = words("sum prod coprod int iint iiint oint bigcup bigcap bigoplus bigotimes bigvee bigwedge");
/** Commands whose argument is metadata, never maths. */
const SKIP_ARG = words(
  "label tag ref eqref cref Cref autoref cite begin end hspace vspace phantom hphantom vphantom color",
);
/** Single `\text{}` words that are prose glue, not named quantities. */
const PROSE = words(
  "if otherwise where and or for all any some such that with when else then is are of the in on " +
    "to as by subject st iff let given else so since thus hence also but not each every",
);
/** Constants and number sets: in every paper, defined in none - pure noise. */
const CONSTANTS = new Set(["\\pi", "\\mathbb{R}", "\\mathbb{N}", "\\mathbb{Z}", "\\mathbb{Q}", "\\mathbb{C}", "\\hbar"]);

/** Relations that state what the left-hand side is. */
const DEF_RELS = words("coloneqq triangleq equiv defeq approx propto simeq sim doteq eqqcolon");
/** Relations that compare two expressions: no side is being defined. */
const CMP_RELS = words("le leq ge geq leqslant geqslant lt gt ll gg neq ne cong");

/** Unicode Greek letters that survive in raw editor text, as their commands. */
const UNICODE_GREEK: ReadonlyArray<[string, string]> = (() => {
  const lower =
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho varsigma sigma tau upsilon phi chi psi omega".split(
      " ",
    );
  const out: Array<[string, string]> = lower.map((name, k) => [String.fromCharCode(0x03b1 + k), "\\" + name + " "]);
  const upper: Array<[number, string]> = [
    [0x0393, "Gamma"], [0x0394, "Delta"], [0x0398, "Theta"], [0x039b, "Lambda"], [0x039e, "Xi"],
    [0x03a0, "Pi"], [0x03a3, "Sigma"], [0x03a6, "Phi"], [0x03a8, "Psi"], [0x03a9, "Omega"],
  ];
  for (const [code, name] of upper) out.push([String.fromCharCode(code), "\\" + name + " "]);
  return out;
})();

/* ------------------------------------------------------------ small lexing */

const isLetter = (c: string | undefined) => c !== undefined && /[A-Za-z]/.test(c);

/** Index of the `}` matching the `{` at `i` (or `s.length` when unbalanced). */
function matchBrace(s: string, i: number): number {
  let depth = 0;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === "\\") {
      k++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return k;
  }
  return s.length;
}

const skipSpaces = (s: string, i: number) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

/**
 * One TeX argument at `i`: a brace group (contents), a control sequence (plus
 * its brace group, so `L_\text{CE}` reads as `\text{CE}`), or one character.
 */
function readArg(s: string, i: number): [string, number] {
  i = skipSpaces(s, i);
  if (i >= s.length) return ["", i];
  if (s[i] === "{") {
    const j = matchBrace(s, i);
    return [s.slice(i + 1, j), j + 1];
  }
  if (s[i] === "\\") {
    const m = /^\\(?:[A-Za-z]+\*?|.)/.exec(s.slice(i, i + 40));
    const len = m ? m[0].length : 1;
    let j = i + len;
    const k = skipSpaces(s, j);
    if (/^\\[A-Za-z]/.test(s.slice(i, i + 2)) && s[k] === "{") j = matchBrace(s, k) + 1;
    return [s.slice(i, j), j];
  }
  return [s[i], i + 1];
}

/** Collapse whitespace so `\mathbf {W}` and `\mathbf{W}` are one symbol. */
function canon(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*([{}_^])\s*/g, "$1");
}

/** `_{\text{CE}}`, `_{\mathrm{train}}`, `_{max}`: a name, not an index. */
function isTextLikeScript(arg: string): boolean {
  const t = arg.trim();
  const m = /^\\(?:text|textrm|textit|textsf|textbf|mathrm|mathit|mathsf|operatorname)\s*\{([^{}]*)\}$/.exec(t);
  if (m) return /[A-Za-z][^A-Za-z]*[A-Za-z]/.test(m[1]);
  return /^[A-Za-z]{3,}$/.test(t);
}

/** `^{(l)}`, `^T`, `^\top`, `^*`, `^\prime`: a label on the symbol, not an exponent. */
function isIndexSup(arg: string): boolean {
  const t = arg.trim();
  if (/^\(.*\)$/.test(t)) return true;
  return /^(?:T|H|\*|'+|[+-]|\\top|\\intercal|\\ast|\\star|\\dagger|(?:\\prime\s*)+|\\math(?:sf|rm)\s*\{[TH]\})$/.test(t);
}

/* -------------------------------------------------------- symbol scanning */

interface Hit {
  sym: string;
  /** Inside parentheses or limits: an argument, never the thing being defined. */
  nested: boolean;
}

/**
 * Collect symbol occurrences in `s`. Index scripts fold into their base symbol,
 * exponents are scanned as uses, function names and differentials are skipped.
 */
function scan(s: string, out: Hit[], nested: boolean, hasInt: boolean): void {
  let i = 0;
  let depth = 0;
  const n = s.length;
  const isNested = () => nested || depth > 0;
  const emit = (sym: string) => {
    if (!CONSTANTS.has(sym)) out.push({ sym, nested: isNested() });
  };

  /** Scripts after a symbol: text-like subscripts extend its name, exponents are uses. */
  const trailing = (j: number, base: string): number => {
    let sym = base;
    const exps: string[] = [];
    for (;;) {
      const k = skipSpaces(s, j);
      if (s[k] === "'") {
        j = k + 1;
        continue;
      }
      if (s[k] === "_") {
        const [arg, next] = readArg(s, k + 1);
        if (isTextLikeScript(arg)) sym = sym + "_{" + canon(arg) + "}";
        j = next;
        continue;
      }
      if (s[k] === "^") {
        const [arg, next] = readArg(s, k + 1);
        if (!isIndexSup(arg)) exps.push(arg);
        j = next;
        continue;
      }
      break;
    }
    // `e^{x}` is Euler's number, not a quantity the paper defines.
    if (!(sym === "e" && exps.length)) emit(sym);
    for (const e of exps) scan(e, out, isNested(), hasInt);
    return j;
  };

  /** Limits of `\sum_{i=1}^{N}`, `\max_\theta`: bound variables left of `=`/`\in` are skipped. */
  const limits = (j: number): number => {
    for (;;) {
      let k = skipSpaces(s, j);
      const lim = /^\\(?:no)?limits/.exec(s.slice(k, k + 10));
      if (lim) k += lim[0].length;
      k = skipSpaces(s, k);
      if (s[k] !== "_" && s[k] !== "^") return lim ? k : j;
      const [arg, next] = readArg(s, k + 1);
      let part = arg;
      if (s[k] === "_") {
        const m = /=|\\in\b|\\to\b|\\sim\b|\\le(?:q)?\b|\\ge(?:q)?\b|<|>/.exec(arg);
        if (m) part = arg.slice(m.index + m[0].length);
      }
      scan(part, out, true, hasInt);
      j = next;
    }
  };

  while (i < n) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)(\*?)/.exec(s.slice(i, i + 40));
      if (!m) {
        i += 2; // `\,` `\{` `\\` ...
        continue;
      }
      const name = m[1];
      i += m[0].length;
      if (SKIP_ARG.has(name)) {
        const [env, next] = readArg(s, i);
        i = next;
        // Column specs (`{cc}`, alignat's `{2}`) would otherwise read as letters.
        if (name === "begin" && /^(?:array|subarray|alignat\*?|alignedat|tabular)$/.test(env.trim())) {
          const k = skipSpaces(s, i);
          if (s[k] === "{") i = matchBrace(s, k) + 1;
        }
        if (name === "color") {
          const k = skipSpaces(s, i);
          if (s[k] === "{") i = k; // \color{red}{x}: the second group is maths
        }
        continue;
      }
      if (WORDCMDS.has(name)) {
        const [arg, next] = readArg(s, i);
        i = next;
        const word = arg.trim();
        if (/^[A-Za-z]$/.test(word)) {
          // \mathrm{d} is a differential, \mathrm{e} Euler's number.
          if (word === "d" || word === "e") continue;
          i = trailing(i, "\\" + name + "{" + word + "}");
          continue;
        }
        const named = /^[A-Za-z][A-Za-z0-9]*(?:[-_][A-Za-z0-9]+)*$/.test(word);
        if (!named || PROSE.has(word.toLowerCase())) continue; // prose, not a quantity
        if (FUNCS.has(word) || FUNCS.has(word.toLowerCase())) {
          i = limits(i);
          continue;
        }
        i = trailing(i, "\\" + name + "{" + word + "}");
        continue;
      }
      if (FONTS.has(name) || DECOR.has(name)) {
        const [arg, next] = readArg(s, i);
        i = next;
        const inner: Hit[] = [];
        scan(arg, inner, false, hasInt);
        if (!inner.length) continue; // \mathbb{1}, \mathbf{0}: constants
        if (inner.length === 1) {
          i = trailing(i, "\\" + name + "{" + inner[0].sym + "}");
          continue;
        }
        // `\mathbf{Wx}` is bold W times bold x; `\overline{x+y}` just uses x and y.
        inner.forEach((h, k) => {
          const sym = FONTS.has(name) && !h.sym.includes("{") ? "\\" + name + "{" + h.sym + "}" : h.sym;
          if (k === inner.length - 1) i = trailing(i, sym);
          else emit(sym);
        });
        continue;
      }
      if (GREEK.has(name)) {
        i = trailing(i, "\\" + name);
        continue;
      }
      if (FUNCS.has(name) || BIGOPS.has(name)) {
        i = limits(i);
        continue;
      }
      continue; // \frac, \sqrt, \left, \cdot ...: their groups are scanned as they come
    }
    if (c === "{") {
      const j = matchBrace(s, i);
      scan(s.slice(i + 1, j), out, isNested(), hasInt);
      i = j + 1;
      continue;
    }
    if (c === "_") {
      i = readArg(s, i + 1)[1]; // a subscript on a group: an index
      continue;
    }
    if (c === "^") {
      const [arg, next] = readArg(s, i + 1);
      if (!isIndexSup(arg)) scan(arg, out, isNested(), hasInt);
      i = next;
      continue;
    }
    if (c === "(" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    if (isLetter(c)) {
      let j = i;
      while (j < n && isLetter(s[j])) j++;
      const run = s.slice(i, j);
      if (run.length > 1 && FUNCS.has(run)) {
        i = limits(j); // a bare `log` or `max` typed without the backslash
        continue;
      }
      if (/^(?:d[A-Za-z])+$/.test(run)) {
        // `dx`, `dxdy`: differentials; the variable itself is still used.
        for (let k = 1; k < run.length; k += 2) emit(run[k]);
        i = j;
        continue;
      }
      if (run === "d") {
        const k = skipSpaces(s, j);
        const greek = /^\\([A-Za-z]+)/.exec(s.slice(k, k + 20));
        if ((greek && GREEK.has(greek[1])) || (hasInt && k > j && isLetter(s[k]) && !isLetter(s[k + 1]))) {
          i = j; // `d\theta`, `\int f \, d x`
          continue;
        }
      }
      for (let k = 0; k < run.length - 1; k++) emit(run[k]);
      i = trailing(j, run[run.length - 1]);
      continue;
    }
    i++;
  }
}

/** Distinct symbols in source order. */
function uniq(list: string[]): string[] {
  return [...new Set(list)];
}

function hits(s: string): Hit[] {
  const out: Hit[] = [];
  const hasInt = /\\(?:i+nt|oint)\b/.test(s);
  scan(normalizeGreek(s), out, false, hasInt);
  return out;
}

function normalizeGreek(s: string): string {
  let out = s;
  for (const [ch, cmd] of UNICODE_GREEK) if (out.includes(ch)) out = out.split(ch).join(cmd);
  return out;
}

/** Every symbol mentioned in a piece of LaTeX, in order of first appearance. */
export function extractSymbols(latex: string): string[] {
  try {
    return uniq(hits(prepare(latex)).map((h) => h.sym));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------ relation analysis */

interface Relation {
  index: number;
  length: number;
  defining: boolean;
}

/** The first relation at the top level: not in braces, brackets or nested environments. */
function findRelation(s: string): Relation | null {
  let brace = 0;
  let paren = 0;
  let env = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i, i + 30));
      if (!m) {
        i++;
        continue;
      }
      const name = m[1];
      if (name === "begin") env++;
      else if (name === "end") env = Math.max(0, env - 1);
      else if (brace === 0 && paren === 0 && env === 0 && (DEF_RELS.has(name) || CMP_RELS.has(name))) {
        return { index: i, length: m[0].length, defining: DEF_RELS.has(name) };
      }
      i += m[0].length - 1;
      continue;
    }
    if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === "(" || c === "[") paren++;
    else if (c === ")" || c === "]") paren = Math.max(0, paren - 1);
    else if (brace === 0 && paren === 0 && env === 0) {
      if (c === ":" && s[i + 1] === "=") return { index: i, length: 2, defining: true };
      if (c === "=") {
        const prev = s[i - 1];
        if (prev === "!" || prev === "<" || prev === ">") return { index: i - 1, length: 2, defining: false };
        return { index: i, length: 1, defining: true };
      }
      if (c === "<" || c === ">") return { index: i, length: s[i + 1] === "=" ? 2 : 1, defining: false };
    }
  }
  return null;
}

/** Does this math contain any relation (for picking inline equations)? */
export function hasRelation(latex: string): boolean {
  return findRelation(prepare(latex)) !== null;
}

/** Remove `&` alignment marks outside nested environments (cases keeps its own). */
function stripAmps(s: string): string {
  let depth = 0;
  return s.replace(/\\begin\{[^}]*\}|\\end\{[^}]*\}|\\&|&/g, (m) => {
    if (m.startsWith("\\begin")) depth++;
    else if (m.startsWith("\\end")) depth = Math.max(0, depth - 1);
    else if (m === "&" && depth === 0) return " ";
    return m;
  });
}

/** Metadata out, `\overset{def}{=}` to `:=`: what is left is the maths itself. */
function prepare(latex: string): string {
  const s = latex
    .replace(/\\(?:label|tag\*?)\s*\{[^{}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b/g, "")
    .replace(/\\(?:overset|stackrel)\s*\{[^{}]*\}\s*\{\s*=\s*\}/g, ":=");
  return stripAmps(s).replace(/\s+/g, " ").trim();
}

export interface EquationAnalysis {
  defines: string[];
  uses: string[];
  /** Whether a top-level relation split the equation into two sides. */
  relation: "defining" | "comparison" | null;
}

/**
 * LHS symbols (outside parentheses) of a defining relation are defined; all
 * others are used. A row whose LHS is empty (`&= ...` in align) continues the
 * previous row, so it defines what that row defined (`inherited`).
 */
export function analyzeEquation(latex: string, inherited: string[] = []): EquationAnalysis {
  try {
    // Prose an LLM left bare in the maths - `e + f (some raw text here)` - is
    // wrapped in \text{} first, exactly as the cleaner does, so its letters do
    // not turn into a dozen phantom "undefined symbols".
    const s = prepare(autoEscapeText(latex));
    const rel = findRelation(s);
    if (!rel) return { defines: [], uses: uniq(hits(s).map((h) => h.sym)), relation: null };
    if (!rel.defining) return { defines: [], uses: uniq(hits(s).map((h) => h.sym)), relation: "comparison" };
    const lhs = s.slice(0, rel.index);
    const rhs = s.slice(rel.index + rel.length);
    const rhsSyms = hits(rhs).map((h) => h.sym);
    if (!lhs.trim()) return { defines: uniq(inherited), uses: uniq(rhsSyms), relation: "defining" };
    const left = hits(lhs);
    const defines = uniq(left.filter((h) => !h.nested).map((h) => h.sym));
    if (!defines.length) return { defines: [], uses: uniq(hits(s).map((h) => h.sym)), relation: "defining" };
    const uses = uniq([...left.filter((h) => h.nested).map((h) => h.sym), ...rhsSyms]);
    return { defines, uses, relation: "defining" };
  } catch {
    return { defines: [], uses: [], relation: null };
  }
}

/* ------------------------------------------------------ equation finding */

/** Environments that only wrap rows; unwrapping them exposes the rows. */
const WRAP_ENVS = words(
  "equation align gather multline alignat flalign eqnarray displaymath split aligned gathered alignedat",
);
/** Environments whose `\\` separates independent equations. */
const ROW_ENVS = words("align alignat flalign eqnarray gather aligned gathered alignedat split");
/** Numbered per row / once per block, when not starred. */
const PER_ROW_NUMBERED = words("align alignat flalign eqnarray gather");
const BLOCK_NUMBERED = words("equation multline");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the `\end{name}` closing a `\begin{name}` whose body starts at `from`. */
function findEnd(s: string, from: number, name: string): number {
  const re = new RegExp("\\\\(begin|end)\\{" + escapeRe(name) + "\\}", "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return m.index;
  }
  return -1;
}

/** Peel `\begin{align*}...\end{align*}`, `\begin{equation}\begin{split}...` wrappers. */
function unwrap(value: string): { body: string; offset: number; envs: string[] } {
  let body = value;
  let offset = 0;
  const envs: string[] = [];
  for (let guard = 0; guard < 4; guard++) {
    const m = /^\s*\\begin\{([A-Za-z]+\*?)\}/.exec(body);
    if (!m || !WRAP_ENVS.has(m[1].replace(/\*$/, ""))) break;
    let start = m[0].length;
    if (/^(?:alignat|alignedat)/.test(m[1])) {
      const k = skipSpaces(body, start);
      if (body[k] === "{") start = matchBrace(body, k) + 1;
    }
    const end = findEnd(body, start, m[1]);
    if (end === -1) break;
    const after = end + ("\\end{" + m[1] + "}").length;
    if (body.slice(after).trim() !== "") break;
    envs.push(m[1]);
    body = body.slice(start, end);
    offset += start;
  }
  return { body, offset, envs };
}

/** Split at top-level `\\` (not inside braces or nested environments). */
function splitRows(body: string): Array<{ text: string; start: number }> {
  const rows: Array<{ text: string; start: number }> = [];
  let brace = 0;
  let env = 0;
  let last = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\") {
      if (body.startsWith("\\begin{", i)) env++;
      else if (body.startsWith("\\end{", i)) env = Math.max(0, env - 1);
      else if (body[i + 1] === "\\" && brace === 0 && env === 0) {
        rows.push({ text: body.slice(last, i), start: last });
        let j = i + 2;
        const opt = /^\*?\s*(?:\[[^\]]*\])?/.exec(body.slice(j));
        if (opt) j += opt[0].length;
        last = j;
        i = j - 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
  }
  rows.push({ text: body.slice(last), start: last });
  return rows;
}

const countNewlines = (s: string) => {
  let k = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) k++;
  return k;
};

interface EqRecord {
  latex: string;
  lines: [number, number];
  blockLines: [number, number];
  number: number | null;
  key: string | null;
  tag: string | null;
  inline: boolean;
  defines: string[];
  uses: string[];
  /** Label keys this equation refers to (in its own maths or the prose before it). */
  refs: string[];
}

const LABEL_RE = /\\label\s*\{([^{}]*)\}/;
const TAG_RE = /\\tag\*?\s*\{([^{}]*)\}/;
const NONUM_RE = /\\(?:nonumber|notag)\b/;
const REF_RE = /\\(?:eqref|ref|cref|Cref|autoref)\s*\{([^{}]*)\}/g;

function refsIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(REF_RE)) for (const k of m[1].split(",")) if (k.trim()) out.push(k.trim());
  return out;
}

/** All equations in document order, with lines, numbers and their two sides. */
function collectEquations(src: string, includeInline: boolean): EqRecord[] {
  const { tokens } = tokenize(src);
  const eqs: EqRecord[] = [];
  let counter = 0;
  let pendingRefs: string[] = [];

  for (const tok of tokens) {
    if (tok.kind === "text") {
      pendingRefs.push(...refsIn(tok.value));
      continue;
    }
    const value = tok.value;
    const lineOf = (offset: number) => tok.line + countNewlines(value.slice(0, offset));
    const blockLines: [number, number] = [tok.line, tok.line + countNewlines(value)];

    if (tok.kind === "inline") {
      if (!includeInline || !value.trim() || !hasRelation(value)) continue;
      const a = analyzeEquation(value);
      eqs.push({
        latex: prepare(value),
        lines: blockLines,
        blockLines,
        number: null,
        key: null,
        tag: null,
        inline: true,
        defines: a.defines,
        uses: a.uses,
        refs: [...pendingRefs, ...refsIn(value)],
      });
      pendingRefs = [];
      continue;
    }

    const { body, offset, envs } = unwrap(value);
    if (!prepare(body)) continue;
    const outer = envs[0] ?? "";
    const outerBare = outer.replace(/\*$/, "");
    const starred = outer.endsWith("*");
    const mode = starred ? "none" : PER_ROW_NUMBERED.has(outerBare) ? "rows" : BLOCK_NUMBERED.has(outerBare) ? "block" : "none";
    const split = envs.some((e) => ROW_ENVS.has(e.replace(/\*$/, "")));

    // Rows with no text are trailing `\\`; rows with no relation continue the previous one.
    const rows = (split ? splitRows(body) : [{ text: body, start: 0 }]).filter((r) => prepare(r.text) !== "");
    interface Unit { texts: string[]; from: number; to: number; number: number | null; key: string | null; tag: string | null }
    const units: Unit[] = [];
    for (const row of rows) {
      const lead = row.text.length - row.text.trimStart().length;
      const from = lineOf(offset + row.start + lead);
      const to = lineOf(offset + row.start + row.text.trimEnd().length);
      const tag = TAG_RE.exec(row.text)?.[1] ?? null;
      let number: number | null = null;
      if (mode === "rows" && !tag && !NONUM_RE.test(row.text)) number = ++counter;
      const key = LABEL_RE.exec(row.text)?.[1] ?? null;
      const prev = units[units.length - 1];
      if (prev && !hasRelation(row.text)) {
        prev.texts.push(row.text);
        prev.to = to;
        prev.number ??= number;
        prev.key ??= key;
        prev.tag ??= tag;
      } else {
        units.push({ texts: [row.text], from, to, number, key, tag });
      }
    }
    if (!units.length) continue;
    if (mode === "block") {
      const tag = TAG_RE.exec(body)?.[1] ?? null;
      units[0].tag ??= tag;
      if (!tag && !NONUM_RE.test(body)) units[0].number = ++counter;
      units[0].key ??= LABEL_RE.exec(body)?.[1] ?? null;
    }

    let inherited: string[] = [];
    units.forEach((u, idx) => {
      const raw = u.texts.join(" ");
      const a = analyzeEquation(raw, inherited);
      if (a.defines.length) inherited = a.defines;
      eqs.push({
        latex: prepare(raw),
        // A block that is one equation selects with its delimiters; a row selects just itself.
        lines: split ? [u.from, Math.max(u.from, u.to)] : blockLines,
        blockLines,
        number: u.number,
        key: u.key,
        tag: u.tag,
        inline: false,
        defines: a.defines,
        uses: a.uses,
        refs: [...(idx === 0 ? pendingRefs : []), ...refsIn(raw)],
      });
    });
    pendingRefs = [];
  }
  return eqs;
}

/* ------------------------------------------------------------ graph build */

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "\u2026";
}

function equationLabel(e: EqRecord): string {
  if (e.tag) return "(" + e.tag + ")";
  if (e.number !== null) return "Eq. " + e.number;
  if (e.key) return e.key;
  return truncate(e.latex, 30);
}

const EMPTY: FormulaGraph = { nodes: [], edges: [], roots: [], leaves: [] };

/**
 * Build the dependency graph. Feeds edges follow the nearest preceding
 * definition of each used symbol (like a variable in code), falling back to the
 * primary definition for forward references; `\eqref` mentions add feeds edges
 * from the referenced equation to the next equation.
 */
export function buildFormulaGraph(src: string, options: GraphOptions = {}): FormulaGraph {
  try {
    return build(src, options);
  } catch {
    return EMPTY;
  }
}

function build(src: string, options: GraphOptions): FormulaGraph {
  const eqs = collectEquations(src, options.includeInline ?? false);
  if (!eqs.length) return EMPTY;

  const eqId = (k: number) => "eq:" + k;
  const symId = (s: string) => "sym:" + s;
  const definers = new Map<string, number[]>();
  const users = new Map<string, number[]>();
  const order: string[] = [];
  const touch = (s: string) => {
    if (!definers.has(s)) {
      definers.set(s, []);
      users.set(s, []);
      order.push(s);
    }
  };
  eqs.forEach((e, k) => {
    for (const s of e.defines) touch(s), definers.get(s)!.push(k);
    for (const s of e.uses) touch(s), users.get(s)!.push(k);
  });

  const nodes: GraphNode[] = eqs.map((e, k) => ({
    id: eqId(k),
    kind: "equation",
    label: equationLabel(e),
    latex: e.latex,
    lines: e.lines,
    defined: true,
    uses: e.uses.length,
    number: e.number,
    key: e.key,
    tag: e.tag,
    inline: e.inline,
    primary: null,
    blockLines: e.blockLines,
  }));
  for (const s of order) {
    const defs = definers.get(s)!;
    nodes.push({
      id: symId(s),
      kind: "symbol",
      label: s,
      latex: s,
      lines: defs.length ? eqs[defs[0]].lines : null,
      defined: defs.length > 0,
      uses: users.get(s)!.length,
      number: null,
      key: null,
      tag: null,
      inline: false,
      primary: defs.length ? eqId(defs[0]) : null,
      blockLines: null,
    });
  }

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string, kind: EdgeKind) => {
    const k = from + "\u0000" + to + "\u0000" + kind;
    if (seen.has(k)) return;
    seen.add(k);
    edges.push({ from, to, kind });
  };
  eqs.forEach((e, k) => {
    for (const s of e.defines) add(eqId(k), symId(s), "defines");
    for (const s of e.uses) add(symId(s), eqId(k), "uses");
  });
  const byKey = new Map<string, number>();
  eqs.forEach((e, k) => {
    if (e.key && !byKey.has(e.key)) byKey.set(e.key, k);
  });
  eqs.forEach((e, b) => {
    for (const s of e.uses) {
      const defs = definers.get(s)!;
      if (!defs.length) continue;
      let a = -1;
      for (const d of defs) if (d < b) a = d;
      if (a === -1) a = defs[0];
      if (a !== b) add(eqId(a), eqId(b), "feeds");
    }
    for (const key of e.refs) {
      const a = byKey.get(key);
      if (a !== undefined && a !== b) add(eqId(a), eqId(b), "feeds");
    }
  });

  const hasIn = new Set(edges.map((e) => e.to));
  const hasOut = new Set(edges.map((e) => e.from));
  return {
    nodes,
    edges,
    roots: nodes.filter((nd) => !hasIn.has(nd.id)).map((nd) => nd.id),
    leaves: nodes.filter((nd) => !hasOut.has(nd.id)).map((nd) => nd.id),
  };
}

/* ---------------------------------------------------------------- lineage */

function walk(start: string, next: Map<string, string[]>): string[] {
  const seen = new Set<string>([start]);
  const out: string[] = [];
  const stack = [start];
  while (stack.length) {
    const v = stack.pop()!;
    for (const w of next.get(v) ?? []) {
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
      stack.push(w);
    }
  }
  return out;
}

/** Everything `id` depends on (upstream) and everything that depends on it (downstream). */
export function lineage(graph: FormulaGraph, id: string): { upstream: string[]; downstream: string[] } {
  const fwd = new Map<string, string[]>();
  const back = new Map<string, string[]>();
  for (const e of graph.edges) {
    (fwd.get(e.from) ?? fwd.set(e.from, []).get(e.from)!).push(e.to);
    (back.get(e.to) ?? back.set(e.to, []).get(e.to)!).push(e.from);
  }
  return { upstream: walk(id, back), downstream: walk(id, fwd) };
}

/** The node itself plus its whole lineage, for highlighting. */
export function lineageSet(graph: FormulaGraph, id: string): Set<string> {
  const { upstream, downstream } = lineage(graph, id);
  return new Set([id, ...upstream, ...downstream]);
}

/* ----------------------------------------------------------------- layout */

export interface NodeBox {
  /** Top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  rank: number;
  order: number;
}

export interface GraphLayout {
  positions: Record<string, NodeBox>;
  width: number;
  height: number;
  /** Node ids per rank (column), in final order. */
  ranks: string[][];
}

export interface LayoutOptions {
  /** Horizontal gap between rank columns. */
  rankGap?: number;
  /** Vertical gap between nodes in a column. */
  nodeGap?: number;
  /** Barycenter sweeps (each one down + one up). */
  sweeps?: number;
  size?: (node: GraphNode) => { w: number; h: number };
}

/** Rough rendered width of a symbol: commands count as one glyph. */
function glyphs(latex: string): number {
  return latex
    .replace(/\\(?:mathbf|mathcal|boldsymbol|mathbb|mathfrak|mathscr|bm|mathsf|mathit|hat|bar|tilde|vec|dot|ddot|widehat|widetilde|overline|text|textrm|mathrm|operatorname)\b/g, "")
    .replace(/\\[A-Za-z]+/g, "x")
    .replace(/[{}_^\s\\]/g, "").length;
}

/** Default node box: equations are fixed cards, symbols are pills sized to their text. */
export function nodeSize(node: GraphNode): { w: number; h: number } {
  if (node.kind === "equation") return { w: 196, h: 60 };
  return { w: Math.min(180, Math.max(44, 28 + glyphs(node.latex) * 10)), h: 30 };
}

/**
 * Layered left-to-right layout. Ranks are longest paths over the defines/uses
 * DAG (DFS back edges dropped to break cycles), sources are pulled next to
 * their first consumer so undefined symbols do not all pile up in column 0,
 * and a few barycenter sweeps reduce crossings. Deterministic: no randomness,
 * stable sorts, document order as the tie-break.
 */
export function layoutGraph(graph: FormulaGraph, options: LayoutOptions = {}): GraphLayout {
  const rankGap = options.rankGap ?? 80;
  const nodeGap = options.nodeGap ?? 16;
  const sweeps = options.sweeps ?? 4;
  const size = options.size ?? nodeSize;
  const nodes = graph.nodes;
  const N = nodes.length;
  if (!N) return { positions: {}, width: 0, height: 0, ranks: [] };

  const index = new Map(nodes.map((nd, k) => [nd.id, k]));
  const out: number[][] = nodes.map(() => []);
  const pairSeen = new Set<number>();
  for (const e of graph.edges) {
    if (e.kind === "feeds") continue; // implied by defines + uses; would only stretch columns
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const key = a * N + b;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    out[a].push(b);
  }

  // Iterative DFS: an edge to a node still on the stack closes a cycle; drop it.
  const state = new Uint8Array(N); // 0 new, 1 on stack, 2 done
  const dag: number[][] = nodes.map(() => []);
  for (let root = 0; root < N; root++) {
    if (state[root]) continue;
    const stack: Array<[number, number]> = [[root, 0]];
    state[root] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, ei] = top;
      if (ei >= out[v].length) {
        state[v] = 2;
        stack.pop();
        continue;
      }
      top[1]++;
      const w = out[v][ei];
      if (state[w] === 1) continue; // back edge
      dag[v].push(w);
      if (state[w] === 0) {
        state[w] = 1;
        stack.push([w, 0]);
      }
    }
  }
  const preds: number[][] = nodes.map(() => []);
  dag.forEach((ws, v) => ws.forEach((w) => preds[w].push(v)));

  // Longest-path ranks (Kahn, document order).
  const rank = new Array<number>(N).fill(0);
  const indeg = preds.map((p) => p.length);
  const queue: number[] = [];
  for (let v = 0; v < N; v++) if (!indeg[v]) queue.push(v);
  for (let q = 0; q < queue.length; q++) {
    const v = queue[q];
    for (const w of dag[v]) {
      rank[w] = Math.max(rank[w], rank[v] + 1);
      if (--indeg[w] === 0) queue.push(w);
    }
  }
  for (let v = 0; v < N; v++) {
    if (!preds[v].length && dag[v].length) rank[v] = Math.max(0, Math.min(...dag[v].map((w) => rank[w])) - 1);
  }
  const used = [...new Set(rank)].sort((a, b) => a - b);
  const compress = new Map(used.map((r, k) => [r, k]));
  for (let v = 0; v < N; v++) rank[v] = compress.get(rank[v])!;

  const layers: number[][] = used.map(() => []);
  for (let v = 0; v < N; v++) layers[rank[v]].push(v);
  const pos = new Float64Array(N);
  const place = (layer: number[]) => layer.forEach((v, k) => (pos[v] = k - (layer.length - 1) / 2));
  layers.forEach(place);

  const reorder = (layer: number[], nbrs: number[][]) => {
    const keyed = layer.map((v, k) => {
      const ns = nbrs[v];
      const bary = ns.length ? ns.reduce((s, w) => s + pos[w], 0) / ns.length : pos[v];
      return { v, bary, k };
    });
    keyed.sort((a, b) => a.bary - b.bary || a.k - b.k);
    keyed.forEach((e, k) => (layer[k] = e.v));
    place(layer);
  };
  for (let s = 0; s < sweeps; s++) {
    for (let r = 1; r < layers.length; r++) reorder(layers[r], preds);
    for (let r = layers.length - 2; r >= 0; r--) reorder(layers[r], dag);
  }

  const boxes = nodes.map((nd) => size(nd));
  const colW = layers.map((l) => Math.max(...l.map((v) => boxes[v].w)));
  const colH = layers.map((l) => l.reduce((s, v) => s + boxes[v].h, 0) + nodeGap * (l.length - 1));
  const height = Math.max(...colH);
  const positions: Record<string, NodeBox> = {};
  let x = 0;
  layers.forEach((layer, r) => {
    let y = (height - colH[r]) / 2;
    layer.forEach((v, k) => {
      const b = boxes[v];
      positions[nodes[v].id] = { x: x + (colW[r] - b.w) / 2, y, w: b.w, h: b.h, rank: r, order: k };
      y += b.h + nodeGap;
    });
    x += colW[r] + rankGap;
  });
  return {
    positions,
    width: x - rankGap,
    height,
    ranks: layers.map((l) => l.map((v) => nodes[v].id)),
  };
}

/**
 * An equation row made safe to render inline: labels, tags and numbering
 * switches dropped, alignment `&` and row breaks removed, environment
 * wrappers peeled. Without this, align rows and labelled equations fall back
 * to raw source in the graph.
 */
export function displayLatex(latex: string): string {
  return latex
    .replace(/\\(?:label|tag)\*?\{[^{}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)(?![A-Za-z])/g, "")
    .replace(/\\(?:begin|end)\{(?:equation|align|gather|multline|split|aligned|gathered|eqnarray|flalign|alignat|displaymath)\*?\}(?:\{\d+\})?/g, "")
    .replace(/(?<!\\)&/g, " ")
    .replace(/\\\\(?:\[[^\]]*\])?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
