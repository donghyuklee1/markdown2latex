/**
 * shapeSandbox.ts - a symbolic tensor-shape interpreter for straight-line
 * PyTorch / NumPy code, checked against the shape declarations in a paper.
 *
 * The bug this catches is the silent one: the paper says `W_q \in R^{d x d_k}`,
 * the code builds `nn.Linear(D, D)`, and everything still runs because a later
 * reshape happens to absorb the difference. There is deliberately no Python
 * runtime here (no WASM, no eval): a small Python-subset parser feeds an
 * interpreter whose only values are shapes, which is enough for the code people
 * actually paste next to a methods section.
 *
 * Three parts:
 *   1. `runCode`              - lex, parse and shape-evaluate the code.
 *   2. `extractDeclarations`  - `X \in \mathbb{R}^{n \times d}` from LaTeX.
 *   3. `analyzeSandbox`       - match code variables to LaTeX symbols, bind
 *      LaTeX dimension symbols (`d = 512`) and check equations like `Q = XW_q`.
 *
 * Pure: no DOM, no I/O. Never throws - malformed code is reported per line and
 * evaluation continues with the next statement.
 */
import { tokenize } from "../cleaner";

/* ------------------------------------------------------------------- types */

/** One axis: an int when known, a name when symbolic (or both: `B` = 32). */
export interface Dim {
  value: number | null;
  name: string | null;
}

export type Shape = Dim[];

export interface CodeVariable {
  name: string;
  kind: "tensor" | "int" | "layer";
  /** Tensor shape; for an int, the one-element "shape" is the int itself. */
  dims: Shape | null;
  /** Human text: `(32, 128, 512)`, `= 64`, `Linear(512 -> 512)`. */
  shape: string;
  /** Line of the latest assignment. */
  line: number;
}

export interface CodeError {
  line: number;
  message: string;
  severity: "error" | "warning";
}

export interface LatexBlock {
  /** Math source, without delimiters. */
  text: string;
  /** 1-indexed line where `text` starts, or null when it has no home line. */
  line: number | null;
}

export interface LatexDeclaration {
  /** LaTeX of the symbol, for rendering: `\mathbf{W}_q`. */
  latex: string;
  /** Normalized name: `W_q`. */
  name: string;
  /** Matching key: lower-case alphanumerics, `wq`. */
  key: string;
  field: string;
  dims: Shape;
  line: number | null;
}

export type CheckStatus = "match" | "mismatch" | "unknown";

export interface ShapeCheck {
  latexSymbol: string;
  latexName: string;
  codeVar: string | null;
  latexShape: string;
  codeShape: string;
  status: CheckStatus;
  note: string;
  line: number | null;
}

export interface Binding {
  symbol: string;
  /** The value used for comparisons: the most common, ties to the first seen. */
  value: number;
  values: Array<{ value: number; source: string }>;
  conflict: boolean;
}

export interface EquationCheck {
  latex: string;
  line: number | null;
  lhsShape: string;
  rhsShape: string;
  status: CheckStatus;
  note: string;
}

export interface SandboxResult {
  variables: CodeVariable[];
  errors: CodeError[];
  declarations: LatexDeclaration[];
  checks: ShapeCheck[];
  bindings: Binding[];
  equationChecks: EquationCheck[];
}

/* ------------------------------------------------------------------- dims */

const TIMES = "\u00d7";

const ONE: Dim = { value: 1, name: null };
const known = (value: number, name: string | null = null): Dim => ({ value, name });
const sym = (name: string): Dim => ({ value: null, name });

/** true / false when decidable, null when one side is symbolic and unrelated. */
function dimEq(a: Dim, b: Dim): boolean | null {
  if (a.value !== null && b.value !== null) return a.value === b.value;
  if (a.name !== null && b.name !== null && a.name === b.name) return true;
  return null;
}

const isOne = (d: Dim) => d.value === 1;

export function formatDim(d: Dim): string {
  if (d.value !== null) return String(d.value);
  return d.name ?? "?";
}

/** Python-style: `(32, 128, 512)`, `(512,)`, `()`. */
export function formatShape(s: Shape): string {
  if (s.length === 1) return "(" + formatDim(s[0]) + ",)";
  return "(" + s.map(formatDim).join(", ") + ")";
}

/** Maths-style: `n x d` (with a real multiplication sign); a scalar reads "scalar". */
export function formatLatexShape(s: Shape): string {
  if (!s.length) return "scalar";
  return s.map(formatDim).join(" " + TIMES + " ");
}

/** Wrap a compound symbolic name so it composes: `(D // H)`. */
const wrap = (d: Dim) => (d.value !== null ? String(d.value) : /[\s+\-*/]/.test(d.name ?? "") ? "(" + d.name + ")" : d.name ?? "?");

function dimArith(op: string, a: Dim, b: Dim): Dim | "float" {
  if (a.value !== null && b.value !== null) {
    const x = a.value;
    const y = b.value;
    switch (op) {
      case "+": return known(x + y);
      case "-": return known(x - y);
      case "*": return known(x * y);
      case "//": return y === 0 ? "float" : known(Math.floor(x / y));
      case "%": return y === 0 ? "float" : known(((x % y) + y) % y);
      case "/": return y !== 0 && x % y === 0 ? known(x / y) : "float";
      case "**": return y >= 0 ? known(Math.pow(x, y)) : "float";
    }
    return "float";
  }
  if (op === "*" && isOne(a)) return b;
  if (op === "*" && isOne(b)) return a;
  if ((op === "//" || op === "/") && isOne(b)) return a;
  return sym(wrap(a) + " " + op + " " + wrap(b));
}

/* ------------------------------------------------------------------- lexer */

interface Tok {
  t: "name" | "num" | "str" | "op";
  v: string;
  line: number;
}

interface LogicalLine {
  toks: Tok[];
  line: number;
  endLine: number;
  indent: number;
}

const OPS3 = ["**=", "//=", ">>=", "<<=", "..."];
const OPS2 = ["**", "//", "==", "!=", "<=", ">=", "->", "+=", "-=", "*=", "/=", "@=", "%=", "&=", "|=", "^=", ":=", "<<", ">>"];

/**
 * Split source into logical lines: newlines inside brackets and after a
 * backslash continue the line, comments vanish, strings become one token.
 */
function lex(src: string): LogicalLine[] {
  const lines: LogicalLine[] = [];
  let cur: Tok[] = [];
  let curLine = 1;
  let indent = 0;
  let depth = 0;
  let line = 1;
  let atLineStart = true;
  let col = 0;
  let i = 0;
  const n = src.length;
  const end = () => {
    if (cur.length) lines.push({ toks: cur, line: curLine, endLine: line, indent });
    cur = [];
  };
  const push = (t: Tok["t"], v: string) => {
    if (!cur.length) {
      curLine = line;
      indent = col;
    }
    cur.push({ t, v, line });
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      if (depth === 0) end();
      line++;
      i++;
      atLineStart = true;
      col = 0;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") {
      if (atLineStart) col += c === "\t" ? 4 : 1;
      i++;
      continue;
    }
    if (atLineStart) atLineStart = false;
    if (c === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      i += 2;
      line++;
      continue;
    }
    // Strings, with an optional r/b/f/u prefix and triple quotes.
    const pre = /^[rRbBfFuU]{0,2}(['"])/.exec(src.slice(i, i + 3));
    if (pre && (pre[0].length === 1 || /[A-Za-z]/.test(c))) {
      const q = pre[1];
      let j = i + pre[0].length;
      const triple = src.startsWith(q + q, j);
      if (triple) j += 2;
      let body = "";
      while (j < n) {
        if (src[j] === "\\") {
          body += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (triple ? src.startsWith(q + q + q, j) : src[j] === q) break;
        if (src[j] === "\n") {
          if (!triple) break;
          line++;
        }
        body += src[j];
        j++;
      }
      push("str", body);
      i = j + (triple ? 3 : 1);
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 200));
      const w = m ? m[0] : c;
      push("name", w);
      i += w.length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(0[xX][0-9a-fA-F_]+|(\d[\d_]*)?\.?\d*([eE][+-]?\d+)?j?)/.exec(src.slice(i, i + 64));
      const w = m && m[0] ? m[0] : c;
      push("num", w);
      i += w.length;
      continue;
    }
    const op = OPS3.find((o) => src.startsWith(o, i)) ?? OPS2.find((o) => src.startsWith(o, i)) ?? c;
    if (op === "(" || op === "[" || op === "{") depth++;
    if (op === ")" || op === "]" || op === "}") depth = Math.max(0, depth - 1);
    if (op === ";" && depth === 0) {
      end();
      i++;
      continue;
    }
    push("op", op);
    i += op.length;
  }
  end();
  return lines;
}

/* ------------------------------------------------------------------ parser */

type Node =
  | { k: "num"; v: number; int: boolean }
  | { k: "str"; v: string }
  | { k: "name"; id: string }
  | { k: "const"; v: "None" | "True" | "False" }
  | { k: "ellipsis" }
  | { k: "unknown" }
  | { k: "attr"; obj: Node; name: string }
  | { k: "call"; fn: Node; args: Arg[] }
  | { k: "sub"; obj: Node; idx: Node[] }
  | { k: "slice"; lo: Node | null; hi: Node | null; step: Node | null }
  | { k: "bin"; op: string; l: Node; r: Node }
  | { k: "un"; op: string; x: Node }
  | { k: "tuple"; items: Node[] }
  | { k: "list"; items: Node[] };

interface Arg {
  kw: string | null;
  star: boolean;
  value: Node;
}

class ParseError extends Error {}

const COMPARE = new Set(["<", ">", "==", "!=", "<=", ">="]);

/** Recursive descent over one logical line, Python precedence. */
class Parser {
  i = 0;
  constructor(public toks: Tok[]) {}
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "op" && t.v === v;
  }
  isName(v: string) {
    const t = this.peek();
    return !!t && t.t === "name" && t.v === v;
  }
  eat(v: string) {
    if (!this.isOp(v)) throw new ParseError("expected '" + v + "'" + (this.peek() ? " near '" + this.peek()!.v + "'" : " at end of line"));
    this.i++;
  }
  done() {
    return this.i >= this.toks.length;
  }

  /** `a, b, c` - a bare tuple when there is a top-level comma. */
  testlist(): Node {
    const first = this.test();
    if (!this.isOp(",")) return first;
    const items = [first];
    while (this.isOp(",")) {
      this.i++;
      if (this.done() || this.isOp("=") || this.isOp(")")) break;
      items.push(this.test());
    }
    return { k: "tuple", items };
  }

  test(): Node {
    if (this.isName("lambda")) {
      this.skipRest();
      return { k: "unknown" };
    }
    const x = this.orTest();
    if (this.isName("if")) {
      this.i++;
      this.orTest();
      if (this.isName("else")) {
        this.i++;
        this.test();
      }
      return { k: "unknown" };
    }
    return x;
  }

  /** Skip to the end of the current bracket level (lambdas, comprehensions). */
  skipRest() {
    let depth = 0;
    while (!this.done()) {
      const t = this.peek()!;
      if (t.t === "op" && "([{".includes(t.v)) depth++;
      if (t.t === "op" && ")]}".includes(t.v)) {
        if (depth === 0) return;
        depth--;
      }
      if (depth === 0 && t.t === "op" && t.v === ",") return;
      this.i++;
    }
  }

  orTest(): Node {
    let x = this.andTest();
    while (this.isName("or")) {
      this.i++;
      this.andTest();
      x = { k: "unknown" };
    }
    return x;
  }
  andTest(): Node {
    let x = this.notTest();
    while (this.isName("and")) {
      this.i++;
      this.notTest();
      x = { k: "unknown" };
    }
    return x;
  }
  notTest(): Node {
    if (this.isName("not")) {
      this.i++;
      this.notTest();
      return { k: "unknown" };
    }
    return this.comparison();
  }
  comparison(): Node {
    let x = this.bitor();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && COMPARE.has(t.v)) {
        this.i++;
        x = { k: "bin", op: t.v, l: x, r: this.bitor() };
      } else if (this.isName("in") || this.isName("is") || (this.isName("not") && this.peek(1)?.v === "in")) {
        this.i++;
        if (this.isName("not") || this.isName("in")) this.i++;
        this.bitor();
        x = { k: "unknown" };
      } else return x;
    }
  }
  binLevel(ops: string[], next: () => Node): Node {
    let x = next();
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== "op" || !ops.includes(t.v)) return x;
      this.i++;
      x = { k: "bin", op: t.v, l: x, r: next() };
    }
  }
  bitor(): Node {
    return this.binLevel(["|"], () => this.binLevel(["^"], () => this.binLevel(["&"], () => this.binLevel(["<<", ">>"], () => this.arith()))));
  }
  arith(): Node {
    return this.binLevel(["+", "-"], () => this.term());
  }
  term(): Node {
    return this.binLevel(["*", "/", "//", "%", "@"], () => this.factor());
  }
  factor(): Node {
    const t = this.peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+" || t.v === "~")) {
      this.i++;
      return { k: "un", op: t.v, x: this.factor() };
    }
    return this.power();
  }
  power(): Node {
    const base = this.primary();
    if (this.isOp("**")) {
      this.i++;
      return { k: "bin", op: "**", l: base, r: this.factor() };
    }
    return base;
  }
  primary(): Node {
    let x = this.atom();
    for (;;) {
      if (this.isOp(".")) {
        this.i++;
        const t = this.peek();
        if (!t || t.t !== "name") throw new ParseError("expected an attribute name after '.'");
        this.i++;
        x = { k: "attr", obj: x, name: t.v };
      } else if (this.isOp("(")) {
        this.i++;
        x = { k: "call", fn: x, args: this.args() };
      } else if (this.isOp("[")) {
        this.i++;
        const idx: Node[] = [];
        while (!this.isOp("]")) {
          idx.push(this.subscriptItem());
          if (this.isOp(",")) this.i++;
          else break;
        }
        this.eat("]");
        x = { k: "sub", obj: x, idx };
      } else return x;
    }
  }
  subscriptItem(): Node {
    const part = () => (this.isOp(":") || this.isOp("]") || this.isOp(",") ? null : this.test());
    const lo = part();
    if (!this.isOp(":")) {
      if (!lo) throw new ParseError("empty subscript");
      return lo;
    }
    this.i++;
    const hi = part();
    let step: Node | null = null;
    if (this.isOp(":")) {
      this.i++;
      step = part();
    }
    return { k: "slice", lo, hi, step };
  }
  args(): Arg[] {
    const out: Arg[] = [];
    while (!this.isOp(")")) {
      if (this.done()) throw new ParseError("unclosed '('");
      if (this.isOp("*") || this.isOp("**")) {
        const dbl = this.peek()!.v === "**";
        this.i++;
        const value = this.test();
        if (!dbl) out.push({ kw: null, star: true, value });
      } else if (this.peek()?.t === "name" && this.isOp("=", 1)) {
        const kw = this.peek()!.v;
        this.i += 2;
        out.push({ kw, star: false, value: this.test() });
      } else {
        const value = this.test();
        if (this.isName("for")) {
          this.skipRest();
          out.push({ kw: null, star: false, value: { k: "unknown" } });
        } else out.push({ kw: null, star: false, value });
      }
      if (this.isOp(",")) this.i++;
      else break;
    }
    this.eat(")");
    return out;
  }
  atom(): Node {
    const t = this.peek();
    if (!t) throw new ParseError("unexpected end of line");
    this.i++;
    if (t.t === "num") {
      const raw = t.v.replace(/_/g, "");
      if (/j$/.test(raw)) return { k: "num", v: 0, int: false };
      const v = Number(raw);
      return { k: "num", v: isFinite(v) ? v : 0, int: /^(0[xX][0-9a-fA-F]+|\d+)$/.test(raw) };
    }
    if (t.t === "str") {
      let v = t.v;
      while (this.peek()?.t === "str") v += this.toks[this.i++].v;
      return { k: "str", v };
    }
    if (t.t === "name") {
      if (t.v === "None" || t.v === "True" || t.v === "False") return { k: "const", v: t.v };
      return { k: "name", id: t.v };
    }
    if (t.v === "...") return { k: "ellipsis" };
    if (t.v === "(" || t.v === "[") {
      const close = t.v === "(" ? ")" : "]";
      const items: Node[] = [];
      let trailingComma = false;
      while (!this.isOp(close)) {
        if (this.done()) throw new ParseError("unclosed '" + t.v + "'");
        if (this.isOp("*")) this.i++;
        items.push(this.test());
        if (this.isName("for")) {
          this.skipRest();
          this.eat(close);
          return { k: "unknown" };
        }
        trailingComma = false;
        if (this.isOp(",")) {
          this.i++;
          trailingComma = true;
        } else break;
      }
      this.eat(close);
      if (t.v === "(" && items.length === 1 && !trailingComma) return items[0];
      return t.v === "(" ? { k: "tuple", items } : { k: "list", items };
    }
    if (t.v === "{") {
      let depth = 1;
      while (!this.done() && depth) {
        const u = this.toks[this.i++];
        if (u.t === "op" && "([{".includes(u.v)) depth++;
        if (u.t === "op" && ")]}".includes(u.v)) depth--;
      }
      return { k: "unknown" };
    }
    throw new ParseError("unexpected '" + t.v + "'");
  }
}

