"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Palette, Pipette, RotateCcw, X } from "lucide-react";
import {
  EDITABLE_TOKENS,
  eyeDropperSupported,
  getPaletteServerSnapshot,
  getPaletteSnapshot,
  getThemeServerSnapshot,
  getThemeSnapshot,
  pickColorFromScreen,
  readToken,
  resetPalette,
  setTokenOverride,
  subscribeToTheme,
  type EditableToken,
} from "@/lib/theme";
import { useToast } from "./Toast";

/* Eyedropper support is fixed for the life of the page, so there is nothing to
 * subscribe to - but reading it through useSyncExternalStore keeps the server
 * snapshot explicit and avoids a hydration mismatch on the pipette buttons. */
const neverChanges = () => () => {};
const assumeNoDropper = () => false;

/**
 * Live colour editor. Each row shows the token's current value, which may come
 * from the theme default or from a previous override - it is read back out of
 * the computed style rather than tracked separately, so the swatch cannot drift
 * from what is actually on screen.
 */
export default function PalettePicker() {
  const [open, setOpen] = useState(false);
  const hasDropper = useSyncExternalStore(neverChanges, eyeDropperSupported, assumeNoDropper);
  const panelRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const palette = useSyncExternalStore(subscribeToTheme, getPaletteSnapshot, getPaletteServerSnapshot);
  const overrides = palette[theme] ?? {};
  const overrideCount = Object.keys(overrides).length;

  // Dismiss on outside click or Escape, the way a popover is expected to behave.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
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

  const sample = useCallback(
    async (token: EditableToken) => {
      const picked = await pickColorFromScreen();
      if (!picked) return; // cancelled
      setTokenOverride(token, picked);
      toast(`Sampled ${picked}`);
    },
    [toast],
  );

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Edit the colour palette"
        aria-expanded={open}
        className={
          "flex h-8 items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors " +
          (open
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-surface text-muted hover:border-border-strong hover:text-text")
        }
      >
        <Palette size={14} strokeWidth={2} />
        {overrideCount > 0 && (
          <span className="rounded bg-accent px-1 font-mono text-[10px] text-accent-ink">
            {overrideCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 animate-pop-in rounded-xl border border-border bg-surface p-3 shadow-xl shadow-black/10">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
              Palette · {theme}
            </h3>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-faint transition-colors hover:text-text"
              aria-label="Close palette editor"
            >
              <X size={14} />
            </button>
          </div>

          <div className="space-y-1">
            {EDITABLE_TOKENS.map(({ id, label, hint }) => {
              const current = readToken(id);
              const overridden = overrides[id] !== undefined;
              return (
                <div key={id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
                  <label
                    className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border-strong"
                    style={{ backgroundColor: current }}
                    title={`${label} - click to choose`}
                  >
                    <input
                      type="color"
                      value={current}
                      onChange={(e) => setTokenOverride(id, e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label={`${label} colour`}
                    />
                  </label>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-text" title={hint}>
                      {label}
                    </div>
                    <div className="font-mono text-[10px] uppercase text-faint">{current}</div>
                  </div>

                  {hasDropper && (
                    <button
                      type="button"
                      onClick={() => void sample(id)}
                      title={`Sample ${label} from anywhere on screen`}
                      className="rounded-md p-1 text-faint transition-colors hover:bg-accent/10 hover:text-accent"
                    >
                      <Pipette size={13} strokeWidth={2} />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setTokenOverride(id, null)}
                    disabled={!overridden}
                    title={overridden ? `Reset ${label}` : "Not customised"}
                    className="rounded-md p-1 text-faint transition-colors enabled:hover:bg-surface-2 enabled:hover:text-text disabled:opacity-25"
                  >
                    <RotateCcw size={12} strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-2 flex items-center gap-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={resetPalette}
              disabled={overrideCount === 0}
              className="flex-1 rounded-lg border border-border px-2 py-1.5 text-xs font-medium text-muted transition-colors enabled:hover:border-border-strong enabled:hover:text-text disabled:opacity-40"
            >
              Reset {theme} palette
            </button>
          </div>

          <p className="mt-2 text-[10px] leading-snug text-faint">
            {hasDropper
              ? "The pipette samples any pixel on screen, including outside the browser."
              : "Your browser has no eyedropper API - use the swatch to pick a colour."}
          </p>
        </div>
      )}
    </div>
  );
}
