"use client";

/**
 * drive.ts - Google Drive for signed-in users, straight from the browser.
 *
 * Scope: `drive.file` only - the app sees the files it saved and the ones the
 * user picks, never the rest of their Drive. The access token comes from the
 * Google sign-in itself (Supabase hands it over as `provider_token`) and, when
 * that has expired (an hour) or the user signed in with GitHub, from Google's
 * own token popup (Google Identity Services) - no page reload, and no second
 * account. Tokens live in this tab's session storage and are never synced.
 *
 * Network: googleapis.com for the files, accounts.google.com / apis.google.com
 * scripts loaded on first use - all on an explicit click (AGENTS.md).
 */

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? "";
/** The Cloud project number is the client id's prefix. */
const APP_ID = CLIENT_ID.split("-")[0] ?? "";
const FOLDER = "markdown2Latex";
const TOKEN_KEY = "cleanmath:drive-token:v1";

/** Drive can reconnect on its own (popup) when the sign-in token has expired. */
export const drivePopupAvailable = !!CLIENT_ID;
/** "Browse all of Drive" needs the Picker's developer key. */
export const pickerAvailable = !!(CLIENT_ID && API_KEY);

export class DriveError extends Error {}

/* ------------------------------------------------------------ tokens */

interface Token {
  value: string;
  exp: number;
}

function readToken(): Token | null {
  try {
    const t = JSON.parse(window.sessionStorage.getItem(TOKEN_KEY) ?? "null") as Token | null;
    return t && t.exp > Date.now() + 30_000 ? t : null;
  } catch {
    return null;
  }
}
function writeToken(value: string, seconds: number) {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ value, exp: Date.now() + seconds * 1000 }));
  } catch {
    // Not kept: the next action asks again.
  }
}
export function clearDriveToken(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing to clear
  }
}

/** From the Google sign-in (Supabase `provider_token`); valid for about an hour. */
export function setSignInToken(token: string): void {
  writeToken(token, 50 * 60);
}

export const hasDriveToken = () => !!readToken();

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new DriveError("Could not load Google's script - check your connection or blockers."));
      document.head.appendChild(s);
    });
    p.catch(() => scripts.delete(src));
    scripts.set(src, p);
  }
  return p;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
type Gis = {
  accounts: { oauth2: { initTokenClient: (cfg: Record<string, unknown>) => { requestAccessToken: (o?: Record<string, unknown>) => void } } };
};

/** A valid token: the stored one, or (interactive) Google's consent popup. */
export async function driveToken(interactive = true, hint = ""): Promise<string> {
  const t = readToken();
  if (t) return t.value;
  if (!interactive) throw new DriveError("Not connected to Google Drive.");
  if (!CLIENT_ID) throw new DriveError("Sign in with Google again to reconnect Drive.");
  await loadScript("https://accounts.google.com/gsi/client");
  const google = (window as unknown as { google: Gis }).google;
  return new Promise<string>((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      include_granted_scopes: true,
      login_hint: hint || undefined,
      callback: (r: GisTokenResponse) => {
        if (!r.access_token) return reject(new DriveError(r.error === "access_denied" ? "Drive access was not granted." : "Google did not grant Drive access."));
        writeToken(r.access_token, (r.expires_in ?? 3600) - 120);
        resolve(r.access_token);
      },
      error_callback: () => reject(new DriveError("The Google window was closed.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

/* --------------------------------------------------------------- API */

async function api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await driveToken();
  const res = await fetch(path.startsWith("http") ? path : "https://www.googleapis.com/drive/v3" + path, {
    ...init,
    headers: { authorization: "Bearer " + token, ...(init.headers ?? {}) },
  });
  if (res.status === 401 && retry) {
    clearDriveToken();
    return api(path, init, false);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = body.error?.message ?? res.statusText;
    if (res.status === 403 && /not been used|disabled/i.test(msg)) throw new DriveError("The Google Drive API is not enabled for this app's Cloud project.");
    throw new DriveError("Drive: " + msg);
  }
  return res;
}

const q = (s: string) => encodeURIComponent(s);

/** The app's folder, created on first use (drive.file can only see its own folders). */
async function folderId(): Promise<string> {
  const found = (await (await api("/files?q=" + q("name = '" + FOLDER + "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false") + "&fields=files(id)&pageSize=1")).json()) as { files?: Array<{ id: string }> };
  if (found.files?.[0]) return found.files[0].id;
  const made = (await (
    await api("/files?fields=id", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }) })
  ).json()) as { id: string };
  return made.id;
}

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  mimeType: string;
  webViewLink?: string;
}

