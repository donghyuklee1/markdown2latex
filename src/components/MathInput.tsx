"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  HeartPulse,
  ChevronUp,
  ClipboardPaste,
  Eraser,
  FileUp,
  Maximize2,
  Minimize2,
  Sparkles,
  WandSparkles,
  WrapText,
} from "lucide-react";
import type { Issue } from "@/lib/cleaner";
import type { Diagnostic } from "@/lib/diagnostics";
import { EXAMPLES } from "@/lib/defaultText";
import { useToast } from "./Toast";
import { IconButton } from "./ui";

/** Must match the textarea's `pt-3` (0.75rem). */
const PAD_TOP = 12;
/** Anything bigger is almost certainly not a chat answer, and would make every keystroke slow. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ACCEPT = ".md,.markdown,.mdx,.tex,.latex,.txt,text/plain,text/markdown,text/x-tex";

interface Props {
  value: string;
  onChange: (next: string) => void;
  issues: Issue[];
  /** KaTeX failures, mapped to input lines. */
  diagnostics: Diagnostic[];
  /** Scroll position as 0..1, for syncing the output pane. */
  onScrollRatio: (ratio: number) => void;
  fontSize: number;
  wrap: boolean;
  onToggleWrap: () => void;
  maximized: boolean;
  onToggleMaximize: () => void;
  onPickExample: (idx: number) => void;
  /** Replace the whole input from somewhere else (file, clipboard), with undo. */
  onReplace: (text: string, source: string) => void;
  onClear: () => void;
  onCleanClipboard: () => void;
}

