/**
 * documents.ts - several drafts at once, their history, and saved snippets.
 *
 * All three are external stores over localStorage (see persistedStore.ts), so
 * they hydrate safely, survive reloads and stay in step across tabs. Nothing
 * here touches the DOM beyond storage access inside the store functions.
 */
import { createPersistedStore } from "./persistedStore";

/* ---------------------------------------------------------------- documents */

export interface Doc {
  id: string;
  /** User-chosen name; empty means "derive one from the text". */
  title: string;
  /** null = never edited, show the sample answer. */
  text: string | null;
  updatedAt: number;
}

export interface DocsState {
  docs: Doc[];
  active: string;
}

export const MAX_DOCS = 12;

const newId = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const FIRST: DocsState = { docs: [{ id: "d1", title: "", text: null, updatedAt: 0 }], active: "d1" };

export const docsStore = createPersistedStore<DocsState>(
  "cleanmath:docs:v1",
  FIRST,
  (raw) => {
    const r = raw as Partial<DocsState> | null;
    const docs = Array.isArray(r?.docs)
      ? r.docs
          .filter((d): d is Doc => !!d && typeof d.id === "string")
          .map((d) => ({
            id: d.id,
            title: typeof d.title === "string" ? d.title : "",
            text: typeof d.text === "string" ? d.text : null,
            updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
          }))
          .slice(0, MAX_DOCS)
      : [];
    if (!docs.length) return FIRST;
    const active = docs.some((d) => d.id === r?.active) ? (r!.active as string) : docs[0].id;
    return { docs, active };
  },
  // Before tabs existed there was one autosaved draft; it becomes the first tab.
  () => {
    try {
      const legacy = window.localStorage.getItem("cleanmath:draft:v1");
      const text = legacy ? (JSON.parse(legacy) as unknown) : null;
      return typeof text === "string" ? { docs: [{ id: "d1", title: "", text, updatedAt: Date.now() }], active: "d1" } : null;
    } catch {
      return null;
    }
  },
);

export function activeDoc(state: DocsState): Doc {
  return state.docs.find((d) => d.id === state.active) ?? state.docs[0];
}

/** A tab label: the user's name, else the first heading or line of text. */
export function docTitle(doc: Doc, fallbackIndex: number): string {
  if (doc.title.trim()) return doc.title.trim();
  if (doc.text === null) return "Sample";
  const line = doc.text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/[$\\{}]/g, "").trim())
    .find((l) => l.length > 0);
  if (!line) return "Untitled " + fallbackIndex;
  return line.length > 22 ? line.slice(0, 21).trimEnd() + "\u2026" : line;
}

export const docs = {
  setText(text: string) {
    docsStore.update((s) => ({
      ...s,
      docs: s.docs.map((d) => (d.id === s.active ? { ...d, text, updatedAt: Date.now() } : d)),
    }));
  },
  open(id: string) {
    docsStore.update((s) => (s.docs.some((d) => d.id === id) ? { ...s, active: id } : s));
  },
  /** Returns the new id, or null when the tab limit is reached. */
  create(text = "", title = ""): string | null {
    const s = docsStore.get();
    if (s.docs.length >= MAX_DOCS) return null;
    const doc: Doc = { id: newId(), title, text, updatedAt: Date.now() };
    docsStore.set({ docs: [...s.docs, doc], active: doc.id });
    return doc.id;
  },
  rename(id: string, title: string) {
    docsStore.update((s) => ({ ...s, docs: s.docs.map((d) => (d.id === id ? { ...d, title: title.slice(0, 40) } : d)) }));
  },
  /** Close a tab; returns a function that puts it back exactly where it was. */
  close(id: string): () => void {
    const before = docsStore.get();
    const idx = before.docs.findIndex((d) => d.id === id);
    if (idx < 0) return () => {};
    let remaining = before.docs.filter((d) => d.id !== id);
    if (!remaining.length) remaining = [{ id: newId(), title: "", text: "", updatedAt: Date.now() }];
    const active = before.active === id ? remaining[Math.min(idx, remaining.length - 1)].id : before.active;
    docsStore.set({ docs: remaining, active });
    return () => docsStore.set(before);
  },
  move(id: string, toIndex: number) {
    docsStore.update((s) => {
      const from = s.docs.findIndex((d) => d.id === id);
      if (from < 0) return s;
      const next = s.docs.slice();
      const [doc] = next.splice(from, 1);
      next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, doc);
      return { ...s, docs: next };
    });
  },
};

/* ------------------------------------------------------------------ history */

export interface Snapshot {
  id: string;
  docTitle: string;
  text: string;
  at: number;
  /** What triggered it: an idle pause, a copy, a replace (paste/open/example). */
  reason: "idle" | "copy" | "replace";
}

const HISTORY_MAX = 40;
/** Huge pastes would crowd out everything else in localStorage. */
const SNAPSHOT_MAX_CHARS = 150_000;

export const historyStore = createPersistedStore<Snapshot[]>("cleanmath:history:v1", [], (raw) =>
  Array.isArray(raw) ? (raw as Snapshot[]).filter((x) => x && typeof x.text === "string").slice(0, HISTORY_MAX) : [],
);

/** Rough "how different" measure: changed prefix/suffix span, cheap and good enough. */
function changeSize(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return Math.max(a.length, b.length) - i - j;
}

/** Record a snapshot unless it is empty, huge, or barely differs from the last one. */
export function snapshot(text: string, title: string, reason: Snapshot["reason"]): void {
  if (!text.trim() || text.length > SNAPSHOT_MAX_CHARS) return;
  const list = historyStore.get();
  const last = list.find((s) => s.docTitle === title) ?? list[0];
  if (last && (last.text === text || (reason === "idle" && changeSize(last.text, text) < 24))) return;
  const entry: Snapshot = { id: newId(), docTitle: title, text, at: Date.now(), reason };
  historyStore.set([entry, ...list].slice(0, HISTORY_MAX));
}

/* ----------------------------------------------------------------- snippets */

export interface Snippet {
  id: string;
  name: string;
  latex: string;
  builtin?: boolean;
}


export const snippetStore = createPersistedStore<Snippet[]>("cleanmath:snippets:v1", [], (raw) =>
  Array.isArray(raw) ? (raw as Snippet[]).filter((x) => x && typeof x.latex === "string" && typeof x.name === "string") : [],
);

export const snippets = {
  add(name: string, latex: string): Snippet {
    const s: Snippet = { id: newId(), name: name.trim().slice(0, 60) || "Untitled snippet", latex };
    snippetStore.set([s, ...snippetStore.get()]);
    return s;
  },
  remove(id: string): () => void {
    const before = snippetStore.get();
    snippetStore.set(before.filter((s) => s.id !== id));
    return () => snippetStore.set(before);
  },
};

/* ---------------------------------------------------------------- file names */

/** Characters no common filesystem (or Overleaf upload) accepts in a name. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001F]+/g;

/**
 * The file name a document saves under, without extension. A tab the user has
 * named saves under that name; an unnamed one saves as "clean-math", so a
 * download never gets a name made from a random first line.
 */
export function fileBase(doc: Doc): string {
  const raw = doc.title.trim().replace(/\.(tex|md|png|bib)$/i, "");
  const safe = raw.replace(UNSAFE, "-").replace(/\s+/g, "-").replace(/-{2,}/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return safe.slice(0, 80) || "clean-math";
}

/** What the user typed into the file-name field, as a tab title. */
export function titleFromFileName(input: string): string {
  return input.trim().replace(/\.(tex|md|png|bib)$/i, "").slice(0, 80);
}
