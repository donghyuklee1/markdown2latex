/**
 * units.ts - dimensional analysis for the equations in a physics or
 * engineering derivation.
 *
 * A derivation that drops a factor of c or a whole term usually still looks
 * fine on the page; it just stops being dimensionally consistent. This reads
 * each relation as LaTeX, assigns every symbol a dimension over the seven SI
 * base dimensions (from a table of common conventions the user can override),
 * and reports both sides in base units and the nearest named quantity:
 *
 *   Left side: Energy [kg m^2 s^-2] (J), Right side: Velocity [m s^-1] - mismatch
 *
 * It also flags sums whose terms disagree ("missing term?"), arguments of
 * sin / exp / log that are not dimensionless, and symbolic exponents on
 * dimensional bases. Symbols it cannot place make a result "incomplete", never
 * a mismatch - an unknown is not evidence of an error.
 *
 * Pure: no DOM, no I/O, non-ASCII written as escapes. Never throws.
 */
import { tokenize } from "../cleaner";

/* ------------------------------------------------------------- dimensions */

/** Exponents over [M, L, T, I, \u0398, N, J]; rational (1/2 for square roots). */
export type DimVec = number[];

export const BASE_DIMENSIONS = ["M", "L", "T", "I", "\u0398", "N", "J"] as const;
const BASE_UNITS = ["kg", "m", "s", "A", "K", "mol", "cd"];

const EPS = 1e-9;
export const dimless = (): DimVec => [0, 0, 0, 0, 0, 0, 0];
const vec = (M = 0, L = 0, T = 0, I = 0, K = 0, N = 0, J = 0): DimVec => [M, L, T, I, K, N, J];
const mul = (a: DimVec, b: DimVec) => a.map((x, i) => x + b[i]);
const div = (a: DimVec, b: DimVec) => a.map((x, i) => x - b[i]);
const scale = (a: DimVec, k: number) => a.map((x) => x * k);
export const dimEqual = (a: DimVec, b: DimVec) => a.every((x, i) => Math.abs(x - b[i]) < EPS);
export const isDimensionless = (a: DimVec) => a.every((x) => Math.abs(x) < EPS);

/** 0.5 -> "1/2"; integers stay integers. */
function fraction(x: number): string {
  for (let d = 1; d <= 12; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < EPS) return d === 1 ? String(n) : n + "/" + d;
  }
  return x.toFixed(3);
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "\u2070", "1": "\u00b9", "2": "\u00b2", "3": "\u00b3", "4": "\u2074",
  "5": "\u2075", "6": "\u2076", "7": "\u2077", "8": "\u2078", "9": "\u2079", "-": "\u207b",
};

/** `kg\u00b7m\u00b2\u00b7s\u207b\u00b2`; fractional exponents as `m^(1/2)`. */
export function formatBaseUnits(d: DimVec): string {
  const parts: string[] = [];
  d.forEach((e, i) => {
    if (Math.abs(e) < EPS) return;
    const f = fraction(e);
    if (f === "1") parts.push(BASE_UNITS[i]);
    else if (/^-?\d+$/.test(f)) parts.push(BASE_UNITS[i] + f.split("").map((c) => SUPERSCRIPT[c]).join(""));
    else parts.push(BASE_UNITS[i] + "^(" + f + ")");
  });
  return parts.length ? parts.join("\u00b7") : "1";
}

/* ------------------------------------------------------------- quantities */

export interface Quantity {
  id: string;
  label: string;
  dims: DimVec;
  /** Named SI unit, when there is one. */
  unit?: string;
}

/** Named quantities, in preference order: the first match names a dimension. */
export const QUANTITIES: Quantity[] = [
  { id: "dimensionless", label: "Dimensionless", dims: vec() },
  { id: "length", label: "Length", dims: vec(0, 1), unit: "m" },
  { id: "mass", label: "Mass", dims: vec(1), unit: "kg" },
  { id: "time", label: "Time", dims: vec(0, 0, 1), unit: "s" },
  { id: "current", label: "Current", dims: vec(0, 0, 0, 1), unit: "A" },
  { id: "temperature", label: "Temperature", dims: vec(0, 0, 0, 0, 1), unit: "K" },
  { id: "amount", label: "Amount of substance", dims: vec(0, 0, 0, 0, 0, 1), unit: "mol" },
  { id: "luminous", label: "Luminous intensity", dims: vec(0, 0, 0, 0, 0, 0, 1), unit: "cd" },
  { id: "area", label: "Area", dims: vec(0, 2) },
  { id: "volume", label: "Volume", dims: vec(0, 3) },
  { id: "velocity", label: "Velocity", dims: vec(0, 1, -1) },
  { id: "acceleration", label: "Acceleration", dims: vec(0, 1, -2) },
  { id: "force", label: "Force", dims: vec(1, 1, -2), unit: "N" },
  { id: "energy", label: "Energy", dims: vec(1, 2, -2), unit: "J" },
  { id: "power", label: "Power", dims: vec(1, 2, -3), unit: "W" },
  { id: "pressure", label: "Pressure", dims: vec(1, -1, -2), unit: "Pa" },
  { id: "momentum", label: "Momentum", dims: vec(1, 1, -1) },
  { id: "frequency", label: "Frequency", dims: vec(0, 0, -1), unit: "Hz" },
  { id: "wavenumber", label: "Wavenumber", dims: vec(0, -1) },
  { id: "charge", label: "Charge", dims: vec(0, 0, 1, 1), unit: "C" },
  { id: "voltage", label: "Voltage", dims: vec(1, 2, -3, -1), unit: "V" },
  { id: "resistance", label: "Resistance", dims: vec(1, 2, -3, -2), unit: "\u03a9" },
  { id: "capacitance", label: "Capacitance", dims: vec(-1, -2, 4, 2), unit: "F" },
  { id: "inductance", label: "Inductance", dims: vec(1, 2, -2, -2), unit: "H" },
  { id: "conductance", label: "Conductance", dims: vec(-1, -2, 3, 2), unit: "S" },
  { id: "magnetic-field", label: "Magnetic field", dims: vec(1, 0, -2, -1), unit: "T" },
  { id: "magnetic-flux", label: "Magnetic flux", dims: vec(1, 2, -2, -1), unit: "Wb" },
  { id: "electric-field", label: "Electric field", dims: vec(1, 1, -3, -1) },
  { id: "density", label: "Density", dims: vec(1, -3) },
  { id: "action", label: "Action / angular momentum", dims: vec(1, 2, -1) },
  { id: "entropy", label: "Entropy / heat capacity", dims: vec(1, 2, -2, 0, -1) },
  { id: "molar-gas", label: "Molar gas constant", dims: vec(1, 2, -2, 0, -1, -1) },
  { id: "gravitational", label: "Gravitational constant", dims: vec(-1, 3, -2) },
  { id: "permittivity", label: "Permittivity", dims: vec(-1, -3, 4, 2) },
  { id: "permeability", label: "Permeability", dims: vec(1, 1, -2, -2) },
  { id: "spring", label: "Spring constant", dims: vec(1, 0, -2) },
  { id: "stefan", label: "Stefan-Boltzmann constant", dims: vec(1, 0, -3, 0, -4) },
  { id: "per-amount", label: "Per mole", dims: vec(0, 0, 0, 0, 0, -1) },
  { id: "intensity", label: "Intensity", dims: vec(1, 0, -3) },
  { id: "viscosity", label: "Dynamic viscosity", dims: vec(1, -1, -1) },
  { id: "kinematic-viscosity", label: "Diffusivity", dims: vec(0, 2, -1) },
  { id: "specific-heat", label: "Specific heat", dims: vec(0, 2, -2, 0, -1) },
  { id: "molar-mass", label: "Molar mass", dims: vec(1, 0, 0, 0, 0, -1) },
  { id: "concentration", label: "Concentration", dims: vec(0, -3, 0, 0, 0, 1) },
  { id: "current-density", label: "Current density", dims: vec(0, -2, 0, 1) },
  { id: "charge-density", label: "Charge density", dims: vec(0, -3, 1, 1) },
  { id: "angular-acceleration", label: "Angular acceleration", dims: vec(0, 0, -2) },
  { id: "jerk", label: "Jerk", dims: vec(0, 1, -3) },
  { id: "torque", label: "Torque", dims: vec(1, 2, -2) },
];
const QUANTITY_BY_ID = new Map(QUANTITIES.map((q) => [q.id, q]));

