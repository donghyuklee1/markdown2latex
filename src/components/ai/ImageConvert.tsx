"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Copy, FilePlus2, ImagePlus, Loader2, RefreshCw, Replace, ScanText, TextCursorInput, X } from "lucide-react";
import { GeminiStar } from "@/components/BrandMark";
import { OCR_FORMATS, OCR_MAX_BYTES, OCR_MIME, ocrRequest, parseOcr, type OcrFormat, type OcrResult } from "@/lib/ocr";
import { aiStore } from "@/lib/persistedStore";
import { writeClipboard } from "../exporters";
import { useToast } from "../Toast";
import { AiError, generateJson } from "../derivation/gemini";
import { openAiKey } from "./AiKeyDialog";
import { currentModel } from "./aiKey";

/* --------------------------------------------- open from anywhere */

let pending: { open: boolean; file: File | null } = { open: false, file: null };
const listeners = new Set<() => void>();
const emit = (next: typeof pending) => {
  pending = next;
  for (const l of listeners) l();
};
/** Open the converter, optionally with an image already chosen (paste, drop). */
export const openImageConvert = (file: File | null = null) => emit({ open: true, file });
const store = {
  get: () => pending,
  getServer: () => pending,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const isConvertible = (f: File | null | undefined): boolean => !!f && OCR_MIME.test(f.type);

/* ------------------------------------------------------- image prep */

/**
 * Large photos are scaled to at most 2000 px on the long side and re-encoded,
 * which keeps uploads small (and fast) without losing legibility. PDFs and
 * small images go as they are.
 */
async function prepare(file: File): Promise<{ mime: string; base64: string }> {
  if (file.size > OCR_MAX_BYTES) throw new AiError("That file is over 15 MB - crop or compress it first.");
  let blob: Blob = file;
  if (file.type.startsWith("image/") && file.type !== "image/heic" && file.type !== "image/heif") {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    if (scale < 1 || file.size > 1_500_000) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.92));
    }
    bmp.close();
  }
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime: blob.type || file.type, base64: btoa(bin) };
}

/* ----------------------------------------------------------- dialog */

export interface ConvertTargets {
  insert: (text: string) => void;
  replace: (text: string) => void;
  openAsNew: (text: string, title: string) => void;
}

/**
 * Image -> LaTeX / Markdown with Gemini's vision, using the user's own key.
 * In AI mode a pasted or dropped image converts the moment it arrives.
 */
