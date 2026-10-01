"use client";

import { useMemo } from "react";
import { BlockMath, InlineMath } from "./Katex";
import { Code2, Download, Eye, Link2, Maximize2, Minimize2, TriangleAlert, WrapText } from "lucide-react";
import { prepareForKatex, segment } from "@/lib/cleaner";
import { highlightLine } from "@/lib/highlight";
import type { OutputTab } from "@/lib/persistedStore";
import MathColorPicker from "./MathColorPicker";
import { IconButton } from "./ui";

interface Props {
  output: string;
  tab: OutputTab;
  onTab: (tab: OutputTab) => void;
  fontSize: number;
  wrap: boolean;
  onToggleWrap: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  onDownload: () => void;
  downloadName: string;
  onShare: () => void;
}

type Tab = OutputTab;

/** Inline, non-fatal report of a block KaTeX refused to parse. */
function BrokenMath({ message, source }: { message: string; source: string }) {
  return (
    <span
      title={message}
      className="my-1 inline-flex max-w-full items-start gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 align-middle font-mono text-xs text-danger"
    >
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      <span className="break-all">{source.length > 90 ? source.slice(0, 90) + "..." : source}</span>
    </span>
  );
}

function CodeView({ output, fontSize, wrap }: { output: string; fontSize: number; wrap: boolean }) {
  const lines = useMemo(() => output.split("\n"), [output]);

  return (
    <div className="scroll-slim h-full overflow-auto">
      <div
        className={"py-3 font-mono " + (wrap ? "" : "min-w-max")}
        style={{ fontSize, lineHeight: Math.round(fontSize * 1.85) + "px" }}
      >
        {lines.map((line, idx) => (
          <div key={idx} className="group flex hover:bg-surface-2">
            <span className="w-11 shrink-0 select-none pr-2 text-right text-faint">{idx + 1}</span>
            <code
              className={"flex-1 pr-4 text-text " + (wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}
              dangerouslySetInnerHTML={{ __html: highlightLine(line) || "&nbsp;" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewView({ output, fontSize }: { output: string; fontSize: number }) {
  const segments = useMemo(() => segment(output), [output]);

  return (
    <div
      className="math-preview scroll-slim h-full overflow-auto px-4 py-3 leading-relaxed text-muted"
      style={{ fontSize: fontSize + 2 }}
    >
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

export default function MathOutput({
  output,
  tab,
  onTab,
  fontSize,
  wrap,
  onToggleWrap,
  maximized,
  onToggleMaximize,
  onDownload,
  downloadName,
  onShare,
}: Props) {
  return (
    // flex-1: this pane sits in a flex column next to the copy button, so unlike
    // MathInput it has to be told to fill the row.
    <section className="themed flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        <div role="tablist" aria-label="Output view" className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              title={label + " (Alt+P)"}
              onClick={() => onTab(id)}
              className={
                "press flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold " +
                (tab === id ? "bg-surface-2 text-text" : "text-faint hover:bg-surface-2 hover:text-muted")
              }
            >
              <Icon size={13} strokeWidth={2.5} />
              <span className={tab === id ? "" : "hidden sm:inline"}>{label}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          {tab === "preview" && <MathColorPicker />}
          {tab === "code" && (
            <IconButton icon={WrapText} label="Word wrap" title="Word wrap (Alt+W)" active={wrap} onClick={onToggleWrap} />
          )}
          <IconButton
            icon={Download}
            label="Download"
            title={"Download as " + downloadName + " (Cmd/Ctrl+S)"}
            onClick={onDownload}
            disabled={!output}
          />
          <IconButton
            icon={Link2}
            label="Copy share link"
            title="Copy a link that opens this input - it lives in the URL after #, so no server ever sees it (Alt+L)"
            onClick={onShare}
          />
          <IconButton
            icon={maximized ? Minimize2 : Maximize2}
            label={maximized ? "Restore both panes" : "Maximise the output"}
            title={(maximized ? "Restore both panes" : "Maximise the output") + " (Alt+])"}
            active={maximized}
            onClick={onToggleMaximize}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {output ? (
          tab === "code" ? (
            <CodeView output={output} fontSize={fontSize} wrap={wrap} />
          ) : (
            <PreviewView output={output} fontSize={fontSize} />
          )
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-faint">
            Clean LaTeX appears here as you type.
          </div>
        )}
      </div>
    </section>
  );
}