export function nearestQuantity(d: DimVec): Quantity | null {
  return QUANTITIES.find((q) => dimEqual(q.dims, d)) ?? null;
}

/** `Energy [kg\u00b7m\u00b2\u00b7s\u207b\u00b2] (J)`, or just the bracket when unnamed. */
export function describeDims(d: DimVec): string {
  const q = nearestQuantity(d);
  const base = "[" + formatBaseUnits(d) + "]";
  if (!q) return base;
  return q.label + " " + base + (q.unit && q.id !== "dimensionless" && q.unit !== formatBaseUnits(d) ? " (" + q.unit + ")" : "");
}

/* ------------------------------------------------------------------ units */

const UNITS: Record<string, DimVec> = {
  m: vec(0, 1), g: vec(1), s: vec(0, 0, 1), A: vec(0, 0, 0, 1), K: vec(0, 0, 0, 0, 1), mol: vec(0, 0, 0, 0, 0, 1), cd: vec(0, 0, 0, 0, 0, 0, 1),
  N: vec(1, 1, -2), J: vec(1, 2, -2), W: vec(1, 2, -3), Pa: vec(1, -1, -2), C: vec(0, 0, 1, 1), V: vec(1, 2, -3, -1),
  "\u03a9": vec(1, 2, -3, -2), Ohm: vec(1, 2, -3, -2), ohm: vec(1, 2, -3, -2), Hz: vec(0, 0, -1), eV: vec(1, 2, -2),
  F: vec(-1, -2, 4, 2), H: vec(1, 2, -2, -2), T: vec(1, 0, -2, -1), Wb: vec(1, 2, -2, -1), S: vec(-1, -2, 3, 2),
  L: vec(0, 3), min: vec(0, 0, 1), h: vec(0, 0, 1), rad: vec(), sr: vec(), bar: vec(1, -1, -2), atm: vec(1, -1, -2),
};
const PREFIXES = new Set(["k", "m", "\u03bc", "\u00b5", "u", "n", "M", "G", "c", "p", "d"]);

function unitWord(w: string): DimVec | null {
  if (UNITS[w]) return UNITS[w];
  if (w.length > 1 && PREFIXES.has(w[0]) && UNITS[w.slice(1)]) return UNITS[w.slice(1)];
  return null;
}

/**
 * A unit expression: `m/s^2`, `kg m^2 s^-2`, `J/(mol K)`, `kg\u00b7m\u00b2`,
 * `\mu m`, `k\Omega`. Everything after a `/` is in the denominator until the
 * next `/`, which is how `J/mol K` is meant when people write it.
 */
export function parseUnitExpression(raw: string): DimVec | null {
  const s = raw
    .replace(/\\(mathrm|text|textrm|operatorname|mbox)\s*/g, "")
    .replace(/\\mu\s*/g, "\u03bc")
    .replace(/\\Omega/g, "\u03a9")
    .replace(/\\(cdot|times)/g, "*")
    .replace(/\\[,;:! ]|~/g, " ")
    .replace(/[\u00b2\u00b3\u00b9\u2070\u2074-\u2079\u207b]+/g, (m) => "^" + m.split("").map((c) => Object.keys(SUPERSCRIPT).find((k) => SUPERSCRIPT[k] === c) ?? "").join(""))
    .replace(/[{}]/g, "")
    .trim();
  if (!s) return null;
  const re = /\s*([A-Za-z\u03bc\u00b5\u03a9]+|\^\s*\(?-?\d+(?:\/\d+)?\)?|-?\d+(?:\/\d+)?|[*/\u00b7()])/y;
  const toks: string[] = [];
  let pos = 0;
  for (;;) {
    re.lastIndex = pos;
    const m = re.exec(s);
    if (!m) break;
    toks.push(m[1]);
    pos = re.lastIndex;
  }
  if (s.slice(pos).trim()) return null;
  let i = 0;
  const num = (t: string) => {
    const [a, b] = t.replace(/[\^()\s]/g, "").split("/");
    return b ? Number(a) / Number(b) : Number(a);
  };
  const factor = (): DimVec | null => {
    const t = toks[i];
    if (t === undefined) return null;
    let d: DimVec | null;
    if (t === "(") {
      i++;
      d = product();
      if (toks[i] === ")") i++;
    } else if (/^[A-Za-z\u03bc\u00b5\u03a9]+$/.test(t)) {
      i++;
      d = unitWord(t);
      if (!d) return null;
    } else if (t === "1") {
      i++;
      d = dimless();
    } else return null;
    if (d && toks[i] && (toks[i].startsWith("^") || /^-?\d/.test(toks[i]))) d = scale(d, num(toks[i++]));
    return d;
  };
  const product = (): DimVec | null => {
    let acc = dimless();
    let denom = false;
    while (i < toks.length && toks[i] !== ")") {
      const t = toks[i];
      if (t === "/") {
        denom = true;
        i++;
        continue;
      }
      if (t === "*" || t === "\u00b7") {
        i++;
        continue;
      }
      const f = factor();
      if (!f) return null;
      acc = denom ? div(acc, f) : mul(acc, f);
    }
    return acc;
  };
  const d = product();
  return i === toks.length ? d : null;
}

