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
 * turns AI mode on); with one it toggles. It looks like the buttons beside
 * it: the Gemini logo is in colour when AI mode is on, grey when it is off.
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
      aria-busy={busy}
      // Same frame as the other header buttons; on/off is carried by the logo
      // (in colour when on, grey when off) and the label, nothing else.
      className={
        "press flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold hover:border-border-strong hover:text-text " +
        (on ? "text-text" : "text-muted")
      }
    >
      <GeminiStar size={14} className={on ? "" : "opacity-40 grayscale"} />
      <span className="hidden sm:inline">{on ? "AI on" : "AI"}</span>
    </button>
  );
}
