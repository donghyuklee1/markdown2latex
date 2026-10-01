"use client";

import { lazy, Suspense, useMemo, useState } from "react";
import { BlockMath, InlineMath } from "./Katex";
import {
  ArrowDownUp,
  ChevronsUpDown,
  Code2,
  Download,
  Eye,
  GitCompareArrows,
  Loader2,
  Network,
  Link2,
  Maximize2,
  Minimize2,
  TriangleAlert,
  WrapText,
} from "lucide-react";
import { prepareForKatex, segment } from "@/lib/cleaner";
import { diffLines, type DiffLine } from "@/lib/diff";
import { highlightLine } from "@/lib/highlight";
import { documentParts, parseProse, type Block, type Inline } from "@/lib/texDocument";
import { OUTPUT_TABS, type OutputTab } from "@/lib/persistedStore";
import BrandMark from "./BrandMark";
import MathColorPicker from "./MathColorPicker";
import type { StudioContext } from "./studio/types";

const FormulaGraph = lazy(() => import("./studio/FormulaGraph"));
import { IconButton } from "./ui";

interface Props {
  output: string;
  /** The raw input, for the diff view. */
  input: string;
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
  syncScroll: boolean;
  onToggleSync: () => void;
  /** Receives whichever view's scroller is mounted, so the editor can drive it. */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** Live document access for the formula graph. */
  studio: StudioContext;
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

type Scroller = React.RefObject<HTMLDivElement | null>;

function CodeView({ output, fontSize, wrap, scrollerRef }: { output: string; fontSize: number; wrap: boolean; scrollerRef: Scroller }) {
  const lines = useMemo(() => output.split("\n"), [output]);

  return (
    <div ref={scrollerRef} className="scroll-slim h-full overflow-auto">
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

/* --- LaTeX-document preview --------------------------------------------- */

function InlineRuns({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, i) =>
        r.t === "text" ? (
          <span key={i}>{r.v}</span>
        ) : r.t === "b" ? (
          <b key={i} className="font-semibold text-text"><InlineRuns runs={r.v} /></b>
        ) : r.t === "i" ? (
          <em key={i}><InlineRuns runs={r.v} /></em>
        ) : r.t === "code" ? (
          <code key={i} className="rounded bg-surface-2 px-1 font-mono text-[0.85em]"><InlineRuns runs={r.v} /></code>
        ) : r.t === "small" ? (
          <small key={i}><InlineRuns runs={r.v} /></small>
        ) : r.t === "cite" ? (
          <span key={i} className="text-accent" title={"\\cite{" + r.v + "}"}>[{r.v.split(",").map((k) => k.trim()).join(", ")}]</span>
        ) : r.t === "ref" ? (
          <span key={i} className="text-accent" title="cross-reference">{r.v}</span>
        ) : r.t === "note" ? (
          <sup key={i} className="ml-0.5 text-[0.7em] text-faint" title="footnote">[<InlineRuns runs={r.v} />]</sup>
        ) : (
          <br key={i} />
        ),
      )}
    </>
  );
}

/** Theorem-like blocks get "Lemma 3." labels; proofs end with a tombstone. */
function ProseBlocks({ blocks, counters }: { blocks: Block[]; counters: Map<string, number> }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "p") return b.v.length ? <span key={i}><InlineRuns runs={b.v} /> </span> : <span key={i} className="block h-2.5" />;
        if (b.t === "h")
          return (
            <span key={i} className={"block font-semibold text-text " + (b.level === 1 ? "mb-1 mt-5 text-[1.3em]" : b.level === 2 ? "mb-1 mt-4 text-[1.12em]" : "mt-3 text-[1em]")}>
              <InlineRuns runs={b.v} />
            </span>
          );
        if (b.t === "title") return <span key={i} className="mb-3 mt-2 block text-center text-[1.5em] font-semibold text-text"><InlineRuns runs={b.v} /></span>;
        if (b.t === "li")
          return (
            <span key={i} className="block pl-5 -indent-3">
              <span className="text-faint">{b.ordered ? "•" : "•"}</span> <InlineRuns runs={b.v} />
            </span>
          );
        // theorem-like environment edges
        if (b.edge === "end") {
          return b.name === "proof" ? <span key={i} className="block text-right text-text">{"∎"}</span> : <span key={i} className="block h-2" />;
        }
        const label = b.name.charAt(0).toUpperCase() + b.name.slice(1);
        const numbered = !/^(proof|abstract|figure|table|algorithm)$/.test(b.name);
        const n = numbered ? (counters.get(b.name) ?? 0) + 1 : 0;
        if (numbered) counters.set(b.name, n);
        return (
          <span key={i} className="mt-3 block">
            <b className={b.name === "proof" ? "font-medium italic text-text" : "font-semibold text-text"}>
              {label}
              {numbered ? " " + n : ""}
            </b>
            {b.title && (
              <span className="text-text"> (<InlineRuns runs={b.title} />)</span>
            )}
            <b className="text-text">.</b>{" "}
          </span>
        );
      })}
    </>
  );
}

