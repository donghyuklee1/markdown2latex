"use client";

/**
 * ResizerPanel - paste a paper, choose the column layout, and every display
 * equation or table wider than the column is reported (with an estimated
 * width bar) and shrunk. Logic: lib/lab/resizer.ts.
 */
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { detectLayout, LAYOUTS, resizeOverflow, type BlockReport, type Strategy } from "@/lib/lab/resizer";
import { Button, Field, Notice, Pane, Segmented, Stats, TextInput, TextOutput, ToolFrame, Toolbar, TwoPane, inputClass } from "../kit";

const STRATEGIES: ReadonlyArray<{ id: Strategy; label: string; title: string }> = [
  { id: "auto", label: "Auto", title: "A smaller font when at most 15% too wide, \\resizebox beyond that" },
  { id: "resizebox", label: "\\resizebox", title: "Scale the block to the column width" },
  { id: "fontsize", label: "Font size", title: "\\small / \\footnotesize / \\scriptsize" },
];

const SAMPLE = String.raw`\documentclass[conference]{IEEEtran}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}

\begin{document}
\section{Method}
The training objective combines the adversarial and regularisation terms:
\begin{equation}
  \mathcal{L}(\theta) = \mathbb{E}_{x \sim p_{\text{data}}}\left[ \log D(x) \right] + \mathbb{E}_{z \sim p_z}\left[\log\left(1 - D(G(z))\right)\right] + \lambda \sum_{i=1}^{N} \| \nabla_\theta f_\theta(x_i) \|_2^2
  \label{eq:objective}
\end{equation}
The state transition matrix is
\[
  A = \begin{bmatrix}
    1 & \Delta t & \tfrac{1}{2}\Delta t^2 & 0 & 0 & 0 & \alpha_{17} & \alpha_{18} & \beta_{19} & \beta_{1,10} \\
    0 & 1 & \Delta t & 0 & 0 & 0 & \alpha_{27} & \alpha_{28} & \beta_{29} & \beta_{2,10} \\
    0 & 0 & 1 & \Delta t & \tfrac{1}{2}\Delta t^2 & \tfrac{1}{6}\Delta t^3 & \alpha_{37} & \alpha_{38} & \beta_{39} & \beta_{3,10}
  \end{bmatrix}
\]
and the update is simply
\begin{equation}
  x_{t+1} = A x_t + w_t . \label{eq:update}
\end{equation}

\begin{table}[t]
  \centering
  \caption{Results on the benchmark.}
  \begin{tabular}{lcccccc}
    \toprule
    Method & Accuracy (\%) & Precision & Recall & F1 score & Params (M) & Latency (ms) \\
    \midrule
    Transformer baseline & 91.2 & 90.1 & 89.7 & 89.9 & 110.0 & 23.4 \\
    Ours (pruned) & 91.0 & 90.3 & 89.2 & 89.7 & 44.0 & 9.8 \\
    \bottomrule
  \end{tabular}
\end{table}
\end{document}
`;

/** Estimated width against the limit; the overflow is drawn in the danger colour. */
function WidthBar({ b }: { b: BlockReport }) {
  const total = Math.max(b.estimatedWidthPt, b.columnWidthPt) || 1;
  const fit = (Math.min(b.estimatedWidthPt, b.columnWidthPt) / total) * 100;
  const over = (Math.max(0, b.estimatedWidthPt - b.columnWidthPt) / total) * 100;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2" title={b.estimatedWidthPt + "pt of " + b.columnWidthPt + "pt"}>
      <div className="absolute inset-y-0 left-0 bg-ok/70" style={{ width: fit + "%" }} />
      {over > 0 && <div className="absolute inset-y-0 bg-danger" style={{ left: fit + "%", width: over + "%" }} />}
      <div className="absolute inset-y-[-2px] w-px bg-text/60" style={{ left: (b.columnWidthPt / total) * 100 + "%" }} />
    </div>
  );
}