/* ----------------------------------------------------------- symbol table */

export interface SymbolDefault {
  quantity: string;
  description: string;
  /** Present when the letter is ambiguous: what else it could mean. */
  note?: string;
}

/** Common physics conventions. Every entry can be overridden in the UI. */
export const DEFAULT_SYMBOLS: Record<string, SymbolDefault> = {
  E: { quantity: "energy", description: "energy", note: "also electric field - override if so" },
  W: { quantity: "energy", description: "work" },
  U: { quantity: "energy", description: "potential / internal energy" },
  K: { quantity: "energy", description: "kinetic energy" },
  Q: { quantity: "charge", description: "charge", note: "also heat - override to energy if so" },
  q: { quantity: "charge", description: "charge" },
  m: { quantity: "mass", description: "mass" },
  M: { quantity: "mass", description: "mass" },
  c: { quantity: "velocity", description: "speed of light" },
  v: { quantity: "velocity", description: "velocity" },
  u: { quantity: "velocity", description: "velocity" },
  a: { quantity: "acceleration", description: "acceleration" },
  g: { quantity: "acceleration", description: "gravitational acceleration" },
  F: { quantity: "force", description: "force" },
  p: { quantity: "momentum", description: "momentum" },
  P: { quantity: "power", description: "power", note: "could also be pressure - override if so" },
  t: { quantity: "time", description: "time" },
  "\\tau": { quantity: "time", description: "time constant" },
  x: { quantity: "length", description: "position" },
  y: { quantity: "length", description: "position" },
  z: { quantity: "length", description: "position" },
  r: { quantity: "length", description: "radius / distance" },
  d: { quantity: "length", description: "distance" },
  s: { quantity: "length", description: "displacement" },
  h: { quantity: "length", description: "height", note: "read as Planck's constant when a frequency or wavelength appears in the same equation" },
  L: { quantity: "length", description: "length" },
  l: { quantity: "length", description: "length" },
  "\\ell": { quantity: "length", description: "length" },
  "\\lambda": { quantity: "length", description: "wavelength" },
  "\\omega": { quantity: "frequency", description: "angular frequency" },
  "\\Omega": { quantity: "frequency", description: "angular frequency" },
  f: { quantity: "frequency", description: "frequency" },
  "\\nu": { quantity: "frequency", description: "frequency" },
  k: { quantity: "wavenumber", description: "wavenumber", note: "could also be a spring constant - override if so" },
  T: { quantity: "temperature", description: "temperature", note: "could also be a period - override to time if so" },
  V: { quantity: "voltage", description: "voltage", note: "could also be volume - override if so" },
  I: { quantity: "current", description: "current" },
  R: { quantity: "resistance", description: "resistance", note: "could also be the gas constant or a radius - override if so" },
  C: { quantity: "capacitance", description: "capacitance" },
  B: { quantity: "magnetic-field", description: "magnetic field" },
  "\\rho": { quantity: "density", description: "density" },
  A: { quantity: "area", description: "area", note: "also an amplitude - override if so" },
  "\\hbar": { quantity: "action", description: "reduced Planck constant" },
  k_B: { quantity: "entropy", description: "Boltzmann constant" },
  G: { quantity: "gravitational", description: "gravitational constant" },
  "\\epsilon_0": { quantity: "permittivity", description: "vacuum permittivity" },
  "\\varepsilon_0": { quantity: "permittivity", description: "vacuum permittivity" },
  "\\mu_0": { quantity: "permeability", description: "vacuum permeability" },
  e: { quantity: "charge", description: "elementary charge" },
  N_A: { quantity: "per-amount", description: "Avogadro constant" },
  n: { quantity: "amount", description: "amount of substance", note: "could also be a count or refractive index - override to dimensionless if so" },
  N: { quantity: "dimensionless", description: "count" },
  "\\sigma": { quantity: "stefan", description: "Stefan-Boltzmann constant", note: "could also be conductivity or a cross-section - override if so" },
  "\\theta": { quantity: "dimensionless", description: "angle" },
  "\\phi": { quantity: "dimensionless", description: "phase / angle" },
  "\\varphi": { quantity: "dimensionless", description: "phase / angle" },
  "\\alpha": { quantity: "dimensionless", description: "angle / fine-structure constant" },
  "\\beta": { quantity: "dimensionless", description: "angle / ratio" },
  "\\gamma": { quantity: "dimensionless", description: "Lorentz factor" },
  "\\pi": { quantity: "dimensionless", description: "pi" },
};

const PLANCK: SymbolDefault = { quantity: "action", description: "Planck constant", note: "read as Planck's constant because a frequency or wavelength appears in this equation" };

/** A symbol-table override: a quantity id or label, or a unit expression. */
export function parseOverride(text: string): DimVec | null {
  const t = text.trim();
  if (!t) return null;
  const q = QUANTITY_BY_ID.get(t) ?? QUANTITIES.find((x) => x.label.toLowerCase() === t.toLowerCase());
  if (q) return q.dims;
  return parseUnitExpression(t);
}

/* ---------------------------------------------------------------- results */

export type NoteKind = "sum" | "function" | "power" | "unknown" | "assumption" | "relation";

export interface UnitNote {
  kind: NoteKind;
  message: string;
}

export interface SideResult {
  latex: string;
  dims: DimVec | null;
  text: string;
}

export type UnitStatus = "consistent" | "mismatch" | "incomplete" | "skipped";

export interface EquationResult {
  latex: string;
  line: number | null;
  status: UnitStatus;
  sides: SideResult[];
  message: string;
  notes: UnitNote[];
  symbols: string[];
}

export interface SymbolInfo {
  symbol: string;
  quantity: string;
  dims: DimVec | null;
  dimsText: string;
  source: "default" | "override" | "unknown";
  description: string;
  note?: string;
}

export interface UnitsAnalysis {
  results: EquationResult[];
  symbols: SymbolInfo[];
}

export interface EquationSource {
  latex: string;
  line: number | null;
}

