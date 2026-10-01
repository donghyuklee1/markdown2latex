"use client";

/**
 * SymbolsPanel - the Symbol Table tool. The inventory and the generated block
 * are derived from the paper text and options with useMemo; detection lives
 * in lib/lab/symbols.ts. Symbols render through the shared KaTeX binding,
 * falling back to the raw LaTeX when KaTeX cannot parse one.
 */
import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { InlineMath } from "@/components/Katex";
import { useToast } from "@/components/Toast";
import { extractSymbols, generateSymbols, type SymbolFormat, type SymbolInfo, type SymbolOptions, type SymbolSort } from "@/lib/lab/symbols";
import { Button, Field, Notice, Pane, Segmented, Stats, Switch, TextInput, TextOutput, Toolbar, ToolFrame, TwoPane } from "../kit";

const SAMPLE = String.raw`\documentclass{article}
\usepackage{amsmath,amssymb}
\begin{document}

\section{Method}
Let $\mathbf{X} \in \mathbb{R}^{n \times d}$ be the input sequence of $n$ tokens.
Each attention head computes
\begin{equation}
  \mathbf{A} = \operatorname{softmax}\!\left(\frac{\mathbf{Q}\mathbf{K}^\top}{\sqrt{d_k}}\right)\mathbf{V},
  \label{eq:attn}
\end{equation}
where $\mathbf{Q} = \mathbf{X}\mathbf{W}_Q$, $\mathbf{K} = \mathbf{X}\mathbf{W}_K$ and
$\mathbf{V} = \mathbf{X}\mathbf{W}_V$, and $d_k$ denotes the key dimension.

We train the parameters $\theta$ by minimising
\begin{equation}
  \mathcal{L}(\theta) = -\frac{1}{N}\sum_{i=1}^{N} \log p_\theta(y_i \mid x_i)
    + \lambda \lVert \theta \rVert_2^2,
\end{equation}
where $N$ is the number of training examples and $\lambda$ is the weight-decay coefficient.
The prediction $\hat{y}_i$ is the arg-max of $p_\theta$. % TODO: define p_theta properly
We use Adam with learning rate $\eta$ and warm-up of $\tau$ steps.

\end{document}
`;

const FORMATS: ReadonlyArray<{ id: SymbolFormat; label: string; title: string }> = [
  { id: "table", label: "Table", title: "\\begin{table} with a two-column tabular" },
  { id: "nomenclature", label: "nomencl", title: "\\nomenclature entries for the nomencl package" },
  { id: "markdown", label: "Markdown", title: "A markdown table" },
];
const SORTS: ReadonlyArray<{ id: SymbolSort; label: string; title: string }> = [
  { id: "appearance", label: "Appearance", title: "Order of first use" },
  { id: "alpha", label: "A-Z", title: "Alphabetical, Latin before Greek" },
];

function SymbolRow({ s }: { s: SymbolInfo }) {
  return (
    <li className="grid grid-cols-[minmax(4.5rem,auto)_1fr] items-start gap-x-3 px-3 py-2 text-xs">
      <span className="min-w-0 pt-0.5 text-[15px] text-text">
        <InlineMath math={s.latex} renderError={() => <code className="font-mono text-[12px]">{s.latex}</code>} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {s.defined ? (
            <span className="text-text">{s.description || <span className="italic text-faint">defined ({s.via}), no description</span>}</span>
          ) : (
            <span className="rounded border border-danger/30 bg-danger/[0.08] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider text-danger">undefined</span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
          <span>{s.count}x</span>
          <span>first L{s.firstLine}</span>
          {s.defLine !== null && <span>def L{s.defLine}</span>}
          <span className="truncate" title={s.sample}>
            {s.sample}
          </span>
        </div>
      </div>
    </li>
  );
}

export default function SymbolsPanel() {
  const toast = useToast();
  const [src, setSrc] = useState("");
  const [format, setFormat] = useState<SymbolFormat>("table");
  const [opts, setOpts] = useState<SymbolOptions>({ sort: "appearance", excludeConstants: true, excludeIndices: true });
  const set = <K extends keyof SymbolOptions>(k: K, v: SymbolOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const [onlyUndefined, setOnlyUndefined] = useState(false);

  const report = useMemo(() => (src.trim() ? extractSymbols(src, opts) : null), [src, opts]);
  const output = useMemo(() => (report ? generateSymbols(report.symbols, format) : ""), [report, format]);
  const shown = report ? (onlyUndefined ? report.symbols.filter((s) => !s.defined) : report.symbols) : [];

  const loadSample = () => {
    const prev = src;
    setSrc(SAMPLE);
    toast("Loaded a sample ML-paper excerpt", "info", prev ? { label: "Undo", run: () => setSrc(prev) } : undefined);
  };

  return (
    <ToolFrame
      title="Symbol Table"
      slug="symbol-table"
      pain="Papers use symbols they never define and venues want a List of Symbols - this finds every symbol, flags the undefined ones and writes the table."
    >
      <Toolbar>
        <Field label="Output">
          <Segmented label="Output format" value={format} options={FORMATS} onChange={setFormat} />
        </Field>
        <Field label="Sort">
          <Segmented label="Sort order" value={opts.sort} options={SORTS} onChange={(v) => set("sort", v)} />
        </Field>
        <Switch label="Hide constants" checked={opts.excludeConstants} onChange={(v) => set("excludeConstants", v)} hint="e, i, \pi and number sets like \mathbb{R}" />
        <Switch label="Hide indices" checked={opts.excludeIndices} onChange={(v) => set("excludeIndices", v)} hint="i, j, k, l, m, n, t when they only appear as subscripts" />
        <Switch label="Only undefined" checked={onlyUndefined} onChange={setOnlyUndefined} hint="Filter the list (the generated block keeps every symbol)" />
        <Button icon={FlaskConical} onClick={loadSample} className="ml-auto">
          Load sample
        </Button>
      </Toolbar>

      {report && (
        <Stats
          items={[
            { label: "symbols", value: report.stats.symbols },
            { label: "defined", value: report.stats.defined, tone: "ok" },
            { label: "undefined", value: report.stats.undefined, tone: report.stats.undefined ? "danger" : "ok" },
            { label: "hidden", value: report.stats.hidden },
            { label: "math blocks", value: report.stats.mathBlocks },
          ]}
        />
      )}
      {report && report.issues.length > 0 && (
        <Notice tone="warn">
          {report.issues.slice(0, 3).map((i) => "Line " + i.line + ": " + i.message).join(" ")}
        </Notice>
      )}

      <TwoPane>
        <TextInput label="Paper (.tex or markdown)" value={src} onChange={setSrc} placeholder="Paste a .tex file or markdown with $math$ - or press Load sample." className="h-[440px]" />
        <Pane label={"Symbols" + (report ? " (" + shown.length + ")" : "")} className="h-[440px]">
          {shown.length ? (
            <ul className="scroll-slim min-h-0 flex-1 divide-y divide-border overflow-auto">
              {shown.map((s) => (
                <SymbolRow key={s.latex} s={s} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-faint">
              {report ? (onlyUndefined ? "Every symbol is defined." : "No math symbols found.") : "Symbols appear here, each flagged defined or undefined."}
            </div>
          )}
        </Pane>
      </TwoPane>

      <TextOutput label="Generated" value={output} filename="symbols.tex" emptyText="The table, nomenclature or markdown appears here." className="h-[320px]" />
    </ToolFrame>
  );
}
