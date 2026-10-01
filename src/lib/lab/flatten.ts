/**
 * flatten.ts - turn a multi-file LaTeX project into one .tex, the way journals
 * and arXiv want a camera-ready source.
 *
 * Works on decoded text files only ({ path, text }); binary files (figures) are
 * passed as bare paths so `\includegraphics` references can be resolved and the
 * caller can bundle them. Pure: no DOM, no I/O, never throws - every problem
 * (missing file, include cycle, no .bbl) becomes a warning with file and line,
 * and the offending command is left in place so the output still compiles as
 * far as it did before.
 *
 * `maskTex` is exported because the other Lab engines need the same answer to
 * "is this character inside a comment or a verbatim block?".
 */

export interface ProjectFile {
  path: string;
  text: string;
}

export interface FlattenOptions {
  /** Force this path as the main file instead of auto-detecting it. */
  main?: string;
  /** Remove % comments and comment environments, collapse blank-line runs. */
  stripComments?: boolean;
  /** Replace \bibliography{} with the .bbl contents when one exists (default true). */
  inlineBbl?: boolean;
  /** Paths of the project's binary files (figures), for asset resolution. */
  otherPaths?: ReadonlyArray<string>;
}

export interface FlattenWarning {
  file: string;
  line: number;
  message: string;
}

export interface FlattenAsset {
  reference: string;
  resolvedPath: string | null;
}

export interface FlattenResult {
  output: string;
  mainPath: string | null;
  /** Files whose text was pulled into the output, main file first. */
  inlined: string[];
  warnings: FlattenWarning[];
  assets: FlattenAsset[];
  /** The .bbl used (inlined, or to be shipped next to the output), if any. */
  bblPath: string | null;
  /** True when the .bbl text was pasted into the output. */
  bblInlined: boolean;
  /** Total lines across every inlined file. */
  linesIn: number;
}

/* ---------------------------------------------------------------- masking */

/** Environments whose body is not LaTeX to scan (or, for `comment`, not typeset at all). */
export const VERBATIM_ENVS: ReadonlySet<string> = new Set(["verbatim", "verbatim*", "Verbatim", "Verbatim*", "lstlisting", "minted", "comment"]);

export interface TexMask {
  /** Same length as the input; comment and verbatim-body characters are spaces (newlines kept). */
  masked: string;
  /** [start, end) of each `%` comment, the `%` included, the newline not. */
  comments: Array<[number, number]>;
  /** Whole verbatim-like environments, \begin through \end. */
  verbatim: Array<{ start: number; end: number; env: string }>;
}

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * Hide everything a command scanner must not see. Index-preserving, so a match
 * found in `masked` can be cut out of the original text at the same offsets.
 * Knows that `\%` is a literal percent, `\\%` is a line break then a comment,
 * and that `\url{a%b}` / `\verb|%|` contain no comment.
 */