/* ------------------------------------------------------------------ lexer */

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
    if (c === "\\") {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i, i + 40));
      const v = m ? m[1] : "";
      out.push({ t: "cmd", v, pos: i, end: i + 1 + v.length });
      i += 1 + v.length;
      continue;
    }
    if (/[0-9.]/.test(c) && /[0-9]/.test(src[c === "." ? i + 1 : i] ?? "")) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i, i + 40))!;
      out.push({ t: "num", v: m[0], pos: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    if (c === "{" || c === "}") out.push({ t: c === "{" ? "open" : "close", v: c, pos: i, end: i + 1 });
    else if (c === "^" || c === "_") out.push({ t: c === "^" ? "sup" : "sub", v: c, pos: i, end: i + 1 });
    else out.push({ t: "char", v: c, pos: i, end: i + 1 });
    i++;
  }
  return out;
}

/** Brace group (or single token) at `i`: [inner tokens, next index]. */
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

const FONT = new Set(["mathbf", "boldsymbol", "bm", "vec", "hat", "tilde", "bar", "overline", "mathit", "mathcal", "widehat", "widetilde", "overrightarrow", "mathsf", "pmb"]);
const TEXTY = new Set(["mathrm", "text", "textrm", "operatorname", "mbox", "textit", "mathrm*"]);
const SPACING = new Set([",", ";", ":", "!", " ", "quad", "qquad", "displaystyle", "textstyle", "nonumber", "notag", "limits", "big", "Big", "bigg", "Bigg", "bigl", "bigr", "Bigl", "Bigr"]);
const FUNCTIONS = new Set(["sin", "cos", "tan", "sec", "csc", "cot", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "exp", "ln", "log", "lg", "erf", "coth", "arsinh"]);
const RELATIONS = new Set(["=", "<", ">", "approx", "simeq", "equiv", "le", "leq", "ge", "geq", "neq", "ne", "sim", "propto", "ll", "gg", "lesssim", "gtrsim", "cong", "leqslant", "geqslant", "coloneqq", "eqqcolon", "doteq"]);
const LOOSE = new Set(["propto", "sim"]);
const NAMED_DIMLESS = new Set(["pi", "infty", "circ"]);

/** Text of a token run, fonts removed: `E_{\text{kin}}` -> `E_kin`. */
function plain(toks: LTok[]): string {
  let s = "";
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "cmd" && (FONT.has(t.v) || TEXTY.has(t.v))) {
      const [g, nx] = group(toks, i + 1);
      s += plain(g);
      i = nx - 1;
    } else if (t.t === "cmd") {
      if (!SPACING.has(t.v)) s += "\\" + t.v;
    } else if (t.t !== "open" && t.t !== "close") s += t.v;
  }
  return s;
}

const isRelation = (t: LTok | undefined) => !!t && ((t.t === "char" && (t.v === "=" || t.v === "<" || t.v === ">")) || (t.t === "cmd" && RELATIONS.has(t.v)));

