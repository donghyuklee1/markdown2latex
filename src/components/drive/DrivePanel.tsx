"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ExternalLink, FileCode2, FileDown, FilePlus2, FileText, FolderOpen, ImageDown, Loader2, LogIn, RefreshCw, RotateCcw } from "lucide-react";
import { accountStore, accountsEnabled } from "../account/cloud";
import { openLogin } from "../account/LoginScreen";
import { useToast } from "../Toast";
import { driveToken, DriveError, hasDriveToken, listDriveFiles, pickerAvailable, pickFromDrive, readDriveFile, saveToDrive, type DriveFile } from "./drive";

/** Google Drive's mark, drawn (brand icons are not in lucide). */
export function DriveMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 87.3 78" aria-hidden="true">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
      <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
      <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
      <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
      <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
      <path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" />
    </svg>
  );
}

export interface DriveExports {
  /** Base file name, without extension. */
  base: string;
  /** The editor's text (Markdown with maths, or a .tex document). */
  source: () => string;
  sourceExt: string;
  /** The clean LaTeX output. */
  clean: () => string;
  /** A complete, compilable .tex document. */
  document: () => string;
  /** The live preview as a PNG. */
  png: () => Promise<Blob>;
}

const MIME: Record<string, string> = { md: "text/markdown", tex: "text/x-tex", png: "image/png", txt: "text/plain" };

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  return h < 24 ? h + " h ago" : new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The left-rail Google Drive panel: save the current document (source, clean
 * LaTeX, full document, PNG) into a "markdown2Latex" folder, and open files
 * from Drive into the editor.
 */
export default function DrivePanel({ exports, onOpen, onOpenAsNew }: { exports: DriveExports; onOpen: (text: string, name: string) => void; onOpenAsNew: (text: string, name: string) => void }) {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(hasDriveToken);
  const toast = useToast();
  const signedIn = acc.status === "signed-in";

  const guard = async <T,>(id: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(id);
    setError(null);
    try {
      const r = await fn();
      setConnected(hasDriveToken());
      return r;
    } catch (e) {
      setError(e instanceof DriveError ? e.message : "Drive: " + (e instanceof Error ? e.message : String(e)));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const refresh = () => guard("list", async () => setFiles(await listDriveFiles()));

  // Already connected (signed in with Google a moment ago): show the files at once.
  useEffect(() => {
    if (!signedIn || !hasDriveToken()) return;
    let live = true;
    listDriveFiles().then(
      (f) => live && setFiles(f),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [signedIn]);

  const save = (id: string, name: string, ext: string, content: () => Promise<Blob | string> | string) =>
    guard(id, async () => {
      const f = await saveToDrive(name + "." + ext, MIME[ext] ?? "text/plain", await content());
      toast("Saved " + f.name + " to Google Drive", "success", f.webViewLink ? { label: "Open", run: () => window.open(f.webViewLink, "_blank", "noopener") } : undefined);
      setFiles(await listDriveFiles());
    });

  const open = (f: DriveFile, asNew: boolean) =>
    guard("open:" + f.id, async () => {
      const text = await readDriveFile(f);
      const name = f.name.replace(/\.(md|markdown|tex|latex|txt)$/i, "");
      if (asNew) onOpenAsNew(text, name);
      else onOpen(text, name);
    });

  if (!signedIn) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
        <DriveMark size={28} />
        <p className="text-xs leading-relaxed text-faint">Sign in to save documents to your Google Drive and open them from there.</p>
        {accountsEnabled && (
          <button type="button" onClick={openLogin} className="press flex items-center gap-1.5 rounded-lg bg-text px-3 py-1.5 text-xs font-semibold text-bg">
            <LogIn size={13} /> Sign in
          </button>
        )}
      </div>
    );
  }

  const saveRows: Array<{ id: string; label: string; icon: typeof FileText; run: () => void }> = [
    { id: "src", label: "Source (." + exports.sourceExt + ")", icon: FileText, run: () => void save("src", exports.base, exports.sourceExt, exports.source) },
    { id: "clean", label: "Clean LaTeX (.tex)", icon: FileCode2, run: () => void save("clean", exports.base + "-clean", "tex", exports.clean) },
    { id: "doc", label: "Full document (.tex)", icon: FileDown, run: () => void save("doc", exports.base + "-document", "tex", exports.document) },
    { id: "png", label: "Rendered preview (.png)", icon: ImageDown, run: () => void save("png", exports.base, "png", exports.png) },
  ];

  return (
    <div className="space-y-3 p-3 text-xs">
      {!connected && (
        <button
          type="button"
          onClick={() => void guard("connect", async () => {
            await driveToken(true, acc.profile?.email ?? "");
            setFiles(await listDriveFiles());
          })}
          className="press flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 font-semibold text-text shadow-sm hover:border-border-strong"
        >
          {busy === "connect" ? <Loader2 size={14} className="animate-spin" /> : <DriveMark size={15} />} Connect Google Drive
        </button>
      )}
      {error && <p className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-danger">{error}</p>}

      <section>
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Save this document to Drive</h3>
        <div className="grid grid-cols-2 gap-1">
          {saveRows.map((r) => (
            <button key={r.id} type="button" onClick={r.run} disabled={!!busy} className="press flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-left text-[11px] font-medium text-text hover:border-border-strong hover:bg-surface-2 disabled:opacity-50">
              {busy === r.id ? <Loader2 size={12} className="animate-spin" /> : <r.icon size={12} className="text-faint" />}
              {r.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-faint">Into a &quot;markdown2Latex&quot; folder; saving again updates the same file.</p>
      </section>

      <section>
        <div className="mb-1 flex items-center gap-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-faint">Open from Drive</h3>
          <button type="button" onClick={() => void refresh()} aria-label="Refresh" className="press ml-auto rounded p-1 text-faint hover:text-text">
            {busy === "list" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
        </div>
        {pickerAvailable && (
          <button
            type="button"
            onClick={() => void guard("pick", async () => {
              const f = await pickFromDrive(acc.profile?.email ?? "");
              if (f) {
                const text = await readDriveFile(f);
                onOpenAsNew(text, f.name.replace(/\.(md|markdown|tex|latex|txt)$/i, ""));
              }
            })}
            className="press mb-1.5 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-border-strong px-2.5 py-1.5 font-semibold text-muted hover:text-text"
          >
            {busy === "pick" ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />} Browse all of Drive...
          </button>
        )}
        {files === null ? (
          <p className="py-3 text-center text-faint">{connected ? "Loading..." : "Connect to see your files."}</p>
        ) : files.length === 0 ? (
          <p className="py-3 text-center text-faint">Nothing yet - files you save here (or pick) will appear.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((f) => (
              <li key={f.id} className="group flex items-center gap-1.5 rounded-lg border border-border bg-bg px-2 py-1.5">
                <FileText size={13} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-text">{f.name}</span>
                  <span className="text-[10px] text-faint">{ago(f.modifiedTime)}</span>
                </span>
                {f.mimeType.startsWith("image/") ? (
                  f.webViewLink && (
                    <a href={f.webViewLink} target="_blank" rel="noreferrer noopener" aria-label="Open in Drive" className="press rounded p-1 text-faint hover:text-text">
                      <ExternalLink size={12} />
                    </a>
                  )
                ) : (
                  <>
                    <button type="button" title="Replace the current document" onClick={() => void open(f, false)} className="press rounded p-1 text-faint hover:text-text">
                      {busy === "open:" + f.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                    </button>
                    <button type="button" title="Open in a new tab" onClick={() => void open(f, true)} className="press rounded p-1 text-faint hover:text-text">
                      <FilePlus2 size={12} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
