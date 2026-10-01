"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ListOrdered } from "lucide-react";
import { prepareForKatex, segment, type MathBlock } from "@/lib/cleaner";
import type { Diagnostic } from "@/lib/diagnostics";
import { BlockMath, InlineMath } from "../Katex";

/**
 * Equation outline: every math block in the document, rendered, in order,
 * with its line and any KaTeX error. Click to select it in the editor.
 */
export default function OutlinePanel({
  blocks,
  diagnostics,
  onSelect,
}: {
  blocks: ReadonlyArray<MathBlock>;
  diagnostics: ReadonlyArray<Diagnostic>;
  onSelect: (from: number, to: number) => void;
}) {
  const [inline, setInline] = useState(false);
  const broken = useMemo(() => new Set(diagnostics.map((d) => d.line)), [diagnostics]);
  const shown = useMemo(() => blocks.filter((b) => inline || b.kind === "display"), [blocks, inline]);

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center justify-between text-[11px] text-faint">
        <span>
          {shown.length} {shown.length === 1 ? "equation" : "equations"}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input type="checkbox" checked={inline} onChange={(e) => setInline(e.target.checked)} className="accent-[rgb(var(--accent))]" />
          include inline
        </label>
      </div>
      {!shown.length && (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <ListOrdered size={22} className="text-faint" />
          <p className="text-xs text-faint">No {inline ? "" : "display "}equations yet.</p>
        </div>
      )}
      <ol className="space-y-1">
        {shown.map((b, i) => {
          const seg = segment(b.emitted).find((s) => s.type !== "text");
          const latex = seg ? prepareForKatex(seg.value) : "";
          const bad = [...broken].some((l) => l >= b.line && l <= b.endLine);
          return (
            <li key={b.line + ":" + i}>
              <button
                type="button"
                onClick={() => onSelect(b.line, b.endLine)}
                className={
                  "press press-soft flex w-full items-start gap-2 rounded-lg border p-2 text-left " +
                  (bad ? "border-danger/40 bg-danger/[0.05]" : "border-border bg-bg hover:border-accent/40 hover:bg-accent/[0.04]")
                }
              >
                <span className="mt-0.5 w-8 shrink-0 font-mono text-[10px] text-faint">L{b.line}</span>
                <span className="math-preview min-w-0 flex-1 overflow-hidden text-[12px] [&_.katex-display]:my-0">
                  {b.kind === "display" ? (
                    <BlockMath math={latex} renderError={() => <code className="block truncate text-[11px] text-danger">{latex}</code>} />
                  ) : (
                    <InlineMath math={latex} renderError={() => <code className="truncate text-[11px] text-danger">{latex}</code>} />
                  )}
                </span>
                {bad && <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
