/**
 * storageScope.ts - every account gets its own corner of localStorage.
 *
 * While an account is signed in, a key "cleanmath:docs:v1" is stored as
 * "cleanmath:u:<account id>:docs:v1", so documents, history, snippets,
 * analyses, the Gemini key and preferences of one account are never read by
 * another account - or by a signed-out visitor - on the same device. Signing
 * out removes the account's corner entirely (wipeScope), after its data has
 * reached the account in the cloud.
 *
 * Every store asks `scopedKey` for its storage key and re-reads when the
 * scope changes (onScopeChange). A few keys belong to the device, not to an
 * account, and are never scoped. Pure apart from the storage it is handed.
 */

/** The last signed-in account, read by the theme bootstrap before first paint. */
export const SCOPE_KEY = "cleanmath:scope:v1";

/** Device-level keys: shared by whoever uses this browser. */
const DEVICE_KEYS = new Set([SCOPE_KEY, "cleanmath:last-provider:v1"]);

let scope = "";
const listeners = new Set<() => void>();

export const scopePrefix = (id: string) => "cleanmath:u:" + id + ":";

/** The storage key for `key` in a scope (the current one by default). */
export function scopedKey(key: string, s: string = scope): string {
  if (!s || DEVICE_KEYS.has(key) || !key.startsWith("cleanmath:") || key.startsWith("cleanmath:u:")) return key;
  return scopePrefix(s) + key.slice("cleanmath:".length);
}

export const currentScope = () => scope;

/** Switch accounts ("" = signed out). Stores re-read through onScopeChange. */
export function setScope(id: string, storage?: Pick<Storage, "setItem" | "removeItem">): void {
  if (id === scope) return;
  scope = id;
  try {
    if (id) storage?.setItem(SCOPE_KEY, id);
    else storage?.removeItem(SCOPE_KEY);
  } catch {
    // The bootstrap falls back to the default theme.
  }
  for (const l of listeners) l();
}

export function onScopeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Remove everything an account stored on this device. Returns how many keys went. */
export function wipeScope(id: string, storage: Pick<Storage, "length" | "key" | "removeItem">): number {
  if (!id) return 0;
  const prefix = scopePrefix(id);
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(prefix)) doomed.push(k);
  }
  for (const k of doomed) storage.removeItem(k);
  return doomed.length;
}
