/**
 * Spec conformance check for the cleanup engine.
 *   npm run test:cleaner
 */
import { cleanMath, cleanMathDetailed, DEFAULT_OPTIONS, type ConfigOptions } from "../src/lib/cleaner";
import { DEFAULT_TEXT } from "../src/lib/defaultText";

let failures = 0;

function check(name: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log("  pass  " + name);
    return;
  }
  failures++;
  console.log("  FAIL  " + name);
  console.log("    expected:\n" + expected.split("\n").map((l) => "      | " + l).join("\n"));
  console.log("    actual:\n" + actual.split("\n").map((l) => "      | " + l).join("\n"));
}

function opts(over: Partial<ConfigOptions> = {}): ConfigOptions {
  return { ...DEFAULT_OPTIONS, ...over };
}

/* --- the spec's headline test case --------------------------------------- */

const SPEC_EXPECTED = [
  "Here is the equation for the loss function:",
  "$$",
  "L(\\theta) = \\frac{1}{N} \\sum_{i=1}^{N} (y_i - f(x_i))^2",
  "$$",
  "Also, for alignment:",
  "\\begin{align*}",
  "a &= b + c \\\\",
  "d &= e + f \\text{ (some raw text here)}",
  "\\end{align*}",
  "And inline math like $E = mc^2$.",
].join("\n");

check("spec example, standard mode", cleanMath(DEFAULT_TEXT, opts()), SPEC_EXPECTED);

/* --- delimiter normalization -------------------------------------------- */

check(
  "inline \\( \\) -> $ $",
  cleanMath("see \\( x^2 + 1 \\) here", opts()),
  "see $x^2 + 1$ here",
);

check(
  "display \\[ \\] -> $$ in standard mode",
  cleanMath("\\[ x = 1 \\]", opts()),
  "$$\nx = 1\n$$",
);

check(
  "display -> equation* in academic mode",
  cleanMath("$$ x = 1 $$", opts({ delimiterMode: "academic" })),
  "\\begin{equation*}\nx = 1\n\\end{equation*}",
);

check(
  "display -> inline in inline-only mode",
  cleanMath("\\[\nx = 1\n\\]", opts({ delimiterMode: "inline" })),
  "$x = 1$",
);

check(
  "multi-row display becomes align* in academic mode",
  cleanMath("$$\nx = 1 \\\\\ny = 2\n$$", opts({ delimiterMode: "academic" })),
  "\\begin{align*}\nx &= 1 \\\\\ny &= 2\n\\end{align*}",
);

/* --- nested delimiter stripping ----------------------------------------- */

check(
  "outer $$ stripped from a wrapped align",
  cleanMath("$$\n\\begin{align}\nx &= 1\n\\end{align}\n$$", opts()),
  "\\begin{align*}\nx &= 1\n\\end{align*}",
);

check(
  "outer \\[ \\] stripped from a wrapped equation",
  cleanMath("\\[\n\\begin{equation}\nx = 1\n\\end{equation}\n\\]", opts()),
  "\\begin{equation*}\nx = 1\n\\end{equation*}",
);

check(
  "bare align block is starred and repaired",
  cleanMath("\\begin{align}\nx = 1\ny = 2\n\\end{align}", opts()),
  "\\begin{align*}\nx &= 1 \\\\\ny &= 2\n\\end{align*}",
);

/* --- row repair ---------------------------------------------------------- */

check(
  "matrix rows get row breaks but no & anchor",
  cleanMath("$$\n\\begin{pmatrix}\na & b\nc & d\n\\end{pmatrix}\n$$", opts()),
  "\\begin{pmatrix}\na & b \\\\\nc & d\n\\end{pmatrix}",
);

check(
  "existing row breaks are not duplicated",
  cleanMath("\\begin{align}\nx &= 1 \\\\\ny &= 2\n\\end{align}", opts()),
  "\\begin{align*}\nx &= 1 \\\\\ny &= 2\n\\end{align*}",
);

check(
  "row repair off leaves the body alone",
  cleanMath("\\begin{align}\nx = 1\ny = 2\n\\end{align}", opts({ fixLineBreaks: false })),
  "\\begin{align*}\nx = 1\ny = 2\n\\end{align*}",
);

check(
  "relations other than = are left unanchored",
  cleanMath("\\begin{align}\nx \\le 1 \\\\\ny \\ge 2\n\\end{align}", opts()),
  "\\begin{align*}\nx \\le 1 \\\\\ny \\ge 2\n\\end{align*}",
);

/* --- \text{} auto-escaping ---------------------------------------------- */

check(
  "algebra in parentheses is never wrapped",
  cleanMath("$$ (y_i - f(x_i))^2 + (a + b) $$", opts()),
  "$$\n(y_i - f(x_i))^2 + (a + b)\n$$",
);

