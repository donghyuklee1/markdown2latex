/**
 * tensor2tex.ts - NumPy / PyTorch printouts -> LaTeX matrices and shape
 * statements for a methodology section.
 *
 * Reads what people actually paste: `array([[1., 2.]], dtype=float32)`, the
 * comma-less `print()` form `[[1 2]\n [3 4]]`, `tensor(..., device='cuda:0',
 * grad_fn=<AddBackward0>)`, scalars, plain Python lists, nan / inf, booleans,
 * complex numbers and summarized arrays whose `...` must survive as `\cdots`,
 * `\vdots` and `\ddots`. Shape-only input (`torch.Size([32, 3, 224, 224])`,
 * `(B, T, D)`) produces just the `\mathbf{X} \in \mathbb{R}^{...}` statement.
 *
 * Pure: no DOM, no I/O. Never throws - malformed input returns an error with
 * the offset, line and column where reading stopped.
 */

/* ------------------------------------------------------------------- types */

export type MatrixEnv = "bmatrix" | "pmatrix" | "vmatrix" | "Bmatrix" | "array";
export type Decimals = "auto" | 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type VectorOrientation = "column" | "row" | "transpose";
export type Convention = "standard" | "alternate" | "custom";
export type FieldChoice = "auto" | "R" | "C" | "Z" | "B";

export interface TensorOptions {
  env: MatrixEnv;
  decimals: Decimals;
  /** `1.2 \times 10^{-3}` for floats with |x| >= 1e4 or 0 < |x| < 1e-3. */
  scientific: boolean;
  name: string;
  /** Write vectors as `\mathbf{x}` rather than `\mathbf{X}`. */
  lowercaseVector: boolean;
  vector: VectorOrientation;
  /** Emit the `\in \mathbb{R}^{...}` statement and the concrete sizes. */
  annotate: boolean;
  /** Exponent written with dimension names (`N \times C`) or numbers (`32 \times 3`). */
  dimStyle: "names" | "numbers";
  convention: Convention;
  /** Comma list used when `convention` is "custom". */
  customDims: string;
  field: FieldChoice;
  bools: "01" | "TF";
  /** 2D slices shown for rank >= 3 before the rest is summarized. */
  maxSlices: number;
}

export const DEFAULT_TENSOR: TensorOptions = {
  env: "bmatrix",
  decimals: "auto",
  scientific: true,
  name: "X",
  lowercaseVector: false,
  vector: "column",
  annotate: true,
  dimStyle: "names",
  convention: "standard",
  customDims: "",
  field: "auto",
  bools: "01",
  maxSlices: 4,
};

export interface TensorError {
  message: string;
  offset: number;
  line: number;
  column: number;
}

/** A dimension's size: a number, a symbol from shape input, or null when `...` hid it. */
export type DimSize = number | string | null;

export interface TensorResult {
  /** Math-mode LaTeX, no delimiters. Several statements are joined in `gathered`. */
  latex: string;
  /** The individual statements, for callers that want their own layout. */
  lines: string[];
  shape: DimSize[];
  /** Dimension names used in the annotation. */
  dims: string[];
  rank: number;
  /** Known element count, or null if a dimension is symbolic or summarized. */
  elements: number | null;
  /** True when the input was a shape, not data. */
  shapeOnly: boolean;
  dtype: string | null;
  warnings: string[];
  error: TensorError | null;
}

type Scalar =
  | { kind: "real"; value: number; int: boolean }
  | { kind: "complex"; re: number; im: number }
  | { kind: "bool"; value: boolean };

type Node = { t: "leaf"; v: Scalar; at: number } | { t: "list"; items: Node[]; at: number } | { t: "skip"; at: number };

/* ------------------------------------------------------------------ errors */

function locate(src: string, offset: number): TensorError & { message: "" } {
  const before = src.slice(0, offset);
  const line = before.split("\n").length;
  return { message: "", offset, line, column: offset - before.lastIndexOf("\n") };
}

class ParseError {
  constructor(
    readonly message: string,
    readonly at: number,
  ) {}
}

/* ------------------------------------------------------------------ parser */

