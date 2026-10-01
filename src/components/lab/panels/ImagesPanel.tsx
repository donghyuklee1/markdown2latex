"use client";

/**
 * Figure Optimizer: shrink raster figures to what the printed page can show,
 * then hand back a zip with the original paths so it drops straight into
 * Overleaf. Drop a whole project and the .tex files tell us each figure's
 * printed width.
 *
 * Decisions come from lib/lab/imageopt.ts, pixels from ../imageCodec.ts.
 * Images are processed one at a time so memory stays bounded.
 */
import { useMemo, useState } from "react";
import { Download, ImageDown, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { textOf, zip, type ArchiveFile } from "@/lib/lab/archive";
import { LAYOUTS, afterEncode, formatFromPath, planWithSpec, texWidths, type LayoutPreset, type PlanOptions } from "@/lib/lab/imageopt";
import { decode, encode } from "../imageCodec";
import { Button, FileDrop, Field, Notice, Pane, Segmented, Stats, Switch, ToolFrame, Toolbar, downloadBlob, formatBytes, inputClass } from "../kit";

type DpiChoice = "300" | "450" | "600" | "custom";

interface Row {
  path: string;
  outPath: string;
  bytes: number;
  newBytes: number;
  size: string;
  newSize: string;
  action: string;
  reasons: string[];
  changed: boolean;
}

interface Result {
  rows: Row[];
  output: ArchiveFile[];
  /** Settings the run used, to flag a stale result. */
  key: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp|svg|pdf|eps)$/i;
const TEX_EXT = /\.(tex|ltx)$/i;

const ACTION_LABEL: Record<string, string> = { resize: "Resized", reencode: "Re-encoded", keep: "Kept", passthrough: "Copied" };

export default function ImagesPanel() {
  const toast = useToast();
  const [files, setFiles] = useState<ArchiveFile[] | null>(null);
  const [dpiChoice, setDpiChoice] = useState<DpiChoice>("300");
  const [customDpi, setCustomDpi] = useState("350");
  const [layout, setLayout] = useState<LayoutPreset>("two-column");
  const [quality, setQuality] = useState(85);
  const [convertPhotos, setConvertPhotos] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const dpi = dpiChoice === "custom" ? Math.max(72, Math.min(2400, parseInt(customDpi, 10) || 300)) : Number(dpiChoice);
  const options: PlanOptions = { dpi, layout, jpegQuality: quality, convertPhotos };
  const key = JSON.stringify(options);

  const inventory = useMemo(() => {
    const list = files ?? [];
    const images = list.filter((f) => IMAGE_EXT.test(f.path));
    const tex = list.filter((f) => TEX_EXT.test(f.path));
    return { images, tex, other: list.length - images.length - tex.length, bytes: images.reduce((s, f) => s + f.data.length, 0) };
  }, [files]);

  const totals = useMemo(() => {
    if (!result) return null;
    const before = result.rows.reduce((s, r) => s + r.bytes, 0);
    const after = result.rows.reduce((s, r) => s + r.newBytes, 0);
    return { before, after, changed: result.rows.filter((r) => r.changed).length, renamed: result.rows.filter((r) => r.outPath !== r.path) };
  }, [result]);

  const optimize = async () => {
    if (!files) return;
    setBusy(true);
    setResult(null);
    try {
      const tex = inventory.tex.map((f) => ({ path: f.path, text: textOf(f.data) }));
      const specs = texWidths(tex, inventory.images.map((f) => f.path), layout);
      const allPaths = new Set(files.map((f) => f.path));
      const replaced = new Map<string, ArchiveFile>(); // original path -> new file
      const rows: Row[] = [];
      for (let i = 0; i < inventory.images.length; i++) {
        const file = inventory.images[i];
        setProgress({ done: i, total: inventory.images.length, current: file.path });
        // Let the progress bar paint between images.
        await new Promise((r) => setTimeout(r, 0));
        const decoded = await decode(file.path, file.data);
        const plan = planWithSpec(decoded.meta, specs.get(file.path), options);
        const row: Row = {
          path: file.path,
          outPath: file.path,
          bytes: file.data.length,
          newBytes: file.data.length,
          size: decoded.meta.width ? decoded.meta.width + "x" + decoded.meta.height : "-",
          newSize: decoded.meta.width ? decoded.meta.width + "x" + decoded.meta.height : "-",
          action: ACTION_LABEL[plan.action],
          reasons: decoded.error ? [decoded.error + " - copied unchanged."] : plan.reasons,
          changed: false,
        };
        const bitmap = decoded.bitmap;
        try {
          if (bitmap && plan.format && plan.action !== "keep" && plan.action !== "passthrough") {
            const clash = plan.outPath !== file.path && allPaths.has(plan.outPath);
            if (clash) {
              row.action = "Kept";
              row.reasons = [...row.reasons, plan.outPath + " already exists - original kept."];
            } else {
              const data = await encode(bitmap, plan.targetWidth, plan.targetHeight, plan.format, plan.quality ?? quality);
              const verdict = afterEncode(plan, file.data.length, data.length);
              if (verdict.keepOriginal) {
                row.action = "Kept";
                row.reasons = [...row.reasons, verdict.reason ?? ""];
              } else {
                replaced.set(file.path, { path: plan.outPath, data });
                Object.assign(row, { outPath: plan.outPath, newBytes: data.length, newSize: plan.targetWidth + "x" + plan.targetHeight, changed: true });
              }
            }
          }
        } catch (err) {
          row.action = "Kept";
          row.reasons = [...row.reasons, "Encoding failed (" + (err instanceof Error ? err.message : String(err)) + ") - original kept."];
        } finally {
          bitmap?.close();
        }
        rows.push(row);
      }
      // Original paths and order; non-image files pass through untouched.
      const output = files.map((f) => replaced.get(f.path) ?? f);
      setResult({ rows, output, key });
      const saved = rows.reduce((s, r) => s + r.bytes - r.newBytes, 0);
      toast(rows.length ? "Optimized " + rows.length + " figure" + (rows.length === 1 ? "" : "s") + (saved > 0 ? ", saved " + formatBytes(saved) : "") : "No figures found");
    } catch (err) {
      toast("Optimization failed: " + (err instanceof Error ? err.message : String(err)), "error");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const download = () => {
    if (!result) return;
    const bytes = zip(result.output);
    downloadBlob(new Blob([bytes as BlobPart], { type: "application/zip" }), "figures-optimized.zip");
    toast("Saved figures-optimized.zip");
  };

  return (
    <ToolFrame title="Figure Optimizer" slug="tex-img-opt" pain="Oversized PNG and JPG figures cause Overleaf compile timeouts and hit storage limits, though print needs far fewer pixels.">
      {!files ? (
        <FileDrop
          title="Drop figures, a folder, or a whole Overleaf project (.zip)"
          hint="With .tex files included, each figure is sized to its printed width from \includegraphics. Everything stays in this browser."
          icon={ImageDown}
          directory
          onFiles={(list) => {
            setFiles(list);
            setResult(null);
          }}
        />
      ) : (
        <Toolbar>
          <Stats
            items={[
              { label: "figures", value: inventory.images.length, tone: inventory.images.length ? undefined : "warn" },
              { label: "size", value: formatBytes(inventory.bytes) },
              { label: ".tex", value: inventory.tex.length },
              { label: "other files", value: inventory.other },
            ]}
          />
          <Button
            icon={X}
            className="ml-auto"
            disabled={busy}
            onClick={() => {
              setFiles(null);
              setResult(null);
            }}
          >
            Clear
          </Button>
        </Toolbar>
      )}

      <Toolbar>
        <Field label="Target DPI">
          <div className="flex items-center gap-1.5">
            <Segmented<DpiChoice>
              label="Target DPI"
              value={dpiChoice}
              onChange={setDpiChoice}
              options={[
                { id: "300", label: "300", title: "Journal standard for colour and greyscale" },
                { id: "450", label: "450" },
                { id: "600", label: "600", title: "Line art at its sharpest" },
                { id: "custom", label: "Custom" },
              ]}
            />
            {dpiChoice === "custom" && (
              <input aria-label="Custom DPI" inputMode="numeric" value={customDpi} onChange={(e) => setCustomDpi(e.target.value.replace(/\D/g, ""))} className={inputClass + " w-20"} />
            )}
          </div>
        </Field>
        <Field label="Layout">
          <Segmented<LayoutPreset>
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={(Object.keys(LAYOUTS) as LayoutPreset[]).map((id) => ({ id, label: id === "two-column" ? "Two-column" : "One-column", title: LAYOUTS[id].label }))}
          />
        </Field>
        <Field label={"JPEG quality " + quality}>
          <input type="range" min={50} max={95} step={1} value={quality} onChange={(e) => setQuality(Number(e.target.value))} className="h-8 w-36 accent-accent" aria-label="JPEG quality" />
        </Field>
        <Switch checked={convertPhotos} onChange={setConvertPhotos} label="Convert photos to JPEG" hint="Photographic PNGs become JPEG; line art and transparency stay PNG" />
        <Button variant="primary" icon={ImageDown} busy={busy} disabled={!inventory.images.length} onClick={() => void optimize()} className="ml-auto">
          Optimize
        </Button>
      </Toolbar>

      {progress && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + "%" }} />
          </div>
          <span className="truncate font-mono text-[11px] text-faint">
            {progress.done + 1}/{progress.total} {progress.current}
          </span>
        </div>
      )}

      {result && totals && (
        <>
          <Toolbar>
            <Stats
              items={[
                { label: "before", value: formatBytes(totals.before) },
                { label: "after", value: formatBytes(totals.after), tone: "ok" },
                { label: "saved", value: totals.before ? Math.round((1 - totals.after / totals.before) * 100) + "%" : "0%", tone: totals.after < totals.before ? "ok" : undefined },
                { label: "changed", value: totals.changed + " of " + result.rows.length },
              ]}
            />
            <Button variant="primary" icon={Download} className="ml-auto" onClick={download}>
              Download optimized zip
            </Button>
          </Toolbar>
          {result.key !== key && <Notice tone="warn">Settings changed since this run - press Optimize again to apply them.</Notice>}
          {totals.renamed.length > 0 && (
            <Notice tone="warn">
              {totals.renamed.length} figure{totals.renamed.length === 1 ? " was" : "s were"} converted to another format, so the extension changed (e.g. {totals.renamed[0].path} &rarr; {totals.renamed[0].outPath}). An
              \includegraphics without an extension finds the new file; one that names the old extension needs updating.
            </Notice>
          )}
          <Pane label="Figures" className="min-h-0">
            <div className="scroll-slim overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="text-[11px] uppercase tracking-wider text-faint">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 font-semibold">File</th>
                    <th className="px-3 py-2 font-semibold">Original</th>
                    <th className="px-3 py-2 font-semibold">Optimized</th>
                    <th className="px-3 py-2 text-right font-semibold">Saving</th>
                    <th className="px-3 py-2 font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r) => {
                    const saving = r.bytes ? Math.round((1 - r.newBytes / r.bytes) * 100) : 0;
                    return (
                      <tr key={r.path} className="border-b border-border align-top last:border-0 hover:bg-surface-2/50">
                        <td className="max-w-[240px] break-all px-3 py-2 font-mono text-text">
                          {r.path}
                          {r.outPath !== r.path && <div className="text-faint">&rarr; {r.outPath}</div>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-muted">
                          {r.size}
                          <div className="text-faint">{formatBytes(r.bytes)}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-muted">
                          {r.newSize}
                          <div className="text-faint">{formatBytes(r.newBytes)}</div>
                        </td>
                        <td className={"whitespace-nowrap px-3 py-2 text-right font-mono font-semibold " + (r.changed && saving > 0 ? "text-ok" : "text-faint")}>
                          {r.changed ? saving + "%" : "-"}
                        </td>
                        <td className="px-3 py-2 text-muted">
                          <span className="font-semibold text-text">{r.action}</span>
                          <ul className="mt-0.5 space-y-0.5 text-[11px] leading-snug text-faint">
                            {r.reasons.filter(Boolean).map((why, i) => (
                              <li key={i}>{why}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Pane>
        </>
      )}

      {!files && (
        <Notice>
          Targets: two-column column 3.5 in, text 7.16 in; one-column text 6.5 in. Figures are never upscaled, never written as WebP/AVIF (pdfLaTeX cannot include them), and kept as-is when re-encoding
          would save under 10%. PDF and EPS figures are vector and are copied unchanged.
        </Notice>
      )}
    </ToolFrame>
  );
}