check(
  "single-token parens stay as maths",
  cleanMath("$ f(n) + g(x) $", opts()),
  "$f(n) + g(x)$",
);

check(
  "already-wrapped text is not double wrapped",
  cleanMath("$ x \\text{ (some raw text here)} $", opts()),
  "$x \\text{ (some raw text here)}$",
);

check(
  "auto-text off leaves prose untouched",
  cleanMath("$$ d = e + f (some raw text here) $$", opts({ autoText: false })),
  "$$\nd = e + f (some raw text here)\n$$",
);

check(
  "Hangul inside math is wrapped",
  cleanMath("$ x = 1 (\uAD50\uCC28 \uC5D4\uD2B8\uB85C\uD53C) $", opts()),
  "$x = 1 \\text{ (\uAD50\uCC28 \uC5D4\uD2B8\uB85C\uD53C)}$",
);

check(
  "prose outside math keeps its parentheses",
  cleanMath("plain (some raw text here) prose", opts()),
  "plain (some raw text here) prose",
);

/* --- unicode hygiene ----------------------------------------------------- */

check(
  "zero-width spaces are removed",
  cleanMath("$x\u200b = 1$", opts()),
  "$x = 1$",
);

check(
  "unicode math glyphs become commands",
  cleanMath("$\u03b1 \u2264 \u03b2 \u00d7 \u03b3$", opts()),
  "$\\alpha \\leq \\beta \\times \\gamma$",
);

check(
  "non-breaking space becomes a plain space",
  cleanMath("$a\u00a0+\u00a0b$", opts()),
  "$a + b$",
);

/* --- safety net ---------------------------------------------------------- */

{
  const r = cleanMathDetailed("line one\n\nvar is $$\nx = 1\n\nnot closed", opts());
  check(
    "unclosed $$ is reported, not crashed on",
    String(r.issues.length) + " @ line " + (r.issues[0]?.line ?? "-"),
    "1 @ line 3",
  );
  check("unclosed $$ passes its text through", r.output.includes("x = 1") ? "kept" : "lost", "kept");
}

{
  const r = cleanMathDetailed("a $ b\n\nc $ d", opts());
  check(
    "a stray $ does not swallow the document",
    String(r.issues.length) + "/" + r.output,
    "2/a $ b\n\nc $ d",
  );
}

{
  const r = cleanMathDetailed("\\begin{align}\nx = 1", opts());
  check(
    "unterminated environment is reported",
    r.issues[0]?.message ?? "none",
    "\\begin{align} has no matching \\end{align}.",
  );
}

/* --- passthrough --------------------------------------------------------- */

check(
  "fenced code blocks are left verbatim",
  cleanMath("```\n$$ \\[ not math \\] $$\n```", opts()),
  "```\n$$ \\[ not math \\] $$\n```",
);

check(
  "escaped dollars are not delimiters",
  cleanMath("costs \\$5 and \\$9", opts()),
  "costs \\$5 and \\$9",
);

check("empty input is empty output", cleanMath("", opts()), "");

check(
  "idempotent: cleaning clean output is a no-op",
  cleanMath(cleanMath(DEFAULT_TEXT, opts()), opts()),
  SPEC_EXPECTED,
);

/* ------------------------------------------------------------------------- */


/* --- live preview: every cleaned segment must actually parse in KaTeX ------ */

import katex from "katex";
import { prepareForKatex, segment } from "../src/lib/cleaner";
import { EXAMPLES } from "../src/lib/defaultText";
import { KATEX_OPTIONS } from "../src/lib/katexOptions";
import type { DelimiterMode } from "../src/lib/cleaner";

const MODES: DelimiterMode[] = ["standard", "academic", "inline"];
const previewFailures: string[] = [];

for (const example of EXAMPLES) {
  for (const mode of MODES) {
    const cleaned = cleanMath(example.text, opts({ delimiterMode: mode }));
    for (const seg of segment(cleaned)) {
      if (seg.type === "text") continue;
      try {
        // Same options the preview uses, so a pass here means a pass in the app.
        katex.renderToString(prepareForKatex(seg.value), {
          ...KATEX_OPTIONS,
          displayMode: seg.type === "display",
        });
      } catch (err) {
        previewFailures.push(
          example.id + " [" + mode + "] " + (err as Error).message.split("\n")[0],
        );
      }
    }
  }
}

check(
  "every example renders in KaTeX across all 3 modes",
  previewFailures.length ? previewFailures.join("\n") : "none",
  "none",
);

/* ------------------------------------------------------------------------- */

console.log("");
if (failures) {
  console.log(failures + " check(s) failed");
  process.exit(1);
}
console.log("all checks passed");
