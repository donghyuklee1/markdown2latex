import { check, finish } from "./harness";
import { currentScope, onScopeChange, SCOPE_KEY, scopedKey, setScope, wipeScope } from "../src/lib/storageScope";

/** A Storage stand-in. */
function memory(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    keys: () => [...m.keys()].sort(),
  };
}

check("signed out: keys are as they were", scopedKey("cleanmath:docs:v1"), "cleanmath:docs:v1");
check("an account gets its own key", scopedKey("cleanmath:docs:v1", "u1"), "cleanmath:u:u1:docs:v1");
check("two accounts never share a key", String(scopedKey("cleanmath:ai:v1", "u1") !== scopedKey("cleanmath:ai:v1", "u2")), "true");
check("device keys stay shared", [scopedKey("cleanmath:last-provider:v1", "u1"), scopedKey(SCOPE_KEY, "u1")].join(" "), "cleanmath:last-provider:v1 cleanmath:scope:v1");
check("foreign keys are untouched", scopedKey("sb-abc-auth-token", "u1"), "sb-abc-auth-token");
check("never double-scoped", scopedKey("cleanmath:u:u1:docs:v1", "u2"), "cleanmath:u:u1:docs:v1");

const store = memory();
let heard = 0;
const off = onScopeChange(() => heard++);
setScope("u1", store);
setScope("u1", store);
check("switching notifies once, and only on a real change", heard + " " + currentScope(), "1 u1");
check("the current scope is remembered for the next page load", String(store.getItem(SCOPE_KEY)), "u1");
check("keys follow the current scope", scopedKey("cleanmath:docs:v1"), "cleanmath:u:u1:docs:v1");
setScope("", store);
check("signing out forgets it", String(store.getItem(SCOPE_KEY)) + " " + scopedKey("cleanmath:docs:v1"), "null cleanmath:docs:v1");
off();

const device = memory({
  "cleanmath:docs:v1": "guest",
  "cleanmath:u:u1:docs:v1": "a",
  "cleanmath:u:u1:ai:v1": "key-a",
  "cleanmath:u:u2:docs:v1": "b",
  "cleanmath:last-provider:v1": "google",
});
check("wiping an account removes all of its keys", String(wipeScope("u1", device)), "2");
check("and nothing else", device.keys().join(","), "cleanmath:docs:v1,cleanmath:last-provider:v1,cleanmath:u:u2:docs:v1");
check("wiping nobody removes nothing", String(wipeScope("", device)), "0");
finish("storageScope");
