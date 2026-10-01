/**
 * structure.ts - automatic structural repair of math payloads.
 *
 * The cleaner's "Auto-repair structure" stage. Everything here is a pure,
 * deterministic string transform with no KaTeX and no import of the cleaner, so
 * it is cheap enough for every keystroke and each rule is a fixed point
 * (running it twice changes nothing):
 *
 *   A  bracket-balancer   missing `}` appended, stray `}` dropped, unpaired
 *                         \left / \right completed with `.` - per alignment row
 *   B  matrix-grid-fixer  array column specs widened to the widest row; extra
 *                         `&` in `cases` rows folded into the second column
 *   C  char-sanitizer     bare `%` -> `\%`; snake_case names -> \text{...}
 *   D  env-repair         redundant `equation` around `align` unwrapped;
 *                         misspelled environment names corrected
 *   E  katex-compat       \bm -> \boldsymbol; page-layout commands stripped
 *
 * Deliberately conservative: when a rule cannot be sure, it does nothing and
 * leaves the problem for Check & Fix to report.
 */

/* ---------------------------------------------------------------- helpers */

/** Index just past the `\end{name}` matching a `\begin{name}` whose body starts at `from`. */
function matchingEnd(src: string, from: number, name: string): number {
  const esc = name.replace(/[*]/g, "\\*");
  const re = new RegExp("\\\\(begin|end)\\{" + esc + "\\}", "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/** If `s` is exactly one environment: its name, the head (begin + args) and body. */
function soleEnv(s: string): { name: string; head: string; body: string } | null {
  const t = s.trim();
  const m = /^\\begin\{([A-Za-z]+\*?)\}((?:\{[^{}]*\})*)/.exec(t);
  if (!m) return null;
  const end = matchingEnd(t, m[0].length, m[1]);
  if (end !== t.length) return null;
  const closer = "\\end{" + m[1] + "}";
  return { name: m[1], head: m[0], body: t.slice(m[0].length, t.length - closer.length) };
}

/**
 * Split at top-level row breaks `\\` (outside braces and nested environments),
 * keeping the separators so the pieces join back losslessly.
 */
function splitRows(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("\\begin{", i)) envDepth++;
    else if (s.startsWith("\\end{", i)) envDepth--;
    const c = s[i];
    if (c === "\\") {
      if (s[i + 1] === "\\" && depth === 0 && envDepth === 0) {
        const opt = /^\\\\(\s*\[[^\]]*\])?/.exec(s.slice(i))![0];
        out.push(s.slice(last, i), opt);
        i += opt.length - 1;
        last = i + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  out.push(s.slice(last));
  return out;
}

/* --------------------------------------------- A. bracket-balancer */

function braceDepth(s: string): number {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") d++;
    else if (s[i] === "}") d--;
  }
  return d;
}

function dropFirstUnmatchedClose(s: string): string {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      i++;
      continue;
    }
    if (s[i] === "{") d++;
    else if (s[i] === "}" && --d < 0) return s.slice(0, i) + s.slice(i + 1);
  }
  return s;
}

const LEFT = /\\left(?![A-Za-z])/g;
const RIGHT = /\\right(?![A-Za-z])/g;

/** Balance braces and \left/\right within one row (no top-level `\\` inside). */
function balanceRow(row: string): string {
  let r = row;
  for (let guard = 0; guard < 20 && braceDepth(r) < 0; guard++) r = dropFirstUnmatchedClose(r);
  const missing = braceDepth(r);
  if (missing > 0) r = r.replace(/\s*$/, "") + "}".repeat(missing) + (/\s$/.test(row) ? row.match(/\s*$/)![0] : "");
  const lefts = (r.match(LEFT) ?? []).length;
  const rights = (r.match(RIGHT) ?? []).length;
  if (lefts > rights) r = r.replace(/\s*$/, "") + " \\right.".repeat(lefts - rights) + (/\s$/.test(row) ? row.match(/\s*$/)![0] : "");
  else if (rights > lefts) r = r.replace(/^(\s*)/, "$1" + "\\left. ".repeat(rights - lefts));
  return r;
}

/** Balance a payload: inside a sole environment, per row of its body; else per top-level row. */
export function balanceBrackets(latex: string): string {
  const env = soleEnv(latex);
  if (env) {
    const lead = latex.match(/^\s*/)![0];
    const tail = latex.match(/\s*$/)![0];
    return lead + env.head + balanceBrackets(env.body) + "\\end{" + env.name + "}" + tail;
  }
  return splitRows(latex)
    .map((piece, i) => (i % 2 === 1 ? piece : balanceRow(piece)))
    .join("");
}

/* ------------------------------------------- B. matrix-grid-fixer */

