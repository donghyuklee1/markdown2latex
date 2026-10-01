/**
 * sketch.ts - Sketch -> TikZ: freehand strokes become a clean diagram model,
 * and the model becomes compilable TikZ plus an SVG preview with the same
 * geometry.
 *
 * Pure: no DOM, no React, no network, never throws. Everything is in
 * centimetres with screen orientation (x right, y down) so the canvas maps
 * 1:1; TikZ output flips y against the canvas height so coordinates stay
 * positive and the picture reads the same way up.
 *
 * Pipeline:
 *   recognizeStroke  points -> rectangle | ellipse | circle | diamond | line |
 *                    arrow | polyline | scribble, already snapped
 *   applyStroke      recognition -> node, edge (attached to nearby nodes) or
 *                    an arrowhead merged into the previous line
 *   toTikz / parseTikz / layoutDiagram / toSvg
 *                    the one model rendered three ways and read back once
 *
 * There is no TeX engine in the browser, so the preview is layoutDiagram's
 * geometry, which mirrors what TikZ does with the emitted code: node sizes
 * from `minimum width/height`, connectors clipped at node borders along the
 * ray to the next coordinate, `-|` corners, `midway` labels.
 */

/* ------------------------------------------------------------------- model */

export interface Pt {
  x: number;
  y: number;
}

/** A sampled pointer position; `t` is a timestamp in ms (optional). */
export interface StrokePoint extends Pt {
  t?: number;
}

export type NodeShape = "box" | "round" | "ellipse" | "circle" | "decision" | "io";
export type ArrowKind = "->" | "<->" | "-";
/** How a two-point connector is routed: straight, or an L via TikZ `-|` / `|-`. */
export type Route = "--" | "-|" | "|-";

export interface SketchNode {
  id: string;
  shape: NodeShape;
  /** Centre, cm. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface SketchEdge {
  id: string;
  from?: string;
  to?: string;
  /** Vertices in cm; an attached end holds its node's centre. */
  points: Pt[];
  arrow: ArrowKind;
  /** Only meaningful for two-point edges. */
  route: Route;
  label: string;
}

export interface Diagram {
  /** Canvas size, cm. */
  width: number;
  height: number;
  nodes: SketchNode[];
  edges: SketchEdge[];
}

export interface SketchOptions {
  /** Grid pitch in cm. */
  grid?: number;
  snap?: boolean;
}

export const CANVAS_W = 12;
export const CANVAS_H = 9;
export const DEFAULT_GRID = 0.25;
/** SVG user units per cm - the preview and the canvas share it. */
export const PX_PER_CM = 40;

export function emptyDiagram(width = CANVAS_W, height = CANVAS_H): Diagram {
  return { width, height, nodes: [], edges: [] };
}

/* ---------------------------------------------------------------- geometry */

const r2 = (n: number): number => {
  const v = Math.round(n * 100) / 100;
  return v === 0 ? 0 : v; // no "-0" in output
};
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function pathLength(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function bbox(pts: readonly Pt[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return pts.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/** Equidistant resampling (the $1-recognizer step): makes every metric independent of pointer speed. */
function resample(pts: readonly Pt[], n: number): Pt[] {
  const total = pathLength(pts);
  if (pts.length < 2 || total === 0) return pts.map((p) => ({ x: p.x, y: p.y }));
  const step = total / (n - 1);
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  let acc = 0;
  let prev: Pt = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let cur: Pt = pts[i];
    let d = dist(prev, cur);
    while (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: prev.x + t * (cur.x - prev.x), y: prev.y + t * (cur.y - prev.y) };
      out.push(q);
      prev = q;
      d = dist(prev, cur);
      acc = 0;
      if (out.length >= n) break;
    }
    acc += d;
    prev = cur;
    cur = pts[i];
  }
  while (out.length < n) out.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y });
  return out.slice(0, n);
}

/** Andrew's monotone chain. */
function convexHull(pts: readonly Pt[]): Pt[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (s.length < 3) return s;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygonArea(poly: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  if (L === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Douglas-Peucker: the corners a human meant, with the hand tremor removed. */
function simplify(pts: readonly Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > bd) (bd = d), (best = k);
    }
    if (best > 0) {
      keep[best] = true;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Interior turning angle in degrees at b (0 = straight on, 180 = reversal). */
function turn(a: Pt, b: Pt, c: Pt): number {
  const v1 = Math.atan2(b.y - a.y, b.x - a.x);
  const v2 = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(v2 - v1) * (180 / Math.PI);
  if (d > 180) d = 360 - d;
  return d;
}

const snapTo = (v: number, g: number): number => (g > 0 ? Math.round(v / g) * g : v);

/* ------------------------------------------------------------- recognition */

export type StrokeKind = "rectangle" | "ellipse" | "circle" | "diamond" | "line" | "arrow" | "polyline" | "scribble";

export interface Recognition {
  kind: StrokeKind;
  /** Snapped box for closed shapes (top-left origin, cm). */
  box?: Box;
  /** Rectangle drawn with visibly rounded corners. */
  rounded?: boolean;
  /** Snapped vertices for open strokes (and closed polygons). */
  points?: Pt[];
  /** An arrowhead was drawn at the end of the stroke. */
  head?: boolean;
  /** Why a stroke was rejected, or a short note on what was seen. */
  reason: string;
}

function cleanStroke(points: readonly StrokePoint[]): StrokePoint[] {
  const out: StrokePoint[] = [];
  for (const p of points ?? []) {
    if (!p || !ok(p.x) || !ok(p.y)) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y, t: ok(p.t) ? p.t : undefined });
  }
  return out;
}

/** Axis-snap every segment within 15 degrees of horizontal/vertical, then grid-snap. */
function orthogonalize(vs: Pt[], grid: number): Pt[] {
  const out = vs.map((p) => ({ x: r2(snapTo(p.x, grid)), y: r2(snapTo(p.y, grid)) }));
  const tan = Math.tan((15 * Math.PI) / 180);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
    if (dy <= tan * dx) b.y = a.y;
    else if (dx <= tan * dy) b.x = a.x;
  }
  // Drop repeated and collinear vertices the snapping produced.
  const dedup = out.filter((p, i) => i === 0 || dist(p, out[i - 1]) > 1e-9);
  const res: Pt[] = [];
  for (const p of dedup) {
    while (res.length >= 2 && turn(res[res.length - 2], res[res.length - 1], p) < 1) res.pop();
    res.push(p);
  }
  return res;
}

interface Head {
  /** Index of the tip in the resampled stroke. */
  k: number;
}

/**
 * A one-stroke arrow: the shaft, then a short excursion that turns back
 * from the tip (one barb, a back-and-forth V, or a little triangle).
 */
