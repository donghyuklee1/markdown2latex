/**
 * tex2prose.ts - the LLM Proofreading Shield.
 *
 * Pasting raw LaTeX into DeepL, Claude or ChatGPT wastes tokens on markup the
 * model should not touch, and the model "helpfully" rewrites maths, citation
 * keys and labels. `protect` swaps every such span for a short numbered
 * placeholder (`[MATH_1]`, `[CITE_2]`, ...) and records the original in a
 * session; `restore` puts the originals back into whatever text the model
 * returned, tolerating the ways models mangle tokens and reporting - never
 * silently fixing - placeholders that went missing, were duplicated or were
 * invented.
 *
 * Placeholder scheme
 * - Atomic spans become one token: `[MATH_1]`, `[CITE_1]`, `[REF_1]`,
 *   `[LABEL_1]`, `[URL_1]`, `[FIGURE_1]`, `[TABLE_1]`, `[ALGORITHM_1]`,
 *   `[CMD_1]` (strict mode).
 * - Commands whose argument is prose the user wants proofread become a pair
 *   around that prose: `\footnote{text}` -> `[FN_1]text[/FN_1]`,
 *   `\href{url}{text}` -> `[URL_1]text[/URL_1]` (the URL is protected, the link
 *   text is proofread), and in strict mode `\textbf{key}` -> `[B_1]key[/B_1]`.
 *   Square-bracket tags with an upper-case word and an index are the form
 *   models reproduce most reliably: they look like BBCode, which models have
 *   seen copied verbatim countless times, and they survive translation because
 *   they contain no natural-language word.
 * - Indices count per kind in document order, so two identical formulas get
 *   `[MATH_1]` and `[MATH_2]`; every token maps to exactly one original.
 * - If the input already contains something that reads as a placeholder, a
 *   prefix is added (`[CM_MATH_1]`) and recorded in the session.
 *
 * Pure: no DOM, no I/O. Never throws on malformed input.
 */
import { tokenize } from "../cleaner";

/* ------------------------------------------------------------------- types */

export interface ProtectOptions {
  /** Also hide whole figure / table / algorithm environments. */
  floats: boolean;
  /** Drop `%` comments before sending (`\%` is kept). Restore cannot bring them back. */
  stripComments: boolean;
  /** Also wrap formatting commands and hide every remaining command. */
  strict: boolean;
}

export const DEFAULT_PROTECT: ProtectOptions = { floats: true, stripComments: true, strict: false };

export interface Session {
  format: typeof FORMAT;
  version: 1;
  /** Prepended to every kind, e.g. "CM_" -> `[CM_MATH_1]`. Usually empty. */
  prefix: string;
  /** Token id (`MATH_1`, closing tags as `/FN_1`) -> the exact original LaTeX. */
  entries: Record<string, string>;
}

export interface ProtectStats {
  counts: Record<string, number>;
  inputChars: number;
  proseChars: number;
  /** Characters the model no longer has to read. */
  removedChars: number;
  /** Rough token estimate: removed characters / 4. */
  tokensSaved: number;
}

export interface ProtectResult {
  prose: string;
  session: Session;
  stats: ProtectStats;
}

export interface RestoreResult {
  tex: string;
  /** Tokens the session has that the text does not contain. Nothing is appended for them. */
  missing: string[];
  /** Tokens that occur more than once (each occurrence is still restored). */
  duplicated: string[];
  /** Placeholder-shaped tokens the session does not know (left as they are). */
  unknown: string[];
  /** Occurrences that were found in a mangled form (case, spacing, escapes, ...). */
  repaired: number;
}

const FORMAT = "cleanmath-tex2prose-session";

/** Every kind restore recognises, so an invented `[MATH_99]` is reported as unknown. */
const KINDS = ["MATH", "CITE", "REF", "LABEL", "URL", "FN", "FIGURE", "TABLE", "ALGORITHM", "CMD", "B", "I", "U", "TT", "SC", "SEC", "CAP", "TX"];

/* ------------------------------------------------------------ small parsers */

