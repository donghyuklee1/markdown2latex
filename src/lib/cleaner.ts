/**
 * cleaner.ts - CleanMath's transformation engine.
 *
 * Pure, synchronous, dependency-free, so it runs on every keystroke in the
 * browser (and under plain node for tests). No network, no server: the user's
 * text never leaves the tab.
 *
 * Pipeline:
 *   normalizeUnicode  ->  tokenize (text / inline math / display math)
 *                     ->  per-block cleanup (unicode math, escape repair,
 *                         \text{} wrapping, smart spacing)
 *                     ->  per-block re-emission in the requested delimiter style
 *                     ->  whitespace tidy
 *
 * Every non-ASCII character is built from its hex codepoint rather than typed
 * literally. Half this file's job is hunting invisible codepoints; they have to
 * stay greppable, diffable and impossible to mangle in transit.
 */

/* ------------------------------------------------------------------ options */

export type DelimiterMode = "standard" | "academic" | "inline";

export interface ConfigOptions {
  /** How display/inline math should be re-emitted. */
  delimiterMode: DelimiterMode;
  /** Wrap prose found inside math blocks in \text{...}. */
  autoText: boolean;
  /** Repair row endings (`\\`) and alignment anchors (`&`) in align-like envs. */
  fixLineBreaks: boolean;
  /**
   * Recognise spacing LaTeX would otherwise get wrong: `\,` before integral
   * differentials, upright `\sin`/`\log`, word gaps around `\text{}`, and
   * tidy single spaces around binary operators.
   */
  smartSpacing: boolean;
}

export const DEFAULT_OPTIONS: ConfigOptions = {
  delimiterMode: "standard",
  autoText: true,
  fixLineBreaks: true,
  smartSpacing: true,
};

export const DELIMITER_MODES: ReadonlyArray<{
  id: DelimiterMode;
  label: string;
  hint: string;
}> = [
  { id: "standard", label: "Standard", hint: "$ inline, $$ display - Obsidian, Notion, GitHub" },
  { id: "academic", label: "Academic", hint: "\\begin{equation*} / \\begin{align*} - Overleaf, paper drafts" },
  { id: "inline", label: "Inline-only", hint: "Everything collapses to $ ... $ - chat, commit messages" },
];

/* ------------------------------------------------------------------- issues */

export type IssueSeverity = "error" | "warning";

export interface Issue {
  /** 1-indexed line in the *input* text. */
  line: number;
  message: string;
  severity: IssueSeverity;
}

/* ------------------------------------------------------------------- tokens */

export type TokenKind = "text" | "inline" | "display";

export interface Token {
  kind: TokenKind;
  /**
   * For `text`: the literal passthrough text.
   * For `inline`/`display`: the math payload. Bare environment blocks keep their
   * own `\begin{...}...\end{...}` wrapper inside `value`.
   */
  value: string;
  start: number;
  /** 1-indexed line where the token starts. */
  line: number;
  /** Environment name when the block is a bare `\begin{...}` block. */
  env: string | null;
}

export interface TokenizeResult {
  tokens: Token[];
  issues: Issue[];
}

/** Environments that stand on their own as display math (no `$$` needed). */
const DISPLAY_ENVS = new Set([
  "equation", "align", "gather", "multline", "alignat", "flalign", "eqnarray",
  "split", "aligned", "gathered", "displaymath",
  "array", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "Bmatrix",
  "smallmatrix", "cases", "subequations",
]);

/**
 * Environments that *are* display math. Everything else in DISPLAY_ENVS -
 * `pmatrix`, `cases`, `aligned`, ... - only works inside math mode, so its
 * surrounding `$$` must be kept.
 */
const STANDALONE_ENVS = new Set([
  "equation", "align", "gather", "multline", "alignat", "flalign", "eqnarray",
  "displaymath", "subequations",
]);

/** Auto-numbered environments, which CleanMath stars so they stay quiet. */
const NUMBERED_ENVS = new Set([
  "equation", "align", "gather", "multline", "alignat", "flalign", "eqnarray",
]);

/** Environments whose body is a list of rows separated by `\\`. */
const ROW_ENVS = new Set([
  "align", "aligned", "gather", "gathered", "split", "multline", "alignat",
  "flalign", "eqnarray", "cases", "array", "matrix", "pmatrix", "bmatrix",
  "vmatrix", "Vmatrix", "Bmatrix", "smallmatrix",
]);

/** Environments where `&` marks the alignment column. */
const AMP_ENVS = new Set([
  "align", "aligned", "split", "alignat", "flalign", "eqnarray", "cases",
]);

/* ------------------------------------------------------- unicode normalizing */

const chr = (hex: string): string => String.fromCodePoint(parseInt(hex, 16));

/** Build a global regex from a char-class body written with \uXXXX escapes. */
const cls = (body: string): RegExp => new RegExp("[" + body + "]", "g");

/**
 * Invisible junk that LLM copy-paste loves to smuggle in: zero-width
 * space/non-joiner/joiner, word joiner, BOM, soft hyphen, Mongolian vowel
 * separator, Arabic letter mark, and the invisible math operators.
 */
const INVISIBLE = cls("\\u200B-\\u200D\\u2060\\uFEFF\\u00AD\\u180E\\u061C\\u2061-\\u2064");

/** Exotic spaces that look like a space but break LaTeX tokenizers. */
const ODD_SPACES = cls("\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000");

const TEXT_FIXES: ReadonlyArray<[RegExp, string]> = [
  [cls("\\u2018\\u2019\\u201A\\u201B"), "'"],
  [cls("\\u201C\\u201D\\u201E\\u201F"), '"'],
  [cls("\\u2026"), "..."],
];

