/**
 * derivation.ts - a derivation, as a reader thinks about it.
 *
 * The formula graph treated every symbol as a node and every shared letter as
 * a line, which says little about the argument. This model is about *steps*:
 * definitions and assumptions at the bottom, intermediate results in the
 * middle, final results on top, and for each step only the steps it directly
 * builds on - transitively reduced, so no line repeats what a path already
 * says. Every step carries a one-line summary and a fuller explanation.
 *
 * Two sources fill it in:
 *  - `offlineModel` - deterministic, from the equations' own symbols and the
 *    prose definitions found in the text (no network, always available);
 *  - an LLM (Gemini, via the browser) - `buildPrompt` asks for JSON matching
 *    `RESPONSE_SCHEMA`, and `mergeAi` validates it against the offline model,
 *    so the AI can add meaning but never invent equations or break line maps.
 *
 * Pure: no DOM, no network.
 */
import { buildFormulaGraph, displayLatex } from "./studio/formulaGraph";
import { extractSymbols, DEFAULT_SYMBOL_OPTIONS } from "./lab/symbols";

/* ------------------------------------------------------------------ types */

export type StepKind = "definition" | "assumption" | "intermediate" | "final";

export interface Step {
  id: string;
  kind: StepKind;
  /** Display LaTeX of the equation (empty for a prose-only assumption). */
  latex: string;
  /** Short name: "Scaled dot-product attention", "Eq. 3". */
  title: string;
  /** One line, may contain $...$. Shown at a glance. */
  summary: string;
  /** A few sentences, may contain $...$. Shown on hover. */
  explanation: string;
  /** Ids of the steps this one directly builds on. */
  uses: string[];
  /** 1-indexed input lines. */
  lines: [number, number] | null;
  /** "Eq. 3" when the document numbers it. */
  label: string | null;
}

export interface Variable {
  symbol: string;
  meaning: string;
  units: string;
  domain: string;
  source: "explicit" | "inferred";
  line: number | null;
}

export interface Idea {
  id: string;
  label: string;
  detail: string;
  /** Steps that express this idea. */
  steps: string[];
}

export interface IdeaLink {
  from: string;
  to: string;
  label: string;
}

export interface Derivation {
  title: string;
  steps: Step[];
  variables: Variable[];
  ideas: Idea[];
  ideaLinks: IdeaLink[];
  source: "offline" | "ai";
}

/* ---------------------------------------------------- graph utilities */

/** Drop A -> C whenever C is reachable from A through another path. */
export function reduceEdges(steps: ReadonlyArray<Step>): Step[] {
  const uses = new Map(steps.map((s) => [s.id, new Set(s.uses)]));
  const reach = (from: string, target: string, skip: string): boolean => {
    const seen = new Set<string>();
    const stack = [...(uses.get(from) ?? [])].filter((u) => u !== skip);
    while (stack.length) {
      const n = stack.pop()!;
      if (n === target) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of uses.get(n) ?? []) stack.push(m);
    }
    return false;
  };
  return steps.map((s) => ({ ...s, uses: s.uses.filter((u) => !reach(s.id, u, u)) }));
}

/** Break cycles (keep the earlier-in-document direction). */
function acyclic(steps: Step[]): Step[] {
  const order = new Map(steps.map((s, i) => [s.id, i]));
  return steps.map((s) => ({ ...s, uses: s.uses.filter((u) => order.has(u) && order.get(u)! < order.get(s.id)!) }));
}

export interface TreeNode {
  step: Step;
  /** Already shown earlier in the tree: drawn as a reference, not expanded. */
  ref: boolean;
  children: TreeNode[];
}

/**
 * Top-down: one tree per final result, children are what it builds on. A
 * step reached twice is expanded the first time and shown as a reference
 * after that - the tree never repeats a sub-derivation.
 */
export function topDown(d: Derivation, maxDepth = 8): TreeNode[] {
  const byId = new Map(d.steps.map((s) => [s.id, s]));
  const roots = d.steps.filter((s) => s.kind === "final");
  const used = new Set(d.steps.flatMap((s) => s.uses));
  const tops = roots.length ? roots : d.steps.filter((s) => !used.has(s.id));
  const shown = new Set<string>();
  const build = (s: Step, depth: number): TreeNode => {
    if (shown.has(s.id)) return { step: s, ref: true, children: [] };
    shown.add(s.id);
    return {
      step: s,
      ref: false,
      children: depth >= maxDepth ? [] : s.uses.map((u) => byId.get(u)).filter((x): x is Step => !!x).map((c) => build(c, depth + 1)),
    };
  };
  return tops.map((t) => build(t, 0));
}

