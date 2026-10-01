import { check, finish } from "../harness";
import { flattenProject, maskTex, stripComments, type ProjectFile } from "../../src/lib/lab/flatten";

const doc = (body: string, pre = "") => "\\documentclass{article}\n" + pre + "\\begin{document}\n" + body + "\n\\end{document}\n";
const f = (path: string, text: string): ProjectFile => ({ path, text });

// main file detection
check(
  "main: prefers main.tex over another standalone .tex",
  String(flattenProject([f("appendix.tex", doc("A")), f("main.tex", doc("M")), f("sec.tex", "x")]).mainPath),
  "main.tex",
);
check("main: explicit override wins", String(flattenProject([f("main.tex", doc("M")), f("alt.tex", doc("B"))], { main: "alt.tex" }).mainPath), "alt.tex");
check("main: \\documentclass inside a comment does not count", String(flattenProject([f("a.tex", "% \\documentclass{article}\n\\begin{document}")]).mainPath), "null");

// inlining
{
  const r = flattenProject([
    f("main.tex", doc("\\input{sections/intro}\n\\input sections/method.tex\nEnd.")),
    f("sections/intro.tex", "Intro \\input{sections/deep}\n"),
    f("sections/deep.tex", "Deep."),
    f("sections/method.tex", "Method."),
  ]);
  check("braced, unbraced and nested \\input are inlined relative to the root", r.output, doc("Intro Deep.\nMethod.\nEnd."));
  check("inlined lists every file in order", r.inlined.join(","), "main.tex,sections/intro.tex,sections/deep.tex,sections/method.tex");
}
check(
  "\\include is wrapped in \\clearpage",
  flattenProject([f("main.tex", doc("\\include{ch1}")), f("ch1.tex", "One.")]).output,
  doc("\\clearpage\nOne.\n\\clearpage"),
);
check(
  "\\includegraphics / \\includeonly are not \\include",
  String(flattenProject([f("main.tex", doc("\\includeonly{x}\\includegraphics{x}")), f("x.tex", "BAD")]).output.includes("BAD")),
  "false",
);
check(
  "\\subfile inlines only the child's document body",
  flattenProject([f("main.tex", doc("\\subfile{s/a}")), f("s/a.tex", "\\documentclass[../main]{subfiles}\n\\begin{document}\nBody A.\n\\end{document}\n")]).output,
  doc("Body A."),
);
check(
  "\\import resolves the file and its own \\input relative to dir; \\subimport nests",
  flattenProject([
    f("paper/main.tex", doc("\\import{chap/}{c1}")),
    f("paper/chap/c1.tex", "C1 \\input{part} \\subimport{sub/}{x}"),
    f("paper/chap/part.tex", "P"),
    f("paper/chap/sub/x.tex", "X"),
  ]).output,
  doc("C1 P X"),
);
check("../ and ./ are normalised", flattenProject([f("main.tex", doc("\\input{./a/../b}")), f("b.tex", "B")]).output, doc("B"));

// where inlining must not happen
{
  const src = doc("% \\input{gone}\n\\begin{verbatim}\n\\input{gone}\n\\end{verbatim}\n\\begin{comment}\\input{gone}\\end{comment}\n\\verb|\\input{gone}|");
  const r = flattenProject([f("main.tex", src), f("gone.tex", "INLINED")]);
  check("commented, verbatim, comment-env and \\verb \\input are left alone", r.output, src);
}
check(
  "macro-argument \\input{#1} is skipped silently",
  flattenProject([f("main.tex", doc("x", "\\newcommand{\\inc}[1]{\\input{#1}}\n"))]).warnings.length + "",
  "0",
);

