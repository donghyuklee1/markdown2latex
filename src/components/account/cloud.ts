/**
 * cloud.ts - accounts (Google / GitHub through Supabase Auth) and background
 * sync of history, analyses and preferences. See lib/account.ts for the
 * design; this file is the network half.
 *
 * Nothing here runs for a visitor who has never signed in: the Supabase
 * library is loaded only when a session exists, the URL is returning from a
 * sign-in, or the user presses a sign-in button. Local storage stays the
 * source of truth - the app never waits on any of this.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  changedKeys,
  hashText,
  pickSettings,
  profileFrom,
  reviveEntry,
  reviveSettings,

  UploadQueue,
  type CloudEntry,
  type Profile,
  type Settings,
} from "@/lib/account";
import { historyStore } from "@/lib/documents";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Accounts are switched on per deployment by two public env vars. */
export const accountsEnabled = !!(URL_ && ANON);

export type Provider = "google" | "github";

export interface AccountState {
  status: "disabled" | "idle" | "loading" | "signed-in";
  profile: Profile | null;
  sync: { state: "idle" | "syncing" | "error" | "offline"; at: number | null; pending: number };
}

/* ------------------------------------------------------------ store */

let state: AccountState = { status: accountsEnabled ? "idle" : "disabled", profile: null, sync: { state: "idle", at: null, pending: 0 } };
const SERVER_STATE = state;
const listeners = new Set<() => void>();
const emit = (patch: Partial<AccountState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
export const accountStore = {
  get: () => state,
  getServer: () => SERVER_STATE,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/* ------------------------------------------------------------ client */

let clientPromise: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL_, ANON, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
  );
  return clientPromise;
}

/** A stored session (supabase-js keeps it under sb-<project>-auth-token). */
function hasStoredSession(): boolean {
  try {
    const ref = new URL(URL_).hostname.split(".")[0];
    return window.localStorage.getItem("sb-" + ref + "-auth-token") !== null;
  } catch {
    return false;
  }
}

let started = false;

/** Called once on page load: restores a session if there is one. */
export function initAccount(): void {
  if (!accountsEnabled || started || typeof window === "undefined") return;
  const returning = /[?&]code=/.test(window.location.search) || /[?&]error_description=/.test(window.location.search);
  if (!returning && !hasStoredSession()) return;
  void connect();
}

async function connect(): Promise<SupabaseClient> {
  const sb = await client();
  if (started) return sb;
  started = true;
  emit({ status: "loading" });
  sb.auth.onAuthStateChange((event, session) => {
    // Supabase warns against awaiting its calls inside this callback.
    setTimeout(() => {
      if (session?.user) {
        const profile = profileFrom(session.user);
        const fresh = state.profile?.id !== profile?.id;
        emit({ status: "signed-in", profile });
        if (fresh) void startSync(sb);
      } else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        stopSync();
        emit({ status: "idle", profile: null, sync: { state: "idle", at: null, pending: 0 } });
      }
    }, 0);
  });
  // Back from the provider: drop ?code=... from the address bar.
  if (/[?&](code|error|error_description)=/.test(window.location.search)) {
    const err = new URLSearchParams(window.location.search).get("error_description");
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (err) emit({ status: "idle" });
  }
  return sb;
}

export async function signIn(provider: Provider): Promise<void> {
  const sb = await connect();
  emit({ status: "loading" });
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin + window.location.pathname } });
  if (error) {
    emit({ status: "idle" });
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await flush();
  const sb = await client();
  await sb.auth.signOut();
}

/** Removes the user's history, analyses and settings from the cloud (not from this browser). */
export async function deleteCloudData(): Promise<void> {
  const sb = await client();
  const { error } = await sb.rpc("delete_my_data");
  if (error) throw error;
  lastSettings = {};
}

/* ------------------------------------------------------------- sync */

const queue = new UploadQueue();
let stops: Array<() => void> = [];
let flushTimer: number | undefined;
let settingsTimer: number | undefined;
let lastSettings: Settings = {};
let settingsAt = 0;
let applying = false;

const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};

function setSync(patch: Partial<AccountState["sync"]>) {
  emit({ sync: { ...state.sync, pending: queue.size, ...patch } });
}

function scheduleFlush(ms = 4000) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), ms);
}

/** Send what is queued, one batch at a time. */
async function flush(): Promise<void> {
  if (state.status !== "signed-in") return;
  const sb = await client();
  for (let batch = queue.next(Date.now()); batch; batch = queue.next(Date.now())) {
    setSync({ state: "syncing" });
    const { error } = await sb.from("snapshots").upsert(batch, { onConflict: "user_id,text_hash", ignoreDuplicates: true });
    if (error) {
      const wait = queue.failed(Date.now());
      setSync({ state: navigator.onLine ? "error" : "offline" });
      scheduleFlush(wait);
      return;
    }
    queue.done(batch);
  }
  setSync({ state: "idle", at: Date.now() });
}