const NUM = "(?:(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?|nan|inf(?:inity)?)";
const COMPLEX = new RegExp("([+-]?" + NUM + ")([+-]" + NUM + "?)[jJ]", "iy");
const IMAG = new RegExp("([+-]?" + NUM + ")?[jJ]", "iy");
const REAL = new RegExp("[+-]?" + NUM, "iy");
const BOOL = /(True|False|true|false)/y;
const DELIM = /[\s,\])]/;

function toNumber(raw: string): number {
  const r = raw.toLowerCase().replace(/^\+/, "");
  if (r === "nan" || r === "-nan") return NaN;
  if (/^-?inf/.test(r)) return r.startsWith("-") ? -Infinity : Infinity;
  if (r === "" || r === "+") return 1;
  if (r === "-") return -1;
  return Number(r);
}

/** Read one scalar at `i`. Returns the scalar and the index after it, or null. */
function readScalar(s: string, i: number): [Scalar, number] | null {
  const ended = (end: number) => end >= s.length || DELIM.test(s[end]);
  const tryRe = (re: RegExp) => {
    re.lastIndex = i;
    const m = re.exec(s);
    return m && ended(re.lastIndex) ? { m, end: re.lastIndex } : null;
  };
  let hit = tryRe(COMPLEX);
  if (hit) return [{ kind: "complex", re: toNumber(hit.m[1]), im: toNumber(hit.m[2]) }, hit.end];
  hit = tryRe(IMAG);
  if (hit && hit.m[0].length > 0) return [{ kind: "complex", re: 0, im: toNumber(hit.m[1] ?? "") }, hit.end];
  hit = tryRe(REAL);
  if (hit) return [{ kind: "real", value: toNumber(hit.m[0]), int: /^[+-]?\d+$/.test(hit.m[0]) }, hit.end];
  hit = tryRe(BOOL);
  if (hit) return [{ kind: "bool", value: hit.m[0].toLowerCase() === "true" }, hit.end];
  return null;
}

function skipSep(s: string, i: number): number {
  while (i < s.length && /[\s,]/.test(s[i])) i++;
  return i;
}

/** Parse the list whose `[` is at `i`. */
function readList(s: string, i: number): [Node, number] {
  const at = i;
  const items: Node[] = [];
  i++;
  for (;;) {
    i = skipSep(s, i);
    if (i >= s.length) throw new ParseError("Unclosed [ - the array ends before its closing bracket.", at);
    const c = s[i];
    if (c === "]") return [{ t: "list", items, at }, i + 1];
    if (c === "[") {
      const [node, next] = readList(s, i);
      items.push(node);
      i = next;
      continue;
    }
    if (s.startsWith("...", i) || c === "\u2026") {
      items.push({ t: "skip", at: i });
      i += c === "\u2026" ? 1 : 3;
      continue;
    }
    if (c === "(") {
      // Python prints complex list items as (1+2j).
      const close = s.indexOf(")", i);
      const inner = close === -1 ? null : readScalar(s.slice(i + 1, close).trim(), 0);
      if (!inner || inner[1] !== s.slice(i + 1, close).trim().length) throw new ParseError("Could not read the value in parentheses.", i);
      items.push({ t: "leaf", v: inner[0], at: i });
      i = close + 1;
      continue;
    }
    const sc = readScalar(s, i);
    if (!sc) throw new ParseError("Unexpected " + JSON.stringify(s.slice(i, i + 12).split(/[\s,\]]/)[0] || s[i]) + " - expected a number, [ or ].", i);
    items.push({ t: "leaf", v: sc[0], at: i });
    i = sc[1];
  }
}

/* ------------------------------------------------------------- shape input */

/** `torch.Size([..])`, `(32, 3)`, `x.shape = (B, T, D)`. Null when the input is data. */
function readShape(src: string): { shape: DimSize[]; at: number } | null {
  const size = /torch\.Size\s*\(\s*\[([^\]]*)\]\s*\)/.exec(src);
  const tuple = size ? null : /^\s*(?:[A-Za-z_][\w.]*\s*(?:\.shape|\.size\(\s*\))?\s*[=:]\s*)?\(([^()]*)\)\s*$/.exec(src);
  const m = size ?? tuple;
  if (!m) return null;
  const parts = m[1].split(",").map((p) => p.trim());
  if (parts[parts.length - 1] === "") parts.pop(); // `(3,)`
  if (!parts.every((p) => /^(?:\d+|[A-Za-z_][A-Za-z0-9_]*)$/.test(p))) return null;
  // A tuple of plain numbers with decimals or signs is data, not a shape; the
  // pattern above already excludes those.
  return { shape: parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p)), at: m.index };
}

