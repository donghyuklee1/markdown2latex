import { check, finish } from "../harness";
import {
  applyStroke,
  emptyDiagram,
  escapeLabel,
  layoutDiagram,
  moveNode,
  parseTikz,
  PX_PER_CM,
  recognizeStroke,
  removeItem,
  sampleDiagram,
  setLabel,
  toSvg,
  toTikz,
  unescapeLabel,
  type Diagram,
  type Pt,
  type StrokePoint,
} from "../../src/lib/studio/sketch";

/* Synthetic hand-drawn strokes: densely sampled outlines with seeded jitter,
 * so recognition is tested against wobble, not against perfect geometry. */

function prng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let clock = 0;
function stroke(vertices: Pt[], seed: number, jitter = 0.03, step = 0.05): StrokePoint[] {
  const rnd = prng(seed);
  const out: StrokePoint[] = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + t * (b.x - a.x) + (rnd() - 0.5) * 2 * jitter, y: a.y + t * (b.y - a.y) + (rnd() - 0.5) * 2 * jitter, t: (clock += 8) });
    }
  }
  return out;
}
const rect = (x: number, y: number, w: number, h: number, seed: number) =>
  stroke([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y: y + 0.05 }], seed);
const ellipse = (cx: number, cy: number, a: number, b: number, seed: number) =>
  stroke(Array.from({ length: 73 }, (_, i) => ({ x: cx + a * Math.cos((i / 72) * 2 * Math.PI * 1.02), y: cy + b * Math.sin((i / 72) * 2 * Math.PI * 1.02) })), seed);
const diamond = (cx: number, cy: number, a: number, b: number, seed: number) =>
  stroke([{ x: cx, y: cy - b }, { x: cx + a, y: cy }, { x: cx, y: cy + b }, { x: cx - a, y: cy }, { x: cx + 0.04, y: cy - b + 0.04 }], seed);
const roundRect = (x: number, y: number, w: number, h: number, r: number, seed: number) => {
  const v: Pt[] = [];
  const arc = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= 8; i++) v.push({ x: cx + r * Math.cos(a0 + (i / 8) * (Math.PI / 2)), y: cy + r * Math.sin(a0 + (i / 8) * (Math.PI / 2)) });
  };
  arc(x + w - r, y + r, -Math.PI / 2);
  arc(x + w - r, y + h - r, 0);
  arc(x + r, y + h - r, Math.PI / 2);
  arc(x + r, y + r, Math.PI);
  v.push({ ...v[0] });
  return stroke(v, seed);
};
const kinds = (s: StrokePoint[]) => {
  const r = recognizeStroke(s);
  return r.kind + (r.rounded ? "(rounded)" : "");
};
const box = (s: StrokePoint[]) => {
  const b = recognizeStroke(s).box;
  return b ? [b.x, b.y, b.w, b.h].join(",") : "none";
};
const pts = (ps: Pt[] | undefined) => (ps ?? []).map((p) => "(" + p.x + "," + p.y + ")").join(" ");

/* ------------------------------------------------------------ recognition */

