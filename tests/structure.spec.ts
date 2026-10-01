import katex from "katex";
import { check, finish } from "./harness";
import { cleanMath, DEFAULT_OPTIONS, prepareForKatex, segment, type ConfigOptions } from "../src/lib/cleaner";
import { KATEX_OPTIONS } from "../src/lib/katexOptions";
import { balanceBrackets, correctEnvName, fixEnvTypos, fixGrids, katexCompat, sanitizeChars, unwrapNestedDisplay } from "../src/lib/structure";

const opts = (o: Partial<ConfigOptions> = {}) => ({ ...DEFAULT_OPTIONS, ...o });
const c = (s: string, o: Partial<ConfigOptions> = {}) => cleanMath(s, opts(o));
const renders = (out: string) =>
  segment(out)
    .filter((x) => x.type !== "text")
    .every((x) => {
      try {
        katex.renderToString(prepareForKatex(x.value), { ...KATEX_OPTIONS, displayMode: x.type === "display" });
        return true;
      } catch {
        return false;
      }
    });

/* --- A. bracket-balancer ---------------------------------------------------- */
check("A: missing closing brace is appended", balanceBrackets("\\frac{a+b}{c"), "\\frac{a+b}{c}");
check("A: stray closing brace is dropped", balanceBrackets("x} + 1"), "x + 1");
check("A: unpaired \\left gets \\right.", balanceBrackets("\\left( \\frac{a}{b} "), "\\left( \\frac{a}{b} \\right. ");
check("A: unpaired \\right gets \\left.", balanceBrackets("a \\right)"), "\\left. a \\right)");
check("A: \\left/\\right are balanced per alignment row", balanceBrackets("\\left( a \\\\ b \\right)"), "\\left( a \\right. \\\\ \\left. b \\right)");
check("A: braces inside an environment are closed inside it", balanceBrackets("\\begin{aligned} x &= \\frac{1}{2 \\end{aligned}"), "\\begin{aligned} x &= \\frac{1}{2} \\end{aligned}");
check("A (must not): balanced input is untouched", balanceBrackets("\\left\\{ \\begin{array}{c} a \\\\ b \\end{array} \\right. + \\{x\\}"), "\\left\\{ \\begin{array}{c} a \\\\ b \\end{array} \\right. + \\{x\\}");
check("A (must not): \\leftarrow is not a \\left", balanceBrackets("a \\leftarrow b"), "a \\leftarrow b");

/* --- B. matrix-grid-fixer ---------------------------------------------------- */
check("B: array spec widened to the widest row", fixGrids("\\begin{array}{cc} a & b & c \\\\ d & e \\end{array}"), "\\begin{array}{ccc} a & b & c \\\\ d & e \\end{array}");
check("B: extra & in a cases row is folded", fixGrids("\\begin{cases} a & b & c \\\\ d & e \\end{cases}"), "\\begin{cases} a & b \\quad  c \\\\ d & e \\end{cases}");
check("B (must not): a matching spec is untouched", fixGrids("\\begin{array}{c|c} a & b \\end{array}"), "\\begin{array}{c|c} a & b \\end{array}");
check("B (must not): p{width} columns count", fixGrids("\\begin{array}{p{2cm}c} a & b \\end{array}"), "\\begin{array}{p{2cm}c} a & b \\end{array}");
check("B (must not): escaped \\& is not a cell", fixGrids("\\begin{cases} a \\& b & c \\end{cases}"), "\\begin{cases} a \\& b & c \\end{cases}");

/* --- C. character-sanitizer -------------------------------------------------- */
check("C: bare % becomes \\%", sanitizeChars("50% + x", { percent: true }), "50\\% + x");
check("C: snake_case names become text", sanitizeChars("model_version + 1", { percent: true }), "\\text{model\\_version} + 1");
check("C (must not): an escaped \\% stays single", sanitizeChars("50\\%", { percent: true }), "50\\%");
check("C (must not): % in a .tex document is a comment", sanitizeChars("a % note", { percent: false }), "a % note");
check("C (must not): ordinary subscripts are maths", sanitizeChars("x_i + W_{out} + d_model + \\max_i + \\mathrm{a_b}", { percent: true }), "x_i + W_{out} + d_model + \\max_i + \\mathrm{a_b}");

/* --- D. env-repair ----------------------------------------------------------- */
check("D: equation wrapped around align is unwrapped", unwrapNestedDisplay("\\begin{equation}\\begin{align} a &= b \\end{align}\\end{equation}"), "\\begin{align} a &= b \\end{align}");
check("D (must not): equation around aligned is valid and kept", unwrapNestedDisplay("\\begin{equation}\\begin{aligned} a &= b \\end{aligned}\\end{equation}"), "\\begin{equation}\\begin{aligned} a &= b \\end{aligned}\\end{equation}");
check("D: misspelled environment names are corrected", [correctEnvName("pmatirx"), correctEnvName("equaton*"), correctEnvName("casse")].join(","), "pmatrix,equation*,cases");
check("D (must not): an ambiguous typo alone is not guessed", String(correctEnvName("aligne")), "null");
check("D: an \\end typo follows its \\begin", fixEnvTypos("\\begin{align} a \\end{aligne}"), "\\begin{align} a \\end{align}");
check("D (must not): known, declared and far-off names are never renamed", [correctEnvName("itemize"), correctEnvName("lemma"), correctEnvName("algn", new Set(["algn"])), correctEnvName("xyz")].map(String).join(","), "null,null,null,null");
check("D: a typo in \\end no longer breaks the block", c("$$\n\\begin{align}\na = b \\\\\nc = d\n\\end{aligne}\n$$"), "\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}");

/* --- E. katex-compat --------------------------------------------------------- */
check("E: \\bm becomes \\boldsymbol", katexCompat("\\bm{x} + \\bm\\alpha"), "\\boldsymbol{x} + \\boldsymbol{\\alpha}");
check("E: layout commands are stripped", katexCompat("a \\vspace{2mm} = \\noindent b"), "a = b");
check("E (must not): \\hspace and \\bmod are kept", katexCompat("a \\hspace{1em} b \\bmod c"), "a \\hspace{1em} b \\bmod c");

/* --- end to end -------------------------------------------------------------- */
const messy = [
  "$\\frac{a+b}{c$",
  "$$\\left( \\frac{a}{b} $$",
  "$$\\begin{pmatrix} a & b & c \\\\ d & e \\end{pmatrix}$$",
  "$$\\begin{array}{cc} 1 & 2 & 3 \\end{array}$$",
  "$ 50% of model_version $",
  "$$\\begin{equation}\\begin{align} a &= b \\end{align}\\end{equation}$$",
  "$\\bm{x} \\vspace{1em} = 0$",
];
check("every repaired example renders in KaTeX", messy.filter((m) => !renders(c(m))).join(" | ") || "all render", "all render");
check("structural repair is idempotent", messy.filter((m) => c(c(m)) !== c(m)).join(" | ") || "stable", "stable");
check("switching it off leaves structure alone", c("$\\frac{a}{b$", { repairStructure: false }), "$\\frac{a}{b$");
finish("structure");
