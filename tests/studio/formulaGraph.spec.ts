import { check, finish } from "../harness";
import {
  analyzeEquation,
  buildFormulaGraph,
  extractSymbols,
  layoutGraph,
  lineage,
  type FormulaGraph,
} from "../../src/lib/studio/formulaGraph";

const syms = (latex: string) => extractSymbols(latex).join(" ");
const sides = (latex: string) => {
  const a = analyzeEquation(latex);
  return "def[" + a.defines.join(" ") + "] use[" + a.uses.join(" ") + "]";
};
const edgesOf = (g: FormulaGraph, kind: string) =>
  g.edges.filter((e) => e.kind === kind).map((e) => e.from + ">" + e.to).join(" ");

/* -------------------------------------------------------------- symbols */

check("LHS defined, RHS used", sides("y = W x + b"), "def[y] use[W x b]");
check("function arguments on the LHS are used, not defined", sides("\\mathcal{L}(\\theta) = \\|y - f(x)\\|^2"), "def[\\mathcal{L}] use[\\theta y f x]");
check("inequality between expressions: everything used", sides("a + b \\le c"), "def[] use[a b c]");
check(":= and \\triangleq define", sides("\\mu := \\frac{1}{N} s") + " | " + sides("\\Sigma \\triangleq C"), "def[\\mu] use[N s] | def[\\Sigma] use[C]");
check("relations inside braces and parens do not split", sides("P(X = x) = p_x"), "def[P] use[X x p]");
check("index subscripts fold into the base symbol", syms("x_i + x_{t-1} + W^{(l)} h_{ij}"), "x W h");
check("text-like subscript makes a distinct named symbol", syms("\\mathcal{L}_{\\text{CE}} + \\mathcal{L}_\\text{KL} + \\mathcal{L}"), "\\mathcal{L}_{\\text{CE}} \\mathcal{L}_{\\text{KL}} \\mathcal{L}");
check("fonts and accents are distinct symbols", syms("\\mathbf{W} W \\hat{y} y \\boldsymbol\\mu \\mathbb{E}"), "\\mathbf{W} W \\hat{y} y \\boldsymbol{\\mu} \\mathbb{E}");
check("function names and differentials are excluded", syms("\\int_0^T \\sin(\\omega t)\\, dt + \\log p + \\exp(-x) + \\max_\\theta J + \\frac{dy}{dx}"), "T \\omega t p x \\theta J y");
check("\\text{} prose is not a symbol, single words are named quantities", syms("x \\text{ if } x > 0, \\text{otherwise } 0 + \\text{Loss} + \\operatorname{Attn}(Q)"), "x \\text{Loss} \\operatorname{Attn} Q");
check("numbers, labels, environments, constants ignored", syms("\\begin{array}{cc} 2 & \\pi r^2 \\end{array} \\label{eq:area} \\in \\mathbb{R}"), "r");
check("exponents are uses, transposes are not", syms("e^{-\\lambda t} + A^\\top + B^T + x^{n}"), "\\lambda t A B x n");
check("sum limits skip the bound variable", syms("\\sum_{i=1}^{N} a_i"), "N a");
check("unicode greek maps to commands", syms("\u03b8 + \u03a3"), "\\theta \\Sigma");

/* ----------------------------------------------------------- equations */

const doc = [
  "Intro text", //                                      1
  "\\begin{align}", //                                  2
  "  z &= W x + b \\label{eq:z} \\\\", //                3
  "  a &= \\sigma(z) \\\\", //                           4
  "    &= \\frac{1}{1 + e^{-z}} \\nonumber", //          5
  "\\end{align}", //                                    6
  "By \\eqref{eq:z} the loss is", //                    7
  "$$", //                                              8
  "L = (a - y)^2", //                                   9
  "$$", //                                              10
  "and $d = 512$ inline.", //                           11
].join("\n");
const g = buildFormulaGraph(doc);
const eqs = g.nodes.filter((n) => n.kind === "equation");