/**
 * Unicode math glyphs -> real LaTeX, keyed by hex codepoint. Applied only
 * *inside* math blocks, so prose keeps its own typography.
 */
const MATH_UNICODE_TABLE: ReadonlyArray<[string, string]> = [
  ["2212", "-"],            // minus sign
  ["2013", "-"],            // en dash
  ["2014", "-"],            // em dash
  ["00D7", "\\times "],
  ["22C5", "\\cdot "],
  ["00B7", "\\cdot "],
  ["00F7", "\\div "],
  ["00B1", "\\pm "],
  ["2213", "\\mp "],
  ["2264", "\\leq "],
  ["2265", "\\geq "],
  ["2260", "\\neq "],
  ["2248", "\\approx "],
  ["2261", "\\equiv "],
  ["221D", "\\propto "],
  ["221E", "\\infty "],
  ["2211", "\\sum "],
  ["220F", "\\prod "],
  ["222B", "\\int "],
  ["2202", "\\partial "],
  ["2207", "\\nabla "],
  ["2208", "\\in "],
  ["2209", "\\notin "],
  ["2282", "\\subset "],
  ["2286", "\\subseteq "],
  ["222A", "\\cup "],
  ["2229", "\\cap "],
  ["2205", "\\emptyset "],
  ["2200", "\\forall "],
  ["2203", "\\exists "],
  ["2192", "\\to "],
  ["21D2", "\\Rightarrow "],
  ["21D4", "\\Leftrightarrow "],
  ["2190", "\\leftarrow "],
  ["00B0", "^\\circ "],
  ["03B1", "\\alpha "],
  ["03B2", "\\beta "],
  ["03B3", "\\gamma "],
  ["03B4", "\\delta "],
  ["03B5", "\\varepsilon "],
  ["03B6", "\\zeta "],
  ["03B7", "\\eta "],
  ["03B8", "\\theta "],
  ["03BA", "\\kappa "],
  ["03BB", "\\lambda "],
  ["03BC", "\\mu "],
  ["03BD", "\\nu "],
  ["03BE", "\\xi "],
  ["03C0", "\\pi "],
  ["03C1", "\\rho "],
  ["03C3", "\\sigma "],
  ["03C4", "\\tau "],
  ["03C6", "\\phi "],
  ["03C7", "\\chi "],
  ["03C8", "\\psi "],
  ["03C9", "\\omega "],
  ["0393", "\\Gamma "],
  ["0394", "\\Delta "],
  ["0398", "\\Theta "],
  ["039B", "\\Lambda "],
  ["03A0", "\\Pi "],
  ["03A3", "\\Sigma "],
  ["03A6", "\\Phi "],
  ["03A8", "\\Psi "],
  ["03A9", "\\Omega "],
  ["0399", "I"],            // Greek capitals that look Latin typeset as Latin
  ["039E", "\\Xi "],
  ["03A5", "\\Upsilon "],
  ["03B9", "\\iota "],
  ["03C5", "\\upsilon "],
  ["03C2", "\\varsigma "],
  ["03D5", "\\phi "],
  ["03F5", "\\epsilon "],
  ["211D", "\\mathbb{R}"],
  ["2115", "\\mathbb{N}"],
  ["2124", "\\mathbb{Z}"],
  ["211A", "\\mathbb{Q}"],
  ["2102", "\\mathbb{C}"],
  ["2113", "\\ell "],
  ["210F", "\\hbar "],
  ["2218", "\\circ "],
  ["22A5", "\\perp "],
  ["2225", "\\parallel "],
  ["2223", "\\mid "],
  ["226A", "\\ll "],
  ["226B", "\\gg "],
  ["223C", "\\sim "],
  ["2243", "\\simeq "],
  ["2245", "\\cong "],
  ["2283", "\\supset "],
  ["2287", "\\supseteq "],
  ["2216", "\\setminus "],
  ["2227", "\\land "],
  ["2228", "\\lor "],
  ["00AC", "\\neg "],
  ["2295", "\\oplus "],
  ["2297", "\\otimes "],
  ["222C", "\\iint "],
  ["222E", "\\oint "],
  ["2234", "\\therefore "],
  ["2235", "\\because "],
  ["22EF", "\\cdots "],
  ["22EE", "\\vdots "],
  ["22F1", "\\ddots "],
  ["21D0", "\\Leftarrow "],
  ["2194", "\\leftrightarrow "],
  ["21A6", "\\mapsto "],
  ["27E8", "\\langle "],
  ["27E9", "\\rangle "],
  ["2308", "\\lceil "],
  ["2309", "\\rceil "],
  ["230A", "\\lfloor "],
  ["230B", "\\rfloor "],
  ["2032", "'"],            // prime
  ["2033", "''"],           // double prime
  ["00BD", "\\frac{1}{2}"],
  ["00BC", "\\frac{1}{4}"],
  ["00BE", "\\frac{3}{4}"],
];

const MATH_UNICODE: ReadonlyArray<[RegExp, string]> = MATH_UNICODE_TABLE.map(
  ([hex, latex]) => [new RegExp(chr(hex), "g"), latex] as [RegExp, string],
);

/** Line-ending + invisible-character normalization, applied document-wide. */
export function normalizeUnicode(src: string): string {
  let out = src.replace(/\r\n?/g, "\n").replace(INVISIBLE, "").replace(ODD_SPACES, " ");
  for (const [re, to] of TEXT_FIXES) out = out.replace(re, to);
  return out;
}