function findHead(rs: Pt[]): Head | null {
  const n = rs.length;
  let far = 0;
  for (const p of rs) far = Math.max(far, dist(p, rs[0]));
  // The tip is where the pen first reaches (about) the farthest point: a
  // back-and-forth head returns to it, and that return must not count.
  const reach = far - Math.max(0.05, 0.015 * far);
  let k = 0;
  while (k < n - 1 && dist(rs[k], rs[0]) < reach) k++;
  if (k >= n - 2 || k < 4) return null;
  const tip = rs[k];
  const shaftLen = pathLength(rs.slice(0, k + 1));
  const tail = rs.slice(k);
  const tailLen = pathLength(tail);
  if (tailLen < Math.max(0.12, 0.04 * shaftLen) || tailLen > 0.7 * shaftLen) return null;
  const headR = Math.max(...tail.map((p) => dist(p, tip)));
  if (headR < 0.08 || headR > Math.max(0.2, 0.45 * shaftLen)) return null;
  // Shaft direction at the tip, measured over a short stretch behind it.
  let j = k;
  while (j > 0 && dist(rs[j], tip) < Math.min(0.6, 0.3 * shaftLen)) j--;
  const sx = tip.x - rs[j].x, sy = tip.y - rs[j].y;
  const sl = Math.hypot(sx, sy) || 1;
  let behind = 0, total = 0, lateral = 0;
  for (const p of tail) {
    const d = dist(p, tip);
    if (d < 0.3 * headR) continue;
    total++;
    const bx = (p.x - tip.x) / d, by = (p.y - tip.y) / d;
    if (-(bx * sx + by * sy) / sl > Math.cos((80 * Math.PI) / 180)) behind++;
    lateral = Math.max(lateral, Math.abs(bx * sy - by * sx) / sl);
  }
  if (!total || behind / total < 0.8 || lateral < Math.sin((12 * Math.PI) / 180)) return null;
  return { k };
}

/**
 * Classify one freehand stroke and return its snapped geometry.
 * Points are in cm. Never throws; nonsense input is a "scribble".
 */
export function recognizeStroke(points: readonly StrokePoint[], opts: SketchOptions = {}): Recognition {
  const grid = opts.snap === false ? 0 : ok(opts.grid) && opts.grid > 0 ? opts.grid : DEFAULT_GRID;
  const pts = cleanStroke(points);
  if (pts.length < 2) return { kind: "scribble", reason: "too few points" };
  const L = pathLength(pts);
  const bb = bbox(pts);
  if (L < 0.2 || Math.hypot(bb.w, bb.h) < 0.15) return { kind: "scribble", reason: "too small - a tap, not a stroke" };

  const rs = resample(pts, 64);
  const gap = dist(pts[0], pts[pts.length - 1]);
  const hull = convexHull(rs);
  const A = polygonArea(hull);
  const Ph = pathLength([...hull, hull[0]]);
  const circularity = Ph > 0 ? (4 * Math.PI * A) / (Ph * Ph) : 0;

  if (gap <= 0.2 * L && circularity >= 0.2 && Math.min(bb.w, bb.h) >= 0.25) {
    if (L > 1.8 * Ph) return { kind: "scribble", reason: "went round more than once" };
    return closedShape(rs, bb, A, grid);
  }

  const head = findHead(resample(pts, 96));
  const fine = resample(pts, 96);
  const shaft = head ? fine.slice(0, head.k + 1) : pts;
  const sL = pathLength(shaft);
  const eps = Math.min(0.18, Math.max(0.06, 0.035 * sL));
  const dp = simplify(shaft, eps);
  if (dp.length > 8) return { kind: "scribble", reason: "too many direction changes" };
  for (let i = 1; i < dp.length - 1; i++) {
    if (turn(dp[i - 1], dp[i], dp[i + 1]) > 160) return { kind: "scribble", reason: "doubles back on itself" };
  }
  const straight = dist(shaft[0], shaft[shaft.length - 1]) / (sL || 1);
  const verts = straight > 0.95 ? [shaft[0], shaft[shaft.length - 1]] : dp;
  const snapped = orthogonalize(verts, grid);
  if (snapped.length < 2) return { kind: "scribble", reason: "collapsed to a point on the grid" };
  return {
    kind: head ? "arrow" : snapped.length === 2 ? "line" : "polyline",
    points: snapped,
    head: !!head,
    reason: head ? "line with an arrowhead" : snapped.length === 2 ? "straight line" : snapped.length - 1 + " segments",
  };
}

function closedShape(rs: Pt[], bb: Box, hullArea: number, grid: number): Recognition {
  const a = bb.w / 2 || 1e-9, b = bb.h / 2 || 1e-9;
  const cx = bb.x + a, cy = bb.y + b;
  // Fit against the three unit balls: L1 (diamond), L2 (ellipse), Linf (box).
  let e1 = 0, e2 = 0, ei = 0;
  for (const p of rs) {
    const u = Math.abs(p.x - cx) / a, v = Math.abs(p.y - cy) / b;
    e1 += Math.abs(u + v - 1);
    e2 += Math.abs(Math.hypot(u, v) - 1);
    ei += Math.abs(Math.max(u, v) - 1);
  }
  e1 /= rs.length;
  e2 /= rs.length;
  ei /= rs.length;
  const fill = hullArea / (bb.w * bb.h || 1);
  const best = Math.min(e1, e2, ei);
  if (best > 0.15) {
    const poly = simplify(rs, Math.max(0.06, 0.04 * Math.max(bb.w, bb.h)));
    if (poly.length <= 8) {
      const v = orthogonalize(poly, grid);
      if (v.length >= 3) {
        if (dist(v[0], v[v.length - 1]) > 1e-9) v.push({ ...v[0] });
        return { kind: "polyline", points: v, reason: "closed polygon" };
      }
    }
    return { kind: "scribble", reason: "closed, but not a box, ellipse or diamond" };
  }

  const snapBox = (w: number, h: number): Box => {
    const g = grid;
    const W = r2(Math.max(g ? 2 * g : 0.3, snapTo(w, g)));
    const H = r2(Math.max(g ? 2 * g : 0.3, snapTo(h, g)));
    const X = r2(snapTo(cx, g)), Y = r2(snapTo(cy, g));
    return { x: r2(X - W / 2), y: r2(Y - H / 2), w: W, h: H };
  };

  if (ei === best || (e2 === best && fill > 0.86)) {
    // Rounded corners: no stroke point comes close to the bounding-box corners.
    const corners = [
      { x: bb.x, y: bb.y },
      { x: bb.x + bb.w, y: bb.y },
      { x: bb.x, y: bb.y + bb.h },
      { x: bb.x + bb.w, y: bb.y + bb.h },
    ];
    const m = Math.min(bb.w, bb.h);
    const cd = corners.reduce((s, c) => s + Math.min(...rs.map((p) => dist(p, c))), 0) / 4;
    const rounded = e2 === best || (cd > 0.09 * m && cd > 0.08);
    let w = bb.w, h = bb.h;
    if (Math.abs(w - h) < 0.12 * Math.max(w, h)) w = h = (w + h) / 2; // near-square -> square
    return { kind: "rectangle", rounded, box: snapBox(w, h), reason: rounded ? "rounded rectangle" : "rectangle" };
  }
  if (e2 === best) {
    const ratio = bb.w / (bb.h || 1e-9);
    if (ratio > 0.8 && ratio < 1.25) {
      const d = (bb.w + bb.h) / 2;
      return { kind: "circle", box: snapBox(d, d), reason: "circle" };
    }
    return { kind: "ellipse", box: snapBox(bb.w, bb.h), reason: "ellipse" };
  }
  return { kind: "diamond", box: snapBox(bb.w, bb.h), reason: "diamond" };
}

