"use client";

/**
 * SandboxPanel - math-code-sandbox: paste the PyTorch / NumPy implementation,
 * and every tensor the paper declares (`W_q \in R^{d x d_k}`) is checked
 * against the shape the code actually builds. The interpreter is the pure
 * TypeScript one in lib/studio/shapeSandbox.ts - no Python runtime ships.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, FlaskConical, XCircle } from "lucide-react";
import { InlineMath } from "@/components/Katex";
import { useToast } from "@/components/Toast";
import { Button, Field, Notice, Segmented, Stats, TextInput, inputClass } from "@/components/lab/kit";
import {
  analyzeSandbox,
  latexBlocksFromSource,
  parseMapping,
  SAMPLE_CODE,
  SAMPLE_LATEX,
  type CheckStatus,
  type ShapeCheck,
} from "@/lib/studio/shapeSandbox";
import type { StudioContext } from "./types";

type Source = "doc" | "paste";

const PLACEHOLDER = `import torch
import torch.nn as nn

B, T, D, H = 32, 128, 512, 8
x = torch.randn(B, T, D)
W_q = nn.Linear(D, D)
q = W_q(x).view(B, T, H, D // H).transpose(1, 2)
scores = q @ q.transpose(-2, -1)`;

function Tex({ math }: { math: string }) {
  return <InlineMath math={math} renderError={() => <code className="font-mono text-[12px] text-text">{math}</code>} />;
}

function StatusTag({ status, shape }: { status: CheckStatus; shape?: string }) {
  if (status === "match")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-ok/30 bg-ok/[0.08] px-1.5 py-0.5 text-[11px] font-semibold text-ok">
        <CheckCircle2 size={12} /> Dimensions Match{shape ? " [" + shape + "]" : ""}
      </span>
    );
  if (status === "mismatch")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-danger/30 bg-danger/[0.07] px-1.5 py-0.5 text-[11px] font-semibold text-danger">
        <XCircle size={12} /> Shape Mismatch
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-muted">
      <CircleHelp size={12} /> Unknown
    </span>
  );
}

function CheckRow({ c, onSelect }: { c: ShapeCheck; onSelect?: () => void }) {
  const body = (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] text-text">
          <Tex math={c.latexSymbol} />
        </span>
        <span className="text-faint">&harr;</span>
        <code className="font-mono text-[12px] text-text">{c.codeVar ?? "?"}</code>
        <span className="ml-auto">
          <StatusTag status={c.status} shape={c.latexShape} />
        </span>
      </div>
      <div className="mt-1 grid gap-0.5 font-mono text-[11px] text-muted">
        <span>paper: {c.latexShape}</span>
        <span>code:&nbsp; {c.codeShape}</span>
      </div>
      {c.note && <div className={"mt-1 text-[11px] leading-snug " + (c.status === "mismatch" ? "text-danger" : "text-faint")}>{c.note}</div>}
    </>
  );
  const cls = "block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left";
  if (!onSelect) return <li className={cls}>{body}</li>;
  return (
    <li>
      <button type="button" onClick={onSelect} title={"Select line " + c.line + " in the editor"} className={cls + " press press-soft hover:border-border-strong"}>
        {body}
      </button>
    </li>
  );
}

export default function SandboxPanel({ input, selectLines }: StudioContext) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [source, setSource] = useState<Source>("doc");
  const [pasted, setPasted] = useState("");
  const [mappingText, setMappingText] = useState("");
  const [showVars, setShowVars] = useState(false);

  const blocks = useMemo(() => (source === "doc" ? latexBlocksFromSource(input) : latexBlocksFromSource(pasted, false)), [source, input, pasted]);
  const mapping = useMemo(() => parseMapping(mappingText), [mappingText]);
  const result = useMemo(() => analyzeSandbox(code, blocks, { mapping }), [code, blocks, mapping]);

  const counts = useMemo(() => {
    const all = [...result.checks.map((c) => c.status), ...result.equationChecks.map((e) => e.status)];
    return { match: all.filter((s) => s === "match").length, mismatch: all.filter((s) => s === "mismatch").length, unknown: all.filter((s) => s === "unknown").length };
  }, [result]);
  const conflicts = result.bindings.filter((b) => b.conflict);
  const codeErrors = result.errors.filter((e) => e.severity === "error");
  const warnings = result.errors.filter((e) => e.severity === "warning");
  const fromDoc = source === "doc";

  const loadSample = () => {
    setCode(SAMPLE_CODE);
    setPasted(SAMPLE_LATEX);
    setSource("paste");
    toast("Loaded a multi-head attention sample (with one deliberate mismatch)", "info");
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[13px] leading-snug text-muted">
          Check the tensor shapes your code builds against the dimensions your paper declares. Runs locally; no Python needed.
        </p>
        <Button icon={FlaskConical} onClick={loadSample}>
          Load sample
        </Button>
      </div>

      <TextInput label="PyTorch / NumPy code" value={code} onChange={setCode} placeholder={PLACEHOLDER} accept=".py,.txt,text/*" />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">LaTeX source</span>
        <Segmented<Source>
          label="LaTeX source"
          value={source}
          onChange={setSource}
          options={[
            { id: "doc", label: "Use the current document", title: "Read shape declarations from the editor" },
            { id: "paste", label: "Paste LaTeX" },
          ]}
        />
      </div>
      {source === "paste" && (
        <TextInput
          label="LaTeX"
          value={pasted}
          onChange={setPasted}
          placeholder={"\\mathbf{X} \\in \\mathbb{R}^{n \\times d}, \\quad \\mathbf{W}_q \\in \\mathbb{R}^{d \\times d_k}\nQ = \\mathbf{X}\\mathbf{W}_q"}
          className="!min-h-[160px]"
        />
      )}

      <Field label="Symbol mapping (optional)" hint="One per line, LaTeX symbol = code variable, e.g. W_q = q_proj. Names already match case-insensitively (W_q, Wq, w_q).">
        <textarea
          value={mappingText}
          onChange={(e) => setMappingText(e.target.value)}
          spellCheck={false}
          rows={2}
          placeholder="W_q = q_proj"
          className={inputClass + " h-auto min-h-[52px] resize-y py-1.5 leading-5"}
        />
      </Field>

      <Stats
        items={[
          { label: "matched", value: counts.match, tone: counts.match ? "ok" : undefined },
          { label: "mismatched", value: counts.mismatch, tone: counts.mismatch ? "danger" : undefined },
          { label: "unknown", value: counts.unknown, tone: counts.unknown ? "warn" : undefined },
          { label: "code errors", value: codeErrors.length, tone: codeErrors.length ? "danger" : undefined },
        ]}
      />

      {(codeErrors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-1">
          {[...codeErrors, ...warnings]
            .sort((a, b) => a.line - b.line)
            .map((e, i) => (
              <li
                key={i}
                className={
                  "flex gap-2 rounded-lg border px-3 py-1.5 font-mono text-[12px] " +
                  (e.severity === "error" ? "border-danger/30 bg-danger/[0.07] text-danger" : "border-accent/30 bg-accent/[0.07] text-text")
                }
              >
                <span className="shrink-0 font-semibold">line {e.line}</span>
                <span className="min-w-0 break-words">{e.message}</span>
              </li>
            ))}
        </ul>
      )}

      {conflicts.length > 0 && (
        <Notice tone="error">
          {conflicts.map((b) => (
            <div key={b.symbol}>
              <AlertTriangle size={12} className="mr-1 inline" />
              <Tex math={b.symbol} /> is bound to{" "}
              {[...new Set(b.values.map((v) => v.value))].join(" and ")} ({b.values.map((v) => v.source + " = " + v.value).join("; ")})
            </div>
          ))}
        </Notice>
      )}

      {result.checks.length === 0 ? (
        <Notice>
          {fromDoc
            ? "No shape declarations like \\mathbf{W} \\in \\mathbb{R}^{m \\times n} in the current document. Paste LaTeX instead, or load the sample."
            : "No shape declarations found in the pasted LaTeX yet."}
        </Notice>
      ) : (
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Declared shapes</h3>
          <ul className="space-y-1.5">
            {result.checks.map((c, i) => (
              <CheckRow key={i} c={c} onSelect={fromDoc && c.line !== null ? () => selectLines(c.line!, c.line!) : undefined} />
            ))}
          </ul>
        </section>
      )}

      {result.equationChecks.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-faint">Equations</h3>
          <ul className="space-y-1.5">
            {result.equationChecks.map((e, i) => {
              const body = (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="scroll-slim min-w-0 max-w-full overflow-x-auto text-[14px] text-text">
                      <Tex math={e.latex} />
                    </span>
                    <span className="ml-auto">
                      <StatusTag status={e.status} shape={e.status === "match" ? e.lhsShape : undefined} />
                    </span>
                  </div>
                  {e.note && <div className={"mt-1 text-[11px] leading-snug " + (e.status === "mismatch" ? "text-danger" : "text-faint")}>{e.note}</div>}
                </>
              );
              const cls = "block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left";
              return fromDoc && e.line !== null ? (
                <li key={i}>
                  <button type="button" onClick={() => selectLines(e.line!, e.line!)} className={cls + " press press-soft hover:border-border-strong"}>
                    {body}
                  </button>
                </li>
              ) : (
                <li key={i} className={cls}>
                  {body}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {result.variables.length > 0 && (
        <section className="rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setShowVars((v) => !v)}
            aria-expanded={showVars}
            className="press press-soft flex w-full items-center px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-faint hover:text-muted"
          >
            Code variables ({result.variables.length})
            <span className="ml-auto">{showVars ? "Hide" : "Show"}</span>
          </button>
          {showVars && (
            <table className="w-full border-t border-border font-mono text-[12px]">
              <tbody>
                {result.variables.map((v) => (
                  <tr key={v.name} className="border-b border-border last:border-0">
                    <td className="w-10 px-3 py-1 text-right text-faint">{v.line}</td>
                    <td className="px-2 py-1 text-text">{v.name}</td>
                    <td className="px-2 py-1 text-muted">{v.shape}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