export function maskTex(text: string): TexMask {
  const out: string[] = [];
  const comments: Array<[number, number]> = [];
  const verbatim: TexMask["verbatim"] = [];
  const n = text.length;
  const beginRe = /\\begin\s*\{([^{}]*)\}/y;
  const verbRe = /\\verb\*?([^A-Za-z\s*])/y;
  const urlRe = /\\(?:url|path|href|nolinkurl)\s*\{/y;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === "\\") {
      beginRe.lastIndex = i;
      const b = beginRe.exec(text);
      if (b && VERBATIM_ENVS.has(b[1])) {
        const endTag = "\\end{" + b[1] + "}";
        const bodyStart = i + b[0].length;
        let endAt = text.indexOf(endTag, bodyStart);
        if (endAt < 0) endAt = n;
        out.push(b[0], blank(text.slice(bodyStart, endAt)));
        verbatim.push({ start: i, end: Math.min(n, endAt + endTag.length), env: b[1] });
        i = endAt;
        if (i < n) {
          out.push(endTag);
          i += endTag.length;
        }
        continue;
      }
      verbRe.lastIndex = i;
      const v = verbRe.exec(text);
      if (v) {
        const bodyStart = i + v[0].length;
        let close = text.indexOf(v[1], bodyStart);
        const nl = text.indexOf("\n", bodyStart);
        if (close < 0 || (nl >= 0 && nl < close)) close = nl < 0 ? n : nl;
        out.push(v[0], blank(text.slice(bodyStart, close)));
        i = close;
        if (i < n && text[i] === v[1]) out.push(text[i++]);
        continue;
      }
      urlRe.lastIndex = i;
      const u = urlRe.exec(text);
      if (u) {
        // A URL argument is read verbatim by hyperref/url: % inside it is a character.
        let depth = 1;
        let j = i + u[0].length;
        while (j < n && depth > 0) {
          if (text[j] === "\\") j++;
          else if (text[j] === "{") depth++;
          else if (text[j] === "}") depth--;
          j++;
        }
        out.push(text.slice(i, j));
        i = j;
        continue;
      }
      // Control word, or a two-character control symbol (\%, \\, \{ ...).
      let j = i + 1;
      if (j < n && /[A-Za-z@]/.test(text[j])) while (j < n && /[A-Za-z@]/.test(text[j])) j++;
      else j = Math.min(n, j + 1);
      out.push(text.slice(i, j));
      i = j;
      continue;
    }
    if (c === "%") {
      let j = text.indexOf("\n", i);
      if (j < 0) j = n;
      comments.push([i, j]);
      out.push(blank(text.slice(i, j)));
      i = j;
      continue;
    }
    out.push(c);
    i++;
  }
  return { masked: out.join(""), comments, verbatim };
}

/* ---------------------------------------------------------- arg scanning */

/** Read a `{...}` group starting at or after `pos` (whitespace allowed). */
export function readGroup(s: string, pos: number): { start: number; end: number; value: string } | null {
  let i = pos;
  while (i < s.length && /[ \t\n]/.test(s[i])) i++;
  if (s[i] !== "{") return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { start: i, end: j + 1, value: s.slice(i + 1, j) };
  }
  return null;
}

/** Skip an optional `[...]` argument (nested brackets allowed); returns the new position. */
export function skipOptional(s: string, pos: number): number {
  let i = pos;
  while (i < s.length && /[ \t]/.test(s[i])) i++;
  if (s[i] !== "[") return pos;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") depth--;
    else if (s[j] === "]" && depth === 0) return j + 1;
  }
  return pos;
}

/* ------------------------------------------------------------------ paths */