/** Index just past the `}` matching the `{` at `open`, or -1. Honours `\{` and `\}`. */
function groupEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/** Index just past the `]` closing the optional argument at `open`, or -1. */
function optEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "]" && depth === 0) return i + 1;
    if (c === "\n" && s[i + 1] === "\n") return -1;
  }
  return -1;
}

/** Skip spaces (not blank lines) - `\cite {x}` is legal LaTeX. */
function skipSpace(s: string, i: number): number {
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return i;
}

/** Start of the `%` comment on each position's line, honouring `\%` and `\\%`. */
function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "%") return i;
  }
  return -1;
}

/**
 * Remove `%` comments. A line that held only a comment disappears entirely, as
 * LaTeX itself treats it; a trailing comment loses its text but keeps the line.
 */
export function stripComments(tex: string): string {
  const out: string[] = [];
  for (const line of tex.split("\n")) {
    const at = commentStart(line);
    if (at === -1) out.push(line);
    else if (line.slice(0, at).trim() === "") continue;
    else out.push(line.slice(0, at).replace(/[ \t]+$/, ""));
  }
  return out.join("\n");
}

/**
 * Same-length copy with comments and backticks blanked out, used only to find
 * spans. Without it `% $x` would open inline math, and LaTeX's ``quotes''
 * would be read as markdown code spans by the shared tokenizer.
 */
