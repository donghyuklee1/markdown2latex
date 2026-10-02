"use client";

import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { outputHighlight } from "./selection/outputHighlight";
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
import { documentParts } from "@/lib/texDocument";
import type { OutputTab } from "@/lib/persistedStore";
import BrandMark from "./BrandMark";
import MathColorPicker from "./MathColorPicker";
import PaperPreview from "./PaperPreview";
import type { StudioContext } from "./studio/types";

const DerivationView = lazy(() => import("./derivation/DerivationView"));
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
  // The selection toolbar's "show in output": tint those lines, bring them into view.
  const hl = useSyncExternalStore(outputHighlight.subscribe, outputHighlight.get, outputHighlight.getServer);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hl) return;
    box.current?.querySelector<HTMLElement>('[data-line="' + (hl.from - 1) + '"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = window.setTimeout(() => outputHighlight.clear(), 2600);
    return () => window.clearTimeout(t);
  }, [hl]);

  return (
    <div ref={scrollerRef} className="scroll-slim h-full overflow-auto">
      <div
        ref={box}
        data-output-code
        className={"py-3 font-mono " + (wrap ? "" : "min-w-max")}
        style={{ fontSize, lineHeight: Math.round(fontSize * 1.85) + "px" }}
      >
        {lines.map((line, idx) => (
          <div
            key={idx}
            data-line={idx}
            className={"group flex transition-colors duration-500 hover:bg-surface-2 " + (hl && idx + 1 >= hl.from && idx + 1 <= hl.to ? "bg-accent/15" : "")}
          >
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

function PreviewView({ output, fontSize, scrollerRef, studio }: { output: string; fontSize: number; scrollerRef: Scroller; studio: StudioContext }) {
  // A whole .tex document is typeset as a paper, Overleaf-style.
  const doc = useMemo(() => documentParts(output), [output]);
  if (doc) {
    return (
      <PaperPreview
        body={output.slice(doc.bodyStart, doc.bodyEnd)}
        full={output}
        fontSize={fontSize}
        scrollerRef={scrollerRef}
        onSource={(src) => {
          // Find the block's first line in the editor's text and select it there.
          const first = src.split("\n").map((l) => l.trim()).find((l) => l.length > 3) ?? "";
          const at = first ? studio.input.indexOf(first.slice(0, 80)) : -1;
          if (at < 0) return;
          const line = studio.input.slice(0, at).split("\n").length;
          studio.selectLines(line, line + Math.max(0, src.trim().split("\n").length - 1));
        }}
      />
    );
  }
  return <MarkdownPreview output={output} fontSize={fontSize} scrollerRef={scrollerRef} />;
}

function MarkdownPreview({ output, fontSize, scrollerRef }: { output: string; fontSize: number; scrollerRef: Scroller }) {
  const segments = useMemo(() => segment(output), [output]);

  return (
    <div
      ref={scrollerRef}
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
  { id: "graph", label: "Derivation", icon: Network },
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
  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  // Place the highlight under the active tab. A DOM write, not state: no
  // second render, and it follows label-width changes on resize.
  useLayoutEffect(() => {
    const list = tabsRef.current;
    const pill = indicatorRef.current;
    if (!list || !pill) return;
    const place = () => {
      const active = list.querySelector<HTMLElement>('[data-tab="' + tab + '"]');
      if (!active) return;
      pill.style.width = active.offsetWidth + "px";
      pill.style.transform = "translateX(" + active.offsetLeft + "px)";
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [tab]);

  return (
    // flex-1: this pane sits in a flex column next to the action bar, so unlike
    // MathInput it has to be told to fill the row.
    <section className="themed flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-1.5 py-1.5">
        {/* One highlight that slides between equal-width tabs. */}
        {/* Tabs size to their labels with one even gap; the highlight is measured
            onto the active tab, so it glides to the right width and position. */}
        <div role="tablist" aria-label="Output view" ref={tabsRef} className="relative flex items-center gap-1">
          <span aria-hidden ref={indicatorRef} className="spring absolute inset-y-0 left-0 rounded-lg bg-surface-2" style={{ width: 0 }} />
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-tab={id}
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
            <DerivationView {...studio} />
          </Suspense>
        ) : output || tab === "diff" ? (
          tab === "code" ? (
            <CodeView output={output} fontSize={fontSize} wrap={wrap} scrollerRef={scrollerRef} />
          ) : tab === "preview" ? (
            <PreviewView output={output} fontSize={fontSize} scrollerRef={scrollerRef} studio={studio} />
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
