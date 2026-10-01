"use client";

/**
 * TemplatePanel - paste a paper's main .tex, pick the venue, get the same
 * paper in that venue's template, with a list of what changed and what still
 * needs a human. Logic: lib/lab/template.ts.
 */
import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { convertTemplate, detectTemplate, TEMPLATE_LABELS, type TargetId, type Variant } from "@/lib/lab/template";
import { Button, Field, Notice, Segmented, Stats, TextInput, TextOutput, ToolFrame, Toolbar, TwoPane } from "../kit";

const TARGETS: ReadonlyArray<{ id: TargetId; label: string; title: string }> = [
  { id: "neurips", label: "NeurIPS", title: "article + neurips_2025.sty" },
  { id: "ieee", label: "IEEE", title: "IEEEtran" },
  { id: "lncs", label: "LNCS", title: "Springer llncs" },
  { id: "acm", label: "ACM", title: "acmart" },
  { id: "nature", label: "Nature", title: "Springer Nature sn-jnl" },
];

const VARIANTS: Record<"ieee" | "acm", ReadonlyArray<{ id: Variant; label: string; title: string }>> = {
  ieee: [
    { id: "journal", label: "Transactions", title: "\\documentclass[journal]{IEEEtran}" },
    { id: "conference", label: "Conference", title: "\\documentclass[conference]{IEEEtran}" },
  ],
  acm: [
    { id: "conference", label: "sigconf", title: "Two-column proceedings" },
    { id: "journal", label: "acmsmall", title: "Single-column journal" },
  ],
};

const SAMPLE = String.raw`\documentclass{article}
\usepackage[final]{neurips_2024}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{natbib}
\newcommand{\R}{\mathbb{R}}

\title{Sparse Attention Is All You Prune}

\author{%
  Ada Lovelace\thanks{Work done while at Analytical Labs.} \\
  Department of Computer Science\\
  University of Cambridge, Cambridge, UK \\
  \texttt{ada@cam.ac.uk} \\
  \And
  Alan Turing \\
  Google DeepMind, London, UK \\
  \texttt{alan@deepmind.com} \\
}

\begin{document}

\maketitle

\begin{abstract}
We show that 60\% of attention heads can be pruned after training with no
loss in accuracy, and give a one-line criterion for choosing them.
\end{abstract}

\section{Introduction}
Transformers~\citep{vaswani2017} spend most of their compute in attention.
For weights $W \in \R^{d \times d}$ we minimise
\begin{equation}
  \mathcal{L}(W) = \sum_{i=1}^{n} \ell\bigl(f_W(x_i), y_i\bigr) + \lambda \|W\|_1 .
  \label{eq:loss}
\end{equation}

\begin{figure*}[t]
  \centering
  \includegraphics[width=\textwidth]{figs/overview}
  \caption{Pruning pipeline. Heads below the threshold in \eqref{eq:loss} are removed.}
  \label{fig:overview}
\end{figure*}

\section{Experiments}
Figure~\ref{fig:overview} summarises the pipeline.

\begin{ack}
We thank the anonymous reviewers.
\end{ack}

\bibliographystyle{plainnat}
\bibliography{refs}

\end{document}
`;

export default function TemplatePanel() {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<TargetId>("ieee");
  const [variants, setVariants] = useState<Record<"ieee" | "acm", Variant>>({ ieee: "journal", acm: "conference" });

  const from = useMemo(() => (text.trim() ? detectTemplate(text) : null), [text]);
  const variant: Variant = target === "ieee" || target === "acm" ? variants[target] : "conference";
  const result = useMemo(() => (text.trim() ? convertTemplate(text, target, variant) : null), [text, target, variant]);

  return (
    <ToolFrame
      title="Journal Template Converter"
      slug="template-convert"
      pain="Re-submitting to another venue means rewriting the document class, the author and affiliation block, and the float conventions by hand."
    >
      <Toolbar>
        <Field label="Target venue">
          <Segmented label="Target venue" value={target} options={TARGETS} onChange={setTarget} />
        </Field>
        {(target === "ieee" || target === "acm") && (
          <Field label="Format">
            <Segmented label="Format" value={variants[target]} options={VARIANTS[target]} onChange={(v) => setVariants((prev) => ({ ...prev, [target]: v }))} />
          </Field>
        )}
        {from && (
          <span className="mb-1 flex items-center gap-1.5 text-xs text-faint">
            Detected
            <span className="rounded-md bg-accent/10 px-2 py-0.5 font-semibold text-accent">{TEMPLATE_LABELS[from]}</span>
          </span>
        )}
        <Button icon={Sparkles} className="ml-auto" onClick={() => setText(SAMPLE)}>
          Load sample
        </Button>
      </Toolbar>

      {result && (
        <Stats
          items={[
            { label: "authors", value: result.meta.authors.length, tone: result.meta.authors.length ? "ok" : "warn" },
            { label: "affiliations", value: new Set(result.meta.authors.flatMap((a) => a.affiliations.map((f) => f.raw))).size },
            { label: "keywords", value: result.meta.keywords.length },
            { label: "changes", value: result.changes.length },
            { label: "to do", value: result.todos.length, tone: result.todos.length ? "warn" : "ok" },
          ]}
        />
      )}

      <TwoPane>
        <TextInput label="Main .tex" value={text} onChange={setText} placeholder="Paste your paper's main .tex (from \documentclass to \end{document})..." accept=".tex,text/*" />
        <TextOutput label={"main_" + target + ".tex"} value={result?.output ?? ""} filename={"main_" + target + ".tex"} emptyText="The converted paper appears here." />
      </TwoPane>

      {result && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Notice tone="ok">
            <div className="mb-1 font-semibold">Changes made</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {result.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </Notice>
          {result.todos.length > 0 && (
            <Notice tone="warn">
              <div className="mb-1 font-semibold">Still to do by hand</div>
              <ul className="list-disc space-y-0.5 pl-4">
                {result.todos.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </ToolFrame>
  );
}
