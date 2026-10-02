"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeftRight, BookmarkPlus, Copy, DollarSign, Eye, Link2, Loader2, Sigma, Sparkles, X } from "lucide-react";
import { BlockMath, InlineMath } from "@/components/Katex";
import { cleanMath, type ConfigOptions, type MathBlock } from "@/lib/cleaner";
import { buildCorrespondence, linesOf, mapRange, type Range } from "@/lib/correspond";
import { connectionsFor, explainRequest, mergeAi, namesIn, offlineModel, parseExplain, stepAtLine, type Step } from "@/lib/derivation";
import { snippets } from "@/lib/documents";
import { aiStore, analysisStore, uiStore } from "@/lib/persistedStore";
import { openAiKey } from "../ai/AiKeyDialog";
import { currentModel } from "../ai/aiKey";
import { keyFor } from "../ai/orchestrator";
import { AiError, generateJson } from "../derivation/gemini";
import { writeClipboard } from "../exporters";
import { useToast } from "../Toast";
import { outputHighlight } from "./outputHighlight";

type Side = "input" | "output";
type Panel = "meaning" | "links" | "preview" | null;

interface Sel extends Range {
  side: Side;
  text: string;
  /** Where to float: above this point (viewport coordinates). */
  x: number;
  y: number;
}

/** Prose with $...$ maths rendered. */
function MathText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\$[^$]+\$)/g).map((p, i) =>
        p.length > 2 && p.startsWith("$") && p.endsWith("$") ? <InlineMath key={i} math={p.slice(1, -1)} renderError={() => <span>{p}</span>} /> : <span key={i}>{p}</span>,
      )}
    </>
  );
}

/* The maths inside a selection, without delimiters, for preview and lookup. */
function mathOf(text: string): string {
  const t = text.trim();
  const delim = /^(\$\$|\$|\\\[|\\\()([\s\S]*?)(\$\$|\$|\\\]|\\\))$/.exec(t);
  if (delim) return delim[2].trim();
  const inner = /\$\$([\s\S]+?)\$\$|\$([^$]+)\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/.exec(t);
  return (inner ? inner[1] ?? inner[2] ?? inner[3] ?? inner[4] : t).trim();
}