function maskForScan(tex: string): string {
  const FILL = String.fromCharCode(1);
  return tex
    .split("\n")
    .map((line) => {
      const at = commentStart(line);
      const kept = at === -1 ? line : line.slice(0, at) + FILL.repeat(line.length - at);
      return kept.replace(/`/g, FILL);
    })
    .join("\n");
}

/* ----------------------------------------------------------------- protect */

const FLOAT_ENVS: Record<string, string> = { figure: "FIGURE", wrapfigure: "FIGURE", table: "TABLE", algorithm: "ALGORITHM" };

const CITE_RE = /\\(?:cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|parencite|textcite|autocite|footcite|smartcite|nocite|Cite|Citep|Citet|Parencite|Textcite|Autocite)(?![A-Za-z])\*?/y;
const REF_RE = /\\(?:ref|eqref|autoref|Autoref|cref|Cref|pageref|vref|Vref|nameref)(?![A-Za-z])\*?/y;

/** Strict mode: commands whose single argument is prose, and the tag they become. */
const PAIRED: Record<string, string> = {
  textbf: "B",
  textit: "I",
  emph: "I",
  textsl: "I",
  underline: "U",
  texttt: "TT",
  textsc: "SC",
  part: "SEC",
  chapter: "SEC",
  section: "SEC",
  subsection: "SEC",
  subsubsection: "SEC",
  paragraph: "SEC",
  caption: "CAP",
  textrm: "TX",
  textsf: "TX",
  textup: "TX",
  textmd: "TX",
  mbox: "TX",
  textnormal: "TX",
};

class Builder {
  readonly counts: Record<string, number> = {};
  readonly entries: Record<string, string> = {};
  constructor(readonly prefix: string) {}

  /** Register an atomic span and return its token. */
  atom(kind: string, original: string): string {
    const n = (this.counts[kind] = (this.counts[kind] ?? 0) + 1);
    this.entries[kind + "_" + n] = original;
    return "[" + this.prefix + kind + "_" + n + "]";
  }

  /** Register a pair; returns [open token, close token]. */
  pair(kind: string, open: string, close: string): [string, string] {
    const n = (this.counts[kind] = (this.counts[kind] ?? 0) + 1);
    this.entries[kind + "_" + n] = open;
    this.entries["/" + kind + "_" + n] = close;
    return ["[" + this.prefix + kind + "_" + n + "]", "[/" + this.prefix + kind + "_" + n + "]"];
  }
}

/** Find the end of `\begin{name}` ... matching `\end{name}`, counting nesting. */
function envEnd(s: string, from: number, name: string): number {
  const escaped = name.replace(/\*/g, "\\*");
  const re = new RegExp("\\\\(begin|end)\\{" + escaped + "\\}", "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    depth += m[1] === "begin" ? 1 : -1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

function protectFloats(tex: string, b: Builder): string {
  const mask = maskForScan(tex);
  const re = /\\begin\{(figure|wrapfigure|table|algorithm)(\*?)\}/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mask))) {
    const end = envEnd(mask, m.index + m[0].length, m[1] + m[2]);
    if (end === -1) continue; // unterminated: leave it as prose rather than swallow the rest
    out += tex.slice(last, m.index) + b.atom(FLOAT_ENVS[m[1]], tex.slice(m.index, end));
    last = end;
    re.lastIndex = end;
  }
  return out + tex.slice(last);
}

function protectMath(tex: string, b: Builder): string {
  const { tokens } = tokenize(maskForScan(tex));
  let out = "";
  tokens.forEach((t, k) => {
    const end = k + 1 < tokens.length ? tokens[k + 1].start : tex.length;
    const original = tex.slice(t.start, end);
    out += t.kind === "text" ? original : b.atom("MATH", original);
  });
  return out;
}

/**
 * Walk prose left to right, replacing commands. Recursive for paired commands
 * so `\footnote{see \cite{x}}` numbers the footnote before the citation.
 */
function protectCommands(s: string, b: Builder, strict: boolean): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "%") {
      // Comments that were kept travel verbatim; nothing inside them is touched.
      const nl = s.indexOf("\n", i);
      const stop = nl === -1 ? s.length : nl;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    if (c !== "\\") {
      out += c;
      i++;
      continue;
    }

    const word = /^\\([A-Za-z]+)(\*?)/.exec(s.slice(i, i + 40));
    if (!word) {
      // Control symbol: `\%`, `\&`, `\\`, `\,` ...
      const sym = s.slice(i, i + 2);
      out += strict && sym.length === 2 && sym !== "\\\\" ? b.atom("CMD", sym) : sym;
      i += 2;
      continue;
    }
    const name = word[1];
    let j = i + word[0].length;

    // Citations: up to two optional args, then the key group.
    CITE_RE.lastIndex = i;
    if (CITE_RE.test(s) && CITE_RE.lastIndex === j) {
      let k = j;
      for (let opt = 0; opt < 2; opt++) {
        const at = skipSpace(s, k);
        if (s[at] !== "[") break;
        const e = optEnd(s, at);
        if (e === -1) break;
        k = e;
      }
      const at = skipSpace(s, k);
      const e = s[at] === "{" ? groupEnd(s, at) : -1;
      if (e !== -1) {
        out += b.atom("CITE", s.slice(i, e));
        i = e;
        continue;
      }
    }

    REF_RE.lastIndex = i;
    if (REF_RE.test(s) && REF_RE.lastIndex === j) {
      const at = skipSpace(s, j);
      const e = s[at] === "{" ? groupEnd(s, at) : -1;
      if (e !== -1) {
        out += b.atom("REF", s.slice(i, e));
        i = e;
        continue;
      }
    }

    if (name === "label" || name === "url") {
      const at = skipSpace(s, j);
      const e = s[at] === "{" ? groupEnd(s, at) : -1;
      if (e !== -1) {
        out += b.atom(name === "url" ? "URL" : "LABEL", s.slice(i, e));
        i = e;
        continue;
      }
    }

    if (name === "href") {
      const a = skipSpace(s, j);
      const aEnd = s[a] === "{" ? groupEnd(s, a) : -1;
      const t = aEnd === -1 ? -1 : skipSpace(s, aEnd);
      const tEnd = t !== -1 && s[t] === "{" ? groupEnd(s, t) : -1;
      if (tEnd !== -1) {
        const [open, close] = b.pair("URL", s.slice(i, t + 1), "}");
        out += open + protectCommands(s.slice(t + 1, tEnd - 1), b, strict) + close;
        i = tEnd;
        continue;
      }
    }

    const tag = name === "footnote" || name === "thanks" ? "FN" : strict ? PAIRED[name] : undefined;
    if (tag) {
      // Optional args (`\footnote[3]{..}`, `\section[short]{..}`) belong to the opener.
      let k = j;
      let at = skipSpace(s, k);
      while (s[at] === "[") {
        const e = optEnd(s, at);
        if (e === -1) break;
        k = e;
        at = skipSpace(s, k);
      }
      const e = s[at] === "{" ? groupEnd(s, at) : -1;
      if (e !== -1) {
        const [open, close] = b.pair(tag, s.slice(i, at + 1), "}");
        out += open + protectCommands(s.slice(at + 1, e - 1), b, strict) + close;
        i = e;
        continue;
      }
    }

    if (strict) {
      // Anything else - `\noindent`, `\vspace{2mm}`, `\begin{itemize}` - is
      // markup, not prose: hide the command together with its arguments.
      let k = j;
      for (;;) {
        const at = skipSpace(s, k);
        const e = s[at] === "{" ? groupEnd(s, at) : s[at] === "[" ? optEnd(s, at) : -1;
        if (e === -1) break;
        k = e;
      }
      out += b.atom("CMD", s.slice(i, k));
      i = k;
      continue;
    }

    out += word[0];
    i = j;
  }
  return out;
}

/** Pick a prefix whose tokens cannot be confused with anything in the input. */
function choosePrefix(tex: string): string {
  for (let n = 0; n < 50; n++) {
    const prefix = n === 0 ? "" : n === 1 ? "CM_" : "CM" + n + "_";
    if (!tokenMatcher(prefix).test(tex)) return prefix;
  }
  return "CM_" + tex.length + "_";
}

export function protect(tex: string, options: ProtectOptions = DEFAULT_PROTECT): ProtectResult {
  const source = options.stripComments ? stripComments(tex) : tex;
  const b = new Builder(choosePrefix(tex));
  let s = source;
  if (options.floats) s = protectFloats(s, b);
  s = protectMath(s, b);
  s = protectCommands(s, b, options.strict);
  const removed = Math.max(0, tex.length - s.length);
  return {
    prose: s,
    session: { format: FORMAT, version: 1, prefix: b.prefix, entries: b.entries },
    stats: {
      counts: { ...b.counts },
      inputChars: tex.length,
      proseChars: s.length,
      removedChars: removed,
      tokensSaved: Math.round(removed / 4),
    },
  };
}

/* ----------------------------------------------------------------- restore */

/** Case-insensitive character classes, so the regex itself can stay case-sensitive. */
function anyCase(word: string): string {
  return word.replace(/[A-Za-z]/g, (ch) => "[" + ch.toUpperCase() + ch.toLowerCase() + "]");
}

const OPEN = "(?:\\\\?\\[|\\uFF3B|\\u3010)";
const CLOSE = "(?:\\\\?\\]|\\uFF3D|\\u3011)";
const SLASH = "(\\/|\\\\\\/|\\uFF0F)?";
const SEP = "(?:_|\\\\_|\\uFF3F|-| )";
const DIGITS = "([0-9\\uFF10-\\uFF19]+)";

/**
 * Matches every way a model has been seen to return a token:
 * `[MATH_1]`, `[ math_1 ]`, `\[MATH\_1\]`, a fullwidth bracket pair from a CJK
 * translator, `` `[MATH_1]` ``, and - case-sensitively, so ordinary words are
 * safe - a bare `MATH_1` whose brackets were dropped.
 */
function tokenMatcher(prefix: string): RegExp {
  const kinds = "(" + KINDS.slice().sort((a, b) => b.length - a.length).map(anyCase).join("|") + ")";
  const pre = prefix.replace(/[A-Za-z]/g, (ch) => anyCase(ch)).replace(/_/g, SEP);
  const bracketed = "(`?)" + OPEN + "\\s*" + SLASH + "\\s*" + pre + kinds + SEP + "?" + DIGITS + "\\s*" + CLOSE + "\\2";
  const bareKinds = "(" + KINDS.join("|") + ")";
  const bare = "(?<![A-Za-z0-9_/])" + prefix + bareKinds + "_([0-9]+)(?![A-Za-z0-9_])";
  // Group 1 wraps the whole bracketed form so its backtick backreference is \2.
  return new RegExp("(" + bracketed + ")|" + bare, "g");
}

function asciiDigits(s: string): string {
  return s.replace(/[\uFF10-\uFF19]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xff10 + 48));
}

/** The canonical spelling of a token id, for reports. */
function display(id: string, prefix: string): string {
  return id.startsWith("/") ? "[/" + prefix + id.slice(1) + "]" : "[" + prefix + id + "]";
}

export function restore(llmText: string, session: Session): RestoreResult {
  const seen = new Map<string, number>();
  const unknown: string[] = [];
  let repaired = 0;
  const re = tokenMatcher(session.prefix);
  const tex = llmText.replace(re, (whole, br, _tick, slash, kind, digits, bareKind, bareDigits) => {
    const k = String(br ? kind : bareKind).toUpperCase();
    const n = String(Number(asciiDigits(br ? digits : bareDigits)));
    const id = (br && slash ? "/" : "") + k + "_" + n;
    const original = session.entries[id];
    if (original === undefined) {
      unknown.push(whole);
      return whole;
    }
    if (whole !== display(id, session.prefix)) repaired++;
    seen.set(id, (seen.get(id) ?? 0) + 1);
    return original;
  });
  const ids = Object.keys(session.entries);
  return {
    tex,
    missing: ids.filter((id) => !seen.has(id)).map((id) => display(id, session.prefix)),
    duplicated: ids.filter((id) => (seen.get(id) ?? 0) > 1).map((id) => display(id, session.prefix)),
    unknown: Array.from(new Set(unknown)),
    repaired,
  };
}

/* ---------------------------------------------------------------- sessions */

export function serializeSession(session: Session): string {
  return JSON.stringify(
    { format: FORMAT, version: 1, note: "CleanMath LLM Proofreading Shield session. Load it to restore placeholders.", prefix: session.prefix, entries: session.entries },
    null,
    2,
  );
}

export function parseSession(text: string): { session: Session } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "Not a JSON file." };
  }
  if (!data || typeof data !== "object") return { error: "Not a session file." };
  const d = data as Record<string, unknown>;
  if (d.format !== FORMAT) return { error: "Not a tex2prose session (missing format header)." };
  if (d.version !== 1) return { error: "Unsupported session version " + String(d.version) + "." };
  if (typeof d.prefix !== "string" || !/^[A-Z0-9_]*$/.test(d.prefix)) return { error: "Session prefix is malformed." };
  if (!d.entries || typeof d.entries !== "object" || Array.isArray(d.entries)) return { error: "Session has no entries." };
  const entries: Record<string, string> = {};
  for (const [k, v] of Object.entries(d.entries as Record<string, unknown>)) {
    if (!/^\/?[A-Z]+_\d+$/.test(k) || typeof v !== "string") return { error: "Session entry " + k + " is malformed." };
    entries[k] = v;
  }
  return { session: { format: FORMAT, version: 1, prefix: d.prefix, entries } };
}

/* ------------------------------------------------------------------ prompt */

export interface PromptOptions {
  /** What the model should do, e.g. "Proofread" or "Translate into German". */
  task?: string;
  prefix?: string;
  /** Mention paired tags like [FN_1]...[/FN_1]. */
  paired?: boolean;
}

export function prompt(options: PromptOptions = {}): string {
  const p = options.prefix ?? "";
  const task = (options.task ?? "Proofread the text below for grammar, clarity and style").trim().replace(/[.:]$/, "");
  const lines = [
    task + ".",
    "It is part of a LaTeX paper. Math, citations, references and labels have been replaced by placeholder tokens such as [" + p + "MATH_3], [" + p + "CITE_1] or [" + p + "REF_2].",
    "Keep every token exactly as is: same square brackets, capitals and number, no backticks or escaping. Do not add, remove, renumber, merge or translate tokens; keep each one next to the words it belongs with.",
  ];
  if (options.paired) lines.push("Tags like [" + p + "FN_1]...[/" + p + "FN_1] wrap text: you may edit the text between them, but keep both tags.");
  lines.push("Return only the revised text.");
  return lines.join("\n");
}
