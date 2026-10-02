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
  docChanges,
  mergeDocs,
  pickSettings,
  profileFrom,
  reviveEntry,
  reviveSettings,

  UploadQueue,
  type CloudEntry,
  type Profile,
  type Settings,
} from "@/lib/account";
import { docsStore, historyStore, MAX_DOCS } from "@/lib/documents";
import { scopedKey, setScope, wipeScope } from "@/lib/storageScope";
import { aiStore } from "@/lib/persistedStore";
import { clearDriveToken, DRIVE_SCOPE, setSignInToken } from "../drive/drive";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** Accounts are switched on per deployment by two public env vars. */
export const accountsEnabled = !!(URL_ && ANON);

export type Provider = "google" | "github";

export interface AccountState {
  /** "checking": accounts are on and we do not know yet whether someone is signed in. */
  status: "disabled" | "checking" | "idle" | "loading" | "signed-in";
  profile: Profile | null;
  sync: { state: "idle" | "syncing" | "error" | "offline"; at: number | null; pending: number };
  /** The account's synced preferences have been pulled at least once this session. */
  ready: boolean;
  /** Set once when the user arrives back from Google/GitHub signed in (not a restored session). */
  justSignedIn: boolean;
  /** Why the last sign-in failed (the provider's message), or null. */
  error: string | null;
}

/* ------------------------------------------------------------ store */

let state: AccountState = { status: accountsEnabled ? "checking" : "disabled", profile: null, sync: { state: "idle", at: null, pending: 0 }, ready: false, justSignedIn: false, error: null };
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
  if (!returning && !hasStoredSession()) {
    emit({ status: "idle" });
    return;
  }
  cameBack = /[?&]code=/.test(window.location.search);
  void connect();
}

/** The page was opened by the provider's redirect (so a session now is a fresh sign-in). */
let cameBack = false;

/** The welcome has been shown; clear the flag. */
export function ackSignIn(): void {
  if (state.justSignedIn) emit({ justSignedIn: false });
}

export function clearSignInError(): void {
  if (state.error) emit({ error: null });
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
        // Fresh from Google: its access token also opens Drive (drive.file) for an hour.
        if (event === "SIGNED_IN" && cameBack && session.provider_token && session.user.app_metadata?.provider === "google") setSignInToken(session.provider_token);
        const profile = profileFrom(session.user);
        const fresh = state.profile?.id !== profile?.id;
        // This account's own storage, before anything of it is shown.
        if (profile) setScope(profile.id, window.localStorage);
        emit({ status: "signed-in", profile, error: null, justSignedIn: fresh && cameBack, ready: fresh ? false : state.ready });
        if (fresh) void startSync(sb);
      } else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        stopSync();
        if (event === "SIGNED_OUT") clearDriveToken();
        setScope("", window.localStorage);
        emit({ status: "idle", profile: null, sync: { state: "idle", at: null, pending: 0 }, ready: false });
      }
    }, 0);
  });
  // Back from the provider: drop ?code=... from the address bar. A refusal
  // ("access_denied" when the user cancels) comes back as error_description.
  if (/[?&](code|error|error_description)=/.test(window.location.search)) {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error_description") ?? params.get("error");
    // A share link opened before signing in comes back with its #fragment.
    let hash = window.location.hash;
    try {
      hash ||= window.sessionStorage.getItem(PENDING_HASH) ?? "";
      window.sessionStorage.removeItem(PENDING_HASH);
    } catch {
      // nothing stashed
    }
    window.history.replaceState(null, "", window.location.pathname + hash);
    if (err) emit({ status: "idle", error: err.replace(/\+/g, " ") });
  }
  return sb;
}

/** The provider used last in this browser, offered first next time. */
export const LAST_PROVIDER_KEY = "cleanmath:last-provider:v1";

const PENDING_HASH = "cleanmath:pending-hash";