/**
 * Bottom-up: layers by longest path from the foundations, so every edge goes
 * upward; within a layer, order by the mean position of what it uses
 * (fewer crossings), ties by document order.
 */
export function bottomUp(d: Derivation): Step[][] {
  const byId = new Map(d.steps.map((s) => [s.id, s]));
  const level = new Map<string, number>();
  const lvl = (s: Step, guard = 0): number => {
    if (level.has(s.id)) return level.get(s.id)!;
    const l = guard > 64 ? 0 : s.uses.length ? 1 + Math.max(...s.uses.map((u) => (byId.get(u) ? lvl(byId.get(u)!, guard + 1) : 0))) : 0;
    level.set(s.id, l);
    return l;
  };
  d.steps.forEach((s) => lvl(s));
  const layers: Step[][] = [];
  for (const s of d.steps) (layers[level.get(s.id)!] ??= []).push(s);
  const pos = new Map<string, number>();
  return layers.map((layer) => {
    const sorted = layer
      .map((s, i) => ({ s, i, bary: s.uses.length ? s.uses.reduce((a, u) => a + (pos.get(u) ?? 0), 0) / s.uses.length : i }))
      .sort((a, b) => a.bary - b.bary || a.i - b.i)
      .map((x) => x.s);
    sorted.forEach((s, i) => pos.set(s.id, i));
    return sorted;
  });
}

/* ------------------------------------------------------------- offline */

const plural = (n: number, one: string, many: string) => n + " " + (n === 1 ? one : many);

/* Named quantities as a scientist writes them: the subscript is part of the
 * name (V_{BR}, E_{crit}, N_a), except a bare loop index (x_i, h_{t+1}). */
const NOT_SYMBOLS = new Set(
  ("frac dfrac tfrac sqrt sum prod int oint lim left right big Big bigg Bigg approx implies iff to cdot times div pm mp le leq ge geq ne neq " +
    "equiv sim propto in notin subset subseteq cup cap infty partial nabla quad qquad text textrm mathrm operatorname label tag nonumber " +
    "begin end exp log ln sin cos tan max min arg det sup inf mid vert lvert rvert lVert rVert langle rangle ldots cdots dots displaystyle " +
    "underbrace overbrace hspace mathbb mathcal mathbf boldsymbol bm hat bar tilde vec dot ddot top prime coloneqq triangleq forall exists").split(" "),
);
const INDEX = /^(?:[ijklmnt]|[ijklmnt]\s*[+-]\s*\d+|\d+|[ijklmnt],\s*[ijklmnt])$/;
const SYMBOL = /\\(?:mathbf|boldsymbol|bm|mathcal|mathbb|hat|bar|tilde|vec|dot|ddot)\s*\{([^{}]+)\}|\\([A-Za-z]+)|([A-Za-z])/g;