check("align rows become separate equation nodes", eqs.map((n) => n.label).join(" | "), "Eq. 1 | Eq. 2 | = \\frac{1}{1 + e^{-z}} | L = (a - y)^2");
check("row and block line spans", eqs.map((n) => n.lines!.join("-") + "/" + n.blockLines!.join("-")).join(" "), "3-3/2-6 4-4/2-6 5-5/2-6 8-10/8-10");
check("\\label key recorded", eqs[0].key ?? "", "eq:z");
check("continuation row inherits the previous LHS", edgesOf(g, "defines"), "eq:0>sym:z eq:1>sym:a eq:2>sym:a eq:3>sym:L");
check("feeds edges follow definitions and \\eqref", edgesOf(g, "feeds"), "eq:0>eq:1 eq:0>eq:2 eq:2>eq:3 eq:0>eq:3");
check("undefined symbols are flagged", g.nodes.filter((n) => n.kind === "symbol" && !n.defined).map((n) => n.latex).join(" "), "W x b \\sigma y");
check("symbol lines follow the primary definition", g.nodes.find((n) => n.id === "sym:a")!.lines!.join("-") + " " + g.nodes.find((n) => n.id === "sym:a")!.primary, "4-4 eq:1");
check("inline equations off by default, on by option", String(eqs.some((n) => n.inline)) + " " + buildFormulaGraph(doc, { includeInline: true }).nodes.filter((n) => n.inline).map((n) => n.latex + "@" + n.lines!.join("-")).join(), "false d = 512@11-11");
check("starred / \\nonumber / \\tag numbering", buildFormulaGraph("\\begin{equation*}a=1\\end{equation*}\n\\begin{equation}b=a\\end{equation}\n\\begin{equation}c=b\\tag{A.1}\\end{equation}\n\\begin{equation}d=c\\end{equation}").nodes.filter((n) => n.kind === "equation").map((n) => n.label).join(" | "), "a=1 | Eq. 1 | (A.1) | Eq. 2");
check("roots and leaves", g.roots.join(" ") + " / " + g.leaves.join(" "), "sym:W sym:x sym:b sym:\\sigma sym:y / sym:L");
check("lineage walks upstream and downstream", (() => {
  const l = lineage(g, "sym:z");
  return l.upstream.sort().join(" ") + " / " + l.downstream.sort().join(" ");
})(), "eq:0 sym:W sym:b sym:x / eq:1 eq:2 eq:3 sym:L sym:a");
check("no equations, no graph; malformed input does not throw", JSON.stringify(buildFormulaGraph("just prose $x$ and $$ unclosed")), JSON.stringify({ nodes: [], edges: [], roots: [], leaves: [] }));

/* --------------------------------------------------------------- layout */

const cyc = buildFormulaGraph("$$x = f(y)$$\n$$y = g(x)$$\n$$x = x + 1$$");
const cl = layoutGraph(cyc);
check("cycles are laid out (every node placed)", String(Object.keys(cl.positions).length) + " " + String(cyc.nodes.length), "7 7");
check("empty graph lays out to nothing", JSON.stringify(layoutGraph({ nodes: [], edges: [], roots: [], leaves: [] })), JSON.stringify({ positions: {}, width: 0, height: 0, ranks: [] }));
const one = buildFormulaGraph("$$ \\sum 1 $$");
check("single node", JSON.stringify(layoutGraph(one).ranks), JSON.stringify([["eq:0"]]));

// A large chain-ish document: each equation uses the two previous definitions.
const big = Array.from({ length: 80 }, (_, k) => "$$ v_{" + k + "} = " + (k ? "\\alpha\\, v_" + (k - 1) : "c") + " $$")
  .join("\n")
  .replace(/v_\{(\d+)\}/g, (_, n: string) => "\\mathrm{v" + n + "}")
  .replace(/v_(\d+)/g, (_, n: string) => "\\mathrm{v" + n + "}");
const bg = buildFormulaGraph(big);
const t0 = Date.now();
const bl = layoutGraph(bg);
const elapsed = Date.now() - t0;
check("~160 nodes lay out quickly", String(bg.nodes.length >= 160) + " " + String(elapsed < 500), "true true");
check("layout is deterministic", JSON.stringify(layoutGraph(bg)), JSON.stringify(bl));
const overlaps = (lay: ReturnType<typeof layoutGraph>) =>
  lay.ranks.some((ids) => {
    const boxes = ids.map((id) => lay.positions[id]).sort((a, b) => a.y - b.y);
    return boxes.some((b, k) => k > 0 && b.y < boxes[k - 1].y + boxes[k - 1].h);
  });
check("no two nodes in a rank overlap", String(overlaps(bl)) + " " + String(overlaps(layoutGraph(g))) + " " + String(overlaps(cl)), "false false false");
check("ranks run left to right along the dependency", String(bl.positions["eq:0"].x < bl.positions["sym:\\mathrm{v0}"].x) + " " + String(bl.positions["sym:\\mathrm{v0}"].x < bl.positions["eq:1"].x), "true true");

{
  const a = analyzeEquation("d = e + f (some raw text here)");
  check("bare prose in an equation is not mistaken for symbols", a.defines.join(",") + " | " + a.uses.sort().join(","), "d | e,f");
}

finish("formulaGraph");