function FloatingButton({
  label,
  onClick,
  icon: Icon,
  tone = "neutral",
  title,
  ...rest
}: {
  label: string;
  onClick: () => void;
  icon: typeof Eraser;
  tone?: "neutral" | "danger" | "accent";
  title?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? label}
      aria-label={label}
      className={
        "press flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-lg shadow-black/10 backdrop-blur " +
        (tone === "danger"
          ? "border-border bg-surface/95 text-muted hover:border-danger/40 hover:text-danger"
          : tone === "accent"
            ? "border-accent/40 bg-surface/95 text-accent hover:border-accent hover:bg-accent hover:text-accent-ink"
            : "border-border bg-surface/95 text-muted hover:border-border-strong hover:text-text")
      }
      {...rest}
    >
      <Icon size={13} strokeWidth={2.5} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Upward-opening menu of the bundled samples, so any one is a click away. */
function ExamplesMenu({ onPick }: { onPick: (idx: number) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <FloatingButton
        label="Examples"
        icon={open ? ChevronUp : Sparkles}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      />
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-30 mb-2 w-72 animate-pop-in rounded-xl border border-border bg-surface p-1.5 shadow-xl shadow-black/15"
        >
          {EXAMPLES.map((ex, i) => (
            <button
              key={ex.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(i);
                setOpen(false);
              }}
              className="press press-soft block w-full rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
            >
              <span className="block text-xs font-semibold text-text">{ex.label}</span>
              <span className="block text-[11px] leading-snug text-faint">{ex.blurb}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Tab and Shift+Tab indent and outdent, on the caret or across every selected
 * line. Edits go through execCommand("insertText") so the browser's own undo
 * stack (Cmd/Ctrl+Z) still covers them.
 */
function handleIndent(e: React.KeyboardEvent<HTMLTextAreaElement>, onChange: (v: string) => void): void {
  const ta = e.currentTarget;
  const { selectionStart: start, selectionEnd: end, value } = ta;
  const insert = (text: string, from: number, to: number) => {
    ta.setSelectionRange(from, to);
    if (!document.execCommand("insertText", false, text)) {
      onChange(value.slice(0, from) + text + value.slice(to)); // no execCommand: lose undo, keep the edit
    }
  };

  if (!e.shiftKey && start === end) {
    insert("  ", start, end);
    return;
  }
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const lines = value.slice(lineStart, end).split("\n");
  const next = lines.map((l) => (e.shiftKey ? l.replace(/^(?: {1,2}|\t)/, "") : "  " + l)).join("\n");
  insert(next, lineStart, end);
  ta.setSelectionRange(lineStart, lineStart + next.length);
}

export default function MathInput({
  value,
  onChange,
  issues,
  diagnostics,
  onScrollRatio,
  fontSize,
  wrap,
  onToggleWrap,
  maximized,
  onToggleMaximize,
  onPickExample,
  onReplace,
  onClear,
  onCleanClipboard,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [dragging, setDragging] = useState(false);
  const toast = useToast();

  const lineHeight = Math.round(fontSize * 1.85);
  const lines = useMemo(() => value.split("\n"), [value]);

  /** Everything wrong, delimiter problems first, in line order. */
  const problems = useMemo(
    () =>
      [
        ...issues.map((i) => ({ line: i.line, kind: "Delimiter", message: i.message })),
        ...diagnostics.map((d) => ({ line: d.line, kind: "KaTeX Error", message: d.message })),
      ].sort((a, b) => a.line - b.line),
    [issues, diagnostics],
  );

  /** line number -> first message reported on it */
  const errorLines = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of problems) if (!map.has(p.line)) map.set(p.line, p.kind + ": " + p.message);
    return map;
  }, [problems]);

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast("Clipboard is empty", "info");
        return;
      }
      onReplace(text, "Pasted " + text.length.toLocaleString() + " chars");
    } catch {
      // Firefox has no readText for web content, and Safari needs a user gesture
      // it does not consider this to be.
      toast("Browser blocked clipboard read - use Cmd/Ctrl+V", "error");
    } finally {
      ref.current?.focus();
    }
  }, [onReplace, toast]);

  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        toast(file.name + " is over 2 MB - too large to clean live", "error");
        return;
      }
      try {
        onReplace(await file.text(), "Opened " + file.name);
      } catch {
        toast("Could not read " + file.name, "error");
      }
    },
    [onReplace, toast],
  );

  /** Select the offending line so the caret lands exactly on the problem. */
  const jumpToLine = useCallback(
    (line: number) => {
      const ta = ref.current;
      if (!ta) return;
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
      if (!wrap) {
        ta.scrollTop = Math.max(0, (line - 1) * lineHeight - 72);
        setScrollTop(ta.scrollTop);
      }
    },
    [lines, lineHeight, wrap],
  );

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <section
      className="themed relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
      onDragEnter={(e) => {
        if (hasFiles(e)) setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
        void openFile(e.dataTransfer.files[0]);
      }}
    >
      <div className="flex shrink-0 items-center gap-1 border-b border-border py-1.5 pl-3 pr-1.5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">Paste LLM output</h2>
        <span className="ml-auto mr-1 hidden font-mono text-[11px] text-faint sm:inline">
          {lines.length} {lines.length === 1 ? "line" : "lines"} · {value.length.toLocaleString()} chars
        </span>
        <IconButton icon={WrapText} label="Word wrap" title="Word wrap (Alt+W)" active={wrap} onClick={onToggleWrap} />
        <IconButton
          icon={maximized ? Minimize2 : Maximize2}
          label={maximized ? "Restore both panes" : "Maximise the input"}
          title={(maximized ? "Restore both panes" : "Maximise the input") + " (Alt+[)"}
          active={maximized}
          onClick={onToggleMaximize}
        />
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* gutter: scroll-synced line numbers, red where the parser complained.
            With word wrap on, a logical line spans several visual ones, so the
            gutter would lie - it steps aside and the issue list below remains. */}
        {!wrap && (
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
                    style={{ fontSize: fontSize, lineHeight: lineHeight + "px" }}
                    className={
                      "pr-2 text-right font-mono " +
                      (message ? "cursor-pointer bg-danger/15 font-bold text-danger" : "text-faint")
                    }
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="relative min-w-0 flex-1">
          {/* error bands, painted under the transparent textarea */}
          {!wrap && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              {[...errorLines.keys()].map((line) => (
                <div
                  key={line}
                  className="absolute inset-x-0 border-l-2 border-danger bg-danger/10"
                  style={{ top: PAD_TOP + (line - 1) * lineHeight - scrollTop, height: lineHeight }}
                />
              ))}
            </div>
          )}

          <textarea
            ref={ref}
            value={value}
            autoFocus
            spellCheck={false}
            wrap={wrap ? "soft" : "off"}
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => {
              const ta = e.currentTarget;
              setScrollTop(ta.scrollTop);
              const room = ta.scrollHeight - ta.clientHeight;
              onScrollRatio(room > 0 ? ta.scrollTop / room : 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.currentTarget.blur();
              } else if (e.key === "Tab" && !e.altKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                handleIndent(e, onChange);
              }
            }}
            placeholder="Paste the messy math here, or drop a .md / .tex file."
            aria-label="Markdown and LaTeX math input"
            style={{ fontSize, lineHeight: lineHeight + "px" }}
            className="scroll-slim absolute inset-0 resize-none bg-transparent px-3 pb-20 pt-3 font-mono text-text caret-accent outline-none placeholder:text-faint focus-visible:ring-0 focus-visible:ring-offset-0"
          />

          {/* floating actions, kept clear of the text with a pb-20 on the textarea */}
          <div className="pointer-events-none absolute bottom-3 right-3 flex gap-2">
            <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
              <ExamplesMenu onPick={onPickExample} />
              <FloatingButton label="Open" icon={FileUp} onClick={() => fileRef.current?.click()} title="Open a .md, .tex or .txt file" />
              <FloatingButton label="Paste" icon={ClipboardPaste} onClick={paste} />
              <FloatingButton
                label="Clean clipboard"
                icon={WandSparkles}
                tone="accent"
                onClick={onCleanClipboard}
                title="Paste, clean and copy back in one go (Alt+V)"
              />
              <FloatingButton label="Clear" onClick={onClear} icon={Eraser} tone="danger" />
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              void openFile(e.target.files?.[0]);
              e.target.value = ""; // allow re-opening the same file
            }}
          />
        </div>

        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex animate-pop-in items-center justify-center rounded-lg border-2 border-dashed border-accent bg-surface/90 text-sm font-semibold text-accent">
            <FileUp size={18} className="mr-2" />
            Drop to open
          </div>
        )}
      </div>

      {/* Syntax health: delimiter problems and KaTeX errors together. The
          wrapper eases its height open and shut, so nothing jumps. */}
      <div className="expand shrink-0" data-open={problems.length > 0} aria-live="polite">
        <div>
          <div className="border-t border-danger/25 bg-danger/[0.07]">
            <div className="flex items-center gap-1.5 px-3 pt-2 text-[11px] font-semibold uppercase tracking-wider text-danger">
              <HeartPulse size={13} />
              Syntax health
              <span className="font-mono normal-case tracking-normal text-danger/70">
                {problems.length} {problems.length === 1 ? "problem" : "problems"}
              </span>
            </div>
            <div className="scroll-slim max-h-28 overflow-y-auto px-2 pb-2 pt-1">
              {problems.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => jumpToLine(p.line)}
                  title="Jump to the line"
                  className="press press-soft flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-xs text-danger hover:bg-danger/10"
                >
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="font-mono font-semibold">Line {p.line}</span>
                    <span className="mx-1.5 text-danger/50">|</span>
                    <span className="font-semibold">{p.kind}</span>
                    <span className="mx-1.5 text-danger/50">-</span>
                    {p.message}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