/** Distinct named quantities in a formula, subscripts kept (except loop indices). */
export function namesIn(latex: string): string[] {
  const src = latex.replace(/\\(?:text|textrm|mathrm|operatorname|label|tag)\s*\{[^{}]*\}/g, " ");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  SYMBOL.lastIndex = 0;
  while ((m = SYMBOL.exec(src))) {
    let name = m[0];
    if (m[2] && NOT_SYMBOLS.has(m[2])) {
      // \\sum_i, \\max_{x}: the operator's limits are not quantities either
      const lim = /^(\s*[_^]\s*(\{[^{}]*\}|[A-Za-z0-9]))+/.exec(src.slice(SYMBOL.lastIndex));
      if (lim) SYMBOL.lastIndex += lim[0].length;
      continue;
    }
    // a letter right after a backslash-less letter run like "dx" in an integral is fine to keep
    const sub = /^\s*_\s*(\{([^{}]*)\}|([A-Za-z0-9]))/.exec(src.slice(SYMBOL.lastIndex));
    if (sub) {
      const inner = (sub[2] ?? sub[3]).trim();
      SYMBOL.lastIndex += sub[0].length;
      if (!INDEX.test(inner)) name += "_{" + inner + "}";
    }
    name = name.replace(/\s+/g, "");
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

const RELATION = /(?<![<>!:])(?:=|\\approx|\\equiv|\\coloneqq|\\triangleq|:=|\\propto|\\simeq)/;

/** Left side of the first relation defines, everything else is used. */
function definesAndUses(latex: string): { defines: string[]; uses: string[] } {
  const first = latex.split(/\\implies|\\Rightarrow|\\\\|\\quad/)[0];
  const m = RELATION.exec(first);
  if (!m) return { defines: [], uses: namesIn(latex) };
  const defines = namesIn(first.slice(0, m.index));
  return { defines, uses: namesIn(latex).filter((n) => !defines.includes(n)) };
}

/** A deterministic model from the text alone. */
export function offlineModel(input: string): Derivation {
  const graph = buildFormulaGraph(input, { includeInline: false });
  const eqs = graph.nodes.filter((n) => n.kind === "equation").sort((a, b) => (a.lines?.[0] ?? 0) - (b.lines?.[0] ?? 0));
  const ids = new Map(eqs.map((e, i) => [e.id, "s" + (i + 1)]));
  const latexOf = new Map(graph.nodes.map((n) => [n.id, n.latex]));
  const defines = new Map<string, string[]>();
  const usesSym = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind === "defines") (defines.get(e.from) ?? defines.set(e.from, []).get(e.from)!).push(latexOf.get(e.to) ?? e.to);
    if (e.kind === "uses") (usesSym.get(e.to) ?? usesSym.set(e.to, []).get(e.to)!).push(latexOf.get(e.from) ?? e.from);
  }
  const deps = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (e.kind === "feeds" && ids.has(e.from) && ids.has(e.to)) (deps.get(e.to) ?? deps.set(e.to, new Set()).get(e.to)!).add(ids.get(e.from)!);
  }

  let steps: Step[] = eqs.map((e) => {
    const { defines: def, uses: use } = definesAndUses(e.latex);
    return {
      id: ids.get(e.id)!,
      kind: "intermediate",
      latex: displayLatex(e.latex),
      title: e.number ? "Eq. " + e.number : e.key ?? "Line " + (e.lines?.[0] ?? "?"),
      summary: def.length
        ? "Defines $" + def.join("$, $") + "$" + (use.length ? " from " + plural(use.length, "quantity", "quantities") : "") + "."
        : "Relates " + plural(use.length, "quantity", "quantities") + ".",
      explanation: "",
      uses: [...(deps.get(e.id) ?? [])],
      lines: e.lines,
      label: e.number ? "Eq. " + e.number : null,
    };
  });
  steps = reduceEdges(acyclic(steps));
  const usedBy = new Set(steps.flatMap((s) => s.uses));
  steps = steps.map((s) => ({
    ...s,
    kind: !s.uses.length ? "definition" : usedBy.has(s.id) ? "intermediate" : "final",
  }));

  // Variables: every named quantity in the equations, with the prose
  // definition the symbol table found for it (or for its base letter).
  const report = extractSymbols(input, DEFAULT_SYMBOL_OPTIONS);
  const described = new Map(report.symbols.map((v) => [v.latex, v]));
  const names: string[] = [];
  for (const e of eqs) for (const n of namesIn(e.latex)) if (!names.includes(n)) names.push(n);
  const variables: Variable[] = names.map((n) => {
    const base = n.replace(/_\{[^}]*\}$/, "");
    const info = described.get(n) ?? described.get(base);
    return {
      symbol: n,
      meaning: info?.description ?? "",
      units: "",
      domain: "",
      source: "explicit" as const,
      line: info ? info.defLine ?? info.firstLine : null,
    };
  });

  return { title: "", steps, variables, ideas: [], ideaLinks: [], source: "offline" };
}

/* ------------------------------------------------------------------ AI */