/* ------------------------------------------------------------ model edits */

function nextId(prefix: string, used: ReadonlyArray<{ id: string }>): string {
  let max = 0;
  for (const u of used) {
    const m = new RegExp("^" + prefix + "(\\d+)$").exec(u.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return prefix + (max + 1);
}

const center = (n: SketchNode): Pt => ({ x: n.x, y: n.y });

/** Signed-ish distance from p to a node's outline (0 inside). */
function nodeDistance(n: SketchNode, p: Pt): number {
  const a = n.w / 2, b = n.h / 2;
  const dx = Math.abs(p.x - n.x), dy = Math.abs(p.y - n.y);
  const m = Math.min(a, b);
  if (n.shape === "ellipse" || n.shape === "circle") return Math.max(0, (Math.hypot(dx / a, dy / b) - 1) * m);
  if (n.shape === "decision") return Math.max(0, (dx / a + dy / b - 1) * m);
  return Math.hypot(Math.max(0, dx - a), Math.max(0, dy - b));
}

/** The node an endpoint belongs to: inside it, or within `tol` cm of its outline. */
export function nodeAt(model: Diagram, p: Pt, tol = 0.4): SketchNode | undefined {
  let best: SketchNode | undefined, bd = Infinity;
  // Later nodes are drawn on top, so they win ties.
  for (const n of model.nodes) {
    const d = nodeDistance(n, p);
    if (d <= tol && d <= bd) (bd = d), (best = n);
  }
  return best;
}

function reverseEdge(e: SketchEdge): SketchEdge {
  return {
    ...e,
    from: e.to,
    to: e.from,
    points: [...e.points].reverse(),
    route: e.route === "-|" ? "|-" : e.route === "|-" ? "-|" : "--",
  };
}

/** Builds an edge from snapped vertices, attaching ends to nearby nodes. */
export function connect(model: Diagram, verts: Pt[], arrow: ArrowKind, id: string): SketchEdge {
  const pts = verts.map((p) => ({ ...p }));
  const a = nodeAt(model, pts[0]);
  let b = nodeAt(model, pts[pts.length - 1]);
  if (a && b && a.id === b.id) b = undefined;
  if (a && b) {
    // Between two nodes: an L drawn with axis-aligned legs becomes -| or |-.
    let route: Route = "--";
    if (pts.length === 3) {
      const h1 = pts[0].y === pts[1].y, v1 = pts[0].x === pts[1].x;
      const h2 = pts[1].y === pts[2].y, v2 = pts[1].x === pts[2].x;
      if (h1 && v2) route = "-|";
      else if (v1 && h2) route = "|-";
    }
    // An L between nodes that are already aligned is just a straight line.
    if (route !== "--" && (a.x === b.x || a.y === b.y)) route = "--";
    return { id, from: a.id, to: b.id, points: [center(a), center(b)], arrow, route, label: "" };
  }
  const fix = (end: number, nb: number, n: SketchNode) => {
    const p = pts[end], q = pts[nb];
    // Keep the neighbouring leg axis-aligned once the end moves to the centre.
    if (pts.length > 2 && q) {
      if (p.y === q.y) q.y = n.y;
      else if (p.x === q.x) q.x = n.x;
    }
    pts[end] = center(n);
  };
  if (a) fix(0, 1, a);
  if (b) fix(pts.length - 1, pts.length - 2, b);
  return { id, from: a?.id, to: b?.id, points: pts, arrow, route: "--", label: "" };
}

export interface StrokeResult {
  model: Diagram;
  recognition: Recognition;
  action: "node" | "edge" | "arrowhead" | "rejected";
  id?: string;
  message: string;
  /** Pass back as `previous` on the next stroke so a quick V can become an arrowhead. */
  last?: { edgeId: string; t?: number };
}

/** How long after a line a small V still counts as its arrowhead. */
const HEAD_WINDOW_MS = 4000;

/**
 * A stroke that is a small V whose apex sits on an end of the previous edge,
 * opening back along it. Returns which end it caps.
 */
export function arrowheadEnd(model: Diagram, stroke: readonly StrokePoint[], edgeId: string): "start" | "end" | null {
  const e = model.edges.find((x) => x.id === edgeId);
  if (!e) return null;
  const pts = cleanStroke(stroke);
  const L = pathLength(pts);
  if (pts.length < 3 || L < 0.12 || L > 2.4) return null;
  const v = simplify(resample(pts, 32), Math.max(0.04, 0.08 * L));
  if (v.length !== 3) return null;
  const [p0, apex, p2] = v;
  const angle = 180 - turn(p0, apex, p2);
  if (angle < 15 || angle > 130) return null;
  const g = edgeGeometry(model, e);
  if (!g || g.length < 2) return null;
  const ends: Array<["start" | "end", Pt, Pt]> = [
    ["end", g[g.length - 1], g[g.length - 2]],
    ["start", g[0], g[1]],
  ];
  for (const [which, tip, prev] of ends) {
    if (dist(apex, tip) > 0.45) continue;
    const mx = (p0.x + p2.x) / 2 - apex.x, my = (p0.y + p2.y) / 2 - apex.y;
    const bx = prev.x - tip.x, by = prev.y - tip.y;
    const cos = (mx * bx + my * by) / ((Math.hypot(mx, my) || 1) * (Math.hypot(bx, by) || 1));
    if (cos > 0.5) return which;
  }
  return null;
}

/**
 * Turn one stroke into a model change. `previous` is the edge the last
 * stroke created (and when), for the two-stroke arrow.
 */
export function applyStroke(
  model: Diagram,
  stroke: readonly StrokePoint[],
  opts: SketchOptions = {},
  previous?: { edgeId: string; t?: number },
): StrokeResult {
  const pts = cleanStroke(stroke);
  const t0 = pts[0]?.t, t1 = pts[pts.length - 1]?.t;
  if (previous) {
    const fresh = !ok(previous.t) || !ok(t0) || t0 - previous.t <= HEAD_WINDOW_MS;
    const which = fresh ? arrowheadEnd(model, pts, previous.edgeId) : null;
    if (which) {
      const edges = model.edges.map((e) => {
        if (e.id !== previous.edgeId) return e;
        if (which === "end") return { ...e, arrow: e.arrow === "-" ? "->" : e.arrow } as SketchEdge;
        if (e.arrow === "-") return { ...reverseEdge(e), arrow: "->" } as SketchEdge;
        return { ...e, arrow: "<->" } as SketchEdge;
      });
      return {
        model: { ...model, edges },
        recognition: { kind: "arrow", head: true, reason: "arrowhead for the previous line" },
        action: "arrowhead",
        id: previous.edgeId,
        message: "Arrowhead added",
      };
    }
  }

  const r = recognizeStroke(pts, opts);
  if (r.kind === "scribble") return { model, recognition: r, action: "rejected", message: "Not recognised: " + r.reason };

  if (r.box && r.kind !== "polyline") {
    const shape: NodeShape =
      r.kind === "rectangle" ? (r.rounded ? "round" : "box") : r.kind === "circle" ? "circle" : r.kind === "ellipse" ? "ellipse" : "decision";
    const id = nextId("n", model.nodes);
    const b = r.box;
    const node: SketchNode = { id, shape, x: r2(b.x + b.w / 2), y: r2(b.y + b.h / 2), w: b.w, h: b.h, label: "" };
    return { model: { ...model, nodes: [...model.nodes, node] }, recognition: r, action: "node", id, message: r.reason };
  }

  const verts = r.points ?? [];
  if (verts.length < 2) return { model, recognition: { kind: "scribble", reason: "no geometry" }, action: "rejected", message: "Not recognised" };
  const id = nextId("e", model.edges);
  let edge = connect(model, verts, r.head ? "->" : "-", id);
  if (edge.from && edge.to && edge.arrow === "-") edge = { ...edge, arrow: "->" }; // node to node: a connector
  if (edge.points.length === 2 && dist(edge.points[0], edge.points[1]) < 1e-9)
    return { model, recognition: { kind: "scribble", reason: "zero length" }, action: "rejected", message: "Not recognised: zero length" };
  const kind: StrokeKind = edge.arrow !== "-" ? "arrow" : r.kind;
  return {
    model: { ...model, edges: [...model.edges, edge] },
    recognition: { ...r, kind },
    action: "edge",
    id,
    message: edge.from && edge.to ? "Connector " + edge.from + " to " + edge.to : r.reason,
    last: { edgeId: id, t: t1 },
  };
}

/** Move a node by (dx, dy); attached edge ends follow. */
export function moveNode(model: Diagram, id: string, dx: number, dy: number, opts: SketchOptions = {}): Diagram {
  const n = model.nodes.find((x) => x.id === id);
  if (!n) return model;
  const g = opts.snap === false ? 0 : opts.grid ?? DEFAULT_GRID;
  return placeNode(model, { ...n, x: r2(snapTo(n.x + dx, g)), y: r2(snapTo(n.y + dy, g)) });
}

/** Resize to a box (top-left x, y, w, h); the opposite corner is the caller's job. */
export function resizeNode(model: Diagram, id: string, box: Box, opts: SketchOptions = {}): Diagram {
  const n = model.nodes.find((x) => x.id === id);
  if (!n) return model;
  const g = opts.snap === false ? 0 : opts.grid ?? DEFAULT_GRID;
  let w = Math.max(g ? 2 * g : 0.3, snapTo(Math.abs(box.w), g));
  let h = Math.max(g ? 2 * g : 0.3, snapTo(Math.abs(box.h), g));
  if (n.shape === "circle") w = h = Math.max(w, h);
  w = r2(w);
  h = r2(h);
  const x0 = Math.min(box.x, box.x + box.w), y0 = Math.min(box.y, box.y + box.h);
  return placeNode(model, { ...n, w, h, x: r2(snapTo(x0 + w / 2, g)), y: r2(snapTo(y0 + h / 2, g)) });
}

function placeNode(model: Diagram, n: SketchNode): Diagram {
  return {
    ...model,
    nodes: model.nodes.map((x) => (x.id === n.id ? n : x)),
    edges: model.edges.map((e) => {
      if (e.from !== n.id && e.to !== n.id) return e;
      const points = e.points.map((p) => ({ ...p }));
      if (e.from === n.id) points[0] = center(n);
      if (e.to === n.id) points[points.length - 1] = center(n);
      return { ...e, points };
    }),
  };
}

/** Delete a node (with its connectors) or an edge. */
export function removeItem(model: Diagram, id: string): Diagram {
  if (model.nodes.some((n) => n.id === id))
    return { ...model, nodes: model.nodes.filter((n) => n.id !== id), edges: model.edges.filter((e) => e.from !== id && e.to !== id) };
  return { ...model, edges: model.edges.filter((e) => e.id !== id) };
}

export function setLabel(model: Diagram, id: string, label: string): Diagram {
  return {
    ...model,
    nodes: model.nodes.map((n) => (n.id === id ? { ...n, label } : n)),
    edges: model.edges.map((e) => (e.id === id ? { ...e, label } : e)),
  };
}

/** What is under a point: a node (inside) first, then the nearest edge within `tol`. */
export function hitTest(model: Diagram, p: Pt, tol = 0.2): { type: "node" | "edge"; id: string } | null {
  for (let i = model.nodes.length - 1; i >= 0; i--) {
    if (nodeDistance(model.nodes[i], p) <= 0.02) return { type: "node", id: model.nodes[i].id };
  }
  let best: string | null = null, bd = tol;
  for (const e of model.edges) {
    const g = edgeGeometry(model, e);
    for (let i = 1; g && i < g.length; i++) {
      const d = segDist(p, g[i - 1], g[i]);
      if (d <= bd) (bd = d), (best = e.id);
    }
  }
  return best ? { type: "edge", id: best } : null;
}

/** A small encoder -> attention -> decoder pipeline. */
export function sampleDiagram(): Diagram {
  const node = (id: string, shape: NodeShape, x: number, y: number, label: string, w = 2.5, h = 1): SketchNode => ({ id, shape, x, y, w, h, label });
  const nodes = [
    node("n1", "io", 1.75, 1.5, "Tokens $x$"),
    node("n2", "box", 5.5, 1.5, "Encoder"),
    node("n3", "round", 9.75, 1.5, "Attention"),
    node("n4", "box", 9.75, 5, "Decoder"),
    node("n5", "io", 9.75, 7.75, "Output $\\hat y$"),
  ];
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const edge = (id: string, a: string, b: string, label = "", route: Route = "--"): SketchEdge => ({
    id,
    from: a,
    to: b,
    points: [center(at(a)), center(at(b))],
    arrow: "->",
    route,
    label,
  });
  return {
    width: CANVAS_W,
    height: CANVAS_H,
    nodes,
    edges: [edge("e1", "n1", "n2"), edge("e2", "n2", "n3", "$h$"), edge("e3", "n3", "n4", "context"), edge("e4", "n2", "n4", "memory", "|-"), edge("e5", "n4", "n5")],
  };
}

/* ------------------------------------------------------- shared geometry */

const IO_SLANT = 1 / Math.tan((70 * Math.PI) / 180); // trapezium left angle=70

/** Outline polygon of a decision/io node (cm, screen orientation). */
function outline(n: SketchNode): Pt[] {
  const a = n.w / 2, b = n.h / 2;
  if (n.shape === "decision")
    return [
      { x: n.x, y: n.y - b },
      { x: n.x + a, y: n.y },
      { x: n.x, y: n.y + b },
      { x: n.x - a, y: n.y },
    ];
  if (n.shape === "io") {
    const s = n.h * IO_SLANT;
    return [
      { x: n.x - a + s, y: n.y - b },
      { x: n.x + a, y: n.y - b },
      { x: n.x + a - s, y: n.y + b },
      { x: n.x - a, y: n.y + b },
    ];
  }
  return [
    { x: n.x - a, y: n.y - b },
    { x: n.x + a, y: n.y - b },
    { x: n.x + a, y: n.y + b },
    { x: n.x - a, y: n.y + b },
  ];
}

/** Where TikZ puts `(node)` in a path: the border point on the ray from the centre toward `q`. */
function borderPoint(n: SketchNode, q: Pt): Pt {
  const dx = q.x - n.x, dy = q.y - n.y;
  if (Math.hypot(dx, dy) < 1e-9) return center(n);
  const a = n.w / 2, b = n.h / 2;
  let t: number;
  if (n.shape === "ellipse" || n.shape === "circle") t = 1 / Math.hypot(dx / a, dy / b);
  else if (n.shape === "box" || n.shape === "round") t = Math.min(dx ? a / Math.abs(dx) : Infinity, dy ? b / Math.abs(dy) : Infinity);
  else {
    // Ray against the outline polygon (diamond, trapezium).
    const poly = outline(n);
    t = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], r = poly[(i + 1) % poly.length];
      const ex = r.x - p.x, ey = r.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const s = ((p.x - n.x) * ey - (p.y - n.y) * ex) / den;
      const u = ((p.x - n.x) * dy - (p.y - n.y) * dx) / den;
      if (s > 0 && u >= -1e-9 && u <= 1 + 1e-9) t = Math.min(t, s);
    }
    if (!Number.isFinite(t)) t = 0;
  }
  return { x: n.x + t * dx, y: n.y + t * dy };
}

