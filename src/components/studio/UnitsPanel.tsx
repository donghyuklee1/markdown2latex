"use client";

/**
 * UnitsPanel - unit-checker: dimensional analysis for every equation in the
 * document (or a pasted one). Symbols get dimensions from a table of physics
 * conventions; the user can override any of them, and overrides live only in
 * this component's state - nothing is persisted or sent anywhere.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { analysisStore } from "@/lib/persistedStore";
import { keyFor } from "../ai/orchestrator";
import { Atom, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, FlaskConical, RotateCcw, Sigma, XCircle } from "lucide-react";
import { InlineMath } from "@/components/Katex";
import { useToast } from "@/components/Toast";
import { Button, IconAction, Notice, Segmented, Stats, TextInput, inputClass } from "@/components/lab/kit";
import {
  aiUnitOverrides,
  analyzeUnits,
  describeDims,
  equationsFromSource,
  parseOverride,
  QUANTITIES,
  SAMPLE_EQUATIONS,
  type EquationKind,
  type EquationResult,
  type SymbolInfo,
  type UnitStatus,
} from "@/lib/studio/units";
import type { StudioContext } from "./types";

type Source = "doc" | "paste";

const QUANTITY_IDS = new Set(QUANTITIES.map((q) => q.id));

function Tex({ math }: { math: string }) {
  return <InlineMath math={math} renderError={() => <code className="font-mono text-[12px] text-text">{math}</code>} />;
}

function StatusTag({ status }: { status: UnitStatus }) {
  const tones: Record<UnitStatus, { cls: string; label: string; Icon: typeof CheckCircle2 }> = {
    consistent: { cls: "border-ok/30 bg-ok/[0.08] text-ok", label: "Dimensions consistent", Icon: CheckCircle2 },
    mismatch: { cls: "border-danger/30 bg-danger/[0.07] text-danger", label: "Mismatch", Icon: XCircle },
    incomplete: { cls: "border-accent/30 bg-accent/[0.07] text-accent", label: "Incomplete", Icon: CircleHelp },
    skipped: { cls: "border-border bg-surface-2 text-muted", label: "Not compared", Icon: CircleHelp },
    abstract: { cls: "border-border bg-surface-2 text-muted", label: "Dimensionless \u00b7 skipped", Icon: Sigma },
  };
  const { cls, label, Icon } = tones[status];
  return (
    <span className={"inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold " + cls}>
      <Icon size={12} /> {label}
    </span>
  );
}

function ResultRow({ r, onSelect, onKind }: { r: EquationResult; onSelect?: () => void; onKind: (k: EquationKind | undefined) => void }) {
  // The message already carries the first definite problem; do not repeat it.
  const notes = r.notes.filter((n) => n.message !== r.message);
  const body = (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <span className="scroll-slim min-w-0 max-w-full overflow-x-auto py-0.5 text-[14px] text-text">
          <Tex math={"\\displaystyle " + r.latex} />
        </span>
        <span className="ml-auto">
          <StatusTag status={r.status} />
        </span>
      </div>
      <div className={"mt-1 text-[12px] leading-snug " + (r.status === "mismatch" ? "text-danger" : r.status === "consistent" ? "text-muted" : "text-faint")}>{r.message}</div>
      {r.kind === "physical" && r.kindReason && <div className="mt-0.5 text-[11px] text-faint">Checked as physics: {r.kindReason}</div>}
      {notes.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {notes.map((n, i) => (
            <li key={i} className={"text-[11px] leading-snug " + (n.kind === "assumption" || n.kind === "relation" ? "text-faint" : n.kind === "unknown" ? "text-accent" : "text-danger")}>
              {n.kind === "assumption" ? "Assumed " : ""}
              {n.message}
            </li>
          ))}
        </ul>
      )}
    </>
  );
  const cls = "block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left";
  // The classifier can be overruled per equation: physics it missed, or maths it mistook.
  const toggle = (
    <button
      type="button"
      onClick={() => onKind(r.kindReason.startsWith("marked") ? undefined : r.kind === "abstract" ? "physical" : "abstract")}
      className="press mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-faint hover:bg-surface-2 hover:text-text"
    >
      {r.kindReason.startsWith("marked") ? (
        <>
          <RotateCcw size={11} /> Let the checker decide
        </>
      ) : r.kind === "abstract" ? (
        <>
          <Atom size={11} /> Check as physics
        </>
      ) : (
        <>
          <Sigma size={11} /> Treat as abstract maths
        </>
      )}
    </button>
  );
  if (!onSelect)
    return (
      <li className={cls}>
        {body}
        {toggle}
      </li>
    );
  return (
    <li className="relative">
      <button type="button" onClick={onSelect} title={r.line ? "Select line " + r.line + " in the editor" : undefined} className={cls + " press press-soft pb-7 hover:border-border-strong"}>
        {body}
      </button>
      <span className="absolute bottom-1 left-2">{toggle}</span>
    </li>
  );
}

function SymbolRow({ s, value, onChange }: { s: SymbolInfo; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const isCustom = value !== undefined && !QUANTITY_IDS.has(value);
  const selectValue = value === undefined ? s.quantity || "" : isCustom ? "__custom" : value;
  const parsed = isCustom && value.trim() ? parseOverride(value) : null;
  return (
    <li className="space-y-1 border-b border-border px-3 py-2 last:border-0">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-[14px] text-text">
          <Tex math={s.symbol} />
        </span>
        <select
          aria-label={"Quantity for " + s.symbol}
          value={selectValue}
          onChange={(e) => onChange(e.target.value === "__custom" ? "" : e.target.value)}
          className={inputClass + " min-w-0 flex-1 font-sans"}
        >
          {!s.quantity && value === undefined && <option value="">Assign a dimension...</option>}
          {QUANTITIES.map((q) => (
            <option key={q.id} value={q.id}>
              {q.label}
            </option>
          ))}
          <option value="__custom">Custom units...</option>
        </select>
        <IconAction icon={RotateCcw} label={"Reset " + s.symbol + " to the default"} disabled={value === undefined} onClick={() => onChange(undefined)} />
      </div>
      {isCustom && (
        <input
          aria-label={"Units for " + s.symbol}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="kg m^2 s^-2"
          spellCheck={false}
          className={inputClass}
        />
      )}
      <div className="pl-16 text-[11px] leading-snug text-faint">
        <span className={s.source === "unknown" && !parsed ? "text-accent" : ""}>{parsed ? describeDims(parsed) : isCustom && value.trim() ? "could not read these units" : s.dimsText}</span>
        {" - "}
        {s.source === "override" ? "your override" : s.description}
        {s.source === "ai" && <span className="ml-1 rounded bg-[#4b8cf5]/10 px-1 text-[10px] font-semibold text-[#4b8cf5]">AI</span>}
        {s.note && value === undefined ? " (" + s.note + ")" : ""}
      </div>
    </li>
  );
}

export default function UnitsPanel({ input, selectLines }: StudioContext) {
  const toast = useToast();
  const [source, setSource] = useState<Source>("doc");
  const [pasted, setPasted] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [forced, setForced] = useState<Record<string, EquationKind>>({});
  const [showTable, setShowTable] = useState(false);

  const equations = useMemo(() => (source === "doc" ? equationsFromSource(input) : equationsFromSource(pasted, false)), [source, input, pasted]);
  // With an AI analysis of this document, its inferred units help decide what is physical.
  const store = useSyncExternalStore(analysisStore.subscribe, analysisStore.get, analysisStore.getServer);
  const aiUnits = useMemo(() => {
    if (source !== "doc") return {};
    const raw = store[keyFor(input)]?.result as { variables?: Array<{ symbol?: unknown; units?: unknown }> } | undefined;
    const out: Record<string, string> = {};
    for (const v of raw?.variables ?? []) if (typeof v.symbol === "string" && typeof v.units === "string" && v.units.trim()) out[v.symbol] = v.units;
    return out;
  }, [store, input, source]);
  const aiCount = Object.keys(aiUnitOverrides(aiUnits)).length;
  const analysis = useMemo(
    () => analyzeUnits(equations, overrides, { doc: source === "doc" ? input : pasted, forced, ai: aiUnits }),
    [equations, overrides, source, input, pasted, forced, aiUnits],
  );
  const checked = analysis.results.filter((r) => r.status !== "skipped" && r.status !== "abstract");
  const setKind = (latex: string, k: EquationKind | undefined) =>
    setForced((f) => {
      const next = { ...f };
      if (k) next[latex] = k;
      else delete next[latex];
      return next;
    });
  const count = (s: UnitStatus) => analysis.results.filter((r) => r.status === s).length;
  const fromDoc = source === "doc";
  const unknownSymbols = analysis.symbols.filter((s) => s.source === "unknown").length;

  const setOverride = (symbol: string, v: string | undefined) =>
    setOverrides((o) => {
      const next = { ...o };
      if (v === undefined) delete next[symbol];
      else next[symbol] = v;
      return next;
    });

  const loadSample = () => {
    setPasted(SAMPLE_EQUATIONS);
    setSource("paste");
    toast("Loaded sample equations (one wrong, one with an inconsistent sum)", "info");
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[13px] leading-snug text-muted">
          Dimensional analysis for the physics in your document: both sides must carry the same SI dimensions, sums must agree, and sin / exp / log need dimensionless arguments. Abstract maths (losses, indices, a = b + c) is recognised and left unchecked.
        </p>
        <Button icon={FlaskConical} onClick={loadSample}>
          Load sample
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Equations</span>
        <Segmented<Source>
          label="Equation source"
          value={source}
          onChange={setSource}
          options={[
            { id: "doc", label: "Current document", title: "Check every equation in the editor" },
            { id: "paste", label: "Paste an equation" },
          ]}
        />
      </div>
      {source === "paste" && (
        <TextInput
          label="Equations"
          value={pasted}
          onChange={setPasted}
          placeholder={"E = m c^2\n\\frac{1}{2} m v^2 + m g h = E"}
          className="!min-h-[140px]"
        />
      )}

      {aiCount > 0 && (
        <Notice>
          Using units for {aiCount} symbol{aiCount === 1 ? "" : "s"} from the AI analysis of this document. Your own choices in the symbol table always win.
        </Notice>
      )}
      <Stats
        items={[
          { label: "checked", value: checked.length },
          { label: "consistent", value: count("consistent"), tone: count("consistent") ? "ok" : undefined },
          { label: "mismatched", value: count("mismatch"), tone: count("mismatch") ? "danger" : undefined },
          { label: "incomplete", value: count("incomplete"), tone: count("incomplete") ? "warn" : undefined },
          { label: "abstract", value: count("abstract") },
        ]}
      />

      {analysis.symbols.length > 0 && (
        <section className="rounded-lg border border-border bg-surface">
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            className="press press-soft flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-faint hover:text-muted"
          >
            {showTable ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            Symbol table ({analysis.symbols.length})
            {unknownSymbols > 0 && <span className="normal-case tracking-normal text-accent">- {unknownSymbols} need a dimension</span>}
            {Object.keys(overrides).length > 0 && (
              <span className="ml-auto normal-case tracking-normal text-muted">{Object.keys(overrides).length} overridden</span>
            )}
          </button>
          {showTable && (
            <ul className="border-t border-border">
              {analysis.symbols.map((s) => (
                <SymbolRow key={s.symbol} s={s} value={overrides[s.symbol]} onChange={(v) => setOverride(s.symbol, v)} />
              ))}
            </ul>
          )}
        </section>
      )}

      {analysis.results.length === 0 ? (
        <Notice>
          {fromDoc
            ? "No equations with =, \\approx or \\le found in the current document. Paste one instead, or load the sample."
            : "Paste one equation per line (with or without $ delimiters)."}
        </Notice>
      ) : (
        <ul className="space-y-1.5">
          {analysis.results.map((r, i) => (
            <ResultRow key={i} r={r} onKind={(k) => setKind(r.latex, k)} onSelect={fromDoc && r.line !== null ? () => selectLines(r.line!, r.line!) : undefined} />
          ))}
        </ul>
      )}
    </div>
  );
}