/* ------------------------------------------------------------------ values */

type Layer =
  | { kind: "linear"; inF: Dim; outF: Dim }
  | { kind: "conv2d"; cin: Dim; cout: Dim; k: [Dim, Dim]; s: [Dim, Dim]; p: [Dim, Dim]; d: [Dim, Dim] }
  | { kind: "embedding"; num: Dim; dim: Dim }
  | { kind: "norm"; shape: Shape; label: string }
  | { kind: "same"; label: string }
  | { kind: "flatten"; start: number; end: number }
  | { kind: "seq"; layers: Layer[] };

type Lib = "torch" | "np";

type Val =
  | { t: "dim"; d: Dim; free?: boolean }
  | { t: "num" }
  | { t: "bool"; v: boolean | null }
  | { t: "tensor"; shape: Shape; lib: Lib; pair?: boolean }
  | { t: "tuple"; items: Val[] }
  | { t: "str"; v: string }
  | { t: "none" }
  | { t: "ellipsis" }
  | { t: "slice"; lo: Val; hi: Val; step: Val }
  | { t: "layer"; layer: Layer }
  | { t: "ref"; path: string }
  | { t: "method"; obj: Val; name: string }
  | { t: "unknown" };

const UNKNOWN: Val = { t: "unknown" };
const tensor = (shape: Shape, lib: Lib = "torch"): Val => ({ t: "tensor", shape, lib });

/** Canonical names for module paths, so `numpy.zeros` and `np.zeros` agree. */
function canon(path: string): string {
  // Work on `path.` so a bare module (`torch.nn.functional`) maps like its members.
  return (path + ".")
    .replace(/^torch\.nn\.functional\./, "F.")
    .replace(/^torch\.nn\./, "nn.")
    .replace(/^(numpy|jax\.numpy)\./, "np.")
    .slice(0, -1);
}

function layerLabel(l: Layer): string {
  switch (l.kind) {
    case "linear": return "Linear(" + formatDim(l.inF) + " -> " + formatDim(l.outF) + ")";
    case "conv2d": return "Conv2d(" + formatDim(l.cin) + " -> " + formatDim(l.cout) + ", k=" + formatDim(l.k[0]) + ")";
    case "embedding": return "Embedding(" + formatDim(l.num) + ", " + formatDim(l.dim) + ")";
    case "norm": return l.label + "(" + l.shape.map(formatDim).join(", ") + ")";
    case "same": return l.label;
    case "flatten": return "Flatten(" + l.start + ", " + l.end + ")";
    case "seq": return "Sequential(" + l.layers.map(layerLabel).join(", ") + ")";
  }
}

/** Shape of the parameter a layer holds, in the maths convention `x W`. */
function layerMathShape(l: Layer): { math: Shape; stored: Shape } | null {
  if (l.kind === "linear") return { math: [l.inF, l.outF], stored: [l.outF, l.inF] };
  if (l.kind === "conv2d") return { math: [l.cout, l.cin, l.k[0], l.k[1]], stored: [l.cout, l.cin, l.k[0], l.k[1]] };
  if (l.kind === "embedding") return { math: [l.num, l.dim], stored: [l.num, l.dim] };
  return null;
}

/* ------------------------------------------------------------- shape rules */

type R = { shape: Shape } | { error: string };

function broadcast(a: Shape, b: Shape, op: string): R {
  const n = Math.max(a.length, b.length);
  const out: Shape = [];
  for (let i = 1; i <= n; i++) {
    const da = a[a.length - i];
    const db = b[b.length - i];
    if (!da) out.unshift(db);
    else if (!db) out.unshift(da);
    else {
      const eq = dimEq(da, db);
      if (eq) out.unshift(da.value !== null ? da : db);
      else if (isOne(da)) out.unshift(db);
      else if (isOne(db)) out.unshift(da);
      else if (eq === false)
        return { error: op + ": cannot broadcast " + formatShape(a) + " with " + formatShape(b) + " - dim " + -i + ": " + formatDim(da) + " vs " + formatDim(db) };
      else out.unshift(da.value !== null ? da : db);
    }
  }
  return { shape: out };
}

function matmul(a: Shape, b: Shape, label = "matmul", sep = "@"): R {
  if (!a.length || !b.length) return { error: label + ": both operands need at least one dimension, got " + formatShape(a) + " " + sep + " " + formatShape(b) };
  const A = a.length === 1 ? [ONE, a[0]] : a;
  const B = b.length === 1 ? [b[0], ONE] : b;
  const inA = A[A.length - 1];
  const inB = B[B.length - 2];
  if (dimEq(inA, inB) === false)
    return { error: label + ": " + formatShape(a) + " " + sep + " " + formatShape(b) + " - inner dims " + formatDim(inA) + " vs " + formatDim(inB) };
  const batch = broadcast(A.slice(0, -2), B.slice(0, -2), label + " batch");
  if ("error" in batch) return { error: label + ": batch dims of " + formatShape(a) + " and " + formatShape(b) + " do not broadcast" };
  const out = [...batch.shape];
  if (a.length > 1) out.push(A[A.length - 2]);
  if (b.length > 1) out.push(B[B.length - 1]);
  return { shape: out };
}

function npDot(a: Shape, b: Shape): R {
  if (a.length <= 2 && b.length <= 2) return matmul(a, b, "dot", "\u00b7");
  if (b.length < 2) return matmul(a, b, "dot");
  const inA = a[a.length - 1];
  const inB = b[b.length - 2];
  if (dimEq(inA, inB) === false) return { error: "dot: " + formatShape(a) + " \u00b7 " + formatShape(b) + " - inner dims " + formatDim(inA) + " vs " + formatDim(inB) };
  return { shape: [...a.slice(0, -1), ...b.slice(0, -2), b[b.length - 1]] };
}

function einsum(spec: string, ops: Shape[]): R {
  const s = spec.replace(/\s+/g, "");
  const [lhs, rhs] = s.split("->");
  const terms = lhs.split(",");
  if (terms.length !== ops.length) return { error: "einsum: '" + spec + "' names " + terms.length + " operand(s) but " + ops.length + " were given" };
  const bind = new Map<string, { d: Dim; op: number }>();
  let ell: Shape | null = null;
  for (let o = 0; o < terms.length; o++) {
    const term = terms[o];
    const hasEll = term.includes("...");
    const letters = term.replace("...", "").split("");
    const shape = ops[o];
    if (hasEll ? letters.length > shape.length : letters.length !== shape.length)
      return { error: "einsum: operand " + (o + 1) + " " + formatShape(shape) + " has " + shape.length + " dims but '" + term + "' names " + letters.length };
    const nEll = shape.length - letters.length;
    const before = hasEll ? term.indexOf("...") : letters.length;
    const ellDims = shape.slice(before, before + nEll);
    const rest = [...shape.slice(0, before), ...shape.slice(before + nEll)];
    if (hasEll) {
      if (ell === null) ell = ellDims;
      else {
        const r = broadcast(ell, ellDims, "einsum ...");
        if ("error" in r) return r;
        ell = r.shape;
      }
    }
    for (let j = 0; j < letters.length; j++) {
      const L = letters[j];
      const d = rest[j];
      const prev = bind.get(L);
      if (!prev) bind.set(L, { d, op: o });
      else if (dimEq(prev.d, d) === false && !isOne(prev.d) && !isOne(d))
        return { error: "einsum: '" + L + "' is " + formatDim(prev.d) + " in operand " + (prev.op + 1) + " but " + formatDim(d) + " in operand " + (o + 1) };
      else if (prev.d.value === null && d.value !== null) bind.set(L, { d, op: o });
    }
  }
  let outSpec = rhs;
  if (outSpec === undefined) {
    const counts = new Map<string, number>();
    for (const t of terms) for (const L of t.replace("...", "")) counts.set(L, (counts.get(L) ?? 0) + 1);
    outSpec = (ell ? "..." : "") + [...counts].filter(([, c]) => c === 1).map(([L]) => L).sort().join("");
  }
  const out: Shape = [];
  const outEll = outSpec.includes("...");
  const pre = outEll ? outSpec.slice(0, outSpec.indexOf("...")) : outSpec;
  const post = outEll ? outSpec.slice(outSpec.indexOf("...") + 3) : "";
  for (const L of pre + (outEll ? "\u0000" : "") + post) {
    if (L === "\u0000") {
      out.push(...(ell ?? []));
      continue;
    }
    const b = bind.get(L);
    if (!b) return { error: "einsum: output index '" + L + "' does not appear in any input" };
    out.push(b.d);
  }
  return { shape: out };
}

function normAxis(ax: number, rank: number, what: string, shape: Shape): number | string {
  const a = ax < 0 ? ax + rank : ax;
  if (a < 0 || a >= rank) return what + ": dim " + ax + " out of range for " + formatShape(shape);
  return a;
}

function product(s: Shape): Dim {
  let acc: Dim = ONE;
  for (const d of s) {
    const r = dimArith("*", acc, d);
    acc = r === "float" ? sym("?") : r;
  }
  return acc;
}

/** reshape/view with one optional -1, symbolic factors cancelled by name. */
function reshape(src: Shape, target: Shape, label: string): R {
  const holes = target.filter((d) => d.value === -1).length;
  if (holes > 1) return { error: label + ": only one dimension can be -1" };
  const fixed = target.filter((d) => d.value !== -1);
  const a = [...src];
  const b = [...fixed];
  // Cancel factors that are the same on both sides, by value or by name.
  for (let i = b.length - 1; i >= 0; i--) {
    const j = a.findIndex((d) => dimEq(d, b[i]) === true);
    if (j >= 0) {
      a.splice(j, 1);
      b.splice(i, 1);
    }
  }
  const allKnown = (s: Shape) => s.every((d) => d.value !== null);
  const prodKnown = (s: Shape) => s.reduce((p, d) => p * (d.value ?? 1), 1);
  const count = (s: Shape) => (allKnown(s) ? String(prodKnown(s)) : "?");
  const elements = (s: Shape) => (allKnown(s) ? " (" + prodKnown(s) + " elements)" : "");
  const out = target.map((d) => d);
  if (allKnown(a) && allKnown(b)) {
    const P = prodKnown(a);
    const Q = prodKnown(b);
    if (holes) {
      if (Q === 0 || P % Q !== 0)
        return { error: label + ": cannot infer -1 - " + formatShape(src) + elements(src) + " is not divisible by " + count(fixed) + " elements of " + formatShape(target) };
      out[out.findIndex((d) => d.value === -1)] = known(P / Q);
    } else if (P !== Q) {
      return { error: label + ": cannot view " + formatShape(src) + elements(src) + " as " + formatShape(target) + elements(target) };
    }
    return { shape: out };
  }
  if (holes) {
    const rest = allKnown(b) ? product(a) : sym("?");
    const q = prodKnown(b);
    const inferred = q === 1 ? rest : dimArith("//", rest, known(q));
    out[out.findIndex((d) => d.value === -1)] = inferred === "float" ? sym("?") : inferred;
  }
  return { shape: out };
}

function sliceLen(dim: Dim, lo: Val, hi: Val, step: Val): Dim {
  const num = (v: Val) => (v.t === "dim" ? v.d : null);
  const L = num(lo);
  const H = num(hi);
  const S = num(step);
  const s = S?.value ?? 1;
  if (S && S.value === null) return sym("?");
  if (dim.value !== null && (!L || L.value !== null) && (!H || H.value !== null)) {
    const n = dim.value;
    const clamp = (x: number) => (x < 0 ? Math.max(0, x + n) : Math.min(x, n));
    if (s > 0) {
      const a = L ? clamp(L.value!) : 0;
      const b = H ? clamp(H.value!) : n;
      return known(Math.max(0, Math.ceil((b - a) / s)));
    }
    const a = L ? Math.min(clamp(L.value!), n - 1) : n - 1;
    const b = H ? clamp(H.value!) : -1;
    return known(Math.max(0, Math.ceil((a - b) / -s)));
  }
  if (!L && !H) return s === 1 ? dim : sym(wrap(dim) + " / " + s);
  if (!L && H && (H.value === null || H.value >= 0)) return s === 1 ? H : sym("?");
  if (L && !H && s === 1) {
    const r = dimArith("-", dim, L);
    return r === "float" ? sym("?") : r;
  }
  return sym("?");
}

