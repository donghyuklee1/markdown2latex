/**
 * arxiv.ts - pull the exact LaTeX of every equation out of an arXiv source
 * package.
 *
 * Copying an equation out of a PDF breaks it (`\sum` comes back as `P`,
 * brackets vanish); the author's source has it verbatim. This module turns a
 * source package (already unpacked by archive.ts) into an ordered list of
 * equations with labels, file:line, an estimated display number and the user
 * macros each one needs, plus a small macro expander so a snippet can stand on
 * its own.
 *
 * Pure: no DOM, no network. The panel does the one `fetch`, to `sourceUrl(id)`.
 * Nothing here throws on malformed input - problems become `warnings` or an
 * `error` string, because arXiv sources are hand-written and often odd.
 */
import { isGzip, isPdf, isTar, isZip, readArchive, textOf, type ArchiveFile } from "./archive";

/* --------------------------------------------------------------------- ids */

export type ParsedId = { id: string } | { error: string };

const NEW_ID = /^(\d{4}\.\d{4,5})(v\d+)?$/;
// Old-style: archive(.SUBJECT-CLASS)/YYMMNNN, e.g. hep-th/9901001, math.AG/0601001.
const OLD_ID = /^([a-z][a-z-]*(?:\.[A-Za-z]{2})?\/\d{7})(v\d+)?$/;

/**
 * Accepts a bare id (with or without version or an `arXiv:` prefix) or any
 * arxiv.org URL that carries one: /abs/, /pdf/ (with or without .pdf), /html/,
 * /src/, /e-print/, /format/, on arxiv.org or export.arxiv.org.
 */
export function parseArxivId(input: string): ParsedId {
  let s = (input || "").trim();
  if (!s) return { error: "Enter an arXiv ID like 2301.12345 or an arxiv.org link." };
  s = s.replace(/^arxiv\s*:\s*/i, "");
  if (/arxiv\.org/i.test(s) || /^https?:\/\//i.test(s)) {
    const m = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*arxiv\.org\/(?:abs|pdf|html|src|e-print|format|ps)\/(.+)$/i.exec(s);
    if (!m) return { error: "That link is not an arXiv paper link (expected arxiv.org/abs/<id> or /pdf/<id>)." };
    s = m[1].replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/\.pdf$/i, "");
  }
  const m = NEW_ID.exec(s) ?? OLD_ID.exec(s);
  if (!m) return { error: '"' + input.trim().slice(0, 80) + '" does not look like an arXiv ID (e.g. 2301.12345 or hep-th/9901001).' };
  if (NEW_ID.test(s)) {
    const month = Number(s.slice(2, 4));
    if (month < 1 || month > 12) return { error: s + " is not a valid arXiv ID: the month part (" + s.slice(2, 4) + ") must be 01-12." };
  }
  return { id: m[1] + (m[2] ?? "") };
}

/**
 * `/src/` answers with `Access-Control-Allow-Origin: *`. `/e-print/` 301s to
 * it without CORS headers, so a browser fetch of that one fails.
 */
export const sourceUrl = (id: string) => "https://arxiv.org/src/" + id;

/* ------------------------------------------------------------ the payload */

export interface SourceFile {
  path: string;
  text: string;
}

export type PreparedSource = { files: SourceFile[]; binaryCount: number } | { error: string };

const TEXT_EXT = /\.(tex|ltx|latex|sty|cls|bbl|def|cfg|tikz|pgf|pdf_tex|txt)$/i;

const PDF_ONLY = "This paper was submitted as a PDF only, so arXiv has no LaTeX source for it. Equations can only be recovered from the PDF.";

/**
 * Raw bytes from arXiv (or files the user dropped) to text files. arXiv serves
 * a .tar.gz for multi-file papers, a gzipped lone .tex for single-file ones,
 * and a gzipped PDF for PDF-only submissions.
 */
export async function prepareSource(entries: ReadonlyArray<ArchiveFile>): Promise<PreparedSource> {
  try {
    const flat: ArchiveFile[] = [];
    for (const e of entries) {
      // The browser may already have undone the gzip layer, leaving a bare tar.
      if (isGzip(e.data) || isTar(e.data) || isZip(e.data)) flat.push(...(await readArchive(e.data, /\.gz$/i.test(e.path) ? e.path : e.path + ".gz")));
      else flat.push(e);
    }
    if (!flat.length || flat.every((f) => f.data.length === 0)) return { error: "The source package is empty." };
    if (flat.length === 1 && isPdf(flat[0].data)) return { error: PDF_ONLY };
    const files: SourceFile[] = [];
    let binaryCount = 0;
    for (const f of flat) {
      // Single gzipped papers come back without a usable extension.
      const looksText = TEXT_EXT.test(f.path) || (flat.length === 1 && !isPdf(f.data));
      const path = f.path.replace(/\.gz$/i, "");
      if (looksText) files.push({ path: TEXT_EXT.test(path) ? path : path + ".tex", text: textOf(f.data) });
      else binaryCount++;
    }
    if (files.length === 1 && /^\s*<(!doctype html|html)/i.test(files[0].text)) {
      return { error: "arXiv sent a web page instead of the source - usually rate limiting. Wait a minute, or download the source from the paper's page and drop it here." };
    }
    if (!files.some((f) => /\.(tex|ltx|latex)$/i.test(f.path))) {
      if (flat.some((f) => isPdf(f.data))) return { error: PDF_ONLY };
      return { error: "No .tex files in the source package (" + flat.length + " file" + (flat.length === 1 ? "" : "s") + ")." };
    }
    return { files, binaryCount };
  } catch (err) {
    return { error: "Could not unpack the source: " + (err instanceof Error ? err.message : String(err)) };
  }
}

