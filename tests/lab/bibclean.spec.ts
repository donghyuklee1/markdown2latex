import { check, finish } from "../harness";
import {
  DEFAULT_BIB_OPTIONS,
  abbreviateVenue,
  cleanBib,
  escapeSpecials,
  fixPages,
  normalizeAuthors,
  parseBib,
  protectCapitals,
  rewriteCites,
  type BibOptions,
} from "../../src/lib/lab/bibclean";

const opts = (o: Partial<BibOptions>): BibOptions => ({ ...DEFAULT_BIB_OPTIONS, ...o });
const field = (out: string, name: string) => (new RegExp("^  " + name + " = \\{(.*)\\},?$", "m").exec(out) ?? [])[1] ?? "(none)";

// --- parser -----------------------------------------------------------------
{
  const src = [
    '@string{jmlr = "Journal of Machine Learning Research"}',
    "@article{a,",
    '  title = "A " # {B {C}} # " D",',
    "  journal = jmlr, month = mar, year = 2020,",
    "  author = {X Y}",
    "}",
  ].join("\n");
  const e = parseBib(src).items.find((i) => i.kind === "entry");
  const f = e && e.kind === "entry" ? Object.fromEntries(e.entry.fields.map((x) => [x.name, x.value])) : {};
  check("parse: # concatenation, nested braces, @string and month macros", [f.title, f.journal, f.month, f.year].join(" | "), "A B {C} D | Journal of Machine Learning Research | March | 2020");
}
{
  const src = "@article{bad,\n  title = {Unclosed,\n@book{ok, title={Fine}, author={A B}, publisher={P}, year={2001}}\n";
  const r = cleanBib(src, opts({ keys: "keep" }));
  check("parse: an unbalanced entry is reported with its line and the next entry survives", r.warnings.filter((w) => /Unbalanced/.test(w.message)).map((w) => w.line + ":" + w.key).join() + " / " + /@book\{ok,/.test(r.output), "2:bad / true");
}
{
  const r = cleanBib("junk text\n@comment{keep me}\n@preamble{\"\\newcommand{\\x}{y}\"}\n% a note\n@misc{m, title={T}}", opts({ keys: "keep" }));
  check("parse: @comment / @preamble / % lines pass through, stray text is a warning", [r.output.includes("@comment{keep me}"), r.output.includes("@preamble{"), r.output.includes("% a note"), r.warnings.some((w) => w.line === 1 && /outside/.test(w.message))].join(), "true,true,true,true");
}
check("parse: undefined macro is reported, never thrown", cleanBib("@misc{m, title = nosuchmacro}").warnings.map((w) => w.message).join(), 'Undefined @string macro "nosuchmacro" - kept as literal text');

// --- authors ----------------------------------------------------------------
check("authors: First Last, Last First, von, Jr, initials", normalizeAuthors("Ashish Vaswani and He, K and Ludwig van Beethoven and Smith, Jr., John R and D.E. Knuth"), "Vaswani, Ashish and He, K. and van Beethoven, Ludwig and Smith, Jr., John R. and Knuth, D. E.");
check("authors: braced corporate names, `and others`, accents untouched", normalizeAuthors("{OpenAI} and J{\\\"u}rgen Schmidhuber and others"), "{OpenAI} and Schmidhuber, J{\\\"u}rgen and others");
check("authors: `and` inside braces does not split", normalizeAuthors("{Barnes and Noble}"), "{Barnes and Noble}");

// --- keys ---------------------------------------------------------------------
const pair = [
  "@inproceedings{Vaswani_2017, author={Ashish Vaswani and Noam Shazeer}, title={Attention Is All You Need}, booktitle={NIPS}, year={2017}}",
  "@article{smith2023, author={M{\\\"u}ller, Jan}, title={On the Theory of Things}, journal={Nature}, year={2023}}",
  "@article{x1, author={M{\\\"u}ller, Jan}, title={On the Theory of Stuff}, journal={Nature}, year={2023}}",
].join("\n");
{
  const r = cleanBib(pair, opts({ keys: "authorYearWord" }));
  check("keys: authorYearWord skips stopwords, ASCII-folds accents, a/b on collision", Object.entries(r.keyMap).map(([a, b]) => a + "->" + b).join(" "), "Vaswani_2017->vaswani2017attention smith2023->muller2023theorya x1->muller2023theoryb");
  check("keys: AuthorYear", Object.values(cleanBib(pair, opts({ keys: "AuthorYear" })).keyMap).join(" "), "Vaswani2017 Muller2023a Muller2023b");
  check("keys: keep leaves keys alone", Object.values(cleanBib(pair, opts({ keys: "keep" })).keyMap).join(" "), "Vaswani_2017 smith2023 x1");
}

// --- venues -------------------------------------------------------------------
check("venues: table hit (abbrev), tolerant of 'Proceedings of', years and acronyms", [abbreviateVenue("IEEE Transactions on Pattern Analysis and Machine Intelligence", "abbrev"), abbreviateVenue("Advances in Neural Information Processing Systems 30 (NIPS 2017)", "abbrev"), abbreviateVenue("Proceedings of the 2016 IEEE Conference on Computer Vision and Pattern Recognition", "full")].join(" | "), "IEEE Trans. Pattern Anal. Mach. Intell. | Adv. Neural Inf. Process. Syst. (NeurIPS) | Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition");
check("venues: abbreviated form expands back in full mode", abbreviateVenue("J. Am. Chem. Soc.", "full"), "Journal of the American Chemical Society");
check("venues: ISO 4 fallback for unknown venues", abbreviateVenue("International Journal of Quantum Chemistry", "abbrev"), "Int. J. Quantum Chem.");
check("venues: no fallback in full mode; single words stay; keep is keep", [abbreviateVenue("Journal of Obscure Things", "full"), abbreviateVenue("Biometrika", "abbrev"), abbreviateVenue("TPAMI", "keep")].join(" | "), "Journal of Obscure Things | Biometrika | TPAMI");

// --- dedupe -------------------------------------------------------------------
{
  const src = [
    "@article{a1, author={He, Kaiming}, title={Deep Residual Learning}, year={2016}, doi={https://doi.org/10.1109/CVPR.2016.90}}",
    "@inproceedings{a2, author={He, Kaiming}, title={Deep residual learning.}, booktitle={CVPR}, pages={770-778}, year={2016}, doi={10.1109/cvpr.2016.90}}",
    "@misc{t1, title={{A} Long Title About Graphs}, author={Z Q}, year={2020}}",
    "@misc{t2, title={A long title about graphs}, note={dup by title}}",
  ].join("\n");
  const r = cleanBib(src, opts({ keys: "keep" }));
  check("dedupe: by normalized DOI and by normalized title, most complete entry wins", r.merged.map((m) => m.from + "->" + m.into).join(" ") + " / " + r.entries + " / " + field(r.output, "pages"), "a1->a2 t2->t1 / 2 / 770--778");
  check("dedupe: merged keys map to the survivor for \\cite rewriting", r.keyMap.a1 + "," + r.keyMap.t2, "a2,t1");
  const diff = "@misc{d1, title={Same Title Same Title}, doi={10.1/a}}\n@misc{d2, title={Same Title Same Title}, doi={10.1/b}}";
  check("dedupe: same title but different DOIs are not merged", String(cleanBib(diff, opts({ keys: "keep" })).entries), "2");
}

// --- escaping -----------------------------------------------------------------
check("escape: bare & % # _ escaped, \\& and $math_x$ untouched", escapeSpecials("R&D 50% #1 a_b \\& $x_i$").value, "R\\&D 50\\% \\#1 a\\_b \\& $x_i$");
check("escape: \\url{} argument untouched", escapeSpecials("see \\url{http://x.org/a_b%20} & more").value, "see \\url{http://x.org/a_b%20} \\& more");
{
  const r = cleanBib("@article{k, title={Q&A}, journal={Science & Technology}, url={http://a.org/?x=1&y_2}, doi={10.1/a_b}, year={2020}}", opts({ keys: "keep" }));
  check("escape: text fields escaped, url and doi fields never", [field(r.output, "journal"), field(r.output, "url"), field(r.output, "doi")].join(" | "), "Science \\& Technology | http://a.org/?x=1&y_2 | 10.1/a_b");
}
check("protect caps: acronyms and CamelCase braced, plain capitals and existing braces not", protectCapitals("BERT and GPT-3: Pre-Training on {ImageNet} With U-Net in $O(N)$").value, "{BERT} and {GPT-3}: Pre-Training on {ImageNet} With {U-Net} in $O(N)$");

// --- pages, validation, output ------------------------------------------------
check("pages: single hyphen and en-dash become --; ranges already fine stay", [fixPages("12-34"), fixPages("12 \u2013 34"), fixPages("e1234"), fixPages("12--34")].join(" "), "12--34 12--34 e1234 12--34");
{
  const r = cleanBib("@article{k, title={T}, year={2020}}\n@misc{m, title={Fine}}", opts({ keys: "keep" }));
  check("validation: missing required fields per type; @misc is relaxed", r.warnings.map((w) => w.key + ":" + w.message).join(" | "), "k:@article is missing author | k:@article is missing journal or journaltitle");
}
{
  const r = cleanBib("@ARTICLE{z, Year={2020}, note={n}, Title={T}, Journal={J}, AUTHOR={A B}}\n@article{a, author={C D}, title={T2}, journal={J}, year={2021}}", opts({ keys: "keep", sort: true }));
  check("output: lowercase names, canonical field order, sorted by key", r.output, "@article{a,\n  author = {D, C.},\n  title = {T2},\n  journal = {J},\n  year = {2021}\n}\n\n@article{z,\n  author = {B, A.},\n  title = {T},\n  journal = {J},\n  year = {2020},\n  note = {n}\n}\n");
  check("output: cleaning is idempotent", cleanBib(r.output, opts({ keys: "keep", sort: true })).output, r.output);
}

// --- \cite rewriting -----------------------------------------------------------
{
  const map = { Vaswani_2017: "vaswani2017attention", he2016: "he2016deep" };
  const r = rewriteCites("\\citep[see][p.~3]{Vaswani_2017, he2016} and \\textcite{he2016} [2] \\cites{he2016}{other} \\nocite{*} \\citestyle{plain}", map);
  check("cites: optional args, comma lists, \\cites groups; text after a cite untouched", r.tex, "\\citep[see][p.~3]{vaswani2017attention, he2016deep} and \\textcite{he2016deep} [2] \\cites{he2016deep}{other} \\nocite{*} \\citestyle{plain}");
  check("cites: unknown keys reported, already-new keys are not", r.replaced + " / " + r.missing.join() + " / " + rewriteCites("\\cite{he2016deep}", map).missing.length, "4 / other / 0");
}

check("cites: merged duplicates cited together collapse to one key", rewriteCites("\\citep{a1, a2,b}", { a1: "he2016deep", a2: "he2016deep", b: "b" }).tex, "\\citep{he2016deep,b}");

finish("bibclean");