export function normPath(p: string): string {
  const out: string[] = [];
  for (const part of p.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const joinPath = (dir: string, rel: string) => normPath(rel.startsWith("/") ? rel : dir ? dir + "/" + rel : rel);
const lineOf = (text: string, index: number) => {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
};

/* ---------------------------------------------------------- main detection */

const PREFERRED_MAIN = ["main.tex", "paper.tex", "ms.tex", "manuscript.tex", "article.tex"];

/** Files that could be compiled on their own: \documentclass plus \begin{document}. */
export function mainCandidates(files: ReadonlyArray<ProjectFile>): string[] {
  const roots = files.filter((f) => /\.tex$/i.test(f.path)).filter((f) => {
    const m = maskTex(f.text).masked;
    // A subfiles child also has both, but names the parent as its class option.
    return /\\documentclass(?![A-Za-z])/.test(m) && /\\begin\s*\{document\}/.test(m) && !/\\documentclass\s*\[[^\]]*\]\s*\{subfiles\}/.test(m);
  });
  const base = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
  const rank = (p: string) => {
    const k = PREFERRED_MAIN.indexOf(base(p));
    return k < 0 ? PREFERRED_MAIN.length : k;
  };
  return roots
    .map((f) => normPath(f.path))
    .sort((a, b) => rank(a) - rank(b) || a.split("/").length - b.split("/").length || a.length - b.length || a.localeCompare(b));
}

/* --------------------------------------------------------------- flatten */

const COMMAND_RE =
  /\\(input|include|subfile|import|subimport|inputfrom|subinputfrom|includefrom|subincludefrom|bibliography|bibliographystyle|addbibresource|printbibliography|includegraphics|graphicspath)(?![A-Za-z@])(\*?)/g;

const GRAPHIC_EXTS = ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps", ".PDF", ".PNG", ".JPG", ".JPEG", ".EPS"];
const MAX_DEPTH = 40;

export function flattenProject(files: ReadonlyArray<ProjectFile>, options: FlattenOptions = {}): FlattenResult {
  const byPath = new Map<string, string>();
  for (const f of files) byPath.set(normPath(f.path), f.text);
  const binary = new Set((options.otherPaths ?? []).map(normPath));
  const exists = (p: string) => byPath.has(p) || binary.has(p);

  const warnings: FlattenWarning[] = [];
  const inlined: string[] = [];
  const assets: FlattenAsset[] = [];
  const empty = (mainPath: string | null): FlattenResult => ({ output: "", mainPath, inlined, warnings, assets, bblPath: null, bblInlined: false, linesIn: 0 });

  const forced = options.main ? normPath(options.main) : "";
  const mainPath = forced && byPath.has(forced) ? forced : (mainCandidates(files)[0] ?? null);
  if (forced && !byPath.has(forced)) warnings.push({ file: forced, line: 0, message: "Chosen main file is not in the project; auto-detected instead." });
  if (!mainPath) {
    warnings.push({ file: "", line: 0, message: "No main file found: no .tex file has both \\documentclass and \\begin{document}." });
    return empty(null);
  }

  // LaTeX resolves every \input against the directory it was run from: the main file's.
  const root = dirname(mainPath);
  const mainStem = mainPath.replace(/\.tex$/i, "");
  const bbls = [...byPath.keys()].filter((p) => /\.bbl$/i.test(p));
  let bblPath: string | null = byPath.has(mainStem + ".bbl") ? mainStem + ".bbl" : bbls.length === 1 ? bbls[0] : null;
  const inlineBbl = options.inlineBbl !== false && bblPath !== null;
  let bblInlined = false;
  let biblatex = false;
  let bibWarned = false;
  const graphicsDirs: string[] = [];
  const seenAssets = new Set<string>();
  let linesIn = 0;

  const resolveTex = (base: string, name: string, forceTex: boolean): string | null => {
    const p = joinPath(base, name.trim());
    if (/\.tex$/i.test(p)) return byPath.has(p) ? p : null;
    if (byPath.has(p + ".tex")) return p + ".tex";
    return !forceTex && byPath.has(p) ? p : null;
  };

  const resolveGraphic = (base: string, name: string): string | null => {
    const dirs = [base, ...graphicsDirs.map((d) => joinPath(root, d)), root];
    for (const d of dirs)
      for (const ext of GRAPHIC_EXTS) {
        const p = joinPath(d, name + ext);
        if (exists(p)) return p;
      }
    return null;
  };

  /**
   * Expand one file's text. `base` is the directory relative paths resolve
   * against (the root, or an \import directory); `stack` is the include chain.
   */
  const expand = (path: string, text: string, lineBase: number, base: string, stack: string[]): string => {
    const { masked } = maskTex(text);
    const out: string[] = [];
    let cursor = 0;
    let line = lineBase;
    let counted = 0;
    const lineAt = (idx: number) => {
      for (; counted < idx; counted++) if (text.charCodeAt(counted) === 10) line++;
      return line;
    };
    const warn = (idx: number, message: string) => warnings.push({ file: path, line: lineAt(idx), message });
    /** Leave the command, add a visible marker; a space keeps the next line's word apart. */
    const keep = (end: number, note: string) => {
      out.push(text.slice(cursor, end), " % tex-flatten: " + note);
      cursor = end;
      if (cursor < text.length && text[cursor] !== "\n") out.push("\n");
    };
    /** Remove [start, end), and the whole line if nothing else is on it. */
    const drop = (start: number, end: number) => {
      const ls = text.lastIndexOf("\n", start - 1) + 1;
      let le = masked.indexOf("\n", end);
      if (le < 0) le = text.length;
      if (!masked.slice(ls, start).trim() && !masked.slice(end, le).trim()) {
        out.push(text.slice(cursor, ls));
        cursor = Math.min(text.length, le + 1);
      } else {
        out.push(text.slice(cursor, start));
        cursor = end;
      }
    };

    // A fresh regex per call: expand() recurses, and a shared lastIndex would be clobbered.
    const re = new RegExp(COMMAND_RE.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked))) {
      const start = m.index;
      if (start < cursor) continue;
      const cmd = m[1];
      let after = start + m[0].length;

      if (cmd === "includegraphics") {
        after = skipOptional(masked, after);
        const g = readGroup(masked, after);
        if (g) {
          const ref = text.slice(g.start + 1, g.end - 1).trim();
          if (ref && !ref.includes("#") && !seenAssets.has(ref)) {
            seenAssets.add(ref);
            assets.push({ reference: ref, resolvedPath: resolveGraphic(base, ref) });
          }
          re.lastIndex = g.end;
        }
        continue;
      }
      if (cmd === "graphicspath") {
        const g = readGroup(masked, after);
        if (g) for (const d of g.value.matchAll(/\{([^{}]*)\}/g)) graphicsDirs.push(d[1].trim());
        continue;
      }
      if (cmd === "addbibresource") {
        biblatex = true;
        continue;
      }
      if (cmd === "printbibliography") {
        if (!bibWarned) {
          bibWarned = true;
          warn(
            start,
            bblPath
              ? "biblatex reads the .bbl by job name, so it cannot be pasted in; ship " + bblPath + " renamed to match the flattened file (the zip does this). arXiv's biber version must match yours."
              : "biblatex document with no .bbl: compile once and include the .bbl, or arXiv cannot build the bibliography.",
          );
        }
        continue;
      }
      if (cmd === "bibliographystyle") {
        const g = readGroup(masked, after);
        if (g && inlineBbl) drop(start, g.end);
        if (g) re.lastIndex = g.end;
        continue;
      }
      if (cmd === "bibliography") {
        const g = readGroup(masked, after);
        if (!g) continue;
        re.lastIndex = g.end;
        if (inlineBbl && bblPath) {
          out.push(text.slice(cursor, start), byPath.get(bblPath)!.replace(/\s+$/, ""));
          cursor = g.end;
          bblInlined = true;
        } else if (!bblPath) {
          warn(start, (bbls.length > 1 ? "Several .bbl files and none named after the main file" : "No .bbl file found") + "; arXiv expects the compiled .bbl - kept \\bibliography{" + g.value + "}.");
        }
        continue;
      }

      // ---- file-including commands
      let name: string;
      let nextBase = base;
      let end: number;
      if (cmd === "input" && !masked.slice(after).match(/^\s*\{/)) {
        // TeX primitive form: \input file (name ends at space, brace, or backslash).
        const t = /^[ \t]+([^\s{}%\\]+)/.exec(masked.slice(after, after + 300));
        if (!t) continue;
        name = t[1];
        end = after + t[0].length;
      } else if (/^(sub)?(import|inputfrom|includefrom)$/.test(cmd)) {
        const d = readGroup(masked, after);
        const f = d && readGroup(masked, d.end);
        if (!d || !f) continue;
        const dir = text.slice(d.start + 1, d.end - 1).trim();
        nextBase = cmd.startsWith("sub") ? joinPath(base, dir) : joinPath(root, dir);
        name = text.slice(f.start + 1, f.end - 1);
        end = f.end;
      } else {
        const g = readGroup(masked, after);
        if (!g) continue;
        name = text.slice(g.start + 1, g.end - 1);
        end = g.end;
      }
      re.lastIndex = end;
      // Macro arguments (#1) or computed names cannot be resolved statically.
      if (!name.trim() || /[#\\]/.test(name)) continue;

      const isInclude = cmd === "include" || /includefrom$/.test(cmd);
      const target = resolveTex(nextBase, name, isInclude);
      if (!target) {
        warn(start, "File not found: " + joinPath(nextBase, name.trim()) + (/\.\w+$/.test(name) ? "" : "(.tex)"));
        keep(end, "file not found");
        continue;
      }
      if (stack.includes(target) || stack.length > MAX_DEPTH) {
        warn(start, "Include cycle: " + [...stack, target].join(" -> "));
        keep(end, "include cycle, not expanded");
        continue;
      }
      let body = byPath.get(target)!;
      let bodyLine = 1;
      if (cmd === "subfile") {
        // A subfile is a complete document; only its body belongs in the parent.
        const sm = maskTex(body).masked;
        const b = /\\begin\s*\{document\}/.exec(sm);
        const e = sm.lastIndexOf("\\end{document}");
        if (b) {
          const s = b.index + b[0].length;
          bodyLine = lineOf(body, s);
          body = body.slice(s, e > s ? e : body.length);
        }
      }
      if (!inlined.includes(target)) {
        inlined.push(target);
        linesIn += byPath.get(target)!.split("\n").length;
      }
      const expanded = expand(target, body, bodyLine, nextBase, [...stack, target]).replace(/^\n/, "").replace(/\s+$/, "");
      out.push(text.slice(cursor, start), isInclude ? "\\clearpage\n" + expanded + "\n\\clearpage" : expanded);
      cursor = end;
    }
    out.push(text.slice(cursor));
    return out.join("");
  };

  inlined.push(mainPath);
  const mainText = byPath.get(mainPath)!;
  linesIn += mainText.split("\n").length;
  let output = expand(mainPath, mainText, 1, root, [mainPath]);

  if (biblatex && !bibWarned && !bblPath) warnings.push({ file: mainPath, line: 0, message: "biblatex document with no .bbl: include the compiled .bbl for arXiv." });
  if (!inlineBbl || !bblInlined) {
    // Unused .bbl: keep it only when the document still needs one shipped beside it.
    if (!biblatex && !/\\bibliography\s*\{/.test(maskTex(output).masked)) bblPath = null;
  }
  for (const a of assets)
    if (!a.resolvedPath) warnings.push({ file: mainPath, line: 0, message: "Figure not found in the project: " + a.reference });

  if (options.stripComments) output = stripComments(output);
  return { output, mainPath, inlined, warnings, assets, bblPath, bblInlined, linesIn };
}

/* --------------------------------------------------------- comment strip */

/**
 * Remove what a reviewer should not read: `%` comments (a trailing `%` is kept
 * because it suppresses the end-of-line space), whole comment lines, `comment`
 * environments, and runs of 3+ blank lines. Verbatim bodies and \url{} are
 * untouched because `maskTex` never reports comments inside them. Markers
 * written by this tool (`% tex-flatten: ...`) survive, so warnings stay visible.
 */
export function stripComments(text: string): string {
  const { comments, verbatim } = maskTex(text);
  const cuts: Array<[number, number, string]> = [];
  for (const [s, e] of comments) {
    if (text.startsWith("% tex-flatten:", s)) continue;
    const ls = text.lastIndexOf("\n", s - 1) + 1;
    if (!text.slice(ls, s).trim()) cuts.push([ls, e < text.length ? e + 1 : e, ""]);
    else cuts.push([s, e, "%"]);
  }
  for (const v of verbatim) {
    if (v.env !== "comment") continue;
    const ls = text.lastIndexOf("\n", v.start - 1) + 1;
    let le = text.indexOf("\n", v.end);
    if (le < 0) le = text.length;
    const ownLines = !text.slice(ls, v.start).trim() && !text.slice(v.end, le).trim();
    cuts.push(ownLines ? [ls, le < text.length ? le + 1 : le, ""] : [v.start, v.end, ""]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const out: string[] = [];
  let cursor = 0;
  for (const [s, e, rep] of cuts) {
    if (s < cursor) continue;
    out.push(text.slice(cursor, s), rep);
    cursor = e;
  }
  out.push(text.slice(cursor));
  const stripped = out.join("");
  // Collapse blank-line runs only between verbatim blocks, never inside one.
  const pieces: string[] = [];
  let at = 0;
  for (const v of maskTex(stripped).verbatim) {
    pieces.push(collapseBlank(stripped.slice(at, v.start)), stripped.slice(v.start, v.end));
    at = v.end;
  }
  pieces.push(collapseBlank(stripped.slice(at)));
  return pieces.join("");
}

const collapseBlank = (s: string) => s.replace(/\n([ \t]*\n){3,}/g, "\n\n");
