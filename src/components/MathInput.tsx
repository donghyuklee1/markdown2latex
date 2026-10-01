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
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-lg shadow-black/10 backdrop-blur transition-colors " +
        (tone === "danger"
          ? "border-border bg-surface text-muted hover:border-danger/40 hover:text-danger"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-text")
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
    <section className="themed flex min-h-[320px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface lg:min-h-0">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Paste LLM output</h2>
        <span className="ml-auto font-mono text-[11px] text-faint">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* gutter: scroll-synced line numbers, red where the parser complained */}
        <div className="relative w-11 shrink-0 select-none overflow-hidden border-r border-border bg-surface-2">
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
                      ? "cursor-pointer bg-danger/15 font-bold text-danger"
                      : "text-faint")
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
                className="absolute inset-x-0 border-l-2 border-danger bg-danger/10"
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
            className="scroll-slim absolute inset-0 resize-none bg-transparent px-3 pb-20 pt-3 font-mono text-[13px] leading-6 text-text caret-accent outline-none placeholder:text-faint"
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
        <div className="scroll-slim max-h-28 shrink-0 overflow-y-auto border-t border-danger/25 bg-danger/[0.07] px-3 py-2">
          {issues.map((issue, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => jumpToLine(issue.line)}
              className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs text-danger transition-colors hover:bg-danger/10"
            >
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
              <span>
                <span className="font-mono font-semibold text-danger">Line {issue.line}</span>
                <span className="mx-1.5 text-danger/50">|</span>
                {issue.message}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