/** JSON schema handed to the model (Gemini `responseSchema` / OpenAPI subset). */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["definition", "assumption", "intermediate", "final"] },
          latex: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          explanation: { type: "string" },
          uses: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "title", "summary", "explanation", "uses"],
      },
    },
    variables: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symbol: { type: "string" },
          meaning: { type: "string" },
          units: { type: "string" },
          domain: { type: "string" },
          source: { type: "string", enum: ["explicit", "inferred"] },
        },
        required: ["symbol", "meaning", "source"],
      },
    },
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          detail: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
        },
        required: ["id", "label", "detail"],
      },
    },
    ideaLinks: {
      type: "array",
      items: {
        type: "object",
        properties: { from: { type: "string" }, to: { type: "string" }, label: { type: "string" } },
        required: ["from", "to", "label"],
      },
    },
  },
  required: ["title", "steps", "variables", "ideas", "ideaLinks"],
} as const;

/** The prompt: the document, plus the numbered equations the AI must refer to by id. */
export function buildPrompt(input: string, base: Derivation): string {
  const eqList = base.steps.map((s) => s.id + " (" + (s.label ?? "line " + (s.lines?.[0] ?? "?")) + "): " + s.latex).join("\n");
  const doc = input.length > 60000 ? input.slice(0, 60000) + "\n[... truncated ...]" : input;
  return [
    "You analyse the mathematical derivation in a document for a reader who wants to understand it.",
    "",
    "The document's display equations are listed below with ids. Use exactly these ids for equation steps.",
    "You may add steps of kind \"assumption\" (and \"definition\" for definitions stated only in prose) with new ids a1, a2, ... and latex \"\" or a short formula.",
    "",
    "For every step give:",
    "- kind: definition (introduces a quantity), assumption (a modelling choice or condition), intermediate, or final (a result the document is building towards - there may be several).",
    "- title: 2-6 words naming what the step is (e.g. \"Scaled dot-product attention\").",
    "- summary: one plain sentence a student understands at a glance.",
    "- explanation: 2-4 sentences: what it says, why it holds or why it is needed, and how it is used. Write maths inline as $...$ LaTeX.",
    "- uses: ids of the steps it DIRECTLY builds on. Only direct dependencies - never list a step that is already implied through another listed step. Keep this minimal.",
    "",
    "variables: every symbol used, with its meaning (find it in the text, or infer it from context and mark source \"inferred\"), units if physical or \"\" otherwise, and domain (e.g. $\\mathbb{R}^{n\\times d}$) if known.",
    "ideas: 3-7 key ideas of the derivation (label 2-5 words, detail one sentence, steps = ids that express it); ideaLinks: how ideas lead to each other (label: a short verb phrase).",
    "title: the derivation's subject in under 8 words.",
    "Answer in the language of the document's prose. Output JSON only.",
    "",
    "EQUATIONS:",
    eqList || "(none detected - derive the steps from the text)",
    "",
    "DOCUMENT:",
    doc,
  ].join("\n");
}

const str = (v: unknown, max = 600) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Validate the AI's JSON against the offline model. Equation steps keep their
 * source lines and LaTeX from the document; unknown ids, self-references and
 * cycles are dropped; the dependency lines are reduced again regardless of
 * what the model returned.
 */