/**
 * Unicode super/subscript glyphs, as [codepoint, plain character]. A run of
 * them becomes one group, so `x\u00B2\u00B3` is `x^{23}` rather than `x^{2}^{3}`
 * (a double-superscript error).
 */
const SUPERSCRIPTS: ReadonlyArray<[string, string]> = [
  ["2070", "0"], ["00B9", "1"], ["00B2", "2"], ["00B3", "3"], ["2074", "4"],
  ["2075", "5"], ["2076", "6"], ["2077", "7"], ["2078", "8"], ["2079", "9"],
  ["207A", "+"], ["207B", "-"], ["207C", "="], ["207D", "("], ["207E", ")"],
  ["207F", "n"], ["2071", "i"],
];
const SUBSCRIPTS: ReadonlyArray<[string, string]> = [
  ["2080", "0"], ["2081", "1"], ["2082", "2"], ["2083", "3"], ["2084", "4"],
  ["2085", "5"], ["2086", "6"], ["2087", "7"], ["2088", "8"], ["2089", "9"],
  ["208A", "+"], ["208B", "-"], ["208C", "="], ["208D", "("], ["208E", ")"],
  ["2090", "a"], ["2091", "e"], ["2092", "o"], ["2093", "x"], ["2095", "h"],
  ["2096", "k"], ["2097", "l"], ["2098", "m"], ["2099", "n"], ["209A", "p"],
  ["209B", "s"], ["209C", "t"], ["1D62", "i"], ["2C7C", "j"],
];

function scriptRun(table: ReadonlyArray<[string, string]>, marker: string): (s: string) => string {
  const map = new Map(table.map(([hex, ch]) => [chr(hex), ch]));
  const run = new RegExp("[" + table.map(([hex]) => "\\u" + hex).join("") + "]+", "g");
  return (s) => s.replace(run, (m) => marker + "{" + [...m].map((c) => map.get(c)).join("") + "}");
}
const toSuperscripts = scriptRun(SUPERSCRIPTS, "^");
const toSubscripts = scriptRun(SUBSCRIPTS, "_");

const SQRT = chr("221A");
/**
 * `\u221A` takes one argument, so it has to carry its operand into braces:
 * `\u221A2` -> `\sqrt{2}`, `\u221A(x+1)` -> `\sqrt{x+1}`. A bare `\sqrt (x+1)`
 * would only take the parenthesis.
 */
function unicodeSqrt(src: string): string {
  if (!src.includes(SQRT)) return src;
  const operand = new RegExp(SQRT + "[ \\t]*(?:\\(([^()]*)\\)|(\\d+(?:\\.\\d+)?|[A-Za-z]|\\\\[A-Za-z]+)|\\{([^{}]*)\\})", "g");
  return src
    .replace(operand, (_, paren?: string, atom?: string, brace?: string) =>
      "\\sqrt{" + (paren ?? atom ?? brace ?? "").trim() + "}")
    .replaceAll(SQRT, "\\sqrt ");
}

function unicodeMathToLatex(src: string): string {
  let out = toSubscripts(toSuperscripts(src));
  for (const [re, to] of MATH_UNICODE) out = out.replace(re, to);
  // After the table, so `\u221A\u03C0` sees `\pi` and braces it whole.
  out = unicodeSqrt(out);
  // `\times )` -> `\times)`; undo the padding the table above adds.
  return out.replace(/([a-zA-Z])\s+([)\]},])/g, "$1$2");
}

/* ---------------------------------------------------------------- tokenizer */