// cycles and missing files
{
  const r = flattenProject([f("main.tex", doc("\\input{a}")), f("a.tex", "A\n\\input{b}"), f("b.tex", "B \\input{a}")]);
  check("cycle: command kept with marker", String(r.output.includes("B \\input{a} % tex-flatten: include cycle, not expanded")), "true");
  check("cycle: warning names file, line and chain", r.warnings.map((w) => w.file + ":" + w.line + " " + w.message).join("|"), "b.tex:1 Include cycle: main.tex -> a.tex -> b.tex -> a.tex");
}
{
  const r = flattenProject([f("main.tex", doc("\\input{nope} after"))]);
  check("missing: kept, marked, rest of line moved below", r.output, doc("\\input{nope} % tex-flatten: file not found\n after"));
  check("missing: warning carries the line", r.warnings[0].file + ":" + r.warnings[0].line, "main.tex:3");
}

// bibliography
{
  const files = [f("main.tex", doc("Text.\n\\bibliographystyle{plain}\n\\bibliography{refs}")), f("main.bbl", "\\begin{thebibliography}{1}\n\\bibitem{a} A.\n\\end{thebibliography}\n")];
  const r = flattenProject(files);
  check("bbl: \\bibliography replaced, \\bibliographystyle line dropped", r.output, doc("Text.\n\\begin{thebibliography}{1}\n\\bibitem{a} A.\n\\end{thebibliography}"));
  check("bbl: reported as inlined", r.bblInlined + " " + r.bblPath, "true main.bbl");
  const off = flattenProject(files, { inlineBbl: false });
  check("bbl: option off keeps \\bibliography and ships the .bbl", off.output.includes("\\bibliography{refs}") + " " + off.bblInlined + " " + off.bblPath, "true false main.bbl");
}
{
  const r = flattenProject([f("main.tex", doc("\\bibliography{refs}"))]);
  check("no bbl: kept with a warning", r.output.includes("\\bibliography{refs}") + " " + /No \.bbl/.test(r.warnings[0]?.message ?? ""), "true true");
}
{
  const r = flattenProject([f("main.tex", doc("\\printbibliography", "\\usepackage{biblatex}\n\\addbibresource{refs.bib}\n")), f("main.bbl", "x")]);
  check("biblatex: warns, does not paste the .bbl, keeps it to ship", r.output.includes("\\printbibliography") + " " + r.bblInlined + " " + r.bblPath + " " + r.warnings.length, "true false main.bbl 1");
}

// assets
{
  const r = flattenProject(
    [f("main.tex", doc("\\includegraphics[width=\\linewidth]{plot}\n\\includegraphics{other.png}\n\\includegraphics{missing}", "\\usepackage{graphicx}\n\\graphicspath{{figs/}}\n"))],
    { otherPaths: ["figs/plot.pdf", "other.png"] },
  );
  check("assets resolved via \\graphicspath and extension search", r.assets.map((a) => a.reference + "=" + a.resolvedPath).join(" "), "plot=figs/plot.pdf other.png=other.png missing=null");
}

// comment stripping
check("strip: trailing comment becomes %, whole-line comment removed", stripComments("a % note\n% whole line\nb\n"), "a %\nb\n");
check("strip: \\% and \\url{%} are not comments", stripComments("50\\% done \\url{http://x.org/a%20b} % c\n"), "50\\% done \\url{http://x.org/a%20b} %\n");
check("strip: \\\\% is a line break followed by a comment", stripComments("a\\\\% c\n"), "a\\\\%\n");
check(
  "strip: verbatim keeps its % and blank lines; comment env removed",
  stripComments("\\begin{verbatim}\n% kept\n\n\n\n\nx\n\\end{verbatim}\n\\begin{comment}\ngone\n\\end{comment}\ny\n"),
  "\\begin{verbatim}\n% kept\n\n\n\n\nx\n\\end{verbatim}\ny\n",
);
check("strip: 3+ blank lines collapse to one", stripComments("a\n\n\n\n\nb"), "a\n\nb");
check("strip: two blank lines are left alone", stripComments("a\n\n\nb"), "a\n\n\nb");
check("strip: tool markers survive", stripComments("\\input{x} % tex-flatten: file not found\n"), "\\input{x} % tex-flatten: file not found\n");
check("mask keeps length", String(maskTex("a % b\n\\verb|%|").masked.length), String("a % b\n\\verb|%|".length));

finish("flatten");
