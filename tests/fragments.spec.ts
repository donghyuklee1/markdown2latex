import { check, finish } from "./harness";
import { cleanMath, DEFAULT_OPTIONS } from "../src/lib/cleaner";
import { EXAMPLES } from "../src/lib/defaultText";

const c = (s: string) => cleanMath(s, DEFAULT_OPTIONS);

/* --- fires ------------------------------------------------------------------ */
check(
  "an LLM-fragmented formula becomes one span",
  c(String.raw`$\hat{y}$ = \arg\max_{y} \; P(y) $\prod_{i=1}^{d}$ P(x_i \mid y)`),
  String.raw`$\hat{y} = \arg\max_{y} \; P(y) \prod_{i=1}^{d} P(x_i \mid y)$`,
);
check("two spans joined by an operator merge", c("$x$ = $y$"), "$x = y$");
check("a formula's left-hand side outside the dollars is pulled in", c(String.raw`We have L = $\sum_i \ell_i$ over the batch.`), String.raw`We have $L = \sum_i \ell_i$ over the batch.`);
check("letters glued to a script are maths, prose after it is not", c("$E$ = mc^2 holds"), "$E = mc^2$ holds");
check("trailing punctuation stays outside", c("so $a$ + b."), "so $a + b$.");

/* --- must not fire ------------------------------------------------------------ */
check("spans joined by a word stay apart", c("$x$ and $y$ are reals"), "$x$ and $y$ are reals");
check("prose after a span is untouched", c("where $x$ is large"), "where $x$ is large");
check("a comma list is not a formula", c("Let $a$, $b$ be given"), "Let $a$, $b$ be given");
check("a text command in between blocks a merge", c(String.raw`see $f$ \cite{k} and $g$`), String.raw`see $f$ \cite{k} and $g$`);
check("Hangul in between is prose", c("여기서 $\\mu$ 는 평균, $\\sigma$ 는"), "여기서 $\\mu$ 는 평균, $\\sigma$ 는");
check("a hyphenated word after a span is untouched", c("the $n$-dimensional space"), "the $n$-dimensional space");
check("an operator alone is never absorbed", c("$E$ = energy"), "$E$ = energy");
check("spans on different lines never merge", c("$a$ +\n$b$"), "$a$ +\n$b$");
check("merging is idempotent", c(c("$x$ = $y$ + z")), c("$x$ = $y$ + z"));
check("bundled examples are unchanged by the rule", EXAMPLES.map((e) => String(c(e.text) === c(c(e.text)))).join(","), EXAMPLES.map(() => "true").join(","));
finish("fragments");