function makeLineIndex(src: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (offset: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Index of `closer` at or after `from`, skipping LaTeX escape pairs so `\$` and
 * `\\]` can never terminate a block by accident. -1 when absent.
 */
function findClose(src: string, from: number, closer: string): number {
  let j = from;
  while (j < src.length) {
    if (src.startsWith(closer, j)) return j;
    if (src[j] === "\\") {
      j += 2;
      continue;
    }
    j++;
  }
  return -1;
}

/** Index of the matching `\end{name}`, honouring same-name nesting. -1 when absent. */
function findEnvEnd(src: string, from: number, name: string): number {
  const escaped = name.replace(/[*\\^$.|?+()[\]{}]/g, "\\$&");
  const re = new RegExp("\\\\(begin|end)\\{" + escaped + "\\}", "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return m.index;
  }
  return -1;
}

/**
 * Split a document into prose and math. Unterminated delimiters never throw: the
 * opener degrades to literal text and an `Issue` is recorded instead, so the
 * preview keeps rendering while the user is still mid-keystroke.
 */
export function tokenize(src: string): TokenizeResult {
  const tokens: Token[] = [];
  const issues: Issue[] = [];
  const lineAt = makeLineIndex(src);
  const n = src.length;

  let buf = "";
  let bufStart = 0;
  let i = 0;

  const text = (s: string, start: number) => {
    if (!buf) bufStart = start;
    buf += s;
  };
  const flush = () => {
    if (!buf) return;
    tokens.push({ kind: "text", value: buf, start: bufStart, line: lineAt(bufStart), env: null });
    buf = "";
  };
  const math = (kind: "inline" | "display", value: string, start: number, env: string | null) => {
    flush();
    tokens.push({ kind, value, start, line: lineAt(start), env });
  };
  const unclosed = (what: string, start: number) => {
    issues.push({
      line: lineAt(start),
      severity: "error",
      message: "Unclosed " + what + " - no matching closing delimiter was found.",
    });
  };

  while (i < n) {
    // --- fenced / inline code: pass through untouched ------------------------
    if (src.startsWith("```", i) && (i === 0 || src[i - 1] === "\n")) {
      const end = src.indexOf("```", i + 3);
      const stop = end === -1 ? n : end + 3;
      text(src.slice(i, stop), i);
      i = stop;
      continue;
    }
    if (src[i] === "`") {
      const end = src.indexOf("`", i + 1);
      const stop = end === -1 ? i + 1 : end + 1;
      text(src.slice(i, stop), i);
      i = stop;
      continue;
    }

    // --- backslash openers --------------------------------------------------
    if (src[i] === "\\" && i + 1 < n) {
      const two = src.slice(i, i + 2);

      if (two === "\\[") {
        const close = findClose(src, i + 2, "\\]");
        if (close === -1) {
          unclosed("\\[ display block", i);
          text(two, i);
          i += 2;
          continue;
        }
        math("display", src.slice(i + 2, close), i, null);
        i = close + 2;
        continue;
      }

      if (two === "\\(") {
        const close = findClose(src, i + 2, "\\)");
        if (close === -1) {
          unclosed("\\( inline block", i);
          text(two, i);
          i += 2;
          continue;
        }
        math("inline", src.slice(i + 2, close), i, null);
        i = close + 2;
        continue;
      }

      const begin = /^\\begin\{([A-Za-z]+\*?)\}/.exec(src.slice(i));
      if (begin) {
        const name = begin[1];
        const bare = name.replace(/\*$/, "");
        if (DISPLAY_ENVS.has(bare)) {
          const bodyStart = i + begin[0].length;
          const endIdx = findEnvEnd(src, bodyStart, name);
          if (endIdx === -1) {
            issues.push({
              line: lineAt(i),
              severity: "error",
              message: "\\begin{" + name + "} has no matching \\end{" + name + "}.",
            });
            text(begin[0], i);
            i += begin[0].length;
            continue;
          }
          const stop = endIdx + ("\\end{" + name + "}").length;
          math("display", src.slice(i, stop), i, bare);
          i = stop;
          continue;
        }
      }

      // `\\`, `\$`, `\{`, ... and ordinary prose commands: copy the pair so the
      // second character can never be mistaken for a delimiter.
      text(two, i);
      i += 2;
      continue;
    }

    // --- dollar openers -----------------------------------------------------
    if (src.startsWith("$$", i)) {
      const close = findClose(src, i + 2, "$$");
      if (close === -1) {
        unclosed("$$ display block", i);
        text("$$", i);
        i += 2;
        continue;
      }
      math("display", src.slice(i + 2, close), i, null);
      i = close + 2;
      continue;
    }

    if (src[i] === "$") {
      const close = findClose(src, i + 1, "$");
      const payload = close === -1 ? "" : src.slice(i + 1, close);
      // A blank line inside `$ ... $` means the opener was never really closed;
      // bailing out here stops one stray `$` from swallowing the document.
      if (close === -1 || /\n[ \t]*\n/.test(payload)) {
        unclosed("$ inline block", i);
        text("$", i);
        i += 1;
        continue;
      }
      math("inline", payload, i, null);
      i = close + 1;
      continue;
    }

    text(src[i], i);
    i += 1;
  }

  flush();
  return { tokens, issues };
}

/* ----------------------------------------------------- \text{} auto-escaping */

/** NUL placeholder: cannot appear in user input that survived normalizeUnicode. */
const MASK = String.fromCharCode(0);

/**
 * Patterns hidden behind placeholders before prose detection runs, so a command
 * name is never mistaken for an English word.
 */
const MASK_PATTERNS: RegExp[] = [
  /\\(?:begin|end)\{[A-Za-z]+\*?\}/g,
  /\\(?:text|textrm|textbf|textit|textsf|texttt|mbox|mathrm|mathbf|mathit|mathsf|mathtt|operatorname|label|tag|ref|eqref|cite)\s*\*?\{[^{}]*\}/g,
  /\\[A-Za-z]+\*?/g,
  /\\[^A-Za-z]/g,
];

function maskLatex(src: string, store: string[]): string {
  let out = src;
  for (const re of MASK_PATTERNS) {
    out = out.replace(re, (m) => {
      store.push(m);
      return MASK + (store.length - 1) + MASK;
    });
  }
  return out;
}

function unmaskLatex(src: string, store: string[]): string {
  const re = new RegExp(MASK + "(\\d+)" + MASK, "g");
  let out = src;
  let guard = 6;
  while (guard-- > 0 && out.includes(MASK)) {
    out = out.replace(re, (_, idx: string) => store[Number(idx)] ?? "");
  }
  return out;
}

/** Hangul syllables plus compatibility jamo. */
const HANGUL = "\\uAC00-\\uD7A3\\u3131-\\u314E";
const PROSE_PAREN = new RegExp("[ \\t]*\\(([^()" + MASK + "]*)\\)", "g");
const WORD_RUN = /[A-Za-z]{2,}(?:[ \t]+[A-Za-z]{2,})+/g;
const HANGUL_RUN = new RegExp("[" + HANGUL + "][" + HANGUL + "0-9 \\t,.]*", "g");
const HANGUL_TEST = new RegExp("[" + HANGUL + "]");
const PROSE_SAFE = new RegExp("^[A-Za-z0-9" + HANGUL + "\\s,.'\"!?;:%\\-]+$");

/** Does a parenthesised group read as an explanatory aside rather than algebra? */
function isProseParen(inner: string): boolean {
  if (!inner.trim()) return false;
  if (!PROSE_SAFE.test(inner)) return false;
  if (HANGUL_TEST.test(inner)) return true;
  // Two or more real words in a row - `(y 1)` and `(n)` stay as maths.
  return /[A-Za-z]{2,}[ \t]+[A-Za-z]{2,}/.test(inner);
}

/**
 * Wrap stray prose inside a math block in `\text{...}`. Deliberately
 * conservative: single symbols, function names and anything containing an
 * operator are left alone, because a false positive here silently rewrites the
 * user's maths.
 */
export function autoEscapeText(mathSrc: string): string {
  const store: string[] = [];
  let out = maskLatex(mathSrc, store);

  out = out.replace(PROSE_PAREN, (whole, inner: string) =>
    isProseParen(inner) ? " \\text{ (" + inner.trim() + ")}" : whole,
  );

  // Re-mask what we just produced so the passes below cannot double-wrap it.
  out = out.replace(/\\text\{[^{}]*\}/g, (m) => {
    store.push(m);
    return MASK + (store.length - 1) + MASK;
  });

  out = out.replace(HANGUL_RUN, (m) => {
    const trimmed = m.trim();
    if (!trimmed) return m;
    return "\\text{" + trimmed + "}" + (/[ \t]$/.test(m) ? " " : "");
  });
  // `dx dy` is two differentials, not two English words.
  out = out.replace(WORD_RUN, (m) =>
    m.split(/[ \t]+/).every((w) => /^d[A-Za-z]$/.test(w)) ? m : "\\text{" + m + "}",
  );

  return unmaskLatex(out, store);
}

/* ------------------------------------------------------------ escape repair */

/** Text-mode groups: their contents are words, never maths to be respaced. */
const TEXT_GROUP = /\\(?:text|textrm|textbf|textit|textsf|texttt|mbox)\s*\{[^{}]*\}/g;

/**
 * Commands that, written with a doubled backslash, can only be a JSON- or
 * string-escaped copy: a row break `\\` followed directly by the bare word
 * `frac` or `alpha` is not something anyone types on purpose.
 */
const KNOWN_COMMANDS = [
  "frac", "dfrac", "tfrac", "sqrt", "sum", "prod", "int", "iint", "oint", "lim",
  "infty", "partial", "nabla", "cdot", "cdots", "ldots", "times", "div", "pm",
  "leq", "geq", "neq", "approx", "equiv", "subseteq", "forall", "exists",
  "rightarrow", "Rightarrow", "leftarrow", "mathbb", "mathbf", "mathrm",
  "mathcal", "text", "left", "right", "sin", "cos", "tan", "log", "exp", "hat",
  "bar", "vec", "tilde", "overline", "binom", "quad", "qquad", "operatorname",
  "langle", "rangle", "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon",
  "theta", "lambda", "sigma", "omega", "Delta", "Sigma", "Omega",
].join("|");
const DOUBLED_COMMAND = new RegExp("(?<!\\\\)\\\\\\\\(" + KNOWN_COMMANDS + ")(?![A-Za-z])", "g");

/**
 * Repair escaping damage that survives copy-paste:
 * - `\\frac` from a JSON-escaped string becomes `\frac`.
 * - `x\_1` from markdown escaping becomes `x_1`. In math, `\_` typesets a
 *   literal underscore, which is never what the author meant. `\text{a\_b}` is
 *   left alone: in text mode the escape is correct.
 * - Python-style `x**2` becomes `x^{2}`, when the exponent is one clear atom.
 */
export function repairEscapes(mathSrc: string): string {
  const store: string[] = [];
  let out = mathSrc.replace(TEXT_GROUP, (m) => {
    store.push(m);
    return MASK + (store.length - 1) + MASK;
  });
  out = out
    .replace(DOUBLED_COMMAND, "\\$1")
    .replace(/(?<!\\)\\_/g, "_")
    .replace(
      /([A-Za-z0-9)}\]])[ \t]*\*\*[ \t]*(?:\(([^()]*)\)|\{([^{}]*)\}|(-?\d+(?:\.\d+)?|[A-Za-z]|\\[A-Za-z]+))/g,
      (_, base: string, paren?: string, brace?: string, atom?: string) =>
        base + "^{" + (paren ?? brace ?? atom ?? "").trim() + "}",
    );
  return unmaskLatex(out, store);
}