export default function ResizerPanel() {
  const [text, setText] = useState("");
  const [layout, setLayout] = useState("auto");
  const [customPt, setCustomPt] = useState("241");
  const [strategy, setStrategy] = useState<Strategy>("auto");

  const detected = useMemo(() => detectLayout(text), [text]);
  const preset = LAYOUTS.find((l) => l.id === (layout === "auto" ? detected : layout));
  const custom = Math.max(50, parseFloat(customPt) || 0);
  const columnWidthPt = layout === "custom" ? custom : (preset?.columnWidthPt ?? 241);
  const textWidthPt = layout === "custom" ? custom : (preset?.textWidthPt ?? columnWidthPt);

  const result = useMemo(() => (text.trim() ? resizeOverflow(text, { columnWidthPt, textWidthPt, strategy }) : null), [text, columnWidthPt, textWidthPt, strategy]);
  const overflowing = result?.blocks.filter((b) => b.ratio > 1).length ?? 0;
  const fixed = result?.blocks.filter((b) => b.ratio > 1 && b.action.startsWith("\\")).length ?? 0;

  return (
    <ToolFrame
      title="Overflow Resizer"
      slug="auto-resizer"
      pain="Long equations, matrices and tables spill past a two-column layout and fill the log with Overfull \hbox warnings."
    >
      <Toolbar>
        <Field label="Column layout">
          <select className={inputClass + " min-w-64"} value={layout} onChange={(e) => setLayout(e.target.value)} aria-label="Column layout">
            <option value="auto">Auto ({LAYOUTS.find((l) => l.id === detected)?.label ?? "two-column"})</option>
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
            <option value="custom">Custom width</option>
          </select>
        </Field>
        {layout === "custom" && (
          <Field label="Width (pt)">
            <input className={inputClass + " w-24"} inputMode="decimal" value={customPt} onChange={(e) => setCustomPt(e.target.value)} aria-label="Column width in points" />
          </Field>
        )}
        <Field label="Fix with">
          <Segmented label="Fix strategy" value={strategy} options={STRATEGIES} onChange={setStrategy} />
        </Field>
        <Button icon={Sparkles} className="ml-auto" onClick={() => setText(SAMPLE)}>
          Load sample
        </Button>
      </Toolbar>

      {result && (
        <Stats
          items={[
            { label: "blocks", value: result.blocks.length },
            { label: "overflowing", value: overflowing, tone: overflowing ? "danger" : "ok" },
            { label: "fixed", value: fixed, tone: fixed ? "ok" : undefined },
            { label: "column", value: columnWidthPt + "pt" },
            { label: "font", value: result.fontPt + "pt" },
          ]}
        />
      )}
      <Notice>
        Widths are estimates from a simple glyph model (about 0.5em per character, 0.9em per operator, scripts at 70%), not a TeX run - treat a block near
        100% as borderline and check the compiled PDF.
      </Notice>

      <TwoPane>
        <TextInput label="Paper .tex" value={text} onChange={setText} placeholder="Paste a .tex file (the preamble is used for the font size and is never changed except to add graphicx)..." accept=".tex,text/*" />
        <TextOutput label="main_resized.tex" value={result?.output ?? ""} filename="main_resized.tex" emptyText="The resized paper appears here." />
      </TwoPane>

      {result && result.blocks.length > 0 && (
        <Pane label="Blocks" className="min-h-0">
          <ul className="divide-y divide-border">
            {result.blocks.map((b, i) => (
              <li key={i} className="grid grid-cols-[4.5rem_6rem_1fr_auto] items-center gap-3 px-3 py-2 text-xs sm:grid-cols-[4.5rem_7rem_1fr_9rem_12rem]">
                <span className="font-mono text-faint">L{b.line}</span>
                <code className="truncate font-mono text-muted" title={b.env}>
                  {b.env}
                </code>
                <WidthBar b={b} />
                <span className={"hidden text-right font-mono sm:block " + (b.ratio > 1 ? "text-danger" : "text-faint")}>
                  {Math.round(b.estimatedWidthPt)} / {b.columnWidthPt}pt
                </span>
                <span className={"truncate text-right font-mono " + (b.action === "fits" ? "text-faint" : b.action.startsWith("\\") ? "text-ok" : "text-muted")} title={b.action}>
                  {b.action}
                </span>
              </li>
            ))}
          </ul>
        </Pane>
      )}
      {result && result.changes.length > 0 && (
        <Notice tone="ok">
          <ul className="list-disc space-y-0.5 pl-4">
            {result.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Notice>
      )}
    </ToolFrame>
  );
}
