"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileCode2,
  FileDown,
  Image as ImageIcon,
  ImageDown,
  FileText,
  Loader2,
  Pencil,
  NotebookPen,
  Sigma,
} from "lucide-react";
import type { PrimaryAction } from "@/lib/persistedStore";
import BrandMark from "./BrandMark";
import { useKeyLabel } from "./ui";

export type ExportId =
  | "copy"
  | "copyMath"
  | "copyObsidian"
  | "copyPng"
  | "downloadSnippet"
  | "downloadDocument"
  | "downloadPng";

interface Props {
  disabled: boolean;
  copied: boolean;
  charCount: number;
  snippetName: string;
  /** The document's file name without extension, and how to rename it. */
  fileBase: string;
  fileExt: string;
  onRename: (name: string) => void;
  primaryAction: PrimaryAction;
  /** Overleaf is opening: spinner on its button. */
  overleafBusy: boolean;
  onExport: (id: ExportId) => void;
  onOverleaf: () => void;
}

const MENU: ReadonlyArray<
  { id: ExportId; label: (snippet: string) => string; hint: string; icon: typeof Copy; keys?: string } | "sep"
> = [
  { id: "copy", label: () => "Copy clean LaTeX", hint: "Exactly what the code tab shows", icon: Copy, keys: "Mod+Enter" },
  { id: "copyMath", label: () => "Copy maths only", hint: "Just the equations, no surrounding prose", icon: Sigma, keys: "Mod+Shift+C" },
  { id: "copyObsidian", label: () => "Copy for Obsidian / Notion", hint: "$ / $$ everywhere, environments kept inside $$", icon: NotebookPen },
  { id: "copyPng", label: () => "Copy as PNG image", hint: "The live preview, rendered", icon: ImageIcon },
  "sep",
  { id: "downloadSnippet", label: (s) => "Download " + s, hint: "The clean output as a file", icon: FileDown, keys: "Mod+S" },
  { id: "downloadDocument", label: () => "Download full .tex document", hint: "Preamble included - compiles on its own", icon: FileCode2 },
  { id: "downloadPng", label: () => "Download PNG image", hint: "The live preview, rendered", icon: ImageDown },
];

/**
 * The document's file name, edited in place. It is the same name as the tab,
 * and every save path uses it: downloads, the PNG, and the Overleaf project.
 */
function FileNameChip({ base, ext, onRename }: { base: string; ext: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <label className="flex h-[46px] min-w-0 shrink items-center gap-1 rounded-xl border border-accent/60 bg-surface px-2.5 shadow-sm ring-2 ring-accent/15">
        <FileText size={15} className="shrink-0 text-accent" />
        <input
          autoFocus
          defaultValue={base === "clean-math" ? "" : base}
          placeholder="clean-math"
          aria-label="File name"
          onFocus={(e) => e.currentTarget.select()}
          onBlur={(e) => {
            onRename(e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-32 min-w-0 bg-transparent font-mono text-xs text-text outline-none placeholder:text-faint sm:w-40"
        />
        <span className="font-mono text-xs text-faint">{ext}</span>
      </label>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Rename - used for downloads, the image, the Overleaf project and the tab"
      className="press press-soft group flex h-[46px] min-w-0 max-w-[13rem] shrink items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 text-xs text-muted hover:border-border-strong hover:text-text"
    >
      <FileText size={15} className="shrink-0 text-faint group-hover:text-accent" />
      <span className="truncate font-mono">
        {base}
        <span className="text-faint">{ext}</span>
      </span>
      <Pencil size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-70" />
    </button>
  );
}

/**
 * Copy is the action that matters, so it stays one big button; every other
 * format hangs off the chevron beside it. Open in Overleaf sits next to them.
 */
export default function ActionBar({
  disabled,
  copied,
  charCount,
  snippetName,
  fileBase,
  fileExt,
  onRename,
  primaryAction,
  overleafBusy,
  onExport,
  onOverleaf,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const keyLabel = useKeyLabel();

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

  const primaryKbd = (
    <kbd className="ml-1 hidden rounded-md bg-black/10 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide sm:inline">
      {keyLabel("Mod+Enter")}
    </kbd>
  );

  return (
    <div className="flex gap-2" ref={ref}>
      <FileNameChip base={fileBase} ext={fileExt} onRename={onRename} />
      <div className="relative flex min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onExport("copy")}
          disabled={disabled}
          className={
            "press press-soft group flex min-w-0 flex-1 items-center justify-center gap-2.5 rounded-l-xl bg-accent px-4 py-3 text-sm font-semibold text-accent-ink " +
            "enabled:shadow-lg enabled:shadow-accent/25 enabled:hover:bg-accent/90 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-faint"
          }
        >
          {copied ? <Check size={17} strokeWidth={3} /> : <Copy size={16} strokeWidth={2.5} />}
          <span className="flex min-w-0 items-center gap-1.5 truncate">
            {copied ? (
              "Copied to clipboard"
            ) : (
              <>
                Copy Clean <BrandMark mark="latex" height="1.05em" className="translate-y-[0.06em]" />
              </>
            )}
          </span>
          {!disabled && primaryAction === "copy" && primaryKbd}
          {charCount > 0 && (
            <span className="ml-auto hidden font-mono text-[11px] font-medium opacity-60 xl:inline">
              {charCount.toLocaleString()} chars
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="More copy and export formats"
          title="More formats"
          className="press flex items-center rounded-r-xl border-l border-black/15 bg-accent px-2.5 text-accent-ink enabled:shadow-lg enabled:shadow-accent/25 enabled:hover:bg-accent/90 disabled:bg-surface-2 disabled:text-faint"
        >
          <ChevronDown size={16} strokeWidth={2.5} className={"spring " + (open ? "rotate-180" : "")} />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute bottom-full left-0 right-0 z-30 mb-2 animate-pop-in rounded-xl border border-border bg-surface p-1.5 shadow-xl shadow-black/15 sm:left-auto sm:w-80"
          >
            {MENU.map((item, i) =>
              item === "sep" ? (
                <div key={"sep" + i} className="my-1 h-px bg-border" />
              ) : (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    onExport(item.id);
                  }}
                  className="press press-soft flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-surface-2"
                >
                  <item.icon size={15} strokeWidth={2.25} className="shrink-0 text-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-text">{item.label(snippetName)}</span>
                    <span className="block truncate text-[11px] text-faint">{item.hint}</span>
                  </span>
                  {item.keys && <span className="font-mono text-[10px] text-faint">{keyLabel(item.keys)}</span>}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onOverleaf}
        disabled={disabled || overleafBusy}
        title="Open as a new Overleaf project, preamble included (Alt+O). This sends the document to Overleaf."
        aria-label="Open in Overleaf"
        className="press press-soft group flex shrink-0 items-center gap-2 rounded-xl border border-overleaf/40 bg-overleaf/10 px-3.5 text-sm font-semibold text-overleaf enabled:hover:border-overleaf enabled:hover:bg-overleaf enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {overleafBusy ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={15} strokeWidth={2.25} className="opacity-70" />}
        <span className="hidden items-center gap-1.5 whitespace-nowrap sm:flex">
          {overleafBusy ? "Opening…" : "Open in"}
          <BrandMark mark="overleaf" height="1.15em" />
        </span>
        <BrandMark mark="overleaf" height="1.1em" className="sm:hidden" />
        {!disabled && !overleafBusy && primaryAction === "overleaf" && primaryKbd}
      </button>
    </div>
  );
}