/** The drawn polyline of an edge in cm, after routing and border clipping. */
export function edgeGeometry(model: Diagram, e: SketchEdge): Pt[] | null {
  const A = e.from ? model.nodes.find((n) => n.id === e.from) : undefined;
  const B = e.to ? model.nodes.find((n) => n.id === e.to) : undefined;
  if (!e.points || e.points.length < 2) return null;
  let P = e.points.map((p) => ({ x: p.x, y: p.y }));
  if (A) P[0] = center(A);
  if (B) P[P.length - 1] = center(B);
  if (P.length === 2 && e.route !== "--") {
    const corner = e.route === "-|" ? { x: P[1].x, y: P[0].y } : { x: P[0].x, y: P[1].y };
    P = [P[0], corner, P[1]];
  }
  if (A) P[0] = borderPoint(A, P[1]);
  if (B) P[P.length - 1] = borderPoint(B, P[P.length - 2]);
  return P;
}

export type Placement = "above" | "below" | "left" | "right" | "above left" | "above right" | "below left" | "below right";

/** Where `midway` falls and which side the label goes, exactly as toTikz writes it. */
function edgeLabelSpot(model: Diagram, e: SketchEdge): { seg: number; at: Pt; placement: Placement } | null {
  const g = edgeGeometry(model, e);
  if (!g) return null;
  if (e.points.length === 2 && e.route !== "--" && g.length === 3) {
    // midway on -| / |- is the corner; put the text on the side away from both legs.
    const c = g[1];
    const hx = e.route === "-|" ? g[0].x - c.x : g[2].x - c.x; // horizontal leg direction from corner
    const vy = e.route === "-|" ? g[2].y - c.y : g[0].y - c.y; // vertical leg direction from corner
    const v = vy > 0 ? "above" : "below";
    const h = hx > 0 ? "left" : "right";
    return { seg: 0, at: c, placement: (v + " " + h) as Placement };
  }
  const seg = Math.floor((g.length - 2) / 2);
  const a = g[seg], b = g[seg + 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  let placement: Placement;
  if (Math.abs(dy) <= 0.2 * Math.abs(dx)) placement = "above";
  else if (Math.abs(dx) <= 0.2 * Math.abs(dy)) placement = "right";
  else placement = dx * dy > 0 ? "above right" : "above left";
  return { seg, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, placement };
}

/* --------------------------------------------------------------- labels */

/** Escape a label for TikZ: text specials outside `$...$`, math untouched. */
export function escapeLabel(label: string): string {
  const parts = splitMath(label);
  return parts
    .map(([math, s]) =>
      math
        ? s
        : s.replace(/[\\&%_#{}$^~]|\n/g, (c) =>
            c === "\\" ? "\\textbackslash{}" : c === "^" ? "\\^{}" : c === "~" ? "\\textasciitilde{}" : c === "\n" ? " \\\\ " : "\\" + c,
          ),
    )
    .join("");
}

/** Inverse of escapeLabel, for the parser. */
export function unescapeLabel(tex: string): string {
  return splitMath(tex, true)
    .map(([math, s]) =>
      math
        ? s
        : s
            .replace(/\s*\\\\\s*/g, "\n")
            .replace(/\\textbackslash\{\}/g, "\\")
            .replace(/\\textasciitilde\{\}/g, "~")
            .replace(/\\\^\{\}/g, "^")
            .replace(/\\([&%_#{}$])/g, "$1"),
    )
    .join("");
}

/** Split into [isMath, text] runs on unescaped, balanced `$...$`. */
function splitMath(s: string, escaped = false): Array<[boolean, string]> {
  const out: Array<[boolean, string]> = [];
  let buf = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (escaped && c === "\\" && i + 1 < s.length) {
      buf += c + s[i + 1];
      i += 2;
      continue;
    }
    if (c === "$") {
      let j = i + 1;
      while (j < s.length && !(s[j] === "$" && s[j - 1] !== "\\")) j++;
      if (j < s.length && j > i + 1) {
        if (buf) out.push([false, buf]);
        buf = "";
        out.push([true, s.slice(i, j + 1)]);
        i = j + 1;
        continue;
      }
    }
    buf += c;
    i++;
  }
  if (buf) out.push([false, buf]);
  return out;
}

/* ------------------------------------------------------------------- TikZ */

export interface TikzOptions {
  /** Wrap in a compilable `standalone` document. */
  standalone?: boolean;
}

const fmt = (n: number): string => String(r2(n));

const STYLE_OF: Record<NodeShape, string> = {
  box: "box",
  round: "round",
  decision: "decision",
  io: "io",
  ellipse: "oval",
  circle: "circ",
};

export const TIKZ_LIBRARIES = "\\usetikzlibrary{arrows.meta,positioning,shapes.geometric}";

/** The model as TikZ. Deterministic: model order, model ids, 2-decimal cm. */
export function toTikz(model: Diagram, opts: TikzOptions = {}): string {
  const H = model.height;
  const xy = (p: Pt) => "(" + fmt(p.x) + "," + fmt(H - p.y) + ")";
  const known = new Set(model.nodes.map((n) => n.id));
  const lines: string[] = [];
  lines.push("% sketch2tikz canvas " + fmt(model.width) + "x" + fmt(model.height) + " cm");
  if (!opts.standalone) lines.push("% needs " + TIKZ_LIBRARIES);
  lines.push("\\begin{tikzpicture}[node distance=1.5cm, >=Stealth, line width=0.8pt, every node/.style={font=\\small, align=center}]");
  lines.push("  \\tikzset{");
  lines.push("    box/.style={draw, rectangle},");
  lines.push("    round/.style={draw, rectangle, rounded corners=4pt},");
  lines.push("    decision/.style={draw, diamond},");
  lines.push("    io/.style={draw, trapezium, trapezium left angle=70, trapezium right angle=110, trapezium stretches=true},");
  lines.push("    oval/.style={draw, ellipse},");
  lines.push("    circ/.style={draw, circle}");
  lines.push("  }");
  for (const n of model.nodes) {
    const size = n.shape === "circle" ? "minimum size=" + fmt(n.w) + "cm" : "minimum width=" + fmt(n.w) + "cm, minimum height=" + fmt(n.h) + "cm";
    lines.push("  \\node[" + STYLE_OF[n.shape] + ", inner sep=1pt, " + size + "] (" + n.id + ") at " + xy(n) + " {" + escapeLabel(n.label) + "};");
  }
  for (const e of model.edges) {
    if (!e.points || e.points.length < 2) continue;
    const ref = (i: number): string => {
      if (i === 0 && e.from && known.has(e.from)) return "(" + e.from + ")";
      if (i === e.points.length - 1 && e.to && known.has(e.to)) return "(" + e.to + ")";
      return xy(e.points[i]);
    };
    const spot = e.label ? edgeLabelSpot(model, e) : null;
    const labelTex = spot ? " node[midway, " + spot.placement + "] {" + escapeLabel(e.label) + "}" : "";
    let path = ref(0);
    if (e.points.length === 2 && e.route !== "--") path += " " + e.route + " " + ref(1) + labelTex;
    else {
      for (let i = 1; i < e.points.length; i++) {
        path += " -- " + ref(i);
        if (spot && i - 1 === spot.seg) path += labelTex;
      }
    }
    const style = e.arrow === "-" ? "" : "[" + e.arrow + "]";
    lines.push("  \\draw" + style + " " + path + ";");
  }
  lines.push("\\end{tikzpicture}");
  if (!opts.standalone) return lines.join("\n") + "\n";
  return (
    ["\\documentclass[tikz, border=4pt]{standalone}", TIKZ_LIBRARIES, "\\begin{document}", ...lines.filter((l) => !l.startsWith("% needs")), "\\end{document}"].join("\n") + "\n"
  );
}

/* ------------------------------------------------------------- TikZ parser */

export interface ParseResult {
  model: Diagram;
  /** Things skipped or approximated - reported, never thrown. */
  issues: string[];
}

/** Read back the subset toTikz writes (`\node ... at (x,y) {..};`, `\draw` with `--`, `-|`, `|-`). */
export function parseTikz(src: string): ParseResult {
  const issues: string[] = [];
  // The canvas comment carries the height that y was flipped against; without
  // it, pasted TikZ is placed on the default canvas.
  let size: { w: number; h: number } | undefined;
  const text = String(src ?? "")
    .split("\n")
    .map((line) => {
      const canvas = /^\s*%\s*sketch2tikz canvas\s+([\d.]+)x([\d.]+)/.exec(line);
      if (canvas) size = { w: Number(canvas[1]), h: Number(canvas[2]) };
      return line.replace(/(^|[^\\])%.*$/, "$1");
    })
    .join("\n");
  const W = size && ok(size.w) && size.w > 0 ? size.w : CANVAS_W;
  const H = size && ok(size.h) && size.h > 0 ? size.h : CANVAS_H;
  const model: Diagram = emptyDiagram(W, H);

  let i = 0;
  const skipGroup = (open: string, close: string): string => {
    // At text[i] === open: return the content, leave i after the matching close.
    let depth = 0;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === "\\") {
        i++;
        continue;
      }
      if (text[i] === open) depth++;
      else if (text[i] === close && --depth === 0) {
        i++;
        return text.slice(start + 1, i - 1);
      }
    }
    return text.slice(start + 1);
  };
  const skipWs = () => {
    while (i < text.length && /\s/.test(text[i])) i++;
  };
  const readStatement = (): string => {
    const start = i;
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ";" && depth <= 0) {
        i++;
        return text.slice(start, i - 1);
      }
    }
    issues.push("Statement without a closing ';' was skipped");
    return "";
  };

  while (i < text.length) {
    skipWs();
    if (i >= text.length) break;
    if (text[i] !== "\\") {
      i++;
      continue;
    }
    const m = /^\\([A-Za-z@]+)/.exec(text.slice(i, i + 40));
    if (!m) {
      i += 2;
      continue;
    }
    const name = m[1];
    if (name === "node" || name === "draw") {
      const stmt = readStatement();
      if (stmt) (name === "node" ? parseNode : parseDraw)(stmt.slice(name.length + 1), model, issues);
      continue;
    }
    i += m[0].length;
    if (["begin", "end", "tikzset", "documentclass", "usetikzlibrary", "usepackage", "tikzstyle"].includes(name)) {
      // Swallow this command's [..] and {..} arguments.
      for (;;) {
        skipWs();
        if (text[i] === "{") skipGroup("{", "}");
        else if (text[i] === "[") skipGroup("[", "]");
        else if (name === "tikzstyle" && text[i] === "=") i++;
        else break;
      }
      continue;
    }
    if (["path", "fill", "filldraw", "coordinate", "foreach", "clip", "shade", "pic", "matrix", "graph"].includes(name)) {
      readStatement();
      issues.push("\\" + name + " is not supported - skipped");
      continue;
    }
  }
  return { model, issues };
}