export async function signIn(provider: Provider): Promise<void> {
  try {
    window.localStorage.setItem(LAST_PROVIDER_KEY, provider);
    // The provider's redirect drops the #fragment (a share link): keep it for the way back.
    if (window.location.hash) window.sessionStorage.setItem(PENDING_HASH, window.location.hash);
  } catch {
    // Not remembered - harmless.
  }
  const sb = await connect();
  emit({ status: "loading", error: null });
  const { error } = await sb.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      // Google sign-in also grants Drive access to the files this app saves or the user picks.
      ...(provider === "google" ? { scopes: DRIVE_SCOPE, queryParams: { include_granted_scopes: "true" } } : {}),
    },
  });
  if (error) {
    emit({ status: "idle" });
    throw error;
  }
}

/**
 * Sign out of this device. Everything the account changed is sent first;
 * then the account's storage on this device is wiped, so nothing it created
 * stays visible here. If the account cannot be reached, nothing is wiped and
 * "pending" comes back - `force` signs out anyway (unsent changes are lost).
 * Other devices stay signed in (scope "local").
 */
export async function signOut(force = false): Promise<"done" | "pending"> {
  const uid = state.profile?.id ?? "";
  const synced = await flushAll();
  if (!synced && !force) return "pending";
  const sb = await client();
  await sb.auth.signOut({ scope: "local" });
  stopSync();
  setScope("", window.localStorage);
  wipeScope(uid, window.localStorage);
  emit({ status: "idle", profile: null, sync: { state: "idle", at: null, pending: 0 }, ready: false });
  return "done";
}

/** Send everything waiting: history, documents, preferences. True when all of it arrived. */
async function flushAll(): Promise<boolean> {
  if (state.status !== "signed-in") return true;
  window.clearTimeout(docsTimer);
  await flush();
  const docs = await pushDocs();
  await pushSettings();
  return docs && queue.size === 0;
}

/** Removes the user's history, analyses and settings from the cloud (not from this browser). */
export async function deleteCloudData(): Promise<void> {
  const sb = await client();
  const { error } = await sb.rpc("delete_my_data");
  if (error) throw error;
  lastSettings = {};
}

/* ------------------------------------------------------------- sync */

let queue = new UploadQueue();
let stops: Array<() => void> = [];
let flushTimer: number | undefined;
let settingsTimer: number | undefined;
let lastSettings: Settings = {};
let settingsAt = 0;
let applying = false;

/** Preferences are read and written in the signed-in account's own storage. */
const read = (k: string) => {
  try {
    return window.localStorage.getItem(scopedKey(k));
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
  let sent = false;
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
    sent = true;
  }
  // Nothing to send says nothing about the connection: keep a known error.
  if (sent || (state.sync.state !== "error" && state.sync.state !== "offline")) setSync({ state: "idle", at: Date.now() });
}

/** Write remote preferences into this browser; the stores re-read on the storage event. */
function applySettings(remote: Settings) {
  applying = true;
  try {
    for (const k of changedKeys(pickSettings(read), remote)) {
      const v = remote[k as keyof Settings];
      if (v === undefined) continue;
      try {
        window.localStorage.setItem(scopedKey(k), v);
      } catch {
        continue;
      }
      window.dispatchEvent(new StorageEvent("storage", { key: scopedKey(k), newValue: v }));
    }
  } finally {
    applying = false;
  }
  lastSettings = pickSettings(read);
}

async function pullSettings(sb: SupabaseClient, initial: boolean) {
  const { data, error } = await sb.from("user_settings").select("settings, updated_at").maybeSingle();
  if (error) {
    setSync({ state: navigator.onLine ? "error" : "offline" });
    return;
  }
  if (state.sync.state === "error" || state.sync.state === "offline") setSync({ state: "idle", at: Date.now() });
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
  // A fresh start for this account: nothing queued from anyone else.
  queue = new UploadQueue();
  lastSettings = {};
  settingsAt = 0;
  docsSent = new Map();
  setSync({ state: "syncing" });
  emit({ ready: false });
  // The editor opens on this account's own documents and preferences - so it
  // waits for them, but never longer than a few seconds on a slow network.
  await Promise.race([Promise.all([pullSettings(sb, true), pullDocs(sb)]), new Promise((r) => setTimeout(r, 4000))]);
  emit({ ready: true });

  // Documents: sent a moment after each change.
  stops.push(
    docsStore.subscribe(() => {
      window.clearTimeout(docsTimer);
      docsTimer = window.setTimeout(() => void pushDocs(), 1500);
    }),
  );

  // The Gemini key, if this account keeps one (encrypted with Supabase Vault).
  void restoreKey(sb);

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
  window.clearTimeout(docsTimer);
}

