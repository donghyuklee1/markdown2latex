import { check, finish } from "./harness";
import { changedKeys, docChanges, mergeDocs, hashText, initials, pickSettings, profileFrom, reviveEntry, reviveSettings, snapshotRow, SYNC_KEYS, UploadQueue } from "../src/lib/account";
import type { Snapshot } from "../src/lib/documents";

/* --- hashing ------------------------------------------------------------------- */
check("hash: stable", hashText("E = mc^2") === hashText("E = mc^2") ? "same" : "differs", "same");
check("hash: one character changes it", hashText("E = mc^2") === hashText("E = mc^3") ? "same" : "differs", "differs");
check("hash: short enough for the column (<= 40)", String(hashText("x".repeat(200000)).length <= 40), "true");

/* --- settings -------------------------------------------------------------------- */
const local: Record<string, string> = {
  "cleanmath:ui:v1": '{"fontSize":14}',
  "cleanmath:theme:v1": "dark",
  "cleanmath:ai:v1": '{"apiKey":"secret"}',
  "cleanmath:draft:v1": '"text"',
  "cleanmath:snippets:v1": "x".repeat(70000),
};
const picked = pickSettings((k) => local[k] ?? null);
check("settings: only preference keys travel - never the Gemini key or drafts", Object.keys(picked).sort().join(","), "cleanmath:theme:v1,cleanmath:ui:v1");
check("settings: the AI key is not a synced key", String(SYNC_KEYS.some((k) => k.includes(":ai:"))), "false");
check("settings: changed keys", changedKeys(picked, { ...picked, "cleanmath:theme:v1": "light" }).join(","), "cleanmath:theme:v1");
check("settings: revive drops unknown keys and non-strings", JSON.stringify(reviveSettings({ "cleanmath:theme:v1": "dark", "cleanmath:ai:v1": "k", "cleanmath:ui:v1": 3 })), '{"cleanmath:theme:v1":"dark"}');
check("settings: revive survives garbage", JSON.stringify(reviveSettings(null)), "{}");

/* --- rows -------------------------------------------------------------------------- */
const snap = (id: string, text: string, at = 1_700_000_000_000): Snapshot => ({ id, docTitle: "Doc", text, at, reason: "idle" });
check("row: empty text is not uploaded", String(snapshotRow(snap("a", "   "))), "null");
check("row: oversized text is not uploaded", String(snapshotRow(snap("a", "x".repeat(200001)))), "null");
check("row: ISO time and hash", JSON.stringify(Object.keys(snapshotRow(snap("a", "abc"))!)), '["text_hash","doc_title","text","reason","created_at"]');
check("entry: revived from a cloud row", JSON.stringify(reviveEntry({ id: "1", doc_title: "T", preview: "p", created_at: "2026-10-02T00:00:00Z", text_hash: "h" })), '{"id":"1","docTitle":"T","preview":"p","at":1790899200000,"hash":"h"}');
check("entry: junk is dropped", String(reviveEntry({ id: 3 })), "null");

/* --- upload queue ------------------------------------------------------------------------ */
const q = new UploadQueue(2, 3);
check("queue: new snapshots counted, same text twice is one row", q.add([snap("1", "a"), snap("2", "a"), snap("3", "b")]) + " " + q.size, "3 2");
check("queue: a re-read of history adds nothing", String(q.add([snap("1", "a"), snap("3", "b")])), "0");
check("queue: batches of batchSize", String(q.next(0)?.length), "2");
const b1 = q.next(0)!;
check("queue: backoff after a failure", q.failed(1000) + " " + String(q.next(1500)) + " " + q.next(3001)?.length, "2000 null 2");
check("queue: backoff doubles", String(q.failed(0)), "4000");
q.done(b1);
check("queue: done empties and resets backoff", q.size + " " + String(q.next(0)), "0 null");
q.add([snap("4", "c"), snap("5", "d"), snap("6", "e"), snap("7", "f")]);
check("queue: offline for long - only the newest are kept", q.next(0)!.map((r) => r.text).join("") + " " + q.size, "de 3");
const q2 = new UploadQueue();
q2.skip([snap("9", "old")]);
check("queue: skipped snapshots are never uploaded", String(q2.add([snap("9", "old")])), "0");

/* --- profile ------------------------------------------------------------------------------ */
const google = profileFrom({ id: "u1", email: "ada@example.com", user_metadata: { full_name: "Ada Lovelace", avatar_url: "https://lh3.example/a.png" }, app_metadata: { provider: "google" } });
check("profile: Google", [google?.name, google?.avatar, google?.provider].join("|"), "Ada Lovelace|https://lh3.example/a.png|google");
const github = profileFrom({ id: "u2", email: "", user_metadata: { user_name: "octo", avatar_url: "https://avatars.example/o" }, app_metadata: { provider: "github" } });
check("profile: GitHub without a full name uses the login", [github?.name, github?.provider].join("|"), "octo|github");
check("profile: no user, no profile", String(profileFrom(null)), "null");
check("initials", [initials("Ada Lovelace"), initials("octo"), initials("  ")].join(" "), "AL O ?");

/* --- documents ----------------------------------------------------------------- */
const doc = (id: string, text: string, updatedAt: number, title = "") => ({ id, title, text, updatedAt });
const row = (id: string, text: string, at: number, position: number) => ({ id, title: "", text, position, updated_at: new Date(at).toISOString() });
const merged = mergeDocs([doc("a", "local newer", 300), doc("b", "only here", 100)], [row("c", "only there", 50, 0), row("a", "cloud older", 200, 1)], 12);
check("merge: the account's order first, then documents only on this device", merged.map((d) => d.id).join(","), "c,a,b");
check("merge: per document the newer edit wins", merged.find((d) => d.id === "a")!.text ?? "", "local newer");
check("merge: a newer cloud copy replaces an older local one", mergeDocs([doc("a", "old", 1)], [row("a", "new", 9, 0)], 12)[0].text ?? "", "new");
check("merge: capped at the tab limit", String(mergeDocs([doc("a", "", 1), doc("b", "", 1)], [], 1).length), "1");
check("merge: junk rows are ignored", String(mergeDocs([], [null, { title: "x" }], 12).length), "0");
const first = docChanges(new Map(), [doc("a", "x", 1), doc("b", "y", 1)]);
check("changes: everything is new the first time", first.upsert.map((r) => r.id).join(",") + " / " + first.remove.length, "a,b / 0");
const second = docChanges(first.next, [doc("a", "x", 1), doc("b", "y2", 2)]);
check("changes: only what changed is sent", second.upsert.map((r) => r.id).join(","), "b");
const third = docChanges(second.next, [doc("b", "y2", 2)]);
check("changes: a closed tab is removed (and the rest moved up)", third.remove.join(",") + " / " + third.upsert.map((r) => r.id + "@" + r.position).join(","), "a / b@0");
finish("account");