function parseNumber(s: string): number | null {
  const m = /^\s*(-?\d*\.?\d+)\s*(cm)?\s*$/.exec(s);
  return m ? Number(m[1]) : null;
}

function parseNode(body: string, model: Diagram, issues: string[]): void {
  const s = body.trim();
  const head = /^(?:\[([^\]]*)\])?\s*\(([A-Za-z][\w-]*)\)\s*at\s*\(([^)]*)\)\s*\{/.exec(s);
  if (!head) {
    issues.push("\\node" + s.slice(0, 40) + " ... not understood (expected [style] (name) at (x,y) {label})");
    return;
  }
  const labelStart = head[0].length - 1;
  let depth = 0, j = labelStart;
  for (; j < s.length; j++) {
    if (s[j] === "\\") {
      j++;
      continue;
    }
    if (s[j] === "{") depth++;
    else if (s[j] === "}" && --depth === 0) break;
  }
  const label = unescapeLabel(s.slice(labelStart + 1, j));
  const [xs, ys] = head[3].split(",");
  const x = parseNumber(xs ?? ""), y = parseNumber(ys ?? "");
  if (x === null || y === null) {
    issues.push("Node (" + head[2] + "): coordinate (" + head[3] + ") is not a plain (x,y)");
    return;
  }
  const opts = (head[1] ?? "").split(",").map((o) => o.trim());
  const styles: Record<string, NodeShape> = {
    box: "box", rectangle: "box", round: "round", decision: "decision", diamond: "decision",
    io: "io", trapezium: "io", oval: "ellipse", ellipse: "ellipse", circ: "circle", circle: "circle",
  };
  let shape: NodeShape | undefined;
  let w = 2, h = 1;
  for (const o of opts) {
    const kv = /^(minimum (?:width|height|size))\s*=\s*(.+)$/.exec(o);
    if (kv) {
      const v = parseNumber(kv[2]);
      if (v === null) continue;
      if (kv[1] === "minimum width") w = v;
      else if (kv[1] === "minimum height") h = v;
      else w = h = v;
    } else if (!shape && styles[o]) shape = styles[o];
  }
  if (!shape) {
    issues.push("Node (" + head[2] + "): no known shape style, drawn as a box");
    shape = "box";
  }
  if (model.nodes.some((n) => n.id === head[2])) issues.push("Node name (" + head[2] + ") used twice; the later one wins in TikZ");
  model.nodes.push({ id: head[2], shape, x: r2(x), y: r2(model.height - y), w: r2(w), h: r2(h), label });
}

