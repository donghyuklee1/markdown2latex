"use client";

import { useSyncExternalStore } from "react";
import { GeminiStar } from "@/components/BrandMark";
import { aiStore } from "@/lib/persistedStore";
import { useToast } from "../Toast";
import { openAiKey } from "./AiKeyDialog";
import { setAiMode } from "./aiKey";
import { runStore } from "./orchestrator";

/**
 * Header switch for AI mode. Without a key it asks for one (saving the key
 * turns AI mode on); with one it toggles. Its dot pulses while a background
 * analysis runs.
 */
export default function AiModeToggle() {
  const ai = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const run = useSyncExternalStore(runStore.subscribe, runStore.get, runStore.getServer);
  const toast = useToast();
  const on = ai.mode && !!ai.apiKey;
  const busy = run.phase === "running";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => {
        if (!ai.apiKey) return openAiKey();
        setAiMode(!on);
        toast(on ? "AI mode off - nothing is sent to Gemini" : "AI mode on - derivations are analysed as you write", "info");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        openAiKey();
      }}
      title={!ai.apiKey ? "Turn on AI mode with your own free Gemini key" : on ? "AI mode is on (" + (ai.model || "Gemini") + ") - click to turn off, right-click for settings" : "AI mode is off - click to turn on"}
      className={
        "press relative flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors " +
        (on ? "border-[#4b8cf5]/40 bg-[#4b8cf5]/10 text-text" : "border-border bg-surface text-muted hover:border-border-strong hover:text-text")
      }
    >
      <GeminiStar size={14} className={on ? "" : "opacity-50 grayscale"} />
      <span className="hidden sm:inline">AI</span>
      {/* The logo stays still; the dot pulses blue while an analysis runs. */}
      <span className={"h-1.5 w-1.5 rounded-full " + (busy ? "animate-pulse bg-[#4b8cf5]" : on ? "bg-ok" : "bg-border-strong")} aria-hidden />
    </button>
  );
}