/* -------------------------------------------------------- shape inference */

interface Inferred {
  shape: number[];
  summarized: boolean[];
}

function infer(node: Node): Inferred {
  if (node.t !== "list") return { shape: [], summarized: [] };
  const real = node.items.filter((n) => n.t !== "skip");
  const skipped = real.length !== node.items.length;
  if (!real.length) return { shape: [0], summarized: [skipped] };
  const first = infer(real[0]);
  const isList = real[0].t === "list";
  for (const child of real) {
    if ((child.t === "list") !== isList) throw new ParseError("Ragged array: this level mixes numbers and nested lists.", child.at);
  }
  let summarized = first.summarized.slice();
  for (const child of real.slice(1)) {
    const c = infer(child);
    if (c.shape.join(",") !== first.shape.join(",")) {
      throw new ParseError(
        "Ragged array: expected shape (" + first.shape.join(", ") + ") but this element has shape (" + c.shape.join(", ") + ").",
        child.at,
      );
    }
    summarized = summarized.map((v, k) => v || c.summarized[k]);
  }
  return { shape: [real.length, ...first.shape], summarized: [skipped, ...summarized] };
}

/* -------------------------------------------------------------- formatting */

function sci(x: number, decimals: Decimals): string {
  let exp = Math.floor(Math.log10(Math.abs(x)));
  let mant = x / Math.pow(10, exp);
  let m = decimals === "auto" ? trim(mant.toPrecision(3)) : mant.toFixed(decimals);
  if (Math.abs(Number(m)) >= 10) {
    // 9.999 rounded to 10.0: renormalise.
    exp++;
    mant = x / Math.pow(10, exp);
    m = decimals === "auto" ? trim(mant.toPrecision(3)) : mant.toFixed(decimals);
  }
  return m + " \\times 10^{" + exp + "}";
}

