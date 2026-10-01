"use client";

/**
 * kit.tsx - the building blocks every Research Lab tool is made of, so nine
 * tools read as one product: same panes, same buttons, same feedback.
 *
 * Tool panels should compose these rather than style their own controls.
 */
import { useCallback, useRef, useState } from "react";
import { ClipboardPaste, Copy, Download, Eraser, FileUp, Loader2, type LucideIcon } from "lucide-react";
import { highlightLine } from "@/lib/highlight";
import { readUploads, type ArchiveFile } from "@/lib/lab/archive";
import { downloadBlob, downloadText, writeClipboard } from "../exporters";
import { useToast } from "../Toast";

/* ------------------------------------------------------------------ layout */

/** Page frame for one tool: title, the pain point it solves, then the tool. */
export function ToolFrame({
  title,
  slug,
  pain,
  children,
}: {
  title: string;
  slug: string;
  /** One sentence: the problem this tool removes. */
  pain: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-text">{title}</h2>
        <code className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-faint">{slug}</code>
        <p className="w-full text-[13px] leading-snug text-muted">{pain}</p>
      </div>
      {children}
    </div>
  );
}

/** Two panes side by side on wide screens, stacked on narrow ones. */
export function TwoPane({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">{children}</div>;
}

/** A bordered card with a small header row. */
export function Pane({
  label,
  right,
  children,
  className = "",
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={"themed flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface " + className}>
      <div className="flex min-h-[41px] shrink-0 items-center gap-1 border-b border-border py-1.5 pl-3 pr-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-faint">{label}</h3>
        <div className="ml-auto flex items-center gap-1">{right}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------- controls */

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "secondary",
  icon: Icon,
  busy,
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: LucideIcon; busy?: boolean }) {
  const tone: Record<Variant, string> = {
    primary: "bg-accent text-accent-ink shadow-md shadow-accent/20 enabled:hover:bg-accent/90",
    secondary: "border border-border bg-surface text-muted enabled:hover:border-border-strong enabled:hover:text-text",
    ghost: "text-faint enabled:hover:bg-surface-2 enabled:hover:text-text",
  };
  return (
    <button
      type="button"
      disabled={busy || rest.disabled}
      className={
        "press flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 " +
        tone[variant] +
        " " +
        className
      }
      {...rest}
    >
      {busy ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} strokeWidth={2.25} /> : null}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  // One highlight that slides between equal-width options instead of each
  // option blinking on and off - the same motion as the editor's mode picker.
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div role="radiogroup" aria-label={label} className="relative inline-grid auto-cols-fr grid-flow-col rounded-lg border border-border bg-bg p-0.5">
      <span
        aria-hidden
        className="spring absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-surface-2 shadow-sm"
        style={{ width: "calc((100% - 4px) / " + options.length + ")", transform: "translateX(" + idx * 100 + "%)" }}
      />
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={
            "press-soft relative z-10 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors duration-200 " +
            (o.id === value ? "text-text" : "text-faint hover:text-muted")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className={
        "press press-soft flex h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium " +
        (checked ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-surface text-muted hover:text-text")
      }
    >
      {label}
      <span className={"relative h-3.5 w-6 shrink-0 rounded-full transition-colors " + (checked ? "bg-accent/80" : "bg-border-strong")}>
        <span className={"spring absolute top-0.5 h-2.5 w-2.5 rounded-full bg-bg shadow-sm " + (checked ? "left-3" : "left-0.5")} />
      </span>
    </button>
  );
}

/** A labelled form row. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "h-8 w-full rounded-lg border border-border bg-bg px-2.5 font-mono text-[13px] text-text outline-none placeholder:text-faint focus:border-accent/60";

/** A row of controls above the panes. */
export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2">{children}</div>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: React.ReactNode }) {
  const tones = {
    info: "border-border bg-surface-2/60 text-muted",
    warn: "border-accent/30 bg-accent/[0.07] text-text",
    error: "border-danger/30 bg-danger/[0.07] text-danger",
    ok: "border-ok/30 bg-ok/[0.08] text-text",
  };
  return <div className={"animate-fade-in rounded-lg border px-3 py-2 text-xs leading-relaxed " + tones[tone]}>{children}</div>;
}

/** Compact "label value" chips, for counts and summaries. */
export function Stats({ items }: { items: ReadonlyArray<{ label: string; value: string | number; tone?: "ok" | "warn" | "danger" }> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s.label} className="flex items-baseline gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-faint">
          {s.label}
          <span className={"font-mono font-semibold " + (s.tone === "ok" ? "text-ok" : s.tone === "warn" ? "text-accent" : s.tone === "danger" ? "text-danger" : "text-text")}>
            {s.value}
          </span>
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- text i/o */

export function useCopy(): (text: string, done?: string) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (text: string, done = "Copied") => {
      if (!text) return toast("Nothing to copy yet", "info");
      toast((await writeClipboard(text)) ? done : "Copy failed - select and press Cmd/Ctrl+C", "success");
    },
    [toast],
  );
}

/**
 * Editable text input: paste, open a file (or drop one), clear with undo.
 * `accept` limits the file picker; dropped files are read as UTF-8 text.
 */
