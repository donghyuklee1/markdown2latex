import { check, finish } from "../harness";
import { bytesOf } from "../../src/lib/lab/archive";
import {
  expandMacros,
  extractEquations,
  parseArxivId,
  prepareSource,
  renderable,
  searchEquations,
  sourceUrl,
  withDefinitions,
  type SourceFile,
} from "../../src/lib/lab/arxiv";

/** Minimal ustar writer, test-only (same layout as archive.spec.ts). */
function tar(files: Array<[string, string]>): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, body] of files) {
    const data = bytesOf(body);
    const h = new Uint8Array(512);
    h.set(bytesOf(name), 0);
    h.set(bytesOf(data.length.toString(8).padStart(11, "0") + "\0"), 124);
    h[156] = 48;
    h.set(bytesOf("ustar\0" + "00"), 257);
    blocks.push(h);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of blocks) out.set(b, p), (p += b.length);
  return out;
}

async function gzip(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
}

const id = (s: string) => {
  const r = parseArxivId(s);
  return "id" in r ? r.id : "ERR";
};

const MAIN = String.raw`\documentclass{article}
\newcommand{\R}{\mathbb{R}}
\newcommand{\norm}[1]{\left\| #1 \right\|}
\newcommand{\E}[2][x]{\mathbb{E}_{#1}\left[#2\right]}
\DeclareMathOperator*{\argmax}{arg\,max}
\def\half{\frac{1}{2}}
\def\be{\begin{equation}}
\def\ee{\end{equation}}
\begin{document}
We minimise the loss below.
\begin{equation}
  L(\theta) = \norm{y - X\theta}^2 \label{eq:loss}
\end{equation}
% \begin{equation} commented = out \end{equation}
\begin{verbatim}
\[ verbatim = math \]
\end{verbatim}
It costs \$5 and \$6 in total, plus $x$ inline.
\input{sec/method}
\[ \hat\theta = \argmax_{\theta \in \R^d} \E{f(\theta)} \]
\be a = \half \ee
\end{document}
`;

const METHOD = String.raw`\section{Method}
\begin{align}
  a &= b \label{eq:a} \\
  c &= d \nonumber \\[2pt]
  e &= f \tag{$\star$} \\
  g &= h
\end{align}
\begin{subequations}
\begin{equation} p = 1 \end{equation}
\begin{equation} q = 2 \label{eq:q} \end{equation}
\end{subequations}
$$ z = 0 $$
`;

const files: SourceFile[] = [
  { path: "paper/main.tex", text: MAIN },
  { path: "paper/sec/method.tex", text: METHOD },
];

