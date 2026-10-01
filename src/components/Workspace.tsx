"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ActionBar, { type ExportId } from "./ActionBar";
import ControlBar from "./ControlBar";
import { copyPng, downloadBlob, downloadText, mathOnly, openInOverleaf, renderPreviewPng, writeClipboard } from "./exporters";
import MathInput from "./MathInput";
import MathOutput from "./MathOutput";
import Splitter from "./Splitter";
import { setShortcutsOpen } from "./ShortcutsDialog";
import { useToast } from "./Toast";
import { cleanMath, cleanMathDetailed, DELIMITER_MODES, type ConfigOptions } from "@/lib/cleaner";
import { diagnose } from "@/lib/diagnostics";
import { toLatexDocument } from "@/lib/latexDocument";
import { DEFAULT_TEXT, EXAMPLES } from "@/lib/defaultText";
import {
  getOptionsServerSnapshot,
  getOptionsSnapshot,
  setOptions,
  subscribeToOptions,
} from "@/lib/optionsStore";
import {
  DEFAULT_UI,
  draftStore,
  FONT_MAX,
  FONT_MIN,
  INPUT_HEIGHT_MAX,
  INPUT_HEIGHT_MIN,
  OUTPUT_TABS,
  SPLIT_MAX,
  SPLIT_MIN,
  uiStore,
  type Focus,
  type UiPrefs,
} from "@/lib/persistedStore";
import { decodeShare, encodeShare, SHARE_MAX_CHARS, SHARE_PREFIX } from "@/lib/share";
import { matchShortcut, type ShortcutId } from "@/lib/shortcuts";
import { getThemeSnapshot, setTheme } from "@/lib/theme";

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || (el as HTMLElement).isContentEditable);

