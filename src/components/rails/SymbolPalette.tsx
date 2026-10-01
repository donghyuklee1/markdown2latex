"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { InlineMath } from "../Katex";

/**
 * Click-to-insert LaTeX. `@` in a template marks where the current selection
 * goes, so selecting `x` and clicking the hat gives `\hat{x}`; with nothing
 * selected the caret lands there instead.
 */
interface Sym {
  /** What is inserted. */
  tex: string;
  /** What is rendered on the button (defaults to tex with @ -> x). */
  show?: string;
  /** Extra search words. */
  words?: string;
}

const g = (names: string): Sym[] => names.split(" ").map((n) => ({ tex: "\\" + n + " ", show: "\\" + n, words: n }));

const GROUPS: ReadonlyArray<{ id: string; label: string; items: Sym[] }> = [
  { id: "greek", label: "Greek", items: g("alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Phi Psi Omega") },
  {
    id: "ops",
    label: "Operators",
    items: [
      ...g("pm mp times div cdot ast circ bullet oplus otimes cup cap setminus wedge vee nabla partial infty"),
      { tex: "\\sum_{@}^{} ", show: "\\sum_{i}^{n}", words: "sum sigma" },
      { tex: "\\prod_{@}^{} ", show: "\\prod_{i}^{n}", words: "product" },
      { tex: "\\int_{@}^{} ", show: "\\int_{a}^{b}", words: "integral" },
      { tex: "\\oint ", show: "\\oint", words: "contour integral" },
      { tex: "\\lim_{@ \\to } ", show: "\\lim_{x \\to 0}", words: "limit" },
      { tex: "\\max_{@} ", show: "\\max_{x}", words: "maximum" },
      { tex: "\\arg\\min_{@} ", show: "\\arg\\min_{\\theta}", words: "argmin" },
      { tex: "\\mathbb{E}\\left[@\\right]", show: "\\mathbb{E}[x]", words: "expectation" },
    ],
  },
  { id: "rel", label: "Relations", items: g("leq geq neq approx equiv sim simeq cong propto ll gg in notin subset subseteq supset perp parallel mid models vdash") },
  { id: "arrows", label: "Arrows", items: g("to gets leftrightarrow Rightarrow Leftarrow Leftrightarrow mapsto implies iff uparrow downarrow longrightarrow hookrightarrow rightharpoonup") },
  {
    id: "struct",
    label: "Structures",
    items: [
      { tex: "\\frac{@}{}", show: "\\frac{a}{b}", words: "fraction" },
      { tex: "\\sqrt{@}", show: "\\sqrt{x}", words: "root square" },
      { tex: "\\sqrt[n]{@}", show: "\\sqrt[n]{x}", words: "nth root" },
      { tex: "^{@}", show: "x^{n}", words: "superscript power" },
      { tex: "_{@}", show: "x_{i}", words: "subscript index" },
      { tex: "\\binom{@}{}", show: "\\binom{n}{k}", words: "binomial choose" },
      { tex: "\\left( @ \\right)", show: "\\left( x \\right)", words: "parentheses brackets" },
      { tex: "\\left\\| @ \\right\\|", show: "\\| x \\|", words: "norm" },
      { tex: "\\lvert @ \\rvert", show: "| x |", words: "absolute value" },
      { tex: "\\langle @ \\rangle", show: "\\langle x \\rangle", words: "inner product angle" },
      { tex: "\\begin{bmatrix}\n  @ & \\\\\n   & \n\\end{bmatrix}", show: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}", words: "matrix" },
      { tex: "\\begin{cases}\n  @ & \\text{if } \\\\\n   & \\text{otherwise}\n\\end{cases}", show: "\\begin{cases} a \\\\ b \\end{cases}", words: "cases piecewise" },
      { tex: "\\text{@}", show: "\\text{abc}", words: "text words" },
      { tex: "\\underbrace{@}_{}", show: "\\underbrace{x}_{n}", words: "underbrace" },
      { tex: "\\overset{}{@}", show: "\\overset{!}{=}", words: "overset" },
    ],
  },
  {
    id: "accents",
    label: "Accents",
    items: [
      { tex: "\\hat{@}", show: "\\hat{x}", words: "hat estimate" },
      { tex: "\\bar{@}", show: "\\bar{x}", words: "bar mean" },
      { tex: "\\tilde{@}", show: "\\tilde{x}", words: "tilde" },
      { tex: "\\vec{@}", show: "\\vec{v}", words: "vector arrow" },
      { tex: "\\dot{@}", show: "\\dot{x}", words: "dot derivative" },
      { tex: "\\ddot{@}", show: "\\ddot{x}", words: "second derivative" },
      { tex: "\\overline{@}", show: "\\overline{AB}", words: "overline" },
      { tex: "\\mathbf{@}", show: "\\mathbf{W}", words: "bold vector matrix" },
      { tex: "\\boldsymbol{@}", show: "\\boldsymbol{\\mu}", words: "bold symbol" },
      { tex: "\\mathcal{@}", show: "\\mathcal{L}", words: "calligraphic loss" },
      { tex: "\\mathbb{@}", show: "\\mathbb{R}", words: "blackboard reals" },
      { tex: "\\operatorname{@}", show: "\\operatorname{softmax}", words: "operator name" },
    ],
  },
  { id: "sets", label: "Sets & logic", items: [...g("forall exists nexists emptyset neg land lor top bot therefore because"), { tex: "\\mathbb{R}", show: "\\mathbb{R}", words: "reals" }, { tex: "\\mathbb{N}", show: "\\mathbb{N}", words: "naturals" }, { tex: "\\mathbb{Z}", show: "\\mathbb{Z}", words: "integers" }, { tex: "\\mathbb{C}", show: "\\mathbb{C}", words: "complex" }] },
];