/* ---------------------------------------------------------------- types */

export interface MacroDef {
  name: string; // without the backslash
  kind: "newcommand" | "def" | "operator" | "let";
  nargs: number;
  /** Default for an optional first argument (`\newcommand{\x}[2][d]{...}`). */
  optDefault: string | null;
  body: string;
  /** The definition exactly as written, for "copy with definitions". */
  source: string;
  file: string;
  line: number;
  /** Set when the expander must leave this macro alone, with the reason. */
  unsafe: string | null;
  /** `\let` to something that is not a user macro: insert, do not re-expand. */
  primitive?: boolean;
}

export interface EquationRow {
  number: string | null;
  labels: string[];
}

export interface Equation {
  index: number;
  /** `align*`, `equation`, ... or `\[`, `$$`, `$`, `\(`. */
  env: string;
  /** alignat's column count argument. */
  envArg: string | null;
  display: boolean;
  /** The whole block as written, wrapper included. */
  source: string;
  /** Inside the wrapper, exactly as written (trimmed). */
  body: string;
  /** Body with comments removed - what gets rendered and expanded. */
  latex: string;
  labels: string[];
  file: string;
  line: number;
  rows: EquationRow[];
  /** Estimated display numbers, without parentheses. */
  numbers: string[];
  /** User macros used, directly or through other macros, in definition order. */
  macros: string[];
  /** ~200 characters of source just before the equation. */
  context: string;
}

export interface ExtractOptions {
  /** Also collect inline `$...$` and `\(...\)` (off by default - there are thousands). */
  inline?: boolean;
}

export interface Extraction {
  equations: Equation[];
  macros: MacroDef[];
  mainFile: string | null;
  /** Files visited, in document order. */
  files: string[];
  warnings: string[];
  error?: string;
}

/* ------------------------------------------------------- scanning helpers */

const NUMBERED = new Set(["equation", "align", "gather", "multline", "eqnarray", "flalign", "alignat", "dmath", "eqn"]);
const ROW_ENVS = new Set(["align", "gather", "eqnarray", "flalign", "alignat"]);
const MATH_ENVS = new Set([...NUMBERED, "displaymath", "math"]);
const isMathEnv = (env: string) => MATH_ENVS.has(env.replace(/\*$/, ""));

const VERBATIM = /^\\begin\s*\{(verbatim\*?|Verbatim\*?|BVerbatim|LVerbatim|lstlisting|minted|comment|filecontents\*?)\}/;
const isLetter = (c: string | undefined) => !!c && /[A-Za-z@]/.test(c);

/** Replace a span with spaces, keeping newlines so offsets and lines stay put. */
const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * The source with comments, verbatim blocks, `\verb|..|` and `\iffalse..\fi`
 * blanked out. Same length as the input, so every offset found in the mask is
 * an offset into the original text.
 */
export function maskSource(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === "%") {
      let j = text.indexOf("\n", i);
      if (j < 0) j = n;
      out += blank(text.slice(i, j));
      i = j;
    } else if (c === "\\") {
      const rest = text.slice(i, i + 40);
      const vb = VERBATIM.exec(rest);
      if (vb) {
        const close = "\\end{" + vb[1] + "}";
        const j = text.indexOf(close, i + vb[0].length);
        const end = j < 0 ? n : j + close.length;
        out += blank(text.slice(i, end));
        i = end;
        continue;
      }
      const verb = /^\\(verb\*?|lstinline|mintinline\{[^}]*\})([^A-Za-z\s{])/.exec(rest);
      if (verb) {
        const delim = verb[2];
        const start = i + verb[0].length;
        let j = text.indexOf(delim, start);
        const nl = text.indexOf("\n", start);
        if (j < 0 || (nl >= 0 && nl < j)) j = start - 1; // unterminated: blank only the command
        out += blank(text.slice(i, j + 1));
        i = j + 1;
        continue;
      }
      if (/^\\iffalse(?![A-Za-z@])/.test(rest)) {
        // Skip to the matching \fi; \ifthenelse is a macro, not a conditional.
        const re = /\\(if[A-Za-z@]*|fi)(?![A-Za-z@])/g;
        re.lastIndex = i + 8;
        let depth = 1;
        let end = n;
        for (let m = re.exec(text); m; m = re.exec(text)) {
          if (m[1] === "fi") depth--;
          else if (m[1] !== "ifthenelse") depth++;
          if (depth === 0) {
            end = m.index + 3;
            break;
          }
        }
        out += blank(text.slice(i, end));
        i = end;
        continue;
      }
      out += text.slice(i, i + 2); // `\%`, `\\` and `\$` travel as a pair
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** The control-sequence name starting at `i` (just after the backslash). */
function csName(s: string, i: number): string {
  if (i >= s.length) return "";
  if (!isLetter(s[i])) return s[i];
  let j = i;
  while (j < s.length && isLetter(s[j])) j++;
  return s.slice(i, j);
}

const skipSpace = (s: string, i: number) => {
  while (i < s.length && /\s/.test(s[i])) i++;
  return i;
};

/** One TeX argument: a balanced `{group}` (content returned), a control sequence or a char. */
function readArg(s: string, i: number): { text: string; end: number; braced: boolean } | null {
  i = skipSpace(s, i);
  if (i >= s.length) return null;
  if (s[i] === "{") {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === "\\") j++;
      else if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) return { text: s.slice(i + 1, j), end: j + 1, braced: true };
    }
    return null;
  }
  if (s[i] === "}") return null;
  if (s[i] === "\\") {
    const name = csName(s, i + 1);
    return { text: "\\" + name, end: i + 1 + name.length, braced: false };
  }
  return { text: s[i], end: i + 1, braced: false };
}