check("rectangle recognised", kinds(rect(1, 1, 3, 1.5, 1)), "rectangle");
check("rectangle snapped to the 0.25 grid", box(rect(1.07, 0.96, 2.9, 1.53, 2)), "1,1,3,1.5");
check("near-square snaps to a square", (() => { const b = recognizeStroke(rect(2, 2, 2, 1.85, 3)).box!; return String(b.w === b.h); })(), "true");
check("rounded rectangle recognised", kinds(roundRect(1, 1, 3, 1.5, 0.45, 4)), "rectangle(rounded)");
check("circle recognised and snapped round", (() => { const r = recognizeStroke(ellipse(4, 4, 1, 0.94, 5)); return r.kind + " " + (r.box!.w === r.box!.h); })(), "circle true");
check("ellipse recognised", kinds(ellipse(5, 4, 2, 0.8, 6)), "ellipse");
check("diamond recognised", kinds(diamond(5, 4, 1.5, 1, 7)), "diamond");
check("square diamond is not a circle", kinds(diamond(5, 4, 1, 1, 8)), "diamond");
check("straight line recognised", kinds(stroke([{ x: 1, y: 1 }, { x: 5, y: 1.1 }], 9)), "line");
check("near-horizontal line snapped exactly horizontal", pts(recognizeStroke(stroke([{ x: 1.02, y: 2.03 }, { x: 5.1, y: 2.3 }], 10)).points), "(1,2) (5,2)");
check("near-vertical line snapped exactly vertical", pts(recognizeStroke(stroke([{ x: 3.1, y: 1 }, { x: 3.3, y: 5 }], 11)).points), "(3,1) (3,5)");
check(
  "one-stroke arrow (shaft + back-and-forth V)",
  (() => {
    const r = recognizeStroke(stroke([{ x: 1, y: 3 }, { x: 5, y: 3 }, { x: 4.7, y: 2.75 }, { x: 5, y: 3 }, { x: 4.7, y: 3.25 }], 12, 0.015));
    return r.kind + " " + pts(r.points);
  })(),
  "arrow (1,3) (5,3)",
);
check("L-shaped stroke is a polyline with an axis-aligned corner", pts(recognizeStroke(stroke([{ x: 1, y: 1 }, { x: 4, y: 1.1 }, { x: 4.1, y: 4 }], 13)).points), "(1,1) (4,1) (4,4)");
check(
  "zigzag scribble rejected",
  kinds(stroke(Array.from({ length: 14 }, (_, i) => ({ x: 1 + i * 0.3, y: i % 2 ? 1 : 2.2 })), 14)),
  "scribble",
);
check(
  "scribble that circles many times rejected",
  kinds(stroke(Array.from({ length: 200 }, (_, i) => ({ x: 4 + Math.cos(i / 6) * (0.5 + (i % 7) * 0.05), y: 4 + Math.sin(i / 6) * 0.6 })), 15)),
  "scribble",
);
const seeds = Array.from({ length: 12 }, (_, i) => 100 + i);
check(
  "recognition is stable across 12 jitter seeds per shape",
  [
    seeds.map((k) => kinds(rect(1 + (k % 3) * 0.1, 1, 2 + (k % 4) * 0.5, 1 + (k % 2) * 0.5, k))).filter((x) => x !== "rectangle").length,
    seeds.map((k) => kinds(ellipse(5, 4, 1.5 + (k % 3) * 0.4, 0.8, k))).filter((x) => x !== "ellipse").length,
    seeds.map((k) => kinds(ellipse(5, 4, 1.2, 1.2, k))).filter((x) => x !== "circle").length,
    seeds.map((k) => kinds(diamond(5, 4, 1.2 + (k % 3) * 0.3, 0.9, k))).filter((x) => x !== "diamond").length,
    seeds.map((k) => kinds(stroke([{ x: 1, y: 1 }, { x: 2 + (k % 5), y: 1 + (k % 3) }], k))).filter((x) => x !== "line").length,
    seeds.map((k) => kinds(stroke([{ x: 1, y: 3 }, { x: 5, y: 3 }, { x: 4.7, y: 2.7 }, { x: 5, y: 3 }, { x: 4.7, y: 3.3 }], k, 0.02))).filter((x) => x !== "arrow").length,
  ].join(","),
  "0,0,0,0,0,0",
);
check("one barb is enough for a one-stroke arrow", kinds(stroke([{ x: 1, y: 1 }, { x: 1, y: 5 }, { x: 0.75, y: 4.65 }], 16, 0.015)), "arrow");
check("a tap is rejected", kinds([{ x: 1, y: 1 }, { x: 1.02, y: 1.01 }]), "scribble");
check("garbage input does not throw", kinds([{ x: NaN, y: 1 }, null as unknown as StrokePoint]), "scribble");

/* -------------------------------------------------------------- the model */

let m: Diagram = emptyDiagram();
m = applyStroke(m, rect(1, 1, 2.5, 1, 20)).model;
m = applyStroke(m, rect(6, 1, 2.5, 1, 21)).model;
m = applyStroke(m, diamond(7.25, 5, 1.25, 0.75, 22)).model;
check("three strokes -> three nodes with stable ids", m.nodes.map((n) => n.id + ":" + n.shape + "@" + n.x + "," + n.y).join(" "), "n1:box@2.25,1.5 n2:box@7.25,1.5 n3:decision@7.25,5");

const conn = applyStroke(m, stroke([{ x: 3.6, y: 1.5 }, { x: 5.9, y: 1.55 }], 23));
check("line from one box to another becomes an attached arrow", JSON.stringify([conn.action, conn.recognition.kind, conn.model.edges[0].from, conn.model.edges[0].to, conn.model.edges[0].arrow]), '["edge","arrow","n1","n2","->"]');
m = conn.model;

const ell = applyStroke(m, stroke([{ x: 2.25, y: 2.3 }, { x: 2.3, y: 5 }, { x: 5.9, y: 5.05 }], 24));
check("L-shaped connector between nodes routes |-", ell.model.edges[1].route + " " + ell.model.edges[1].from + "->" + ell.model.edges[1].to, "|- n1->n3");
m = ell.model;