function parseDraw(body: string, model: Diagram, issues: string[]): void {
  let s = body.trim();
  let arrow: ArrowKind = "-";
  let reversed = false;
  const opt = /^\[([^\]]*)\]/.exec(s);
  if (opt) {
    s = s.slice(opt[0].length);
    for (const o of opt[1].split(",").map((x) => x.trim())) {
      if (o === "->") arrow = "->";
      else if (o === "<->") arrow = "<->";
      else if (o === "<-") (arrow = "->"), (reversed = true);
    }
  }
  type Coord = { node?: SketchNode; p: Pt };
  const coords: Coord[] = [];
  const ops: Route[] = [];
  let label = "";
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const rest = s.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\(([^)]*)\)/.exec(rest))) {
      const inner = m[1].trim();
      const [xs, ys, extra] = inner.split(",");
      const x = parseNumber(xs ?? ""), y = ys !== undefined ? parseNumber(ys) : null;
      if (x !== null && y !== null && extra === undefined) coords.push({ p: { x: r2(x), y: r2(model.height - y) } });
      else {
        const name = inner.split(".")[0];
        const node = model.nodes.find((n) => n.id === name);
        if (!node) {
          issues.push("\\draw: unknown coordinate (" + inner + ") - path skipped");
          return;
        }
        if (inner.includes(".")) issues.push("\\draw: anchor (" + inner + ") read as (" + name + ")");
        coords.push({ node, p: center(node) });
      }
      i += m[0].length;
    } else if ((m = /^(--|-\||\|-)/.exec(rest))) {
      ops.push(m[1] as Route);
      i += m[0].length;
    } else if ((m = /^node\s*(\[[^\]]*\])?\s*\{/.exec(rest))) {
      let depth = 0, j = m[0].length - 1;
      const start = j;
      for (; j < rest.length; j++) {
        if (rest[j] === "\\") {
          j++;
          continue;
        }
        if (rest[j] === "{") depth++;
        else if (rest[j] === "}" && --depth === 0) break;
      }
      if (!label) label = unescapeLabel(rest.slice(start + 1, j));
      i += j + 1;
    } else {
      issues.push("\\draw: '" + rest.slice(0, 24) + "' is not supported - path skipped");
      return;
    }
  }
  if (coords.length < 2 || ops.length !== coords.length - 1) {
    issues.push("\\draw: needs at least two coordinates joined by --, -| or |-");
    return;
  }
  let route: Route = "--";
  let points: Pt[];
  if (coords.length === 2) {
    route = ops[0];
    points = coords.map((c) => c.p);
  } else {
    // Expand -| / |- corners into explicit vertices for multi-point paths.
    points = [coords[0].p];
    for (let k = 1; k < coords.length; k++) {
      const a = points[points.length - 1], b = coords[k].p;
      if (ops[k - 1] === "-|") points.push({ x: b.x, y: a.y });
      else if (ops[k - 1] === "|-") points.push({ x: a.x, y: b.y });
      points.push(b);
    }
    if (coords.slice(1, -1).some((c) => c.node)) issues.push("\\draw: a node in the middle of a path became a fixed point");
  }
  const first = coords[0].node, last = coords[coords.length - 1].node;
  let edge: SketchEdge = {
    id: nextId("e", model.edges),
    from: first?.id,
    to: last && last !== first ? last.id : undefined,
    points,
    arrow,
    route,
    label,
  };
  if (reversed) edge = reverseEdge(edge);
  model.edges.push(edge);
}