export function mergeAi(raw: unknown, base: Derivation): Derivation {
  const r = (raw ?? {}) as Record<string, unknown>;
  const known = new Map(base.steps.map((s) => [s.id, s]));
  const kinds = new Set<StepKind>(["definition", "assumption", "intermediate", "final"]);
  const aiSteps = Array.isArray(r.steps) ? (r.steps as Record<string, unknown>[]) : [];

  const steps: Step[] = [];
  const seen = new Set<string>();
  for (const a of aiSteps) {
    const id = str(a.id, 20);
    if (!id || seen.has(id)) continue;
    const baseStep = known.get(id);
    if (!baseStep && !/^a\d+$/.test(id)) continue; // the AI may only add assumption/definition steps
    seen.add(id);
    const kind = kinds.has(a.kind as StepKind) ? (a.kind as StepKind) : baseStep?.kind ?? "assumption";
    steps.push({
      id,
      kind: baseStep ? kind : kind === "assumption" || kind === "definition" ? kind : "assumption",
      latex: baseStep ? baseStep.latex : str(a.latex, 300),
      title: str(a.title, 80) || baseStep?.title || id,
      summary: str(a.summary, 300) || baseStep?.summary || "",
      explanation: str(a.explanation, 1500),
      uses: Array.isArray(a.uses) ? (a.uses as unknown[]).map((u) => str(u, 20)).filter(Boolean) : [],
      lines: baseStep?.lines ?? null,
      label: baseStep?.label ?? null,
    });
  }
  // Equations the AI skipped are kept with their offline description.
  for (const s of base.steps) if (!seen.has(s.id)) steps.push(s);

  // Order: AI-added foundations first, then document order.
  const order = (s: Step) => (s.lines ? s.lines[0] : -1);
  steps.sort((a, b) => order(a) - order(b));
  const valid = new Set(steps.map((s) => s.id));
  const clean = steps.map((s) => ({ ...s, uses: [...new Set(s.uses)].filter((u) => valid.has(u) && u !== s.id) }));
  const reduced = reduceEdges(acyclic(clean));
  if (!reduced.some((s) => s.kind === "final")) {
    const usedBy = new Set(reduced.flatMap((s) => s.uses));
    for (const s of reduced) if (!usedBy.has(s.id) && s.uses.length) s.kind = "final";
  }

  const variables: Variable[] = (Array.isArray(r.variables) ? (r.variables as Record<string, unknown>[]) : [])
    .map((v) => {
      const symbol = str(v.symbol, 80);
      const known = base.variables.find((b) => b.symbol === symbol);
      return {
        symbol,
        meaning: str(v.meaning, 300),
        units: str(v.units, 60),
        domain: str(v.domain, 120),
        source: (v.source === "explicit" ? "explicit" : "inferred") as Variable["source"],
        line: known?.line ?? null,
      };
    })
    .filter((v) => v.symbol && v.meaning);

  const ideas: Idea[] = (Array.isArray(r.ideas) ? (r.ideas as Record<string, unknown>[]) : [])
    .slice(0, 9)
    .map((i, k) => ({
      id: str(i.id, 20) || "i" + (k + 1),
      label: str(i.label, 60),
      detail: str(i.detail, 400),
      steps: Array.isArray(i.steps) ? (i.steps as unknown[]).map((x) => str(x, 20)).filter((x) => valid.has(x)) : [],
    }))
    .filter((i) => i.label);
  const ideaIds = new Set(ideas.map((i) => i.id));
  const ideaLinks: IdeaLink[] = (Array.isArray(r.ideaLinks) ? (r.ideaLinks as Record<string, unknown>[]) : [])
    .map((l) => ({ from: str(l.from, 20), to: str(l.to, 20), label: str(l.label, 60) }))
    .filter((l) => ideaIds.has(l.from) && ideaIds.has(l.to) && l.from !== l.to);

  return {
    title: str(r.title, 100),
    steps: reduced,
    variables: variables.length ? variables : base.variables,
    ideas,
    ideaLinks,
    source: "ai",
  };
}

/* -------------------------------------------------------- LaTeX output */

