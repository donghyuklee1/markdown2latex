"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, ExternalLink, Loader2, Lock, X } from "lucide-react";
import BrandMark, { GeminiStar } from "@/components/BrandMark";
import { aiStore } from "@/lib/persistedStore";
import { accountStore } from "../account/cloud";
import { AiError, listModels, type ModelInfo } from "../derivation/gemini";
import { useToast } from "../Toast";
import { forgetKey, saveKey, setAiMode, setRemember } from "./aiKey";

/* --------------------------------------------- open/close from anywhere */

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  for (const l of listeners) l();
};
export const openAiKey = () => setOpen(true);
const dialogStore = {
  get: () => open,
  getServer: () => false,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/**
 * Paste a key, save it: checked against Google, stored, AI mode on. Used in
 * the dialog and in the onboarding tour. `compact` drops the explanations.
 */
export function KeyForm({ compact = false, onSaved }: { compact?: boolean; onSaved?: () => void }) {
  const ai = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const toast = useToast();
  const signedIn = acc.status === "signed-in";

  useEffect(() => {
    if (!ai.apiKey) return;
    let live = true;
    listModels(ai.apiKey).then(
      (m) => live && setModels(m),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ai.apiKey]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await saveKey(key);
      setModels(r.models);
      setKey("");
      toast("AI mode is on" + (r.synced ? " - key kept in your account, encrypted" : ""), "success");
      onSaved?.();
    } catch (e) {
      setError(e instanceof AiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2.5 text-xs">
      {ai.apiKey ? (
        <div className="flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/[0.07] px-2.5 py-2 text-text">
          <Check size={14} className="text-ok" />
          <span className="flex-1">
            Key saved <span className="font-mono text-faint">...{ai.apiKey.slice(-4)}</span>
          </span>
          <button
            type="button"
            onClick={() => void forgetKey().then(() => toast("Key removed - AI mode is off", "info"))}
            className="press rounded-md px-1.5 py-0.5 font-semibold text-muted hover:bg-danger/10 hover:text-danger"
          >
            Remove
          </button>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && key.trim() && void save()}
              placeholder="Paste your Gemini API key"
              autoComplete="off"
              spellCheck={false}
              aria-label="Gemini API key"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 font-mono text-text outline-none focus:border-accent/60"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={!key.trim() || busy}
              className="press flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 font-semibold text-accent-ink disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <GeminiStar size={13} />} Turn on AI
            </button>
          </div>
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
            Get a free key at Google AI Studio <ExternalLink size={11} />
          </a>
        </>
      )}
      {error && <p className="rounded-lg bg-danger/10 px-2 py-1.5 text-danger">{error}</p>}

      {signedIn && (
        <label className="flex cursor-pointer items-start gap-2 text-muted">
          <input type="checkbox" checked={ai.remember} onChange={(e) => void setRemember(e.target.checked)} className="mt-0.5 accent-[rgb(var(--accent))]" />
          <span>
            <Lock size={11} className="mr-1 inline" />
            Keep the key in my account, encrypted, for my other devices
          </span>
        </label>
      )}

      {ai.apiKey && (
        <div className="flex items-center gap-2">
          <label className="flex flex-1 items-center gap-2">
            <span className="text-faint">Model</span>
            <select value={ai.model} onChange={(e) => aiStore.set({ ...ai, model: e.target.value })} className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-bg px-1.5 text-text">
              {(models.length ? models : [{ id: ai.model, label: ai.model || "Newest Flash" }]).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-text">
            <input type="checkbox" checked={ai.mode} onChange={(e) => setAiMode(e.target.checked)} className="accent-[rgb(var(--accent))]" />
            AI mode
          </label>
        </div>
      )}
      {!compact && (
        <p className="leading-snug text-faint">
          Your key goes only to Google, from this browser. AI mode analyses your derivations in the background as you write and converts images to LaTeX. On Google&apos;s free tier, prompts may be used to improve their models.
        </p>
      )}
    </div>
  );
}

export default function AiKeyDialog() {
  const isOpen = useSyncExternalStore(dialogStore.subscribe, dialogStore.get, dialogStore.getServer);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div role="dialog" aria-modal="true" aria-label="AI mode" className="themed ob-card relative w-full max-w-[420px] rounded-2xl border border-border bg-surface p-5 shadow-2xl">
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="press absolute right-3 top-3 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
          <X size={15} />
        </button>
        <div className="mb-3 flex items-center gap-2">
          <GeminiStar size={20} />
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-text">
            AI mode with <BrandMark mark="gemini" height="1.05em" />
          </h2>
        </div>
        <KeyForm onSaved={() => window.setTimeout(() => setOpen(false), 600)} />
      </div>
    </div>
  );
}
