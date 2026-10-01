import katex from "katex";
import { check, finish } from "./harness";
import { cleanMath, cleanMathDetailed, DEFAULT_OPTIONS } from "../src/lib/cleaner";
import { diagnose } from "../src/lib/diagnostics";
import { repairLatex } from "../src/lib/repair";
import { documentParts, katexMacros, parseInline, parseProse } from "../src/lib/texDocument";
import { fileBase, titleFromFileName } from "../src/lib/documents";

const DOC = [
  "\\documentclass[10pt]{article}",
  "\\usepackage{amsmath}",
  "% \\newcommand{\\ignored}{x}",
  "\\DeclareMathOperator{\\sign}{sign}",
  "\\DeclareMathOperator*{\\argmin}{arg\\,min}",
  "\\newcommand{\\R}{$\\mathbb{R}$}",
  "\\newcommand{\\vr}[1]{\\mathbf{#1}}",
  "\\newcommand{\\norm}[2][2]{\\|#2\\|_{#1}}",
  "\\def\\E{\\mathbb{E}}",
  "\\begin{document}",
  "\\section{Method}",
  "We set $\\vr{x} \\in \\R^n$ and \\textbf{minimise}",
  "\\[ \\argmin_{\\vr{w}} \\norm{\\vr{w}} + \\sign(x) + \\E[x] \\]",
  "\\end{document}",
].join("\n");

const m = katexMacros(DOC);
check("parts: body located after \\begin{document}", String(DOC.slice(documentParts(DOC)!.bodyStart).trimStart().startsWith("\\section")), "true");
check("macros: plain, $-wrapped, operator, starred operator, \\def", [m["\\R"], m["\\sign"], m["\\argmin"], m["\\E"]].join(" | "), "\\mathbb{R} | \\operatorname{sign} | \\operatorname*{arg\\,min} | \\mathbb{E}");
check("macros: arguments, and an optional default filled in", m["\\vr"] + " | " + m["\\norm"], "\\mathbf{#1} | \\|#1\\|_{2}");
check("macros: commented-out definitions are ignored", String("\\ignored" in m), "false");
check("macros: a non-document has none", JSON.stringify(katexMacros("$x$ and \\newcommand{\\a}{b}")), "{}");

const r = cleanMathDetailed(DOC, DEFAULT_OPTIONS);
check("the preamble passes through the cleaner byte for byte", String(r.output.startsWith(DOC.slice(0, DOC.indexOf("\\begin{document}")).trim())), "true");
check("only body maths is cleaned (preamble $..$ not counted)", String(r.blocks), "2");
check("with document macros every block renders - no false errors", String(diagnose(r.mathBlocks, m).length) + " vs " + String(diagnose(r.mathBlocks).length > 0), "0 vs true");
check("Check & Fix leaves defined macros alone", String(repairLatex(DOC, m).fixes.length), "0");
check("KaTeX renders a user macro with arguments", String(katex.renderToString("\\vr{x}", { macros: { ...m } }).includes("mathbf")), "true");
check("non-documents clean exactly as before", cleanMath("$a+b$"), "$a + b$");

const inline = parseInline("A \\textbf{bold} and \\emph{it} cite~\\cite{a,b} see \\eqref{eq:1}\\footnote{note}");
check("prose inline: bold, italic, cite, eqref, footnote", inline.map((x) => x.t).join(","), "text,b,text,i,text,cite,text,ref,note");
const blocks = parseProse("% comment\n\\section{Intro}\n\\begin{lemma}[Key]\nText\n\\end{lemma}\n\\begin{itemize}\n\\item one\n\\end{itemize}");
check("prose blocks: comment dropped, heading, theorem edges, list item", blocks.map((b) => b.t + (b.t === "env" ? ":" + b.edge : "")).join(","), "p,h,env:begin,p,env:end,li");
const named = (title: string) => fileBase({ id: "x", title, text: "", updatedAt: 0 });
check("file names: unnamed docs save as clean-math", named(""), "clean-math");
check("file names: unsafe characters and spaces are replaced", named("My Paper: v2/final"), "My-Paper-v2-final");
check("file names: a typed extension is not doubled", named("results.tex") + " | " + titleFromFileName(" draft.md "), "results | draft");
finish("texDocument");