/* ----------------------------------------------------------- smart spacing */

/** Operator names KaTeX/LaTeX typeset upright when written as commands. */
const FUNCTION_NAMES = [
  "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "sin", "cos", "tan",
  "sec", "csc", "cot", "log", "ln", "exp", "lim", "max", "min", "sup", "inf",
  "det", "gcd", "deg", "dim", "ker", "arg",
].join("|");
/** Not after a letter, a backslash or a script marker: `x_{max}` stays a label. */
const BARE_FUNCTION = new RegExp("(?<![A-Za-z\\\\])(?<![_^]\\{?)(" + FUNCTION_NAMES + ")(?![A-Za-z])", "g");

const INTEGRAL = /\\(?:int|iint|iiint|oint)(?![A-Za-z])/;
/**
 * A differential in an integrand: `d` plus one variable (or a masked command
 * such as `\theta`), preceded either by a space after an operand, or directly
 * by a closing bracket or digit. `{dx}` in `\frac{d}{dx}` never qualifies.
 */
const DIFFERENTIAL = new RegExp(
  // Lookbehinds, not captures: in `dx dy` the `x` must stay free to precede `dy`.
  "(?:(?<=[^\\s{(\\[,;:=+\\-*/^_&<>|" + MASK + "])[ \\t]+|(?<=[)}\\]0-9]))d((?:[A-Za-z]|" + MASK + "\\d+" + MASK + ")(?![A-Za-z0-9]))",
  "g",
);
const GREEK = /^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/;