/* ------------------------------------------------------------- interpreter */

const BLOCKS = new Set(["def", "class", "for", "while", "if", "with", "try", "async", "match"]);
const CONTINUATIONS = new Set(["elif", "else", "except", "finally", "case"]);
const IGNORED = new Set(["pass", "return", "assert", "raise", "del", "global", "nonlocal", "yield", "break", "continue"]);

const SAME_FNS = new Set([
  "relu", "gelu", "silu", "elu", "selu", "leaky_relu", "tanh", "sigmoid", "softplus", "mish", "hardtanh", "relu6",
  "softmax", "log_softmax", "dropout", "layer_norm", "normalize", "group_norm", "batch_norm", "instance_norm",
  "exp", "log", "log1p", "expm1", "sqrt", "rsqrt", "abs", "sin", "cos", "tan", "square", "neg", "sign", "floor", "ceil", "round",
  "clamp", "clip", "erf", "reciprocal", "nan_to_num", "tril", "triu", "cumsum", "cumprod", "flip", "roll", "sort", "isnan", "isinf",
  "logical_not", "real", "imag", "conj", "angle", "fft",
]);
const SAME_METHODS = new Set([
  ...SAME_FNS,
  "float", "double", "half", "bfloat16", "long", "int", "bool", "to", "cuda", "cpu", "detach", "contiguous", "clone", "numpy",
  "type_as", "astype", "copy", "requires_grad_", "relu_", "zero_", "fill_", "normal_", "uniform_", "add_", "mul_", "sub_", "div_", "pin_memory",
  "masked_fill_", "detach_",
]);
const SAME_LAYERS = new Set([
  "ReLU", "GELU", "SiLU", "ELU", "Tanh", "Sigmoid", "Softmax", "LogSoftmax", "Dropout", "Dropout2d", "Identity", "LeakyReLU", "Mish", "Softplus",
  "BatchNorm1d", "BatchNorm2d", "GroupNorm", "InstanceNorm2d",
]);
const REDUCE = new Set(["sum", "mean", "max", "min", "prod", "std", "var", "argmax", "argmin", "amax", "amin", "norm", "logsumexp", "all", "any", "median", "nansum", "nanmean"]);
const CREATE = new Set(["randn", "rand", "zeros", "ones", "empty", "full"]);

class Interp {
  env = new Map<string, Val>();
  errors: CodeError[] = [];
  vars = new Map<string, CodeVariable>();
  line = 1;

  constructor() {
    for (const [k, v] of [["torch", "torch"], ["np", "np"], ["numpy", "np"], ["nn", "nn"], ["F", "F"], ["math", "math"], ["jnp", "np"]] as const)
      this.env.set(k, { t: "ref", path: v });
  }

  fail(message: string): Val {
    this.errors.push({ line: this.line, message, severity: "error" });
    return UNKNOWN;
  }
  warn(message: string) {
    this.errors.push({ line: this.line, message, severity: "warning" });
  }

  run(src: string) {
    const lines = lex(src);
    let skipIndent = -1;
    for (const ll of lines) {
      this.line = ll.line;
      if (skipIndent >= 0) {
        if (ll.indent > skipIndent) continue;
        skipIndent = -1;
      }
      const head = ll.toks[0];
      if (head.t === "op" && head.v === "@") continue; // decorator
      if (head.t === "name" && (head.v === "import" || head.v === "from")) {
        this.imports(ll.toks);
        continue;
      }
      if (head.t === "name" && (BLOCKS.has(head.v) || CONTINUATIONS.has(head.v)) && !this.isAssignment(ll.toks)) {
        if (BLOCKS.has(head.v)) {
          const blockEnd = this.blockEnd(lines, ll);
          this.warn("'" + head.v + "' blocks are not supported - skipped" + (blockEnd > ll.line ? " lines " + ll.line + "-" + blockEnd : "") + "; straight-line code only");
        }
        skipIndent = ll.indent;
        continue;
      }
      if (head.t === "name" && IGNORED.has(head.v)) continue;
      try {
        this.statement(new Parser(ll.toks));
      } catch (e) {
        if (e instanceof ParseError) this.fail("syntax: " + e.message);
        else this.fail("could not evaluate this line");
      }
    }
  }

  isAssignment(toks: Tok[]) {
    return toks[1]?.t === "op" && (toks[1].v === "=" || toks[1].v === ".");
  }

  blockEnd(lines: LogicalLine[], start: LogicalLine): number {
    let last = start.endLine;
    for (const l of lines) {
      if (l.line <= start.line) continue;
      if (l.indent <= start.indent) break;
      last = l.endLine;
    }
    return last;
  }

  /** `import numpy as np`, `import torch.nn.functional as F`, `from torch import nn`. */
  imports(toks: Tok[]) {
    const words = toks.map((t) => t.v);
    if (words[0] === "import") {
      const parts = words.slice(1).join(" ").split(",");
      for (const p of parts) {
        const m = /^\s*([\w. ]+?)(?:\s+as\s+(\w+))?\s*$/.exec(p.replace(/ \. /g, "."));
        if (!m) continue;
        const path = m[1].replace(/\s+/g, "");
        // `import torch.nn` binds `torch`; `import torch.nn as nn` binds the full path.
        const target = m[2] ? path : path.split(".")[0];
        this.env.set(m[2] ?? target, { t: "ref", path: canon(target) });
      }
    } else {
      const idx = words.indexOf("import");
      if (idx < 0) return;
      const mod = words.slice(1, idx).join("");
      const names = words.slice(idx + 1).filter((w) => w !== "(" && w !== ")").join(" ").split(",");
      for (const nm of names) {
        const m = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(nm);
        if (!m) continue;
        const path = canon(mod + "." + m[1]);
        this.env.set(m[2] ?? m[1], { t: "ref", path });
      }
    }
  }

  statement(p: Parser) {
    const first = p.testlist();
    if (p.done()) {
      this.eval(first);
      return;
    }
    if (p.isOp(":")) {
      // Annotated assignment: `x: Tensor = ...`
      p.i++;
      p.test();
      if (p.done()) return;
    }
    const t = p.peek()!;
    if (t.t === "op" && /^(\+|-|\*|\/|\/\/|@|%|\*\*)=$/.test(t.v)) {
      p.i++;
      const rhs = p.testlist();
      const val = this.eval({ k: "bin", op: t.v.slice(0, -1), l: first, r: rhs });
      this.assign(first, val);
      return;
    }
    if (t.t === "op" && t.v === "=") {
      const targets = [first];
      let value: Node = first;
      while (p.isOp("=")) {
        p.i++;
        value = p.testlist();
        targets.push(value);
      }
      if (!p.done()) throw new ParseError("unexpected '" + p.peek()!.v + "'");
      targets.pop();
      const v = this.eval(value);
      for (const target of targets) this.assign(target, v);
      return;
    }
    throw new ParseError("unexpected '" + t.v + "'");
  }

  dotted(n: Node): string | null {
    if (n.k === "name") return n.id;
    if (n.k === "attr") {
      const base = this.dotted(n.obj);
      return base ? base + "." + n.name : null;
    }
    return null;
  }

  assign(target: Node, v: Val) {
    if (target.k === "tuple" || target.k === "list") {
      const items = this.unpack(v, target.items.length);
      target.items.forEach((t, i) => this.assign(t, items ? items[i] : UNKNOWN));
      return;
    }
    const name = this.dotted(target);
    if (!name) return; // subscript assignment: shape is unchanged
    let val = v;
    if (val.t === "dim" && val.d.value !== null) val = { t: "dim", d: known(val.d.value, name) };
    this.env.set(name, val);
    this.record(name, val);
  }

  record(name: string, v: Val) {
    const prev = this.vars.get(name);
    let entry: CodeVariable | null = null;
    if (v.t === "tensor") entry = { name, kind: "tensor", dims: v.shape, shape: formatShape(v.shape), line: this.line };
    else if (v.t === "dim") entry = { name, kind: "int", dims: [v.d], shape: "= " + formatDim(v.d), line: this.line };
    else if (v.t === "layer") {
      const m = layerMathShape(v.layer);
      entry = { name, kind: "layer", dims: m ? m.math : null, shape: layerLabel(v.layer), line: this.line };
    }
    if (entry) {
      // Keep first-seen order but the latest shape.
      if (prev) this.vars.delete(name);
      this.vars.set(name, entry);
    } else if (prev) this.vars.delete(name);
  }

  unpack(v: Val, n: number): Val[] | null {
    if (v.t === "tuple") {
      if (v.items.length !== n) {
        this.fail("unpack: expected " + n + " values, got " + v.items.length);
        return null;
      }
      return v.items;
    }
    if (v.t === "tensor") {
      if (v.pair && n === 2) return [{ ...v, pair: false }, { ...v, pair: false }];
      if (!v.shape.length) {
        this.fail("unpack: cannot iterate over a 0-d tensor");
        return null;
      }
      const d0 = v.shape[0];
      if (d0.value !== null && d0.value !== n) {
        this.fail("unpack: expected " + n + " values, but the first dim of " + formatShape(v.shape) + " is " + d0.value);
        return null;
      }
      return Array.from({ length: n }, () => tensor(v.shape.slice(1), v.lib));
    }
    return null;
  }

  /* ---- evaluation */

  eval(n: Node): Val {
    switch (n.k) {
      case "num":
        return n.int ? { t: "dim", d: known(n.v) } : { t: "num" };
      case "str":
        return { t: "str", v: n.v };
      case "const":
        return n.v === "None" ? { t: "none" } : { t: "bool", v: n.v === "True" };
      case "ellipsis":
        return { t: "ellipsis" };
      case "unknown":
        return UNKNOWN;
      case "name": {
        const v = this.env.get(n.id);
        if (v) return v;
        // An unassigned name is a symbolic dimension: `torch.randn(B, T, D)`.
        return { t: "dim", d: sym(n.id), free: true };
      }
      case "tuple":
      case "list":
        return { t: "tuple", items: n.items.map((x) => this.eval(x)) };
      case "slice":
        return {
          t: "slice",
          lo: n.lo ? this.eval(n.lo) : { t: "none" },
          hi: n.hi ? this.eval(n.hi) : { t: "none" },
          step: n.step ? this.eval(n.step) : { t: "none" },
        };
      case "un": {
        const x = this.eval(n.x);
        if (x.t === "dim" && n.op === "-") return { t: "dim", d: x.d.value !== null ? known(-x.d.value) : sym("-" + wrap(x.d)) };
        return x;
      }
      case "bin":
        return this.binop(n.op, this.eval(n.l), this.eval(n.r));
      case "attr":
        return this.attr(n);
      case "sub":
        return this.subscript(this.eval(n.obj), n.idx.map((x) => this.eval(x)));
      case "call":
        return this.call(n);
    }
  }

  binop(op: string, a: Val, b: Val): Val {
    if (a.t === "unknown" || b.t === "unknown") return UNKNOWN;
    const scalar = (v: Val) => v.t === "dim" || v.t === "num" || v.t === "bool";
    if (scalar(a) && scalar(b)) {
      if (COMPARE.has(op)) return { t: "bool", v: null };
      if (a.t === "dim" && b.t === "dim") {
        const r = dimArith(op, a.d, b.d);
        return r === "float" ? { t: "num" } : { t: "dim", d: r };
      }
      return { t: "num" };
    }
    if (a.t === "tuple" && b.t === "tuple" && op === "+") return { t: "tuple", items: [...a.items, ...b.items] };
    if (a.t === "tuple" && b.t === "dim" && op === "*" && b.d.value !== null) return { t: "tuple", items: Array.from({ length: b.d.value }, () => a.items).flat() };
    const shapeOf = (v: Val): Shape | null => (v.t === "tensor" ? v.shape : scalar(v) ? [] : null);
    const sa = shapeOf(a);
    const sb = shapeOf(b);
    if (!sa || !sb) return UNKNOWN;
    const lib: Lib = a.t === "tensor" ? a.lib : b.t === "tensor" ? b.lib : "torch";
    if (op === "@") {
      const r = matmul(sa, sb);
      return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
    }
    const r = broadcast(sa, sb, op === "+" ? "add" : op === "-" ? "sub" : op === "*" ? "mul" : op === "/" || op === "//" ? "div" : "elementwise " + op);
    return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
  }

  attr(n: Extract<Node, { k: "attr" }>): Val {
    const path = this.dotted(n);
    if (path && this.env.has(path)) return this.env.get(path)!;
    const obj = this.eval(n.obj);
    if (obj.t === "ref") return { t: "ref", path: obj.path + "." + n.name };
    if (obj.t === "tensor") {
      const s = obj.shape;
      switch (n.name) {
        case "shape":
          return { t: "tuple", items: s.map((d) => ({ t: "dim", d }) as Val) };
        case "T":
          return tensor([...s].reverse(), obj.lib);
        case "mT":
        case "mH":
          if (s.length < 2) return this.fail(".mT needs at least 2 dims, got " + formatShape(s));
          return tensor([...s.slice(0, -2), s[s.length - 1], s[s.length - 2]], obj.lib);
        case "ndim":
          return { t: "dim", d: known(s.length) };
        case "size":
          if (obj.lib === "np") return { t: "dim", d: product(s) };
          return { t: "method", obj, name: n.name };
        case "values":
        case "indices":
          return obj.pair ? { ...obj, pair: false } : UNKNOWN;
        case "data":
        case "grad":
        case "real":
        case "imag":
          return { ...obj, pair: false };
        case "dtype":
        case "device":
          return UNKNOWN;
      }
      return { t: "method", obj, name: n.name };
    }
    if (obj.t === "layer") {
      const l = obj.layer;
      if (n.name === "weight") {
        const m = layerMathShape(l);
        if (m) return tensor(m.stored);
        if (l.kind === "norm") return tensor(l.shape);
      }
      if (n.name === "bias") {
        if (l.kind === "linear") return tensor([l.outF]);
        if (l.kind === "conv2d") return tensor([l.cout]);
        if (l.kind === "norm") return tensor(l.shape);
      }
      return UNKNOWN;
    }
    if (obj.t === "tuple" || obj.t === "dim") return { t: "method", obj, name: n.name };
    return UNKNOWN;
  }

