import { check, finish } from "./harness";
import { repairLatex, suggestCommand } from "../src/lib/repair";
import { EXAMPLES } from "../src/lib/defaultText";

const out = (s: string) => repairLatex(s).output;

/* --- fires ------------------------------------------------------------------ */
check("missing closing brace is added", out("$$\\frac{1}{2$$"), "$$\\frac{1}{2}$$");
check("stray closing brace is removed", out("$x}+1$"), "$x+1$");
check("command typos are corrected", out("$\\alpah + \\fracc{1}{2}$"), "$\\alpha + \\frac{1}{2}$");
check("unknown word commands become operator names", out("$\\softmax(z)$"), "$\\operatorname{softmax}(z)$");
check("double superscript is separated", out("$x^2^3$"), "$x^2{}^3$");
check("unpaired \\left gets \\right.", out("$$\\left( x + 1 $$"), "$$\\left( x + 1 \\right.$$");
check("mismatched \\end is renamed", out("$$\\begin{align} a &= b \\end{aligned}$$"), "$$\\begin{align} a &= b \\end{align}$$");
check("unclosed environment is closed", out("$$\\begin{cases} a & b$$"), "$$\\begin{cases} a & b\n\\end{cases}$$");
check("bare & rows get an aligned wrapper", out("$$a &= b \\\\ c &= d$$"), "$$\\begin{aligned}\na &= b \\\\ c &= d\n\\end{aligned}$$");
check("misspelled environment is corrected", out("$\\begin{matirx} a \\end{matirx}$"), "$\\begin{matrix} a \\end{matrix}$");
check("unclosed $$ is closed at the end of its paragraph", out("Here:\n$$\nx = 1\n\nNext"), "Here:\n$$\nx = 1\n$$\n\nNext");
check("a lone $ before a number is escaped as a price", out("costs $5 today"), "costs \\$5 today");
check("maths written in prose is wrapped", out("where \\alpha is and \\frac{1}{2} of it"), "where $\\alpha$ is and $\\frac{1}{2}$ of it");

/* --- must not fire ----------------------------------------------------------- */
check("valid input is untouched", out("$a + b$ and $$\\sum_i x_i$$"), "$a + b$ and $$\\sum_i x_i$$");
check("code spans are never 'fixed'", out("`\\alpha` and $\\theta$"), "`\\alpha` and $\\theta$");
check("escaped braces do not count", out("$\\{x\\}$"), "$\\{x\\}$");
check("a single-letter unknown command is not guessed at", suggestCommand("q") === null ? "null" : "guessed", "null");
check("every bundled example needs no repair", EXAMPLES.filter((e) => e.id !== "broken").map((e) => repairLatex(e.text).fixes.length).join(","), "0,0,0,0");

{
  const r = repairLatex("$$\\begin{nonsenseenv} x \\end{nonsenseenv}$$");
  check("what cannot be fixed safely is reported, not guessed", r.fixes.length + " fixes, " + r.unresolved.length + " unresolved", "0 fixes, 1 unresolved");
}
{
  const r = repairLatex("This answer got truncated.\n\n$$\nx = 1\n\nand \\( b = 2");
  check("the truncated example is fully repaired", String(r.unresolved.length) + " / " + repairLatex(r.output).fixes.length, "0 / 0");
}
finish("repair");
