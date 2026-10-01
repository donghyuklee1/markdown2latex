"use client";

import { Suspense, useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { uiStore } from "@/lib/persistedStore";
import { PANEL_LOADERS, TOOL_GROUPS, TOOLS, type ToolInfo } from "./lab/tools";

/**
 * Tools: a sidebar of tools on the left, the chosen tool on the right. On
 * narrow screens the sidebar becomes a horizontal strip of chips.
 *
 * Motion, so nothing blinks: panels are preloaded once the page is idle, a
 * switch runs as a transition (the current tool stays on screen until the next
 * is ready, never a spinner flash), and the new tool glides in from the
 * direction you moved in the list.
 */
export default function ResearchLab() {
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.getServer);
  const current: ToolInfo = TOOLS.find((t) => t.id === ui.labTool) ?? TOOLS[0];
  const currentIdx = TOOLS.indexOf(current);
  const [direction, setDirection] = useState(0);
  const [pending, startTransition] = useTransition();
  const Panel = current.Panel;

  useEffect(() => {
    const warm = () => void Promise.all(Object.values(PANEL_LOADERS).map((load) => load()));
    const idle = window.requestIdleCallback?.(warm, { timeout: 3000 });
    const t = idle === undefined ? window.setTimeout(warm, 1500) : undefined;
    return () => {
      if (idle !== undefined) window.cancelIdleCallback?.(idle);
      if (t !== undefined) window.clearTimeout(t);
    };
  }, []);

  const pick = (id: string) => {
    if (id === current.id) return;
    setDirection(TOOLS.findIndex((t) => t.id === id) > currentIdx ? 1 : -1);
    startTransition(() => uiStore.update((prev) => ({ ...prev, labTool: id })));
  };

  return (
    <main className="mx-auto flex w-full max-w-[1910px] flex-1 flex-col gap-3 p-3 sm:p-4 lg:min-h-0 lg:flex-row">
      <nav aria-label="Tools" className="themed shrink-0 lg:w-64">
        {/* wide: grouped vertical list; narrow: one scrollable row of chips */}
        <div className="scroll-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-4 lg:overflow-visible lg:px-0">
          {TOOL_GROUPS.map((group) => (
            <div key={group} className="contents lg:block">
              <div className="mb-1 hidden px-2 text-[10px] font-semibold uppercase tracking-widest text-faint/80 lg:block">{group}</div>
              <div className="contents lg:block lg:space-y-0.5">
                {TOOLS.filter((t) => t.group === group).map((t) => {
                  const active = t.id === current.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => pick(t.id)}
                      onMouseEnter={() => void PANEL_LOADERS[t.id]()}
                      aria-current={active ? "page" : undefined}
                      className={
                        "press-soft group relative flex shrink-0 items-center gap-2.5 overflow-hidden rounded-lg px-2.5 py-2 text-left transition-[background-color,color,box-shadow,transform] duration-300 ease-out active:scale-[0.985] lg:w-full " +
                        (active
                          ? "bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.3)]"
                          : "border border-border bg-surface text-muted hover:text-text lg:border-transparent lg:bg-transparent lg:hover:bg-surface-2")
                      }
                    >
                      {/* accent bar that grows in rather than appearing */}
                      <span
                        aria-hidden
                        className={
                          "absolute left-0 top-1/2 hidden w-[3px] -translate-y-1/2 rounded-full bg-accent transition-all duration-300 ease-out lg:block " +
                          (active ? "h-6 opacity-100" : "h-0 opacity-0")
                        }
                      />
                      <t.icon size={16} strokeWidth={2.1} className="shrink-0 transition-transform duration-300 group-hover:scale-110" />
                      <span className="min-w-0">
                        <span className="block whitespace-nowrap text-xs font-semibold lg:whitespace-normal">{t.title}</span>
                        <span className="hidden text-[11px] leading-snug text-faint lg:block">{t.summary}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* A hairline progress bar - only visible if a switch takes a moment. */}
        <div
          aria-hidden
          className={
            "pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 origin-left rounded-full bg-accent transition-[transform,opacity] duration-500 " +
            (pending ? "scale-x-75 opacity-80" : "scale-x-0 opacity-0")
          }
        />
        <div
          key={current.id}
          className={
            "scroll-slim flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-y-auto " +
            (direction > 0 ? "lab-in-down" : direction < 0 ? "lab-in-up" : "animate-fade-in")
          }
        >
          <Suspense
            fallback={
              <div className="flex flex-1 items-center justify-center text-faint">
                <Loader2 className="animate-spin" />
              </div>
            }
          >
            <Panel />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
