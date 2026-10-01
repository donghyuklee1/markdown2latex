"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Stethoscope, Wand2, X } from "lucide-react";
import { prepareForKatex } from "@/lib/cleaner";
import type { RepairResult } from "@/lib/repair";
import { BlockMath, InlineMath } from "./Katex";

const KIND_LABEL = { delimiter: "Delimiter", math: "Maths", prose: "Prose" } as const;

/**
 * Review step for "Check & Fix": every proposed repair with its reason and a
 * before -> after view, the repaired maths rendered live, and anything that
 * could not be fixed safely listed separately. Nothing changes until Apply.
 */
export default function RepairDialog({
  result,
  onApply,
  onClose,
  onJump,
}: {
  result: RepairResult;
  onApply: () => void;
  onClose: () => void;
  onJump: (line: number) => void;
}) {
  const applyRef = useRef<HTMLButtonElement>(null);
  const { fixes, unresolved } = result;

  useEffect(() => {
    applyRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repair-title"
        className="themed flex max-h-[85vh] w-full max-w-2xl animate-pop-in flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl shadow-black/20"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3">
          <Stethoscope size={16} className="text-accent" />
          <h2 id="repair-title" className="text-sm font-semibold text-text">
            Check &amp; Fix LaTeX
          </h2>
          <span className="text-xs text-faint">
            {fixes.length} {fixes.length === 1 ? "fix" : "fixes"}
            {unresolved.length > 0 && " · " + unresolved.length + " needs you"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="press ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-text"
          >
            <X size={15} />
          </button>
        </div>

        <div className="scroll-slim min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {fixes.length === 0 && unresolved.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <CheckCircle2 size={26} className="text-ok" />
              <p className="text-sm text-text">Everything renders. Nothing to fix.</p>
            </div>
          )}

          {fixes.map((f, i) => (
            <div key={i} className="animate-fade-in rounded-xl border border-border bg-bg p-3" style={{ animationDelay: Math.min(i, 8) * 30 + "ms" }}>
              <div className="mb-2 flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => onJump(f.line)}
                  title="Show this line in the editor"
                  className="press rounded-md bg-surface-2 px-1.5 py-0.5 font-mono font-semibold text-muted hover:text-accent"
                >
                  L{f.line}
                </button>
                <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">{KIND_LABEL[f.kind]}</span>
                <span className="min-w-0 text-text">{f.reason}</span>
              </div>
              <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                <pre className="scroll-slim max-h-24 overflow-auto rounded-lg bg-danger/[0.07] px-2 py-1.5 font-mono text-[11px] leading-snug text-text">{f.before || " "}</pre>
                <ArrowRight size={14} className="mx-auto hidden text-faint sm:block" />
                <pre className="scroll-slim max-h-24 overflow-auto rounded-lg bg-ok/[0.09] px-2 py-1.5 font-mono text-[11px] leading-snug text-text">{f.after}</pre>
              </div>
              {f.kind === "math" && (
                <div className="math-preview mt-2 overflow-x-auto rounded-lg border border-border px-2 text-[13px] [&_.katex-display]:my-1">
                  <BlockMath math={prepareForKatex(f.after)} renderError={() => <InlineMath math="\text{(preview unavailable)}" />} />
                </div>
              )}
            </div>
          ))}

          {unresolved.length > 0 && (
            <div className="rounded-xl border border-danger/30 bg-danger/[0.05] p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle size={13} /> Could not be fixed safely - left as is
              </div>
              <ul className="space-y-1">
                {unresolved.map((u, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-text">
                    <button type="button" onClick={() => onJump(u.line)} className="press shrink-0 rounded bg-surface px-1.5 font-mono text-[11px] text-muted hover:text-accent">
                      L{u.line}
                    </button>
                    <span>{u.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-[11px] text-faint">Each fix was re-checked with KaTeX. You can undo after applying.</span>
          <button type="button" onClick={onClose} className="press ml-auto rounded-lg px-3 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-text">
            Cancel
          </button>
          <button
            ref={applyRef}
            type="button"
            onClick={onApply}
            disabled={!fixes.length}
            className="press flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink shadow-md shadow-accent/20 hover:bg-accent/90 disabled:opacity-40"
          >
            <Wand2 size={13} /> Apply {fixes.length || ""} {fixes.length === 1 ? "fix" : "fixes"}
          </button>
        </div>
      </div>
    </div>
  );
}