export default function SymbolPalette({ onInsert }: { onInsert: (template: string) => void }) {
  const [group, setGroup] = useState(GROUPS[0].id);
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\\/, "");
    if (!q) return GROUPS.find((x) => x.id === group)?.items ?? [];
    return GROUPS.flatMap((x) => x.items).filter((s) => (s.words ?? "").toLowerCase().includes(q) || s.tex.toLowerCase().includes(q));
  }, [group, query]);

  return (
    <div className="space-y-2.5 p-3">
      <label className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5">
        <Search size={13} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search: alpha, integral, norm..."
          aria-label="Search symbols"
          className="h-8 w-full bg-transparent text-xs text-text outline-none placeholder:text-faint"
        />
      </label>

      {!query && (
        <div className="flex flex-wrap gap-1">
          {GROUPS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setGroup(x.id)}
              className={
                "press press-soft rounded-md px-2 py-1 text-[11px] font-semibold " +
                (x.id === group ? "bg-accent/10 text-accent" : "text-faint hover:bg-surface-2 hover:text-muted")
              }
            >
              {x.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1">
        {shown.map((s) => (
          <button
            key={s.tex}
            type="button"
            title={s.tex.replace("@", "\u2026").trim() + "  - select text first to wrap it"}
            // Keep focus (and the selection) in the editor while clicking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onInsert(s.tex)}
            className="press flex h-11 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg px-1 text-[13px] text-text hover:border-accent/50 hover:bg-accent/[0.06]"
          >
            <InlineMath math={s.show ?? s.tex} renderError={() => <span className="font-mono text-[10px]">{s.tex}</span>} />
          </button>
        ))}
      </div>
      {!shown.length && <p className="py-4 text-center text-xs text-faint">No symbol matches “{query}”.</p>}
      <p className="text-[11px] leading-snug text-faint">Inserted at the cursor. Select text first to wrap it, e.g. select x then click the hat.</p>
    </div>
  );
}