function PreviewView({ output, fontSize, scrollerRef }: { output: string; fontSize: number; scrollerRef: Scroller }) {
  // A whole .tex document previews its body as a document; the preamble is
  // summarised in one line instead of being printed as text.
  const doc = useMemo(() => documentParts(output), [output]);
  const body = doc ? output.slice(doc.bodyStart, doc.bodyEnd) : output;
  const preamble = doc ? output.slice(0, doc.bodyStart) : "";
  const segments = useMemo(() => segment(body), [body]);
  const counters = new Map<string, number>();
  const pkgCount = (preamble.match(/\\usepackage/g) ?? []).length;
  const macroCount = (preamble.match(/\\(?:newcommand|renewcommand|def|DeclareMathOperator)(?![A-Za-z])/g) ?? []).length;

  return (
    <div
      ref={scrollerRef}
      className="math-preview scroll-slim h-full overflow-auto px-4 py-3 leading-relaxed text-muted"
      style={{ fontSize: fontSize + 2 }}
    >
      {doc && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-[11px] text-faint">
          <span className="font-semibold text-muted">Preamble</span>
          <span>{pkgCount} packages</span>·<span>{macroCount} macro definitions</span>
          <span className="ml-auto">kept as written, not previewed</span>
        </div>
      )}
      {segments.map((seg, idx) => {
        if (seg.type === "text" && doc) {
          return <ProseBlocks key={idx} blocks={parseProse(seg.value)} counters={counters} />;
        }
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

/** Unchanged runs longer than this fold away, keeping this much context each side. */
const FOLD_OVER = 6;
const FOLD_CONTEXT = 2;

type Row = { line: DiffLine } | { fold: number; hidden: DiffLine[] };

function DiffRow({ line }: { line: DiffLine }) {
  const tone =
    line.kind === "insert" ? "bg-ok/[0.09]" : line.kind === "delete" ? "bg-danger/[0.07]" : "";
  const mark =
    line.kind === "insert" ? "rounded-sm bg-ok/30 text-text" : "rounded-sm bg-danger/25 text-text line-through decoration-danger/50";
  return (
    <div className={"flex " + tone}>
      <span className="w-9 shrink-0 select-none pr-1.5 text-right text-faint/70">{line.before ?? ""}</span>
      <span className="w-9 shrink-0 select-none pr-1.5 text-right text-faint/70">{line.after ?? ""}</span>
      <span
        className={
          "w-5 shrink-0 select-none text-center font-bold " +
          (line.kind === "insert" ? "text-ok" : line.kind === "delete" ? "text-danger" : "text-transparent")
        }
      >
        {line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : " "}
      </span>
      <code className={"flex-1 whitespace-pre pr-4 " + (line.kind === "equal" ? "text-muted" : "text-text")}>
        {line.pieces.length === 1 && !line.pieces[0].text ? " " : null}
        {line.pieces.map((p, i) => (
          <span key={i} className={p.changed ? mark : ""}>
            {p.text}
          </span>
        ))}
      </code>
    </div>
  );
}

/**
 * What the cleaner changed, input against output. Green is what it added or
 * corrected, red what it stripped; long unchanged stretches fold away.
 */
function DiffView({ input, output, fontSize, scrollerRef }: { input: string; output: string; fontSize: number; scrollerRef: Scroller }) {
  const lines = useMemo(() => diffLines(input.replace(/\r\n?/g, "\n"), output), [input, output]);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const added = lines.filter((l) => l.kind === "insert").length;
  const removed = lines.filter((l) => l.kind === "delete").length;

  const rows = useMemo(() => {
    const out: Row[] = [];
    let i = 0;
    while (i < lines.length) {
      if (lines[i].kind !== "equal") {
        out.push({ line: lines[i++] });
        continue;
      }
      let j = i;
      while (j < lines.length && lines[j].kind === "equal") j++;
      const run = lines.slice(i, j);
      const head = i === 0 ? 0 : FOLD_CONTEXT;
      const tail = j === lines.length ? 0 : FOLD_CONTEXT;
      if (run.length > FOLD_OVER && run.length - head - tail > 1) {
        run.slice(0, head).forEach((line) => out.push({ line }));
        out.push({ fold: i, hidden: run.slice(head, run.length - tail) });
        run.slice(run.length - tail).forEach((line) => out.push({ line }));
      } else {
        run.forEach((line) => out.push({ line }));
      }
      i = j;
    }
    return out;
  }, [lines]);

  return (
    <div ref={scrollerRef} className="scroll-slim h-full overflow-auto">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-surface/95 px-3 py-1.5 text-[11px] backdrop-blur">
        {added + removed === 0 ? (
          <span className="text-faint">Nothing to change - the input is already clean.</span>
        ) : (
          <>
            <span className="font-mono font-semibold text-ok">+{added}</span>
            <span className="font-mono font-semibold text-danger">-{removed}</span>
            <span className="text-faint">lines</span>
            <span className="ml-auto hidden items-center gap-3 text-faint sm:flex">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-ok/50" /> added or corrected</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-danger/50" /> stripped</span>
            </span>
          </>
        )}
      </div>
      <div className="min-w-max py-2 font-mono" style={{ fontSize, lineHeight: Math.round(fontSize * 1.85) + "px" }}>
        {rows.map((row, idx) =>
          "line" in row ? (
            <DiffRow key={idx} line={row.line} />
          ) : open.has(row.fold) ? (
            row.hidden.map((line, k) => <DiffRow key={idx + "-" + k} line={line} />)
          ) : (
            <button
              key={idx}
              type="button"
              onClick={() => setOpen((prev) => new Set(prev).add(row.fold))}
              className="press press-soft my-0.5 flex w-full items-center gap-2 bg-surface-2/70 px-3 py-0.5 text-left text-[11px] text-faint hover:bg-surface-2 hover:text-muted"
            >
              <ChevronsUpDown size={12} />
              {row.hidden.length} unchanged lines
            </button>
          ),
        )}
      </div>
    </div>
  );
}

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Code2 }> = [
  { id: "code", label: "Clean LaTeX", icon: Code2 },
  { id: "preview", label: "Live Preview", icon: Eye },
  { id: "diff", label: "Diff", icon: GitCompareArrows },
  { id: "graph", label: "Graph", icon: Network },
];

export default function MathOutput({
  output,
  input,
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
  syncScroll,
  onToggleSync,
  scrollerRef,
  studio,
}: Props) {
  const idx = Math.max(0, OUTPUT_TABS.indexOf(tab));

  return (
    // flex-1: this pane sits in a flex column next to the action bar, so unlike
    // MathInput it has to be told to fill the row.
    <section className="themed flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        {/* One highlight that slides between equal-width tabs. */}
        <div role="tablist" aria-label="Output view" className="relative grid grid-cols-4">
          <span
            aria-hidden
            className="spring absolute inset-y-0 left-0 rounded-lg bg-surface-2"
            style={{ width: "calc(100% / " + TABS.length + ")", transform: "translateX(" + idx * 100 + "%)" }}
          />
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              title={label + " (Alt+P cycles)"}
              onClick={() => onTab(id)}
              className={
                "press press-soft relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors " +
                (tab === id ? "text-text" : "text-faint hover:text-muted")
              }
            >
              <Icon size={13} strokeWidth={2.5} />
              <span className="hidden items-center gap-1 sm:flex">
                {id === "code" ? (
                  <>
                    Clean <BrandMark mark="latex" height="0.95em" />
                  </>
                ) : (
                  label
                )}
              </span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          {tab === "preview" && <MathColorPicker />}
          {tab === "code" && (
            <IconButton icon={WrapText} label="Word wrap" title="Word wrap (Alt+W)" active={wrap} onClick={onToggleWrap} />
          )}
          <IconButton
            icon={ArrowDownUp}
            label="Sync scroll"
            title="Scroll this pane along with the editor"
            active={syncScroll}
            onClick={onToggleSync}
          />
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

      {/* Keyed on the tab, so each switch fades the new view in rather than
          swapping it abruptly. */}
      <div key={tab} className="min-h-0 flex-1 animate-fade-in">
        {tab === "graph" ? (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-faint">
                <Loader2 className="animate-spin" />
              </div>
            }
          >
            <FormulaGraph {...studio} />
          </Suspense>
        ) : output || tab === "diff" ? (
          tab === "code" ? (
            <CodeView output={output} fontSize={fontSize} wrap={wrap} scrollerRef={scrollerRef} />
          ) : tab === "preview" ? (
            <PreviewView output={output} fontSize={fontSize} scrollerRef={scrollerRef} />
          ) : (
            <DiffView input={input} output={output} fontSize={fontSize} scrollerRef={scrollerRef} />
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