const free = applyStroke(m, stroke([{ x: 1, y: 8 }, { x: 4, y: 8 }], 25));
check("line in empty space stays a free path without a head", JSON.stringify([free.model.edges[2].from ?? null, free.model.edges[2].arrow, free.model.edges[2].points]), '[null,"-",[{"x":1,"y":8},{"x":4,"y":8}]]');
clock += 300;
const head = applyStroke(free.model, stroke([{ x: 3.7, y: 7.75 }, { x: 4, y: 8 }, { x: 3.7, y: 8.25 }], 26, 0.01, 0.03), {}, free.last);
check("small V drawn right after a line merges into its arrowhead", head.action + " " + head.model.edges[2].arrow + " edges=" + head.model.edges.length, "arrowhead -> edges=3");
clock += 10000;
const late = applyStroke(free.model, stroke([{ x: 3.7, y: 7.75 }, { x: 4, y: 8 }, { x: 3.7, y: 8.25 }], 27, 0.01, 0.03), {}, free.last);
check("the same V long after the line is not an arrowhead", late.action === "arrowhead" ? "merged" : "separate", "separate");
const tail = applyStroke(free.model, stroke([{ x: 1.3, y: 7.75 }, { x: 1, y: 8 }, { x: 1.3, y: 8.25 }], 28, 0.01, 0.03), {}, { edgeId: "e3" });
check("V at the start of a plain line reverses it into ->", tail.model.edges[2].arrow + " " + pts(tail.model.edges[2].points), "-> (4,8) (1,8)");
m = head.model;

const moved = moveNode(m, "n2", 0.5, 0.5);
check("moving a node drags attached edge ends", pts(moved.edges[0].points), "(2.25,1.5) (7.75,2)");
check("erasing a node removes its connectors", (() => { const r = removeItem(m, "n1"); return r.nodes.length + " nodes, edges " + r.edges.map((e) => e.id).join(","); })(), "2 nodes, edges e3");

/* ------------------------------------------------------------------ TikZ */

const small: Diagram = {
  width: 12,
  height: 9,
  nodes: [
    { id: "n1", shape: "box", x: 2, y: 2, w: 2, h: 1, label: "Encoder" },
    { id: "n2", shape: "round", x: 6, y: 2, w: 2, h: 1, label: "$\\mathrm{softmax}(QK^\\top)$" },
    { id: "n3", shape: "decision", x: 6, y: 5, w: 2, h: 1.5, label: "stop?" },
  ],
  edges: [
    { id: "e1", from: "n1", to: "n2", points: [{ x: 2, y: 2 }, { x: 6, y: 2 }], arrow: "->", route: "--", label: "$h_t$" },
    { id: "e2", from: "n1", to: "n3", points: [{ x: 2, y: 2 }, { x: 6, y: 5 }], arrow: "->", route: "|-", label: "" },
    { id: "e3", points: [{ x: 8, y: 7 }, { x: 10, y: 7 }, { x: 10, y: 8.5 }], arrow: "<->", route: "--", label: "free" },
  ],
};
check(
  "TikZ for a small diagram",
  toTikz(small),
  [
    "% sketch2tikz canvas 12x9 cm",
    "% needs \\usetikzlibrary{arrows.meta,positioning,shapes.geometric}",
    "\\begin{tikzpicture}[node distance=1.5cm, >=Stealth, line width=0.8pt, every node/.style={font=\\small, align=center}]",
    "  \\tikzset{",
    "    box/.style={draw, rectangle},",
    "    round/.style={draw, rectangle, rounded corners=4pt},",
    "    decision/.style={draw, diamond},",
    "    io/.style={draw, trapezium, trapezium left angle=70, trapezium right angle=110, trapezium stretches=true},",
    "    oval/.style={draw, ellipse},",
    "    circ/.style={draw, circle}",
    "  }",
    "  \\node[box, inner sep=1pt, minimum width=2cm, minimum height=1cm] (n1) at (2,7) {Encoder};",
    "  \\node[round, inner sep=1pt, minimum width=2cm, minimum height=1cm] (n2) at (6,7) {$\\mathrm{softmax}(QK^\\top)$};",
    "  \\node[decision, inner sep=1pt, minimum width=2cm, minimum height=1.5cm] (n3) at (6,4) {stop?};",
    "  \\draw[->] (n1) -- (n2) node[midway, above] {$h_t$};",
    "  \\draw[->] (n1) |- (n3);",
    "  \\draw[<->] (8,2) -- (10,2) node[midway, above] {free} -- (10,0.5);",
    "\\end{tikzpicture}",
    "",
  ].join("\n"),
);
const doc = toTikz(small, { standalone: true });
check("standalone wrapper", [doc.split("\n")[0], doc.split("\n")[1], doc.trimEnd().split("\n").pop()].join(" | "), "\\documentclass[tikz, border=4pt]{standalone} | \\usetikzlibrary{arrows.meta,positioning,shapes.geometric} | \\end{document}");
check("label escaping keeps math", escapeLabel("R&D 50% a_b #1 $x_1 & y$"), "R\\&D 50\\% a\\_b \\#1 $x_1 & y$");
check("label escaping round-trips", unescapeLabel(escapeLabel("a_b {c} ~ ^ \\ $\\alpha_1$ 5$")), "a_b {c} ~ ^ \\ $\\alpha_1$ 5$");
check("toTikz is deterministic", String(toTikz(sampleDiagram()) === toTikz(sampleDiagram())), "true");