/** A numeric exponent: `2`, `-1`, `1/2`, `\frac{3}{2}`, `-\frac12`, `0.5`. */
function numberOf(toks: LTok[]): number | null {
  const s = plain(toks.filter((t) => !(t.t === "cmd" && SPACING.has(t.v)))).replace(/\s+/g, "");
  let m = /^([+-]?)(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/.exec(s);
  if (m) return (m[1] === "-" ? -1 : 1) * (m[3] ? Number(m[2]) / Number(m[3]) : Number(m[2]));
  m = /^([+-]?)\\[dt]?frac(\d)(\d)$/.exec(s);
  if (m) return (m[1] === "-" ? -1 : 1) * (Number(m[2]) / Number(m[3]));
  // `\frac{1}{2}` comes through plain() as `\frac12` once braces drop.
  return null;
}

/* ----------------------------------------------------------------- parser */

interface Ctx {
  src: string;
  lookup: (name: string) => DimVec | null;
  notes: UnitNote[];
  unknown: Set<string>;
  seen: Set<string>;
}

const snippet = (ctx: Ctx, toks: LTok[], from: number, to: number) => (from < to ? ctx.src.slice(toks[from].pos, toks[to - 1].end).trim() : "");

class Parser {
  i: number;
  absDepth = 0;
  /** Index just past the last unit read, so `\mathrm{m}\,\mathrm{s}` chains. */
  unitEnd = -1;
  constructor(public toks: LTok[], public ctx: Ctx, public inIntegral = false, start = 0, public end = toks.length) {
    this.i = start;
  }
  peek(o = 0): LTok | undefined {
    return this.i + o < this.end ? this.toks[this.i + o] : undefined;
  }
  isChar(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "char" && t.v === v;
  }
  isCmd(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.t === "cmd" && t.v === v;
  }
  skipSpace() {
    while (this.peek() && this.peek()!.t === "cmd" && SPACING.has(this.peek()!.v) && this.peek()!.v !== "quad" && this.peek()!.v !== "qquad") this.i++;
  }
  sub(toks: LTok[], inIntegral = this.inIntegral): DimVec | null {
    const p = new Parser(toks, this.ctx, inIntegral);
    const d = p.expr();
    return d;
  }

  /** A differential marker at `o`: `d`, `\mathrm{d}`, `\partial`, `\delta`? (not \delta). */
  markerAt(o = 0): number {
    const t = this.peek(o);
    if (!t) return 0;
    if (t.t === "cmd" && t.v === "partial") return 1;
    if (t.t === "char" && t.v === "d") return 1;
    if (t.t === "cmd" && TEXTY.has(t.v)) {
      const [g, nx] = group(this.toks, this.i + o + 1);
      if (plain(g) === "d") return nx - (this.i + o);
    }
    return 0;
  }

  /** Inside an integral: `d x`, `\,dx`, `\mathrm{d}t` ends the integrand. */
  atDifferential(): boolean {
    if (!this.inIntegral) return false;
    const m = this.markerAt();
    if (!m) return false;
    const nx = this.peek(m);
    return !!nx && ((nx.t === "char" && /[A-Za-z]/.test(nx.v)) || (nx.t === "cmd" && !SPACING.has(nx.v) && !RELATIONS.has(nx.v)));
  }

  atEndOfTerm(): boolean {
    const t = this.peek();
    if (!t) return true;
    if (t.t === "close") return true;
    if (t.t === "char" && "+-=<>,;&)]".includes(t.v)) return true;
    if (t.t === "char" && t.v === "|" && this.absDepth > 0) return true;
    if (t.t === "cmd" && (t.v === "right" || t.v === "pm" || t.v === "mp" || t.v === "}" || t.v === "\\" || t.v === "quad" || t.v === "qquad" || RELATIONS.has(t.v))) return true;
    return this.atDifferential();
  }

  expr(): DimVec | null {
    this.skipSpace();
    const terms: Array<{ d: DimVec | null; text: string }> = [];
    if (this.isChar("-") || this.isChar("+") || this.isCmd("pm") || this.isCmd("mp")) this.i++;
    for (;;) {
      const from = this.i;
      const d = this.term();
      terms.push({ d, text: snippet(this.ctx, this.toks, from, this.i) });
      this.skipSpace();
      if (this.isChar("+") || this.isChar("-") || this.isCmd("pm") || this.isCmd("mp")) {
        this.i++;
        continue;
      }
      break;
    }
    const known = terms.filter((t) => t.d) as Array<{ d: DimVec; text: string }>;
    if (!known.length) return null;
    const first = known[0];
    for (const t of known.slice(1)) {
      if (!dimEqual(t.d, first.d)) {
        this.ctx.notes.push({
          kind: "sum",
          message: "Inconsistent sum: " + first.text + " is " + describeDims(first.d) + " but " + t.text + " is " + describeDims(t.d) + " - missing term?",
        });
        break;
      }
    }
    return first.d;
  }

  term(): DimVec | null {
    if (this.atEndOfTerm()) return null;
    let d = this.factor();
    for (;;) {
      this.skipSpace();
      if (this.atEndOfTerm()) return d;
      if (this.isChar("/")) {
        this.i++;
        const e = this.factor();
        d = d && e ? div(d, e) : null;
        continue;
      }
      if (this.isCmd("cdot") || this.isCmd("times") || this.isChar("*") || this.isCmd("ast")) {
        this.i++;
        const e = this.factor();
        d = d && e ? mul(d, e) : null;
        continue;
      }
      const before = this.i;
      const e = this.factor();
      if (this.i === before) {
        this.i++;
        continue;
      }
      d = d && e ? mul(d, e) : null;
    }
  }

  factor(): DimVec | null {
    this.skipSpace();
    if (this.isChar("-") || this.isChar("+")) this.i++;
    let d = this.atom();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "sup") {
        const [g, nx] = group(this.toks, this.i + 1);
        this.i = nx;
        d = this.power(d, g);
        continue;
      }
      if (t && t.t === "char" && (t.v === "'" || t.v === "!")) {
        this.i++;
        continue;
      }
      return d;
    }
  }

  power(base: DimVec | null, exp: LTok[]): DimVec | null {
    const p = plain(exp);
    if (p === "*" || p === "\\prime" || p === "\\dagger" || p === "T" || p === "\\top" || p === "+" || p === "-" || /^\\prime+$/.test(p)) return base;
    if (p === "\\circ") return base; // degrees
    const n = numberOf(exp);
    if (n !== null) return base ? scale(base, n) : null;
    // `x^{\frac{1}{2}}`
    const f = /^\\[dt]?frac/.test(p) ? this.fracNumber(exp) : null;
    if (f !== null) return base ? scale(base, f) : null;
    const ed = this.sub(exp, false);
    if (ed && !isDimensionless(ed)) this.ctx.notes.push({ kind: "power", message: "Exponent " + p + " is " + describeDims(ed) + " - exponents must be dimensionless" });
    if (base && !isDimensionless(base)) {
      this.ctx.notes.push({ kind: "power", message: "Symbolic exponent " + p + " on a dimensional base (" + describeDims(base) + ")" });
      return null;
    }
    return base;
  }

  fracNumber(exp: LTok[]): number | null {
    let k = 0;
    let sign = 1;
    if (exp[0]?.t === "char" && exp[0].v === "-") {
      sign = -1;
      k = 1;
    }
    if (!(exp[k]?.t === "cmd" && /^[dt]?frac$/.test(exp[k].v))) return null;
    const [a, n1] = group(exp, k + 1);
    const [b, n2] = group(exp, n1);
    if (n2 !== exp.length) return null;
    const x = numberOf(a);
    const y = numberOf(b);
    return x !== null && y ? (sign * x) / y : null;
  }

  /** Parenthesized or braced argument, or the following implicit product. */
  argument(): { d: DimVec | null; text: string } {
    this.skipSpace();
    const from = this.i;
    let d: DimVec | null;
    if (this.isChar("(") || this.isChar("[") || this.isCmd("left") || (this.peek()?.t === "open")) d = this.atom();
    else {
      // `\sin \omega t`: the argument is the implicit product that follows.
      d = this.factor();
      for (;;) {
        this.skipSpace();
        const t = this.peek();
        if (!t || this.atEndOfTerm() || this.isChar("/") || this.isCmd("cdot") || this.isCmd("times")) break;
        if (t.t === "cmd" && FUNCTIONS.has(t.v)) break;
        const before = this.i;
        const e = this.factor();
        if (this.i === before) break;
        d = d && e ? mul(d, e) : null;
      }
    }
    return { d, text: snippet(this.ctx, this.toks, from, this.i) };
  }

  bracketed(close: (t: LTok) => boolean): DimVec | null {
    const d = this.expr();
    while (this.peek() && !close(this.peek()!)) {
      // Recover from anything expr() stopped at: keep reading to the closer.
      this.i++;
      this.expr();
    }
    if (this.peek()) this.i++;
    return d;
  }

  atom(): DimVec | null {
    this.skipSpace();
    const t = this.peek();
    if (!t) return null;
    const ctx = this.ctx;

    if (t.t === "num") {
      this.i++;
      return dimless();
    }
    if (t.t === "open") {
      const [g, nx] = group(this.toks, this.i);
      this.i = nx;
      return this.sub(g);
    }
    if (t.t === "char") {
      if (t.v === "(" || t.v === "[") {
        this.i++;
        const close = t.v === "(" ? ")" : "]";
        return this.bracketed((u) => u.t === "char" && u.v === close);
      }
      if (t.v === "|") {
        this.i++;
        this.absDepth++;
        const d = this.expr();
        this.absDepth--;
        if (this.isChar("|")) this.i++;
        return d;
      }
      if (/[A-Za-z]/.test(t.v)) {
        // e^{...}: Euler's number, exponent must be dimensionless.
        if (t.v === "e" && this.peek(1)?.t === "sup") return this.exponential();
        return this.symbol();
      }
      this.i++;
      return dimless();
    }
    if (t.t === "cmd") {
      const v = t.v;
      if (v === "left") {
        this.i++;
        const open = this.peek();
        this.i++;
        if (open && open.t === "char" && open.v === "|") {
          this.absDepth++;
          const d = this.expr();
          this.absDepth--;
          if (this.isCmd("right")) this.i += 2;
          return d;
        }
        const d = this.expr();
        while (this.peek() && !this.isCmd("right")) {
          this.i++;
          this.expr();
        }
        if (this.isCmd("right")) this.i += 2;
        return d;
      }
      if (v === "{") {
        this.i++;
        return this.bracketed((u) => u.t === "cmd" && u.v === "}");
      }
      if (v === "frac" || v === "dfrac" || v === "tfrac" || v === "cfrac") return this.fraction();
      if (v === "sqrt") {
        this.i++;
        let n = 2;
        if (this.isChar("[")) {
          const st = this.i + 1;
          while (this.peek() && !this.isChar("]")) this.i++;
          n = numberOf(this.toks.slice(st, this.i)) ?? 2;
          this.i++;
        }
        const [g, nx] = group(this.toks, this.i);
        this.i = nx;
        const d = this.sub(g);
        return d ? scale(d, 1 / n) : null;
      }
      if (FUNCTIONS.has(v)) return this.func(v);
      if (v === "nabla") {
        this.i++;
        return vec(0, -1);
      }
      if (v === "partial") {
        this.i++;
        if (this.peek()?.t === "sub") {
          const [g, nx] = group(this.toks, this.i + 1);
          this.i = nx;
          const d = this.sub(g, false);
          return d ? scale(d, -1) : null;
        }
        return dimless();
      }
      if (v === "int" || v === "iint" || v === "iiint" || v === "oint") return this.integral();
      if (v === "sum" || v === "prod" || v === "lim" || v === "max" || v === "min" || v === "sup" || v === "inf") {
        this.i++;
        while (this.peek()?.t === "sub" || this.peek()?.t === "sup") this.i = group(this.toks, this.i + 1)[1];
        if (v === "prod") {
          this.argument();
          ctx.notes.push({ kind: "assumption", message: "\\prod is treated as dimensionless" });
          return dimless();
        }
        return this.argument().d;
      }
      if (v === "Delta" || v === "delta") {
        const nx = this.peek(1);
        if (nx && ((nx.t === "char" && /[A-Za-z]/.test(nx.v)) || (nx.t === "cmd" && (FONT.has(nx.v) || /^[a-zA-Z]+$/.test(nx.v) && !SPACING.has(nx.v) && !RELATIONS.has(nx.v) && !FUNCTIONS.has(nx.v))))) {
          this.i++;
          return this.factor();
        }
      }
      if (v === "dot" || v === "ddot") {
        const [g, nx] = group(this.toks, this.i + 1);
        this.i = nx;
        const d = this.sub(g, false);
        return d ? div(d, scale(vec(0, 0, 1), v === "dot" ? 1 : 2)) : null;
      }
      if (TEXTY.has(v)) {
        const [g, nx] = group(this.toks, this.i + 1);
        const text = plain(g).trim();
        if (text === "d") {
          this.i = nx;
          return dimless();
        }
        if (text === "e" && this.toks[nx]?.t === "sup") {
          this.i = nx - 1;
          return this.exponential();
        }
        if (FUNCTIONS.has(text)) {
          this.i = nx - 1;
          return this.func(text);
        }
        const raw = ctx.src.slice(g.length ? g[0].pos : t.end, g.length ? g[g.length - 1].end : t.end);
        const unit = parseUnitExpression(raw);
        // Multi-letter unit strings are units; a lone letter only after a number or another unit.
        if (unit && (!/^[A-Za-z]$/.test(text) || this.prevIsNumber())) {
          this.i = nx;
          this.unitEnd = nx;
          return unit;
        }
        if (/^[A-Za-z](_.*)?$/.test(text) || /^\\[A-Za-z]+$/.test(text)) return this.symbol();
        // A word annotation (`\text{const}`): no dimension of its own.
        this.i = nx;
        return dimless();
      }
      if (FONT.has(v)) return this.symbol();
      if (NAMED_DIMLESS.has(v)) {
        this.i++;
        return dimless();
      }
      if (/^[A-Za-z]+$/.test(v) && !RELATIONS.has(v) && !SPACING.has(v)) return this.symbol();
      this.i++;
      return dimless();
    }
    this.i++;
    return dimless();
  }

  /** After a number or a unit: `9.8\,\mathrm{m}\,\mathrm{s}^{-2}` reads m and s as units. */
  prevIsNumber(): boolean {
    let k = this.i - 1;
    while (k >= 0 && this.toks[k].t === "cmd" && SPACING.has(this.toks[k].v)) k--;
    if (k >= 0 && this.toks[k].t === "num" && this.toks[k - 1]?.t === "sup") {
      // `\mathrm{m}^2\,\mathrm{s}`: skip the exponent back to the unit.
      k -= 2;
    }
    return k >= 0 && (this.toks[k].t === "num" || k === this.unitEnd - 1);
  }

  exponential(): DimVec | null {
    this.i++;
    const [g, nx] = group(this.toks, this.i + 1);
    this.i = nx;
    const d = this.sub(g, false);
    if (d && !isDimensionless(d))
      this.ctx.notes.push({ kind: "function", message: "Argument of e^{...} is " + describeDims(d) + " - must be dimensionless" });
    return dimless();
  }

  func(name: string): DimVec | null {
    this.i++;
    // `\sin^2 x`, `\log_{10} x`
    while (this.peek()?.t === "sup" || this.peek()?.t === "sub") this.i = group(this.toks, this.i + 1)[1];
    const arg = this.argument();
    if (arg.d && !isDimensionless(arg.d))
      this.ctx.notes.push({ kind: "function", message: "\\" + name + " of " + arg.text + ": the argument is " + describeDims(arg.d) + " - must be dimensionless" });
    return dimless();
  }

  integral(): DimVec | null {
    this.i++;
    while (this.peek()?.t === "sub" || this.peek()?.t === "sup") this.i = group(this.toks, this.i + 1)[1];
    const start = this.i;
    const p = new Parser(this.toks, this.ctx, true, this.i, this.end);
    let d = p.expr();
    if (p.i === start) d = dimless(); // `\int dx`
    this.i = p.i;
    let found = 0;
    for (;;) {
      this.skipSpace();
      const m = this.inIntegralMarker();
      if (!m) break;
      this.i += m;
      const v = this.symbol();
      d = d && v ? mul(d, v) : null;
      found++;
    }
    if (!found) this.ctx.notes.push({ kind: "assumption", message: "Integral without a visible differential (dx) - treated as its integrand" });
    return d;
  }

  inIntegralMarker(): number {
    const m = this.markerAt();
    if (!m) return 0;
    const nx = this.peek(m);
    return nx && ((nx.t === "char" && /[A-Za-z]/.test(nx.v)) || (nx.t === "cmd" && /^[A-Za-z]+$/.test(nx.v) && !SPACING.has(nx.v))) ? m : 0;
  }

  /** `\frac{a}{b}`, with Leibniz derivatives `\frac{d^2x}{dt^2}` / `\frac{\partial u}{\partial x}`. */
  fraction(): DimVec | null {
    const [num, n1] = group(this.toks, this.i + 1);
    const [den, n2] = group(this.toks, n1);
    this.i = n2;
    const deriv = this.derivative(num, den);
    if (deriv !== undefined) return deriv;
    const a = this.sub(num);
    const b = this.sub(den);
    return a && b ? div(a, b) : null;
  }

  derivative(num: LTok[], den: LTok[]): DimVec | null | undefined {
    const pn = new Parser(num, this.ctx, false);
    const pd = new Parser(den, this.ctx, false);
    const mn = pn.markerAt();
    const md = pd.markerAt();
    if (!mn || !md) return undefined;
    pn.i += mn;
    if (pn.peek()?.t === "sup") pn.i = group(num, pn.i + 1)[1];
    // Numerator: what is differentiated (empty for the operator form d/dt).
    const top = pn.i < num.length ? new Parser(num, this.ctx, false, pn.i).expr() : dimless();
    let bottom: DimVec | null = dimless();
    while (pd.i < den.length) {
      pd.skipSpace();
      const m = pd.markerAt();
      if (!m) return undefined;
      pd.i += m;
      const v = pd.symbol();
      let order = 1;
      if (pd.peek()?.t === "sup") {
        const [g, nx] = group(den, pd.i + 1);
        pd.i = nx;
        order = numberOf(g) ?? 1;
      }
      bottom = bottom && v ? mul(bottom, scale(v, order)) : null;
      pd.skipSpace();
    }
    return top && bottom ? div(top, bottom) : null;
  }

  /** A symbol: letter / Greek / font-wrapped, with subscripts and primes. */
  symbol(): DimVec | null {
    const t = this.peek();
    if (!t) return null;
    let name: string;
    if (t.t === "cmd" && (FONT.has(t.v) || TEXTY.has(t.v))) {
      const [g, nx] = group(this.toks, this.i + 1);
      name = plain(g).trim();
      this.i = nx;
    } else {
      name = t.t === "cmd" ? "\\" + t.v : t.v;
      this.i++;
    }
    for (;;) {
      const u = this.peek();
      if (u && u.t === "sub") {
        const [g, nx] = group(this.toks, this.i + 1);
        name += "_" + plain(g).replace(/\s+/g, "");
        this.i = nx;
      } else if (u && u.t === "char" && u.v === "'") this.i++;
      else break;
    }
    // `x(t)`, `u(x, t)`: function notation, not a product with t.
    if (this.isChar("(")) {
      let k = this.i + 1;
      let simple = true;
      let count = 0;
      while (k < this.end && !(this.toks[k].t === "char" && this.toks[k].v === ")")) {
        const w = this.toks[k];
        if (!((w.t === "char" && /[A-Za-z,]/.test(w.v)) || (w.t === "cmd" && /^[A-Za-z]+$/.test(w.v)))) simple = false;
        if (w.t !== "char" || w.v !== ",") count++;
        k++;
      }
      if (simple && count > 0 && count <= 4 && k < this.end) this.i = k + 1;
    }
    this.ctx.seen.add(name);
    const d = this.ctx.lookup(name);
    if (!d) this.ctx.unknown.add(name);
    return d;
  }
}

