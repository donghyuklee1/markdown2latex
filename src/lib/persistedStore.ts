/**
 * persistedStore.ts - a tiny external store over one localStorage key.
 *
 * The same shape as optionsStore, factored out because the workspace now keeps
 * several independent pieces of state (layout, draft). Each store:
 * - hands useSyncExternalStore a referentially stable snapshot,
 * - renders the defaults on the server, so the first paint is hydration-safe,
 * - follows other tabs through the `storage` event,
 * - never throws when storage is unavailable (private mode, quota, blocked).
 */

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
): PersistedStore<T> {
  let cached: T | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  const get = (): T => {
    if (cached !== null) return cached;
    try {
      const raw = window.localStorage.getItem(key);
      cached = raw === null ? defaults : revive(JSON.parse(raw));
    } catch {
      cached = defaults;
    }
    return cached;
  };

  const set = (next: T) => {
    cached = next;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
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
        if (event.key !== null && event.key !== key) return;
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

export type OutputTab = "code" | "preview";
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
    tab: r.tab === "preview" ? "preview" : "code",
    focus: r.focus === "input" || r.focus === "output" ? r.focus : "none",
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
