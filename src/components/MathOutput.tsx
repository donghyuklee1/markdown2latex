"use client";

import { useMemo, useState } from "react";
import { BlockMath, InlineMath } from "./Katex";
import { Code2, Eye, TriangleAlert } from "lucide-react";
import { prepareForKatex, segment } from "@/lib/cleaner";
import { highlightLine } from "@/lib/highlight";

interface Props {
  output: string;
}

type Tab = "code" | "preview";

/** Inline, non-fatal report of a block KaTeX refused to parse. */
function BrokenMath({ message, source }: { message: string; source: string }) {
  return (
    <span
      title={message}
      className="my-1 inline-flex max-w-full items-start gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 align-middle font-mono text-xs text-rose-300"
    >
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      <span className="break-all">{source.length > 90 ? source.slice(0, 90) + "..." : source}</span>
    </span>
  );
}

function CodeView({ output }: { output: string }) {
  const lines = useMemo(() => output.split("\n"), [output]);

  return (
    <div className="scroll-slim h-full overflow-auto">
      <div className="min-w-max py-3 font-mono text-[13px] leading-6">
        {lines.map((line, idx) => (
          <div key={idx} className="group flex hover:bg-ink-800/40">
            <span className="w-11 shrink-0 select-none pr-2 text-right text-ink-600">{idx + 1}</span>
            <code
              className="flex-1 whitespace-pre pr-4 text-slate-200"
              dangerouslySetInnerHTML={{ __html: highlightLine(line) || "&nbsp;" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewView({ output }: { output: string }) {
  const segments = useMemo(() => segment(output), [output]);

  return (
    <div className="scroll-slim h-full overflow-auto px-4 py-3 text-[15px] leading-relaxed text-slate-300">
      {segments.map((seg, idx) => {
        if (seg.type === "text") {
          // Markdown prose is shown as-is; CleanMath formats math, it does not
          // render the surrounding document.
          return (
            <span key={idx} className="whitespace-pre-wrap">
              {seg.value}
            </span>
          );
        }

        const latex = prepareForKatex(seg.value);

        if (seg.type === "display") {
          return (
            <div key={idx} className="my-1">
              <BlockMath
                math={latex}
                renderError={(error) => <BrokenMath message={error.message} source={seg.value.trim()} />}
              />
            </div>
          );
        }

        return (
          <InlineMath
            key={idx}
            math={latex}
            renderError={(error) => <BrokenMath message={error.message} source={seg.value.trim()} />}
          />
        );
      })}
    </div>
  );
}

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Code2 }> = [
  { id: "code", label: "Clean LaTeX", icon: Code2 },
  { id: "preview", label: "Live Preview", icon: Eye },
];

export default function MathOutput({ output }: Props) {
  const [tab, setTab] = useState<Tab>("code");

  return (
    // flex-1: this pane sits in a flex column next to the copy button, so unlike
    // MathInput (a direct grid child) it has to be told to fill the row.
    <section className="flex min-h-[320px] flex-1 flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900/40 lg:min-h-0">
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-2 py-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors " +
              (tab === id
                ? "bg-ink-800 text-white"
                : "text-slate-500 hover:bg-ink-800/50 hover:text-slate-300")
            }
          >
            <Icon size={13} strokeWidth={2.5} />
            {label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {output ? (
          tab === "code" ? (
            <CodeView output={output} />
          ) : (
            <PreviewView output={output} />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-600">
            Clean LaTeX appears here as you type.
          </div>
        )}
      </div>
    </section>
  );
}
