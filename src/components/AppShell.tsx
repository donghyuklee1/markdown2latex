"use client";

import { useEffect, useSyncExternalStore } from "react";
import { uiStore } from "@/lib/persistedStore";
import { matchShortcut } from "@/lib/shortcuts";
import { getThemeSnapshot, setTheme } from "@/lib/theme";
import ResearchLab from "./ResearchLab";
import { setShortcutsOpen } from "./ShortcutsDialog";
import Workspace from "./Workspace";

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || (el as HTMLElement).isContentEditable);

/**
 * Chooses between the cleaner and the Research Lab. The Workspace owns its own
 * shortcuts; this adds the view switch everywhere, and help/theme in the Lab.
 */
export default function AppShell() {
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.getServer);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const id = matchShortcut(e, isTyping(document.activeElement));
      if (id === "toggleLab") {
        e.preventDefault();
        uiStore.update((p) => ({ ...p, view: p.view === "lab" ? "clean" : "lab" }));
      } else if (ui.view === "lab" && id === "help") {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      } else if (ui.view === "lab" && id === "toggleTheme") {
        e.preventDefault();
        setTheme(getThemeSnapshot() === "dark" ? "light" : "dark");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ui.view]);

  return ui.view === "lab" ? <ResearchLab /> : <Workspace />;
}

/** Header control: Editor | Tools. */
export function ViewSwitch() {
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.getServer);
  const views = [
    { id: "clean", label: "Editor" },
    { id: "lab", label: "Tools" },
  ] as const;
  const idx = ui.view === "lab" ? 1 : 0;
  return (
    <div role="tablist" aria-label="App section" className="relative grid grid-cols-2 rounded-lg border border-border bg-bg p-0.5">
      <span
        aria-hidden
        className="spring absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-surface-2 shadow-sm"
        style={{ width: "calc((100% - 4px) / 2)", transform: "translateX(" + idx * 100 + "%)" }}
      />
      {views.map((v, i) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={i === idx}
          title={v.label + " (Alt+R switches)"}
          onClick={() => uiStore.update((p) => ({ ...p, view: v.id }))}
          className={
            "press press-soft relative z-10 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold sm:px-3 " +
            (i === idx ? "text-text" : "text-faint hover:text-muted")
          }
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
