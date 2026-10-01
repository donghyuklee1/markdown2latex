import { check, finish } from "../harness";
import { detectLayout, documentFontPt, mathWidthEm, resizeOverflow, textWidthEm } from "../../src/lib/lab/resizer";

const near = (x: number, y: number) => String(Math.abs(x - y) < 1e-9);
const doc = (body: string, cls = "\\documentclass[conference]{IEEEtran}\n") => cls + "\\begin{document}\n" + body + "\n\\end{document}\n";
const COL = { columnWidthPt: 241, textWidthPt: 506 };

const WIDE_EQ = String.raw`\begin{equation}
  \mathcal{L}(\theta) = \mathbb{E}_{x \sim p_{\text{data}}}\left[ \log D(x) \right] + \mathbb{E}_{z \sim p_z}\left[\log\left(1 - D(G(z))\right)\right] + \lambda \sum_{i=1}^{N} \| \nabla_\theta f_\theta(x_i) \|_2^2
  \label{eq:loss}
\end{equation}`;
const SHORT_EQ = String.raw`\begin{equation}
  E = mc^2 \label{eq:short}
\end{equation}`;
const WIDE_TABLE = String.raw`\begin{table}[t]
  \centering
  \begin{tabular}{lcccccc}
    \toprule
    Method & Accuracy (\%) & Precision & Recall & F1 score & Params (M) & Latency (ms) \\
    \midrule
    Transformer baseline & 91.2 & 90.1 & 89.7 & 89.9 & 110.0 & 23.4 \\
    \bottomrule
  \end{tabular}
\end{table}`;

// the model
check("model: one glyph is 0.5em", near(mathWidthEm("x"), 0.5), "true");
check("model: a+b = 0.5 + 0.9 + 0.5", near(mathWidthEm("a+b"), 1.9), "true");
check("model: display \\frac = max(num, den) + 0.2", near(mathWidthEm("\\frac{abc}{d}"), 1.7), "true");
check("model: \\tfrac parts at script size (0.7)", near(mathWidthEm("\\tfrac{abc}{d}"), 1.05 + 0.2), "true");
check("model: x_i^2 takes the wider script, not both", near(mathWidthEm("x_i^2"), 0.5 + 0.35), "true");
check("model: \\sum limits stack (no width added when narrower)", near(mathWidthEm("\\sum_{i}"), 1.4 + 0.17), "true");
check("model: matrix = widest cells + 1em separation + delimiters", near(mathWidthEm("\\begin{bmatrix} a & bb \\\\ ccc & d \\end{bmatrix}"), 1.5 + 1 + 1 + 0.9), "true");
check("model: text cell, 0.5em glyphs and 0.33em spaces", near(textWidthEm("ab cd"), 2.33), "true");
check("model: $..$ in a cell counted as maths", near(textWidthEm("$a+b$"), 1.9), "true");
check("font size from \\documentclass[11pt]", String(documentFontPt("\\documentclass[a4paper,11pt]{article}")), "11");
check("layout detect: IEEEtran is two-column, article one-column", detectLayout("\\documentclass{IEEEtran}") + " " + detectLayout("\\documentclass[11pt]{article}"), "two10 one11");