/** An optional `[...]` argument, respecting braces inside it. */
function readOpt(s: string, i: number): { text: string; end: number } | null {
  const k = skipSpace(s, i);
  if (s[k] !== "[") return null;
  let depth = 0;
  for (let j = k + 1; j < s.length; j++) {
    if (s[j] === "\\") j++;
    else if (s[j] === "{") depth++;
    else if (s[j] === "}") depth--;
    else if (s[j] === "]" && depth === 0) return { text: s.slice(k + 1, j), end: j + 1 };
  }
  return null;
}

function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function joinPath(dir: string, name: string): string {
  const parts: string[] = [];
  for (const seg of (dir ? dir + "/" + name : name).split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Drop blank-after-masking lines and trailing space: comment-free, render-ready. */
const tidy = (masked: string) =>
  masked
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .join("\n")
    .trim();

/* --------------------------------------------------------------- scanner */

interface FileInfo {
  path: string;
  text: string;
  masked: string;
  starts: number[];
}

type Event =
  | { kind: "eq"; eq: Equation }
  | { kind: "subBegin" | "subEnd" | "section" | "chapter" | "appendix" };

interface Ctx {
  files: Map<string, FileInfo>;
  macros: Map<string, MacroDef>;
  events: Event[];
  visited: string[];
  stack: string[];
  warnings: string[];
  inline: boolean;
  within: string | null;
  bookClass: boolean;
}

const DEF_CMDS = new Set(["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "def", "gdef", "edef", "xdef", "let", "DeclareMathOperator", "newenvironment", "renewenvironment"]);
const INCLUDE_CMDS = new Set(["input", "include", "subfile", "import", "subimport", "inputfrom", "subinputfrom", "includefrom", "subincludefrom"]);
const UNSAFE_BODY = /\\(if[A-Za-z@]*|else|fi|csname|expandafter|futurelet|afterassignment|def|gdef|edef|newcommand|renewcommand|let|@ifnextchar|@ifstar|makeatletter|ifthenelse)(?![A-Za-z@])/;

function beginAlias(def: MacroDef | undefined): string | null {
  if (!def || def.nargs !== 0) return null;
  const m = /^\s*\\begin\s*\{([A-Za-z]+\*?)\}\s*$/.exec(def.body);
  return m && isMathEnv(m[1]) ? m[1] : null;
}
function endAlias(def: MacroDef | undefined): string | null {
  if (!def || def.nargs !== 0) return null;
  const m = /^\s*\\end\s*\{([A-Za-z]+\*?)\}\s*$/.exec(def.body);
  return m ? m[1] : null;
}

/** Parse a definition command at `i` (the backslash). Returns where it ends. */
function readDefinition(ctx: Ctx, f: FileInfo, i: number, cmd: string): number {
  const m = f.masked;
  let p = i + 1 + cmd.length;
  if (m[p] === "*") p++;
  const record = (def: Omit<MacroDef, "source" | "file" | "line">, end: number) => {
    if (cmd === "providecommand" && ctx.macros.has(def.name)) return;
    ctx.macros.delete(def.name); // re-insert so the map stays in definition order
    ctx.macros.set(def.name, { ...def, source: f.text.slice(i, end).trim(), file: f.path, line: lineOf(f.starts, i) });
  };

  if (cmd === "newenvironment" || cmd === "renewenvironment") {
    const name = readArg(m, p);
    if (!name) return p;
    p = name.end;
    p = readOpt(m, p)?.end ?? p;
    p = readOpt(m, p)?.end ?? p;
    const b = readArg(m, p);
    const e = b && readArg(m, b.end);
    return e ? e.end : p;
  }

  if (cmd === "let") {
    const a = readArg(m, p);
    if (!a || !a.text.startsWith("\\")) return p;
    let q = skipSpace(m, a.end);
    if (m[q] === "=") q++;
    if (m[q] === " ") q++;
    const b = readArg(m, q);
    if (!b) return q;
    const name = a.text.slice(1);
    const target = ctx.macros.get(b.text.slice(1));
    if (b.text.startsWith("\\") && target) record({ ...target, name, kind: "let" }, b.end);
    else record({ name, kind: "let", nargs: 0, optDefault: null, body: b.text, unsafe: null, primitive: true }, b.end);
    return b.end;
  }

  if (cmd === "DeclareMathOperator") {
    const a = readArg(m, p);
    const b = a && readArg(m, a.end);
    if (!a || !b || !a.text.trim().startsWith("\\")) return p;
    const star = m[i + 1 + cmd.length] === "*" ? "*" : "";
    record({ name: a.text.trim().slice(1), kind: "operator", nargs: 0, optDefault: null, body: "\\operatorname" + star + "{" + b.text + "}", unsafe: null }, b.end);
    return b.end;
  }

  if (cmd === "def" || cmd === "gdef" || cmd === "edef" || cmd === "xdef") {
    p = skipSpace(m, p);
    if (m[p] !== "\\") return p;
    const name = csName(m, p + 1);
    p += 1 + name.length;
    const brace = m.indexOf("{", p);
    if (brace < 0) return p;
    const params = m.slice(p, brace).replace(/\s+/g, "");
    const body = readArg(m, brace);
    if (!body) return p;
    const simple = /^(#[1-9])*$/.test(params);
    const unsafe = !simple
      ? "delimited \\def parameters"
      : cmd === "edef" || cmd === "xdef"
        ? "\\edef (expanded at definition time)"
        : UNSAFE_BODY.test(body.text)
          ? "uses TeX conditionals or redefinitions"
          : null;
    record({ name, kind: "def", nargs: simple ? params.length / 2 : 0, optDefault: null, body: body.text, unsafe }, body.end);
    return body.end;
  }

  // \newcommand family: {\name} or \name, then [n], [default], {body}
  const a = readArg(m, p);
  const macro = a?.text.trim() ?? "";
  if (!a || !macro.startsWith("\\")) return p;
  p = a.end;
  const n = readOpt(m, p);
  let nargs = 0;
  if (n) {
    nargs = Math.max(0, Math.min(9, parseInt(n.text, 10) || 0));
    p = n.end;
  }
  const d = n ? readOpt(m, p) : null;
  if (d) p = d.end;
  const body = readArg(m, p);
  if (!body) return p;
  record(
    {
      name: macro.slice(1),
      kind: "newcommand",
      nargs,
      optDefault: d ? d.text : null,
      body: body.text,
      unsafe: UNSAFE_BODY.test(body.text) ? "uses TeX conditionals or redefinitions" : null,
    },
    body.end,
  );
  return body.end;
}

/** Find the end of `env`: `\end{env}` or a user alias for it (`\ee`). */
function findEnvEnd(ctx: Ctx, m: string, from: number, to: number, env: string): { innerEnd: number; end: number } | null {
  for (let j = from; j < to; j++) {
    if (m[j] !== "\\") continue;
    const name = csName(m, j + 1);
    const after = j + 1 + name.length;
    if (name === "end") {
      const a = readArg(m, after);
      if (a && a.text === env) return { innerEnd: j, end: a.end };
    } else if (isLetter(name[0]) && endAlias(ctx.macros.get(name)) === env) {
      return { innerEnd: j, end: after };
    }
    j = after - 1;
  }
  return null;
}

/** Sequential scan for a closing delimiter, honouring `\`-escapes. */
function findClose(m: string, from: number, to: number, close: "$" | "$$" | "\\]" | "\\)"): number {
  for (let j = from; j < to; j++) {
    const c = m[j];
    if (c === "\\") {
      if ((close === "\\]" && m[j + 1] === "]") || (close === "\\)" && m[j + 1] === ")")) return j;
      j++;
    } else if (c === "$") {
      if (close === "$$" && m[j + 1] === "$") return j;
      if (close === "$") return j;
    } else if (close === "$" && c === "\n" && /^\n[ \t]*\n/.test(m.slice(j, j + 40))) {
      return -1; // TeX ends inline math at a paragraph break (with an error)
    }
  }
  return -1;
}

function resolveInclude(ctx: Ctx, baseDir: string, name: string): string | null {
  const clean = name.trim().replace(/^"|"$/g, "");
  for (const cand of [joinPath(baseDir, clean), joinPath(baseDir, clean + ".tex")]) {
    if (ctx.files.has(cand)) return cand;
  }
  return null;
}

function emit(ctx: Ctx, f: FileInfo, env: string, envArg: string | null, display: boolean, start: number, innerStart: number, innerEnd: number, end: number) {
  const body = f.text.slice(innerStart, innerEnd);
  const latex = tidy(f.masked.slice(innerStart, innerEnd));
  const ctxText = f.masked.slice(Math.max(0, start - 600), start).replace(/\s+/g, " ").trim();
  const eq: Equation = {
    index: 0,
    env,
    envArg,
    display,
    source: f.text.slice(start, end),
    body: body.trim(),
    latex,
    labels: labelsOf(latex),
    file: f.path,
    line: lineOf(f.starts, start),
    rows: [],
    numbers: [],
    macros: [],
    context: ctxText.slice(-200),
  };
  ctx.events.push({ kind: "eq", eq });
}

function scan(ctx: Ctx, path: string, from: number, to: number, extract: boolean, baseDir: string) {
  const f = ctx.files.get(path);
  if (!f) return;
  if (ctx.stack.includes(path) || ctx.stack.length > 24) {
    ctx.warnings.push("Skipped a circular or too-deep \\input of " + path + ".");
    return;
  }
  ctx.stack.push(path);
  if (!ctx.visited.includes(path)) ctx.visited.push(path);
  const m = f.masked;
  let i = from;
  while (i < to) {
    const c = m[i];
    if (c === "$") {
      const dbl = m[i + 1] === "$";
      const close = findClose(m, i + (dbl ? 2 : 1), to, dbl ? "$$" : "$");
      if (close < 0) {
        if (dbl && extract) ctx.warnings.push("Unterminated $$ in " + path + ":" + lineOf(f.starts, i) + ".");
        i += dbl ? 2 : 1;
        continue;
      }
      const end = close + (dbl ? 2 : 1);
      if (extract && (dbl || ctx.inline)) emit(ctx, f, dbl ? "$$" : "$", null, dbl, i, i + (dbl ? 2 : 1), close, end);
      i = end;
      continue;
    }
    if (c !== "\\") {
      i++;
      continue;
    }
    const name = csName(m, i + 1);
    const after = i + 1 + name.length;

    if (name === "[" || name === "(") {
      const close = findClose(m, after, to, name === "[" ? "\\]" : "\\)");
      if (close < 0) {
        if (extract && name === "[") ctx.warnings.push("Unterminated \\[ in " + path + ":" + lineOf(f.starts, i) + ".");
        i = after;
        continue;
      }
      if (extract && (name === "[" || ctx.inline)) emit(ctx, f, "\\" + name, null, name === "[", i, after, close, close + 2);
      i = close + 2;
      continue;
    }

    let env: string | null = null;
    let innerStart = after;
    if (name === "begin" || name === "end") {
      const a = readArg(m, after);
      if (!a) {
        i = after;
        continue;
      }
      if (name === "begin" && isMathEnv(a.text)) {
        env = a.text;
        innerStart = a.end;
      } else {
        if (extract && a.text === "subequations") ctx.events.push({ kind: name === "begin" ? "subBegin" : "subEnd" });
        i = a.end;
        continue;
      }
    } else if (isLetter(name[0]) && !DEF_CMDS.has(name)) {
      env = beginAlias(ctx.macros.get(name));
    }

    if (env) {
      let envArg: string | null = null;
      if (env.startsWith("alignat")) {
        const a = readArg(m, innerStart);
        if (a?.braced) {
          envArg = a.text;
          innerStart = a.end;
        }
      }
      const close = findEnvEnd(ctx, m, innerStart, to, env);
      if (!close) {
        if (extract) ctx.warnings.push("Unterminated \\begin{" + env + "} in " + path + ":" + lineOf(f.starts, i) + ".");
        i = innerStart;
        continue;
      }
      if (extract && (env !== "math" || ctx.inline)) emit(ctx, f, env, envArg, env !== "math", i, innerStart, close.innerEnd, close.end);
      i = close.end;
      continue;
    }

    if (DEF_CMDS.has(name)) {
      i = Math.max(after, readDefinition(ctx, f, i, name));
      continue;
    }

    // harvmac (plain TeX, common in 1990s hep-th): \eqn\label{body} is a numbered display.
    if ((name === "eqn" || name === "eqna") && !ctx.macros.has(name)) {
      const k = skipSpace(m, after);
      const label = m[k] === "\\" ? csName(m, k + 1) : "";
      const group = label ? readArg(m, k + 1 + label.length) : null;
      if (group?.braced) {
        if (extract) {
          const open = m.indexOf("{", k + 1 + label.length);
          emit(ctx, f, "eqn", null, true, i, open + 1, group.end - 1, group.end);
          const ev = ctx.events[ctx.events.length - 1];
          if (ev.kind === "eq") ev.eq.labels = [label];
        }
        i = group.end;
        continue;
      }
    }

    if (INCLUDE_CMDS.has(name)) {
      let target: string | null = null;
      let dir = baseDir;
      let end = after;
      if (name === "input" || name === "include" || name === "subfile") {
        const k = skipSpace(m, after);
        if (m[k] === "{") {
          const a = readArg(m, k);
          if (a) [target, end] = [a.text, a.end];
        } else if (name === "input") {
          // Plain-TeX form: \input file (ends at whitespace)
          const w = /^[^\s{}\\]+/.exec(m.slice(k, k + 200));
          if (w) [target, end] = [w[0], k + w[0].length];
        }
      } else {
        const a = readArg(m, after);
        const b = a && readArg(m, a.end);
        if (a && b) {
          dir = name.startsWith("sub") ? joinPath(dirOf(path), a.text) : joinPath(baseDir, a.text);
          [target, end] = [b.text, b.end];
        }
      }
      if (target) {
        const resolved = resolveInclude(ctx, dir, target);
        if (resolved) {
          const g = ctx.files.get(resolved)!;
          scan(ctx, resolved, 0, g.masked.length, extract, name.endsWith("import") || name.endsWith("from") ? dirOf(resolved) : baseDir);
        } else if (!/\.(bbl|tikz|pgf|pdf_tex)$/i.test(target)) {
          ctx.warnings.push("\\" + name + "{" + target + "} not found in the source (" + path + ":" + lineOf(f.starts, i) + ").");
        }
      }
      i = end;
      continue;
    }

    if (name === "usepackage" || name === "RequirePackage") {
      const opt = readOpt(m, after);
      const a = readArg(m, opt ? opt.end : after);
      if (a) {
        for (const pkg of a.text.split(",").map((s) => s.trim()).filter(Boolean)) {
          const sty = resolveInclude(ctx, baseDir, pkg + ".sty");
          if (sty) scan(ctx, sty, 0, ctx.files.get(sty)!.masked.length, false, baseDir);
        }
        i = a.end;
        continue;
      }
    } else if (name === "numberwithin" || name === "counterwithin") {
      const a = readArg(m, after);
      const b = a && readArg(m, a.end);
      if (a && b && a.text.trim() === "equation") ctx.within = b.text.trim();
      if (b) {
        i = b.end;
        continue;
      }
    } else if (name === "documentclass") {
      const opt = readOpt(m, after);
      const a = readArg(m, opt ? opt.end : after);
      if (a && /^(book|report|amsbook|scrbook|scrreprt|memoir)$/.test(a.text.trim())) ctx.bookClass = true;
    } else if (extract && (name === "section" || name === "chapter")) {
      if (m[skipSpace(m, after)] !== "*") ctx.events.push({ kind: name });
    } else if (extract && name === "appendix") {
      ctx.events.push({ kind: "appendix" });
    }
    i = after;
  }
  ctx.stack.pop();
}

/* --------------------------------------------------------------- numbers */

const labelsOf = (latex: string) => [...latex.matchAll(/\\label\s*\{([^}]*)\}/g)].map((x) => x[1].trim());

/** Split an align-like body at top-level `\\`, ignoring braces and nested environments. */
export function splitRows(latex: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\\") {
      const name = csName(latex, i + 1);
      if (name === "begin") depth++;
      else if (name === "end") depth--;
      else if (name === "\\" && depth === 0) {
        rows.push(latex.slice(start, i));
        let j = i + 2;
        if (latex[j] === "*") j++;
        j = readOpt(latex, j)?.end ?? j;
        start = j;
        i = j - 1;
        continue;
      }
      i += name.length;
    }
  }
  rows.push(latex.slice(start));
  // A trailing `\\` leaves an empty last row; treat it as no row at all.
  if (rows.length > 1 && !rows[rows.length - 1].trim()) rows.pop();
  return rows;
}

const tagOf = (s: string): string | null => {
  const t = /\\tag\*?\s*\{([^}]*)\}/.exec(s);
  if (t) return t[1].trim();
  const e = /\\l?eqno\s*(.+?)\s*$/.exec(s);
  return e ? e[1].replace(/^\(|\)$/g, "").trim() : null;
};
const NOTAG = /\\(nonumber|notag)(?![A-Za-z])/;

const alpha = (n: number, upper: boolean) => {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode((upper ? 65 : 97) + ((k - 1) % 26)) + s;
  return s;
};

function number(events: Event[], within: string | null) {
  let counter = 0;
  let chapter = 0;
  let section = 0;
  let appendix = false;
  let sub: { base: string; letter: number } | null = null;
  const usesChapters = events.some((e) => e.kind === "chapter");
  const top = (n: number) => (appendix ? alpha(n, true) : String(n));
  const prefix = () => {
    if (within === "chapter") return (usesChapters ? top(chapter) : String(chapter)) + ".";
    if (within === "section") return (usesChapters ? String(chapter) + "." + section : top(section)) + ".";
    return "";
  };
  const next = () => {
    if (sub) return sub.base + alpha(++sub.letter, false);
    return prefix() + ++counter;
  };
  for (const ev of events) {
    if (ev.kind === "chapter") {
      chapter++;
      section = 0;
      if (within) counter = 0;
    } else if (ev.kind === "section") {
      section++;
      if (within === "section") counter = 0;
    } else if (ev.kind === "appendix") {
      appendix = true;
      if (usesChapters) chapter = 0;
      else section = 0;
    } else if (ev.kind === "subBegin") {
      sub = { base: prefix() + ++counter, letter: 0 };
    } else if (ev.kind === "subEnd") {
      sub = null;
    } else if (ev.kind === "eq") {
      const eq = ev.eq;
      const base = eq.env.replace(/\*$/, "");
      const numbered = NUMBERED.has(base) && !eq.env.endsWith("*");
      const parts = ROW_ENVS.has(base) ? splitRows(eq.latex) : [eq.latex];
      eq.rows = parts.map((row) => {
        const tag = tagOf(row);
        const n = tag ?? (numbered && !NOTAG.test(row) ? next() : null);
        return { number: n, labels: labelsOf(row) };
      });
      eq.numbers = eq.rows.map((r) => r.number).filter((x): x is string => x !== null);
    }
  }
}

/* ---------------------------------------------------------------- extract */

function findMain(files: FileInfo[]): FileInfo | null {
  const tex = files.filter((f) => /\.(tex|ltx|latex)$/i.test(f.path));
  const docs = tex.filter((f) => /\\begin\s*\{document\}/.test(f.masked));
  const full = docs.filter((f) => /\\documentclass/.test(f.masked));
  const pool = full.length ? full : docs;
  if (!pool.length) return tex.length === 1 ? tex[0] : null;
  const named = (f: FileInfo) => (/(^|\/)(main|ms|paper|article)\.tex$/i.test(f.path) ? 1 : 0);
  // Prefer the shallowest, conventionally named, largest candidate.
  return [...pool].sort((a, b) => a.path.split("/").length - b.path.split("/").length || named(b) - named(a) || b.text.length - a.text.length)[0];
}

/** Every equation in document order, with macros, labels and estimated numbers. */
export function extractEquations(sources: ReadonlyArray<SourceFile>, options: ExtractOptions = {}): Extraction {
  const empty: Extraction = { equations: [], macros: [], mainFile: null, files: [], warnings: [] };
  try {
    const infos = sources.map((s) => {
      const text = s.text.replace(/\r\n?/g, "\n");
      return { path: s.path, text, masked: maskSource(text), starts: lineStarts(text) };
    });
    if (!infos.some((f) => /\.(tex|ltx|latex)$/i.test(f.path))) return { ...empty, error: "No .tex files to read." };
    const ctx: Ctx = {
      files: new Map(infos.map((f) => [f.path, f])),
      macros: new Map(),
      events: [],
      visited: [],
      stack: [],
      warnings: [],
      inline: !!options.inline,
      within: null,
      bookClass: false,
    };
    const main = findMain(infos);
    if (main) {
      const dir = dirOf(main.path);
      const begin = /\\begin\s*\{document\}/.exec(main.masked);
      const endDoc = /\\end\s*\{document\}/.exec(main.masked);
      const bodyStart = begin ? begin.index + begin[0].length : 0;
      if (begin) scan(ctx, main.path, 0, begin.index, false, dir);
      scan(ctx, main.path, bodyStart, endDoc && endDoc.index > bodyStart ? endDoc.index : main.masked.length, true, dir);
    } else {
      ctx.warnings.push("No main file (\\documentclass + \\begin{document}) found; read every .tex file in name order.");
      for (const f of [...infos].sort((a, b) => a.path.localeCompare(b.path))) {
        if (/\.(tex|ltx|latex)$/i.test(f.path) && !ctx.visited.includes(f.path)) scan(ctx, f.path, 0, f.masked.length, true, dirOf(f.path));
      }
    }

    const theeq = ctx.macros.get("theequation")?.body ?? "";
    const within =
      ctx.within ?? (/\\thesection/.test(theeq) ? "section" : /\\thechapter/.test(theeq) || ctx.bookClass ? "chapter" : null);
    number(ctx.events, within === "section" || within === "chapter" ? within : null);

    const macros = [...ctx.macros.values()].filter((d) => d.name !== "theequation");
    const byName = new Map(macros.map((d) => [d.name, d]));
    const equations: Equation[] = [];
    for (const ev of ctx.events) {
      if (ev.kind !== "eq") continue;
      ev.eq.index = equations.length;
      ev.eq.macros = macrosUsed(ev.eq.latex, byName);
      equations.push(ev.eq);
    }
    if (!equations.length) ctx.warnings.push(options.inline ? "No math found in the document body." : "No display equations found (try including inline math).");
    return { equations, macros, mainFile: main?.path ?? null, files: ctx.visited, warnings: ctx.warnings };
  } catch (err) {
    return { ...empty, error: "Could not read the source: " + (err instanceof Error ? err.message : String(err)) };
  }
}

/* ----------------------------------------------------------------- macros */

const controlWords = (s: string) => new Set([...s.matchAll(/\\([A-Za-z@]+)/g)].map((x) => x[1]));

/** User macros a snippet needs, following macro bodies, in definition order. */
export function macrosUsed(latex: string, macros: ReadonlyMap<string, MacroDef>): string[] {
  const seen = new Set<string>();
  const todo = [...controlWords(latex)];
  while (todo.length) {
    const name = todo.pop()!;
    const def = macros.get(name);
    if (!def || seen.has(name) || beginAlias(def) || endAlias(def)) continue;
    seen.add(name);
    todo.push(...controlWords(def.body));
  }
  const order = [...macros.keys()];
  return [...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

const toMap = (macros: ReadonlyArray<MacroDef> | ReadonlyMap<string, MacroDef>): ReadonlyMap<string, MacroDef> =>
  macros instanceof Map ? macros : new Map((macros as ReadonlyArray<MacroDef>).map((d) => [d.name, d]));

/** The definitions an equation needs, then the equation block - pastes as a working unit. */
export function withDefinitions(eq: Equation, macros: ReadonlyArray<MacroDef> | ReadonlyMap<string, MacroDef>): string {
  const map = toMap(macros);
  const defs = eq.macros.map((n) => map.get(n)?.source).filter(Boolean);
  return (defs.length ? defs.join("\n") + "\n\n" : "") + eq.source.trim();
}

export interface Expansion {
  text: string;
  /** Macros that were expanded. */
  expanded: string[];
  /** Macros left as written, with why. */
  skipped: Array<{ name: string; reason: string }>;
}

const MAX_DEPTH = 32;
const MAX_LEN = 200_000;

/**
 * Expand user macros (no-argument, `#1..#9`, optional first argument) so a
 * snippet no longer depends on the preamble. Anything that cannot be expanded
 * safely - conditionals, delimited `\def`s, missing arguments, runaway
 * recursion - is left as written and reported.
 */
export function expandMacros(latex: string, macros: ReadonlyArray<MacroDef> | ReadonlyMap<string, MacroDef>): Expansion {
  const map = toMap(macros);
  const expanded = new Set<string>();
  const skipped = new Map<string, string>();

  const run = (s: string, depth: number): string => {
    let out = "";
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c !== "\\") {
        out += c;
        i++;
        continue;
      }
      const name = csName(s, i + 1);
      const after = i + 1 + name.length;
      const def = isLetter(name[0]) ? map.get(name) : undefined;
      if (!def) {
        // Not ours. Drop wrappers KaTeX does not know but that are no-ops in math.
        if (name === "ensuremath" || name === "xspace" || name === "protect") i = after;
        else {
          out += s.slice(i, after);
          i = after;
        }
        continue;
      }
      const leave = (reason: string) => {
        if (!skipped.has(name)) skipped.set(name, reason);
        out += s.slice(i, after);
        i = after;
      };
      if (def.unsafe) {
        leave(def.unsafe);
        continue;
      }
      if (depth >= MAX_DEPTH || out.length + s.length > MAX_LEN) {
        leave("recursive definition");
        continue;
      }
      if (def.primitive) {
        expanded.add(name);
        out += def.body;
        i = after;
        if (isLetter(def.body[def.body.length - 1]) && isLetter(s[i])) out += " ";
        continue;
      }
      // Spaces after an argument-less macro are kept: harmless in math, and readable.
      let p = after;
      const args: string[] = [];
      let missing = false;
      for (let k = 0; k < def.nargs; k++) {
        if (k === 0 && def.optDefault !== null) {
          const o = readOpt(s, p);
          args.push(o ? o.text : def.optDefault);
          if (o) p = o.end;
          continue;
        }
        const a = readArg(s, p);
        if (!a) {
          missing = true;
          break;
        }
        args.push(a.text);
        p = a.end;
      }
      if (missing) {
        leave("used without all " + def.nargs + " arguments");
        continue;
      }
      const body = def.body.replace(/##|#[1-9]/g, (tok) => (tok === "##" ? "#" : (args[Number(tok[1]) - 1] ?? "")));
      let rep = run(body, depth + 1);
      // In argument position (x^\R, \hat\bx) the macro was one token; keep it one group.
      // Not for fragments like \left( or & that a group would break.
      const argPosition = /([\^_]|\\[A-Za-z@]+)\s*$/.test(out);
      const groupable = !/\\(left|right|middle|begin|end)(?![A-Za-z@])|&|\\\\/.test(rep);
      if (argPosition && groupable && !/^\s*(\\[A-Za-z@]+|\\.|.)\s*$/.test(rep)) rep = "{" + rep + "}";
      expanded.add(name);
      out += rep;
      if (/\\[A-Za-z@]+$/.test(rep) && isLetter(s[p])) out += " ";
      i = p;
    }
    return out;
  };

  const text = run(latex, 0);
  return { text, expanded: [...expanded], skipped: [...skipped].map(([name, reason]) => ({ name, reason })) };
}

/* ---------------------------------------------------------------- render */

/**
 * The equation as something KaTeX can draw: numbering commands stripped and
 * the environment mapped to its inner-math cousin (KaTeX has no multline or
 * eqnarray, and \tag is not allowed inside aligned).
 */
export function renderable(eq: Pick<Equation, "env" | "envArg">, latex: string): string {
  const body = latex
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\tag\*?\s*\{[^}]*\}/g, "")
    .replace(/\\(nonumber|notag|displaybreak|allowdisplaybreaks)(?![A-Za-z])(\[\d\])?/g, "")
    .replace(/\\(shortintertext|intertext)\s*\{([^}]*)\}/g, "\\text{$2}\\\\")
    .replace(/\\l?eqno.*$/gm, "")
    .trim();
  const base = eq.env.replace(/\*$/, "");
  if (base === "eqn") return plainTeX(body);
  if (base === "align" || base === "flalign" || base === "eqnarray") return "\\begin{aligned}" + body + "\\end{aligned}";
  if (base === "alignat") return "\\begin{alignedat}{" + (eq.envArg ?? "1") + "}" + body + "\\end{alignedat}";
  if (base === "gather" || base === "multline") return "\\begin{gathered}" + body + "\\end{gathered}";
  return body;
}

