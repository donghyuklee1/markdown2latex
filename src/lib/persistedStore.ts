/**
 * persistedStore.ts - a tiny external store over one localStorage key.
 *
 * The same shape as optionsStore, factored out because the workspace now keeps
 * several independent pieces of state (layout, draft). Each store:
 * - hands useSyncExternalStore a referentially stable snapshot,
 * - renders the defaults on the server, so the first paint is hydration-safe,
 * - follows other tabs through the `storage` event,
 * - never throws when storage is unavailable (private mode, quota, blocked),
 * - belongs to the signed-in account: its key is scoped (storageScope.ts) and
 *   it re-reads when the account changes.
 */
import { currentScope, onScopeChange, scopedKey } from "./storageScope";

export interface PersistedStore<T> {
  get: () => T;
  getServer: () => T;
  subscribe: (listener: () => void) => () => void;
  set: (next: T) => void;
  update: (patch: (prev: T) => T) => void;
}

export function createPersistedStore<T>(
  key: string,
  defaults: T,
  /** Coerce whatever was stored (possibly by an older version) into a valid T. */
  revive: (raw: unknown) => T,
  /** First run only (nothing stored yet): build the initial value from older keys. */
  migrate?: () => T | null,
): PersistedStore<T> {
  let cached: T | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  // Another account: forget the cached value, show theirs.
  onScopeChange(() => {
    cached = null;
    notify();
  });

  const get = (): T => {
    if (cached !== null) return cached;
    try {
      const raw = window.localStorage.getItem(scopedKey(key));
      // Old unscoped data is only ever adopted outside any account.
      cached = raw === null ? ((currentScope() ? null : migrate?.()) ?? defaults) : revive(JSON.parse(raw));
    } catch {
      cached = defaults;
    }
    return cached;
  };

  const set = (next: T) => {
    cached = next;
    try {
      window.localStorage.setItem(scopedKey(key), JSON.stringify(next));
    } catch {
      // Quota or disabled storage: the in-memory value still works this session.
    }
    notify();
  };

  return {
    get,
    getServer: () => defaults,
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== null && event.key !== scopedKey(key)) return;
        cached = null;
        notify();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    set,
    update: (patch) => set(patch(get())),
  };
}

/* ------------------------------------------------------------ layout prefs */

export type OutputTab = "code" | "preview" | "diff" | "graph";
export const OUTPUT_TABS: ReadonlyArray<OutputTab> = ["code", "preview", "diff", "graph"];
/** The cleaner workspace, or the Research Lab tools. */
export type AppView = "clean" | "lab";
/** What Cmd/Ctrl+Enter does. */
export type PrimaryAction = "copy" | "overleaf";
export type Focus = "none" | "input" | "output";

export interface UiPrefs {
  /** Share of the row the input pane takes on wide screens, 0.2 - 0.8. */
  split: number;
  /** Input pane height on narrow (stacked) screens, in px. */
  inputHeight: number;
  /** Editor and code font size in px. */
  fontSize: number;
  wrapInput: boolean;
  wrapOutput: boolean;
  tab: OutputTab;
  /** One pane maximised, or both visible. */
  focus: Focus;
  primaryAction: PrimaryAction;
  /** Scroll the output along with the editor. */
  syncScroll: boolean;
  view: AppView;
  /** Last Research Lab tool opened (a ToolId; validated where it is used). */
  labTool: string;
}

export const SPLIT_MIN = 0.2;
export const SPLIT_MAX = 0.8;
export const INPUT_HEIGHT_MIN = 180;
export const INPUT_HEIGHT_MAX = 900;
export const FONT_MIN = 11;
export const FONT_MAX = 20;