  subscript(obj: Val, idx: Val[]): Val {
    if (obj.t === "tuple") {
      if (idx.length !== 1) return UNKNOWN;
      const k = idx[0];
      if (k.t === "dim" && k.d.value !== null) {
        const i = k.d.value < 0 ? k.d.value + obj.items.length : k.d.value;
        if (i < 0 || i >= obj.items.length) return this.fail("index " + k.d.value + " out of range for a tuple of length " + obj.items.length);
        return obj.items[i];
      }
      if (k.t === "slice") {
        const num = (v: Val) => (v.t === "dim" && v.d.value !== null ? v.d.value : v.t === "none" ? undefined : NaN);
        const lo = num(k.lo);
        const hi = num(k.hi);
        if (Number.isNaN(lo) || Number.isNaN(hi) || k.step.t !== "none") return UNKNOWN;
        return { t: "tuple", items: obj.items.slice(lo, hi) };
      }
      return UNKNOWN;
    }
    if (obj.t !== "tensor") return UNKNOWN;
    const s = obj.shape;
    const consuming = idx.filter((v) => v.t !== "none" && v.t !== "ellipsis").length;
    if (consuming > s.length) return this.fail("index: too many indices for a tensor of shape " + formatShape(s) + " (" + consuming + " given)");
    const items: Val[] = [];
    for (const v of idx) {
      if (v.t === "ellipsis") for (let j = 0; j < s.length - consuming; j++) items.push({ t: "slice", lo: { t: "none" }, hi: { t: "none" }, step: { t: "none" } });
      else items.push(v);
    }
    const out: Shape = [];
    let axis = 0;
    for (const v of items) {
      if (v.t === "none") {
        out.push(ONE);
        continue;
      }
      const d = s[axis];
      if (v.t === "dim") {
        if (v.d.value !== null && d.value !== null && (v.d.value >= d.value || v.d.value < -d.value))
          return this.fail("index " + v.d.value + " is out of bounds for dim " + axis + " with size " + d.value + " in " + formatShape(s));
      } else if (v.t === "slice") {
        out.push(sliceLen(d, v.lo, v.hi, v.step));
      } else if (v.t === "tensor") {
        out.push(...v.shape);
      } else {
        out.push(sym("?"));
      }
      axis++;
    }
    out.push(...s.slice(axis));
    return tensor(out, obj.lib);
  }

  /* ---- calls */

  call(n: Extract<Node, { k: "call" }>): Val {
    const fn = this.eval(n.fn);
    const pos: Val[] = [];
    const kw = new Map<string, Val>();
    for (const a of n.args) {
      const v = this.eval(a.value);
      if (a.kw) kw.set(a.kw, v);
      else if (a.star && v.t === "tuple") pos.push(...v.items);
      else if (a.star) return UNKNOWN;
      else pos.push(v);
    }
    if (fn.t === "ref") return this.callRef(canon(fn.path), pos, kw);
    if (fn.t === "layer") return this.applyLayer(fn.layer, pos[0] ?? UNKNOWN);
    if (fn.t === "method") return this.method(fn.obj, fn.name, pos, kw);
    if (fn.t === "dim" && fn.free && fn.d.name === "len") {
      const x = pos[0];
      if (x?.t === "tensor") return x.shape.length ? { t: "dim", d: x.shape[0] } : this.fail("len() of a 0-d tensor");
      if (x?.t === "tuple") return { t: "dim", d: known(x.items.length) };
      return UNKNOWN;
    }
    if (fn.t === "dim" && fn.free && (fn.d.name === "int" || fn.d.name === "round")) return pos[0]?.t === "dim" ? pos[0] : pos[0]?.t === "num" ? { t: "dim", d: sym("?") } : UNKNOWN;
    if (fn.t === "dim" && fn.free && (fn.d.name === "tuple" || fn.d.name === "list")) return pos[0]?.t === "tuple" ? pos[0] : UNKNOWN;
    if (fn.t === "dim" && fn.free && fn.d.name === "print") return { t: "none" };
    return UNKNOWN;
  }

  /** Size arguments: varargs `(B, T, D)`, one tuple `((B, T, D))`, or `size=`. */
  sizeArgs(pos: Val[], kw: Map<string, Val>): Shape | null {
    let items = pos;
    const size = kw.get("size") ?? kw.get("shape");
    if (size) items = [size];
    if (items.length === 1 && items[0].t === "tuple") items = items[0].items;
    const out: Shape = [];
    for (const v of items) {
      if (v.t === "dim") out.push(v.d);
      else return null;
    }
    return out;
  }

  intArg(v: Val | undefined): number | null {
    return v && v.t === "dim" && v.d.value !== null ? v.d.value : null;
  }

  dimArg(pos: Val[], kw: Map<string, Val>, i: number, ...names: string[]): Val | undefined {
    for (const nm of names) if (kw.has(nm)) return kw.get(nm);
    return pos[i];
  }

  callRef(path: string, pos: Val[], kw: Map<string, Val>): Val {
    const lib: Lib = path.startsWith("np.") ? "np" : "torch";
    const parts = path.split(".");
    const last = parts[parts.length - 1];

    // Creation.
    if ((path.startsWith("torch.") && CREATE.has(last) && parts.length === 2) || path === "np.random.randn" || path === "np.random.rand") {
      const sizeArgs = last === "full" ? pos.slice(0, 1) : pos;
      const s = this.sizeArgs(sizeArgs, kw);
      return s ? tensor(s, lib) : UNKNOWN;
    }
    if (path === "np.zeros" || path === "np.ones" || path === "np.empty" || path === "np.full") {
      const s = this.sizeArgs(pos.slice(0, 1), kw);
      return s ? tensor(s, "np") : UNKNOWN;
    }
    if (path === "np.random.normal" || path === "np.random.uniform" || path === "np.random.randint" || path === "torch.randint") {
      const size = kw.get("size") ?? (path === "torch.randint" ? pos[pos.length - 1] : pos[2]);
      if (!size) return { t: "num" };
      const s = this.sizeArgs([size], new Map());
      return s ? tensor(s, lib) : UNKNOWN;
    }
    if (/\.(zeros|ones|empty|full|randn|rand)_like$/.test(path)) {
      const x = pos[0];
      return x?.t === "tensor" ? tensor(x.shape, x.lib) : UNKNOWN;
    }
    if (path === "torch.eye" || path === "np.eye" || path === "np.identity") {
      const a = pos[0];
      const b = pos[1] && pos[1].t === "dim" ? pos[1] : a;
      return a?.t === "dim" && b?.t === "dim" ? tensor([a.d, b.d], lib) : UNKNOWN;
    }
    if (path === "torch.arange" || path === "np.arange") {
      if (pos.length === 1 && pos[0].t === "dim") return tensor([pos[0].d], lib);
      if (pos.length === 2 && pos[0].t === "dim" && pos[1].t === "dim") {
        const r = dimArith("-", pos[1].d, pos[0].d);
        return tensor([r === "float" ? sym("?") : r], lib);
      }
      return tensor([sym("?")], lib);
    }
    if (path === "torch.tensor" || path === "np.array" || path === "np.asarray" || path === "torch.as_tensor" || path === "torch.from_numpy" || path === "torch.Tensor") {
      const x = pos[0];
      if (!x) return UNKNOWN;
      if (x.t === "tensor") return tensor(x.shape, lib);
      return this.literalShape(x, lib);
    }

    // Layers.
    if (path === "nn.Linear" || path === "nn.LazyLinear") {
      const inF = this.dimArg(pos, kw, 0, "in_features");
      const outF = this.dimArg(pos, kw, 1, "out_features");
      if (inF?.t !== "dim" || outF?.t !== "dim") return UNKNOWN;
      return { t: "layer", layer: { kind: "linear", inF: inF.d, outF: outF.d } };
    }
    if (path === "nn.Conv2d") {
      const cin = this.dimArg(pos, kw, 0, "in_channels");
      const cout = this.dimArg(pos, kw, 1, "out_channels");
      const pair = (v: Val | undefined, dflt: number): [Dim, Dim] | null => {
        if (!v) return [known(dflt), known(dflt)];
        if (v.t === "dim") return [v.d, v.d];
        if (v.t === "tuple" && v.items.length === 2 && v.items[0].t === "dim" && v.items[1].t === "dim") return [v.items[0].d, v.items[1].d];
        if (v.t === "str") return null; // padding="same"
        return null;
      };
      const k = pair(this.dimArg(pos, kw, 2, "kernel_size"), 1);
      const s = pair(this.dimArg(pos, kw, 3, "stride"), 1);
      const padArg = this.dimArg(pos, kw, 4, "padding");
      let p = pair(padArg, 0);
      const d = pair(this.dimArg(pos, kw, 5, "dilation"), 1);
      if (cin?.t !== "dim" || cout?.t !== "dim" || !k || !s || !d) return UNKNOWN;
      if (!p && padArg?.t === "str" && padArg.v === "same") p = [sym("same"), sym("same")];
      if (!p) p = [known(0), known(0)];
      return { t: "layer", layer: { kind: "conv2d", cin: cin.d, cout: cout.d, k, s, p, d } };
    }
    if (path === "nn.Embedding") {
      const a = this.dimArg(pos, kw, 0, "num_embeddings");
      const b = this.dimArg(pos, kw, 1, "embedding_dim");
      return a?.t === "dim" && b?.t === "dim" ? { t: "layer", layer: { kind: "embedding", num: a.d, dim: b.d } } : UNKNOWN;
    }
    if (path === "nn.LayerNorm" || path === "nn.RMSNorm") {
      const s = this.sizeArgs(pos.slice(0, 1), new Map());
      return { t: "layer", layer: { kind: "norm", shape: s ?? [], label: last } };
    }
    if (path === "nn.Flatten") {
      return { t: "layer", layer: { kind: "flatten", start: this.intArg(this.dimArg(pos, kw, 0, "start_dim")) ?? 1, end: this.intArg(this.dimArg(pos, kw, 1, "end_dim")) ?? -1 } };
    }
    if (path === "nn.Sequential") {
      const layers: Layer[] = [];
      for (const v of pos) {
        if (v.t !== "layer") return UNKNOWN;
        layers.push(v.layer);
      }
      return { t: "layer", layer: { kind: "seq", layers } };
    }
    if (path.startsWith("nn.") && SAME_LAYERS.has(last)) return { t: "layer", layer: { kind: "same", label: last } };

    // Products.
    const shapes = (n: number): Shape[] | null => {
      const out: Shape[] = [];
      for (let i = 0; i < n; i++) {
        const v = pos[i];
        if (!v || v.t !== "tensor") return null;
        out.push(v.shape);
      }
      return out;
    };
    if (path === "torch.matmul" || path === "np.matmul" || path === "torch.mm" || path === "torch.mv") {
      const s = shapes(2);
      if (!s) return UNKNOWN;
      const r = matmul(s[0], s[1], last);
      return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
    }
    if (path === "np.dot" || path === "torch.dot") {
      const s = shapes(2);
      if (!s) return UNKNOWN;
      const r = npDot(s[0], s[1]);
      return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
    }
    if (path === "torch.bmm") {
      const s = shapes(2);
      if (!s) return UNKNOWN;
      if (s[0].length !== 3 || s[1].length !== 3) return this.fail("bmm: expects two 3-d tensors, got " + formatShape(s[0]) + " and " + formatShape(s[1]));
      if (dimEq(s[0][0], s[1][0]) === false) return this.fail("bmm: batch dims " + formatDim(s[0][0]) + " vs " + formatDim(s[1][0]));
      const r = matmul(s[0], s[1], "bmm");
      return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
    }
    if (path === "torch.einsum" || path === "np.einsum") {
      const spec = pos[0];
      if (spec?.t !== "str") return UNKNOWN;
      let rest = pos.slice(1);
      if (rest.length === 1 && rest[0].t === "tuple") rest = rest[0].items;
      const ops: Shape[] = [];
      for (const v of rest) {
        if (v.t !== "tensor") return UNKNOWN;
        ops.push(v.shape);
      }
      const r = einsum(spec.v, ops);
      return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
    }
    if (path === "torch.cat" || path === "torch.concat" || path === "torch.concatenate" || path === "np.concatenate" || path === "torch.stack" || path === "np.stack") {
      const list = pos[0];
      const axis = this.intArg(this.dimArg(pos, kw, 1, "dim", "axis")) ?? 0;
      if (list?.t !== "tuple") return UNKNOWN;
      const ts: Shape[] = [];
      for (const v of list.items) {
        if (v.t !== "tensor") return UNKNOWN;
        ts.push(v.shape);
      }
      return this.catStack(last === "stack" ? "stack" : "cat", ts, axis, lib);
    }
    if (path === "torch.transpose" || path === "torch.swapaxes" || path === "np.swapaxes" || path === "np.transpose" || path === "torch.permute") {
      const x = pos[0];
      if (x?.t !== "tensor") return UNKNOWN;
      return this.method(x, last === "swapaxes" ? "transpose" : last, pos.slice(1), kw);
    }
    if (path === "torch.reshape" || path === "np.reshape" || path === "torch.flatten" || path === "torch.squeeze" || path === "torch.unsqueeze" || path === "np.squeeze" || path === "np.expand_dims") {
      const x = pos[0];
      if (x?.t !== "tensor") return UNKNOWN;
      return this.method(x, last === "expand_dims" ? "unsqueeze" : last, pos.slice(1), kw);
    }
    if ((path.startsWith("torch.") || path.startsWith("np.")) && parts.length === 2 && REDUCE.has(last)) {
      const x = pos[0];
      if (x?.t !== "tensor") return pos[0]?.t === "tuple" ? UNKNOWN : UNKNOWN;
      return this.method(x, last, pos.slice(1), kw);
    }
    if (path === "torch.where" || path === "np.where") {
      if (pos.length < 3) return UNKNOWN;
      const s = pos.map((v) => (v.t === "tensor" ? v.shape : []));
      const r1 = broadcast(s[0], s[1], "where");
      if ("error" in r1) return this.fail(r1.error);
      const r2 = broadcast(r1.shape, s[2], "where");
      return "error" in r2 ? this.fail(r2.error) : tensor(r2.shape, lib);
    }
    if (path === "torch.maximum" || path === "torch.minimum" || path === "np.maximum" || path === "np.minimum" || path === "torch.add" || path === "torch.mul" || path === "np.add" || path === "np.multiply") {
      return this.binop("*", pos[0] ?? UNKNOWN, pos[1] ?? UNKNOWN);
    }
    if ((path.startsWith("F.") || path.startsWith("torch.") || path.startsWith("np.")) && SAME_FNS.has(last)) {
      const x = pos[0];
      if (x?.t === "tensor") {
        if (last === "softmax" || last === "log_softmax") {
          const d = this.intArg(this.dimArg(pos, kw, 1, "dim", "axis"));
          if (d !== null && typeof normAxis(d, x.shape.length, last, x.shape) === "string") return this.fail(normAxis(d, x.shape.length, last, x.shape) as string);
        }
        if (last === "layer_norm") {
          const ns = this.sizeArgs(pos.slice(1, 2), new Map());
          if (ns) this.checkNorm(ns, x.shape, "layer_norm");
        }
        return tensor(x.shape, x.lib);
      }
      if (x && (x.t === "dim" || x.t === "num")) return { t: "num" };
      return UNKNOWN;
    }
    if (path === "F.linear") {
      const x = pos[0];
      const w = pos[1];
      if (x?.t !== "tensor" || w?.t !== "tensor" || w.shape.length !== 2) return UNKNOWN;
      const r = matmul(x.shape, [w.shape[1], w.shape[0]], "linear");
      return "error" in r ? this.fail(r.error) : tensor(r.shape, lib);
    }
    if (path === "F.scaled_dot_product_attention") {
      const s = shapes(3);
      if (!s) return UNKNOWN;
      const r = matmul(s[0], [...s[1].slice(0, -2), s[1][s[1].length - 1], s[1][s[1].length - 2]], "attention q @ k^T");
      if ("error" in r) return this.fail(r.error);
      const r2 = matmul(r.shape, s[2], "attention weights @ v");
      return "error" in r2 ? this.fail(r2.error) : tensor(r2.shape, lib);
    }
    if (path === "math.sqrt" || path === "np.sqrt" || path === "math.log" || path === "math.exp") return pos[0]?.t === "tensor" ? pos[0] : { t: "num" };
    return UNKNOWN;
  }