/** Output offsets of a DOM selection inside the code view (lines carry data-line). */
function outputRange(container: Element, output: string): Range | null {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return null;
  const r = s.getRangeAt(0);
  if (!container.contains(r.commonAncestorContainer)) return null;
  const starts = [0];
  for (let i = 0; i < output.length; i++) if (output[i] === "\n") starts.push(i + 1);
  const point = (node: Node, offset: number) => {
    const lineEl = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest("[data-line]");
    if (!lineEl) return null;
    const code = lineEl.querySelector("code");
    if (!code) return null;
    const pre = document.createRange();
    pre.selectNodeContents(code);
    try {
      pre.setEnd(node, offset);
    } catch {
      return null;
    }
    const line = Number(lineEl.getAttribute("data-line"));
    return (starts[line] ?? 0) + Math.min(pre.toString().length, (output.split("\n")[line] ?? "").length);
  };
  const a = point(r.startContainer, r.startOffset);
  const b = point(r.endContainer, r.endOffset);
  if (a === null || b === null || a === b) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/**
 * Select text in the editor or in the output's code view and a small toolbar
 * fades in above it: show the matching part on the other side, what the
 * selection means (definitions, its derivation step, and Gemini on request),
 * which equations it connects to, a rendered preview, copy clean, wrap in $,
 * and save as a snippet.
 */
export default function SelectionAssist({
  input,
  output,
  blocks,
  options,
  editorRef,
  selectRange,
  selectLines,
  setInput,
}: {
  input: string;
  output: string;
  blocks: ReadonlyArray<MathBlock>;
  options: ConfigOptions;
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  selectRange: (start: number, end: number) => void;
  selectLines: (from: number, to: number) => void;
  setInput: (text: string) => void;
}) {
  const [sel, setSel] = useState<Sel | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [ai, setAi] = useState<{ key: string; busy: boolean; result: ReturnType<typeof parseExplain>; error: string | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const prefs = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const store = useSyncExternalStore(analysisStore.subscribe, analysisStore.get, analysisStore.getServer);

  // Notice selections in either pane.
  useEffect(() => {
    const check = (e: MouseEvent | KeyboardEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      const ta = editorRef.current;
      if (ta && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd) {
        const r = ta.getBoundingClientRect();
        const x = "clientX" in e ? Math.min(Math.max(e.clientX, r.left + 120), r.right - 120) : r.left + r.width / 2;
        const y = "clientY" in e ? Math.max(e.clientY - 14, r.top + 40) : r.top + 60;
        const text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
        if (text.trim()) return open({ side: "input", start: ta.selectionStart, end: ta.selectionEnd, text, x, y });
      }
      const code = document.querySelector("[data-output-code]");
      if (code) {
        const range = outputRange(code, output);
        if (range) {
          const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
          return open({ side: "output", ...range, text: output.slice(range.start, range.end), x: rect.left + rect.width / 2, y: rect.top - 6 });
        }
      }
    };
    const open = (s: Sel) => {
      setSel((prev) => (prev && prev.side === s.side && prev.start === s.start && prev.end === s.end ? prev : s));
      setPanel(null);
    };
    const up = (e: MouseEvent) => window.setTimeout(() => check(e), 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return setSel(null);
      if (e.shiftKey || e.key === "Shift") window.setTimeout(() => check(e), 0);
    };
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setSel(null);
    };
    document.addEventListener("mouseup", up);
    document.addEventListener("keyup", key);
    document.addEventListener("mousedown", down);
    return () => {
      document.removeEventListener("mouseup", up);
      document.removeEventListener("keyup", key);
      document.removeEventListener("mousedown", down);
    };
  }, [editorRef, output]);

  // Typing in the editor ends the selection.
  useEffect(() => {
    const t = window.setTimeout(() => setSel((s) => (s && s.side === "input" && input.slice(s.start, s.end) !== s.text ? null : s)), 0);
    return () => window.clearTimeout(t);
  }, [input]);

  const model = useMemo(() => {
    if (!sel) return null;
    const offline = offlineModel(input);
    const raw = store[keyFor(input)]?.result;
    return raw ? mergeAi(raw, offline) : offline;
  }, [sel, input, store]);

  if (!sel || !model) return null;

  const math = mathOf(sel.text);
  const names = namesIn(math);
  const inputLine = sel.side === "input" ? linesOf(input, sel)[0] : null;
  const step: Step | null = inputLine !== null ? stepAtLine(model, inputLine) : model.steps.find((s) => s.latex && math && s.latex.includes(math.slice(0, 24))) ?? null;
  const links = connectionsFor(names, model).filter((c) => c.step.id !== step?.id || c.role === "defines");
  const defs = names
    .map((n) => ({ n, v: model.variables.find((v) => v.symbol === n || v.symbol.replace(/[{}]/g, "") === n.replace(/[{}]/g, "")) }))
    .filter((x) => x.v?.meaning);
  const aiKey = sel.side + ":" + sel.start + ":" + sel.end;

  const showOther = () => {
    const corr = buildCorrespondence(input, output, blocks);
    const from = sel.side;
    const m = mapRange(corr, from, sel, from === "input" ? input : output, from === "input" ? output : input);
    if (!m) return toast("No counterpart found", "info");
    if (from === "input") {
      if (uiStore.get().tab !== "code") uiStore.set({ ...uiStore.get(), tab: "code", focus: uiStore.get().focus === "input" ? "none" : uiStore.get().focus });
      const [a, b] = linesOf(output, m);
      window.setTimeout(() => outputHighlight.show(a, b), 60);
    } else {
      selectRange(m.start, m.end);
    }
    toast(m.exact ? "Shown in the " + (from === "input" ? "output" : "editor") : "The cleaner rewrote this - the whole " + (m.kind === "block" ? "equation" : "passage") + " is shown", "info");
    setSel(null);
  };

  const explain = async () => {
    if (!prefs.apiKey) return openAiKey();
    setAi({ key: aiKey, busy: true, result: null, error: null });
    try {
      const m = await currentModel();
      const answer = await generateJson((mm, thinking) => explainRequest(sel.text, input, mm, thinking), prefs.apiKey, m);
      const r = parseExplain(answer.json);
      setAi({ key: aiKey, busy: false, result: r, error: r ? null : "No explanation came back." });
    } catch (e) {
      setAi({ key: aiKey, busy: false, result: null, error: e instanceof AiError ? e.message : String(e) });
    }
  };

  const tools: Array<{ id: string; label: string; icon: typeof Sigma; run: () => void; active?: boolean; hide?: boolean }> = [
    { id: "other", label: sel.side === "input" ? "In output" : "In editor", icon: ArrowLeftRight, run: showOther },
    { id: "meaning", label: "Meaning", icon: Sigma, run: () => setPanel((p) => (p === "meaning" ? null : "meaning")), active: panel === "meaning" },
    { id: "links", label: "Connections", icon: Link2, run: () => setPanel((p) => (p === "links" ? null : "links")), active: panel === "links" },
    { id: "preview", label: "Preview", icon: Eye, run: () => setPanel((p) => (p === "preview" ? null : "preview")), active: panel === "preview" },
    {
      id: "copy",
      label: sel.side === "input" ? "Copy clean" : "Copy",
      icon: Copy,
      run: async () => {
        const text = sel.side === "input" ? cleanMath(sel.text, options) : sel.text;
        toast((await writeClipboard(text)) ? "Copied" : "Copy failed", "success");
      },
    },
    {
      id: "wrap",
      label: "Wrap in $",
      icon: DollarSign,
      hide: sel.side !== "input" || /^\s*\$/.test(sel.text),
      run: () => {
        const wrapped = "$" + sel.text.trim() + "$";
        setInput(input.slice(0, sel.start) + wrapped + input.slice(sel.end));
        setSel(null);
      },
    },
    {
      id: "snippet",
      label: "Save snippet",
      icon: BookmarkPlus,
      run: () => {
        snippets.add(sel.text.trim().replace(/\s+/g, " ").slice(0, 40), math || sel.text);
        toast("Saved to your snippets", "success");
      },
    },
  ];

  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const left = Math.min(Math.max(sel.x, 230), vw - 230);
  // Not enough room above for the toolbar and its panel: open below the selection.
  const below = sel.y < 330;

  return (
    <div
      ref={box}
      className="fixed z-[70] w-max max-w-[min(460px,94vw)] animate-pop-in"
      style={{ left, top: below ? sel.y + 28 : sel.y, transform: "translate(-50%, " + (below ? "0" : "-100%") + ")" }}
      onMouseDown={(e) => e.preventDefault() /* keep the text selected */}
    >
      <div className={"flex flex-col gap-1.5 " + (below ? "" : "flex-col-reverse")}>
        <div className="themed flex items-center gap-0.5 self-center rounded-xl border border-border bg-surface p-1 shadow-xl shadow-black/15">
          {tools
            .filter((t) => !t.hide)
            .map((t, i, all) => ({ ...t, sep: i > 0 && all[i - 1].id === "preview" }))
            .map((t) => (
              <span key={t.id} className="contents">
              {t.sep && <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />}
              <button
                type="button"
                onClick={t.run}
                title={t.id === "other" ? (sel.side === "input" ? "Show the matching part of the output" : "Show the matching part of the editor") : t.label}
                aria-label={t.label}
                className={"press flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors " + (t.active ? "bg-accent/15 text-accent" : "text-muted hover:bg-surface-2 hover:text-text")}
              >
                <t.icon size={13} />
                {/* The three everyday actions are icons (their names are tooltips). */}
                {!(t.id === "copy" || t.id === "wrap" || t.id === "snippet") && <span>{t.label}</span>}
              </button>
              </span>
            ))}
          <button type="button" onClick={() => setSel(null)} aria-label="Close" className="press rounded-lg p-1 text-faint hover:bg-surface-2 hover:text-text">
            <X size={12} />
          </button>
        </div>

        {panel && (
          <div className="themed scroll-slim max-h-[44vh] w-[min(460px,94vw)] animate-fade-in overflow-y-auto rounded-xl border border-border bg-surface p-3 text-xs shadow-2xl shadow-black/15">
            {panel === "preview" && (
              <div className="overflow-x-auto py-1 text-[15px] text-text">
                {math ? <BlockMath math={math} renderError={(e) => <span className="text-[11px] text-danger">Does not render: {e.message}</span>} /> : <span className="text-faint">Nothing to render.</span>}
              </div>
            )}

            {panel === "meaning" && (
              <div className="space-y-2.5">
                {step && (
                  <div>
                    <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint">In the derivation</div>
                    <div className="font-semibold text-text">
                      {step.title}
                      {step.label && <span className="ml-1.5 font-mono text-[10px] font-normal text-faint">{step.label}</span>}
                    </div>
                    <p className="mt-0.5 leading-snug text-muted">
                      <MathText text={step.explanation || step.summary} />
                    </p>
                  </div>
                )}
                {defs.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Symbols</div>
                    <ul className="space-y-1">
                      {defs.map(({ n, v }) => (
                        <li key={n} className="flex gap-2">
                          <code className="shrink-0 font-mono text-[11px] text-text">{n}</code>
                          <span className="text-muted">
                            <MathText text={v!.meaning} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!step && !defs.length && <p className="text-faint">Nothing in the document defines this yet.</p>}
                <div className="border-t border-border pt-2">
                  {ai?.key === aiKey && ai.result ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#4b8cf5]">
                        <Sparkles size={11} /> Gemini
                      </div>
                      <p className="leading-relaxed text-text">
                        <MathText text={ai.result.meaning} />
                      </p>
                      {ai.result.symbols.length > 0 && (
                        <ul className="space-y-0.5 text-muted">
                          {ai.result.symbols.map((s) => (
                            <li key={s.symbol}>
                              <code className="font-mono text-[11px] text-text">{s.symbol}</code> - {s.meaning}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void explain()}
                      disabled={ai?.key === aiKey && ai.busy}
                      className="press flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 font-semibold text-text hover:border-[#4b8cf5]/60 disabled:opacity-60"
                    >
                      {ai?.key === aiKey && ai.busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} className="text-[#4b8cf5]" />}
                      {prefs.apiKey ? "Explain with Gemini" : "Add a Gemini key to explain this"}
                    </button>
                  )}
                  {ai?.key === aiKey && ai.error && <p className="mt-1 text-danger">{ai.error}</p>}
                </div>
              </div>
            )}

            {panel === "links" && (
              <div className="space-y-1.5">
                {names.length > 0 && (
                  <div className="text-[11px] text-faint">
                    Symbols: <span className="font-mono text-muted">{names.join("  ")}</span>
                  </div>
                )}
                {links.length ? (
                  <ul className="space-y-1">
                    {links.map((c) => (
                      <li key={c.step.id}>
                        <button
                          type="button"
                          onClick={() => {
                            if (c.step.lines) selectLines(c.step.lines[0], c.step.lines[1]);
                            setSel(null);
                          }}
                          className="press flex w-full items-center gap-2 rounded-lg border border-border px-2 py-1.5 text-left hover:border-accent/50 hover:bg-surface-2"
                        >
                          <span className={"shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase " + (c.role === "defines" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")}>{c.role}</span>
                          <span className="min-w-0 flex-1 truncate text-text">{c.step.title}</span>
                          <span className="shrink-0 font-mono text-[10px] text-faint">{c.symbols.join(", ")}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-faint">{names.length ? "No other equation uses these symbols." : "Select some maths to see where its symbols appear."}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
