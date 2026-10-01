import { check, finish } from "../harness";
import { DEFAULT_SYMBOL_OPTIONS, extractSymbols, generateSymbols, heads, scanMath, type SymbolOptions } from "../../src/lib/lab/symbols";

const ids = (math: string) => scanMath(math).map((o) => o.id).join(" ");
const all: SymbolOptions = { sort: "appearance", excludeConstants: false, excludeIndices: false };
const list = (src: string, o: SymbolOptions = all) => extractSymbols(src, o).symbols.map((s) => s.latex).join(" ");
const def = (src: string, latex: string) => {
  const s = extractSymbols(src, all).symbols.find((x) => x.latex === latex);
  return s ? (s.defined ? "defined:" + s.via + ":" + s.description : "undefined") : "(absent)";
};

// --- extraction ---------------------------------------------------------------
check("scan: Greek, font-styled, decorated, nested decorations", ids("\\theta + \\Lambda \\varepsilon \\mathbf{W} \\boldsymbol{\\mu} \\mathcal{L} \\mathbb{E} \\bm{x} \\hat{\\mathbf{y}} \\vec v"), "\\theta \\Lambda \\varepsilon \\mathbf{W} \\boldsymbol{\\mu} \\mathcal{L} \\mathbb{E} \\bm{x} \\hat{\\mathbf{y}} \\vec{v}");
check("scan: x_i, x_{t+1}, x^2 are all x; \\hat{y} is not y", list("$x_i + x_{t+1} + x^2$ and $\\hat{y}$"), "x i t \\hat{y}");
check("scan: \\text{}, \\operatorname{}, \\mathrm{}, \\label{} and env names never become symbols", list("\\begin{equation} a = \\text{where} \\operatorname{softmax}(b) \\mathrm{ReLU} \\label{eq:xyz} \\end{equation}"), "a b");
check("scan: function names and numbers are skipped", ids("\\sin x + \\log(y) + \\max_z 42 + exp(w) + softmax(u)"), "x y z w u");
check("scan: differential d skipped in dx, d\\theta, \\frac{d}{dt}; a lone d stays", ids("\\int f(x)\\,dx + \\int g\\, d\\theta + \\frac{d}{dt} + \\mathbb{R}^d"), "f x x g \\theta t \\mathbb{R} d");
check("scan: transpose T is not a symbol, a T elsewhere is", ids("W^T + W^{\\top} + T"), "W W T");
{
  const r = extractSymbols("$x$ on line 1\n\n\\begin{align}\n  y &= x \\\\\n  z &= y\n\\end{align}", all);
  check("count and first line (inside a multi-line environment)", r.symbols.map((s) => s.latex + ":" + s.count + "@" + s.firstLine).join(" "), "x:2@1 y:2@4 z:1@5");
}
check("preamble and % comments are skipped", list("\\documentclass{article}\n\\newcommand{\\v}{$q$}\n\\begin{document}\n$a$ % $b$ hidden\n50\\% of $c$\n\\end{document}"), "a c");
check("markdown: '50%' is a percent sign, not a comment", list("About 50% of $a$ and $b$."), "a b");

// --- definitions ----------------------------------------------------------------
check("def: where $X$ is the ...", def("We minimise $f(W)$, where $W$ is the weight matrix, and stop.", "W"), "defined:prose:weight matrix");
check("def: $X$ denotes ...", def("Here $\\mu$ and $\\sigma$ denote the mean and variance.", "\\sigma"), "defined:prose:mean and variance");
check("def: let $X$ be ...", def("Let $G$ be a graph with $n$ nodes.", "G"), "defined:prose:graph with $n$ nodes");
check("def: we denote ... by $X$", def("We denote the hidden state by $h_t$.", "h"), "defined:prose:hidden state");
check("def: ..., denoted by $X$", def("The learning rate, denoted by $\\eta$, decays.", "\\eta"), "defined:prose:learning rate");
check("def: Here, $X$ ...", def("Here, $\\lambda$ controls regularization.", "\\lambda"), "defined:prose:controls regularization");
check("def: typed $X \\in \\mathbb{R}^{...}$", def("Take $x \\in \\mathbb{R}^{d}$.", "x"), "defined:typed:$\\in \\mathbb{R}^{d}$");
check("def: two symbols in one list", def("where $a$, $b$ and $c$ are constants.", "b"), "defined:prose:constants");
check("def: 'and $y$ is' starts a second definition", def("where $x$ is the input and $y$ is the label.", "x") + " | " + def("where $x$ is the input and $y$ is the label.", "y"), "defined:prose:input | defined:prose:label");
check("def: apposition 'the learning rate $\\eta$'", def("We use Adam with the learning rate $\\eta$.", "\\eta"), "defined:apposition:learning rate");
check("no def: 'the arg-max of $p$' is not an apposition", def("It is the arg-max of $p$ here.", "p"), "undefined");
check("def: 'where $Q = XW$' defines the left side", def("We set $A = QK$, where $Q = XW$.", "Q") + " | " + def("We set $A = QK$, where $Q = XW$.", "A"), "defined:assign:$= XW$ | undefined");
check("no def: '$x$ is large' (no article, no where)", def("Note that $x$ is large here.", "x"), "undefined");
check("no def: a symbol only used in an equation", def("We have $y = Wx + b$ for all inputs.", "W"), "undefined");
check("heads: only simple math names a symbol", [heads("x_i").ids, heads("f(x)").ids, heads("x, y").ids, heads("x + y").ids].map((h) => h.join("+") || "-").join(" "), "x f x+y -");

// --- options --------------------------------------------------------------------
{
  const src = "$\\sum_{i=1}^{n} x_i e^{i\\pi} \\in \\mathbb{R}$ and $y_j$";
  check("exclude: constants and subscript-only indices hidden", list(src, DEFAULT_SYMBOL_OPTIONS), "n x y");
  check("exclude: off keeps everything", list(src, all), "i n x e \\pi \\mathbb{R} y j");
  check("exclude: an index letter used as a base symbol is kept", list("$n$ and $x_n$", DEFAULT_SYMBOL_OPTIONS), "n x");
}
check("sort: alphabetical puts Latin before Greek, Greek in Greek order", list("$\\theta \\beta B a \\hat{a} \\eta \\Gamma$", { ...all, sort: "alpha" }), "a \\hat{a} B \\beta \\Gamma \\eta \\theta");

// --- generators ------------------------------------------------------------------
{
  const r = extractSymbols("where $\\alpha$ is the step size, and $\\beta$ appears.", all);
  check("table: descriptions or \\textit{TODO}", generateSymbols(r.symbols, "table").split("\n").filter((l) => l.includes("$")).join("\n"), "    $\\alpha$ & step size \\\\\n    $\\beta$ & \\textit{TODO} \\\\");
  check("nomencl: package, ordered prefixes, print", generateSymbols(r.symbols, "nomenclature").split("\n").filter((l) => /^\\/.test(l)).join("\n"), "\\usepackage{nomencl}\n\\makenomenclature\n\\nomenclature[s1]{$\\alpha$}{step size}\n\\nomenclature[s2]{$\\beta$}{\\textit{TODO}}\n\\printnomenclature");
  check("markdown: pipes in math escaped", generateSymbols([{ ...r.symbols[0], latex: "|x|" }], "markdown"), "| Symbol | Description |\n| --- | --- |\n| $\\|x\\|$ | step size |\n");
  check("empty input gives empty output", generateSymbols([], "table") + extractSymbols("").stats.symbols, "0");
}

finish("symbols");