/* ------------------------------------------------------------- SVG layout */

export interface NodeGeom {
  id: string;
  shape: NodeShape;
  label: string;
  /** All in SVG units (cm * PX_PER_CM). */
  cx: number;
  cy: number;
  w: number;
  h: number;
  kind: "rect" | "ellipse" | "polygon";
  rx: number;
  points: Pt[];
}

export interface EdgeGeom {
  id: string;
  points: Pt[];
  heads: Pt[][];
  label?: { x: number; y: number; text: string; anchor: "start" | "middle" | "end"; baseline: "auto" | "middle" | "hanging" };
}

export interface Layout {
  width: number;
  height: number;
  nodes: NodeGeom[];
  edges: EdgeGeom[];
  /** Content bounds with a margin, for a cropped preview. */
  bounds: Box;
}

const HEAD_LEN = 0.23; // cm: arrows.meta Stealth at 0.8pt
const HEAD_HALF = 0.1;
const HEAD_INSET = 0.07;
const LABEL_GAP = 0.1; // cm: inner sep plus a little
export const FONT_CM = 0.33; // \small

function arrowHead(tip: Pt, from: Pt): Pt[] {
  const dx = tip.x - from.x, dy = tip.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const bx = tip.x - ux * HEAD_LEN, by = tip.y - uy * HEAD_LEN;
  const ix = tip.x - ux * (HEAD_LEN - HEAD_INSET), iy = tip.y - uy * (HEAD_LEN - HEAD_INSET);
  return [tip, { x: bx - uy * HEAD_HALF, y: by + ux * HEAD_HALF }, { x: ix, y: iy }, { x: bx + uy * HEAD_HALF, y: by - ux * HEAD_HALF }];
}

