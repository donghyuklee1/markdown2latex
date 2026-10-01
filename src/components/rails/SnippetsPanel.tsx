"use client";

import { useState, useSyncExternalStore } from "react";
import { BookmarkPlus, Copy, CornerDownLeft, Trash2 } from "lucide-react";
import { prepareForKatex } from "@/lib/cleaner";
import { BUILTIN_SNIPPETS, snippets, snippetStore, type Snippet } from "@/lib/documents";
import { BlockMath } from "../Katex";
import { writeClipboard } from "../exporters";
import { useToast } from "../Toast";

/**
 * Personal snippet library: save the current selection (or the whole cleaned
 * output) under a name, then insert it anywhere later. A few starter
 * templates ship built in.
 */
export default function SnippetsPanel({
  getSelection,
  output,
  onInsert,
}: {
  /** The editor's current selection, read at click time. */
  getSelection: () => string;
  output: string;
  onInsert: (text: string) => void;
}) {
  const mine = useSyncExternalStore(snippetStore.subscribe, snippetStore.get, snippetStore.getServer);
  const [name, setName] = useState("");
  const toast = useToast();

  const save = (source: "selection" | "output") => {
    const latex = (source === "selection" ? getSelection() : output).trim();
    if (!latex) return toast(source === "selection" ? "Select some text in the editor first" : "Nothing to save yet", "info");
    const s = snippets.add(name || latex.split("\n")[0].slice(0, 40), latex);
    setName("");
    toast("Saved “" + s.name + "”");
  };

  const Card = ({ s }: { s: Snippet }) => (
    <li className="group rounded-lg border border-border bg-bg p-2">
      <div className="mb-1 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text">{s.name}</span>
        <button type="button" title="Insert at cursor" aria-label="Insert at cursor" onMouseDown={(e) => e.preventDefault()} onClick={() => onInsert(s.latex)} className="press rounded p-1 text-faint hover:bg-accent/10 hover:text-accent">
          <CornerDownLeft size={13} />
        </button>
        <button
          type="button"
          title="Copy"
          aria-label="Copy snippet"
          onClick={async () => toast((await writeClipboard(s.latex)) ? "Snippet copied" : "Copy failed", "success")}
          className="press rounded p-1 text-faint hover:bg-surface-2 hover:text-text"
        >
          <Copy size={13} />
        </button>
        {!s.builtin && (
          <button
            type="button"
            title="Delete"
            aria-label="Delete snippet"
            onClick={() => {
              const undo = snippets.remove(s.id);
              toast("Deleted “" + s.name + "”", "info", { label: "Undo", run: undo });
            }}
            className="press rounded p-1 text-faint hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <div className="max-h-24 overflow-hidden text-[12px] text-muted [&_.katex-display]:my-0">
        <BlockMath math={prepareForKatex(s.latex)} renderError={() => <pre className="truncate font-mono text-[11px]">{s.latex}</pre>} />
      </div>
    </li>
  );

  return (
    <div className="space-y-3 p-3">
      <div className="space-y-1.5 rounded-lg border border-dashed border-border-strong p-2.5">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          aria-label="Snippet name"
          className="h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-text outline-none placeholder:text-faint focus:border-accent/60"
        />
        <div className="flex gap-1.5">
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => save("selection")} className="press flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-accent-ink hover:bg-accent/90">
            <BookmarkPlus size={13} /> Save selection
          </button>
          <button type="button" onClick={() => save("output")} className="press flex-1 rounded-md border border-border px-2 py-1.5 text-[11px] font-semibold text-muted hover:text-text">
            Save clean output
          </button>
        </div>
      </div>

      {mine.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-faint">Yours</h3>
          <ul className="space-y-1.5">
            {mine.map((s) => (
              <Card key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-faint">Starters</h3>
        <ul className="space-y-1.5">
          {BUILTIN_SNIPPETS.map((s) => (
            <Card key={s.id} s={s} />
          ))}
        </ul>
      </section>
    </div>
  );
}