/* -------------------------------------------------------------- analysis */

/** Strip environments, labels and alignment so an equation reads as one line. */
function clean(latex: string): string {
  return latex
    .replace(/\\(begin|end)\{[A-Za-z*]+\}(\{[^}]*\})?/g, " ")
    .replace(/\\(label|tag|eqref|ref)\{[^}]*\}/g, " ")
    .replace(/\\(nonumber|notag)\b/g, " ")
    .replace(/&/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/, "")
    .trim();
}

/** Pieces of a block that are separate equations: `\\`, `\quad`, `;`, `,\ `. */
export function splitEquations(block: string): Array<{ text: string; offset: number }> {
  const body = block.replace(/\\(begin|end)\{[A-Za-z*]+\}/g, (m) => " ".repeat(m.length));
  const re = /\\\\(\[[^\]]*\])?|\\q?quad\b|;|,\s*\\(?:quad|qquad|text\{\s*and\s*\})|\\text\{\s*(?:and|where|with|for)\s*\}/g;
  const out: Array<{ text: string; offset: number }> = [];
  let last = 0;
  let prevLhs = "";
  const take = (from: number, to: number) => {
    const raw = body.slice(from, to);
    let text = clean(raw);
    if (!text) return;
    // `&= ...` continuation lines inherit the previous left-hand side.
    const toks = ltokenize(text);
    if (toks.length && isRelation(toks[0]) && prevLhs) text = prevLhs + " " + text;
    const t2 = ltokenize(text);
    const k = t2.findIndex((t) => isRelation(t));
    if (k > 0) prevLhs = text.slice(0, t2[k].pos).trim();
    out.push({ text, offset: from + (raw.length - raw.trimStart().length) });
  };
  for (let m: RegExpExecArray | null; (m = re.exec(body)); ) {
    take(last, m.index);
    last = m.index + m[0].length;
  }
  take(last, body.length);
  return out.filter((e) => ltokenize(e.text).some((t) => isRelation(t)));
}

