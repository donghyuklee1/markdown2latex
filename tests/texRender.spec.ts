import { readFileSync } from "node:fs";
import katex from "katex";
import { check, finish } from "./harness";
import { documentParts } from "../src/lib/texDocument";
import { refText, renderPaper, type Block } from "../src/lib/texRender";
import { KATEX_OPTIONS } from "../src/lib/katexOptions";

const full = readFileSync("tests/fixtures-paper.tex", "utf8");
const parts = documentParts(full)!;
const paper = renderPaper(full.slice(parts.bodyStart, parts.bodyEnd), full);
const all: Block[] = [];
const walk = (bs: Block[]) => bs.forEach((b) => (all.push(b), "body" in b && Array.isArray(b.body) && walk(b.body), b.t === "list" && b.items.forEach((it) => walk(it.body))));
walk(paper.blocks);

check("title block from the preamble's \\title / \\author", all[0].t === "title" ? (all[0] as Extract<Block, { t: "title" }>).authors.length + " authors" : "none", "2 authors");
check("sections are numbered, subsections nested", paper.toc.map((t) => t.num + " " + t.text).join(" | "), "1 Notation | 2 Forward model | 2.1 Pupil phase");
const maths = all.filter((b): b is Extract<Block, { t: "math" }> => b.t === "math");
check("equation numbering: equation, then align rows; \\nonumber skipped", maths.map((m) => m.tags.join(",")).join(" | "), "1 | 2,3");
check("numbers reach KaTeX as \\tag and every block renders", maths.every((m) => {
  try {
    return katex.renderToString(m.latex, { ...KATEX_OPTIONS, displayMode: true }).includes("tag");
  } catch {
    return false;
  }
}) ? "ok" : "broken", "ok");
check(
  "references resolve LaTeX-style, unknown ones print ??",
  ["eq:phi", "eq:a", "lem:b", "tab:sym", "fig:psf", "sec:not", "eq:none"].map((k) => refText(paper, k, "auto").text).join(" | "),
  "Eq. (1) | Eq. (2) | Lemma 2.1 | Table 1 | Figure 1 | Section 1 | ??",
);
check("\\eqref prints parentheses", refText(paper, "eq:phi", "paren").text, "(1)");
const table = all.find((b): b is Extract<Block, { t: "table" }> => b.t === "table")!;
check("table: numbered caption, column spec read through @{} and >{} / p{}", table.num + " " + table.cols.join(""), "1 llc");
check("table: booktabs rules land on the right rows", table.rows.map((r) => r.rule ?? "-").join(","), "top,mid,-,bottom");
const thm = all.find((b): b is Extract<Block, { t: "theorem" }> => b.t === "theorem")!;
check("theorems use the document's \\newtheorem, numbered within section", thm.label + " " + thm.num + " italic=" + thm.italic, "Lemma 2.1 italic=true");
check("proofs, figures, lists and the abstract are recognised", ["proof", "figure", "list", "abstract"].map((t) => all.some((b) => b.t === t)).join(","), "true,true,true,true");
check("citations are numbered, footnotes collected", JSON.stringify(paper.cites) + " " + paper.footnotes.length, '{"goodman2005":1} 1');
const firstP = all.find((b): b is Extract<Block, { t: "p" }> => b.t === "p" && b.v.some((r) => r.t === "math"))!;
check("inline maths keeps the spaces around it", firstP.v.slice(0, 3).map((r) => (r.t === "text" ? JSON.stringify(r.v) : r.t)).join(" "), '"Vectors are bold; " math " is a coordinate, see Table "');
check("comments never reach the page", JSON.stringify(paper.blocks).includes("a comment") ? "leaked" : "stripped", "stripped");
check("nothing throws on garbage", String(renderPaper("\\begin{table \\section{ $$ \\end{x}").blocks.length >= 0), "true");
finish("texRender");