/**
 * Save into the app's folder. A file of the same name there is updated (so
 * saving a document again replaces it), otherwise a new one is made.
 */
export async function saveToDrive(name: string, mime: string, content: Blob | string): Promise<DriveFile> {
  const parent = await folderId();
  const existing = (await (await api("/files?q=" + q("name = '" + name.replace(/'/g, "\\'") + "' and '" + parent + "' in parents and trashed = false") + "&fields=files(id)&pageSize=1")).json()) as { files?: Array<{ id: string }> };
  const id = existing.files?.[0]?.id;
  const meta = id ? { name } : { name, parents: [parent], mimeType: mime };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", typeof content === "string" ? new Blob([content], { type: mime }) : content);
  const url = "https://www.googleapis.com/upload/drive/v3/files" + (id ? "/" + id : "") + "?uploadType=multipart&fields=id,name,modifiedTime,mimeType,webViewLink";
  return (await (await api(url, { method: id ? "PATCH" : "POST", body: form })).json()) as DriveFile;
}

/** The files this app can see: what it saved, and what the user picked before. */
export async function listDriveFiles(): Promise<DriveFile[]> {
  const body = (await (
    await api("/files?q=" + q("trashed = false and mimeType != 'application/vnd.google-apps.folder'") + "&orderBy=modifiedTime desc&pageSize=40&fields=files(id,name,modifiedTime,mimeType,webViewLink)")
  ).json()) as { files?: DriveFile[] };
  return body.files ?? [];
}

/** Text of a Drive file; Google Docs are exported as plain text. */
export async function readDriveFile(file: Pick<DriveFile, "id" | "mimeType">): Promise<string> {
  const path = file.mimeType === "application/vnd.google-apps.document" ? "/files/" + file.id + "/export?mimeType=text/plain" : "/files/" + file.id + "?alt=media";
  const res = await api(path);
  const text = await res.text();
  if (text.length > 2_000_000) throw new DriveError("That file is over 2 MB - too large to clean live.");
  return text;
}

/* ------------------------------------------------------------ picker */

type PickerNs = {
  picker: {
    PickerBuilder: new () => PickerBuilder;
    DocsView: new (id?: string) => { setMimeTypes: (m: string) => unknown; setIncludeFolders: (b: boolean) => unknown };
    ViewId: { DOCS: string };
    Action: { PICKED: string; CANCEL: string };
    Feature: { NAV_HIDDEN: string };
  };
};
interface PickerBuilder {
  addView(v: unknown): PickerBuilder;
  setOAuthToken(t: string): PickerBuilder;
  setDeveloperKey(k: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setTitle(t: string): PickerBuilder;
  setCallback(cb: (d: { action: string; docs?: Array<{ id: string; name: string; mimeType: string }> }) => void): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}

/** Google's file picker over the whole Drive; resolves to the chosen file, or null. */
export async function pickFromDrive(hint = ""): Promise<DriveFile | null> {
  if (!pickerAvailable) throw new DriveError("Browsing all of Drive is not set up on this site yet.");
  const token = await driveToken(true, hint);
  await loadScript("https://apis.google.com/js/api.js");
  const gapi = (window as unknown as { gapi: { load: (lib: string, cb: () => void) => void } }).gapi;
  await new Promise<void>((r) => gapi.load("picker", r));
  const google = (window as unknown as { google: PickerNs }).google;
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS);
    view.setMimeTypes("text/plain,text/markdown,text/x-markdown,text/x-tex,application/x-tex,application/x-latex,application/octet-stream,application/vnd.google-apps.document");
    view.setIncludeFolders(true);
    new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle("Open a Markdown or LaTeX file")
      .setCallback((d) => {
        if (d.action === google.picker.Action.PICKED && d.docs?.[0]) resolve({ id: d.docs[0].id, name: d.docs[0].name, mimeType: d.docs[0].mimeType, modifiedTime: "" });
        else if (d.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
