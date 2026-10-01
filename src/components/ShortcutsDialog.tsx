"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import { EDITOR_KEYS, SHORTCUTS, type Shortcut } from "@/lib/shortcuts";
import { IconButton, Kbd, useKeyLabel } from "./ui";

/* Open/closed lives in a module-level store so the header button, the `?` key
 * and the dialog itself can all reach it without threading props through the
 * server-rendered page. */
let open = false;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getOpen = () => open;
const getServerOpen = () => false;

export function setShortcutsOpen(next: boolean | ((prev: boolean) => boolean)): void {
  open = typeof next === "function" ? next(open) : next;
  for (const l of listeners) l();
}

export function ShortcutsButton() {
  return (
    <button
      type="button"
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      onClick={() => setShortcutsOpen(true)}
      className="press flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface font-mono text-sm font-bold text-muted hover:border-border-strong hover:text-text"
    >
      ?
    </button>
  );
}

const GROUPS: ReadonlyArray<Shortcut["group"]> = ["Output", "Editing", "View"];

function Keys({ keys }: { keys: string }) {
  const label = useKeyLabel();
  // Split "Mod+Shift+S" into chips, but keep a literal "+" or "-" key intact.
  const parts = keys === "?" ? ["?"] : keys.split(/\+(?=.)/);
  return (
    <span className="flex shrink-0 gap-1">
      {parts.map((p, i) => (
        <Kbd key={i}>{label(p)}</Kbd>
      ))}
    </span>
  );
}

export default function ShortcutsDialog() {
  const isOpen = useSyncExternalStore(subscribe, getOpen, getServerOpen);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShortcutsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus?.(); // hand focus back to wherever the user was
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setShortcutsOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="themed max-h-[85vh] w-full max-w-lg animate-pop-in overflow-y-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl shadow-black/20"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-sm font-semibold text-text">
            Keyboard shortcuts
          </h2>
          <IconButton ref={closeRef} icon={X} label="Close" onClick={() => setShortcutsOpen(false)} />
        </div>

        <div className="space-y-5">
          {GROUPS.map((group) => (
            <section key={group}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{group}</h3>
              <ul className="divide-y divide-border">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-4 py-1.5 text-[13px] text-muted">
                    {s.label}
                    <Keys keys={s.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">In the editor</h3>
            <ul className="divide-y divide-border">
              {EDITOR_KEYS.map((s) => (
                <li key={s.keys} className="flex items-center justify-between gap-4 py-1.5 text-[13px] text-muted">
                  {s.label}
                  <Keys keys={s.keys} />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <p className="mt-4 text-[11px] leading-snug text-faint">
          Drop a .md, .tex or .txt file onto the editor to open it. Your draft and layout are saved in this
          browser automatically.
        </p>
      </div>
    </div>
  );
}
