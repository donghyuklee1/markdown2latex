"use client";

import { useState, useSyncExternalStore } from "react";
import { CloudCheck, FileText, Plus, X } from "lucide-react";
import { docs, docsStore, docTitle, MAX_DOCS } from "@/lib/documents";
import { useToast } from "../Toast";

/**
 * Document tabs in the strip under the header: several drafts open at once,
 * each autosaved. Double-click renames, drag reorders, middle-click closes,
 * and every close can be undone.
 */
export default function DocTabs() {
  const state = useSyncExternalStore(docsStore.subscribe, docsStore.get, docsStore.getServer);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const toast = useToast();

  const close = (id: string, title: string) => {
    const undo = docs.close(id);
    toast("Closed “" + title + "”", "info", { label: "Undo", run: undo });
  };

  const add = () => {
    if (docs.create() === null) toast("Up to " + MAX_DOCS + " tabs - close one first", "info");
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      <div role="tablist" aria-label="Documents" className="scroll-slim flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5">
        {state.docs.map((d, i) => {
          const active = d.id === state.active;
          const title = docTitle(d, i + 1);
          return (
            <div
              key={d.id}
              role="tab"
              aria-selected={active}
              tabIndex={0}
              draggable={renaming !== d.id}
              onDragStart={(e) => {
                setDragId(d.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (dragId && dragId !== d.id) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) docs.move(dragId, i);
                setDragId(null);
              }}
              onDragEnd={() => setDragId(null)}
              onClick={() => docs.open(d.id)}
              onDoubleClick={() => setRenaming(d.id)}
              onAuxClick={(e) => {
                if (e.button === 1) close(d.id, title);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") docs.open(d.id);
                if (e.key === "F2") setRenaming(d.id);
              }}
              title={title + " - double-click to rename"}
              className={
                "press press-soft group flex h-8 max-w-[13rem] shrink-0 cursor-default items-center gap-1.5 rounded-lg border pl-2.5 pr-1 text-xs " +
                (active
                  ? "border-border bg-surface font-semibold text-text shadow-sm"
                  : "border-transparent text-faint hover:bg-surface hover:text-muted") +
                (dragId === d.id ? " opacity-40" : "")
              }
            >
              <FileText size={12} className={"shrink-0 " + (active ? "text-accent" : "")} />
              {renaming === d.id ? (
                <input
                  autoFocus
                  defaultValue={d.title || title}
                  aria-label="Tab name"
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => {
                    docs.rename(d.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  className="w-28 rounded bg-bg px-1 font-semibold text-text outline-none ring-1 ring-accent/50"
                />
              ) : (
                <span className="truncate">{title}</span>
              )}
              <button
                type="button"
                aria-label={"Close " + title}
                onClick={(e) => {
                  e.stopPropagation();
                  close(d.id, title);
                }}
                className={
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint transition-opacity hover:bg-surface-2 hover:text-text " +
                  (active ? "opacity-70" : "opacity-0 group-hover:opacity-70")
                }
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={add}
        aria-label="New document"
        title="New document (Alt+N)"
        className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-faint hover:bg-surface hover:text-text"
      >
        <Plus size={15} />
      </button>
      <span className="ml-auto hidden shrink-0 items-center gap-1 text-[11px] text-faint md:flex" title="Drafts, tabs and history are saved in this browser">
        <CloudCheck size={13} className="text-ok" /> Saved locally
      </span>
    </div>
  );
}
