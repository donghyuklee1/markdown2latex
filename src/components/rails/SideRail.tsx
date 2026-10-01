"use client";

import { useEffect, useRef } from "react";
import { X, type LucideIcon } from "lucide-react";

export interface RailItem {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Keyboard hint shown in the hover label. */
  keys?: string;
  /** Small count badge, e.g. problems in the outline. */
  badge?: number;
  /** Plain action instead of a flyout panel. */
  onClick?: () => void;
  /** Rendered in the flyout when the item is open. */
  panel?: React.ReactNode;
  /** A thin divider is drawn before this item. */
  divider?: boolean;
}

/**
 * A slim vertical icon rail in the margin beside the panes - the space a wide
 * screen leaves empty anyway. Icons either act directly or open a flyout panel
 * that floats over the neighbouring pane. Hidden below `lg`, where there is no
 * spare margin to use.
 */
export default function SideRail({
  side,
  items,
  open,
  onOpen,
}: {
  side: "left" | "right";
  items: ReadonlyArray<RailItem>;
  /** Id of the item whose flyout is open, or null. */
  open: string | null;
  onOpen: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const current = items.find((i) => i.id === open && i.panel);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpen]);

  const left = side === "left";

  return (
    // z-30 lifts the whole rail - hover labels and flyouts included - above the
    // panes beside it. The sticky nav starts its own stacking context, so the
    // labels' own z-index cannot escape it; the wrapper has to carry the layer.
    <div ref={ref} className="relative z-30 hidden w-11 shrink-0 lg:block">
      <nav
        aria-label={left ? "Editor tools" : "Output tools"}
        className="themed sticky top-0 flex flex-col items-center gap-1 rounded-xl border border-border bg-surface py-1.5"
      >
        {items.map((item) => {
          const active = item.id === open;
          return (
            <div key={item.id} className="contents">
              {item.divider && <div className="my-0.5 h-px w-6 bg-border" />}
              <button
                type="button"
                aria-label={item.label}
                aria-expanded={item.panel ? active : undefined}
                onClick={() => (item.onClick ? (onOpen(null), item.onClick()) : onOpen(active ? null : item.id))}
                className={
                  "press group relative flex h-9 w-9 items-center justify-center rounded-lg " +
                  (active ? "bg-accent/10 text-accent" : "text-faint hover:bg-surface-2 hover:text-text")
                }
              >
                {/* Active marker on the edge facing the panes. */}
                <span
                  aria-hidden
                  className={
                    "spring absolute top-1/2 w-[3px] -translate-y-1/2 rounded-full bg-accent " +
                    (left ? "-right-[7px] " : "-left-[7px] ") +
                    (active ? "h-5 opacity-100" : "h-0 opacity-0")
                  }
                />
                <item.icon size={17} strokeWidth={2} />
                {!!item.badge && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-[15px] rounded-full bg-danger px-1 text-center font-mono text-[9px] font-bold leading-[15px] text-bg">
                    {item.badge > 9 ? "9+" : item.badge}
                  </span>
                )}
                {/* Hover label, sliding out toward the panes. */}
                {!active && (
                  <span
                    className={
                      "pointer-events-none absolute top-1/2 z-50 -translate-y-1/2 whitespace-nowrap rounded-md bg-text px-2 py-1 text-[11px] font-medium text-bg opacity-0 shadow-lg transition-all duration-150 group-hover:opacity-100 " +
                      (left ? "left-full ml-2 translate-x-[-4px] group-hover:translate-x-0" : "right-full mr-2 translate-x-[4px] group-hover:translate-x-0")
                    }
                  >
                    {item.label}
                    {item.keys && <span className="ml-1.5 font-mono opacity-60">{item.keys}</span>}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      {current && (
        <div
          role="dialog"
          aria-label={current.label}
          className={
            "themed absolute top-0 z-30 flex max-h-[calc(100vh-9rem)] w-[min(22rem,40vw)] animate-pop-in flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/15 " +
            (left ? "left-full ml-2 origin-top-left" : "right-full mr-2 origin-top-right")
          }
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <current.icon size={14} className="text-accent" />
            <h2 className="text-xs font-semibold uppercase tracking-wider text-faint">{current.label}</h2>
            <button
              type="button"
              onClick={() => onOpen(null)}
              aria-label="Close panel"
              className="press ml-auto flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-text"
            >
              <X size={13} />
            </button>
          </div>
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">{current.panel}</div>
        </div>
      )}
    </div>
  );
}
