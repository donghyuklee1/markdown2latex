"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Boxes, Loader2, PenTool, Ruler, X } from "lucide-react";
import type { StudioContext } from "./types";

const loaders = {
  sandbox: () => import("./SandboxPanel"),
  units: () => import("./UnitsPanel"),
  sketch: () => import("./SketchPanel"),
};
const PANELS = {
  sandbox: lazy(loaders.sandbox),
  units: lazy(loaders.units),
  sketch: lazy(loaders.sketch),
};

export type BenchTab = keyof typeof PANELS;

const TABS: ReadonlyArray<{ id: BenchTab; label: string; slug: string; icon: typeof Boxes }> = [
  { id: "sandbox", label: "Shape Sandbox", slug: "math-code-sandbox", icon: Boxes },
  { id: "units", label: "Unit Checker", slug: "unit-checker", icon: Ruler },
  { id: "sketch", label: "Sketch → TikZ", slug: "sketch2tikz", icon: PenTool },
];

/** A sheet dragged down further than this (px) closes on release. */
const DISMISS_PX = 110;

/**
 * Studio Workbench: a slide-over drawer beside the cleaner, so the deeper tools
 * are one keystroke away without ever displacing the editor. Slides in from the
 * right on wide screens; on phones it is a bottom sheet you can drag away.
 *
 * Motion: opening decelerates long and soft (the curve iOS uses for sheets),
 * closing is quicker and accelerates out. Content fades in just behind the
 * panel and stays mounted until the panel has fully left, so nothing blinks.
 */
export default function Workbench({
  open,
  tab,
  onTab,
  onClose,
  context,
}: {
  open: boolean;
  tab: BenchTab;
  onTab: (t: BenchTab) => void;
  onClose: () => void;
  context: StudioContext;
}) {
  // Content stays mounted while the panel slides out; dropped once it is gone.
  const [settledOpen, setSettledOpen] = useState(false);
  const showContent = open || settledOpen;
  /** -1 / 1: which way the last tab change moved, for the content slide. */
  const [direction, setDirection] = useState(0);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ startY: number; pointer: number } | null>(null);

  // Warm the tool chunks once the page is idle, so the first open is instant.
  useEffect(() => {
    const warm = () => void Promise.all(Object.values(loaders).map((l) => l()));
    const idle = window.requestIdleCallback?.(warm, { timeout: 4000 });
    const t = idle === undefined ? window.setTimeout(warm, 2500) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const idx = Math.max(0, TABS.findIndex((t) => t.id === tab));
  const Panel = PANELS[tab];

  const pickTab = (next: BenchTab) => {
    const to = TABS.findIndex((t) => t.id === next);
    setDirection(to === idx ? 0 : to > idx ? 1 : -1);
    onTab(next);
  };

  /* --- bottom-sheet drag (phones) --------------------------------------- */
  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startY: e.clientY, pointer: e.pointerId };
  };
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // Rubber-band upward, follow the finger downward.
    const dy = e.clientY - drag.current.startY;
    setDragY(dy > 0 ? dy : dy / 6);
  };
  const onHandleUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dragY > DISMISS_PX) onClose();
    setDragY(0);
  };
  const dragging = dragY !== 0;

  return (
    <>
      {/* Scrim only on narrow screens; on wide ones the editor stays usable. */}
      <div
        aria-hidden
        onClick={onClose}
        className={
          "fixed inset-0 z-40 bg-black/25 backdrop-blur-[1.5px] transition-opacity lg:hidden " +
          (open ? "opacity-100 duration-500" : "pointer-events-none opacity-0 duration-300")
        }
        style={dragging ? { opacity: Math.max(0.2, 1 - dragY / 400) } : undefined}
      />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label="Studio Workbench"
        aria-hidden={!open}
        inert={!open}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === "transform") setSettledOpen(open);
        }}
        data-open={open}
        className={
          "bench themed fixed z-40 flex flex-col border-border bg-surface will-change-transform " +
          "inset-x-0 bottom-0 h-[85vh] rounded-t-2xl border-t lg:inset-x-auto lg:bottom-0 lg:right-0 lg:top-0 lg:h-auto lg:w-[min(720px,52vw)] lg:rounded-none lg:border-l lg:border-t-0 " +
          (open
            ? "translate-y-0 shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.3)] lg:translate-x-0 lg:shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.25)]"
            : "translate-y-full shadow-none lg:translate-x-full lg:translate-y-0")
        }
        style={dragging ? { transform: "translateY(" + dragY + "px)", transition: "none" } : undefined}
      >
        {/* Grab handle: phones only. */}
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          className="flex h-5 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing lg:hidden"
          aria-hidden
        >
          <span className="h-1 w-10 rounded-full bg-border-strong" />
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 pb-2 lg:pt-2">
          <span className="mr-1 hidden text-xs font-semibold uppercase tracking-wider text-faint sm:inline">Workbench</span>
          <div role="tablist" aria-label="Workbench tools" className="relative grid grid-cols-3 rounded-lg border border-border bg-bg p-0.5">
            <span
              aria-hidden
              className="spring absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-surface-2 shadow-sm"
              style={{ width: "calc((100% - 4px) / 3)", transform: "translateX(" + idx * 100 + "%)" }}
            />
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === tab}
                onClick={() => pickTab(t.id)}
                title={t.label + " (" + t.slug + ")"}
                className={
                  "press press-soft relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors " +
                  (t.id === tab ? "text-text" : "text-faint hover:text-muted")
                }
              >
                <t.icon size={13} strokeWidth={2.25} />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the workbench"
            title="Close (Esc)"
            className="press ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-text"
          >
            <X size={15} />
          </button>
        </div>

        {/* Content trails the panel slightly: fades and drifts in after it starts moving. */}
        <div className="bench-content scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {showContent && (
            <div
              key={tab}
              className={direction > 0 ? "bench-in-right" : direction < 0 ? "bench-in-left" : "animate-fade-in"}
            >
              <Suspense
                fallback={
                  <div className="flex h-40 items-center justify-center text-faint">
                    <Loader2 className="animate-spin" />
                  </div>
                }
              >
                <Panel {...context} />
              </Suspense>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