// detection and fixes
{
  const r = resizeOverflow(doc(WIDE_EQ + "\n" + SHORT_EQ + "\n" + WIDE_TABLE), { ...COL, strategy: "resizebox" });
  check("report: kinds and lines", r.blocks.map((b) => b.kind + "@" + b.line).join(" "), "equation@3 equation@7 tabular@12");
  check("report: wide equation overflows, short one fits", r.blocks.map((b) => (b.ratio > 1 ? "over" : "fits")).join(" "), "over fits over");
  check(
    "resizebox: equation content boxed, \\label kept outside",
    String(r.output.includes("\\begin{equation}\n  \\resizebox{0.92\\columnwidth}{!}{$\\displaystyle \\mathcal{L}(\\theta) =") && r.output.includes("\\|_2^2$}\n  \\label{eq:loss}\n\\end{equation}")),
    "true",
  );
  check("resizebox: fitting equation untouched", String(r.output.includes(SHORT_EQ)), "true");
  check("resizebox: tabular wrapped", String(r.output.includes("  \\resizebox{\\columnwidth}{!}{%\n  \\begin{tabular}{lcccccc}") && r.output.includes("\\end{tabular}%\n  }")), "true");
  check("resizebox: graphicx added after \\documentclass", r.output.split("\n")[1], "\\usepackage{graphicx} % for \\resizebox (added by auto-resizer)");
  const again = resizeOverflow(r.output, { ...COL, strategy: "resizebox" });
  check("idempotent: second run changes nothing", String(again.output === r.output), "true");
  check("idempotent: blocks reported as already scaled", again.blocks.map((b) => b.action).join(", "), "already scaled, fits, already scaled");
}
{
  const r = resizeOverflow(doc("\\usepackage{graphicx}", "\\documentclass{IEEEtran}\n") + "", { ...COL });
  check("no blocks: output identical", String(r.output === doc("\\usepackage{graphicx}", "\\documentclass{IEEEtran}\n")), "true");
}
check(
  "graphicx not duplicated when already loaded",
  String(resizeOverflow("\\documentclass{IEEEtran}\n\\usepackage{graphicx}\n\\begin{document}\n" + WIDE_TABLE + "\n\\end{document}\n", COL).output.match(/usepackage\{graphicx\}/g)?.length),
  "1",
);
{
  const align = String.raw`\begin{align*}
  f(x) &= \sum_{i=1}^{N} \alpha_i \exp\left(-\frac{\|x - x_i\|^2}{2\sigma^2}\right) + \sum_{j=1}^{M} \beta_j \exp\left(-\frac{\|x - y_j\|^2}{2\tau^2}\right) + \gamma \\
  &= g(x)
\end{align*}`;
  const r = resizeOverflow(doc(align), { ...COL, strategy: "resizebox" });
  check("align*: widest row measured, converted to \\[ \\resizebox{aligned} \\]", String(r.output.includes("\\[\n  \\resizebox{\\columnwidth}{!}{$\\displaystyle \\begin{aligned}\n    f(x) &=") && r.output.includes("\\end{aligned}$}\n\\]")), "true");
}
{
  const numbered = String.raw`\begin{align}
  a &= \sum_{i=1}^{N} \alpha_i \exp\left(-\frac{\|x - x_i\|^2}{2\sigma^2}\right) + \sum_{j=1}^{M} \beta_j \exp\left(-\frac{\|x - y_j\|^2}{2\tau^2}\right) + \gamma \sum_{k=1}^{K} \delta_k \label{a} \\
  b &= c \label{b}
\end{align}`;
  const r = resizeOverflow(doc(numbered), { ...COL, strategy: "resizebox" });
  check("align with two numbered lines falls back to a font size (keeps both numbers)", String(/^\{\\(small|footnotesize|scriptsize)\n\\begin\{align\}/m.test(r.output) && r.output.includes("\\label{a}") && r.output.includes("\\label{b}")), "true");
}
{
  const matrix = String.raw`\[
  A = \begin{bmatrix} a_{11} & a_{12} & a_{13} & a_{14} & a_{15} & a_{16} & a_{17} & a_{18} & a_{19} & a_{1,10} & a_{1,11} & a_{1,12} \\ 0 & 0 & 0 & 0 & 0 & 0 & 0 & 0 & 0 & 0 & 0 & 0 \end{bmatrix}
\]`;
  const r = resizeOverflow(doc(matrix), { ...COL, strategy: "auto" });
  check("wide matrix in \\[ \\] detected", r.blocks[0].kind + " " + String(r.blocks[0].ratio > 1.15), "display true");
  check("auto: big overflow -> resizebox (unnumbered: full \\columnwidth)", String(r.output.includes("\\[\n  \\resizebox{\\columnwidth}{!}{$\\displaystyle A = \\begin{bmatrix}")), "true");
}
{
  // ~10% too wide: auto picks a font size instead of scaling.
  const t = "\\begin{table}\n\\begin{tabular}{ll}\n" + "x".repeat(40) + " & " + "y".repeat(8) + " \\\\\n\\end{tabular}\n\\end{table}";
  const r = resizeOverflow(doc(t), { ...COL, strategy: "auto" });
  check("auto: small overflow (<=15%) -> \\small/\\footnotesize line inside the float", r.blocks[0].action + " " + String(/\\begin\{table\}\n\\(small|footnotesize)\n\\begin\{tabular\}/.test(r.output)), r.blocks[0].action + " true");
  check("auto: ratio was within 15%", String(r.blocks[0].ratio > 1 && r.blocks[0].ratio <= 1.15), "true");
  const again = resizeOverflow(r.output, { ...COL, strategy: "auto" });
  check("fontsize fix is idempotent", String(again.output === r.output) + " " + again.blocks[0].action, "true fits");
}
{
  const r = resizeOverflow(doc(WIDE_TABLE.replace(/table\}/g, "table*}")), { ...COL, strategy: "resizebox" });
  check("table*: measured against \\textwidth (fits)", r.blocks[0].columnWidthPt + " " + r.blocks[0].action, "506 fits");
}
{
  const skipped = doc("% \\begin{equation} " + "x+".repeat(200) + " \\end{equation}\n\\begin{verbatim}\n\\begin{equation}" + "x+".repeat(200) + "\\end{equation}\n\\end{verbatim}");
  check("comments and verbatim are not scanned", String(resizeOverflow(skipped, COL).blocks.length), "0");
  const pre = "\\documentclass{article}\n\\newcommand{\\foo}{\\begin{tabular}{l}" + "x".repeat(200) + "\\end{tabular}}\n\\begin{document}\nx\n\\end{document}\n";
  check("preamble is not scanned", String(resizeOverflow(pre, COL).blocks.length), "0");
}
{
  const wrapped = doc("\\resizebox{\\columnwidth}{!}{%\n\\begin{tabular}{l}\n" + "x".repeat(200) + "\n\\end{tabular}}\n\\begin{adjustbox}{max width=\\columnwidth}\n\\begin{tabular}{l}\n" + "y".repeat(200) + "\n\\end{tabular}\n\\end{adjustbox}");
  const r = resizeOverflow(wrapped, COL);
  check("blocks inside \\resizebox / adjustbox are never re-wrapped", String(r.output === wrapped) + " " + r.blocks.map((b) => b.action).join(","), "true already scaled,already scaled");
}
check("a wider column (345pt) lowers the overflow ratio", String(resizeOverflow(doc(WIDE_TABLE), { columnWidthPt: 345 }).blocks[0].ratio < resizeOverflow(doc(WIDE_TABLE), COL).blocks[0].ratio), "true");

finish("resizer");
