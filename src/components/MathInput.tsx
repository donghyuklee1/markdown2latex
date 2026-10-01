"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, ClipboardPaste, Eraser, Shuffle } from "lucide-react";
import type { Issue } from "@/lib/cleaner";
import { useToast } from "./Toast";

/** Must match the textarea's `leading-6` (1.5rem) and `pt-3` (0.75rem). */
const LINE_HEIGHT = 24;
const PAD_TOP = 12;

interface Props {
  value: string;
  onChange: (next: string) => void;
  issues: Issue[];
  onLoadExample: () => void;
  nextExampleLabel: string;
}

function FloatingButton({
  label,
  onClick,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  onClick: () => void;
  icon: typeof Eraser;
  tone?: "neutral" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-lg shadow-black/30 backdrop-blur transition-colors " +
        (tone === "danger"
          ? "border-ink-700 bg-ink-800/90 text-slate-400 hover:border-rose-500/40 hover:text-rose-300"
          : "border-ink-700 bg-ink-800/90 text-slate-400 hover:border-ink-600 hover:text-slate-200")
      }
    >
      <Icon size={13} strokeWidth={2.5} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export default function MathInput({ value, onChange, issues, onLoadExample, nextExampleLabel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const toast = useToast();

  const lines = useMemo(() => value.split("\n"), [value]);

  /** line number -> first message reported on it */
  const errorLines = useMemo(() => {
    const map = new Map<number, string>();
    for (const issue of issues) if (!map.has(issue.line)) map.set(issue.line, issue.message);
    return map;
  }, [issues]);

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast("Clipboard is empty", "info");
        return;
      }
      onChange(text);
      toast("Pasted " + text.length.toLocaleString() + " chars");
    } catch {
      // Firefox has no readText for web content, and Safari needs a user gesture
      // it does not consider this to be.
      toast("Browser blocked clipboard read - use Cmd/Ctrl+V", "error");
    } finally {
      ref.current?.focus();
    }
  }, [onChange, toast]);

  const clear = useCallback(() => {
    onChange("");
    ref.current?.focus();
  }, [onChange]);

  /** Select the offending line so the caret lands exactly on the problem. */
  const jumpToLine = useCallback(
    (line: number) => {
      const ta = ref.current;
      if (!ta) return;
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
      ta.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - 72);
      setScrollTop(ta.scrollTop);
    },
    [lines],
  );

  return (
    <section className="flex min-h-[320px] flex-col overflow-hidden rounded-xl border border-ink-800 bg-ink-900/40 lg:min-h-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Paste LLM output</h2>
        <span className="ml-auto font-mono text-[11px] text-slate-600">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* gutter: scroll-synced line numbers, red where the parser complained */}
        <div className="relative w-11 shrink-0 select-none overflow-hidden border-r border-ink-800 bg-ink-950/40">
          <div style={{ transform: "translateY(" + -scrollTop + "px)", paddingTop: PAD_TOP }}>
            {lines.map((_, idx) => {
              const line = idx + 1;
              const message = errorLines.get(line);
              return (
                <div
                  key={line}
                  title={message}
                  onClick={message ? () => jumpToLine(line) : undefined}
                  className={
                    "pr-2 text-right font-mono text-[13px] leading-6 " +
                    (message
                      ? "cursor-pointer bg-rose-500/15 font-bold text-rose-400"
                      : "text-ink-600")
                  }
                >
                  {line}
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          {/* error bands, painted under the transparent textarea */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {[...errorLines.keys()].map((line) => (
              <div
                key={line}
                className="absolute inset-x-0 border-l-2 border-rose-500 bg-rose-500/10"
                style={{ top: PAD_TOP + (line - 1) * LINE_HEIGHT - scrollTop, height: LINE_HEIGHT }}
              />
            ))}
          </div>

          <textarea
            ref={ref}
            value={value}
            autoFocus
            spellCheck={false}
            wrap="off"
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            placeholder="Paste the messy math here. Nothing leaves your browser."
            aria-label="Markdown and LaTeX math input"
            className="scroll-slim absolute inset-0 resize-none bg-transparent px-3 pb-20 pt-3 font-mono text-[13px] leading-6 text-slate-200 caret-accent outline-none placeholder:text-ink-600"
          />

          {/* floating actions, kept clear of the text with a pb-20 on the textarea */}
          <div className="pointer-events-none absolute bottom-3 right-3 flex gap-2">
            <div className="pointer-events-auto flex gap-2">
              <FloatingButton label={nextExampleLabel} onClick={onLoadExample} icon={Shuffle} />
              <FloatingButton label="Paste" onClick={paste} icon={ClipboardPaste} />
              <FloatingButton label="Clear" onClick={clear} icon={Eraser} tone="danger" />
            </div>
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="scroll-slim max-h-28 shrink-0 overflow-y-auto border-t border-rose-500/20 bg-rose-500/[0.06] px-3 py-2">
          {issues.map((issue, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => jumpToLine(issue.line)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs text-rose-200/90 transition-colors hover:bg-rose-500/10"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-rose-400" />
              <span>
                <span className="font-mono font-semibold text-rose-400">Line {issue.line}</span>
                <span className="mx-1.5 text-rose-500/50">|</span>
                {issue.message}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