const escapeText = (s: string) =>
  s.replace(/\$([^$]*)\$|([&%#_])/g, (m, math: string | undefined, ch: string | undefined) => (math !== undefined ? m : "\\" + ch));

/** A booktabs table of the variables, ready to paste into a paper. */
export function variablesTable(vars: ReadonlyArray<Variable>, caption = "Notation."): string {
  const withUnits = vars.some((v) => v.units);
  const withDomain = vars.some((v) => v.domain);
  const cols = "l" + "p{0.5\\linewidth}" + (withDomain ? "l" : "") + (withUnits ? "l" : "");
  const head = ["Symbol", "Meaning", ...(withDomain ? ["Domain"] : []), ...(withUnits ? ["Units"] : [])].join(" & ");
  const rows = vars.map((v) =>
    [
      "$" + v.symbol + "$",
      escapeText(v.meaning || "\\textit{TODO}"),
      ...(withDomain ? [v.domain ? (v.domain.startsWith("$") ? v.domain : "$" + v.domain + "$") : "--"] : []),
      ...(withUnits ? [v.units ? escapeText(v.units) : "--"] : []),
    ].join(" & ") + " \\\\",
  );
  return [
    "\\begin{table}[t]",
    "  \\centering",
    "  \\caption{" + caption + "}",
    "  \\label{tab:notation}",
    "  \\begin{tabular}{" + cols + "}",
    "    \\toprule",
    "    " + head + " \\\\",
    "    \\midrule",
    ...rows.map((r) => "    " + r),
    "    \\bottomrule",
    "  \\end{tabular}",
    "\\end{table}",
  ].join("\n");
}

/** The idea diagram as a TikZ concept map, laid out on a circle. */
export function ideasTikz(ideas: ReadonlyArray<Idea>, links: ReadonlyArray<IdeaLink>): string {
  const n = Math.max(1, ideas.length);
  const nodes = ideas.map((i, k) => {
    const a = 90 - (360 * k) / n;
    const x = (3.2 * Math.cos((a * Math.PI) / 180)).toFixed(2);
    const y = (2.4 * Math.sin((a * Math.PI) / 180)).toFixed(2);
    return "  \\node[idea] (" + i.id + ") at (" + x + "," + y + ") {" + escapeText(i.label) + "};";
  });
  const edges = links.map((l) => "  \\draw[->] (" + l.from + ") -- node[midway, fill=white, font=\\scriptsize] {" + escapeText(l.label) + "} (" + l.to + ");");
  return [
    "\\begin{tikzpicture}[>=stealth, idea/.style={draw, rounded corners, fill=black!4, align=center, text width=2.6cm, font=\\small}]",
    ...nodes,
    ...edges,
    "\\end{tikzpicture}",
  ].join("\n");
}

/* ------------------------------------------------- Gemini request shape */
/* Shared by the browser client (user's own key) and the site's server route
 * (site key), so both send exactly the same prompt and schema. */

/** Gemini's schema dialect wants upper-case type names. */
export function geminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(geminiSchema);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === "type" && typeof v === "string" ? v.toUpperCase() : geminiSchema(v)]));
  }
  return node;
}

/** The generateContent body for analysing `input`. */
export function geminiRequest(input: string): object {
  return {
    contents: [{ role: "user", parts: [{ text: buildPrompt(input, offlineModel(input)) }] }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: geminiSchema(RESPONSE_SCHEMA) },
  };
}

/** The JSON text of a generateContent answer, or an error message. */
export function geminiAnswer(body: unknown): { text: string } | { error: string } {
  const b = (body ?? {}) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>; promptFeedback?: { blockReason?: string } };
  if (b.promptFeedback?.blockReason) return { error: "Gemini declined this input (" + b.promptFeedback.blockReason + ")." };
  const text = b.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return text ? { text } : { error: "Gemini returned an empty answer (" + (b.candidates?.[0]?.finishReason ?? "no reason") + ")." };
}

export interface ModelInfo {
  id: string;
  label: string;
}

/** Usable text models from a models.list answer: newest first, Flash before Pro. */
export function rankModels(body: unknown): ModelInfo[] {
  const models = ((body ?? {}) as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> }).models ?? [];
  const usable = models.filter(
    (m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/i.test(m.name) && !/(image|tts|audio|live|embedding|vision|aqa|learnlm)/i.test(m.name),
  );
  const version = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const rank = (n: string) => (/flash/.test(n) && !/lite/.test(n) ? 0 : /flash/.test(n) ? 1 : 2) + (/(preview|exp)/.test(n) ? 0.5 : 0);
  return usable.sort((a, b) => version(b.name) - version(a.name) || rank(a.name) - rank(b.name)).map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName ?? m.name }));
}

/** Busy or rate-limited: worth retrying, or trying another model. */
export const retryable = (status: number) => status === 429 || status === 500 || status === 503 || status === 504;

/**
 * Which models to try, in order: the chosen one, then up to `extra` others
 * from the ranked list - stable releases before previews, Flash before Pro -
 * so a model under "high demand" falls back to a quieter one.
 */
export function fallbackModels(chosen: string, ranked: ReadonlyArray<ModelInfo>, extra = 2): string[] {
  const stable = (id: string) => !/(preview|exp|latest)/.test(id);
  const others = ranked
    .map((m) => m.id)
    .filter((id) => id !== chosen)
    .sort((a, b) => Number(stable(b)) - Number(stable(a)) || Number(/flash/.test(b)) - Number(/flash/.test(a)));
  return [chosen, ...others.slice(0, extra)].filter(Boolean);
}