/** `\int f(x) dx` -> `\int f(x)\,dx`, the thin space every textbook uses. */
function spaceDifferentials(masked: string, store: string[]): string {
  return masked.replace(DIFFERENTIAL, (whole, variable: string) => {
    if (variable.startsWith(MASK) && !GREEK.test(store[Number(variable.slice(1, -1))] ?? "")) return whole;
    return "\\,d" + variable;
  });
}

const WORDISH = new RegExp("[A-Za-z" + HANGUL + "]");

/**
 * `x \text{if} y` renders as "xify": text mode inside maths keeps no outer
 * spacing. Pad the inside of the group wherever it touches an operand, and only
 * there - `= \text{yes}` already gets relation spacing.
 */
function spaceTextGroups(src: string): string {
  return src.replace(
    /\\(text|textrm|mbox)\{([^{}]*)\}/g,
    (whole, cmd: string, body: string, offset: number) => {
      if (!body.trim()) return whole;
      const before = src.slice(0, offset).trimEnd();
      const after = src.slice(offset + whole.length).trimStart();
      let inner = body;
      if (WORDISH.test(inner[0]) && /[A-Za-z0-9)}\]|!']$/.test(before)) inner = " " + inner;
      if (
        WORDISH.test(inner[inner.length - 1]) &&
        (/^[A-Za-z0-9(]/.test(after) ||
          (/^\\[A-Za-z]/.test(after) && !/^\\(?:quad|qquad|text|textrm|mbox|end|label|tag|nonumber)(?![A-Za-z])/.test(after)))
      ) {
        inner = inner + " ";
      }
      return "\\" + cmd + "{" + inner + "}";
    },
  );
}

/* --- operator tidy: a tiny tokenizer, since regexes cannot see brace depth --- */

/** Commands whose `{...}` argument is opaque: labels, units, colours, text. */
const ATOM_COMMANDS = /^\\(?:text|textrm|textbf|textit|textsf|texttt|mbox|mathrm|mathbf|mathit|mathsf|mathtt|mathbb|mathcal|mathfrak|boldsymbol|operatorname|label|ref|eqref|tag|cite|href|url|hspace|vspace|color|textcolor|begin|end)\*?$/;
/** Atoms after which `-` is subtraction, not negation. */
const OPERAND_COMMANDS = /^\\(?:mathrm|mathbf|mathit|mathsf|mathtt|mathbb|mathcal|mathfrak|boldsymbol|infty|hbar|ell|prime|\}|\||rangle|rbrace|rvert|rVert|rceil|rfloor|dots|ldots|cdots)(?![A-Za-z])|^\\(?:alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega)$/;
/** Two-character operators that must stay glued together. */
const COMPOUND_OPS = new Set(["<=", ">=", "!=", ":=", "=:", "==", "->", "<-", "=>", "<<", ">>", "--", "++"]);

type Tok = { kind: "ws" | "cmd" | "atom" | "ch"; text: string };

function lexLine(line: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === " " || ch === "\t") {
      let j = i;
      while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
      toks.push({ kind: "ws", text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "\\") {
      const m = /^\\(?:[A-Za-z]+\*?|.)/.exec(line.slice(i));
      const head = m ? m[0] : "\\";
      let j = i + head.length;
      if (ATOM_COMMANDS.test(head)) {
        // Swallow the balanced argument (and `\begin{array}{cc}`'s second one).
        let k = j;
        while (line[k] === " ") k++;
        if (line[k] === "{") {
          let depth = 0;
          for (; k < line.length; k++) {
            if (line[k] === "\\") { k++; continue; }
            if (line[k] === "{") depth++;
            else if (line[k] === "}" && --depth === 0) break;
          }
          if (k < line.length) j = k + 1;
        }
        toks.push({ kind: "atom", text: line.slice(i, j) });
      } else {
        toks.push({ kind: "cmd", text: head });
      }
      i = j;
      continue;
    }
    toks.push({ kind: "ch", text: ch });
    i++;
  }
  return toks;
}

function isOperand(tok: Tok | undefined): boolean {
  if (!tok) return false;
  if (tok.kind === "ch") return /[A-Za-z0-9.)\]}|!']/.test(tok.text);
  return OPERAND_COMMANDS.test(tok.text);
}

/**
 * Normalise source spacing so the LaTeX reads cleanly: `a+  b=c` -> `a + b = c`.
 * Rendering is unchanged - TeX ignores math-mode spaces - so this only ever
 * touches binary `+ - = < >` outside scripts, and leaves unary minus, `x^{-1}`,
 * `x_{i+1}`, `\label{a-b}` and compound operators like `<=` exactly as written.
 */