export const DEFAULT_UI: UiPrefs = {
  split: 0.5,
  inputHeight: 360,
  fontSize: 13,
  wrapInput: false,
  wrapOutput: false,
  tab: "code",
  focus: "none",
  primaryAction: "copy",
  syncScroll: true,
  view: "clean",
  labTool: "arxiv",
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export const uiStore = createPersistedStore<UiPrefs>("cleanmath:ui:v1", DEFAULT_UI, (raw) => {
  const r = (raw ?? {}) as Partial<UiPrefs>;
  return {
    split: clamp(r.split, SPLIT_MIN, SPLIT_MAX, DEFAULT_UI.split),
    inputHeight: clamp(r.inputHeight, INPUT_HEIGHT_MIN, INPUT_HEIGHT_MAX, DEFAULT_UI.inputHeight),
    fontSize: clamp(r.fontSize, FONT_MIN, FONT_MAX, DEFAULT_UI.fontSize),
    wrapInput: r.wrapInput === true,
    wrapOutput: r.wrapOutput === true,
    tab: r.tab && OUTPUT_TABS.includes(r.tab) ? r.tab : "code",
    focus: r.focus === "input" || r.focus === "output" ? r.focus : "none",
    primaryAction: r.primaryAction === "overleaf" ? "overleaf" : "copy",
    syncScroll: r.syncScroll !== false,
    view: r.view === "lab" ? "lab" : "clean",
    labTool: typeof r.labTool === "string" ? r.labTool : DEFAULT_UI.labTool,
  };
});

/* ------------------------------------------------------------------- draft */

/**
 * The input text, autosaved so a reload or an accidental tab close loses
 * nothing. `null` means "never edited": the sample answer is shown instead,
 * and a later change to the sample still reaches returning visitors.
 */
export const draftStore = createPersistedStore<string | null>("cleanmath:draft:v1", null, (raw) =>
  typeof raw === "string" ? raw : null,
);

/* -------------------------------------------------------------------- AI */

export interface AiSettings {
  /** The user's own Gemini API key; stays in this browser (and, if they choose, encrypted in their account). */
  apiKey: string;
  /** Chosen model id ("" = pick the newest Flash model the key can use). */
  model: string;
  /** AI mode: analyses run in the background as you write. On when a key is saved. */
  mode: boolean;
  /** Signed in: keep the key in the account (encrypted) so other devices get it. */
  remember: boolean;
}

export const aiStore = createPersistedStore<AiSettings>("cleanmath:ai:v1", { apiKey: "", model: "", mode: false, remember: true }, (raw) => {
  const r = (raw ?? {}) as Partial<AiSettings>;
  const apiKey = typeof r.apiKey === "string" ? r.apiKey : "";
  return {
    apiKey,
    model: typeof r.model === "string" ? r.model : "",
    // Keys saved before AI mode existed turn it on.
    mode: typeof r.mode === "boolean" ? r.mode && !!apiKey : !!apiKey,
    remember: typeof r.remember === "boolean" ? r.remember : true,
  };
});

/* -------------------------------------------------------- analysis cache */

export interface CachedAnalysis {
  at: number;
  model: string;
  /** Gemini's validated JSON (both parts merged), re-merged with the current text when shown. */
  result: unknown;
}

/** The last few analyses by text hash, so reopening a document needs no new LLM call. */
export const ANALYSIS_CACHE_MAX = 12;
export const analysisStore = createPersistedStore<Record<string, CachedAnalysis>>("cleanmath:analyses:v1", {}, (raw) => {
  if (!raw || typeof raw !== "object") return {};
  const entries = Object.entries(raw as Record<string, CachedAnalysis>).filter(([, v]) => v && typeof v.at === "number" && v.result && typeof v.result === "object");
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, ANALYSIS_CACHE_MAX));
});

export function cacheAnalysis(hash: string, model: string, result: unknown): void {
  analysisStore.update((prev) => {
    const next = Object.entries({ ...prev, [hash]: { at: Date.now(), model, result } }).sort((a, b) => b[1].at - a[1].at);
    return Object.fromEntries(next.slice(0, ANALYSIS_CACHE_MAX));
  });
}
