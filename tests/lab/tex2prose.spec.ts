import { check, finish } from "../harness";
import { parseSession, prompt, protect, restore, serializeSession, stripComments, type ProtectOptions } from "../../src/lib/lab/tex2prose";

const plain: ProtectOptions = { floats: true, stripComments: false, strict: false };
const strict: ProtectOptions = { ...plain, strict: true };

const PAPER = [
  "We minimise $\\mathcal{L}(\\theta)$ following \\citep[see][p.~3]{smith2020,doe21}; cf.\\ Eq.~\\eqref{eq:loss}.\\footnote{Code: \\url{https://x.org}, with $k=3$.} % TODO: cut",
  "\\begin{equation}\\label{eq:loss}",
  "  \\mathcal{L} = \\sum_i \\ell_i",
  "\\end{equation}",
  "It costs \\$5 and 50\\% of runs, ``quoted'' text, $x$ and $x$ again. \\textbf{Key} idea, see \\href{https://a.b}{our site} and \\Cref{fig:a}.",
  "\\begin{figure*}[t]\\centering $y$ \\caption{A}\\label{fig:a}\\end{figure*}",
  "\\[ E = mc^2 \\] and \\( a \\) and $$ b $$.",
].join("\n");

/* --------------------------------------------------------------- protect */

const p = protect(PAPER, plain);
check(
  "protect: math, cites, refs, footnote, url, href, float -> numbered placeholders",
  p.prose,
  [
    "We minimise [MATH_1] following [CITE_1]; cf.\\ Eq.~[REF_1].[FN_1]Code: [URL_1], with [MATH_2].[/FN_1] % TODO: cut",
    "[MATH_3]",
    "It costs \\$5 and 50\\% of runs, ``quoted'' text, [MATH_4] and [MATH_5] again. \\textbf{Key} idea, see [URL_2]our site[/URL_2] and [REF_2].",
    "[FIGURE_1]",
    "[MATH_6] and [MATH_7] and [MATH_8].",
  ].join("\n"),
);
check("protect: identical $x$ twice gets two distinct indices", [p.session.entries.MATH_4, p.session.entries.MATH_5].join(" "), "$x$ $x$");
check("protect: citation keeps both optional args in its original", p.session.entries.CITE_1, "\\citep[see][p.~3]{smith2020,doe21}");
check("protect: \\label inside an equation travels with the math, not as LABEL", String(p.stats.counts.LABEL ?? 0), "0");
check(
  "protect: counts per kind",
  JSON.stringify(p.stats.counts),
  JSON.stringify({ FIGURE: 1, MATH: 8, CITE: 1, REF: 2, FN: 1, URL: 2 }),
);
check("protect: tokens saved = removed chars / 4", String(p.stats.tokensSaved), String(Math.round((PAPER.length - p.prose.length) / 4)));

check("not math: \\$5 and 50\\% stay as prose", protect("It costs \\$5 and 50\\% more.", plain).prose, "It costs \\$5 and 50\\% more.");
check("not math: $ inside a % comment does not open math", protect("text % price in $\nnext $x$ line", plain).prose, "text % price in $\nnext [MATH_1] line");
check("not a cite: \\citation{x} is a different command", protect("\\citation{x} and \\cite{y}", plain).prose, "\\citation{x} and [CITE_1]");
check("bare label in prose -> LABEL", protect("\\section{Intro}\\label{sec:intro}", plain).prose, "\\section{Intro}[LABEL_1]");
check("floats off: figure contents are protected piecewise", protect("\\begin{table}$a$\\end{table}", { ...plain, floats: false }).prose, "\\begin{table}[MATH_1]\\end{table}");
check("unterminated figure is not swallowed", protect("\\begin{figure} $a$ and more", plain).prose, "\\begin{figure} [MATH_1] and more");

check(
  "strict: formatting commands become paired tags, other commands CMD",
  protect("\\noindent \\textbf{Key \\emph{idea}} \\vspace{2mm}here.", strict).prose,
  "[CMD_1] [B_1]Key [I_1]idea[/I_1][/B_1] [CMD_2]here.",
);
check("non-strict: \\textbf is left for the model", protect("\\textbf{Key} idea", plain).prose, "\\textbf{Key} idea");

/* -------------------------------------------------------------- comments */

