/**
 * repair.ts - "make it render": find what stops the input from rendering and
 * propose concrete repairs, each one re-checked with KaTeX before it counts.
 *
 * Three passes over the *input* (so the cleaner then works on repaired text):
 *
 *   1. Delimiters - close an unclosed `$$`, `\[`, `\(`, `\begin{env}` at the end
 *      of its paragraph; a lone `$` before a digit is a price, so it is escaped.
 *   2. Math blocks - render each with the preview's KaTeX options; on failure,
 *      read KaTeX's error, apply the one rule that addresses it, and render
 *      again, until the block renders or no rule applies (then it is reported
 *      as unresolved, never guessed at).
 *   3. Prose - math-only commands sitting outside any math (`where \alpha is`)
 *      are wrapped in `$...$`.
 *
 * Pure: KaTeX needs no DOM, so this runs in the browser and under the tests.
 */
import katex from "katex";
import { prepareForKatex, tokenize } from "./cleaner";
import { KATEX_OPTIONS } from "./katexOptions";
import { documentParts } from "./texDocument";

export interface Fix {
  /** 1-indexed input line the fix starts on. */
  line: number;
  kind: "delimiter" | "math" | "prose";
  reason: string;
  before: string;
  after: string;
}

export interface Unresolved {
  line: number;
  message: string;
}

export interface RepairResult {
  output: string;
  fixes: Fix[];
  unresolved: Unresolved[];
}

const lineAt = (src: string, offset: number) => src.slice(0, offset).split("\n").length;

/* ---------------------------------------------------------- KaTeX checking */

/** The document's macros for the current repair run (set by repairLatex). */
let activeMacros: Readonly<Record<string, string>> = {};

function renderError(latex: string, display: boolean): { message: string; position?: number } | null {
  try {
    katex.renderToString(prepareForKatex(latex), { ...KATEX_OPTIONS, displayMode: display, macros: { ...activeMacros } });
    return null;
  } catch (err) {
    if (err instanceof katex.ParseError) return { message: err.rawMessage, position: err.position };
    return { message: (err as Error).message };
  }
}

/* ------------------------------------------------------ command suggestions */

/** Common commands KaTeX supports, as candidates for typo correction. */
const KNOWN = (
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega " +
  "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega " +
  "frac dfrac tfrac sqrt sum prod coprod int iint iiint oint lim limsup liminf sup inf max min arg det exp log ln sin cos tan sec csc cot arcsin arccos arctan sinh cosh tanh " +
  "infty partial nabla cdot cdots ldots vdots ddots times div pm mp ast star circ bullet oplus ominus otimes odot cup cap setminus wedge vee neg " +
  "leq geq neq approx equiv sim simeq cong propto ll gg in notin ni subset subseteq supset supseteq perp parallel mid " +
  "to gets leftarrow rightarrow leftrightarrow Leftarrow Rightarrow Leftrightarrow mapsto implies iff longrightarrow uparrow downarrow " +
  "forall exists nexists emptyset varnothing top bot therefore because " +
  "mathbb mathbf mathcal mathfrak mathrm mathit mathsf mathtt mathscr boldsymbol bm operatorname text textbf textit textrm " +
  "hat widehat bar overline underline tilde widetilde vec dot ddot check breve acute grave overbrace underbrace overset underset stackrel " +
  "left right big Big bigg Bigg langle rangle lvert rvert lVert rVert lfloor rfloor lceil rceil " +
  "begin end quad qquad hspace binom choose pmod bmod mod ell hbar Re Im aleph prime dagger " +
  "displaystyle textstyle scriptstyle color boxed cancel underline not"
).split(" ");

/** LLM favourites that are not KaTeX commands, with what they meant. */
const ALIASES: Record<string, string> = {
  R: "\\mathbb{R}",
  N: "\\mathbb{N}",
  Z: "\\mathbb{Z}",
  Q: "\\mathbb{Q}",
  C: "\\mathbb{C}",
  E: "\\mathbb{E}",
  P: "\\mathbb{P}",
  argmax: "\\operatorname*{arg\\,max}",
  argmin: "\\operatorname*{arg\\,min}",
  bold: "\\mathbf",
  mathbbm: "\\mathbb",
  mathds: "\\mathbb",
  textbackslash: "\\backslash",
  abs: "\\operatorname{abs}",
  norm: "\\operatorname{norm}",
  tr: "\\operatorname{tr}",
  Tr: "\\operatorname{Tr}",
  diag: "\\operatorname{diag}",
  sgn: "\\operatorname{sgn}",
  sign: "\\operatorname{sign}",
  Var: "\\operatorname{Var}",
  Cov: "\\operatorname{Cov}",
  softmax: "\\operatorname{softmax}",
  ReLU: "\\operatorname{ReLU}",
  relu: "\\operatorname{ReLU}",
  KL: "\\operatorname{KL}",
  rank: "\\operatorname{rank}",
  dim: "\\dim",
  eps: "\\epsilon",
  lbrace: "\\{",
  rbrace: "\\}",
};

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      // transposition: \alpah -> \alpha is one edit, not two
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

