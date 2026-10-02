"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ScrollText, X } from "lucide-react";
import { CHANGELOG } from "@/lib/changelog";

/* --------------------------------------------- open from anywhere */

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  for (const l of listeners) l();
};
export const openPatchNotes = () => setOpen(true);
const store = {
  get: () => open,
  getServer: () => false,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const fmt = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** What changed in each version (lib/changelog.ts), newest first. */
export default function PatchNotes() {
  const isOpen = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="Patch notes" className="themed ob-card flex max-h-[85vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-5 py-3.5">
          <ScrollText size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">Patch notes</h2>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="press ml-auto rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
            <X size={15} />
          </button>
        </div>
        <ol className="scroll-slim min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {CHANGELOG.map((r, i) => (
            <li key={r.version}>
              <div className="flex items-baseline gap-2">
                <span className={"rounded-md px-1.5 py-0.5 font-mono text-[11px] font-semibold " + (i === 0 ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}>v{r.version}</span>
                <span className="text-sm font-semibold text-text">{r.title}</span>
                <span className="ml-auto shrink-0 text-[11px] text-faint">{fmt(r.date)}</span>
              </div>
              <ul className="mt-1.5 space-y-1 pl-1 text-[12.5px] leading-snug text-muted">
                {r.notes.map((n) => (
                  <li key={n} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-border-strong" />
                    {n}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