/* ----------------------------------------------------------- documents */

let docsSent = new Map<string, string>();
let docsTimer: number | undefined;

/** The account's documents, merged with whatever this device still has of them. */
async function pullDocs(sb: SupabaseClient): Promise<void> {
  const { data, error } = await sb.from("documents").select("id, title, text, position, updated_at").order("position");
  if (error || !data?.length) {
    // A new account (or offline): what is here goes up.
    void pushDocs();
    return;
  }
  const local = docsStore.get();
  // The untouched starter tab of a fresh device is not a document of anyone's.
  const mine = local.docs.filter((d) => d.updatedAt > 0 || d.text !== null);
  const merged = mergeDocs(mine, data, MAX_DOCS);
  docsStore.set({ docs: merged, active: merged.some((d) => d.id === local.active) ? local.active : merged[0].id });
  void pushDocs();
}

/** Send the documents that changed; remove the ones closed here. */
async function pushDocs(): Promise<boolean> {
  if (state.status !== "signed-in") return false;
  const { upsert, remove, next } = docChanges(docsSent, docsStore.get().docs);
  if (!upsert.length && !remove.length) return true;
  const sb = await client();
  const up = upsert.length ? await sb.from("documents").upsert(upsert, { onConflict: "user_id,id" }) : { error: null };
  const del = !up.error && remove.length ? await sb.from("documents").delete().in("id", remove) : { error: null };
  if (up.error || del.error) {
    setSync({ state: navigator.onLine ? "error" : "offline" });
    window.clearTimeout(docsTimer);
    docsTimer = window.setTimeout(() => void pushDocs(), 10_000);
    return false;
  }
  docsSent = next;
  setSync({ state: "idle", at: Date.now() });
  return true;
}

/* --------------------------------------------------- Gemini key (Vault) */

/**
 * The account's Gemini key lives in Supabase Vault - encrypted at rest - and is
 * reachable only through two functions that act on the caller's own row
 * (supabase/migrations). It is never part of the synced preferences.
 */
async function restoreKey(sb: SupabaseClient) {
  const local = aiStore.get();
  if (local.apiKey || !local.remember) return;
  const { data, error } = await sb.rpc("get_gemini_key");
  if (error || typeof data !== "string" || !data) return;
  // A key saved on another device: AI mode comes on here too.
  aiStore.set({ ...aiStore.get(), apiKey: data, mode: true });
}

/** Keep (or with null, remove) the key in the account. No-op when signed out. */
export async function saveKeyToAccount(key: string | null): Promise<boolean> {
  if (state.status !== "signed-in") return false;
  const sb = await client();
  const { error } = await sb.rpc("set_gemini_key", { new_key: key ?? "" });
  return !error;
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

/** `key` is the analysis cache key (lib/derivation analysisKey): the mathematics, normalized. */
export async function cloudAnalysis(key: string): Promise<unknown | null> {
  if (state.status !== "signed-in") return null;
  const sb = await client();
  const { data } = await sb.from("analyses").select("result").eq("input_hash", key).maybeSingle();
  return data?.result ?? null;
}

export function saveCloudAnalysis(key: string, model: string, result: unknown): void {
  if (state.status !== "signed-in") return;
  void client().then((sb) => sb.from("analyses").upsert({ input_hash: key, model, result, created_at: new Date().toISOString() }, { onConflict: "user_id,input_hash" }));
}