/** The geometry both the SVG string and the React preview draw - one source, so they cannot drift. */
export function layoutDiagram(model: Diagram): Layout {
  const S = PX_PER_CM;
  const px = (p: Pt): Pt => ({ x: r2(p.x * S), y: r2(p.y * S) });
  const nodes: NodeGeom[] = model.nodes.map((n) => ({
    id: n.id,
    shape: n.shape,
    label: n.label,
    cx: r2(n.x * S),
    cy: r2(n.y * S),
    w: r2(n.w * S),
    h: r2(n.h * S),
    kind: n.shape === "ellipse" || n.shape === "circle" ? "ellipse" : n.shape === "box" || n.shape === "round" ? "rect" : "polygon",
    rx: n.shape === "round" ? r2(0.14 * S) : 0,
    points: n.shape === "decision" || n.shape === "io" ? outline(n).map(px) : [],
  }));
  const edges: EdgeGeom[] = [];
  for (const e of model.edges) {
    const g = edgeGeometry(model, e);
    if (!g) continue;
    const heads: Pt[][] = [];
    if (e.arrow !== "-") heads.push(arrowHead(g[g.length - 1], g[g.length - 2]).map(px));
    if (e.arrow === "<->") heads.push(arrowHead(g[0], g[1]).map(px));
    const geom: EdgeGeom = { id: e.id, points: g.map(px), heads };
    const spot = e.label ? edgeLabelSpot(model, e) : null;
    if (spot) {
      const pl = spot.placement;
      const vy = pl.includes("above") ? -LABEL_GAP : pl.includes("below") ? LABEL_GAP : 0;
      const hx = pl.includes("left") ? -LABEL_GAP : pl.includes("right") ? LABEL_GAP : 0;
      geom.label = {
        ...px({ x: spot.at.x + hx, y: spot.at.y + vy }),
        text: e.label,
        anchor: hx < 0 ? "end" : hx > 0 ? "start" : "middle",
        baseline: vy < 0 ? "auto" : vy > 0 ? "hanging" : "middle",
      };
    }
    edges.push(geom);
  }
  // Content bounds: node boxes, edge vertices, a margin for labels.
  const xs: number[] = [], ys: number[] = [];
  for (const n of nodes) xs.push(n.cx - n.w / 2, n.cx + n.w / 2), ys.push(n.cy - n.h / 2, n.cy + n.h / 2);
  for (const e of edges) for (const p of e.points) xs.push(p.x), ys.push(p.y);
  const m = 0.5 * S;
  const bounds = xs.length
    ? { x: r2(Math.min(...xs) - m), y: r2(Math.min(...ys) - m), w: r2(Math.max(...xs) - Math.min(...xs) + 2 * m), h: r2(Math.max(...ys) - Math.min(...ys) + 2 * m) }
    : { x: 0, y: 0, w: model.width * S, h: model.height * S };
  return { width: model.width * S, height: model.height * S, nodes, edges, bounds };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ptsAttr = (ps: Pt[]) => ps.map((p) => p.x + "," + p.y).join(" ");

/** A standalone SVG of the model (for tests and "Download SVG"). Labels are shown as source text. */
export function toSvg(model: Diagram, opts: { crop?: boolean; color?: string } = {}): string {
  const L = layoutDiagram(model);
  const vb = opts.crop ? L.bounds : { x: 0, y: 0, w: L.width, h: L.height };
  const ink = opts.color ?? "#1f2937";
  const font = r2(FONT_CM * PX_PER_CM);
  const sw = r2((0.8 / 28.45) * PX_PER_CM);
  const out: string[] = [];
  out.push(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + [vb.x, vb.y, vb.w, vb.h].join(" ") + '" width="' + vb.w + '" height="' + vb.h + '" font-family="serif" font-size="' + font + '">',
  );
  for (const n of L.nodes) {
    const common = ' data-id="' + n.id + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"';
    if (n.kind === "rect")
      out.push('<rect x="' + r2(n.cx - n.w / 2) + '" y="' + r2(n.cy - n.h / 2) + '" width="' + n.w + '" height="' + n.h + '" rx="' + n.rx + '"' + common + "/>");
    else if (n.kind === "ellipse") out.push('<ellipse cx="' + n.cx + '" cy="' + n.cy + '" rx="' + r2(n.w / 2) + '" ry="' + r2(n.h / 2) + '"' + common + "/>");
    else out.push('<polygon points="' + ptsAttr(n.points) + '"' + common + "/>");
    if (n.label) out.push('<text x="' + n.cx + '" y="' + n.cy + '" text-anchor="middle" dominant-baseline="middle" fill="' + ink + '">' + xml(n.label) + "</text>");
  }
  for (const e of L.edges) {
    out.push('<polyline data-id="' + e.id + '" points="' + ptsAttr(e.points) + '" fill="none" stroke="' + ink + '" stroke-width="' + sw + '"/>');
    for (const h of e.heads) out.push('<polygon points="' + ptsAttr(h) + '" fill="' + ink + '"/>');
    if (e.label)
      out.push(
        '<text x="' + e.label.x + '" y="' + e.label.y + '" text-anchor="' + e.label.anchor + '" dominant-baseline="' + e.label.baseline + '" fill="' + ink + '">' + xml(e.label.text) + "</text>",
      );
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}