  checkNorm(ns: Shape, s: Shape, label: string) {
    const tail = s.slice(s.length - ns.length);
    if (ns.length > s.length || ns.some((d, i) => dimEq(d, tail[i]) === false))
      this.fail(label + ": normalized_shape " + formatShape(ns) + " does not match the trailing dims of " + formatShape(s));
  }

  literalShape(v: Val, lib: Lib): Val {
    const shapeOf = (x: Val): Shape | null | "ragged" => {
      if (x.t === "dim" || x.t === "num" || x.t === "bool") return [];
      if (x.t !== "tuple") return null;
      if (!x.items.length) return [known(0)];
      const inner = x.items.map(shapeOf);
      if (inner.some((s) => s === null)) return null;
      if (inner.some((s) => s === "ragged")) return "ragged";
      const first = inner[0] as Shape;
      for (const s of inner as Shape[]) if (s.length !== first.length || s.some((d, i) => d.value !== first[i].value)) return "ragged";
      return [known(x.items.length), ...first];
    };
    const s = shapeOf(v);
    if (s === "ragged") return this.fail("tensor: nested lists have unequal lengths (ragged)");
    return s ? tensor(s, lib) : UNKNOWN;
  }

  catStack(kind: "cat" | "stack", ts: Shape[], axis: number, lib: Lib): Val {
    if (!ts.length) return this.fail(kind + ": expected a non-empty list of tensors");
    const base = ts[0];
    for (let i = 1; i < ts.length; i++) {
      if (ts[i].length !== base.length)
        return this.fail(kind + ": tensors must have the same number of dims - " + formatShape(base) + " vs " + formatShape(ts[i]));
    }
    if (kind === "stack") {
      for (let i = 1; i < ts.length; i++)
        for (let j = 0; j < base.length; j++)
          if (dimEq(base[j], ts[i][j]) === false) return this.fail("stack: all tensors must have the same shape - " + formatShape(base) + " vs " + formatShape(ts[i]));
      const a = normAxis(axis, base.length + 1, "stack", base);
      if (typeof a === "string") return this.fail(a);
      const out = [...base];
      out.splice(a, 0, known(ts.length));
      return tensor(out, lib);
    }
    const a = normAxis(axis, base.length, "cat", base);
    if (typeof a === "string") return this.fail(a);
    let along: Dim = base[a];
    for (let i = 1; i < ts.length; i++) {
      for (let j = 0; j < base.length; j++) {
        if (j === a) continue;
        if (dimEq(base[j], ts[i][j]) === false)
          return this.fail("cat: sizes must match except in dim " + axis + " - " + formatShape(base) + " vs " + formatShape(ts[i]) + " at dim " + j);
      }
      const r = dimArith("+", along, ts[i][a]);
      along = r === "float" ? sym("?") : r;
    }
    const out = [...base];
    out[a] = along;
    return tensor(out, lib);
  }

  applyLayer(l: Layer, x: Val): Val {
    if (x.t !== "tensor") return UNKNOWN;
    const s = x.shape;
    switch (l.kind) {
      case "same":
        return tensor(s, x.lib);
      case "norm":
        this.checkNorm(l.shape, s, l.label);
        return tensor(s, x.lib);
      case "linear": {
        if (!s.length) return this.fail("Linear: input is a scalar");
        const last = s[s.length - 1];
        if (dimEq(last, l.inF) === false)
          return this.fail("Linear(" + formatDim(l.inF) + ", " + formatDim(l.outF) + "): input " + formatShape(s) + " has last dim " + formatDim(last) + ", expected in_features " + formatDim(l.inF));
        return tensor([...s.slice(0, -1), l.outF], x.lib);
      }
      case "embedding":
        return tensor([...s, l.dim], x.lib);
      case "flatten":
        return this.method(x, "flatten", [{ t: "dim", d: known(l.start) }, { t: "dim", d: known(l.end) }], new Map());
      case "seq": {
        let cur: Val = x;
        for (const sub of l.layers) cur = this.applyLayer(sub, cur);
        return cur;
      }
      case "conv2d": {
        if (s.length !== 3 && s.length !== 4) return this.fail("Conv2d: expects (N, C, H, W) or (C, H, W), got " + formatShape(s));
        const c = s[s.length - 3];
        if (dimEq(c, l.cin) === false)
          return this.fail("Conv2d(" + formatDim(l.cin) + ", " + formatDim(l.cout) + "): input " + formatShape(s) + " has " + formatDim(c) + " channels, expected " + formatDim(l.cin));
        const outDim = (h: Dim, i: 0 | 1): Dim => {
          const k = l.k[i];
          const st = l.s[i];
          const p = l.p[i];
          const d = l.d[i];
          if (p.name === "same") return h;
          if (h.value !== null && k.value !== null && st.value !== null && p.value !== null && d.value !== null)
            return known(Math.floor((h.value + 2 * p.value - d.value * (k.value - 1) - 1) / st.value) + 1);
          if (st.value === 1 && k.value !== null && p.value !== null && d.value === 1 && k.value === 2 * p.value + 1) return h;
          return sym("conv(" + formatDim(h) + ")");
        };
        return tensor([...s.slice(0, -3), l.cout, outDim(s[s.length - 2], 0), outDim(s[s.length - 1], 1)], x.lib);
      }
    }
  }

  /** Axis list from varargs or one tuple: `.permute(0, 2, 1)` / `.permute((0, 2, 1))`. */
  axes(pos: Val[]): number[] | null {
    let items = pos;
    if (items.length === 1 && items[0].t === "tuple") items = items[0].items;
    const out: number[] = [];
    for (const v of items) {
      const n = this.intArg(v);
      if (n === null) return null;
      out.push(n);
    }
    return out;
  }

  method(obj: Val, name: string, pos: Val[], kw: Map<string, Val>): Val {
    if (obj.t === "tuple") {
      if (name === "index" || name === "count") return { t: "dim", d: sym("?") };
      return UNKNOWN;
    }
    if (obj.t === "dim") return name === "item" ? obj : UNKNOWN;
    if (obj.t !== "tensor") return UNKNOWN;
    const s = obj.shape;
    const r = s.length;
    const out = (shape: Shape): Val => tensor(shape, obj.lib);
    const axisOf = (v: Val | undefined, what: string, rank = r): number | string | null => {
      const n = this.intArg(v);
      return n === null ? null : normAxis(n, rank, what, s);
    };

    if (SAME_METHODS.has(name)) {
      if (name === "softmax" || name === "log_softmax") {
        const a = axisOf(this.dimArg(pos, kw, 0, "dim"), name);
        if (typeof a === "string") return this.fail(a);
      }
      if (name === "masked_fill" || name === "masked_fill_") {
        const m = pos[0];
        if (m?.t === "tensor") {
          const b = broadcast(s, m.shape, "masked_fill");
          if ("error" in b) return this.fail("masked_fill: mask " + formatShape(m.shape) + " does not broadcast to " + formatShape(s));
        }
      }
      return out(s);
    }
    switch (name) {
      case "masked_fill": {
        const m = pos[0];
        if (m?.t === "tensor") {
          const b = broadcast(s, m.shape, "masked_fill");
          if ("error" in b) return this.fail("masked_fill: mask " + formatShape(m.shape) + " does not broadcast to " + formatShape(s));
        }
        return out(s);
      }
      case "size":
      case "dim":
      case "numel":
      case "nelement":
        if (name === "dim") return { t: "dim", d: known(r) };
        if (name === "numel" || name === "nelement") return { t: "dim", d: product(s) };
        if (pos.length) {
          const a = axisOf(pos[0], "size");
          if (typeof a === "string") return this.fail(a);
          return a === null ? UNKNOWN : { t: "dim", d: s[a] };
        }
        return { t: "tuple", items: s.map((d) => ({ t: "dim", d }) as Val) };
      case "item":
        if (s.some((d) => d.value !== null && d.value !== 1)) return this.fail("item: only one-element tensors can be converted, got " + formatShape(s));
        return { t: "num" };
      case "transpose":
      case "swapaxes":
      case "swapdims": {
        const ax = this.axes(pos);
        if (!ax) return UNKNOWN;
        if (!ax.length) return out([...s].reverse());
        if (obj.lib === "np" && ax.length !== 2) return this.method(obj, "permute", pos, kw);
        if (ax.length === r && r !== 2 && obj.lib === "np") return this.method(obj, "permute", pos, kw);
        if (ax.length !== 2) return this.fail("transpose: expects two dims, got " + ax.length);
        const a = normAxis(ax[0], r, "transpose", s);
        const b = normAxis(ax[1], r, "transpose", s);
        if (typeof a === "string") return this.fail(a);
        if (typeof b === "string") return this.fail(b);
        const t = [...s];
        [t[a], t[b]] = [t[b], t[a]];
        return out(t);
      }
      case "t":
        if (r > 2) return this.fail(".t() expects a tensor with <= 2 dims, got " + formatShape(s));
        return out([...s].reverse());
      case "permute": {
        const ax = this.axes(pos);
        if (!ax) return UNKNOWN;
        if (ax.length !== r) return this.fail("permute: " + formatShape(s) + " has " + r + " dims but " + ax.length + " were given");
        const norm = ax.map((a) => (a < 0 ? a + r : a));
        if (new Set(norm).size !== r || norm.some((a) => a < 0 || a >= r)) return this.fail("permute: (" + ax.join(", ") + ") is not a permutation of " + r + " dims");
        return out(norm.map((a) => s[a]));
      }
      case "reshape":
      case "view": {
        const tgt = this.sizeArgs(pos, kw);
        if (!tgt) return UNKNOWN;
        const res = reshape(s, tgt, name);
        return "error" in res ? this.fail(res.error) : out(res.shape);
      }
      case "view_as":
      case "reshape_as":
      case "expand_as":
        return pos[0]?.t === "tensor" ? out(pos[0].shape) : UNKNOWN;
      case "flatten": {
        const st = this.intArg(this.dimArg(pos, kw, 0, "start_dim")) ?? 0;
        const en = this.intArg(this.dimArg(pos, kw, 1, "end_dim")) ?? -1;
        if (!r) return out([ONE]);
        const a = normAxis(st, r, "flatten", s);
        const b = normAxis(en, r, "flatten", s);
        if (typeof a === "string") return this.fail(a);
        if (typeof b === "string") return this.fail(b);
        if (a > b) return this.fail("flatten: start_dim " + st + " is after end_dim " + en);
        return out([...s.slice(0, a), product(s.slice(a, b + 1)), ...s.slice(b + 1)]);
      }
      case "ravel":
        return out([product(s)]);
      case "unsqueeze": {
        const a = axisOf(this.dimArg(pos, kw, 0, "dim", "axis"), "unsqueeze", r + 1);
        if (typeof a === "string") return this.fail(a);
        if (a === null) return UNKNOWN;
        const t = [...s];
        t.splice(a, 0, ONE);
        return out(t);
      }
      case "squeeze": {
        const arg = this.dimArg(pos, kw, 0, "dim", "axis");
        if (!arg) return out(s.filter((d) => d.value !== 1));
        const a = axisOf(arg, "squeeze");
        if (typeof a === "string") return this.fail(a);
        if (a === null) return UNKNOWN;
        if (s[a].value === 1) return out(s.filter((_, i) => i !== a));
        if (obj.lib === "np" && s[a].value !== null) return this.fail("squeeze: cannot select an axis to squeeze out which has size " + s[a].value);
        return out(s);
      }
      case "expand":
      case "broadcast_to": {
        const tgt = this.sizeArgs(pos, kw);
        if (!tgt) return UNKNOWN;
        const off = tgt.length - r;
        if (off < 0) return this.fail("expand: target " + formatShape(tgt) + " has fewer dims than " + formatShape(s));
        const res: Shape = [];
        for (let i = 0; i < tgt.length; i++) {
          const t = tgt[i];
          const src = i >= off ? s[i - off] : null;
          if (t.value === -1) res.push(src ?? sym("?"));
          else {
            if (src && !isOne(src) && dimEq(src, t) === false) return this.fail("expand: dim " + i + " of " + formatShape(s) + " is " + formatDim(src) + ", cannot expand to " + formatDim(t));
            res.push(t);
          }
        }
        return out(res);
      }
      case "repeat": {
        const reps = this.sizeArgs(pos, kw);
        if (!reps) return UNKNOWN;
        if (reps.length < r) return this.fail("repeat: needs at least " + r + " repeat counts for " + formatShape(s));
        const padded = [...Array(reps.length - r).fill(ONE), ...s] as Shape;
        return out(padded.map((d, i) => {
          const m = dimArith("*", d, reps[i]);
          return m === "float" ? sym("?") : m;
        }));
      }
      case "chunk": {
        const n = this.intArg(pos[0] ?? kw.get("chunks"));
        const a = axisOf(this.dimArg(pos, kw, 1, "dim") ?? { t: "dim", d: known(0) }, "chunk");
        if (typeof a === "string") return this.fail(a);
        if (n === null || a === null) return UNKNOWN;
        const d = s[a];
        if (d.value !== null && d.value % n !== 0) this.warn("chunk: " + d.value + " is not divisible by " + n + " - the last chunk is smaller");
        const piece = dimArith("//", d, known(n));
        const t = [...s];
        t[a] = piece === "float" ? sym("?") : d.value !== null ? known(Math.ceil(d.value / n)) : piece;
        return { t: "tuple", items: Array.from({ length: n }, () => out(t)) };
      }
      case "unbind": {
        const a = axisOf(this.dimArg(pos, kw, 0, "dim") ?? { t: "dim", d: known(0) }, "unbind");
        if (typeof a === "string") return this.fail(a);
        if (a === null || s[a].value === null) return UNKNOWN;
        return { t: "tuple", items: Array.from({ length: s[a].value! }, () => out(s.filter((_, i) => i !== a))) };
      }
      case "matmul":
      case "mm":
      case "bmm":
      case "dot": {
        const o = pos[0];
        if (o?.t !== "tensor") return UNKNOWN;
        const res = name === "dot" && obj.lib === "np" ? npDot(s, o.shape) : matmul(s, o.shape, name);
        return "error" in res ? this.fail(res.error) : out(res.shape);
      }
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "pow":
      case "maximum":
      case "minimum":
      case "eq":
      case "ne":
      case "lt":
      case "gt":
        return this.binop("*", obj, pos[0] ?? UNKNOWN);
    }
    if (REDUCE.has(name)) {
      const arg = this.dimArg(pos, kw, 0, "dim", "axis");
      const keep = kw.get("keepdim") ?? kw.get("keepdims");
      const keepdim = keep?.t === "bool" && keep.v === true;
      if (!arg || arg.t === "none") return out([]);
      const list = arg.t === "tuple" ? arg.items : [arg];
      const axes: number[] = [];
      for (const v of list) {
        const a = axisOf(v, name);
        if (typeof a === "string") return this.fail(a);
        if (a === null) return UNKNOWN;
        axes.push(a);
      }
      const res = keepdim ? s.map((d, i) => (axes.includes(i) ? ONE : d)) : s.filter((_, i) => !axes.includes(i));
      const t = out(res);
      // torch's max/min with a dim return (values, indices).
      if ((name === "max" || name === "min" || name === "median") && obj.lib === "torch" && t.t === "tensor") return { ...t, pair: true };
      return t;
    }
    return UNKNOWN;
  }
}

