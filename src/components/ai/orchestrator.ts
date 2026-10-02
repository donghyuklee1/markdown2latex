"use client";

/**
 * orchestrator.ts - AI work runs beside the editor, never in its way.
 *
 * Cleaning and rendering are synchronous and local; they never wait for this.
 * With AI mode on, a pause in editing that changed the *mathematics* (the
 * cache key ignores prose, spacing and formatting - lib/derivation
 * `analysisKey`) starts a background analysis: both parts in parallel, the
 * steps published the moment they land, the glossary merged after. A newer
 * change cancels a stale run (AbortController), background runs are spaced to
 * respect the free tier's per-minute limits, and every result is cached here
 * and, signed in, in the account - the same mathematics is never paid for
 * twice.
 */
import { useEffect } from "react";
import { hashText } from "@/lib/account";
import { analysisKey, offlineModel, type AiPart } from "@/lib/derivation";
import { aiStore, analysisStore, cacheAnalysis } from "@/lib/persistedStore";
import { cloudAnalysis, saveCloudAnalysis } from "../account/cloud";
import { AiError, analyzePart } from "../derivation/gemini";
import { currentModel } from "./aiKey";

export interface RunState {
  key: string | null;
  phase: "idle" | "running" | "error";
  /** The steps part, as soon as it arrives (raw, validated when merged). */
  partial: unknown | null;
  error: string | null;
  model: string;
  background: boolean;
  /** Seconds the last finished run took. */
  took: number | null;
}

let state: RunState = { key: null, phase: "idle", partial: null, error: null, model: "", background: false, took: null };
const SERVER = state;
const listeners = new Set<() => void>();
const set = (patch: Partial<RunState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const runStore = {
  get: () => state,
  getServer: () => SERVER,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const keyFor = (input: string) => analysisKey(input, hashText);

let controller: AbortController | null = null;
let lastBackground = 0;
/** Two requests per run; keep background runs at least this far apart. */
const BACKGROUND_GAP_MS = 12_000;

export type RunOutcome = "cached" | "cloud" | "done" | "no-key" | "nothing" | "cancelled" | "error";

/**
 * Analyse `input` now (or, with `background`, only when the mathematics is
 * new and the spacing allows). Never throws; the outcome says what happened.
 */
export async function runAnalysis(input: string, opts: { background?: boolean; force?: boolean } = {}): Promise<RunOutcome> {
  const ai = aiStore.get();
  if (!offlineModel(input).steps.length && !input.trim()) return "nothing";
  const key = keyFor(input);
  if (!opts.force && analysisStore.get()[key]) return "cached";
  if (opts.background) {
    if (!ai.mode || !ai.apiKey) return "no-key";
    if (Date.now() - lastBackground < BACKGROUND_GAP_MS) return "cancelled";
    lastBackground = Date.now();
  }

  // Analysed before on another device: free.
  if (!opts.force) {
    const remote = await cloudAnalysis(key).catch(() => null);
    if (remote && typeof remote === "object") {
      cacheAnalysis(key, "", remote);
      return "cloud";
    }
  }
  if (!ai.apiKey) return "no-key";

  controller?.abort();
  const mine = new AbortController();
  controller = mine;
  const started = performance.now();
  set({ key, phase: "running", partial: null, error: null, background: !!opts.background, took: null });
  try {
    const model = await currentModel();
    const run = (part: AiPart) => analyzePart(input, part, ai.apiKey, model, mine.signal);
    const stepsP = run("steps");
    const glossaryP = run("glossary").catch((e: unknown) => {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      return null; // the steps alone are still worth showing
    });
    const steps = await stepsP;
    if (controller !== mine) return "cancelled";
    set({ partial: steps.json, model: steps.model });
    const glossary = await glossaryP;
    if (controller !== mine) return "cancelled";
    const raw = { ...(steps.json as object), ...((glossary?.json as object) ?? {}) };
    cacheAnalysis(key, steps.model, raw);
    saveCloudAnalysis(key, steps.model, raw);
    set({ phase: "idle", partial: null, took: Math.round((performance.now() - started) / 100) / 10 });
    return "done";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
    if (controller === mine) set({ phase: "error", partial: null, error: e instanceof AiError ? e.message : "Analysis failed: " + String(e) });
    return "error";
  } finally {
    if (controller === mine) controller = null;
  }
}

/** Stop whatever is running (the text changed, or AI mode went off). */
export function cancelAnalysis(): void {
  controller?.abort();
  controller = null;
  if (state.phase === "running") set({ phase: "idle", partial: null });
}

/**
 * Mounted once by the workspace: in AI mode, analyse in the background after a
 * pause in editing. Prose-only edits keep the cache key and cost nothing.
 */
export function useAutoAnalysis(input: string, mode: boolean, hasKey: boolean): void {
  useEffect(() => {
    if (!mode || !hasKey) return;
    if (state.phase === "running" && state.key !== keyFor(input)) cancelAnalysis();
    // After a pause - and never sooner than the spacing between background runs.
    const wait = Math.max(1800, BACKGROUND_GAP_MS - (Date.now() - lastBackground) + 50);
    const t = window.setTimeout(() => {
      const idle = (cb: () => void) => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(cb, { timeout: 1500 }) : setTimeout(cb, 0));
      idle(() => void runAnalysis(input, { background: true }));
    }, wait);
    return () => window.clearTimeout(t);
  }, [input, mode, hasKey]);

  useEffect(() => {
    if (!mode) cancelAnalysis();
  }, [mode]);
}
