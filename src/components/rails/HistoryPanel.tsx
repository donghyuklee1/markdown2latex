"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Copy, FilePlus2, History, RotateCcw, Search } from "lucide-react";
import { historyStore, type Snapshot } from "@/lib/documents";
import { writeClipboard } from "../exporters";
import { useToast } from "../Toast";

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + " h ago";
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const REASON: Record<Snapshot["reason"], string> = { idle: "edit", copy: "copied", replace: "before replace" };

/**
 * Every draft is snapshotted after a pause in typing, on copy, and just before
 * it is replaced - so "I pasted over the good version" is always one click
 * from undone, even after a reload.
 */
export default function HistoryPanel({
  onRestore,
  onOpenAsNew,
}: {
  onRestore: (text: string) => void;
  onOpenAsNew: (text: string, title: string) => void;
}) {
  const list = useSyncExternalStore(historyStore.subscribe, historyStore.get, historyStore.getServer);
  const [query, setQuery] = useState("");
  const toast = useToast();
  // Relative times are computed once per open; the panel is short-lived.
  const [now] = useState(() => Date.now());

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((s) => s.text.toLowerCase().includes(q) || s.docTitle.toLowerCase().includes(q)) : list;
  }, [list, query]);

  if (!list.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <History size={22} className="text-faint" />
        <p className="text-xs leading-relaxed text-faint">
          Snapshots appear here as you work: after a pause in typing, when you copy, and before anything replaces your
          draft. They stay in this browser only.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3">
      <label className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5">
        <Search size={13} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search snapshots"
          aria-label="Search history"
          className="h-8 w-full bg-transparent text-xs text-text outline-none placeholder:text-faint"
        />
      </label>
      <ol className="relative space-y-1.5 border-l border-border pl-3">
        {shown.map((s) => (
          <li key={s.id} className="group relative rounded-lg border border-border bg-bg p-2 hover:border-border-strong">
            <span className="absolute -left-[17px] top-3 h-2 w-2 rounded-full border-2 border-surface bg-accent/70" />
            <div className="flex items-baseline gap-1.5 text-[11px]">
              <span className="truncate font-semibold text-text">{s.docTitle}</span>
              <span className="shrink-0 text-faint">· {ago(s.at, now)}</span>
              <span className="ml-auto shrink-0 rounded bg-surface-2 px-1 text-[10px] text-faint">{REASON[s.reason]}</span>
            </div>
            <pre className="mt-1 line-clamp-3 whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-muted">{s.text.slice(0, 240)}</pre>
            <div className="mt-1.5 flex items-center gap-1">
              <button type="button" onClick={() => onRestore(s.text)} className="press flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[11px] font-semibold text-accent hover:bg-accent/20">
                <RotateCcw size={11} /> Restore
              </button>
              <button type="button" onClick={() => onOpenAsNew(s.text, s.docTitle)} className="press flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-faint hover:bg-surface-2 hover:text-text">
                <FilePlus2 size={11} /> New tab
              </button>
              <button
                type="button"
                aria-label="Copy snapshot"
                title="Copy"
                onClick={async () => toast((await writeClipboard(s.text)) ? "Snapshot copied" : "Copy failed", "success")}
                className="press ml-auto rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text"
              >
                <Copy size={12} />
              </button>
              <span className="font-mono text-[10px] text-faint">{s.text.length.toLocaleString()}c</span>
            </div>
          </li>
        ))}
      </ol>
      <button
        type="button"
        onClick={() => {
          const before = historyStore.get();
          historyStore.set([]);
          toast("History cleared", "info", { label: "Undo", run: () => historyStore.set(before) });
        }}
        className="press w-full rounded-md py-1.5 text-[11px] font-medium text-faint hover:bg-danger/10 hover:text-danger"
      >
        Clear history
      </button>
    </div>
  );
}