function tidyOperators(line: string): string {
  const toks = lexLine(line);
  const out: Tok[] = [];
  /** One entry per open brace: true when it opened a `^{` / `_{` script. */
  const stack: boolean[] = [];
  const lastSolid = () => {
    for (let k = out.length - 1; k >= 0; k--) if (out[k].kind !== "ws") return out[k];
    return undefined;
  };
  const trimWs = () => {
    while (out.length && out[out.length - 1].kind === "ws") out.pop();
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];

    if (tok.kind === "ws") {
      // Interior runs collapse to one space; leading indentation is kept.
      out.push(out.length && i < toks.length - 1 ? { kind: "ws", text: " " } : tok);
      continue;
    }
    if (tok.kind !== "ch") {
      out.push(tok);
      continue;
    }

    if (tok.text === "{") {
      const prev = lastSolid();
      stack.push(prev?.kind === "ch" && (prev.text === "^" || prev.text === "_"));
      out.push(tok);
      continue;
    }
    if (tok.text === "}") {
      stack.pop();
      out.push(tok);
      continue;
    }

    if (!"+-=<>".includes(tok.text) || stack.includes(true)) {
      out.push(tok);
      continue;
    }

    const rawPrev = i > 0 && toks[i - 1].kind === "ch" ? toks[i - 1].text : "";
    const rawNext = i + 1 < toks.length && toks[i + 1].kind === "ch" ? toks[i + 1].text : "";
    if (COMPOUND_OPS.has(rawPrev + tok.text) || COMPOUND_OPS.has(tok.text + rawNext)) {
      out.push(tok);
      continue;
    }

    const prev = lastSolid();
    const relation = tok.text === "=" || tok.text === "<" || tok.text === ">";
    if (!relation && !isOperand(prev)) {
      out.push(tok); // unary sign: `-x`, `(-1)`, `= -b`, `e^-x`
      continue;
    }
    if (relation && !prev) {
      out.push(tok); // a row that starts with `=` continues the previous one
      continue;
    }

    // `&=` is one unit in an align row; keep the anchor glued on.
    if (!(prev?.kind === "ch" && prev.text === "&" && rawPrev === "&")) {
      trimWs();
      out.push({ kind: "ws", text: " " });
    }
    out.push(tok);
    // Only pad the right side if something follows on this line.
    let j = i + 1;
    while (j < toks.length && toks[j].kind === "ws") j++;
    if (j < toks.length) out.push({ kind: "ws", text: " " });
    i = j - 1;
  }

  return out.map((t) => t.text).join("");
}

/**
 * Automatic spacing: recognise where the author's intent and LaTeX's own
 * spacing rules disagree, and write the spacing LaTeX needs.
 */
export function smartSpacing(mathSrc: string): string {
  const store: string[] = [];
  let out = maskLatex(mathSrc, store);
  out = out.replace(BARE_FUNCTION, "\\$1");
  if (INTEGRAL.test(mathSrc)) out = spaceDifferentials(out, store);
  out = unmaskLatex(out, store);
  out = spaceTextGroups(out);
  return out.split("\n").map(tidyOperators).join("\n");
}

/* ------------------------------------------------- environment row repairing */

/** Insert the `&` alignment anchor before the first top-level relation. */
function insertAlignAnchor(line: string): string {
  if (line.includes("&")) return line;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++; // skip the escaped character / command head
      continue;
    }
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    else if (ch === "=" && depth === 0) {
      const prev = line[i - 1];
      const next = line[i + 1];
      if (prev === "<" || prev === ">" || prev === "!" || prev === ":" || prev === "=" || next === "=") {
        return line;
      }
      let j = i;
      while (j > 0 && (line[j - 1] === " " || line[j - 1] === "\t")) j--;
      if (j === 0) return line; // the relation starts the row: nothing to align on
      return line.slice(0, j) + " &" + line.slice(i);
    }
  }
  return line;
}

/** A row already ends in something that continues it: leave it alone. */
const ROW_CONTINUES = /(\\\\(\s*\*)?(\s*\[[^\]]*\])?|&|\{|\\begin\{[^}]*\}|\\end\{[^}]*\}|\\hline|\\cr)\s*$/;

/** Give every row but the last a `\\` terminator, and align-like rows an `&`. */
function repairRows(body: string, addAnchor: boolean): string {
  const lines = body.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  const lastContent = lines.length - 1;

  return lines
    .map((line, idx) => {
      let out = line;
      if (addAnchor && !/^\\(begin|end|hline|intertext|nonumber)\b/.test(out)) {
        out = insertAlignAnchor(out);
      }
      const structural = /^\\(begin|end|hline)\b/.test(out);
      if (idx < lastContent && !structural && !ROW_CONTINUES.test(out)) out += " \\\\";
      return out;
    })
    .join("\n");
}

/* ----------------------------------------------------------- block rendering */

interface EnvWrapper {
  name: string;
  starred: boolean;
  body: string;
}

/** Recognise content that is *exactly* one `\begin{...}...\end{...}` block. */
function detectEnvWrapper(content: string): EnvWrapper | null {
  const src = content.trim();
  const m = /^\\begin\{([A-Za-z]+\*?)\}/.exec(src);
  if (!m) return null;
  // The *matching* \end must close the block. `\begin{pmatrix}..\end{pmatrix}
  // = \begin{pmatrix}..\end{pmatrix}` starts and ends with the same name but is
  // three things, not one.
  const end = findEnvEnd(src, m[0].length, m[1]);
  if (end === -1 || end + ("\\end{" + m[1] + "}").length !== src.length) return null;
  return { name: m[1].replace(/\*$/, ""), starred: m[1].endsWith("*"), body: src.slice(m[0].length, end) };
}