/* ---------------------------------------------------------------- parser */

const stable = (d: Diagram) => JSON.stringify(d);
const labelled = setLabel(setLabel(m, "n1", "In_1 & $x$"), "e1", "50%");
check("parse(toTikz(model)) round-trips a drawn diagram", stable(parseTikz(toTikz(labelled)).model), stable(labelled));
check("parse(toTikz(sample)) round-trips, standalone too", stable(parseTikz(toTikz(sampleDiagram(), { standalone: true })).model), stable(sampleDiagram()));
check("parse(toTikz(small)) round-trips", stable(parseTikz(toTikz(small)).model), stable(small));
const foreign = parseTikz("\\begin{tikzpicture}\n\\node[circle] (a) at (1,1) {A};\n\\fill (0,0) circle (2pt);\n\\draw[->, thick] (a.east) -- (3,1);\n\\draw (a) to[bend left] (b);\n\\node (c) at (2,2) {C}\n\\end{tikzpicture}");
check(
  "unsupported TikZ is reported, not thrown",
  foreign.model.nodes.length + " node, " + foreign.model.edges.length + " edge; " + foreign.issues.length + " issues: " + foreign.issues.map((s) => s.split(" ")[0]).join(" "),
  "1 node, 1 edge; 4 issues: \\fill \\draw: \\draw: Statement",
);

/* ------------------------------------------------------------------- SVG */

const svg = toSvg(small);
const rectOf = (id: string) => {
  const r = new RegExp('<rect x="([\\d.-]+)" y="([\\d.-]+)" width="([\\d.]+)" height="([\\d.]+)"[^>]*data-id="' + id + '"').exec(svg)!;
  return { cx: (Number(r[1]) + Number(r[3]) / 2) / PX_PER_CM, cy: (Number(r[2]) + Number(r[4]) / 2) / PX_PER_CM, w: Number(r[3]) / PX_PER_CM, h: Number(r[4]) / PX_PER_CM };
};
const tikzOf = (id: string) => {
  const r = new RegExp("minimum width=([\\d.]+)cm, minimum height=([\\d.]+)cm\\] \\(" + id + "\\) at \\(([\\d.-]+),([\\d.-]+)\\)").exec(toTikz(small))!;
  return { cx: Number(r[3]), cy: small.height - Number(r[4]), w: Number(r[1]), h: Number(r[2]) };
};
check("SVG node geometry equals the TikZ node (n1)", JSON.stringify(rectOf("n1")), JSON.stringify(tikzOf("n1")));
check("SVG node geometry equals the TikZ node (n2)", JSON.stringify(rectOf("n2")), JSON.stringify(tikzOf("n2")));
check("SVG diamond spans the TikZ minimum size", /<polygon points="240,170 280,200 240,230 200,200" data-id="n3"/.test(svg) ? "yes" : svg, "yes");
check("SVG connector clipped at node borders like TikZ", /<polyline data-id="e1" points="120,80 200,80"/.test(svg) ? "yes" : "no", "yes");
check("SVG |- connector goes via the corner to the diamond's left vertex", /<polyline data-id="e2" points="80,100 80,200 200,200"/.test(svg) ? "yes" : "no", "yes");
check("SVG draws heads: one for ->, two for <->", String(layoutDiagram(small).edges.map((e) => e.heads.length).join(",")), "1,1,2");
check("SVG escapes label text", /<text[^>]*>\$\\mathrm\{softmax\}\(QK\^\\top\)\$<\/text>/.test(svg) && !toSvg(setLabel(small, "n1", "<b>")).includes("<b>") ? "yes" : "no", "yes");

finish("sketch");