function trim(s: string): string {
  return s.includes(".") && !/e/i.test(s) ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

function formatReal(x: number, int: boolean, o: TensorOptions): string {
  if (Number.isNaN(x)) return "\\mathrm{NaN}";
  if (x === Infinity) return "\\infty";
  if (x === -Infinity) return "-\\infty";
  if (int) return String(x);
  const ax = Math.abs(x);
  if (o.scientific && x !== 0 && (ax >= 1e4 || ax < 1e-3)) return sci(x, o.decimals);
  if (o.decimals !== "auto") return x.toFixed(o.decimals).replace(/^-(0\.?0*)$/, "$1");
  const s = trim(Number(x.toPrecision(6)).toString());
  // Without scientific mode JS may still answer in e-notation for tiny values.
  return /e/i.test(s) ? sci(x, "auto") : s;
}

function formatScalar(v: Scalar, o: TensorOptions): string {
  if (v.kind === "bool") return o.bools === "TF" ? (v.value ? "\\mathrm{T}" : "\\mathrm{F}") : v.value ? "1" : "0";
  if (v.kind === "real") return formatReal(v.value, v.int, o);
  const im = Number.isNaN(v.im) ? "\\mathrm{NaN}" : formatReal(Math.abs(v.im), false, o);
  const imPart = (im === "1" ? "" : im) + "i";
  if (v.re === 0 && !Object.is(v.re, -0)) return (v.im < 0 ? "-" : "") + imPart;
  return formatReal(v.re, false, o) + (v.im < 0 ? " - " : " + ") + imPart;
}

/* ---------------------------------------------------------------- rendering */

function styledName(name: string, rank: number, o: TensorOptions): string {
  const raw = name.trim() || "X";
  if (rank === 0) return raw;
  const m = /^(\\?[A-Za-z]+)(.*)$/.exec(raw);
  if (!m) return raw;
  let base = m[1];
  if (rank === 1 && o.lowercaseVector && !base.startsWith("\\")) base = base.toLowerCase();
  // \mathbf does not bold Greek letters; \boldsymbol does.
  return (base.startsWith("\\") ? "\\boldsymbol{" : "\\mathbf{") + base + "}" + m[2];
}

const PRESETS: Record<Exclude<Convention, "custom">, Record<number, string[]>> = {
  standard: { 1: ["d"], 2: ["m", "n"], 3: ["B", "T", "D"], 4: ["N", "C", "H", "W"], 5: ["N", "C", "D", "H", "W"] },
  alternate: { 1: ["n"], 2: ["N", "D"], 3: ["C", "H", "W"], 4: ["N", "H", "W", "C"], 5: ["N", "D", "H", "W", "C"] },
};

/** Dimension names, so callers can show what a preset means for a given rank. */
export function dimNames(rank: number, o: Pick<TensorOptions, "convention" | "customDims">, warnings: string[] = []): string[] {
  if (o.convention === "custom") {
    const custom = o.customDims.split(",").map((d) => d.trim()).filter(Boolean);
    if (custom.length === rank) return custom;
    if (custom.length) warnings.push("Custom dimension names list " + custom.length + " names for a rank-" + rank + " tensor; using defaults.");
  }
  const preset = PRESETS[o.convention === "alternate" ? "alternate" : "standard"][rank];
  return preset ?? Array.from({ length: rank }, (_, k) => "d_{" + (k + 1) + "}");
}

function envOpen(o: TensorOptions, cols: number, colSkips: Set<number>): [string, string] {
  if (o.env === "array") {
    const spec = Array.from({ length: cols }, (_, k) => (colSkips.has(k) ? "c" : "r")).join("");
    return ["\\left[\\begin{array}{" + spec + "}", "\\end{array}\\right]"];
  }
  return ["\\begin{" + o.env + "}", "\\end{" + o.env + "}"];
}

/** Render one 2D (or 1D) node as a matrix environment. */
function renderMatrix(node: Node, rank: number, o: TensorOptions): { tex: string; cols: number } {
  let rows: string[][];
  let colSkips = new Set<number>();
  if (rank === 1) {
    const cells = (node as { items: Node[] }).items.map((n) => (n.t === "leaf" ? formatScalar(n.v, o) : n.t === "skip" ? null : ""));
    if (o.vector === "column") rows = cells.map((c) => [c ?? "\\vdots"]);
    else rows = [cells.map((c) => c ?? "\\cdots")];
  } else {
    const items = (node as { items: Node[] }).items;
    const firstRow = items.find((n) => n.t === "list") as { items: Node[] } | undefined;
    if (firstRow) firstRow.items.forEach((n, k) => n.t === "skip" && colSkips.add(k));
    const width = firstRow ? firstRow.items.length : 0;
    rows = items.map((r) =>
      r.t === "list"
        ? r.items.map((n) => (n.t === "leaf" ? formatScalar(n.v, o) : "\\cdots"))
        : Array.from({ length: width }, (_, k) => (colSkips.has(k) ? "\\ddots" : "\\vdots")),
    );
  }
  if (rank === 1 && o.vector === "column") colSkips = new Set();
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const [open, close] = envOpen(o, cols, colSkips);
  const body = rows.map((r) => r.join(" & ")).join(" \\\\ ");
  const t = rank === 1 && o.vector === "transpose" ? "^{\\top}" : "";
  return { tex: open + " " + body + " " + close + t, cols };
}

function fieldFor(leaves: Scalar[], o: TensorOptions): string {
  const choice =
    o.field !== "auto"
      ? o.field
      : leaves.some((v) => v.kind === "complex")
        ? "C"
        : leaves.length && leaves.every((v) => v.kind === "bool")
          ? "B"
          : "R";
  return { R: "\\mathbb{R}", C: "\\mathbb{C}", Z: "\\mathbb{Z}", B: "\\{0,1\\}" }[choice];
}

function collectLeaves(node: Node, out: Scalar[]): Scalar[] {
  if (node.t === "leaf") out.push(node.v);
  else if (node.t === "list") node.items.forEach((n) => collectLeaves(n, out));
  return out;
}

function annotation(nameTex: string, field: string, shape: DimSize[], dims: string[], o: TensorOptions, warnings: string[]): string {
  if (!shape.length) return nameTex + " \\in " + field;
  const exp = shape
    .map((size, k) => (o.dimStyle === "numbers" && typeof size === "number" ? String(size) : typeof size === "string" ? size : dims[k]))
    .join(" \\times ");
  const head = nameTex + " \\in " + field + "^{" + exp + "}";
  if (o.dimStyle === "numbers") return head;
  const sizes: string[] = [];
  const seen = new Map<string, DimSize>();
  shape.forEach((size, k) => {
    if (typeof size !== "number") return;
    const d = dims[k];
    if (seen.has(d)) {
      if (seen.get(d) !== size) warnings.push("Dimension name " + d + " is used for sizes " + seen.get(d) + " and " + size + ".");
      return;
    }
    seen.set(d, size);
    sizes.push(d + " = " + size);
  });
  return sizes.length ? head + ", \\quad " + sizes.join(",\\ ") : head;
}

/** Walk the leading dimensions of a rank >= 3 tensor, yielding labelled 2D slices. */
function slices(node: Node, depth: number, lead: number, dims: string[], prefix: string[], out: Array<{ label: string[]; node: Node | null }>): void {
  if (depth === lead) {
    out.push({ label: prefix, node });
    return;
  }
  const items = (node as { items: Node[] }).items;
  const skipAt = items.findIndex((n) => n.t === "skip");
  items.forEach((child, k) => {
    if (child.t === "skip") {
      out.push({ label: prefix, node: null });
      return;
    }
    // After a `...`, positions are only known from the end: write them as N-1.
    const idx = skipAt !== -1 && k > skipAt ? dims[depth] + "-" + (items.length - k) : String(k);
    slices(child, depth + 1, lead, dims, [...prefix, idx], out);
  });
}

function join(lines: string[]): string {
  if (lines.length <= 1) return lines[0] ?? "";
  return "\\begin{gathered}\n" + lines.join(" \\\\\n") + "\n\\end{gathered}";
}

/**
 * The `[` that opens the data: the first one preceded on its line only by a
 * wrapper such as `array(`, `tensor(` or `x = `. Lines before it (the command
 * that printed the array, say) are skipped.
 */
function arrayStart(src: string): number {
  for (let i = src.indexOf("["); i !== -1; i = src.indexOf("[", i + 1)) {
    const line = src.slice(src.lastIndexOf("\n", i) + 1, i);
    if (/^\s*(?:[A-Za-z_][\w.]*\s*=\s*)?(?:[\w.]*\(\s*)?$/.test(line)) return i;
  }
  return -1;
}

/* --------------------------------------------------------------------- api */

function empty(warnings: string[] = [], error: TensorError | null = null): TensorResult {
  return { latex: "", lines: [], shape: [], dims: [], rank: 0, elements: null, shapeOnly: false, dtype: null, warnings, error };
}

export function tensorToTex(input: string, options: Partial<TensorOptions> = {}): TensorResult {
  const o: TensorOptions = { ...DEFAULT_TENSOR, ...options };
  const warnings: string[] = [];
  // Drop interpreter prompts (`>>> x`) and the `Parameter containing:` banner.
  // Blanked rather than removed, so error offsets still point into the user's text.
  const blank = (m: string) => " ".repeat(m.length);
  const src = input
    .replace(/^[ \t]*(?:>>>|In \[\d*\]:).*$/gm, blank)
    .replace(/^[ \t]*Out\[\d*\]:/gm, blank)
    .replace(/Parameter containing:/g, blank);
  if (!src.trim()) return empty();

  const shapeIn = readShape(src);
  if (shapeIn) {
    const rank = shapeIn.shape.length;
    const preset = dimNames(rank, o, warnings);
    const dims = shapeIn.shape.map((s, k) => (typeof s === "string" ? s : preset[k]));
    const name = styledName(o.name, rank, o);
    const field = fieldFor([], o);
    const lines = [annotation(name, field, shapeIn.shape, dims, { ...o, annotate: true }, warnings)];
    const known = shapeIn.shape.every((s) => typeof s === "number");
    return {
      latex: join(lines),
      lines,
      shape: shapeIn.shape,
      dims,
      rank,
      elements: known ? (shapeIn.shape as number[]).reduce((a, b) => a * b, 1) : null,
      shapeOnly: true,
      dtype: null,
      warnings,
      error: null,
    };
  }

  const dtype = /dtype\s*=\s*(?:torch\.)?([\w]+)/.exec(src)?.[1] ?? null;
  try {
    let root: Node;
    let end: number;
    const bracket = arrayStart(src);
    if (bracket === -1 && src.includes("[")) throw new ParseError("Expected the array to start here.", src.search(/\S/));
    if (bracket !== -1) {
      if (src.slice(0, src.lastIndexOf("\n", bracket) + 1).trim()) warnings.push("Ignored the lines before the array.");
      [root, end] = readList(src, bracket);
    } else {
      // Scalars: `tensor(3.)`, `array(2.5)`, `np.float32(1.0)`, `3.5`.
      const m = /^\s*(?:[\w.]*\(\s*)?/.exec(src)!;
      const sc = readScalar(src, m[0].length);
      if (!sc) throw new ParseError("Could not read a number, a list or a shape here.", m[0].length);
      root = { t: "leaf", v: sc[0], at: m[0].length };
      end = sc[1];
    }
    const rest = src.slice(end).trim();
    if (rest && !/^[,)]/.test(rest)) warnings.push("Ignored text after the array: " + JSON.stringify(rest.slice(0, 30)));

    const { shape: shown, summarized } = infer(root);
    const rank = shown.length;
    const shape: DimSize[] = shown.map((n, k) => (summarized[k] ? null : n));
    if (summarized.some(Boolean)) warnings.push("The printout is summarized (...): sizes of the elided dimensions are unknown. Print with np.set_printoptions(threshold=sys.maxsize) for full sizes.");
    if (shown.includes(0)) warnings.push("The array is empty.");
    if (dtype && /^int|^uint|^long/.test(dtype)) {
      // Integer dtype: every value is an integer even if printed oddly.
      const fix = (n: Node) => {
        if (n.t === "leaf" && n.v.kind === "real" && Number.isFinite(n.v.value) && Number.isInteger(n.v.value)) n.v.int = true;
        if (n.t === "list") n.items.forEach(fix);
      };
      fix(root);
    }

    const dims = dimNames(rank, o, warnings);
    const leaves = collectLeaves(root, []);
    const nameTex = styledName(o.name, rank, o);
    const field = fieldFor(leaves, o);
    const lines: string[] = [];

    if (rank === 0) {
      lines.push(nameTex + " = " + formatScalar((root as { v: Scalar }).v, o));
    } else if (rank <= 2) {
      const { tex, cols } = renderMatrix(root, rank, o);
      if (cols > 10 && o.env !== "array") warnings.push("amsmath matrices allow 10 columns by default: add \\setcounter{MaxMatrixCols}{" + cols + "} to the preamble, or use the array environment.");
      lines.push(nameTex + " = " + tex);
    } else {
      const lead = rank - 2;
      const all: Array<{ label: string[]; node: Node | null }> = [];
      slices(root, 0, lead, dims, [], all);
      let shownSlices = 0;
      for (const s of all) {
        if (shownSlices >= o.maxSlices) break;
        if (!s.node) {
          lines.push("\\vdots");
          continue;
        }
        const sub = (/[_^]/.test(nameTex) ? "{" + nameTex + "}" : nameTex) + "_{" + [...s.label, ":", ":"].join(",") + "}";
        lines.push(sub + " = " + renderMatrix(s.node, 2, o).tex);
        shownSlices++;
      }
      const rest = all.filter((s) => s.node).length - shownSlices;
      if (rest > 0) lines.push("\\vdots \\quad \\text{(" + rest + " more slice" + (rest === 1 ? "" : "s") + ")}");
    }
    if (o.annotate) lines.push(annotation(nameTex, field, shape, dims, o, warnings));

    const known = shape.every((s) => typeof s === "number");
    return {
      latex: join(lines),
      lines,
      shape,
      dims,
      rank,
      elements: known ? (shape as number[]).reduce((a, b) => a * b, 1) : null,
      shapeOnly: false,
      dtype,
      warnings,
      error: null,
    };
  } catch (err) {
    if (err instanceof ParseError) return empty(warnings, { ...locate(src, err.at), message: err.message });
    // Not expected, but the contract is "never throw".
    return empty(warnings, { ...locate(src, 0), message: "Internal error: " + String(err) });
  }
}