/** Each top-level `\begin{...}...\end{...}` span in `src`, in order. */
function topLevelEnvs(src: string): Array<{ name: string; start: number; bodyStart: number; end: number; stop: number }> {
  const found = [];
  const re = /\\begin\{([A-Za-z]+\*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = findEnvEnd(src, m.index + m[0].length, m[1]);
    if (end === -1) break;
    const stop = end + ("\\end{" + m[1] + "}").length;
    found.push({ name: m[1], start: m.index, bodyStart: m.index + m[0].length, end, stop });
    re.lastIndex = stop;
  }
  return found;
}

/** Row-repair matrices and friends nested inside a larger display block. */
function repairNestedEnvs(src: string): string {
  let out = "";
  let last = 0;
  for (const env of topLevelEnvs(src)) {
    const bare = env.name.replace(/\*$/, "");
    const body = src.slice(env.bodyStart, env.end);
    if (!ROW_ENVS.has(bare) || !body.trim().includes("\n")) continue;
    out += src.slice(last, env.bodyStart) + "\n" + repairRows(body, AMP_ENVS.has(bare)) + "\n";
    last = env.end;
  }
  return out + src.slice(last);
}

/** Does the block have row breaks of its own, outside any nested environment? */
function hasTopLevelRows(src: string): boolean {
  let flat = "";
  let last = 0;
  for (const env of topLevelEnvs(src)) {
    flat += src.slice(last, env.start);
    last = env.stop;
  }
  return /\\\\/.test(flat + src.slice(last));
}

function cleanBlockContent(raw: string, options: ConfigOptions): string {
  let out = repairEscapes(unicodeMathToLatex(raw));
  out = out.replace(/[ \t]+$/gm, "");
  if (options.autoText) out = autoEscapeText(out);
  if (options.smartSpacing) out = smartSpacing(out);
  return out.trim();
}

function collapse(src: string): string {
  return src.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
}

function renderEnv(env: EnvWrapper, options: ConfigOptions): string {
  // Numbered environments get starred: a snippet pasted mid-document should not
  // silently renumber the author's own equations.
  const name = NUMBERED_ENVS.has(env.name) ? env.name + "*" : env.name;
  const body = options.fixLineBreaks && ROW_ENVS.has(env.name)
    ? repairRows(env.body, AMP_ENVS.has(env.name))
    : env.body.replace(/^\n+|\n+$/g, "");
  return "\\begin{" + name + "}\n" + body + "\n\\end{" + name + "}";
}

function renderDisplay(content: string, options: ConfigOptions): string {
  const env = detectEnvWrapper(content);
  // Outer `$$` / `\[` around an existing environment is the most common Overleaf
  // compile error in LLM output - drop it and emit the environment bare. Only for
  // environments that are display math themselves: a bare `pmatrix` is the
  // opposite error.
  if (env && STANDALONE_ENVS.has(env.name)) return renderEnv(env, options);

  const body = env
    ? renderEnv(env, options)
    : options.fixLineBreaks ? repairNestedEnvs(content) : content;

  if (options.delimiterMode === "inline") return "$" + collapse(body) + "$";

  if (options.delimiterMode === "academic") {
    // `equation` holds exactly one row; multi-row content needs `align*`.
    // Row breaks inside a nested matrix do not count.
    if (!env && hasTopLevelRows(body)) {
      return "\\begin{align*}\n" + (options.fixLineBreaks ? repairRows(body, true) : body) + "\n\\end{align*}";
    }
    return "\\begin{equation*}\n" + body + "\n\\end{equation*}";
  }

  return "$$\n" + body + "\n$$";
}

function renderInline(content: string): string {
  return "$" + collapse(content) + "$";
}

/* ------------------------------------------------------------------ the API */

export interface CleanResult {
  output: string;
  issues: Issue[];
  /** How many math blocks were normalized. */
  blocks: number;
}

export function cleanMathDetailed(input: string, options: ConfigOptions = DEFAULT_OPTIONS): CleanResult {
  const normalized = normalizeUnicode(input);
  const { tokens, issues } = tokenize(normalized);

  let out = "";
  let blocks = 0;

  for (const token of tokens) {
    if (token.kind === "text") {
      out += token.value;
      continue;
    }
    blocks++;
    const content = cleanBlockContent(token.value, options);
    out += token.kind === "display" ? renderDisplay(content, options) : renderInline(content);
  }

  out = out
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { output: out, issues, blocks };
}

/** Spec signature: messy text in, compilation-ready LaTeX out. */
export function cleanMath(input: string, options: ConfigOptions = DEFAULT_OPTIONS): string {
  return cleanMathDetailed(input, options).output;
}

/* ------------------------------------------------------------ preview helper */

export interface Segment {
  type: TokenKind;
  value: string;
}

/** Split already-cleaned output into renderable segments for the KaTeX preview. */
export function segment(src: string): Segment[] {
  return tokenize(src).tokens.map((t) => ({ type: t.kind, value: t.value }));
}

/**
 * KaTeX implements a subset of amsmath. Rewrite the environments it does not
 * know so the preview reflects the maths rather than reporting a tooling gap.
 */
export function prepareForKatex(latex: string): string {
  let s = latex.trim();

  const unwrap = /^\\begin\{(equation\*?|displaymath|subequations)\}([\s\S]*)\\end\{\1\}$/.exec(s);
  if (unwrap) s = unwrap[2].trim();

  return s
    .replace(/\\(?:label|nonumber)\s*\{?[^}\n]*\}?/g, "")
    .replace(/\\begin\{multline\*?\}/g, "\\begin{gather*}")
    .replace(/\\end\{multline\*?\}/g, "\\end{gather*}")
    .replace(/\\begin\{(?:flalign\*?|eqnarray\*?|alignat\*?)\}(?:\{\d+\})?/g, "\\begin{align*}")
    .replace(/\\end\{(?:flalign\*?|eqnarray\*?|alignat\*?)\}/g, "\\end{align*}")
    .trim();
}