export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  accept = ".tex,.bib,.md,.txt,.py,text/*",
  right,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  accept?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const replace = (text: string, message: string) => {
    const previous = value;
    onChange(text);
    toast(message, "info", previous && previous !== text ? { label: "Undo", run: () => onChange(previous) } : undefined);
  };
  const open = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast(file.name + " is over 5 MB", "error");
    replace(await file.text(), "Opened " + file.name);
  };

  return (
    <Pane
      label={label}
      className={className}
      right={
        <>
          {right}
          <IconAction icon={FileUp} label="Open a file" onClick={() => fileRef.current?.click()} />
          <IconAction
            icon={ClipboardPaste}
            label="Paste from clipboard"
            onClick={async () => {
              try {
                const t = await navigator.clipboard.readText();
                if (t) replace(t, "Pasted " + t.length.toLocaleString() + " chars");
              } catch {
                toast("Browser blocked clipboard read - use Cmd/Ctrl+V", "error");
              }
            }}
          />
          <IconAction icon={Eraser} label="Clear" onClick={() => value && replace("", "Cleared")} />
        </>
      }
    >
      <div
        className="relative min-h-0 flex-1"
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setDragging(false);
          void open(e.dataTransfer.files[0]);
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          placeholder={placeholder}
          aria-label={label}
          className="scroll-slim absolute inset-0 resize-none bg-transparent p-3 font-mono text-[13px] leading-6 text-text caret-accent outline-none placeholder:text-faint focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {dragging && (
          <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-surface/90 text-sm font-semibold text-accent">
            Drop to open
          </div>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </Pane>
  );
}

/**
 * Read-only result with copy and download. `highlight` colours it as LaTeX.
 * Output text is rendered through highlightLine (escapes first) or as plain
 * text - never as raw HTML.
 */
export function TextOutput({
  label,
  value,
  filename,
  emptyText = "Output appears here.",
  highlight = true,
  right,
  className,
}: {
  label: string;
  value: string;
  filename?: string;
  emptyText?: string;
  highlight?: boolean;
  right?: React.ReactNode;
  className?: string;
}) {
  const copy = useCopy();
  const toast = useToast();
  const lines = value ? value.split("\n") : [];
  return (
    <Pane
      label={label}
      className={className}
      right={
        <>
          {right}
          <IconAction icon={Copy} label="Copy" disabled={!value} onClick={() => void copy(value, label + " copied")} />
          {filename && (
            <IconAction
              icon={Download}
              label={"Download " + filename}
              disabled={!value}
              onClick={() => {
                downloadText(value.endsWith("\n") ? value : value + "\n", filename);
                toast("Saved " + filename);
              }}
            />
          )}
        </>
      }
    >
      {value ? (
        <div className="scroll-slim min-h-0 flex-1 overflow-auto">
          <div className="min-w-max py-3 font-mono text-[13px] leading-6">
            {lines.map((line, i) => (
              <div key={i} className="flex hover:bg-surface-2">
                <span className="w-10 shrink-0 select-none pr-2 text-right text-faint">{i + 1}</span>
                {highlight ? (
                  <code
                    className="whitespace-pre pr-4 text-text"
                    // Same justified sink as the main output pane: highlightLine escapes before it wraps.
                    dangerouslySetInnerHTML={{ __html: highlightLine(line) || "&nbsp;" }}
                  />
                ) : (
                  <code className="whitespace-pre pr-4 text-text">{line || " "}</code>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-faint">{emptyText}</div>
      )}
    </Pane>
  );
}

export function IconAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  active,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={
        "press flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-35 " +
        (active ? "bg-accent/10 text-accent" : "text-faint hover:bg-surface-2 hover:text-text")
      }
    >
      <Icon size={14} strokeWidth={2.25} />
    </button>
  );
}

/* ------------------------------------------------------------------- files */

/**
 * Drop zone for whole projects: files, folders (via the picker), or archives,
 * which are expanded. Hands back a flat list of { path, data }.
 */
export function FileDrop({
  onFiles,
  accept,
  directory = false,
  title,
  hint,
  icon: Icon = FileUp,
}: {
  onFiles: (files: ArchiveFile[]) => void;
  accept?: string;
  directory?: boolean;
  title: string;
  hint?: string;
  icon?: LucideIcon;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const take = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    try {
      onFiles(await readUploads(Array.from(list)));
    } catch (err) {
      toast("Could not read those files: " + (err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void take(e.dataTransfer.files);
      }}
      className={
        "spring flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center " +
        (dragging ? "scale-[1.01] border-accent bg-accent/[0.06]" : "border-border-strong bg-surface")
      }
    >
      {busy ? <Loader2 size={22} className="animate-spin text-accent" /> : <Icon size={22} className="text-faint" />}
      <div className="text-sm font-semibold text-text">{title}</div>
      {hint && <div className="max-w-md text-xs leading-snug text-faint">{hint}</div>}
      <div className="mt-1 flex gap-2">
        <Button icon={FileUp} onClick={() => fileRef.current?.click()}>
          Choose files
        </Button>
        {directory && (
          <Button onClick={() => dirRef.current?.click()}>Choose a folder</Button>
        )}
      </div>
      <input ref={fileRef} type="file" multiple accept={accept} className="hidden" onChange={(e) => void take(e.target.files).then(() => (e.target.value = ""))} />
      {directory && (
        <input
          ref={dirRef}
          type="file"
          className="hidden"
          // Non-standard but universally supported: lets the user pick a whole folder.
          {...({ webkitdirectory: "" } as Record<string, string>)}
          onChange={(e) => void take(e.target.files).then(() => (e.target.value = ""))}
        />
      )}
    </div>
  );
}

export { downloadBlob, downloadText };

export function formatBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