/** The replacement for an undefined `\name`, or null when nothing is close enough. */
export function suggestCommand(name: string): { replacement: string; why: string } | null {
  if (ALIASES[name]) return { replacement: ALIASES[name], why: "\\" + name + " is not built in; used " + ALIASES[name] };
  const limit = name.length <= 4 ? 1 : 2;
  let best: string | null = null;
  let bestD = Infinity;
  for (const k of KNOWN) {
    const d = distance(name, k);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best && bestD <= limit) return { replacement: "\\" + best, why: "\\" + name + " looks like a typo for \\" + best };
  // A plain word used as a command is almost always a named operator.
  if (/^[A-Za-z]{3,}$/.test(name)) return { replacement: "\\operatorname{" + name + "}", why: "\\" + name + " is unknown; set as an operator name" };
  return null;
}

const KNOWN_ENVS = "equation align gather multline split aligned gathered alignat alignedat array matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix smallmatrix cases dcases rcases subarray CD".split(" ");

/* --------------------------------------------------------- per-block rules */

/** Braces opened minus closed, ignoring `\{` and `\}`. */
function braceBalance(s: string): number {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}") depth--;
  }
  return depth;
}

function removeFirstUnmatchedClose(s: string): string | null {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth < 0) return s.slice(0, i) + s.slice(i + 1);
  }
  return null;
}

function openEnvs(s: string): string[] {
  const stack: string[] = [];
  const re = /\\(begin|end)\{([A-Za-z]+\*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[1] === "begin") stack.push(m[2]);
    else if (stack[stack.length - 1] === m[2]) stack.pop();
  }
  return stack;
}

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

type Rule = (latex: string, err: { message: string; position?: number }) => { latex: string; reason: string } | null;

