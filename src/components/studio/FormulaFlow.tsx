"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { AlertTriangle, Crosshair, Search, X } from "lucide-react";
import { InlineMath } from "@/components/Katex";
import { buildFormulaGraph, displayLatex, lineage, type GraphNode } from "@/lib/studio/formulaGraph";
import type { StudioContext } from "./types";

/**
 * Equation flow: the formula graph laid out for real papers.
 *
 * A node-link diagram turns into a hairball past a dozen equations, so here
 * every equation is a row in document order and dependencies are arcs in a
 * left gutter - an arc from A down to B means B uses something A defines.
 * Distance on screen is distance in the paper, the view scrolls like the
 * document instead of panning, and selecting a row lights its lineage.
 */

const ROW = 56; // px per equation row; arcs are drawn against this grid
const GUTTER_MIN = 36;
const GUTTER_MAX = 132;

interface Row {
  node: GraphNode;
  defines: string[];
  undefinedUses: string[];
  usesAll: string[];
}

interface Arc {
  from: number; // row index
  to: number;
  via: string[]; // symbols carried (empty for \eqref links)
}

function symbolLabel(s: string): string {
  return s.length > 18 ? s.slice(0, 17) + "\u2026" : s;
}

export default function FormulaFlow({ input, selectLines }: StudioContext) {
  const source = useDeferredValue(input);
  const [includeInline, setIncludeInline] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [hoverSym, setHoverSym] = useState<string | null>(null);
  const [pinnedSym, setPinnedSym] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const graph = useMemo(() => buildFormulaGraph(source, { includeInline }), [source, includeInline]);

  /* --- rows and arcs, derived once per graph ----------------------------- */
  const { rows, arcs, undefinedSyms } = useMemo(() => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const eqs = graph.nodes
      .filter((n) => n.kind === "equation")
      .sort((a, b) => (a.lines?.[0] ?? 0) - (b.lines?.[0] ?? 0));
    const index = new Map(eqs.map((e, i) => [e.id, i]));
    const defines = new Map<string, string[]>();
    const uses = new Map<string, string[]>();
    const definers = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (e.kind === "defines") {
        (defines.get(e.from) ?? defines.set(e.from, []).get(e.from)!).push(e.to);
        (definers.get(e.to) ?? definers.set(e.to, []).get(e.to)!).push(e.from);
      } else if (e.kind === "uses") {
        (uses.get(e.to) ?? uses.set(e.to, []).get(e.to)!).push(e.from);
      }
    }
    const latexOf = (id: string) => byId.get(id)?.latex ?? id;

    const rows: Row[] = eqs.map((n) => {
      const u = uses.get(n.id) ?? [];
      return {
        node: n,
        defines: (defines.get(n.id) ?? []).map(latexOf),
        usesAll: u.map(latexOf),
        undefinedUses: u.filter((s) => !byId.get(s)?.defined).map(latexOf),
      };
    });

    // A -> B for every symbol B uses that A (the nearest earlier definer) defines.
    const arcMap = new Map<string, Arc>();
    const addArc = (a: number, b: number, sym: string | null) => {
      if (a === b) return;
      const key = a + ">" + b;
      const arc = arcMap.get(key) ?? arcMap.set(key, { from: a, to: b, via: [] }).get(key)!;
      if (sym && !arc.via.includes(sym)) arc.via.push(sym);
    };
    rows.forEach((r, b) => {
      for (const symId of uses.get(r.node.id) ?? []) {
        const candidates = (definers.get(symId) ?? []).map((d) => index.get(d)!).filter((i) => i !== undefined);
        if (!candidates.length) continue;
        const earlier = candidates.filter((i) => i < b);
        const a = earlier.length ? Math.max(...earlier) : Math.min(...candidates);
        addArc(a, b, latexOf(symId));
      }
    });
    for (const e of graph.edges) {
      if (e.kind === "feeds" && index.has(e.from) && index.has(e.to) && !arcMap.has(index.get(e.from)! + ">" + index.get(e.to)!)) {
        addArc(index.get(e.from)!, index.get(e.to)!, null);
      }
    }

    const undefinedSyms = graph.nodes
      .filter((n) => n.kind === "symbol" && !n.defined)
      .map((n) => ({ latex: n.latex, uses: n.uses }))
      .sort((a, b) => b.uses - a.uses);

    return { rows, arcs: [...arcMap.values()], undefinedSyms };
  }, [graph]);

  /* --- highlighting -------------------------------------------------------- */
  const lit = useMemo(() => {
    if (!selected) return null;
    const { upstream, downstream } = lineage(graph, selected);
    return { up: new Set(upstream), down: new Set(downstream) };
  }, [graph, selected]);

  const activeSym = pinnedSym ?? hoverSym;
  const q = query.trim().toLowerCase();
  const rowMatches = (r: Row) =>
    (!q || r.node.latex.toLowerCase().includes(q) || r.node.label.toLowerCase().includes(q) || (r.node.key ?? "").toLowerCase().includes(q)) &&
    (!activeSym || r.usesAll.includes(activeSym) || r.defines.includes(activeSym));

  const visible = useMemo(() => {
    const idx = rows.map((_, i) => i);
    if (!(focus && selected && lit)) return idx;
    return idx.filter((i) => {
      const id = rows[i].node.id;
      return id === selected || lit.up.has(id) || lit.down.has(id);
    });
  }, [rows, focus, selected, lit]);
  const pos = new Map(visible.map((rowIdx, k) => [rowIdx, k]));
  const shownArcs = arcs.filter((a) => pos.has(a.from) && pos.has(a.to));
  const maxSpan = shownArcs.reduce((m, a) => Math.max(m, Math.abs(pos.get(a.to)! - pos.get(a.from)!)), 1);
  const gutter = Math.round(Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, 18 + 12 * Math.sqrt(maxSpan))));

  const arcTone = (a: Arc): "up" | "down" | "sym" | "dim" | "plain" => {
    const from = rows[a.from].node.id;
    const to = rows[a.to].node.id;
    if (lit) {
      if ((to === selected || lit.up.has(to)) && lit.up.has(from)) return "up";
      if ((from === selected || lit.down.has(from)) && lit.down.has(to)) return "down";
      return "dim";
    }
    if (activeSym) return a.via.includes(activeSym) ? "sym" : "dim";
    return "plain";
  };

  const pick = (r: Row) => {
    const same = selected === r.node.id;
    setSelected(same ? null : r.node.id);
    if (!same && r.node.lines) selectLines(r.node.lines[0], r.node.lines[1]);
  };

  if (!rows.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-faint">
        Add display equations to see how they connect.
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={includeInline} onChange={(e) => setIncludeInline(e.target.checked)} className="accent-[rgb(var(--accent))]" />
          include inline equations
        </label>
      </div>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && (selected || pinnedSym)) {
          e.preventDefault();
          setSelected(null);
          setPinnedSym(null);
        }
      }}
    >
      {/* toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-[11px]">
        <span className="text-faint">
          <b className="font-mono text-text">{rows.length}</b> equations · <b className="font-mono text-text">{arcs.length}</b> links
          {undefinedSyms.length > 0 && (
            <>
              {" "}· <b className="font-mono text-danger">{undefinedSyms.length}</b> undefined
            </>
          )}
        </span>
        <label className="ml-auto flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg px-2">
          <Search size={12} className="text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find equation or label"
            aria-label="Find equation"
            className="w-36 bg-transparent text-xs text-text outline-none placeholder:text-faint"
          />
        </label>
        <button
          type="button"
          onClick={() => setFocus((v) => !v)}
          aria-pressed={focus}
          disabled={!selected}
          title={selected ? "Show only the selected equation's lineage" : "Select an equation first"}
          className={
            "press flex h-7 items-center gap-1 rounded-md border px-2 font-semibold disabled:opacity-40 " +
            (focus && selected ? "border-accent/40 bg-accent/10 text-accent" : "border-border text-muted hover:text-text")
          }
        >
          <Crosshair size={12} /> Focus
        </button>
        <label className="flex items-center gap-1.5 text-faint">
          <input type="checkbox" checked={includeInline} onChange={(e) => setIncludeInline(e.target.checked)} className="accent-[rgb(var(--accent))]" />
          inline
        </label>
      </div>

      {/* undefined symbols strip */}
      {undefinedSyms.length > 0 && (
        <div className="scroll-slim flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-border bg-danger/[0.04] px-3 py-1.5">
          <AlertTriangle size={12} className="shrink-0 text-danger" />
          <span className="shrink-0 text-[11px] text-danger">Never defined:</span>
          {undefinedSyms.map((s) => (
            <button
              key={s.latex}
              type="button"
              onClick={() => setPinnedSym((p) => (p === s.latex ? null : s.latex))}
              onMouseEnter={() => setHoverSym(s.latex)}
              onMouseLeave={() => setHoverSym(null)}
              title={"Used in " + s.uses + " equation" + (s.uses === 1 ? "" : "s") + " - click to pin"}
              className={
                "press flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[12px] " +
                (pinnedSym === s.latex ? "border-danger bg-danger/15 text-danger" : "border-danger/30 bg-surface text-text hover:border-danger/60")
              }
            >
              <InlineMath math={s.latex} renderError={() => <span className="font-mono text-[10px]">{s.latex}</span>} />
              <span className="font-mono text-[9px] text-faint">{s.uses}</span>
            </button>
          ))}
          {pinnedSym && (
            <button type="button" onClick={() => setPinnedSym(null)} aria-label="Clear pinned symbol" className="press ml-1 rounded p-0.5 text-faint hover:text-text">
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* rows + arcs */}
      <div className="scroll-slim relative min-h-0 flex-1 overflow-auto" onClick={(e) => e.target === e.currentTarget && setSelected(null)}>
        <div className="relative" style={{ height: visible.length * ROW + 16 }}>
          <svg className="pointer-events-none absolute left-0 top-2" width={gutter} height={visible.length * ROW} aria-hidden>
            <defs>
              <marker id="flow-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
              </marker>
            </defs>
            {shownArcs.map((a) => {
              const ya = pos.get(a.from)! * ROW + ROW / 2;
              const yb = pos.get(a.to)! * ROW + ROW / 2;
              const span = Math.abs(pos.get(a.to)! - pos.get(a.from)!);
              const reach = Math.min(gutter - 6, 8 + 12 * Math.sqrt(span));
              const x = gutter - 2;
              const tone = arcTone(a);
              const cls =
                tone === "up" ? "text-[rgb(var(--syn-num))] opacity-95" :
                tone === "down" ? "text-accent opacity-95" :
                tone === "sym" ? "text-danger opacity-90" :
                tone === "dim" ? "text-faint opacity-[0.12]" : "text-faint opacity-50";
              return (
                <path
                  key={a.from + ">" + a.to}
                  d={"M" + x + "," + ya + " C" + (x - reach) + "," + ya + " " + (x - reach) + "," + yb + " " + x + "," + yb}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={tone === "up" || tone === "down" || tone === "sym" ? 1.8 : 1}
                  strokeDasharray={a.via.length ? undefined : "3 3"}
                  markerEnd="url(#flow-arrow)"
                  className={"transition-[opacity,color] duration-200 " + cls}
                >
                  <title>{a.via.length ? "via " + a.via.join(", ") : "referenced with \\eqref"}</title>
                </path>
              );
            })}
          </svg>

          {visible.map((rowIdx, k) => {
            const r = rows[rowIdx];
            const id = r.node.id;
            const isSel = id === selected;
            const tone = lit ? (isSel ? "sel" : lit.up.has(id) ? "up" : lit.down.has(id) ? "down" : "dim") : rowMatches(r) ? "on" : "dim";
            return (
              <button
                key={id}
                type="button"
                onClick={() => pick(r)}
                title={r.node.latex}
                className={
                  "press press-soft absolute right-2 flex items-center gap-2.5 rounded-lg border px-2.5 text-left transition-[opacity,border-color,background-color] duration-200 " +
                  (tone === "sel"
                    ? "border-accent bg-accent/[0.08] shadow-sm"
                    : tone === "up"
                      ? "border-[rgb(var(--syn-num)/0.5)] bg-surface"
                      : tone === "down"
                        ? "border-accent/40 bg-surface"
                        : tone === "dim"
                          ? "border-border bg-surface opacity-35 hover:opacity-80"
                          : "border-border bg-surface hover:border-border-strong")
                }
                style={{ top: 8 + k * ROW + 4, height: ROW - 8, left: gutter + 2 }}
              >
                <span className="flex w-14 shrink-0 flex-col leading-tight">
                  <span className="truncate text-[11px] font-semibold text-muted">{r.node.tag ? "(" + r.node.tag + ")" : r.node.number ? "Eq. " + r.node.number : r.node.key ?? "\u2013"}</span>
                  <span className="font-mono text-[9px] text-faint">L{r.node.lines?.[0] ?? "?"}</span>
                </span>
                <span
                  className="math-preview min-w-0 flex-1 overflow-hidden whitespace-nowrap text-[13px]"
                  style={{ maskImage: "linear-gradient(to right, black 88%, transparent)", WebkitMaskImage: "linear-gradient(to right, black 88%, transparent)" }}
                >
                  <InlineMath math={displayLatex(r.node.latex)} renderError={() => <code className="text-[11px] text-faint">{r.node.latex}</code>} />
                </span>
                <span className="hidden shrink-0 items-center gap-1 md:flex">
                  {r.defines.slice(0, 3).map((s) => (
                    <span
                      key={s}
                      onMouseEnter={() => setHoverSym(s)}
                      onMouseLeave={() => setHoverSym(null)}
                      title={"Defines " + s + " - hover to see where it is used"}
                      className={"rounded-full border px-1.5 text-[11px] " + (activeSym === s ? "border-accent bg-accent/10" : "border-border bg-bg")}
                    >
                      <InlineMath math={symbolLabel(s)} renderError={() => <span className="font-mono text-[9px]">{s}</span>} />
                    </span>
                  ))}
                  {r.defines.length > 3 && <span className="text-[10px] text-faint">+{r.defines.length - 3}</span>}
                </span>
                {r.undefinedUses.length > 0 && (
                  <span title={"Uses undefined: " + r.undefinedUses.join(", ")} className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-danger">
                    <AlertTriangle size={11} />
                    {r.undefinedUses.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1 text-[10px] text-faint">
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-[rgb(var(--syn-num))]" /> feeds the selection</span>
        <span className="flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-accent" /> depends on it</span>
        <span className="flex items-center gap-1"><span className="h-0 w-3 border-t border-dashed border-faint" /> \eqref</span>
        <span className="ml-auto hidden sm:inline">Click a row to select it in the editor · Esc clears</span>
      </div>
    </div>
  );
}
