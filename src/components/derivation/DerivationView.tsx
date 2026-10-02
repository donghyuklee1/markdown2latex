"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ChevronDown, ChevronRight, Copy, CornerDownLeft, KeyRound, Lightbulb, ListTree, Loader2, Network, NotebookText, Table2, X } from "lucide-react";
import BrandMark, { GeminiStar } from "@/components/BrandMark";
import { InlineMath } from "@/components/Katex";
import { writeClipboard } from "@/components/exporters";
import { useToast } from "@/components/Toast";
import { bottomUp, ideasTikz, offlineModel, topDown, variablesTable, type Derivation, type Step, type StepKind, type TreeNode } from "@/lib/derivation";
import { aiStore } from "@/lib/persistedStore";
import type { StudioContext } from "../studio/types";
import { AiError, analyzeDerivation, listModels, type ModelInfo } from "./gemini";

/**
 * Derivation notes: what a document's formulas *mean* and how they build on
 * each other - five views of one model (lib/derivation.ts). Works offline from
 * the text alone; "Analyze with Gemini" adds roles, plain-language
 * explanations, inferred variable definitions and an idea map.
 */

type View = "notes" | "top" | "bottom" | "vars" | "ideas";

const VIEWS: ReadonlyArray<{ id: View; label: string; icon: typeof NotebookText }> = [
  { id: "notes", label: "Notes", icon: NotebookText },
  { id: "top", label: "Top-down", icon: ListTree },
  { id: "bottom", label: "Bottom-up", icon: Network },
  { id: "vars", label: "Variables", icon: Table2 },
  { id: "ideas", label: "Ideas", icon: Lightbulb },
];

const KIND: Record<StepKind, { label: string; cls: string }> = {
  definition: { label: "Definition", cls: "bg-[rgb(var(--syn-num)/0.12)] text-[rgb(var(--syn-num))]" },
  assumption: { label: "Assumption", cls: "bg-[rgb(var(--syn-env)/0.12)] text-[rgb(var(--syn-env))]" },
  intermediate: { label: "Step", cls: "bg-surface-2 text-muted" },
  final: { label: "Result", cls: "bg-accent/15 text-accent" },
};

/* Analyses survive tab switches and remounts for the session. */
const aiCache = new Map<string, Derivation>();
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0) + ":" + s.length;
}

/* ------------------------------------------------------------ pieces */