const RULES: Rule[] = [
  // Undefined command: typo, known alias, or a word that wants \operatorname.
  (latex, err) => {
    const m = /Undefined control sequence: \\([A-Za-z]+)/.exec(err.message);
    if (!m) return null;
    const s = suggestCommand(m[1]);
    if (!s) return null;
    const re = new RegExp("\\\\" + m[1] + "(?![A-Za-z])", "g");
    return { latex: latex.replace(re, () => s.replacement), reason: s.why };
  },
  // Missing closing brace(s).
  (latex, err) => {
    if (!/Expected '\}'|expected '\}'|Unexpected end of input/.test(err.message)) return null;
    const missing = braceBalance(latex);
    if (missing <= 0) return null;
    return { latex: latex.replace(/\s*$/, "") + "}".repeat(missing), reason: "added " + missing + " missing closing brace" + (missing > 1 ? "s" : "") };
  },
  // A stray closing brace.
  (latex, err) => {
    if (!/got '\}'|Extra \}|Unexpected '\}'/.test(err.message)) return null;
    const fixed = removeFirstUnmatchedClose(latex);
    return fixed === null ? null : { latex: fixed, reason: "removed a stray closing brace" };
  },
  // \left without \right, or the other way round.
  (latex, err) => {
    const lefts = count(latex, /\\left(?![A-Za-z])/g);
    const rights = count(latex, /\\right(?![A-Za-z])/g);
    if (/Expected '\\\\right'|Missing \\right/.test(err.message) || (lefts > rights && /right/.test(err.message))) {
      return { latex: latex.replace(/\s*$/, "") + " \\right.".repeat(Math.max(1, lefts - rights)), reason: "closed an unpaired \\left with \\right." };
    }
    if (rights > lefts && /right/.test(err.message)) {
      return { latex: "\\left. ".repeat(rights - lefts) + latex, reason: "opened an unpaired \\right with \\left." };
    }
    return null;
  },
  // \left< and friends: invalid delimiters.
  (latex, err) => {
    if (!/Invalid delimiter/.test(err.message)) return null;
    const fixed = latex
      .replace(/\\left\s*</g, "\\left\\langle ")
      .replace(/\\right\s*>/g, "\\right\\rangle ")
      .replace(/\\left\s*\{/g, "\\left\\{")
      .replace(/\\right\s*\}/g, "\\right\\}");
    return fixed === latex ? null : { latex: fixed, reason: "replaced an invalid \\left/\\right delimiter" };
  },
  // \begin{x} ... \end{y}
  (latex, err) => {
    const m = /Mismatch: \\begin\{([^}]+)\} matched by \\end\{([^}]+)\}/.exec(err.message);
    if (!m) return null;
    const at = latex.indexOf("\\end{" + m[2] + "}");
    if (at < 0) return null;
    return { latex: latex.slice(0, at) + "\\end{" + m[1] + "}" + latex.slice(at + m[2].length + 6), reason: "\\end{" + m[2] + "} renamed to match \\begin{" + m[1] + "}" };
  },
  // An environment that is never closed.
  (latex, err) => {
    if (!/\\end|end of input/.test(err.message)) return null;
    const open = openEnvs(latex);
    if (!open.length) return null;
    return { latex: latex.replace(/\s*$/, "") + open.reverse().map((e) => "\n\\end{" + e + "}").join(""), reason: "closed \\begin{" + open[open.length - 1] + "}" };
  },
  // Misspelled environment.
  (latex, err) => {
    const m = /No such environment: ([A-Za-z]+\*?)/.exec(err.message);
    if (!m) return null;
    const bare = m[1].replace(/\*$/, "");
    const star = m[1].endsWith("*") ? "*" : "";
    let best = "";
    let bestD = Infinity;
    for (const e of KNOWN_ENVS) {
      const d = distance(bare, e);
      if (d < bestD) (bestD = d), (best = e);
    }
    if (bestD > 2) return null;
    const re = new RegExp("\\\\(begin|end)\\{" + m[1].replace("*", "\\*") + "\\}", "g");
    return { latex: latex.replace(re, (_, be: string) => "\\" + be + "{" + best + star + "}"), reason: "environment " + m[1] + " renamed to " + best + star };
  },
  // x^2^3 and x_i_j
  (latex, err) => {
    if (!/Double (superscript|subscript)/.test(err.message)) return null;
    const fixed = latex.replace(/([\^_](?:\{[^{}]*\}|\\[A-Za-z]+|[^\s{}\\]))(\s*)(?=[\^_])/, "$1$2{}");
    return fixed === latex ? null : { latex: fixed, reason: "separated a double superscript/subscript with {}" };
  },
  // e^\frac12, x_\sqrt{2}: a function with arguments as a bare script.
  (latex, err) => {
    if (!/with no arguments as (superscript|subscript)/.test(err.message)) return null;
    const fixed = latex.replace(
      /([\^_])\s*(\\(?:[dt]?frac|binom))\s*(\{[^{}]*\}|[^\s{}\\])\s*(\{[^{}]*\}|[^\s{}\\])|([\^_])\s*(\\sqrt)\s*(\{[^{}]*\}|[^\s{}\\])/,
      (_, s1, f1, a, b, s2, f2, c) =>
        s1 ? s1 + "{" + f1 + (a.startsWith("{") ? a : "{" + a + "}") + (b.startsWith("{") ? b : "{" + b + "}") + "}" : s2 + "{" + f2 + (c.startsWith("{") ? c : "{" + c + "}") + "}",
    );
    return fixed === latex ? null : { latex: fixed, reason: "braced a fraction/root used as a superscript" };
  },
  // A $ inside maths (usually a currency sign or a leftover delimiter).
  (latex, err) => {
    if (!/function '\$'|'\$'/.test(err.message)) return null;
    const fixed = latex.replace(/(?<!\\)\$/g, "\\$");
    return fixed === latex ? null : { latex: fixed, reason: "escaped a dollar sign inside maths" };
  },
  // Nested display delimiters inside a block.
  (latex, err) => {
    if (!/function '\\[[(\])]'/.test(err.message)) return null;
    const fixed = latex.replace(/\\[[\]()]/g, " ");
    return fixed === latex ? null : { latex: fixed, reason: "removed nested math delimiters" };
  },
  // & outside any alignment: wrap the block in `aligned`.
  (latex, err) => {
    if (!/got '&'|Misplaced alignment|'&'/.test(err.message) || /\\begin\{/.test(latex)) return null;
    return { latex: "\\begin{aligned}\n" + latex.trim() + "\n\\end{aligned}", reason: "wrapped rows with & in an aligned environment" };
  },
  // \limits after something that is not an operator.
  (latex, err) => {
    if (!/Limit controls must follow a math operator/.test(err.message)) return null;
    const fixed = latex.replace(/\\(no)?limits(?![A-Za-z])/, "");
    return fixed === latex ? null : { latex: fixed, reason: "removed a misplaced \\limits" };
  },
  // array with fewer column specs than columns.
  (latex, err) => {
    if (!/Too few columns specified/.test(err.message)) return null;
    const fixed = latex.replace(/\\begin\{array\}\{([^}]*)\}/, (_, spec: string) => "\\begin{array}{" + spec + "c}");
    return fixed === latex ? null : { latex: fixed, reason: "added a missing array column" };
  },
  // A character KaTeX cannot typeset in math.
  (latex, err) => {
    const m = /Unrecognized Unicode character "(.)"|Unexpected character: '(.)'/.exec(err.message);
    const ch = m?.[1] ?? m?.[2];
    if (!ch) return null;
    return { latex: latex.split(ch).join("\\text{" + ch + "}"), reason: "set " + ch + " as text" };
  },
];