/* ------------------------------------------------------------ code: public */

export interface CodeResult {
  variables: CodeVariable[];
  errors: CodeError[];
}

/** Shape-evaluate straight-line PyTorch / NumPy code. */
export function runCode(code: string): CodeResult {
  const it = new Interp();
  try {
    it.run(code);
  } catch {
    it.errors.push({ line: it.line, message: "the interpreter stopped here unexpectedly", severity: "error" });
  }
  return { variables: [...it.vars.values()], errors: it.errors };
}

/* ------------------------------------------------------------------ LaTeX */

interface LTok {
  t: "cmd" | "char" | "num" | "open" | "close" | "sup" | "sub";
  v: string;
  pos: number;
  end: number;
}

function ltokenize(src: string): LTok[] {
  const out: LTok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "%") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i, i + 40));
      const v = m ? m[1] : "";
      out.push({ t: "cmd", v, pos: i, end: i + 1 + v.length });
      i += 1 + v.length;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i, i + 40))!;
      out.push({ t: "num", v: m[0], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === "{" || c === "}") out.push({ t: c === "{" ? "open" : "close", v: c, pos: i, end: i + 1 });
    else if (c === "^" || c === "_") out.push({ t: c === "^" ? "sup" : "sub", v: c, pos: i, end: i + 1 });
    else if (c === "\u00d7") out.push({ t: "cmd", v: "times", pos: i, end: i + 1 });
    else out.push({ t: "char", v: c, pos: i, end: i + 1 });
    i++;
  }
  return out;
}

/** A brace group or a single token at `i`: returns its inner tokens and the next index. */
function group(toks: LTok[], i: number): [LTok[], number] {
  const t = toks[i];
  if (!t) return [[], i];
  if (t.t !== "open") return [[t], i + 1];
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (toks[j].t === "open") depth++;
    else if (toks[j].t === "close" && --depth === 0) return [toks.slice(i + 1, j), j + 1];
  }
  return [toks.slice(i + 1), toks.length];
}

const FONTS = new Set(["mathbf", "boldsymbol", "bm", "mathit", "mathrm", "mathsf", "mathcal", "mathscr", "mathfrak", "vec", "hat", "tilde", "bar", "overline", "widehat", "widetilde", "mathbfit", "pmb", "textbf", "text", "textrm", "textit", "mbox", "operatorname", "underline", "dot", "ddot", "check", "breve"]);
const TRANSPOSE = new Set(["T", "\\top", "\\intercal", "\\mathsf{T}", "\\mathrm{T}"]);

/** Plain text of a token run, with font wrappers removed: `d_{\text{model}}` -> `d_model`. */
function plain(toks: LTok[]): string {
  let s = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "cmd" && FONTS.has(t.v)) {
      const [g, nx] = group(toks, i + 1);
      s += plain(g);
      i = nx - 1;
    } else if (t.t === "cmd") {
      if (t.v === "," || t.v === ";" || t.v === "!" || t.v === " " || t.v === "left" || t.v === "right") continue;
      s += "\\" + t.v;
    } else if (t.t === "open" || t.t === "close") continue;
    else s += t.v;
  }
  return s;
}

