"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  getThemeServerSnapshot,
  getThemeSnapshot,
  setTheme,
  subscribeToTheme,
} from "@/lib/theme";

export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted transition-colors hover:border-border-strong hover:text-text"
    >
      {theme === "dark" ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
    </button>
  );
}
