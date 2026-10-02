/**
 * account.ts - the pure half of accounts and cloud sync.
 *
 * Signing in (Google or GitHub, via Supabase Auth) lets a user keep their
 * history, analyses and preferences across devices. The design keeps every
 * user independent of every other, so more users never slow anyone down:
 *
 *  - the browser talks to the database directly (Supabase's PostgREST); there
 *    is no server of ours in the path to become a bottleneck;
 *  - every table is keyed and indexed by user, and row-level security makes
 *    the database itself enforce that a user only ever touches their own rows;
 *  - this browser stays the source of truth: the app never waits on the
 *    network, writes are queued, deduplicated by content hash and sent in
 *    small batches, and a failure only delays the next flush (backoff).
 *
 * This file holds the parts that need no network: hashing, which settings
 * travel, row shapes and the upload queue. Pure, ASCII-only.
 */
import type { Snapshot } from "./documents";

/** localStorage keys that make up a user's preferences (never the Gemini key). */
export const SYNC_KEYS = [
  "cleanmath:ui:v1",
  "cleanmath:options:v1",
  "cleanmath:theme:v1",
  "cleanmath:palette:v1",
  "cleanmath:snippets:v1",
  "cleanmath:onboarded:v1",
] as const;

/** One value larger than this is not synced (a runaway snippet list, say). */
const MAX_VALUE = 64_000;

export type Settings = Partial<Record<(typeof SYNC_KEYS)[number], string>>;

/** cyrb53: a fast 53-bit string hash - plenty to deduplicate one user's texts. */
export function hashText(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ":" + s.length.toString(36);
}

/** The synced preferences, read through `read` (localStorage.getItem in the app). */
export function pickSettings(read: (key: string) => string | null): Settings {
  const out: Settings = {};
  for (const k of SYNC_KEYS) {
    const v = read(k);
    if (v !== null && v.length <= MAX_VALUE) out[k] = v;
  }
  return out;
}

/** Keys whose value differs between two settings objects. */
export function changedKeys(a: Settings, b: Settings): string[] {
  return SYNC_KEYS.filter((k) => (a[k] ?? null) !== (b[k] ?? null));
}

/** Only known keys with string values survive - whatever the server sent. */
export function reviveSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Settings = {};
  for (const k of SYNC_KEYS) if (typeof r[k] === "string" && (r[k] as string).length <= MAX_VALUE) out[k] = r[k] as string;
  return out;
}

/* ----------------------------------------------------------------- rows */

export interface SnapshotRow {
  text_hash: string;
  doc_title: string;
  text: string;
  reason: Snapshot["reason"];
  created_at: string;
}

/** Cloud history entries are capped in size, like local ones. */
export const CLOUD_TEXT_MAX = 200_000;

export function snapshotRow(s: Snapshot): SnapshotRow | null {
  if (!s.text.trim() || s.text.length > CLOUD_TEXT_MAX) return null;
  return {
    text_hash: hashText(s.text),
    doc_title: s.docTitle.slice(0, 200),
    text: s.text,
    reason: s.reason,
    created_at: new Date(s.at).toISOString(),
  };
}

/** A history list entry as the cloud returns it (the text itself is fetched on demand). */
export interface CloudEntry {
  id: string;
  docTitle: string;
  preview: string;
  at: number;
  hash: string;
}

export function reviveEntry(raw: unknown): CloudEntry | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.created_at !== "string") return null;
  return {
    id: r.id,
    docTitle: typeof r.doc_title === "string" ? r.doc_title : "",
    preview: typeof r.preview === "string" ? r.preview : "",
    at: Date.parse(r.created_at) || 0,
    hash: typeof r.text_hash === "string" ? r.text_hash : "",
  };
}

/* ------------------------------------------------------------- the queue */

/**
 * Snapshots waiting to be uploaded. Deduplicated by content (the same text
 * twice is one row), sent in batches, and after a failure held back with
 * exponential backoff instead of hammering the server.
 */
export class UploadQueue {
  private pending = new Map<string, SnapshotRow>();
  private failures = 0;
  private notBefore = 0;
  /** Snapshot ids already seen, so a re-read of local history adds nothing. */
  private seen = new Set<string>();

  constructor(
    readonly batchSize = 25,
    readonly maxPending = 200,
  ) {}

  /** Add local snapshots; returns how many were new. */
  add(list: ReadonlyArray<Snapshot>): number {
    let added = 0;
    for (const s of list) {
      if (this.seen.has(s.id)) continue;
      this.seen.add(s.id);
      const row = snapshotRow(s);
      if (!row) continue;
      this.pending.delete(row.text_hash); // re-insert: newest last
      this.pending.set(row.text_hash, row);
      added++;
    }
    // Offline for a long time: keep only the newest.
    while (this.pending.size > this.maxPending) this.pending.delete(this.pending.keys().next().value!);
    return added;
  }

  /** Mark existing snapshots as already handled (taken when sync starts). */
  skip(list: ReadonlyArray<Snapshot>): void {
    for (const s of list) this.seen.add(s.id);
  }

  get size(): number {
    return this.pending.size;
  }

  /** The next batch, or null when empty or still backing off at `now`. */
  next(now: number): SnapshotRow[] | null {
    if (!this.pending.size || now < this.notBefore) return null;
    return [...this.pending.values()].slice(0, this.batchSize);
  }

  done(batch: ReadonlyArray<SnapshotRow>): void {
    for (const r of batch) if (this.pending.get(r.text_hash) === r) this.pending.delete(r.text_hash);
    this.failures = 0;
    this.notBefore = 0;
  }

  failed(now: number): number {
    this.failures++;
    const delay = Math.min(5 * 60_000, 2000 * 2 ** (this.failures - 1));
    this.notBefore = now + delay;
    return delay;
  }
}

/* ------------------------------------------------------------- profile */

export interface Profile {
  id: string;
  name: string;
  email: string;
  avatar: string;
  provider: string;
}

/** Name, picture and provider from a Supabase user object (Google and GitHub differ). */
export function profileFrom(user: unknown): Profile | null {
  const u = (user ?? {}) as { id?: string; email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> };
  if (!u.id) return null;
  const m = u.user_metadata ?? {};
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof m[k] === "string" && m[k]) return m[k] as string;
    return "";
  };
  const email = u.email ?? pick("email");
  return {
    id: u.id,
    name: pick("full_name", "name", "user_name", "preferred_username") || email.split("@")[0] || "You",
    email,
    avatar: pick("avatar_url", "picture"),
    provider: typeof u.app_metadata?.provider === "string" ? (u.app_metadata.provider as string) : "",
  };
}

/** "DL" for "Dong Lee": shown in the circle when there is no picture. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