export default function Workspace() {
  // Preferences, layout and the draft all live in localStorage, read through
  // external stores so the first paint matches the server and tabs stay in step.
  const options = useSyncExternalStore(subscribeToOptions, getOptionsSnapshot, getOptionsServerSnapshot);
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.getServer);
  const draft = useSyncExternalStore(draftStore.subscribe, draftStore.get, draftStore.getServer);
  const input = draft ?? DEFAULT_TEXT;
  const setInput = draftStore.set;
  const setUi = useCallback((patch: Partial<UiPrefs>) => uiStore.update((prev) => ({ ...prev, ...patch })), []);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // The whole engine is synchronous and fast enough to run on every keystroke,
  // so there is no debounce to make the preview lag behind the caret.
  const { output, issues, blocks, mathBlocks } = useMemo(() => cleanMathDetailed(input, options), [input, options]);
  const downloadName = options.delimiterMode === "academic" ? "clean-math.tex" : "clean-math.md";

  // KaTeX-checking every block is the slowest step, so it runs on a deferred
  // copy: typing stays instant and the health report catches up a frame later.
  const deferredBlocks = useDeferredValue(mathBlocks);
  const diagnostics = useMemo(() => diagnose(deferredBlocks), [deferredBlocks]);

  const [overleafBusy, setOverleafBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  /** A complete document: cleaned in Academic mode, prose turned into LaTeX. */
  const buildDocument = useCallback(
    () => toLatexDocument(cleanMath(input, { ...options, delimiterMode: "academic", wrapEnvironments: false })),
    [input, options],
  );

  /** Replace the whole input, keeping the old text one click away. */
  const replaceInput = useCallback(
    (text: string, message: string) => {
      const previous = input;
      setInput(text);
      if (previous && previous !== text) {
        toast(message, "info", { label: "Undo", run: () => setInput(previous) });
      } else {
        toast(message, "info");
      }
    },
    [input, setInput, toast],
  );

  const copy = useCallback(async () => {
    if (!output) {
      toast("Nothing to copy yet", "info");
      return;
    }
    if (!(await writeClipboard(output))) {
      toast("Copy failed - select the code and press Cmd/Ctrl+C", "error");
      return;
    }
    setCopied(true);
    toast("Clean LaTeX copied");
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [output, toast]);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const download = useCallback(() => {
    if (!output) {
      toast("Nothing to download yet", "info");
      return;
    }
    downloadText(output + "\n", downloadName);
    toast("Saved " + downloadName);
  }, [output, downloadName, toast]);

  const copyText = useCallback(
    async (text: string, done: string) => {
      if (!text) return toast("Nothing to copy yet", "info");
      toast((await writeClipboard(text)) ? done : "Copy failed - select the text and press Cmd/Ctrl+C", "success");
    },
    [toast],
  );

  const openOverleaf = useCallback(() => {
    if (!output) return toast("Nothing to open yet", "info");
    setOverleafBusy(true);
    try {
      openInOverleaf(buildDocument(), "Clean math");
      toast("Opening in Overleaf - it continues in a new tab", "info");
    } catch {
      toast("Could not reach Overleaf from this browser", "error");
    }
    // The new tab takes a moment to appear; keep the spinner until it has.
    window.setTimeout(() => setOverleafBusy(false), 1400);
  }, [output, buildDocument, toast]);

  const exportAs = useCallback(
    async (id: ExportId) => {
      switch (id) {
        case "copy":
          return copy();
        case "copyMath":
          return copyText(mathOnly(output), "Maths copied, without the prose");
        case "copyObsidian":
          return copyText(
            cleanMath(input, { ...options, delimiterMode: "standard", wrapEnvironments: true }),
            "Copied for Obsidian / Notion",
          );
        case "downloadSnippet":
          return download();
        case "downloadDocument": {
          if (!output) return toast("Nothing to download yet", "info");
          const doc = buildDocument();
          downloadText(doc.source, "clean-math-document.tex");
          return toast("Saved clean-math-document.tex" + (doc.engine === "xelatex" ? " - compile with XeLaTeX" : ""));
        }
        case "copyPng":
        case "downloadPng": {
          if (!output) return toast("Nothing to render yet", "info");
          const png = renderPreviewPng(output, ui.fontSize);
          try {
            if (id === "copyPng") {
              await copyPng(png);
              toast("Preview copied as an image");
            } else {
              downloadBlob(await png, "clean-math.png");
              toast("Saved clean-math.png");
            }
          } catch {
            toast("This browser could not render the image - try Chrome or Edge", "error");
          }
          return;
        }
      }
    },
    [copy, copyText, output, input, options, download, buildDocument, toast, ui.fontSize],
  );

  /** Cmd/Ctrl+Enter: whichever action the user chose in Academic settings. */
  const primary = useCallback(
    () => (ui.primaryAction === "overleaf" ? openOverleaf() : void copy()),
    [ui.primaryAction, openOverleaf, copy],
  );

  /** Keep the output's scroll position in step with the editor's. */
  const followScroll = useCallback(
    (ratio: number) => {
      const el = scrollerRef.current;
      if (!ui.syncScroll || !el) return;
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    },
    [ui.syncScroll],
  );

  const share = useCallback(async () => {
    if (!input.trim()) {
      toast("Nothing to share yet", "info");
      return;
    }
    if (input.length > SHARE_MAX_CHARS) {
      toast("Too long for a link - download the file instead", "error");
      return;
    }
    try {
      const url = window.location.origin + window.location.pathname + (await encodeShare(input));
      toast((await writeClipboard(url)) ? "Share link copied" : "Copy failed", "success");
    } catch {
      toast("This browser cannot build share links", "error");
    }
  }, [input, toast]);

  /** Paste -> clean -> copy back, for when the answer only needs a quick fix. */
  const cleanClipboard = useCallback(async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      toast("Browser blocked clipboard read - paste with Cmd/Ctrl+V instead", "error");
      return;
    }
    if (!text.trim()) {
      toast("Clipboard is empty", "info");
      return;
    }
    const result = cleanMathDetailed(text, options);
    const previous = input;
    setInput(text);
    if (await writeClipboard(result.output)) {
      toast(
        "Cleaned " + result.blocks + (result.blocks === 1 ? " block" : " blocks") + " - copied back",
        "success",
        previous !== text ? { label: "Undo", run: () => setInput(previous) } : undefined,
      );
    } else {
      toast("Cleaned, but the copy failed - use the Copy button", "error");
    }
  }, [input, options, setInput, toast]);

  const clear = useCallback(() => {
    if (!input) return;
    const previous = input;
    setInput("");
    toast("Editor cleared", "info", { label: "Undo", run: () => setInput(previous) });
  }, [input, setInput, toast]);

  const pickExample = useCallback(
    (idx: number) => replaceInput(EXAMPLES[idx].text, EXAMPLES[idx].label),
    [replaceInput],
  );

  const toggleFocus = useCallback(
    (pane: Exclude<Focus, "none">) => setUi({ focus: ui.focus === pane ? "none" : pane }),
    [setUi, ui.focus],
  );
  const setFont = useCallback(
    (n: number) => setUi({ fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, n)) }),
    [setUi],
  );

  /* --- a shared link opens its snippet ---------------------------------- */
  // Decoding is async (DecompressionStream), so this cannot be a store
  // snapshot; it runs once, writes through the draft store, and offers the
  // visitor's own previous draft back, since a link should never eat it.
  useEffect(() => {
    if (!window.location.hash.startsWith(SHARE_PREFIX)) return;
    const hash = window.location.hash;
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    void decodeShare(hash).then((text) => {
      if (text === null) {
        toast("That share link is damaged or truncated", "error");
        return;
      }
      const previous = draftStore.get();
      draftStore.set(text);
      toast(
        "Opened a shared snippet",
        "info",
        previous && previous !== text ? { label: "Restore my draft", run: () => draftStore.set(previous) } : undefined,
      );
    });
  }, [toast]);

  /* --- keyboard shortcuts ------------------------------------------------ */
  const run = useCallback(
    (id: ShortcutId) => {
      const modes: Partial<Record<ShortcutId, ConfigOptions["delimiterMode"]>> = {
        modeStandard: "standard",
        modeAcademic: "academic",
        modeInline: "inline",
      };
      switch (id) {
        case "copy": return primary();
        case "copyMath": return void exportAs("copyMath");
        case "overleaf": return openOverleaf();
        case "download": return download();
        case "share": return void share();
        case "cleanClipboard": return void cleanClipboard();
        case "modeStandard":
        case "modeAcademic":
        case "modeInline": {
          const mode = modes[id]!;
          setOptions({ ...options, delimiterMode: mode });
          return toast(DELIMITER_MODES.find((m) => m.id === mode)!.label + " delimiters", "info");
        }
        case "togglePreview": return setUi({ tab: OUTPUT_TABS[(OUTPUT_TABS.indexOf(ui.tab) + 1) % OUTPUT_TABS.length] });
        case "toggleTheme": return setTheme(getThemeSnapshot() === "dark" ? "light" : "dark");
        case "toggleWrap": {
          const next = !ui.wrapInput;
          return setUi({ wrapInput: next, wrapOutput: next });
        }
        case "fontUp": return setFont(ui.fontSize + 1);
        case "fontDown": return setFont(ui.fontSize - 1);
        case "fontReset": return setFont(DEFAULT_UI.fontSize);
        case "focusInput": return toggleFocus("input");
        case "focusOutput": return toggleFocus("output");
        case "help": return setShortcutsOpen((v) => !v);
      }
    },
    [primary, exportAs, openOverleaf, download, share, cleanClipboard, options, toast, setUi, ui, setFont, toggleFocus],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat && !["fontUp", "fontDown"].includes(matchShortcut(e, true) ?? "")) return;
      const id = matchShortcut(e, isTyping(document.activeElement));
      if (!id) return;
      e.preventDefault();
      run(id);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run]);

  /* --- layout ------------------------------------------------------------ */
  const showInput = ui.focus !== "output";
  const showOutput = ui.focus !== "input";
  const both = showInput && showOutput;

  return (
    <main className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col gap-2.5 p-3 sm:p-4 lg:min-h-0">
      <ControlBar
        options={options}
        onChange={setOptions}
        blocks={blocks}
        problems={issues.length + diagnostics.length}
        fontSize={ui.fontSize}
        onFontSize={setFont}
        primaryAction={ui.primaryAction}
        onPrimaryAction={(primaryAction) => setUi({ primaryAction })}
      />

      {/* Wide screens: two columns sized by the draggable split. Narrow screens:
          stacked, with a grip under the input that sets its height. min-w-0 on
          both columns stops a long unwrapped code line from widening the page. */}
      <div
        ref={rowRef}
        className="flex flex-1 flex-col lg:min-h-0 lg:flex-row"
        style={
          {
            "--in": both ? ui.split : 1,
            "--out": both ? 1 - ui.split : 1,
            "--input-h": ui.inputHeight + "px",
          } as React.CSSProperties
        }
      >
        {showInput && (
          <div
            className={
              "flex min-h-0 min-w-0 flex-col lg:h-auto lg:[flex:var(--in)_1_0px] " +
              (both ? "h-[var(--input-h)]" : "h-[70vh]")
            }
          >
            <MathInput
              value={input}
              onChange={setInput}
              issues={issues}
              diagnostics={diagnostics}
              onScrollRatio={followScroll}
              fontSize={ui.fontSize}
              wrap={ui.wrapInput}
              onToggleWrap={() => setUi({ wrapInput: !ui.wrapInput })}
              maximized={ui.focus === "input"}
              onToggleMaximize={() => toggleFocus("input")}
              onPickExample={pickExample}
              onReplace={replaceInput}
              onClear={clear}
              onCleanClipboard={() => void cleanClipboard()}
            />
          </div>
        )}

        {both && (
          <>
            <Splitter
              orientation="x"
              className="hidden lg:flex"
              label="Resize panes"
              value={ui.split}
              min={SPLIT_MIN}
              max={SPLIT_MAX}
              defaultValue={DEFAULT_UI.split}
              step={0.02}
              unitsPerPixel={() => 1 / Math.max(1, rowRef.current?.clientWidth ?? 1)}
              onChange={(split) => setUi({ split })}
            />
            <Splitter
              orientation="y"
              className="lg:hidden"
              label="Resize the input"
              value={ui.inputHeight}
              min={INPUT_HEIGHT_MIN}
              max={INPUT_HEIGHT_MAX}
              defaultValue={DEFAULT_UI.inputHeight}
              step={24}
              unitsPerPixel={() => 1}
              onChange={(inputHeight) => setUi({ inputHeight })}
            />
          </>
        )}

        {showOutput && (
          <div className="flex min-h-[420px] min-w-0 flex-col gap-2.5 lg:min-h-0 lg:[flex:var(--out)_1_0px]">
            <MathOutput
              output={output}
              input={input}
              syncScroll={ui.syncScroll}
              onToggleSync={() => setUi({ syncScroll: !ui.syncScroll })}
              scrollerRef={scrollerRef}
              tab={ui.tab}
              onTab={(tab) => setUi({ tab })}
              fontSize={ui.fontSize}
              wrap={ui.wrapOutput}
              onToggleWrap={() => setUi({ wrapOutput: !ui.wrapOutput })}
              maximized={ui.focus === "output"}
              onToggleMaximize={() => toggleFocus("output")}
              onDownload={download}
              downloadName={downloadName}
              onShare={() => void share()}
            />
            <div className="shrink-0">
              <ActionBar
                disabled={!output}
                copied={copied}
                charCount={output.length}
                snippetName={downloadName}
                primaryAction={ui.primaryAction}
                overleafBusy={overleafBusy}
                onExport={(id) => void exportAs(id)}
                onOverleaf={openOverleaf}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