/** Plain-TeX alignments (harvmac's \eqalign{a&=b\cr ...}) as KaTeX's aligned. */
function plainTeX(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const at = body.indexOf("\\eqalign", i);
    if (at < 0 || isLetter(body[at + 8])) {
      out += body.slice(i, at < 0 ? body.length : at + 8);
      if (at < 0) break;
      i = at + 8;
      continue;
    }
    const arg = readArg(body, at + 8);
    if (!arg?.braced) {
      out += body.slice(i, at + 8);
      i = at + 8;
      continue;
    }
    out += body.slice(i, at) + "\\begin{aligned}" + plainTeX(arg.text.replace(/\\cr(?![A-Za-z@])\s*$/, "")) + "\\end{aligned}";
    i = arg.end;
  }
  return out.replace(/\\cr(?![A-Za-z@])/g, "\\\\");
}

/* ---------------------------------------------------------------- search */

export interface SearchHit {
  eq: Equation;
  score: number;
  via: "all" | "label" | "number" | "latex" | "context" | "words";
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Find equations by label (`eq:loss`), number (`3`, `(3)`, `eq. 3`, `2.1a`) or
 * text in the LaTeX or the prose just before it. Best matches first.
 */
export function searchEquations(eqs: ReadonlyArray<Equation>, query: string): SearchHit[] {
  const q = squash(query);
  if (!q) return eqs.map((eq) => ({ eq, score: 0, via: "all" as const }));
  const num = /^(?:eqs?|eqn|equation)?\.?\s*~?\s*\(?\s*([^\s()]+?)\s*\)?$/.exec(q)?.[1] ?? null;
  const words = q.split(" ").filter((w) => w.length > 1);
  const hits: SearchHit[] = [];
  for (const eq of eqs) {
    const labels = eq.labels.map((l) => l.toLowerCase());
    const body = squash(eq.latex);
    const ctx = squash(eq.context);
    let hit: SearchHit | null = null;
    if (labels.includes(q)) hit = { eq, score: 100, via: "label" };
    else if (num && eq.numbers.some((n) => n.toLowerCase() === num)) hit = { eq, score: 90, via: "number" };
    else if (labels.some((l) => l.includes(q))) hit = { eq, score: 60, via: "label" };
    else if (body.includes(q)) hit = { eq, score: body.startsWith(q) ? 55 : 50, via: "latex" };
    else if (ctx.includes(q)) hit = { eq, score: 30, via: "context" };
    else if (words.length > 1 && words.every((w) => body.includes(w) || ctx.includes(w))) hit = { eq, score: 15, via: "words" };
    if (hit) hits.push(hit);
  }
  return hits.sort((a, b) => b.score - a.score || a.eq.index - b.eq.index);
}