export default function ImageConvert({ insert, replace, openAsNew }: ConvertTargets) {
  const req = useSyncExternalStore(store.subscribe, store.get, store.getServer);
  const ai = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<OcrFormat>("markdown");
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OcrResult | null>(null);
  const [text, setText] = useState("");
  const [took, setTook] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const toast = useToast();

  const close = () => {
    abort.current?.abort();
    emit({ open: false, file: null });
  };

  const convert = async (f: File | null = file, fmt: OcrFormat = format) => {
    if (!f) return;
    if (!ai.apiKey) return openAiKey();
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setError(null);
    setResult(null);
    const started = performance.now();
    try {
      const { mime, base64 } = await prepare(f);
      const model = await currentModel();
      const answer = await generateJson((m, thinking) => ocrRequest(fmt, mime, base64, m, hint, thinking), ai.apiKey, model, ctl.signal);
      const parsed = parseOcr(answer.json);
      if (!parsed) throw new AiError("Gemini found no text or formulas in this image.");
      setResult(parsed);
      setText(parsed.content);
      setTook(Math.round((performance.now() - started) / 100) / 10);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(e instanceof AiError ? e.message : "Conversion failed: " + String(e));
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  };

  const choose = (f: File | null) => {
    if (!f) return;
    if (!isConvertible(f)) {
      setError("Choose a PNG, JPEG, WebP, HEIC image or a PDF.");
      return;
    }
    setFile(f);
    setResult(null);
    setText("");
    setError(null);
    setUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return f.type === "application/pdf" ? null : URL.createObjectURL(f);
    });
    // AI mode: start at once - the dialog opens on a conversion already under way.
    if (ai.mode && ai.apiKey) void convert(f);
  };

  // A file handed over by paste / drop / the Open button.
  const handed = useRef<File | null>(null);
  useEffect(() => {
    if (req.open && req.file && req.file !== handed.current) {
      handed.current = req.file;
      choose(req.file);
    }
  });

  useEffect(() => {
    if (!req.open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    // Paste another image straight into the open dialog.
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(isConvertible);
      if (f) {
        e.preventDefault();
        choose(f);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  });

  if (!req.open) return null;
  const done = (fn: () => void, msg: string) => {
    fn();
    toast(msg, "success");
    close();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-3 backdrop-blur-sm animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Image to LaTeX" className="themed ob-card flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <ScanText size={16} className="text-accent" />
          <h2 className="text-sm font-semibold text-text">Image to LaTeX / Markdown</h2>
          <span className="flex items-center gap-1 text-[11px] text-faint">
            with <GeminiStar size={11} /> Gemini
          </span>
          <button type="button" onClick={close} aria-label="Close" className="press ml-auto rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
            <X size={15} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-2">
          {/* source */}
          <div className="flex min-h-[220px] flex-col border-b border-border md:border-b-0 md:border-r">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                choose(e.dataTransfer.files[0] ?? null);
              }}
              className="press-soft group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-bg/60 p-3"
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview
                <img src={url} alt="The image to convert" className="max-h-[52vh] max-w-full rounded-md object-contain shadow-sm" />
              ) : file ? (
                <span className="text-sm text-muted">{file.name}</span>
              ) : (
                <span className="flex flex-col items-center gap-2 text-center text-xs text-faint">
                  <ImagePlus size={28} />
                  Paste (⌘/Ctrl+V), drop, or click to choose
                  <span className="text-[11px]">a photo, screenshot, scan or PDF - printed or handwritten</span>
                </span>
              )}
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center bg-surface/40">
                  <span className="ob-scan absolute inset-x-0 h-12 bg-gradient-to-b from-transparent via-[#4b8cf5]/25 to-transparent" />
                </span>
              )}
            </button>
            <div className="space-y-2 border-t border-border p-3">
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Output format">
                {OCR_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={format === f.id}
                    title={f.hint}
                    onClick={() => {
                      setFormat(f.id);
                      if (file && result) void convert(file, f.id);
                    }}
                    className={"press rounded-md px-2 py-1 text-[11px] font-semibold " + (format === f.id ? "bg-accent/15 text-accent" : "text-faint hover:bg-surface-2 hover:text-text")}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="Optional hint: 'Korean lecture notes', 'ignore the margin'..."
                className="h-8 w-full rounded-lg border border-border bg-bg px-2 text-xs text-text outline-none focus:border-accent/60"
              />
              <button
                type="button"
                onClick={() => void convert()}
                disabled={!file || busy}
                className="press flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-xs font-semibold text-accent-ink disabled:opacity-40"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : result ? <RefreshCw size={13} /> : <GeminiStar size={14} />}
                {busy ? "Reading the image..." : !ai.apiKey ? "Add your Gemini key to convert" : result ? "Convert again" : "Convert"}
              </button>
            </div>
          </div>

          {/* result */}
          <div className="flex min-h-[220px] flex-col">
            {error && (
              <div className="m-3 flex gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
              </div>
            )}
            {result ? (
              <>
                <div className="flex items-center gap-2 px-3 pt-2.5 text-[11px] text-faint">
                  <span className="truncate font-semibold text-text">{result.title || "Result"}</span>
                  {took !== null && <span className="shrink-0">· {took} s</span>}
                  <span className="ml-auto shrink-0">editable</span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  spellCheck={false}
                  aria-label="Converted text"
                  className="scroll-slim m-3 min-h-[200px] flex-1 resize-none rounded-lg border border-border bg-bg p-2.5 font-mono text-[12px] leading-relaxed text-text outline-none focus:border-accent/60"
                />
                {result.warnings.length > 0 && (
                  <ul className="mx-3 mb-2 space-y-0.5 text-[11px] text-accent">
                    {result.warnings.map((w) => (
                      <li key={w} className="flex gap-1">
                        <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {w}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-1.5 border-t border-border p-3">
                  <button type="button" onClick={() => done(() => insert(text), "Inserted at the cursor")} className="press flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink">
                    <TextCursorInput size={13} /> Insert at cursor
                  </button>
                  <button type="button" onClick={() => done(() => replace(text), "Replaced the document (undo with ⌘/Ctrl+Z)")} className="press flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-text">
                    <Replace size={13} /> Replace document
                  </button>
                  <button type="button" onClick={() => done(() => openAsNew(text, result.title || "From image"), "Opened in a new tab")} className="press flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted hover:text-text">
                    <FilePlus2 size={13} /> New tab
                  </button>
                  <button
                    type="button"
                    onClick={async () => toast((await writeClipboard(text)) ? "Copied" : "Copy failed", "success")}
                    className="press ml-auto flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-faint hover:bg-surface-2 hover:text-text"
                  >
                    <Copy size={13} /> Copy
                  </button>
                </div>
              </>
            ) : (
              !error && (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-faint">
                  {busy ? (
                    <>
                      <Loader2 size={18} className="animate-spin text-[#4b8cf5]" /> Transcribing - formulas, text and tables...
                    </>
                  ) : (
                    <>The LaTeX or Markdown appears here, ready to edit before it goes into your document.</>
                  )}
                </div>
              )
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf"
          className="hidden"
          onChange={(e) => {
            choose(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