/** Text with $...$ maths. */
function MathText({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.startsWith("$") && p.endsWith("$") && p.length > 2 ? (
          <InlineMath key={i} math={p.slice(1, -1)} renderError={() => <span>{p}</span>} />
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

function Badge({ kind }: { kind: StepKind }) {
  return <span className={"rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide " + KIND[kind].cls}>{KIND[kind].label}</span>;
}

type HoverState = { step: Step; x: number; y: number } | null;

function StepCard({
  step,
  compact = false,
  dim = false,
  onHover,
  onPick,
  className = "",
  style,
}: {
  step: Step;
  compact?: boolean;
  dim?: boolean;
  onHover: (h: HoverState) => void;
  onPick: (s: Step) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const timer = useRef<number | undefined>(undefined);
  return (
    <button
      type="button"
      onClick={() => onPick(step)}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => onHover({ step, x: r.left + r.width / 2, y: r.bottom }), 220);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        onHover(null);
      }}
      className={
        "press-soft group flex flex-col gap-1 rounded-xl border bg-surface px-3 py-2 text-left shadow-sm transition-[opacity,border-color,box-shadow] duration-200 hover:border-accent/50 hover:shadow-md " +
        (step.kind === "final" ? "border-accent/40 " : "border-border ") +
        (dim ? "opacity-30 " : "") +
        className
      }
      style={style}
    >
      <span className="flex items-center gap-1.5">
        <Badge kind={step.kind} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text">{step.title}</span>
        {step.label && <span className="shrink-0 font-mono text-[10px] text-faint">{step.label}</span>}
      </span>
      {step.latex && (
        <span
          className="block overflow-hidden whitespace-nowrap text-[13px] text-text"
          style={{ maskImage: "linear-gradient(to right, black 88%, transparent)", WebkitMaskImage: "linear-gradient(to right, black 88%, transparent)" }}
        >
          <InlineMath math={step.latex} renderError={() => <code className="text-[11px] text-faint">{step.latex}</code>} />
        </span>
      )}
      {!compact && step.summary && <MathText text={step.summary} className="line-clamp-2 text-[11.5px] leading-snug text-muted" />}
    </button>
  );
}

/** The detailed explanation, floating next to the card under the cursor. */
function Explain({ hover, steps }: { hover: HoverState; steps: Map<string, Step> }) {
  if (!hover) return null;
  const s = hover.step;
  const left = Math.min(Math.max(hover.x, 210), (typeof window !== "undefined" ? window.innerWidth : 1200) - 210);
  return (
    <div className="pointer-events-none fixed z-50 w-[400px] max-w-[92vw] -translate-x-1/2 animate-pop-in rounded-xl border border-border bg-surface p-3.5 shadow-2xl shadow-black/20" style={{ left, top: hover.y + 8 }}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Badge kind={s.kind} />
        <span className="text-sm font-semibold text-text">{s.title}</span>
        {s.label && <span className="ml-auto font-mono text-[10px] text-faint">{s.label}</span>}
      </div>
      {s.latex && (
        <div className="mb-2 overflow-x-auto rounded-lg bg-bg px-2 py-1.5 text-[14px] text-text">
          <InlineMath math={"\\displaystyle " + s.latex} renderError={() => <code className="text-[11px]">{s.latex}</code>} />
        </div>
      )}
      <MathText text={s.explanation || s.summary} className="block text-[12.5px] leading-relaxed text-text" />
      {s.uses.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-faint">
          builds on
          {s.uses.map((u) => (
            <span key={u} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-muted">
              {steps.get(u)?.title ?? u}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 text-[10px] text-faint">Click the card to show it in the editor.</div>
    </div>
  );
}

/* --------------------------------------------------------------- views */

function NotesView({ d, onHover, onPick }: { d: Derivation; onHover: (h: HoverState) => void; onPick: (s: Step) => void }) {
  const groups: Array<{ title: string; hint: string; steps: Step[] }> = [
    { title: "Foundations", hint: "definitions and assumptions", steps: d.steps.filter((s) => s.kind === "definition" || s.kind === "assumption") },
    { title: "Derivation", hint: "intermediate steps", steps: d.steps.filter((s) => s.kind === "intermediate") },
    { title: "Results", hint: "what the derivation arrives at", steps: d.steps.filter((s) => s.kind === "final") },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      {groups.map((g) =>
        g.steps.length ? (
          <section key={g.title}>
            <h3 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
              {g.title} <span className="font-normal normal-case tracking-normal text-faint/70">{g.hint}</span>
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.steps.map((s) => (
                <StepCard key={s.id} step={s} onHover={onHover} onPick={onPick} />
              ))}
            </div>
          </section>
        ) : null,
      )}
    </div>
  );
}

function TreeItem({ node, collapsed, toggle, onHover, onPick }: { node: TreeNode; collapsed: Set<string>; toggle: (id: string) => void; onHover: (h: HoverState) => void; onPick: (s: Step) => void }) {
  const open = !collapsed.has(node.step.id);
  return (
    <li>
      {node.ref ? (
        <span className="rounded-full border border-dashed border-border-strong bg-surface px-2.5 py-1 text-[11px] text-muted">
          <ArrowUpRight size={11} className="mr-1 inline" />
          see {node.step.title}
        </span>
      ) : (
        <div className="flex flex-col items-center">
          <StepCard step={node.step} compact onHover={onHover} onPick={onPick} className="w-56" />
          {node.children.length > 0 && (
            <button type="button" onClick={() => toggle(node.step.id)} className="press mt-1 flex items-center gap-0.5 rounded-full px-1.5 text-[10px] text-faint hover:bg-surface-2 hover:text-text">
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              {open ? "builds on" : node.children.length + " hidden"}
            </button>
          )}
        </div>
      )}
      {!node.ref && open && node.children.length > 0 && (
        <ul>
          {node.children.map((c, i) => (
            <TreeItem key={c.step.id + i} node={c} collapsed={collapsed} toggle={toggle} onHover={onHover} onPick={onPick} />
          ))}
        </ul>
      )}
    </li>
  );
}

function TopDownView({ d, onHover, onPick }: { d: Derivation; onHover: (h: HoverState) => void; onPick: (s: Step) => void }) {
  const trees = useMemo(() => topDown(d), [d]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setCollapsed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set(c).add(id)));
  return (
    <div className="space-y-8 p-4">
      {trees.map((t) => (
        <div key={t.step.id} className="dtree min-w-max">
          <ul>
            <TreeItem node={t} collapsed={collapsed} toggle={toggle} onHover={onHover} onPick={onPick} />
          </ul>
        </div>
      ))}
    </div>
  );
}

const CW = 236;
const CH = 96;
const GX = 22;
const GY = 58;

function BottomUpView({ d, onHover, onPick }: { d: Derivation; onHover: (h: HoverState) => void; onPick: (s: Step) => void }) {
  const layers = useMemo(() => bottomUp(d), [d]);
  const [focus, setFocus] = useState<string | null>(null);
  const width = Math.max(...layers.map((l) => l.length)) * (CW + GX) + GX;
  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, li) => {
    const lw = layer.length * (CW + GX) - GX;
    layer.forEach((s, i) => pos.set(s.id, { x: (width - lw) / 2 + i * (CW + GX), y: 16 + li * (CH + GY) }));
  });
  const height = 32 + layers.length * (CH + GY) - GY;
  const byId = useMemo(() => new Map(d.steps.map((s) => [s.id, s])), [d.steps]);
  const lit = useMemo(() => {
    if (!focus) return null;
    const set = new Set([focus]);
    const up = (id: string) => byId.get(id)?.uses.forEach((u) => !set.has(u) && (set.add(u), up(u)));
    const down = (id: string) => d.steps.forEach((s) => s.uses.includes(id) && !set.has(s.id) && (set.add(s.id), down(s.id)));
    up(focus);
    down(focus);
    return set;
  }, [focus, byId, d.steps]);

  return (
    <div className="p-4">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0" width={width} height={height} aria-hidden>
          <defs>
            <marker id="bu-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {d.steps.flatMap((s) =>
            s.uses.map((u) => {
              const a = pos.get(u);
              const b = pos.get(s.id);
              if (!a || !b) return null;
              const x1 = a.x + CW / 2;
              const y1 = a.y + CH;
              const x2 = b.x + CW / 2;
              const y2 = b.y;
              const on = !lit || (lit.has(u) && lit.has(s.id));
              return (
                <path
                  key={u + ">" + s.id}
                  d={"M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + GY / 2) + " " + x2 + "," + (y2 - GY / 2) + " " + x2 + "," + (y2 - 2)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={on && lit ? 2 : 1.4}
                  markerEnd="url(#bu-arrow)"
                  className={"transition-opacity duration-200 " + (on ? (lit ? "text-accent" : "text-border-strong") : "text-border opacity-30")}
                />
              );
            }),
          )}
        </svg>
        {d.steps.map((s) => {
          const p = pos.get(s.id)!;
          return (
            <div key={s.id} className="absolute" style={{ left: p.x, top: p.y, width: CW, height: CH }} onMouseEnter={() => setFocus(s.id)} onMouseLeave={() => setFocus(null)}>
              <StepCard step={s} dim={!!lit && !lit.has(s.id)} onHover={onHover} onPick={onPick} className="h-full w-full" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VariablesView({ d, insert }: { d: Derivation; insert: (t: string) => void }) {
  const toast = useToast();
  const table = useMemo(() => variablesTable(d.variables), [d.variables]);
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-faint">
          {d.variables.length} symbols · {d.variables.filter((v) => v.meaning).length} with a meaning
          {d.source === "ai" && " · " + d.variables.filter((v) => v.source === "inferred").length + " inferred by AI"}
        </span>
        <button type="button" onClick={async () => toast((await writeClipboard(table)) ? "LaTeX table copied" : "Copy failed", "success")} className="press ml-auto flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-text">
          <Copy size={12} /> Copy LaTeX table
        </button>
        <button type="button" onClick={() => insert(table)} className="press flex items-center gap-1 rounded-lg bg-accent px-2 py-1 text-xs font-semibold text-accent-ink hover:bg-accent/90">
          <CornerDownLeft size={12} /> Insert into editor
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <table className="w-full text-left text-[13px]">
          <thead className="bg-surface-2 text-[11px] uppercase tracking-wider text-faint">
            <tr>
              <th className="px-3 py-2">Symbol</th>
              <th className="px-3 py-2">Meaning</th>
              <th className="px-3 py-2">Domain</th>
              <th className="px-3 py-2">Units</th>
            </tr>
          </thead>
          <tbody>
            {d.variables.map((v) => (
              <tr key={v.symbol} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 text-text">
                  <InlineMath math={v.symbol} renderError={() => <code>{v.symbol}</code>} />
                </td>
                <td className="px-3 py-2 text-text">
                  {v.meaning ? <MathText text={v.meaning} /> : <span className="italic text-faint">not defined in the text</span>}
                  {v.source === "inferred" && v.meaning && <span className="ml-1.5 rounded bg-accent/10 px-1 text-[10px] font-semibold text-accent">inferred</span>}
                </td>
                <td className="px-3 py-2 text-muted">{v.domain ? <MathText text={v.domain.includes("$") ? v.domain : "$" + v.domain + "$"} /> : "-"}</td>
                <td className="px-3 py-2 text-muted">{v.units || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IdeasView({ d, onAnalyze, steps }: { d: Derivation; onAnalyze: () => void; steps: Map<string, Step> }) {
  const toast = useToast();
  const [active, setActive] = useState<string | null>(null);
  if (!d.ideas.length) {
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-faint">
        <Lightbulb size={24} />
        The idea map needs the AI analysis.
        <button type="button" onClick={onAnalyze} className="press flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text shadow-sm hover:border-[#4b8cf5]/60">
          <GeminiStar size={15} /> Analyze with <BrandMark mark="gemini" height="1.05em" />
        </button>
      </div>
    );
  }
  const W = 760;
  const H = 440;
  const n = d.ideas.length;
  const pos = new Map(d.ideas.map((i, k) => {
    const a = -Math.PI / 2 + (2 * Math.PI * k) / n;
    return [i.id, { x: W / 2 + (W / 2 - 120) * Math.cos(a), y: H / 2 + (H / 2 - 60) * Math.sin(a) }] as const;
  }));
  return (
    <div className="p-4">
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={async () => toast((await writeClipboard(ideasTikz(d.ideas, d.ideaLinks))) ? "TikZ copied" : "Copy failed", "success")} className="press flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted hover:text-text">
          <Copy size={12} /> Copy as TikZ
        </button>
      </div>
      <div className="relative mx-auto" style={{ width: W, height: H }}>
        <svg className="absolute inset-0" width={W} height={H} aria-hidden>
          <defs>
            <marker id="idea-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
            </marker>
          </defs>
          {d.ideaLinks.map((l, k) => {
            const a = pos.get(l.from)!;
            const b = pos.get(l.to)!;
            const t = 0.72;
            const on = !active || active === l.from || active === l.to;
            return (
              <g key={k} className={"transition-opacity duration-200 " + (on ? "" : "opacity-20")}>
                <line x1={a.x} y1={a.y} x2={a.x + (b.x - a.x) * t} y2={a.y + (b.y - a.y) * t} stroke="currentColor" strokeWidth={1.4} className="text-border-strong" markerEnd="url(#idea-arrow)" />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} textAnchor="middle" className="fill-muted text-[10.5px]" style={{ paintOrder: "stroke", stroke: "rgb(var(--surface))", strokeWidth: 4 }}>
                  {l.label}
                </text>
              </g>
            );
          })}
        </svg>
        {d.ideas.map((i) => {
          const p = pos.get(i.id)!;
          return (
            <div
              key={i.id}
              onMouseEnter={() => setActive(i.id)}
              onMouseLeave={() => setActive(null)}
              className={"absolute w-52 -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-surface p-2.5 shadow-sm transition-all duration-200 " + (active === i.id ? "z-10 border-accent/50 shadow-lg" : "border-border")}
              style={{ left: p.x, top: p.y }}
            >
              <div className="text-xs font-semibold text-text">{i.label}</div>
              <MathText text={i.detail} className={"mt-0.5 block text-[11px] leading-snug text-muted " + (active === i.id ? "" : "line-clamp-2")} />
              {active === i.id && i.steps.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {i.steps.map((s) => (
                    <span key={s} className="rounded bg-surface-2 px-1 text-[10px] text-faint">{steps.get(s)?.title ?? s}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- shell */

function Settings({ onClose }: { onClose: () => void }) {
  const ai = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const [key, setKey] = useState(ai.apiKey);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await listModels(key.trim());
      setModels(list);
      aiStore.set({ apiKey: key.trim(), model: ai.model && list.some((m) => m.id === ai.model) ? ai.model : list[0]?.id ?? "" });
    } catch (e) {
      setError(e instanceof AiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="absolute right-2 top-full z-40 mt-1 w-80 animate-pop-in space-y-2.5 rounded-xl border border-border bg-surface p-3.5 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 font-semibold text-text">
        <GeminiStar size={14} /> <BrandMark mark="gemini" height="1.05em" /> API key
        <button type="button" onClick={onClose} aria-label="Close" className="press ml-auto rounded p-0.5 text-faint hover:text-text">
          <X size={13} />
        </button>
      </div>
      <p className="leading-snug text-faint">
        Free from{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer noopener" className="text-accent underline">
          Google AI Studio
        </a>
        . It stays in this browser and is sent only to Google, only when you press Analyze. On the free tier Google may use prompts to improve its models.
      </p>
      <input
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder="Paste your key"
        autoComplete="off"
        className="h-8 w-full rounded-lg border border-border bg-bg px-2 font-mono text-text outline-none focus:border-accent/60"
      />
      <div className="flex gap-1.5">
        <button type="button" onClick={() => void save()} disabled={!key.trim() || busy} className="press flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 font-semibold text-accent-ink disabled:opacity-40">
          {busy && <Loader2 size={12} className="animate-spin" />} Save and check
        </button>
        {ai.apiKey && (
          <button
            type="button"
            onClick={() => {
              aiStore.set({ apiKey: "", model: "" });
              setKey("");
              setModels([]);
            }}
            className="press rounded-lg border border-border px-2 py-1.5 font-semibold text-muted hover:text-danger"
          >
            Forget key
          </button>
        )}
      </div>
      {error && <p className="rounded-lg bg-danger/10 px-2 py-1.5 text-danger">{error}</p>}
      {(models.length > 0 || ai.model) && (
        <label className="block space-y-1">
          <span className="text-faint">Model</span>
          <select value={ai.model} onChange={(e) => aiStore.set({ ...ai, model: e.target.value })} className="h-8 w-full rounded-lg border border-border bg-bg px-1.5 text-text">
            {(models.length ? models : [{ id: ai.model, label: ai.model }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export default function DerivationView({ input, selectLines, insert }: StudioContext) {
  const source = useDeferredValue(input);
  const offline = useMemo(() => offlineModel(source), [source]);
  const ai = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const [view, setView] = useState<View>("notes");
  const [hover, setHover] = useState<HoverState>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [, bump] = useState(0);
  const toast = useToast();

  const key = hash(source);
  const cached = aiCache.get(key);
  // An analysis of a slightly older version still helps: show it, marked outdated.
  const lastAi = cached ?? [...aiCache.values()].pop() ?? null;
  const d = cached ?? (lastAi && lastAi.steps.length ? lastAi : offline);
  const outdated = !cached && d === lastAi;
  const steps = useMemo(() => new Map(d.steps.map((s) => [s.id, s])), [d]);

  useEffect(() => {
    if (!settings) return;
    const close = () => setSettings(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [settings]);

  const analyze = async () => {
    if (!ai.apiKey) {
      setSettings(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let model = ai.model;
      if (!model) {
        model = (await listModels(ai.apiKey))[0]?.id ?? "";
        aiStore.set({ ...ai, model });
      }
      const result = await analyzeDerivation(source, offline, ai.apiKey, model);
      aiCache.set(key, result);
      bump((n) => n + 1);
      toast("Analysis ready - " + result.steps.length + " steps, " + result.variables.length + " variables");
    } catch (e) {
      setError(e instanceof AiError ? e.message : "Analysis failed: " + String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (s: Step) => s.lines && selectLines(s.lines[0], s.lines[1]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        <div role="tablist" aria-label="Derivation view" className="flex flex-wrap gap-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={"press press-soft flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors " + (view === v.id ? "bg-surface-2 text-text" : "text-faint hover:text-muted")}
            >
              <v.icon size={12} /> {v.label}
            </button>
          ))}
        </div>
        <span className={"ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold " + (d.source === "ai" ? (outdated ? "bg-surface-2 text-faint" : "bg-accent/10 text-accent") : "bg-surface-2 text-faint")} title={d.source === "ai" ? "Explained by " + (ai.model || "Gemini") : "From the text alone - no AI"}>
          {d.source === "ai" ? (outdated ? "AI · outdated" : "AI") : "Offline"}
        </span>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={busy}
          title={"Explain this derivation with Gemini" + (ai.model ? " (" + ai.model + ")" : "")}
          className="press flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-text shadow-sm transition-colors hover:border-[#4b8cf5]/60 disabled:opacity-60"
        >
          {busy ? <Loader2 size={13} className="animate-spin text-[#4b8cf5]" /> : <GeminiStar size={13} />}
          {busy ? "Analyzing…" : d.source === "ai" && !outdated ? "Re-analyze" : "Analyze with"}
          {!busy && !(d.source === "ai" && !outdated) && <BrandMark mark="gemini" height="1.05em" />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSettings((v) => !v);
          }}
          aria-label="AI settings"
          title="Gemini API key and model"
          className={"press flex h-6 w-6 items-center justify-center rounded-md " + (ai.apiKey ? "text-faint hover:text-text" : "text-accent")}
        >
          <KeyRound size={13} />
        </button>
        {settings && <Settings onClose={() => setSettings(false)} />}
      </div>

      {error && <div className="shrink-0 border-b border-danger/20 bg-danger/[0.06] px-3 py-1.5 text-xs text-danger">{error}</div>}
      {d.title && <div className="shrink-0 px-4 pt-3 text-sm font-semibold text-text">{d.title}</div>}

      <div key={view} className="scroll-slim min-h-0 flex-1 animate-fade-in overflow-auto">
        {!d.steps.length ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-faint">Add display equations to see how the derivation fits together.</div>
        ) : view === "notes" ? (
          <NotesView d={d} onHover={setHover} onPick={pick} />
        ) : view === "top" ? (
          <TopDownView d={d} onHover={setHover} onPick={pick} />
        ) : view === "bottom" ? (
          <BottomUpView d={d} onHover={setHover} onPick={pick} />
        ) : view === "vars" ? (
          <VariablesView d={d} insert={insert} />
        ) : (
          <IdeasView d={d} onAnalyze={() => void analyze()} steps={steps} />
        )}
      </div>
      <Explain hover={hover} steps={steps} />
    </div>
  );
}