/** Top-level `&` count per row of an environment body. */
function cellsPerRow(body: string): number[] {
  return splitRows(body)
    .filter((_, i) => i % 2 === 0)
    .filter((row) => row.trim() !== "")
    .map((row) => {
      let n = 0;
      let depth = 0;
      let envDepth = 0;
      for (let i = 0; i < row.length; i++) {
        if (row.startsWith("\\begin{", i)) envDepth++;
        else if (row.startsWith("\\end{", i)) envDepth--;
        if (row[i] === "\\") {
          i++;
          continue;
        }
        if (row[i] === "{") depth++;
        else if (row[i] === "}") depth--;
        else if (row[i] === "&" && depth === 0 && envDepth === 0) n++;
      }
      return n + 1;
    });
}

/** Columns an array spec declares: l/c/r, plus p/m/b{width}; `|` and @{} do not count. */
function specColumns(spec: string): number {
  const s = spec.replace(/@\{[^{}]*\}/g, "").replace(/[pmb]\{[^{}]*\}/g, "c");
  return (s.match(/[lcrX]/g) ?? []).length;
}

/** `cases` has two columns; a third `&` in a row is folded into the second. */
function foldCasesRow(row: string): string {
  let seen = 0;
  let depth = 0;
  let out = "";
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === "\\") {
      out += c + (row[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (c === "&" && depth === 0 && ++seen > 1) {
      out += "\\quad ";
      continue;
    }
    out += c;
  }
  return out;
}

export function fixGrids(latex: string): string {
  let out = latex;
  // array{spec}: widen the spec to the widest row.
  out = out.replace(/\\begin\{array\}\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g, (whole, spec: string, offset: number) => {
    const bodyStart = offset + whole.length;
    const end = matchingEnd(out, bodyStart, "array");
    if (end < 0) return whole;
    const body = out.slice(bodyStart, end - "\\end{array}".length);
    const need = Math.max(0, ...cellsPerRow(body));
    const have = specColumns(spec);
    return need > have ? "\\begin{array}{" + spec + "c".repeat(need - have) + "}" : whole;
  });
  // cases (and dcases/rcases): at most two columns.
  out = out.replace(/(\\begin\{([dr]?cases)\*?\})([\s\S]*?)(\\end\{\2\*?\})/g, (_, open: string, __: string, body: string, close: string) => {
    const parts = splitRows(body);
    return open + parts.map((p, i) => (i % 2 === 1 ? p : foldCasesRow(p))).join("") + close;
  });
  return out;
}

/* ----------------------------------------- C. character-sanitizer */

const TEXT_LIKE = /\\(?:text|textrm|textit|textbf|texttt|mathrm|operatorname|mbox|label|tag|ref|eqref|url|href)\*?\s*\{[^{}]*\}/g;

/**
 * Bare `%` -> `\%` (LaTeX would treat it as a comment and swallow the rest of
 * the line), and snake_case identifiers -> \text{name\_with\_underscores}.
 * Text-like groups are skipped. In a real .tex document `%` is a comment on
 * purpose, so `percent` is off there.
 */
export function sanitizeChars(latex: string, options: { percent: boolean }): string {
  const keep: string[] = [];
  const NUL = String.fromCharCode(0);
  let s = latex.replace(TEXT_LIKE, (m) => {
    keep.push(m);
    return NUL + (keep.length - 1) + NUL;
  });
  if (options.percent) s = s.replace(/(^|[^\\])((?:\\\\)*)%/g, "$1$2\\%");
  s = s.replace(
    /(?<![A-Za-z0-9\\_^])([A-Za-z]{3,}(?:_[A-Za-z0-9]{2,})+|[A-Za-z]{2,}(?:_[A-Za-z0-9]+){2,})(?![A-Za-z0-9{(])/g,
    (name: string) => "\\text{" + name.replace(/_/g, "\\_") + "}",
  );
  return s.replace(new RegExp(NUL + "(\\d+)" + NUL, "g"), (_, i: string) => keep[Number(i)]);
}

/* ---------------------------------------------------- D. env-repair */

/** Display environments that may not be nested inside `equation`. */
const STANDALONE_INNER = /^(align|gather|multline|flalign|alignat|eqnarray|equation)\*?$/;

/** `\begin{equation}\begin{align}...\end{align}\end{equation}` -> the inner align. */
export function unwrapNestedDisplay(latex: string): string {
  let cur = latex;
  for (let guard = 0; guard < 4; guard++) {
    const outer = soleEnv(cur);
    if (!outer || !/^(equation|displaymath)\*?$/.test(outer.name)) return cur;
    const inner = soleEnv(outer.body);
    if (!inner || !STANDALONE_INNER.test(inner.name)) return cur;
    cur = outer.body.trim();
  }
  return cur;
}

const MATH_ENVS = [
  "equation", "align", "aligned", "gather", "gathered", "multline", "split", "cases", "dcases", "rcases",
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "array", "subarray",
  "eqnarray", "flalign", "alignat", "alignedat", "subequations", "displaymath",
];
/** Common non-math environments: never "corrected" towards a math name. */
const OTHER_ENVS = new Set(
  ("document itemize enumerate description figure table tabular tabularx longtable center flushleft flushright " +
    "abstract proof theorem lemma corollary proposition definition remark example verbatim minipage quote quotation " +
    "titlepage thebibliography algorithm algorithmic tikzpicture lstlisting comment frame block columns column " +
    "subfigure wrapfigure appendix keywords acknowledgments acks IEEEkeywords figure* table* cases* split*").split(" "),
);

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

/** The math environment `name` is a typo of, or null (known, declared, or not close enough). */
export function correctEnvName(name: string, declared: ReadonlySet<string> = new Set()): string | null {
  const bare = name.replace(/\*$/, "");
  if (MATH_ENVS.includes(bare) || OTHER_ENVS.has(bare) || OTHER_ENVS.has(name) || declared.has(bare)) return null;
  const limit = bare.length >= 6 ? 2 : 1;
  let best: string | null = null;
  let bestD = Infinity;
  let tie = false;
  for (const env of MATH_ENVS) {
    const d = distance(bare, env);
    if (d < bestD) {
      bestD = d;
      best = env;
      tie = false;
    } else if (d === bestD) tie = true;
  }
  return best && bestD <= limit && !tie ? best + (name.endsWith("*") ? "*" : "") : null;
}

/**
 * Correct misspelled math environment names, document-wide. A `\begin` typo is
 * matched against the known math environments (refusing ties); an `\end` typo
 * simply follows the `\begin` it closes - `\begin{align} ... \end{aligne}` -
 * which is unambiguous even when the misspelling alone is not.
 */
export function fixEnvTypos(src: string): string {
  const declared = new Set<string>();
  for (const m of src.matchAll(/\\(?:newtheorem|newenvironment|renewenvironment|NewDocumentEnvironment)\*?\s*\{([A-Za-z]+)\}/g)) declared.add(m[1]);
  const known = (n: string) => {
    const bare = n.replace(/\*$/, "");
    return MATH_ENVS.includes(bare) || OTHER_ENVS.has(bare) || OTHER_ENVS.has(n) || declared.has(bare);
  };
  const stack: string[] = [];
  return src.replace(/\\(begin|end)\{([A-Za-z]+\*?)\}/g, (whole, be: string, name: string) => {
    if (be === "begin") {
      const fixed = correctEnvName(name, declared) ?? name;
      stack.push(fixed);
      return fixed === name ? whole : "\\begin{" + fixed + "}";
    }
    const open = stack.pop();
    if (open && name !== open && !known(name) && distance(name.replace(/\*$/, ""), open.replace(/\*$/, "")) <= 2) {
      return "\\end{" + open + "}";
    }
    const fixed = correctEnvName(name, declared);
    return fixed ? "\\end{" + fixed + "}" : whole;
  });
}

/* --------------------------------------------------- E. katex-compat */

const LAYOUT = /\\(?:vspace|vskip|addvspace)\*?\s*\{[^{}]*\}|\\(?:pagenumbering|thispagestyle|pagestyle)\s*\{[^{}]*\}|\\(?:noindent|indent|clearpage|cleardoublepage|newpage|pagebreak|nopagebreak|linebreak|nolinebreak|centering|raggedright|medskip|bigskip|smallskip|allowbreak|par)(?![A-Za-z])/g;

/**
 * KaTeX (and plain amsmath) friendliness: `\bm` -> `\boldsymbol` (identical
 * output, no extra package), and page-layout commands that mean nothing inside
 * a formula are removed. `\hspace` is kept: in math it is real spacing.
 */
export function katexCompat(latex: string): string {
  return latex
    .replace(/\\bm(?![A-Za-z])\s*(\{|\\[A-Za-z]+|[A-Za-z0-9])/g, (_, arg: string) => (arg === "{" ? "\\boldsymbol{" : "\\boldsymbol{" + arg + "}"))
    .replace(LAYOUT, "")
    .replace(/[ \t]{2,}/g, " ");
}

/* ---------------------------------------------------------- the stage */

export interface StructureOptions {
  /** The payload comes from a full .tex document (where `%` is a real comment). */
  inDocument: boolean;
}

/** All payload-level structural repairs, in dependency order. */
export function repairStructure(latex: string, options: StructureOptions): string {
  let out = unwrapNestedDisplay(latex);
  out = katexCompat(out);
  out = sanitizeChars(out, { percent: !options.inDocument });
  out = balanceBrackets(out);
  out = fixGrids(out);
  return out;
}