/** Lower-case alphanumerics only: `\mathbf{W}_{q}` -> `wq`, `\alpha` -> `alpha`. */
export function symbolKey(name: string): string {
  return name.replace(/\\(mathbf|boldsymbol|bm|mathrm|mathit|vec|hat|text|operatorname)\b/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface ParsedSymbol {
  name: string;
  latex: string;
  next: number;
}

const NOT_SYMBOL = new Set([
  "in", "times", "cdot", "frac", "dfrac", "sqrt", "left", "right", "quad", "qquad", "text", "mathbb", "forall", "exists", "sum", "prod", "int",
  "begin", "end", "label", "tag", "le", "leq", "ge", "geq", "approx", "sim", "to", "mapsto", "rightarrow", "colon", "mid", "dots", "ldots", "cdots",
  "odot", "circ", "otimes", "oplus", "pm", "mp", "top", "intercal", "\\", ",", ";", "!", "{", "}", "|", "exp", "log", "ln", "tanh", "sin", "cos",
  "softmax", "max", "min", "sigma", "mathrm", "operatorname", "partial", "nabla", "equiv", "coloneqq", "triangleq", "neq", "ne", "langle", "rangle", "|",
]);

/**
 * A symbol at `i`: a letter, Greek command or font-wrapped name, with
 * subscripts and non-transpose superscripts folded into its name.
 */
function parseSymbol(toks: LTok[], i: number, src: string, allowSigma = false): ParsedSymbol | null {
  const t = toks[i];
  if (!t) return null;
  let name: string;
  let j: number;
  if (t.t === "cmd" && FONTS.has(t.v)) {
    const [g, nx] = group(toks, i + 1);
    name = plain(g);
    if (!name || /\s/.test(name)) return null;
    j = nx;
  } else if (t.t === "char" && /[A-Za-z]/.test(t.v)) {
    name = t.v;
    j = i + 1;
  } else if (t.t === "cmd" && /^[A-Za-z]+$/.test(t.v) && (!NOT_SYMBOL.has(t.v) || (allowSigma && t.v === "sigma"))) {
    name = "\\" + t.v;
    j = i + 1;
  } else return null;
  for (;;) {
    const u = toks[j];
    if (!u) break;
    if (u.t === "sub") {
      const [g, nx] = group(toks, j + 1);
      name += "_" + plain(g);
      j = nx;
    } else if (u.t === "sup") {
      const [g, nx] = group(toks, j + 1);
      const p = plain(g);
      if (TRANSPOSE.has(p) || TRANSPOSE.has(p.replace(/^\\/, "")) || /^-?[0-9]/.test(p) || p === "\\prime" || p === "*" || p === "+" || p === "\\dagger" || p === "H") break;
      name += "^" + p;
      j = nx;
    } else if (u.t === "char" && u.v === "'") {
      name += "'";
      j++;
    } else break;
  }
  return { name, latex: src.slice(t.pos, toks[j - 1].end), next: j };
}

/** `m \times n` -> dims; `d_{\text{model}}` -> `d_model`; `512` -> 512. */
function parseDims(toks: LTok[]): Shape {
  const parts: LTok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.t === "open") depth++;
    if (t.t === "close") depth--;
    if (depth === 0 && t.t === "cmd" && (t.v === "times" || t.v === "by")) parts.push([]);
    else if (depth === 0 && t.t === "char" && t.v === "*") parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  return parts
    .map((p) => plain(p).replace(/\s+/g, ""))
    .filter((s) => s.length)
    .map((s) => (/^[0-9]+$/.test(s) ? known(Number(s)) : sym(s)));
}

const STOP_CHARS = new Set(["=", ":", ";", "&", "(", ")", "[", "]", "<", ">", "|", "$", "\\"]);
const SPACING = new Set([" ", ",", ";", "!", ":", "quad", "qquad"]);
const STOP_CMDS = new Set(["in", "quad", "qquad", "\\", "text", "textrm", "mbox", "forall", "where", "exists", "colon", "mid", "land", "wedge", "left", "right", ",", ";", "leq", "le", "geq", "ge", "approx", "sim", "to", "mapsto", "rightarrow", "quad", "label", "tag", "begin", "end", "and"]);

function fieldAt(toks: LTok[], i: number): { field: string; next: number } | null {
  const t = toks[i];
  if (!t) return null;
  if (t.t === "cmd" && (t.v === "mathbb" || t.v === "mathbf" || t.v === "Bbb")) {
    const [g, nx] = group(toks, i + 1);
    const f = plain(g);
    return /^[RCZNQFB]$/.test(f) ? { field: f, next: nx } : null;
  }
  if (t.t === "cmd" && /^(R|C|Z|N|Q|Reals|reals|Complex)$/.test(t.v)) return { field: t.v[0].toUpperCase(), next: i + 1 };
  if (t.t === "char" && /^[\u211d\u2102\u2124]$/.test(t.v)) return { field: t.v === "\u211d" ? "R" : t.v === "\u2102" ? "C" : "Z", next: i + 1 };
  if (t.t === "cmd" && t.v === "{") {
    let j = i + 1;
    let inner = "";
    while (j < toks.length && !(toks[j].t === "cmd" && toks[j].v === "}")) inner += toks[j].t === "cmd" ? "\\" + toks[j].v : toks[j].v, j++;
    if (j >= toks.length || !/^(-?[0-9]+(,-?[0-9]+)*|\\pm1)$/.test(inner)) return null;
    return { field: "{" + inner + "}", next: j + 1 };
  }
  return null;
}

const lineOf = (text: string, pos: number, base: number | null) => (base === null ? null : base + (text.slice(0, pos).match(/\n/g)?.length ?? 0));

/** Every `<symbols> \in <field>^{<dims>}` in the given math blocks. */
export function extractDeclarations(blocks: LatexBlock[]): LatexDeclaration[] {
  const out: LatexDeclaration[] = [];
  for (const b of blocks) {
    const toks = ltokenize(b.text);
    for (let j = 0; j < toks.length; j++) {
      const t = toks[j];
      if (t.t !== "cmd" || t.v !== "in") continue;
      const f = fieldAt(toks, j + 1);
      if (!f) continue;
      let dims: Shape = [];
      if (toks[f.next]?.t === "sup") dims = parseDims(group(toks, f.next + 1)[0]);
      // Walk back to the start of this clause, then read `A, B, C`.
      let s = j - 1;
      let depth = 0;
      for (; s >= 0; s--) {
        const u = toks[s];
        if (u.t === "close") depth++;
        else if (u.t === "open") {
          if (depth === 0) break;
          depth--;
        } else if (depth === 0 && ((u.t === "char" && STOP_CHARS.has(u.v)) || (u.t === "cmd" && STOP_CMDS.has(u.v)))) break;
      }
      let from = s + 1;
      if (s >= 0 && toks[s].t === "cmd" && /^(text|textrm|mbox)$/.test(toks[s].v)) from = group(toks, s + 1)[1];
      // `A \in R^{..}, B \in R^{..}`: the clause can start with the previous
      // declaration's field, so try every top-level comma as a start and keep
      // the longest run that reads as a symbol list.
      const starts = [from];
      depth = 0;
      for (let q = from; q < j; q++) {
        if (toks[q].t === "open") depth++;
        else if (toks[q].t === "close") depth--;
        else if (depth === 0 && toks[q].t === "char" && toks[q].v === ",") starts.push(q + 1);
      }
      let syms: ParsedSymbol[] = [];
      let ok = false;
      for (const st of starts) {
        syms = [];
        ok = true;
        let k = st;
        while (k < j) {
          while (k < j && toks[k].t === "cmd" && SPACING.has(toks[k].v)) k++;
          const p = parseSymbol(toks, k, b.text);
          if (!p) {
            ok = false;
            break;
          }
          syms.push(p);
          k = p.next;
          while (k < j && toks[k].t === "cmd" && SPACING.has(toks[k].v)) k++;
          if (k < j && toks[k].t === "char" && toks[k].v === ",") k++;
          else if (k < j) {
            ok = false;
            break;
          }
        }
        if (ok && syms.length) break;
      }
      if (!ok || !syms.length) continue;
      for (const p of syms) {
        out.push({ latex: p.latex, name: p.name, key: symbolKey(p.name), field: f.field, dims, line: lineOf(b.text, toks[j].pos, b.line) });
      }
    }
  }
  return out;
}

/**
 * Math blocks of a document with the line their payload starts on. Plain text
 * with no math delimiters (a pasted snippet) is read as math, line by line.
 */
export function latexBlocksFromSource(src: string, withLines = true): LatexBlock[] {
  const { tokens } = tokenize(src);
  const blocks: LatexBlock[] = [];
  for (const t of tokens) {
    if (t.kind === "text") continue;
    const at = src.indexOf(t.value, t.start);
    const line = at >= 0 ? (src.slice(0, at).match(/\n/g)?.length ?? 0) + 1 : t.line;
    blocks.push({ text: t.value, line: withLines ? line : null });
  }
  if (!blocks.length) {
    src.split("\n").forEach((text, i) => {
      if (text.trim()) blocks.push({ text, line: withLines ? i + 1 : null });
    });
  }
  return blocks;
}

/* --------------------------------------------------------------- bindings */

type DimResolver = (d: Dim) => number | null;

/** Evaluate a LaTeX dimension like `d/h`, `2d`, `h d_k` with bound symbols. */
function evalLatexDim(d: Dim, lookup: (name: string) => number | null): number | null {
  if (d.value !== null) return d.value;
  const name = d.name ?? "";
  const direct = lookup(name);
  if (direct !== null) return direct;
  // Tokens: numbers, symbols with optional subscripts, operators.
  const re = /\s*([0-9]+|\\?[A-Za-z]+(?:_[A-Za-z0-9]+|_\{[^}]*\})?|[*/+\-()]|\\cdot|\\times)/y;
  const toks: string[] = [];
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < name.length && (re.lastIndex = pos, (m = re.exec(name)))) {
    toks.push(m[1]);
    pos = re.lastIndex;
  }
  if (pos < name.length) return null;
  let i = 0;
  const atom = (): number | null => {
    const t = toks[i++];
    if (t === undefined) return null;
    if (t === "(") {
      const v = sum();
      i++;
      return v;
    }
    if (/^[0-9]+$/.test(t)) return Number(t);
    return lookup(t);
  };
  const prod = (): number | null => {
    let v = atom();
    while (i < toks.length && toks[i] !== "+" && toks[i] !== "-" && toks[i] !== ")") {
      const op = toks[i];
      if (op === "*" || op === "/" || op === "\\cdot" || op === "\\times") i++;
      const r = atom();
      if (v === null || r === null) v = null;
      else v = op === "/" ? (r === 0 || v % r !== 0 ? null : v / r) : v * r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = prod();
    while (toks[i] === "+" || toks[i] === "-") {
      const op = toks[i++];
      const r = prod();
      v = v === null || r === null ? null : op === "+" ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return i === toks.length ? v : null;
}

const SIMPLE_DIM = /^\\?[A-Za-z]+(_[A-Za-z0-9]+)?$/;

/* ------------------------------------------------------- equation algebra */

type AShape = { shape: Shape | null; scalar: boolean };

interface AlgebraCtx {
  shapes: Map<string, Shape>;
  dimSymbols: Set<string>;
  resolve: DimResolver;
  notes: string[];
  errors: string[];
  missing: Set<string>;
}

/** Equality of LaTeX dims: same int, same name, or same bound value. */
function ldimEq(a: Dim, b: Dim, ctx: AlgebraCtx): boolean | null {
  const direct = dimEq(a, b);
  if (direct !== null) return direct;
  const va = ctx.resolve(a);
  const vb = ctx.resolve(b);
  if (va !== null && vb !== null) return va === vb;
  return null;
}

function aMatmul(a: AShape, b: AShape, ctx: AlgebraCtx, what: string): AShape {
  if (a.scalar) return b;
  if (b.scalar) return a;
  if (!a.shape || !b.shape) return { shape: null, scalar: false };
  // Maths vectors are columns: (d) behaves as (d x 1) on either side.
  const A = a.shape.length === 1 ? [a.shape[0], ONE] : a.shape;
  const B = b.shape.length === 1 ? [b.shape[0], ONE] : b.shape;
  const inA = A[A.length - 1];
  const inB = B[B.length - 2];
  if (a.shape.length === 1 && b.shape.length >= 2 && !isOne(inB)) {
    ctx.errors.push(what + ": (" + formatLatexShape(a.shape) + ")(" + formatLatexShape(b.shape) + ") - a column vector on the left needs a transpose");
    return { shape: null, scalar: false };
  }
  const eq = ldimEq(inA, inB, ctx);
  if (eq === false) {
    ctx.errors.push(what + ": (" + formatLatexShape(a.shape) + ")(" + formatLatexShape(b.shape) + ") - inner dims " + formatDim(inA) + " vs " + formatDim(inB));
    return { shape: null, scalar: false };
  }
  if (eq === null && !(isOne(inA) || isOne(inB))) ctx.notes.push("assumes " + formatDim(inA) + " = " + formatDim(inB));
  const out = [...A.slice(0, -1), B[B.length - 1]];
  // Drop the column of a right-hand vector: W x is a vector, not a matrix.
  if (b.shape.length === 1) out.pop();
  return { shape: out, scalar: out.length === 0 };
}

function aBroadcast(a: AShape, b: AShape, ctx: AlgebraCtx, op: string): AShape {
  if (a.scalar && b.scalar) return a;
  if (!a.shape || !b.shape) return { shape: null, scalar: false };
  if (a.scalar) return b;
  if (b.scalar) return a;
  const n = Math.max(a.shape.length, b.shape.length);
  const out: Shape = [];
  for (let i = 1; i <= n; i++) {
    const da = a.shape[a.shape.length - i];
    const db = b.shape[b.shape.length - i];
    if (!da || !db) {
      out.unshift(da ?? db);
      continue;
    }
    const eq = ldimEq(da, db, ctx);
    if (eq === false && !isOne(da) && !isOne(db)) {
      ctx.errors.push(op + ": (" + formatLatexShape(a.shape) + ") vs (" + formatLatexShape(b.shape) + ") - " + formatDim(da) + " vs " + formatDim(db));
      return { shape: null, scalar: false };
    }
    if (eq === null && !isOne(da) && !isOne(db)) ctx.notes.push("assumes " + formatDim(da) + " = " + formatDim(db));
    out.unshift(isOne(da) ? db : da);
  }
  return { shape: out, scalar: false };
}

const FUNCS = new Set(["exp", "log", "ln", "tanh", "sigma", "sin", "cos", "softmax", "relu", "gelu", "layernorm", "norm", "sigmoid", "dropout", "phi", "act", "silu", "f", "g", "attention", "mha", "ffn", "mlp", "diag"]);

/** Shape-algebra parser over LaTeX tokens. Implicit product is matmul. */
class Algebra {
  i = 0;
  constructor(public toks: LTok[], public ctx: AlgebraCtx, public src: string) {}
  peek() {
    return this.toks[this.i];
  }
  isChar(v: string) {
    const t = this.peek();
    return !!t && t.t === "char" && t.v === v;
  }
  isCmd(v: string) {
    const t = this.peek();
    return !!t && t.t === "cmd" && t.v === v;
  }
  expr(): AShape {
    let x = this.term();
    while (this.isChar("+") || this.isChar("-") || this.isCmd("pm")) {
      const op = this.peek()!.v;
      this.i++;
      const y = this.term();
      x = aBroadcast(x, y, this.ctx, op === "-" ? "difference" : "sum");
    }
    return x;
  }
  atEndOfTerm(): boolean {
    const t = this.peek();
    if (!t) return true;
    if (t.t === "close") return true;
    if (t.t === "char" && ("+-)],=".includes(t.v) || t.v === "|")) return true;
    if (t.t === "cmd" && (t.v === "right" || t.v === "pm" || t.v === "}" || t.v === "rangle" || t.v === "|")) return true;
    return false;
  }
  term(): AShape {
    let x = this.factor();
    for (;;) {
      if (this.atEndOfTerm()) return x;
      if (this.isChar("/")) {
        this.i++;
        const y = this.factor();
        if (!y.scalar && y.shape) this.ctx.errors.push("division by a non-scalar (" + formatLatexShape(y.shape) + ")");
        continue;
      }
      if (this.isCmd("odot") || this.isCmd("circ")) {
        this.i++;
        x = aBroadcast(x, this.factor(), this.ctx, "Hadamard product");
        continue;
      }
      if (this.isCmd("cdot") || this.isCmd("times")) this.i++;
      const before = this.i;
      const y = this.factor();
      if (this.i === before) {
        this.i++;
        return { shape: null, scalar: false };
      }
      x = aMatmul(x, y, this.ctx, "product");
    }
  }
  factor(): AShape {
    if (this.isChar("-") || this.isChar("+")) this.i++;
    let x = this.atom();
    // Postfix: transposes, inverses, powers.
    for (;;) {
      const t = this.peek();
      if (t && t.t === "sup") {
        const [g, nx] = group(this.toks, this.i + 1);
        const p = plain(g);
        this.i = nx;
        if (TRANSPOSE.has(p) || TRANSPOSE.has(p.replace(/^\\/, "")) || p === "\\top") {
          if (x.shape && !x.scalar) x = { shape: x.shape.length === 1 ? [ONE, x.shape[0]] : [...x.shape.slice(0, -2), x.shape[x.shape.length - 1], x.shape[x.shape.length - 2]], scalar: false };
        }
        // Powers and inverses keep the shape (square matrices); scalars stay scalars.
        continue;
      }
      if (t && t.t === "sub") {
        // A subscript on a group, e.g. (XW)_{ij}: element access -> scalar.
        this.i = group(this.toks, this.i + 1)[1];
        x = { shape: [], scalar: true };
        continue;
      }
      if (t && t.t === "char" && t.v === "'") {
        this.i++;
        continue;
      }
      return x;
    }
  }
  paren(open: string): AShape {
    const close = open === "(" ? ")" : open === "[" ? "]" : open;
    const x = this.expr();
    if (this.isCmd("right")) {
      this.i++;
      this.i++;
    } else if (this.isChar(close)) this.i++;
    return x;
  }
  funcArg(): AShape | null {
    if (this.isCmd("left")) {
      this.i += 2;
      return this.paren("(");
    }
    if (this.isChar("(") || this.isChar("[")) {
      const o = this.peek()!.v;
      this.i++;
      return this.paren(o);
    }
    return null;
  }
  atom(): AShape {
    const t = this.peek();
    const S = (scalar = true): AShape => ({ shape: [], scalar });
    if (!t) return { shape: null, scalar: false };
    if (t.t === "num") {
      this.i++;
      return S();
    }
    if (t.t === "open") {
      const [g, nx] = group(this.toks, this.i);
      this.i = nx;
      return new Algebra(g, this.ctx, this.src).expr();
    }
    if (t.t === "char" && (t.v === "(" || t.v === "[")) {
      this.i++;
      return this.paren(t.v);
    }
    if (t.t === "cmd") {
      if (t.v === "left") {
        this.i++;
        const o = this.peek();
        this.i++;
        if (o && o.t === "char" && o.v === "|") {
          this.expr();
          if (this.isCmd("right")) this.i += 2;
          return S();
        }
        return this.paren(o?.t === "cmd" ? "{" : o?.v ?? "(");
      }
      if (t.v === "frac" || t.v === "dfrac" || t.v === "tfrac") {
        const [num, n1] = group(this.toks, this.i + 1);
        const [den, n2] = group(this.toks, n1);
        this.i = n2;
        const a = new Algebra(num, this.ctx, this.src).expr();
        const b = new Algebra(den, this.ctx, this.src).expr();
        if (!b.scalar && b.shape) this.ctx.errors.push("division by a non-scalar (" + formatLatexShape(b.shape) + ")");
        return a;
      }
      if (t.v === "sqrt") {
        this.i++;
        if (this.isChar("[")) while (this.peek() && !this.isChar("]")) this.i++;
        if (this.isChar("]")) this.i++;
        const [g, nx] = group(this.toks, this.i);
        this.i = nx;
        return new Algebra(g, this.ctx, this.src).expr();
      }
      if (t.v === "|" || t.v === "lVert" || t.v === "Vert") {
        this.i++;
        while (this.peek() && !(this.peek()!.t === "cmd" && /^(\||rVert|Vert)$/.test(this.peek()!.v))) this.i++;
        this.i++;
        return S();
      }
      if (t.v === "mathrm" || t.v === "operatorname" || t.v === "text" || t.v === "mathsf" || t.v === "textrm") {
        const [g, nx] = group(this.toks, this.i + 1);
        const fname = plain(g);
        if (fname.length > 1) {
          this.i = nx;
          const arg = this.funcArg();
          if (arg) return arg;
          return { shape: null, scalar: false };
        }
      }
      if (FUNCS.has(t.v) || t.v === "max" || t.v === "min") {
        const save = this.i;
        this.i++;
        if (this.peek()?.t === "sub") this.i = group(this.toks, this.i + 1)[1];
        const arg = this.funcArg();
        if (arg) return arg;
        this.i = save;
      }
      if (t.v === "sum" || t.v === "prod" || t.v === "int") {
        this.ctx.notes.push("\\" + t.v + " is not shape-checked");
        this.i = this.toks.length;
        return { shape: null, scalar: false };
      }
      if (t.v === "cdots" || t.v === "dots" || t.v === "ldots") {
        this.i++;
        return { shape: null, scalar: false };
      }
    }
    const p = parseSymbol(this.toks, this.i, this.src, true);
    if (p) {
      this.i = p.next;
      const key = symbolKey(p.name);
      // `\sigma(x)`, `f(x)`: function application when followed by a parenthesis.
      if (FUNCS.has(key) && !this.ctx.shapes.has(key)) {
        const arg = this.funcArg();
        if (arg) return arg;
      }
      const s = this.ctx.shapes.get(key);
      if (s) return { shape: s, scalar: s.length === 0 };
      if (this.ctx.dimSymbols.has(p.name) || this.ctx.dimSymbols.has(key)) return S();
      this.ctx.missing.add(p.name);
      return { shape: null, scalar: false };
    }
    this.i++;
    return { shape: null, scalar: false };
  }
}

/** Equations worth checking: split on `\\`, `\quad`, `;` and listed commas. */
function equationSegments(b: LatexBlock): Array<{ text: string; line: number | null }> {
  const out: Array<{ text: string; line: number | null }> = [];
  const body = b.text.replace(/\\(begin|end)\{[a-z*]+\}/g, (m) => " ".repeat(m.length)).replace(/&/g, " ");
  const re = /\\\\|\\q?quad\b|;|\\text\{\s*(?:and|where|with)\s*\}/g;
  let last = 0;
  const pieces: Array<[number, string]> = [];
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    pieces.push([last, body.slice(last, m.index)]);
    last = m.index + m[0].length;
  }
  pieces.push([last, body.slice(last)]);
  for (const [at, raw] of pieces) {
    // Commas separate equations only when every piece is itself an equation.
    const commaParts: Array<[number, string]> = [];
    let depth = 0;
    let st = 0;
    for (let k = 0; k < raw.length; k++) {
      const c = raw[k];
      if ("({[".includes(c)) depth++;
      else if (")}]".includes(c)) depth--;
      else if (c === "," && depth === 0 && raw[k - 1] !== "\\") {
        commaParts.push([st, raw.slice(st, k)]);
        st = k + 1;
      }
    }
    commaParts.push([st, raw.slice(st)]);
    const parts = commaParts.filter(([, s]) => s.trim()).every(([, s]) => s.includes("=")) ? commaParts : [[0, raw] as [number, string]];
    for (const [off, s] of parts) {
      const text = s.trim().replace(/[.,;]+$/, "").trim();
      if (!text.includes("=") || /\\in\b/.test(text)) continue;
      out.push({ text, line: lineOf(b.text, at + off + (s.length - s.trimStart().length), b.line) });
    }
  }
  return out;
}

function splitTopLevel(text: string): string[] {
  const sides: string[] = [];
  let depth = 0;
  let st = 0;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (depth === 0 && c === "=" && text[k - 1] !== "\\" && text[k - 1] !== "!" && text[k - 1] !== ":") {
      sides.push(text.slice(st, k));
      st = k + 1;
    }
  }
  sides.push(text.slice(st));
  return sides.map((s) => s.replace(/\\approx/g, "").trim());
}

