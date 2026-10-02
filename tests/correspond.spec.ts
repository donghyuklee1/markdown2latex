import { check, finish } from "./harness";
import { buildCorrespondence, linesOf, mapRange } from "../src/lib/correspond";
import { cleanMathDetailed, DEFAULT_OPTIONS } from "../src/lib/cleaner";

const input = "Here is the loss:\n\\[\nL(\\theta) = \\frac{1}{N} \\sum_i (y_i - f(x_i))^2\n\\]\nAlso, for alignment:\n$$\n\\begin{align}\na = b + c \\\\\nd = e + f\n\\end{align}\n$$\nAnd inline \\( E = mc^2 \\).";
const { output, mathBlocks } = cleanMathDetailed(input, DEFAULT_OPTIONS);
const c = buildCorrespondence(input, output, mathBlocks);
const sel = (text: string, needle: string) => {
  const i = text.indexOf(needle);
  return { start: i, end: i + needle.length };
};
const show = (m: ReturnType<typeof mapRange>, text: string) => (m ? (m.exact ? "exact:" : "block:") + text.slice(m.start, m.end) : "none");

check("maths inside a block maps to the same maths in the output", show(mapRange(c, "input", sel(input, "\\frac{1}{N}"), input, output), output), "exact:\\frac{1}{N}");
check("prose maps to the same prose", show(mapRange(c, "input", sel(input, "for alignment"), input, output), output), "exact:for alignment");
check("output back to input", show(mapRange(c, "output", sel(output, "E = mc^2"), output, input), input), "exact:E = mc^2");
const changed = mapRange(c, "input", sel(input, "a = b + c"), input, output);
check("text the cleaner rewrote maps to its block", String(changed && output.slice(changed.start, changed.end).includes("\\begin{align")), "true");
check("whitespace differences are tolerated", show(mapRange(c, "input", sel(input, "(y_i - f(x_i))^2"), input, output), output), "exact:(y_i - f(x_i))^2");
check("a whole delimiter line maps to the whole block", String(mapRange(c, "input", sel(input, "\\["), input, output)?.exact), "false");
check("line span of a range", linesOf("a\nbb\nccc", { start: 2, end: 7 }).join("-"), "2-3");
check("blocks and gaps alternate and cover both texts", String(c.pairs[0].input.start === 0 && c.pairs[c.pairs.length - 1].output.end === output.length), "true");
finish("correspond");