/** Repair one math payload; returns the steps taken, or the error left over. */
export function repairMath(latex: string, display: boolean): { latex: string; reasons: string[]; error: string | null } {
  let current = latex;
  const reasons: string[] = [];
  for (let round = 0; round < 10; round++) {
    const err = renderError(current, display);
    if (!err) return { latex: current, reasons, error: null };
    let applied = false;
    for (const rule of RULES) {
      const r = rule(current, err);
      if (r && r.latex !== current) {
        current = r.latex;
        reasons.push(r.reason);
        applied = true;
        break;
      }
    }
    if (!applied) return { latex: current, reasons, error: err.message.replace(/^KaTeX parse error:\s*/, "") };
  }
  const err = renderError(current, display);
  return { latex: current, reasons, error: err ? err.message : null };
}

/* ------------------------------------------------------ pass 1: delimiters */

const CLOSERS: Array<[RegExp, string, string]> = [
  [/^Unclosed \$\$ /, "$$", "$$"],
  [/^Unclosed \\\[ /, "\\[", "\\]"],
  [/^Unclosed \\\( /, "\\(", "\\)"],
  [/^Unclosed \$ /, "$", "$"],
];

function closeOne(src: string): { src: string; fix: Fix } | null {
  const { tokens, issues } = tokenize(src);
  // In a .tex document only the body is ours to touch; the preamble is config.
  const parts = documentParts(src);
  const firstBodyLine = parts ? src.slice(0, parts.bodyStart).split("\n").length : 0;
  const issue = issues.find((i) => i.line >= firstBodyLine);
  if (!issue) return null;
  const mathRanges = tokens.map((t, i) => [t.kind === "text" ? -1 : t.start, i + 1 < tokens.length ? tokens[i + 1].start : src.length]);
  const lineStart = src.split("\n").slice(0, issue.line - 1).join("\n").length + (issue.line > 1 ? 1 : 0);
  const lineEnd = src.indexOf("\n", lineStart) < 0 ? src.length : src.indexOf("\n", lineStart);
  const lineText = src.slice(lineStart, lineEnd);

  let opener = "";
  let closer = "";
  const env = /^\\begin\{([^}]+)\} has no matching/.exec(issue.message);
  if (env) {
    opener = "\\begin{" + env[1] + "}";
    closer = "\\end{" + env[1] + "}";
  } else {
    const c = CLOSERS.find(([re]) => re.test(issue.message));
    if (!c) return null;
    opener = c[1];
    closer = c[2];
  }

  // The opener on that line that is not already part of a closed block.
  let at = -1;
  for (let p = src.indexOf(opener, lineStart); p >= 0 && p < lineEnd + opener.length; p = src.indexOf(opener, p + 1)) {
    const inside = mathRanges.some(([s, e]) => s >= 0 && p >= s && p < e);
    const escaped = p > 0 && src[p - 1] === "\\" && opener[0] === "$";
    if (!inside && !escaped && (opener !== "$" || src[p + 1] !== "$")) {
      at = p;
      break;
    }
  }
  if (at < 0) return null;

  // `$5` is a price, not maths: escape it rather than inventing a block.
  if (opener === "$" && /[0-9]/.test(src[at + 1] ?? "")) {
    const out = src.slice(0, at) + "\\" + src.slice(at);
    return { src: out, fix: { line: issue.line, kind: "delimiter", reason: "a lone $ before a number is a price - escaped it", before: lineText, after: out.slice(lineStart, lineEnd + 1) } };
  }

  // Close at the end of the paragraph (inline maths: the end of the line).
  const inline = opener === "$" || opener === "\\(";
  let end: number;
  if (inline) end = lineEnd;
  else {
    const blank = /\n[ \t]*\n/g;
    blank.lastIndex = at;
    const m = blank.exec(src);
    end = m ? m.index : src.length;
  }
  while (end > at && /\s/.test(src[end - 1])) end--;
  const insert = (inline ? "" : "\n") + closer;
  const out = src.slice(0, end) + insert + src.slice(end);
  const after = out.slice(lineStart, Math.min(out.length, end + insert.length));
  return {
    src: out,
    fix: { line: issue.line, kind: "delimiter", reason: "closed an unclosed " + opener + " at the end of its " + (inline ? "line" : "paragraph"), before: src.slice(lineStart, end), after },
  };
}

/* ------------------------------------------------------------ pass 3: prose */

/** Commands that only mean something in maths. */
const MATH_ONLY = new RegExp(
  "(?<!\\\\)\\\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Sigma|Phi|Psi|Omega|" +
    "frac|dfrac|sqrt|sum|prod|int|lim|infty|partial|nabla|cdot|times|leq|geq|neq|approx|in|notin|subseteq|forall|exists|mathbb|mathbf|mathcal|hat|bar|vec|tilde|to|rightarrow|Rightarrow)" +
    "(?![A-Za-z])(?:\\s*\\{[^{}\\n]*\\})*(?:\\s*[\\^_](?:\\{[^{}\\n]*\\}|[A-Za-z0-9]))*",
  "g",
);

/* ---------------------------------------------------------------- the API */

export function repairLatex(input: string, macros: Readonly<Record<string, string>> = {}): RepairResult {
  // Macros a document defines are not errors, and never "typo-corrected".
  activeMacros = macros;
  const fixes: Fix[] = [];
  const unresolved: Unresolved[] = [];
  let src = input.replace(/\r\n?/g, "\n");

  // Pass 1: delimiters, one at a time (each insertion moves everything after it).
  for (let guard = 0; guard < 30; guard++) {
    const r = closeOne(src);
    if (!r) break;
    src = r.src;
    fixes.push(r.fix);
  }

  // Passes 2 and 3 work on one tokenization, applied back to front.
  const { tokens } = tokenize(src);
  const parts = documentParts(src);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  tokens.forEach((t, i) => {
    const end = i + 1 < tokens.length ? tokens[i + 1].start : src.length;
    if (parts && (end <= parts.bodyStart || t.start >= parts.bodyEnd)) return;
    if (t.kind === "text") {
      // Code (fenced or inline) is blanked out first, keeping offsets, so a
      // markdown answer that documents LaTeX is never "fixed".
      const prose = t.value.replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, (c) => " ".repeat(c.length));
      MATH_ONLY.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MATH_ONLY.exec(prose))) {
        const s = t.start + m.index;
        if (parts && (s < parts.bodyStart || s >= parts.bodyEnd)) continue;
        const piece = m[0].trimEnd();
        if (renderError(piece, false)) continue;
        edits.push({ start: s, end: s + piece.length, text: "$" + piece + "$" });
        fixes.push({ line: lineAt(src, s), kind: "prose", reason: piece.split(/[{\s^_]/)[0] + " is maths written outside $...$", before: piece, after: "$" + piece + "$" });
      }
      return;
    }
    const raw = src.slice(t.start, end);
    const lead = raw.startsWith("$$") || raw.startsWith("\\[") || raw.startsWith("\\(") ? 2 : raw.startsWith("$") ? 1 : 0;
    const payloadStart = t.start + lead;
    const payloadEnd = payloadStart + t.value.length;
    const r = repairMath(t.value, t.kind === "display");
    if (r.latex !== t.value && r.error === null) {
      edits.push({ start: payloadStart, end: payloadEnd, text: r.latex });
      fixes.push({ line: t.line, kind: "math", reason: r.reasons.join("; "), before: t.value.trim(), after: r.latex.trim() });
    } else if (r.error) {
      unresolved.push({ line: t.line, message: r.error });
    }
  });

  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) src = src.slice(0, e.start) + e.text + src.slice(e.end);

  fixes.sort((a, b) => a.line - b.line);
  return { output: src, fixes, unresolved };
}