/** Write remote preferences into this browser; the stores re-read on the storage event. */
function applySettings(remote: Settings) {
  applying = true;
  try {
    for (const k of changedKeys(pickSettings(read), remote)) {
      const v = remote[k as keyof Settings];
      if (v === undefined) continue;
      try {
        window.localStorage.setItem(k, v);
      } catch {
        continue;
      }
      window.dispatchEvent(new StorageEvent("storage", { key: k, newValue: v }));
    }
  } finally {
    applying = false;
  }
  lastSettings = pickSettings(read);
}

async function pullSettings(sb: SupabaseClient, initial: boolean) {
  const { data, error } = await sb.from("user_settings").select("settings, updated_at").maybeSingle();
  if (error) return;
  if (data) {
    const at = Date.parse(data.updated_at as string) || 0;
    if (initial || at > settingsAt) {
      settingsAt = at;
      applySettings(reviveSettings(data.settings));
    }
  } else if (initial) {
    // First sign-in anywhere: this browser's preferences become the account's.
    lastSettings = {};
    await pushSettings();
  }
}

async function pushSettings() {
  if (state.status !== "signed-in") return;
  const now = pickSettings(read);
  if (!changedKeys(now, lastSettings).length) return;
  const sb = await client();
  const { error } = await sb.from("user_settings").upsert({ settings: now, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (!error) {
    lastSettings = now;
    settingsAt = Date.now();
  }
}

function onLocalSettings() {
  if (applying) return;
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => void pushSettings(), 2500);
}

async function startSync(sb: SupabaseClient) {
  stopSync();
  setSync({ state: "syncing" });
  await pullSettings(sb, true);

  // Everything already in local history goes up once (duplicates are ignored).
  queue.add(historyStore.get());
  scheduleFlush(500);

  stops.push(
    historyStore.subscribe(() => {
      if (queue.add(historyStore.get())) {
        setSync({});
        scheduleFlush();
      }
    }),
  );

  // Preferences: watch the same storage keys the stores use. Same-tab writes do
  // not fire `storage`, so poll cheaply (string compares) every few seconds.
  const poll = window.setInterval(() => {
    if (changedKeys(pickSettings(read), lastSettings).length) onLocalSettings();
  }, 3000);
  stops.push(() => window.clearInterval(poll));

  // Another device may have changed something: look again when we come back.
  const onFocus = () => void pullSettings(sb, false);
  const onHide = () => document.visibilityState === "hidden" && void flush();
  const onOnline = () => scheduleFlush(200);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("online", onOnline);
  stops.push(() => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("online", onOnline);
  });
}

function stopSync() {
  for (const s of stops) s();
  stops = [];
  window.clearTimeout(flushTimer);
  window.clearTimeout(settingsTimer);
}

/* ------------------------------------------------------- history API */

const PAGE = 30;

/** One page of cloud history, newest first; `before` is the last entry's time. */
export async function listCloudHistory(before?: number, query = ""): Promise<CloudEntry[]> {
  const sb = await client();
  let q = sb.from("snapshots").select("id, doc_title, preview, created_at, text_hash").order("created_at", { ascending: false }).limit(PAGE);
  if (before) q = q.lt("created_at", new Date(before).toISOString());
  const term = query.trim().replace(/[%_,()\\]/g, " ").slice(0, 80);
  if (term) q = q.or("doc_title.ilike.%" + term + "%,text.ilike.%" + term + "%");
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(reviveEntry).filter((e): e is CloudEntry => !!e);
}

export const CLOUD_PAGE = PAGE;

export async function cloudText(id: string): Promise<string> {
  const sb = await client();
  const { data, error } = await sb.from("snapshots").select("text").eq("id", id).single();
  if (error) throw error;
  return (data?.text as string) ?? "";
}

/* ------------------------------------------------------ analyses API */

export async function cloudAnalysis(input: string): Promise<unknown | null> {
  if (state.status !== "signed-in") return null;
  const sb = await client();
  const { data } = await sb.from("analyses").select("result").eq("input_hash", hashText(input)).maybeSingle();
  return data?.result ?? null;
}

export function saveCloudAnalysis(input: string, model: string, result: unknown): void {
  if (state.status !== "signed-in") return;
  void client().then((sb) =>
    sb.from("analyses").upsert({ input_hash: hashText(input), model, result, created_at: new Date().toISOString() }, { onConflict: "user_id,input_hash" }),
  );
}