check(
  "stripComments: comment-only lines vanish, trailing comments trimmed, \\% kept",
  stripComments("a 50\\% b % note\n% whole line\nc\\\\% after a linebreak\nd"),
  "a 50\\% b\nc\\\\\nd",
);
check("protect with stripComments drops them before counting", protect("x % hidden $y$\nz", { ...plain, stripComments: true }).prose, "x\nz");

/* ------------------------------------------------------------- collision */

const clash = protect("The literal [MATH_1] stays, $x$ is hidden.", plain);
check("collision: literal [MATH_1] in input forces a prefix", clash.prose, "The literal [MATH_1] stays, [CM_MATH_1] is hidden.");
check("collision: prefix is recorded in the session", clash.session.prefix, "CM_");
check("collision: restore leaves the literal [MATH_1] alone", restore(clash.prose, clash.session).tex, "The literal [MATH_1] stays, $x$ is hidden.");
check("collision is case-insensitive: [math_2] also forces a prefix", protect("[math_2] $a$", plain).session.prefix, "CM_");
check("no collision: ordinary brackets keep the short form", protect("[see above] $a$", plain).session.prefix, "");

/* --------------------------------------------------------------- restore */

for (const [name, opts] of [["plain", plain], ["strict", strict], ["no floats", { ...plain, floats: false }]] as const) {
  const r = protect(PAPER, opts);
  const back = restore(r.prose, r.session);
  check("round-trip byte-for-byte (" + name + ")", back.tex, PAPER);
  check("round-trip report is clean (" + name + ")", [back.missing.length, back.duplicated.length, back.unknown.length, back.repaired].join(","), "0,0,0,0");
}

const small = protect("A $a$ b \\cite{k} c \\footnote{note $z$}.", plain);
check("small sample prose", small.prose, "A [MATH_1] b [CITE_1] c [FN_1]note [MATH_2][/FN_1].");
const mangled = restore("A [ math_1 ] b `[CITE_1]` c \\[FN\\_1\\]Note \uFF3BMATH\uFF3F\uFF12\uFF3D\u3010/FN_1\u3011.", small.session);
check("restore tolerates spacing, case, backticks, markdown escapes, fullwidth", mangled.tex, "A $a$ b \\cite{k} c \\footnote{Note $z$}.");
check("restore counts repaired occurrences", String(mangled.repaired), "5");
check("restore: dropped brackets (bare MATH_1) are recognised", restore("A MATH_1 b [CITE_1] [FN_1][MATH_2][/FN_1]", small.session).tex, "A $a$ b \\cite{k} \\footnote{$z$}");
check("restore: bare lowercase word math_1 is not a token", restore("see math_1 [MATH_1]", small.session).tex, "see math_1 $a$");

const lossy = restore("A [MATH_1] b [MATH_1] [REF_9] and nothing else.", small.session);
check("restore reports missing (and appends nothing)", lossy.missing.join(" "), "[MATH_2] [CITE_1] [FN_1] [/FN_1]");
check("restore reports duplicated", lossy.duplicated.join(" "), "[MATH_1]");
check("restore reports unknown and leaves it in place", lossy.unknown.join(" ") + " | " + lossy.tex, "[REF_9] | A $a$ b $a$ [REF_9] and nothing else.");

/* --------------------------------------------------------------- session */

const json = serializeSession(p.session);
const parsed = parseSession(json);
check("session survives serialize -> parse", "session" in parsed ? JSON.stringify(parsed.session) : parsed.error, JSON.stringify(p.session));
check("session JSON has a format header", JSON.parse(json).format, "cleanmath-tex2prose-session");
check("parseSession rejects non-JSON", "error" in parseSession("not json") ? "error" : "ok", "error");
check("parseSession rejects JSON without the header", "error" in parseSession('{"entries":{}}') ? "error" : "ok", "error");
check("parseSession rejects a malformed entry id", "error" in parseSession('{"format":"cleanmath-tex2prose-session","version":1,"prefix":"","entries":{"x y":"a"}}') ? "error" : "ok", "error");

/* ---------------------------------------------------------------- prompt */

check("prompt uses the session prefix in its examples", prompt({ prefix: "CM_" }).includes("[CM_MATH_3]") ? "yes" : "no", "yes");
check("prompt mentions paired tags only when asked", [prompt({ paired: true }).includes("[/FN_1]"), prompt().includes("[/FN_1]")].join(","), "true,false");

finish("tex2prose");
