/**
 * optionsStore.ts - the user's formatting preferences, backed by localStorage.
 *
 * Modelled as an external store rather than React state restored in an effect.
 * That buys three things: no setState-during-effect cascade, a hydration-safe
 * first paint (the server snapshot is always the defaults), and free cross-tab
 * synchronisation via the `storage` event.
 */
import { DEFAULT_OPTIONS, type ConfigOptions } from "./cleaner";
import { onScopeChange, scopedKey } from "./storageScope";

const STORAGE_KEY = "cleanmath:options:v1";

let cached: ConfigOptions | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

// Each account keeps its own options.
onScopeChange(() => {
  cached = null;
  notify();
});

/**
 * `useSyncExternalStore` requires a referentially stable snapshot, so the parsed
 * value is cached until something actually changes it.
 */
export function getOptionsSnapshot(): ConfigOptions {
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(scopedKey(STORAGE_KEY));
    cached = raw ? { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<ConfigOptions>) } : DEFAULT_OPTIONS;
  } catch {
    // Private mode, disabled storage, corrupt JSON: defaults are a fine answer.
    cached = DEFAULT_OPTIONS;
  }
  return cached;
}

/** The server has no localStorage, so it always renders the defaults. */
export function getOptionsServerSnapshot(): ConfigOptions {
  return DEFAULT_OPTIONS;
}

export function subscribeToOptions(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== scopedKey(STORAGE_KEY)) return;
    cached = null; // another tab changed it: re-read on the next snapshot
    notify();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function setOptions(next: ConfigOptions): void {
  cached = next;
  try {
    window.localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(next));
  } catch {
    // The app works fine without persistence.
  }
  notify();
}