/**
 * Equations in a document (via the cleaner's tokenizer) with the line their
 * text starts on. Pasted text (`fromDocument = false`) carries no lines, and
 * without math delimiters it is read one equation per line - a document's
 * prose is never read that way, or every `a = b` sentence would be checked.
 */
export function equationsFromSource(src: string, fromDocument = true): EquationSource[] {
  const withLines = fromDocument;
  const { tokens } = tokenize(src);
  const out: EquationSource[] = [];
  const math = tokens.filter((t) => t.kind !== "text");
  const lineAt = (offset: number) => (src.slice(0, offset).match(/\n/g)?.length ?? 0) + 1;
  if (math.length) {
    for (const t of math) {
      const at = src.indexOf(t.value, t.start);
      const base = at >= 0 ? at : t.start;
      for (const e of splitEquations(t.value)) out.push({ latex: e.text, line: withLines ? lineAt(base + e.offset) : null });
    }
    return out;
  }
  if (fromDocument) return out;
  src.split("\n").forEach((line, i) => {
    for (const e of splitEquations(line)) out.push({ latex: e.text, line: withLines ? i + 1 : null });
  });
  return out;
}

const CONTEXT_PLANCK = /\\(nu|omega|lambda|hbar)\b|(^|[^A-Za-z\\])f([^A-Za-z]|$)/;

