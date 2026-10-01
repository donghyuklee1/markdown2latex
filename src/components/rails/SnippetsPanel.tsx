"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { BookmarkPlus, Copy, CornerDownLeft, Search, Trash2 } from "lucide-react";
import { prepareForKatex } from "@/lib/cleaner";
import { snippets, snippetStore, type Snippet } from "@/lib/documents";
import { STARTER_CATEGORIES, STARTER_COUNT } from "@/lib/starters";
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
  const [category, setCategory] = useState(STARTER_CATEGORIES[0].id);
  const [query, setQuery] = useState("");
  const toast = useToast();

  // Search spans every category; otherwise only the chosen one is rendered,
  // so the panel stays light with a couple of hundred formulas behind it.
  const shownStarters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return (STARTER_CATEGORIES.find((c) => c.id === category) ?? STARTER_CATEGORIES[0]).items.map((s) => ({ ...s, builtin: true }));
    return STARTER_CATEGORIES.flatMap((c) =>
      c.items
        .filter((s) => s.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q) || s.latex.toLowerCase().includes(q))
        .map((s) => ({ ...s, builtin: true, name: s.name + "  \u00b7  " + c.label })),
    ).slice(0, 40);
  }, [category, query]);
  const shownMine = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? mine.filter((s) => s.name.toLowerCase().includes(q) || s.latex.toLowerCase().includes(q)) : mine;
  }, [mine, query]);

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

      <label className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5">
        <Search size={13} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={"Search " + STARTER_COUNT + " starters and yours"}
          aria-label="Search snippets"
          className="h-8 w-full bg-transparent text-xs text-text outline-none placeholder:text-faint"
        />
      </label>

      {shownMine.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-faint">Yours</h3>
          <ul className="space-y-1.5">
            {shownMine.map((s) => (
              <Card key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-faint">
          Starters {query && <span className="normal-case tracking-normal">- {shownStarters.length} matches</span>}
        </h3>
        {!query && (
          <div className="mb-2 flex flex-wrap gap-1">
            {STARTER_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={
                  "press-soft rounded-md px-2 py-1 text-[11px] font-semibold transition-colors duration-200 " +
                  (c.id === category ? "bg-accent/10 text-accent" : "text-faint hover:bg-surface-2 hover:text-muted")
                }
              >
                {c.label}
                <span className="ml-1 font-mono text-[9px] opacity-60">{c.items.length}</span>
              </button>
            ))}
          </div>
        )}
        <ul key={query ? "q" : category} className="animate-fade-in space-y-1.5">
          {shownStarters.map((s) => (
            <Card key={s.id} s={s} />
          ))}
        </ul>
        {query && !shownStarters.length && <p className="py-4 text-center text-xs text-faint">No starter matches.</p>}
      </section>
    </div>
  );
}