async function main() {
  // ids
  check("id: new style with version", id("2301.12345v2"), "2301.12345v2");
  check("id: arXiv: prefix", id("arXiv:2301.12345"), "2301.12345");
  check("id: old style with subject class", id("math.AG/0601001"), "math.AG/0601001");
  check("id: abs, pdf and export URLs", [id("https://arxiv.org/abs/2301.12345"), id("arxiv.org/pdf/2301.12345v3.pdf"), id("http://export.arxiv.org/abs/hep-th/9901001")].join(" "), "2301.12345 2301.12345v3 hep-th/9901001");
  check("id: rejects junk and a bad month", [id("hello"), id("2313.12345"), id("https://example.com/abs/2301.12345")].join(" "), "ERR ERR ERR");
  check("sourceUrl uses /src/, not /e-print/", sourceUrl("hep-th/9901001"), "https://arxiv.org/src/hep-th/9901001");

  // extraction
  const x = extractEquations(files);
  check("main file found among several", x.mainFile ?? "", "paper/main.tex");
  check("\\input is followed, in document order", x.files.join(" "), "paper/main.tex paper/sec/method.tex");
  check(
    "display math only, comments/verbatim/\\$ skipped, \\input spliced in place",
    x.equations.map((e) => e.env).join(" "),
    "equation align equation equation $$ \\[ equation",
  );
  check("exact body without the wrapper", x.equations[0].body, String.raw`L(\theta) = \norm{y - X\theta}^2 \label{eq:loss}`);
  check("source keeps the wrapper", x.equations[0].source.startsWith("\\begin{equation}") && x.equations[0].source.endsWith("\\end{equation}") ? "y" : "n", "y");
  check("file and line of an included equation", x.equations[1].file + ":" + x.equations[1].line, "paper/sec/method.tex:2");
  check("labels collected", x.equations[1].labels.join(","), "eq:a");
  check("\\nonumber row skips a number, \\tag overrides, \\\\[2pt] is not display math", x.equations[1].numbers.join(","), "2,$\\star$,3");
  check("subequations number as 4a, 4b", x.equations[2].numbers.join(",") + " " + x.equations[3].numbers.join(","), "4a 4b");
  check("$$ and \\[ are unnumbered", x.equations[4].numbers.length + "" + x.equations[5].numbers.length, "00");
  check("\\def\\be{\\begin{equation}} aliases are recognised and numbered", x.equations[6].body + " -> " + x.equations[6].numbers.join(), String.raw`a = \half -> 5`);
  check("macros used, transitively, in definition order", x.equations[5].macros.join(","), "R,E,argmax");
  check("begin/end aliases are not reported as needed macros", x.equations[6].macros.join(","), "half");
  check("prose before the equation kept as context", /minimise the loss below/.test(x.equations[0].context) ? "y" : "n", "y");

  const inl = extractEquations(files, { inline: true });
  check("inline math only when asked, never from \\$", inl.equations.filter((e) => e.env === "$").map((e) => e.body).join(","), "x");

  // numberwithin
  const nw = extractEquations([{ path: "a.tex", text: "\\documentclass{article}\\numberwithin{equation}{section}\\begin{document}\\section{A}\\begin{equation}a\\end{equation}\\section*{S}\\section{B}\\begin{equation}b\\end{equation}\\appendix\\section{X}\\begin{equation}c\\end{equation}\\end{document}" }]);
  check("numberwithin section; \\section* does not count; appendix letters", nw.equations.map((e) => e.numbers.join()).join(" "), "1.1 2.1 A.1");

  const harv = extractEquations([{ path: "old.tex", text: "\\input harvmac\nText.\n\\eqn\\decoupling{\\eqalign{a &= b \\cr c &= d \\cr}}\nMore $x$." }]);
  check("harvmac \\eqn\\label{...} is a numbered display equation", harv.equations.map((e) => e.env + " " + e.numbers.join() + " " + e.labels.join()).join("; "), "eqn 1 decoupling");
  check("harvmac \\eqalign renders as aligned", renderable(harv.equations[0], harv.equations[0].latex), "\\begin{aligned}a &= b \\\\ c &= d \\end{aligned}");

  // macros
  const defs = x.macros;
  check("macro kinds parsed", defs.map((d) => d.name + "/" + d.nargs).join(" "), "R/0 norm/1 E/2 argmax/0 half/0 be/0 ee/0");
  check("expand: args, optional default, operator, ^ grouping", expandMacros(String.raw`\norm{v}^\R + \E{g} + \E[z]{h} + \argmax_x`, defs).text, String.raw`\left\| v \right\|^{\mathbb{R}} + \mathbb{E}_{x}\left[g\right] + \mathbb{E}_{z}\left[h\right] + \operatorname*{arg\,max}_x`);
  check("expand: no-arg macro keeps the space, leaves builtins alone", expandMacros(String.raw`\R x + \alpha`, defs).text, String.raw`\mathbb{R} x + \alpha`);
  check("expand: a macro after \\hat stays one argument", expandMacros(String.raw`\hat\R + \alpha\half`, defs).text, String.raw`\hat{\mathbb{R}} + \alpha{\frac{1}{2}}`);
  check("expand: \\left fragments are not wrapped in a group", expandMacros(String.raw`\cdot\lp x\right)`, [{ name: "lp", kind: "newcommand", nargs: 0, optDefault: null, body: "\\left(", source: "", file: "", line: 1, unsafe: null }]).text, String.raw`\cdot\left( x\right)`);
  const loop = expandMacros("\\a", [{ name: "a", kind: "newcommand", nargs: 0, optDefault: null, body: "\\a+", source: "", file: "", line: 1, unsafe: null }]);
  check("expand: recursion stops and is reported", loop.skipped.map((s) => s.name + ":" + s.reason).join(), "a:recursive definition");
  const cond = extractEquations([{ path: "m.tex", text: "\\documentclass{article}\\def\\x#1.{#1}\\newcommand{\\y}{\\ifmmode a\\else b\\fi}\\begin{document}\\[\\x 1. \\y\\]\\end{document}" }]);
  const ce = expandMacros(cond.equations[0].latex, cond.macros);
  check("expand: delimited \\def and conditionals are left alone and reported", ce.text + " | " + ce.skipped.map((s) => s.name).join(","), "\\x 1. \\y | x,y");
  check("expand: missing argument is reported, not thrown", expandMacros("\\norm", defs).skipped[0]?.reason ?? "", "used without all 1 arguments");
  check(
    "withDefinitions prepends exactly the needed definitions",
    withDefinitions(x.equations[0], defs),
    "\\newcommand{\\norm}[1]{\\left\\| #1 \\right\\|}\n\n" + x.equations[0].source,
  );
  check("renderable: align -> aligned, numbering commands dropped", renderable({ env: "align", envArg: null }, "a&=b\\label{x}\\nonumber\\\\c&=d\\tag{1}"), "\\begin{aligned}a&=b\\\\c&=d\\end{aligned}");

  // search
  check("search by label", searchEquations(x.equations, "eq:loss")[0]?.eq.index + "", "0");
  check("search by number forms", ["(3)", "eq. 1", "Eq 4b", "(5)"].map((q) => searchEquations(x.equations, q)[0]?.eq.index).join(","), "1,0,3,6");
  check("search by LaTeX text and prose", searchEquations(x.equations, "\\hat\\theta")[0]?.eq.index + " " + searchEquations(x.equations, "minimise")[0]?.eq.index, "5 0");
  check("search with no match returns nothing", searchEquations(x.equations, "zzzz").length + "", "0");

  // payloads
  const tgz = await gzip(tar([["main.tex", MAIN], ["sec/method.tex", METHOD], ["fig.png", "\x89PNG"]]));
  const prep = await prepareSource([{ path: "2301.12345", data: tgz }]);
  check("payload: .tar.gz unpacks to text files, binaries counted", "files" in prep ? prep.files.map((f) => f.path).join(",") + " +" + prep.binaryCount : prep.error, "main.tex,sec/method.tex +1");
  const single = await prepareSource([{ path: "2301.12345", data: await gzip(bytesOf(MAIN)) }]);
  check("payload: single gzipped .tex gets a .tex name", "files" in single ? single.files[0].path : single.error, "2301.12345.tex");
  const pdf = await prepareSource([{ path: "2301.12345", data: await gzip(bytesOf("%PDF-1.5 ...")) }]);
  check("payload: PDF-only submission is a clear error", "error" in pdf && /PDF only/.test(pdf.error) ? "y" : "n", "y");
  const none = await prepareSource([{ path: "x", data: new Uint8Array() }]);
  check("payload: empty is an error, not a throw", "error" in none ? none.error : "", "The source package is empty.");
  const noTex = extractEquations([{ path: "readme.txt", text: "hello" }]);
  check("extract: no .tex is an error, not a throw", noTex.error ?? "", "No .tex files to read.");

  finish("arxiv");
}
void main();