/** Resolve a symbol: exact override, exact default, then the subscript-free base. */
function resolver(overrides: Record<string, string>, latex: string) {
  const planck = CONTEXT_PLANCK.test(latex);
  return (name: string): { dims: DimVec | null; def: SymbolDefault | null; source: SymbolInfo["source"]; key: string } => {
    const base = name.replace(/_.*$/, "");
    for (const key of name === base ? [name] : [name, base]) {
      if (overrides[key] !== undefined && overrides[key].trim()) {
        const d = parseOverride(overrides[key]);
        return { dims: d, def: null, source: d ? "override" : "unknown", key };
      }
      const def = key === "h" && planck ? PLANCK : DEFAULT_SYMBOLS[key];
      if (def) return { dims: QUANTITY_BY_ID.get(def.quantity)?.dims ?? null, def, source: "default", key };
    }
    return { dims: null, def: null, source: "unknown", key: name };
  };
}

/** Check one relation (or chain). */
export function analyzeEquation(latex: string, overrides: Record<string, string> = {}, line: number | null = null): EquationResult {
  const src = clean(latex);
  const resolve = resolver(overrides, src);
  const ctx: Ctx = { src, lookup: (n) => resolve(n).dims, notes: [], unknown: new Set(), seen: new Set() };
  const toks = ltokenize(src);
  // Split at top-level relations.
  const cuts: Array<{ at: number; rel: string }> = [];
  let depth = 0;
  toks.forEach((t, k) => {
    if (t.t === "open" || (t.t === "cmd" && t.v === "left")) depth++;
    else if (t.t === "close" || (t.t === "cmd" && t.v === "right")) depth--;
    else if (depth === 0 && isRelation(t)) cuts.push({ at: k, rel: t.v });
  });
  const result: EquationResult = { latex: src, line, status: "skipped", sides: [], message: "", notes: ctx.notes, symbols: [] };
  if (!cuts.length) {
    result.message = "No relation (=, \\approx, \\le) to check";
    return result;
  }
  try {
    const bounds = [-1, ...cuts.map((c) => c.at), toks.length];
    for (let s = 0; s + 1 < bounds.length; s++) {
      const from = bounds[s] + 1;
      const to = bounds[s + 1];
      const p = new Parser(toks, ctx, false, from, to);
      let d: DimVec | null = from < to ? p.expr() : null;
      // Anything the expression stopped short of (stray tokens) is read and multiplied in.
      while (p.i < to) {
        p.i++;
        const e = p.expr();
        if (d && e && p.i <= to) d = mul(d, e);
      }
      result.sides.push({ latex: snippet(ctx, toks, from, to), dims: d, text: d ? describeDims(d) : "unknown" });
    }
  } catch {
    result.message = "Could not read this equation";
    return result;
  }

  const mismatches: string[] = [];
  const names = ["Left side", "Right side"];
  for (let k = 0; k + 1 < result.sides.length; k++) {
    const a = result.sides[k];
    const b = result.sides[k + 1];
    if (LOOSE.has(cuts[k].rel)) {
      ctx.notes.push({ kind: "relation", message: "\\" + cuts[k].rel + " relates shapes, not values - sides not compared" });
      continue;
    }
    if (!a.dims || !b.dims) continue;
    if (!dimEqual(a.dims, b.dims)) {
      const la = result.sides.length === 2 ? names[0] : "Side " + (k + 1);
      const lb = result.sides.length === 2 ? names[1] : "Side " + (k + 2);
      mismatches.push(la + ": " + a.text + ", " + lb + ": " + b.text + " - mismatch");
    }
  }
  const symbols = [...ctx.seen];
  result.symbols = symbols;
  for (const u of ctx.unknown) ctx.notes.push({ kind: "unknown", message: "Unknown symbol " + u + " - assign a dimension" });
  for (const s of symbols) {
    const r = resolve(s);
    if (r.def?.note && r.source === "default") ctx.notes.push({ kind: "assumption", message: s + ": " + r.def.description + " (" + r.def.note + ")" });
    if (overrides[r.key] !== undefined && overrides[r.key].trim() && !r.dims) ctx.notes.push({ kind: "unknown", message: "Could not read the override for " + s + ": " + overrides[r.key] });
  }

  const definite = mismatches.length > 0 || ctx.notes.some((n) => n.kind === "sum" || n.kind === "function" || n.kind === "power");
  const compared = result.sides.filter((s) => s.dims).length;
  if (definite) {
    result.status = "mismatch";
    result.message = mismatches.join("; ") || (ctx.notes.find((n) => n.kind === "sum" || n.kind === "function" || n.kind === "power")?.message ?? "Mismatch");
  } else if (ctx.unknown.size || compared < result.sides.length) {
    result.status = "incomplete";
    result.message = "Incomplete - assign a dimension to " + ([...ctx.unknown].join(", ") || "every symbol");
  } else if (cuts.every((c) => LOOSE.has(c.rel))) {
    result.status = "skipped";
    result.message = "Proportionality only - sides not compared";
  } else {
    result.status = "consistent";
    result.message = "Both sides: " + result.sides[0].text;
  }
  return result;
}

/** Check every equation and collect the symbol table they used. */
export function analyzeUnits(equations: EquationSource[], overrides: Record<string, string> = {}): UnitsAnalysis {
  const results = equations.map((e) => analyzeEquation(e.latex, overrides, e.line));
  const symbols = new Map<string, SymbolInfo>();
  for (const r of results) {
    const resolve = resolver(overrides, r.latex);
    for (const s of r.symbols) {
      if (symbols.has(s) && symbols.get(s)!.source !== "unknown") continue;
      const x = resolve(s);
      const q = x.dims ? nearestQuantity(x.dims) : null;
      symbols.set(s, {
        symbol: s,
        quantity: x.def?.quantity ?? q?.id ?? "",
        dims: x.dims,
        dimsText: x.dims ? describeDims(x.dims) : "unknown",
        source: x.source,
        description: x.def?.description ?? (x.source === "override" ? "your override" : "assign a dimension"),
        note: x.def?.note,
      });
    }
  }
  return { results, symbols: [...symbols.values()].sort((a, b) => (a.source === "unknown" ? 0 : 1) - (b.source === "unknown" ? 0 : 1) || a.symbol.localeCompare(b.symbol)) };
}

/* ----------------------------------------------------------------- sample */

export const SAMPLE_EQUATIONS = `Mass-energy equivalence and a version with a missing factor of $c$:
$$E = m c^2$$
$$E = m c$$
Energy conservation for a falling body:
$$\\frac{1}{2} m v^2 + m g h = E$$
Kinematics, with one term missing its acceleration:
$$x = x_0 + v_0 t + \\frac{1}{2} v t^2$$
$$\\frac{dx}{dt} = v, \\quad v = v_0 + a t$$
$$y = r \\sin(\\omega t), \\quad E = h \\nu, \\quad g \\approx 9.81\\,\\mathrm{m/s^2}$$
`;