/* ----------------------------------------------------------------- analyze */

export interface SandboxOptions {
  /** LaTeX symbol (name or key) -> code variable. Overrides name matching. */
  mapping?: Record<string, string>;
}

/** `W_q = Wq_proj` per line (also `->`, `:`), for the editable mapping box. */
export function parseMapping(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const m = /^\s*([^=:#]+?)\s*(?:=|->|:)\s*([A-Za-z_][\w.]*)\s*$/.exec(raw);
    if (m) out[m[1].replace(/\$/g, "")] = m[2];
  }
  return out;
}

/** Run the code, read the LaTeX, match, bind and check. */
export function analyzeSandbox(code: string, blocks: LatexBlock[], options: SandboxOptions = {}): SandboxResult {
  const { variables, errors } = runCode(code);
  const declarations = extractDeclarations(blocks);
  const byKey = new Map<string, CodeVariable>();
  for (const v of variables) if (!byKey.has(symbolKey(v.name))) byKey.set(symbolKey(v.name), v);
  const mapping = new Map<string, string>();
  for (const [k, v] of Object.entries(options.mapping ?? {})) mapping.set(symbolKey(k), v);
  const byName = new Map(variables.map((v) => [v.name, v]));

  // Dimension symbols used in the LaTeX: `n`, `d`, `d_k`, ...
  const dimSymbols = new Set<string>();
  for (const d of declarations) for (const x of d.dims) if (x.name && SIMPLE_DIM.test(x.name)) dimSymbols.add(x.name);

  const raw = new Map<string, Array<{ value: number; source: string }>>();
  const bind = (symbol: string, value: number, source: string) => {
    if (!raw.has(symbol)) raw.set(symbol, []);
    raw.get(symbol)!.push({ value, source });
  };
  // Code ints named like a LaTeX dimension bind it first: `d_k = 64` -> d_k.
  for (const s of dimSymbols) {
    const v = byKey.get(symbolKey(s));
    if (v && v.kind === "int" && v.dims && v.dims[0].value !== null) bind(s, v.dims[0].value, "code: " + v.name + " = " + v.dims[0].value);
  }

  interface Pair {
    decl: LatexDeclaration;
    v: CodeVariable | null;
    codeDims: Shape | null;
    alt: Shape | null;
    offset: number;
  }
  const pairs: Pair[] = declarations.map((decl) => {
    const mapped = mapping.get(decl.key) ?? mapping.get(symbolKey(decl.latex));
    const v = mapped ? byName.get(mapped) ?? null : byKey.get(decl.key) ?? null;
    const usable = v && v.kind !== "int" ? v : null;
    const codeDims = usable?.dims ?? null;
    let alt: Shape | null = null;
    if (usable?.kind === "layer" && codeDims && codeDims.length === 2) alt = [codeDims[1], codeDims[0]];
    const offset = codeDims ? codeDims.length - decl.dims.length : 0;
    return { decl, v, codeDims, alt, offset };
  });

  // First pass: collect bindings from every aligned (LaTeX symbol, code int) pair.
  for (const p of pairs) {
    if (!p.codeDims || p.offset < 0 || p.v?.kind === "int") continue;
    p.decl.dims.forEach((ld, i) => {
      const cd = p.codeDims![i + p.offset];
      if (ld.value === null && ld.name && SIMPLE_DIM.test(ld.name) && cd.value !== null) bind(ld.name, cd.value, p.v!.name + " dim " + (i + p.offset));
    });
  }
  const bindings: Binding[] = [...raw].map(([symbol, values]) => {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v.value, (counts.get(v.value) ?? 0) + 1);
    let best = values[0].value;
    for (const v of values) if ((counts.get(v.value) ?? 0) > (counts.get(best) ?? 0)) best = v.value;
    return { symbol, value: best, values, conflict: counts.size > 1 };
  });
  const bound = new Map(bindings.map((b) => [b.symbol, b]));
  const lookup = (name: string): number | null => bound.get(name)?.value ?? null;
  const resolve: DimResolver = (d) => evalLatexDim(d, lookup);

  const compare = (ld: Shape, cd: Shape, offset: number): { status: CheckStatus; notes: string[] } => {
    const notes: string[] = [];
    let status: CheckStatus = "match";
    ld.forEach((l, i) => {
      const c = cd[i + offset];
      if (l.value !== null) {
        if (c.value === null) status = status === "mismatch" ? status : "unknown";
        else if (c.value !== l.value) {
          status = "mismatch";
          notes.push("dim " + i + ": " + l.value + " vs " + c.value);
        }
        return;
      }
      const name = l.name ?? "?";
      const want = resolve(l);
      if (c.value === null) {
        if (c.name && symbolKey(c.name) === symbolKey(name)) return;
        if (status !== "mismatch") status = "unknown";
        return;
      }
      if (want === null) {
        if (status !== "mismatch") status = "unknown";
        notes.push(name + " cannot be evaluated");
        return;
      }
      if (want !== c.value) {
        status = "mismatch";
        const b = bound.get(name);
        const where = b ? b.values.find((v) => v.value === want)?.source : null;
        notes.push(name + " = " + want + (where ? " (from " + where + ")" : "") + " but this dim is " + c.value);
      }
    });
    return { status, notes };
  };

  const checks: ShapeCheck[] = pairs.map((p) => {
    const base = { latexSymbol: p.decl.latex, latexName: p.decl.name, latexShape: formatLatexShape(p.decl.dims), line: p.decl.line };
    if (!p.v) {
      const mapped = mapping.get(p.decl.key);
      return { ...base, codeVar: null, codeShape: "-", status: "unknown", note: mapped ? "mapped to '" + mapped + "', which the code never assigns" : "no code variable named like " + p.decl.name + " - add a mapping" };
    }
    if (p.v.kind === "int") return { ...base, codeVar: p.v.name, codeShape: p.v.shape, status: p.decl.dims.length ? "mismatch" : "match", note: p.decl.dims.length ? "the code has a scalar int here" : "scalar" };
    if (!p.codeDims) return { ...base, codeVar: p.v.name, codeShape: p.v.shape, status: "unknown", note: "the shape of " + p.v.name + " could not be inferred" };
    const codeShape = p.v.kind === "layer" ? p.v.shape + " ~ " + formatShape(p.codeDims) : p.v.shape;
    if (p.offset < 0)
      return { ...base, codeVar: p.v.name, codeShape, status: "mismatch", note: "rank " + p.decl.dims.length + " in the paper vs " + p.codeDims.length + " in the code" };
    let res = compare(p.decl.dims, p.codeDims, p.offset);
    const notes: string[] = [];
    if (res.status === "mismatch" && p.alt) {
      const flipped = compare(p.decl.dims, p.alt, 0);
      if (flipped.status !== "mismatch") {
        res = flipped;
        notes.push("matches the stored (out, in) weight; the maths uses W^T");
      }
    } else if (p.v.kind === "layer" && p.alt && dimEq(p.alt[0], p.alt[1]) !== true) notes.push("nn.Linear stores weight as (out, in) = " + formatShape(p.alt));
    if (p.offset > 0) notes.push("ignoring leading batch dim(s) " + formatShape(p.codeDims.slice(0, p.offset)));
    return { ...base, codeVar: p.v.name, codeShape, status: res.status, note: [...res.notes, ...notes].join("; ") };
  });

  // Conflicting bindings are mismatches in their own right; flag the checks that bound the minority value.
  for (const b of bindings.filter((x) => x.conflict)) {
    const vals = [...new Set(b.values.map((v) => v.value))].join(" and ");
    for (const c of checks) {
      if (c.status === "mismatch" || !c.codeVar) continue;
      if (b.values.some((v) => v.value !== b.value && v.source.startsWith(c.codeVar + " "))) {
        c.status = "mismatch";
        c.note = (c.note ? c.note + "; " : "") + b.symbol + " is bound to " + vals;
      }
    }
  }

  // Equations: declared shapes, plus symbols an equation defines (`Q = X W_q`).
  const shapes = new Map<string, Shape>();
  for (const d of declarations) if (!shapes.has(d.key)) shapes.set(d.key, d.dims);
  const equationChecks: EquationCheck[] = [];
  for (const b of blocks) {
    for (const seg of equationSegments(b)) {
      const sides = splitTopLevel(seg.text);
      if (sides.length < 2 || sides.some((s) => !s)) continue;
      const ctx: AlgebraCtx = { shapes, dimSymbols, resolve, notes: [], errors: [], missing: new Set() };
      const evalSide = (s: string) => {
        const toks = ltokenize(s);
        const a = new Algebra(toks, ctx, s);
        const r = a.expr();
        return a.i < toks.length ? { shape: null, scalar: false } : r;
      };
      const lhsToks = ltokenize(sides[0]);
      const lhsSym = parseSymbol(lhsToks, 0, sides[0]);
      const defines = lhsSym && lhsSym.next === lhsToks.length && !shapes.has(symbolKey(lhsSym.name)) && !dimSymbols.has(lhsSym.name);
      const rhs = evalSide(sides[sides.length - 1]);
      const tensorInvolved = (r: AShape) => r.shape !== null && r.shape.length > 0;
      if (defines && ctx.errors.length) {
        equationChecks.push({ latex: seg.text, line: seg.line, lhsShape: "?", rhsShape: "?", status: "mismatch", note: ctx.errors.join("; ") });
        continue;
      }
      if (defines) {
        if (!tensorInvolved(rhs)) continue;
        shapes.set(symbolKey(lhsSym!.name), rhs.shape!);
        equationChecks.push({
          latex: seg.text,
          line: seg.line,
          lhsShape: formatLatexShape(rhs.shape!),
          rhsShape: formatLatexShape(rhs.shape!),
          status: ctx.errors.length ? "mismatch" : "match",
          note: ctx.errors.length ? ctx.errors.join("; ") : "defines " + lhsSym!.name + " as " + formatLatexShape(rhs.shape!) + (ctx.notes.length ? "; " + [...new Set(ctx.notes)].join("; ") : ""),
        });
        continue;
      }
      const lhs = evalSide(sides[0]);
      if (!tensorInvolved(lhs) && !tensorInvolved(rhs) && !ctx.errors.length) continue;
      let status: CheckStatus = "match";
      const notes = [...ctx.errors];
      if (ctx.errors.length) status = "mismatch";
      else if (!lhs.shape || !rhs.shape) {
        status = "unknown";
        notes.push(ctx.missing.size ? "no shape for " + [...ctx.missing].join(", ") : "could not read one side");
      } else {
        const strip = (s: Shape) => s.filter((d) => !isOne(d));
        const a = strip(lhs.shape);
        const c = strip(rhs.shape);
        if (a.length !== c.length) {
          status = "mismatch";
          notes.push("rank " + a.length + " vs " + c.length);
        } else {
          for (let k = 0; k < a.length; k++) {
            const eq = ldimEq(a[k], c[k], ctx);
            if (eq === false) {
              status = "mismatch";
              notes.push("dim " + k + ": " + formatDim(a[k]) + " vs " + formatDim(c[k]));
            } else if (eq === null && status === "match") {
              status = "unknown";
              notes.push(formatDim(a[k]) + " vs " + formatDim(c[k]) + " (equal only if " + formatDim(a[k]) + " = " + formatDim(c[k]) + ")");
            }
          }
        }
      }
      if (ctx.notes.length) notes.push(...new Set(ctx.notes));
      equationChecks.push({
        latex: seg.text,
        line: seg.line,
        lhsShape: lhs.shape ? formatLatexShape(lhs.shape) : "?",
        rhsShape: rhs.shape ? formatLatexShape(rhs.shape) : "?",
        status,
        note: notes.join("; "),
      });
    }
  }

  return { variables, errors, declarations, checks, bindings, equationChecks };
}

/* ------------------------------------------------------------------ sample */

export const SAMPLE_CODE = `import torch
import torch.nn as nn
import torch.nn.functional as F

# Multi-head self-attention, batch-first.
B, T, D, H = 32, 128, 512, 8
d_k = D // H

x = torch.randn(B, T, D)
W_q = nn.Linear(D, D)
W_k = nn.Linear(D, D)
W_v = nn.Linear(D, D)
W_o = nn.Linear(D, D)

q = W_q(x).view(B, T, H, d_k).transpose(1, 2)   # (B, H, T, d_k)
k = W_k(x).view(B, T, H, d_k).transpose(1, 2)
v = W_v(x).view(B, T, H, d_k).transpose(1, 2)

scores = q @ k.transpose(-2, -1) / d_k ** 0.5   # (B, H, T, T)
attn = F.softmax(scores, dim=-1)
out = (attn @ v).transpose(1, 2).reshape(B, T, D)
y = W_o(out)
`;

export const SAMPLE_LATEX = `Let $\\mathbf{X} \\in \\mathbb{R}^{n \\times d}$ be the input sequence and $h$ the number of heads.
The projections are
$$\\mathbf{W}_q, \\mathbf{W}_k \\in \\mathbb{R}^{d \\times d}, \\quad \\mathbf{W}_v \\in \\mathbb{R}^{d \\times d_k}, \\quad \\mathbf{W}_o \\in \\mathbb{R}^{d \\times d}$$
$$Q = \\mathbf{X}\\mathbf{W}_q, \\quad K = \\mathbf{X}\\mathbf{W}_k, \\quad V = \\mathbf{X}\\mathbf{W}_v$$
$$A = \\mathrm{softmax}\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$
$$\\mathbf{Y} = A\\mathbf{W}_o$$
`;
