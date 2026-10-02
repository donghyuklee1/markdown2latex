"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ActionBar, { type ExportId } from "./ActionBar";
import Workbench, { type BenchTab } from "./studio/Workbench";
import SideRail, { type RailItem } from "./rails/SideRail";
import DocTabs from "./rails/DocTabs";
import SymbolPalette from "./rails/SymbolPalette";
import SnippetsPanel from "./rails/SnippetsPanel";
import HistoryPanel from "./rails/HistoryPanel";
import OutlinePanel from "./rails/OutlinePanel";
import { BookMarked, Boxes, FileCode2, FlaskConical, HardDrive, History, ListOrdered, Network, PenTool, Ruler, Shapes, X } from "lucide-react";
import DrivePanel from "./drive/DrivePanel";
import { activeDoc, docs, docsStore, docTitle, fileBase, MAX_DOCS, snapshot, titleFromFileName } from "@/lib/documents";
import type { StudioContext } from "./studio/types";
import ControlBar from "./ControlBar";
import { copyPng, downloadBlob, downloadText, mathOnly, openInOverleaf, renderPreviewPng, writeClipboard } from "./exporters";
import MathInput from "./MathInput";
import MathOutput from "./MathOutput";
import Splitter from "./Splitter";
import { setShortcutsOpen } from "./ShortcutsDialog";
import { useToast } from "./Toast";
import { cleanMath, cleanMathDetailed, DELIMITER_MODES, type ConfigOptions } from "@/lib/cleaner";
import { diagnose } from "@/lib/diagnostics";
import { repairLatex, type RepairResult } from "@/lib/repair";
import { planInsertion } from "@/lib/insertion";
import { isDocument, katexMacros } from "@/lib/texDocument";
import { MacroContext } from "./Katex";
import RepairDialog from "./RepairDialog";
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
  FONT_MAX,
  FONT_MIN,
  INPUT_HEIGHT_MAX,
  INPUT_HEIGHT_MIN,
  OUTPUT_TABS,
  SPLIT_MAX,
  SPLIT_MIN,
  aiStore,
  uiStore,
  type Focus,
  type UiPrefs,
} from "@/lib/persistedStore";
import { useAutoAnalysis } from "./ai/orchestrator";
import ImageConvert from "./ai/ImageConvert";
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
  const docState = useSyncExternalStore(docsStore.subscribe, docsStore.get, docsStore.getServer);
  const doc = activeDoc(docState);
  const input = doc.text ?? DEFAULT_TEXT;
  const setInput = docs.setText;
  const title = docTitle(doc, docState.docs.indexOf(doc) + 1);
  const [leftRail, setLeftRail] = useState<string | null>(null);
  // The account dock and menu ask for a rail panel (History) by event.
  useEffect(() => {
    const onOpen = (e: Event) => setLeftRail((e as CustomEvent<string>).detail);
    window.addEventListener("cleanmath:open-rail", onOpen);
    return () => window.removeEventListener("cleanmath:open-rail", onOpen);
  }, []);
  const [rightRail, setRightRail] = useState<string | null>(null);
  const setUi = useCallback((patch: Partial<UiPrefs>) => uiStore.update((prev) => ({ ...prev, ...patch })), []);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  const rowRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // The whole engine is synchronous and fast enough to run on every keystroke,
  // so there is no debounce to make the preview lag behind the caret.
  const { output, issues, blocks, mathBlocks } = useMemo(() => cleanMathDetailed(input, options), [input, options]);
  // One name per document: the tab title is the file name, everywhere it saves.
  const base = useMemo(() => fileBase(doc), [doc]);
  const ext = options.delimiterMode === "academic" ? ".tex" : ".md";
  const downloadName = base + ext;
  const projectName = doc.title.trim() || "Clean math";
  const renameDoc = useCallback(
    (name: string) => {
      const next = titleFromFileName(name);
      if (next === doc.title.trim()) return;
      docs.rename(doc.id, next);
      toast(next ? "Renamed - saves as " + fileBase({ id: doc.id, title: next, text: null, updatedAt: 0 }) + ext : "Name cleared - saves as clean-math" + ext, "info");
    },
    [doc, ext, toast],
  );

  // KaTeX-checking every block is the slowest step, so it runs on a deferred
  // copy: typing stays instant and the health report catches up a frame later.
  const deferredBlocks = useDeferredValue(mathBlocks);
  // A pasted .tex document brings its own macros; KaTeX gets them everywhere.
  const deferredInput = useDeferredValue(input);
  // AI mode: analyses run in the background as the mathematics changes.
  const aiPrefs = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  useAutoAnalysis(deferredInput, aiPrefs.mode, !!aiPrefs.apiKey);
  const docMode = useMemo(() => isDocument(deferredInput), [deferredInput]);
  const macros = useMemo(() => katexMacros(deferredInput), [deferredInput]);
  const diagnostics = useMemo(() => diagnose(deferredBlocks, macros), [deferredBlocks, macros]);
  const [docNoticeHidden, setDocNoticeHidden] = useState(false);

  const [overleafBusy, setOverleafBusy] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const [benchOpen, setBenchOpen] = useState(false);
  const [repair, setRepair] = useState<RepairResult | null>(null);
  const [benchTab, setBenchTab] = useState<BenchTab>("sandbox");
  const closeBench = useCallback(() => setBenchOpen(false), []);

  /** A complete document: cleaned in Academic mode, prose turned into LaTeX. */
  const buildDocument = useCallback(
    () => toLatexDocument(cleanMath(input, { ...options, delimiterMode: "academic", wrapEnvironments: false })),
    [input, options],
  );

  /** Replace the whole input, keeping the old text one click away. */
  const replaceInput = useCallback(
    (text: string, message: string) => {
      const previous = input;
      snapshot(previous, title, "replace");
      setInput(text);
      if (previous && previous !== text) {
        toast(message, "info", { label: "Undo", run: () => setInput(previous) });
      } else {
        toast(message, "info");
      }
    },
    [input, setInput, toast, title],
  );

  // History: a snapshot once typing pauses (skipped for the untouched sample).
  useEffect(() => {
    if (doc.text === null) return;
    const t = window.setTimeout(() => snapshot(input, title, "idle"), 2500);
    return () => window.clearTimeout(t);
  }, [input, title, doc.text]);

  const copy = useCallback(async () => {
    if (!output) {
      toast("Nothing to copy yet", "info");
      return;
    }
    if (!(await writeClipboard(output))) {
      toast("Copy failed - select the code and press Cmd/Ctrl+C", "error");
      return;
    }
    snapshot(input, title, "copy");
    setCopied(true);
    toast("Clean LaTeX copied");
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }, [output, toast, input, title]);

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
      openInOverleaf(buildDocument(), projectName);
      toast("Opening in Overleaf - it continues in a new tab", "info");
    } catch {
      toast("Could not reach Overleaf from this browser", "error");
    }
    // The new tab takes a moment to appear; keep the spinner until it has.
    window.setTimeout(() => setOverleafBusy(false), 1400);
  }, [output, buildDocument, toast, projectName]);

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
          downloadText(doc.source, base + "-document.tex");
          return toast("Saved " + base + "-document.tex" + (doc.engine === "xelatex" ? " - compile with XeLaTeX" : ""));
        }
        case "drive":
          return setLeftRail("drive");
        case "copyPng":
        case "downloadPng": {
          if (!output) return toast("Nothing to render yet", "info");
          const png = renderPreviewPng(output, ui.fontSize, macros);
          try {
            if (id === "copyPng") {
              await copyPng(png);
              toast("Preview copied as an image");
            } else {
              downloadBlob(await png, base + ".png");
              toast("Saved " + base + ".png");
            }
          } catch {
            toast("This browser could not render the image - try Chrome or Edge", "error");
          }
          return;
        }
      }
    },
    [copy, copyText, output, input, options, download, buildDocument, toast, ui.fontSize, macros, base],
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

  /* --- the bridge Studio features use to reach the editor ---------------- */
  const selectLines = useCallback(
    (from: number, to: number) => {
      // A maximised output pane has no editor mounted; bring it back first.
      if (ui.focus === "output") setUi({ focus: "none" });
      window.requestAnimationFrame(() => {
        const ta = editorRef.current;
        if (!ta) return;
        const lines = ta.value.split("\n");
        let start = 0;
        for (let i = 0; i < from - 1 && i < lines.length; i++) start += lines[i].length + 1;
        let end = start;
        for (let i = from - 1; i < to && i < lines.length; i++) end += lines[i].length + 1;
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(start, Math.max(start, end - 1));
        const lineHeight = Math.round(ui.fontSize * 1.85);
        ta.scrollTo({ top: Math.max(0, (from - 1) * lineHeight - 72), behavior: "smooth" });
      });
    },
    [ui.focus, ui.fontSize, setUi],
  );

  const insertText = useCallback(
    (text: string) => {
      const previous = input;
      setInput(input.replace(/\s*$/, "") + (input.trim() ? "\n\n" : "") + text.trim() + "\n");
      toast("Inserted into the editor", "success", { label: "Undo", run: () => setInput(previous) });
    },
    [input, setInput, toast],
  );

  /**
   * Insert at the editor's cursor so the result renders: in prose a symbol is
   * wrapped as `$...$` and a snippet as its own `$$` block; inside maths it goes
   * in bare (lib/insertion.ts). `@` marks where the selection goes. execCommand
   * keeps the edit on the browser's own undo stack.
   */
  /** Raw text at the cursor as its own paragraph (converted images, Drive imports). */
  const insertBlock = useCallback(
    (text: string) => {
      const ta = editorRef.current;
      const at = ta ? ta.selectionStart : input.length;
      const end = ta ? ta.selectionEnd : at;
      const pre = input.slice(0, at);
      const post = input.slice(end);
      const before = !pre ? "" : pre.endsWith("\n\n") ? "" : pre.endsWith("\n") ? "\n" : "\n\n";
      const after = !post ? "\n" : post.startsWith("\n") ? "\n" : "\n\n";
      setInput(pre + before + text + after + post);
      if (ui.focus === "output") setUi({ focus: "none" });
    },
    [input, setInput, ui.focus, setUi],
  );

  const insertAtCursor = useCallback(
    (template: string, kind: "inline" | "display" = "inline") => {
      if (ui.focus === "output") setUi({ focus: "none" });
      const ta = editorRef.current;
      if (!ta) return;
      const { selectionStart: start, selectionEnd: end, value } = ta;
      const plan = planInsertion(value, start, end, template, kind);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(start, end);
      if (!document.execCommand("insertText", false, plan.text)) setInput(value.slice(0, start) + plan.text + value.slice(end));
      ta.setSelectionRange(plan.caret, plan.caret);
    },
    [ui.focus, setUi, setInput],
  );
  const getSelection = useCallback(() => {
    const ta = editorRef.current;
    return ta ? ta.value.slice(ta.selectionStart, ta.selectionEnd) : "";
  }, []);

  const studio: StudioContext = useMemo(
    () => ({ input, output, selectLines, insert: insertText }),
    [input, output, selectLines, insertText],
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
      // Shared snippets open in a tab of their own: a link never eats a draft.
      if (docs.create(text, "Shared") === null) {
        snapshot(activeDoc(docsStore.get()).text ?? "", "Before shared link", "replace");
        docs.setText(text);
      }
      toast("Opened a shared snippet in a new tab", "info");
    });
  }, [toast]);

  /** Check & Fix: propose repairs so everything renders; nothing changes until Apply. */
  const checkFix = useCallback(() => {
    const result = repairLatex(input, macros);
    // The badge counts problems in the *cleaned* output. One that only appears
    // after cleaning has nothing to repair in the input, but it must still be
    // shown here, so the button and the dialog always agree.
    const listed = new Set([...result.fixes.map((f) => f.line), ...result.unresolved.map((u) => u.line)]);
    for (const p of [...issues.map((i) => ({ line: i.line, message: i.message })), ...diagnostics]) {
      if (!listed.has(p.line)) result.unresolved.push({ line: p.line, message: p.message + " (after cleaning)" });
    }
    if (!result.fixes.length && !result.unresolved.length) {
      toast("Everything renders - nothing to fix", "success");
      return;
    }
    setRepair(result);
  }, [input, toast, macros, issues, diagnostics]);

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
        case "toggleBench": return setBenchOpen((v) => !v);
        case "checkFix": return checkFix();
        case "newDoc": return void (docs.create() === null && toast("Up to " + MAX_DOCS + " tabs - close one first", "info"));
      }
    },
    [primary, exportAs, openOverleaf, download, share, cleanClipboard, checkFix, options, toast, setUi, ui, setFont, toggleFocus],
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

  const openBench = (t: BenchTab) => {
    setBenchTab(t);
    setBenchOpen(true);
  };
  const leftItems: RailItem[] = [
    { id: "symbols", label: "Symbol palette", icon: Shapes, panel: <SymbolPalette onInsert={(tex) => insertAtCursor(tex, "inline")} /> },
    {
      id: "drive",
      label: "Google Drive",
      icon: HardDrive,
      panel: (
        <DrivePanel
          exports={{
            base,
            source: () => input,
            sourceExt: /\\documentclass/.test(input) ? "tex" : "md",
            clean: () => output,
            document: () => buildDocument().source,
            png: () => renderPreviewPng(output, ui.fontSize, macros),
          }}
          onOpen={(text, name) => {
            replaceInput(text, "Opened " + name + " from Drive");
            setLeftRail(null);
          }}
          onOpenAsNew={(text, name) => {
            if (docs.create(text, name) === null) toast("Up to " + MAX_DOCS + " tabs - close one first", "info");
            setLeftRail(null);
          }}
        />
      ),
    },
    { id: "snippets", label: "Snippets", icon: BookMarked, panel: <SnippetsPanel getSelection={getSelection} output={output} onInsert={(latex) => insertAtCursor(latex, "display")} /> },
    {
      id: "history",
      label: "History",
      icon: History,
      panel: (
        <HistoryPanel
          onRestore={(text) => {
            replaceInput(text, "Restored a snapshot");
            setLeftRail(null);
          }}
          onOpenAsNew={(text, t) => {
            if (docs.create(text, t + " (restored)") === null) toast("Up to " + MAX_DOCS + " tabs - close one first", "info");
            setLeftRail(null);
          }}
        />
      ),
    },
  ];
  const rightItems: RailItem[] = [
    {
      id: "outline",
      label: "Equation outline",
      icon: ListOrdered,
      badge: diagnostics.length + issues.length,
      panel: <OutlinePanel blocks={mathBlocks} diagnostics={diagnostics} onSelect={selectLines} />,
    },
    { id: "graph", label: "Derivation notes", icon: Network, keys: "Alt+P", onClick: () => setUi({ tab: "graph", focus: ui.focus === "input" ? "none" : ui.focus }) },
    { id: "sandbox", label: "Shape sandbox", icon: Boxes, divider: true, onClick: () => openBench("sandbox") },
    { id: "units", label: "Unit checker", icon: Ruler, onClick: () => openBench("units") },
    { id: "sketch", label: "Sketch → TikZ", icon: PenTool, onClick: () => openBench("sketch") },
    { id: "lab", label: "All tools", icon: FlaskConical, keys: "Alt+R", divider: true, onClick: () => setUi({ view: "lab" }) },
  ];

  return (
    // The rails sit in the side margins a wide screen leaves empty: the row is
    // widened by exactly their width, so the panes keep their size.
    <MacroContext.Provider value={macros}>
    <ImageConvert
      insert={insertBlock}
      replace={(text) => replaceInput(text, "Converted an image")}
      openAsNew={(text, title) => {
        if (docs.create(text, title) === null) toast("Up to " + MAX_DOCS + " tabs - close one first", "info");
      }}
    />
    <main className="mx-auto flex w-full max-w-[1910px] flex-1 gap-2.5 p-3 sm:p-4 lg:min-h-0">
      <SideRail side="left" items={leftItems} open={leftRail} onOpen={setLeftRail} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 lg:min-h-0">
      <DocTabs />
      <ControlBar
        options={options}
        onChange={setOptions}
        blocks={blocks}
        problems={issues.length + diagnostics.length}
        fontSize={ui.fontSize}
        onFontSize={setFont}
        primaryAction={ui.primaryAction}
        onPrimaryAction={(primaryAction) => setUi({ primaryAction })}
        benchOpen={benchOpen}
        onToggleBench={() => setBenchOpen((v) => !v)}
      />

      {docMode && !docNoticeHidden && (
        <div className="themed flex shrink-0 animate-fade-in flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-1.5 text-xs text-text">
          <FileCode2 size={14} className="text-accent" />
          <span>
            <b>LaTeX document detected.</b> The preamble is kept exactly as written
            {Object.keys(macros).length > 0 && (
              <>
                , and its <b className="font-mono">{Object.keys(macros).length}</b> macros are understood everywhere
              </>
            )}
            .
          </span>
          {options.delimiterMode !== "academic" && (
            <button
              type="button"
              onClick={() => setOptions({ ...options, delimiterMode: "academic" })}
              className="press rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink hover:bg-accent/90"
              title="Keep display maths as equation*/align* instead of converting it to $$"
            >
              Use Academic mode
            </button>
          )}
          <button type="button" onClick={() => setDocNoticeHidden(true)} aria-label="Dismiss" className="press ml-auto rounded p-0.5 text-faint hover:text-text">
            <X size={13} />
          </button>
        </div>
      )}

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
              onCheckFix={checkFix}
              editorRef={editorRef}
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
              studio={studio}
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
                fileBase={base}
                fileExt={ext}
                onRename={renameDoc}
                primaryAction={ui.primaryAction}
                overleafBusy={overleafBusy}
                onExport={(id) => void exportAs(id)}
                onOverleaf={openOverleaf}
              />
            </div>
          </div>
        )}
      </div>
      </div>
      <SideRail side="right" items={rightItems} open={rightRail} onOpen={setRightRail} />
      <Workbench open={benchOpen} tab={benchTab} onTab={setBenchTab} onClose={closeBench} context={studio} />
      {repair && (
        <RepairDialog
          result={repair}
          onClose={() => setRepair(null)}
          onJump={(line) => {
            setRepair(null);
            selectLines(line, line);
          }}
          onApply={() => {
            const n = repair.fixes.length;
            replaceInput(repair.output, "Applied " + n + (n === 1 ? " fix" : " fixes"));
            setRepair(null);
          }}
        />
      )}
    </main>
    </MacroContext.Provider>
  );
}
