"use client";

import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Search, ZoomIn, ZoomOut } from "lucide-react";
import { InlineMath } from "@/components/Katex";
import {
  buildFormulaGraph,
  displayLatex,
  layoutGraph,
  lineageSet,
  type GraphLayout,
  type GraphNode,
} from "@/lib/studio/formulaGraph";
import FormulaFlow from "./FormulaFlow";
import type { StudioContext } from "./types";

/**
 * Formula Dependency Graph: which equation defines each symbol, and what
 * depends on it. The graph and its layout are pure (`lib/studio/formulaGraph`);
 * this file only draws them as SVG and handles zoom, pan and selection.
 *
 * Zoom/pan live in one `view` state ({x, y, k}); `null` means "fit", which is
 * derived during render from the container size, so the graph follows resizes
 * and edits without a state-restoring effect. Gestures read the latest view
 * through `live`, a ref synced after each commit and only read in handlers.
 */

interface View {
  x: number;
  y: number;
  k: number;
}

const PAD = 28;
const MIN_K = 0.08;
const MAX_K = 4;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

function fitView(size: { w: number; h: number }, layout: GraphLayout): View {
  if (!layout.width || !size.w || !size.h) return { x: size.w / 2, y: size.h / 2, k: 1 };
  const k = clampK(Math.min((size.w - 2 * PAD) / layout.width, (size.h - 2 * PAD) / layout.height, 1.4));
  return { x: (size.w - layout.width * k) / 2, y: (size.h - layout.height * k) / 2, k };
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
function zoomAt(v: View, factor: number, px: number, py: number): View {
  const k = clampK(v.k * factor);
  const r = k / v.k;
  return { x: px - (px - v.x) * r, y: py - (py - v.y) * r, k };
}

const linesText = (lines: [number, number] | null) =>
  !lines ? "not defined in this document" : lines[0] === lines[1] ? "line " + lines[0] : "lines " + lines[0] + "\u2013" + lines[1];

/** The original node-link view; best for small documents. */
function NetworkGraph({ input, selectLines }: StudioContext) {
  const [includeInline, setIncludeInline] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [animate, setAnimate] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Typing stays responsive on long papers: the graph trails the editor by a frame.
  const source = useDeferredValue(input);
  const graph = useMemo(() => buildFormulaGraph(source, { includeInline }), [source, includeInline]);
  const layout = useMemo(() => layoutGraph(graph), [graph]);
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  const sel = selected && byId.has(selected) ? selected : null;
  const lit = useMemo(() => (sel ? lineageSet(graph, sel) : null), [graph, sel]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return new Set(
      graph.nodes
        .filter((n) => n.latex.toLowerCase().includes(q) || n.label.toLowerCase().includes(q) || (n.key ?? "").toLowerCase().includes(q))
        .map((n) => n.id),
    );
  }, [graph, q]);

  const fit = fitView(size, layout);
  const v = view ?? fit;

  const viewport = useRef<HTMLDivElement>(null);
  const live = useRef({ v, fit });
  useLayoutEffect(() => {
    live.current = { v, fit };
  });

  // Size: the observer callback (not the effect body) sets state.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      // Trackpad pinch arrives as ctrl+wheel with small deltas: make it as lively as a mouse.
      const speed = e.ctrlKey ? 0.01 : 0.0015;
      const factor = Math.exp(-e.deltaY * unit * speed);
      setAnimate(false);
      setView(zoomAt(live.current.v, factor, e.clientX - rect.left, e.clientY - rect.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------------------------------------------------- pointer gestures */

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ start: View; anchor: { x: number; y: number }; dist: number; moved: boolean }>({
    start: { x: 0, y: 0, k: 1 },
    anchor: { x: 0, y: 0 },
    dist: 0,
    moved: false,
  });

  const local = (e: React.PointerEvent) => {
    const rect = viewport.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  /** Restart the gesture from the current pointers (on every pointer added or lost). */
  const restart = () => {
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    g.start = live.current.v;
    if (pts.length >= 2) {
      g.anchor = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      g.dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    } else if (pts.length === 1) {
      g.anchor = pts[0];
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) gesture.current.moved = false;
    restart();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const pts = [...pointers.current.values()];
    const g = gesture.current;
    if (pts.length === 1) {
      const dx = pts[0].x - g.anchor.x;
      const dy = pts[0].y - g.anchor.y;
      if (!g.moved && Math.hypot(dx, dy) < 4) return; // still a click
      if (!g.moved) {
        g.moved = true;
        // Capture only once it is a drag, so a plain click still lands on the node.
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      setAnimate(false);
      setView({ x: g.start.x + dx, y: g.start.y + dy, k: g.start.k });
    } else if (pts.length >= 2) {
      g.moved = true;
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const k = clampK((g.start.k * dist) / g.dist);
      // The world point under the starting midpoint follows the fingers.
      const wx = (g.anchor.x - g.start.x) / g.start.k;
      const wy = (g.anchor.y - g.start.y) / g.start.k;
      setAnimate(false);
      setView({ x: mid.x - wx * k, y: mid.y - wy * k, k });
    }
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    restart();
  };

  /* ------------------------------------------------------------ actions */

  const animateTo = (next: View | null) => {
    setAnimate(true);
    setView(next);
  };
  const zoomBy = (factor: number) => animateTo(zoomAt(v, factor, size.w / 2, size.h / 2));

  const activate = (node: GraphNode) => {
    if (gesture.current.moved) return;
    setSelected(node.id);
    if (node.lines) selectLines(node.lines[0], node.lines[1]);
  };

  const onBackgroundClick = (e: React.MouseEvent) => {
    if (gesture.current.moved) return;
    if (!(e.target as Element).closest("[data-node]")) setSelected(null);
  };
  const onBackgroundDoubleClick = (e: React.MouseEvent) => {
    if (!(e.target as Element).closest("[data-node]")) animateTo(null);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    // Clear the selection first; only an Escape with nothing selected reaches the drawer.
    if (e.key === "Escape" && sel) {
      e.preventDefault();
      setSelected(null);
    }
  };

  /* ------------------------------------------------------------- render */

  const equations = graph.nodes.filter((n) => n.kind === "equation").length;
  const symbols = graph.nodes.length - equations;
  const undefinedCount = graph.nodes.filter((n) => n.kind === "symbol" && !n.defined).length;
  const markerId = "fg" + useId().replace(/[^A-Za-z0-9_-]/g, "");

  const isDim = (id: string) => (lit ? !lit.has(id) : matches ? !matches.has(id) : false);
  const tipNode = hovered ? byId.get(hovered) : undefined;
  const tipBox = tipNode ? layout.positions[tipNode.id] : undefined;

  return (
    <div className="flex h-full w-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2 text-xs">
        <div className="flex items-center gap-3 tabular-nums text-muted">
          <span>
            <b className="font-semibold text-text">{equations}</b> equations
          </span>
          <span>
            <b className="font-semibold text-text">{symbols}</b> symbols
          </span>
          <span className={undefinedCount ? "text-danger" : ""}>
            <b className="font-semibold">{undefinedCount}</b> undefined
          </span>
        </div>
        <label className="flex min-w-[140px] flex-1 items-center gap-1.5 rounded-lg border border-border bg-bg px-2 py-1 focus-within:border-accent">
          <Search size={13} className="shrink-0 text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find symbol or label"
            aria-label="Highlight matching nodes"
            className="w-full min-w-0 bg-transparent text-text outline-none placeholder:text-faint"
          />
        </label>
        <label className="flex cursor-pointer select-none items-center gap-1.5 text-muted">
          <input
            type="checkbox"
            checked={includeInline}
            onChange={(e) => setIncludeInline(e.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Inline equations
        </label>
        <div className="ml-auto flex items-center gap-0.5">
          {[
            { label: "Zoom out", icon: ZoomOut, run: () => zoomBy(1 / 1.3) },
            { label: "Zoom in", icon: ZoomIn, run: () => zoomBy(1.3) },
            { label: "Fit graph", icon: Maximize2, run: () => animateTo(null) },
          ].map(({ label, icon: Icon, run }) => (
            <button
              key={label}
              type="button"
              onClick={run}
              title={label}
              aria-label={label}
              className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <Icon size={14} strokeWidth={2.25} />
            </button>
          ))}
        </div>
      </div>

      <div
        ref={viewport}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-bg active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBackgroundClick}
        onDoubleClick={onBackgroundDoubleClick}
      >
        {equations === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-faint">
            Add display equations to see how they connect.
          </div>
        ) : (
          <svg className="absolute inset-0 h-full w-full select-none" role="group" aria-label="Formula dependency graph">
            <defs>
              {[
                ["", "fill-border-strong"],
                ["-lit", "fill-accent"],
              ].map(([suffix, cls]) => (
                <marker
                  key={suffix}
                  id={markerId + suffix}
                  viewBox="0 0 8 8"
                  refX="7.5"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8 z" className={cls} />
                </marker>
              ))}
            </defs>
            <g
              className={animate ? "transition-transform duration-300 ease-out motion-reduce:transition-none" : ""}
              style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})`, transformOrigin: "0 0" }}
            >
              {graph.edges.map((e, k) => {
                const a = layout.positions[e.from];
                const b = layout.positions[e.to];
                if (!a || !b) return null;
                const sx = a.x + a.w;
                const sy = a.y + a.h / 2;
                const tx = b.x;
                const ty = b.y + b.h / 2;
                const forward = tx > sx;
                const dx = forward ? Math.max(28, (tx - sx) / 2) : 90;
                const d = `M${sx},${sy} C${sx + dx},${sy} ${tx - dx},${ty} ${tx},${ty}`;
                const on = lit ? lit.has(e.from) && lit.has(e.to) : false;
                const dim = lit ? !on : matches ? !(matches.has(e.from) || matches.has(e.to)) : false;
                return (
                  <path
                    key={k}
                    d={d}
                    fill="none"
                    className={(on ? "stroke-accent" : e.kind === "feeds" ? "stroke-faint" : "stroke-border-strong") + " transition-opacity"}
                    strokeWidth={on ? 1.75 : 1.25}
                    strokeDasharray={e.kind === "feeds" ? "4 4" : undefined}
                    markerEnd={`url(#${markerId}${on ? "-lit" : ""})`}
                    opacity={dim ? 0.12 : e.kind === "feeds" && !on ? 0.7 : 1}
                  />
                );
              })}
              {graph.nodes.map((n) => {
                const box = layout.positions[n.id];
                if (!box) return null;
                return (
                  <NodeView
                    key={n.id}
                    node={n}
                    box={box}
                    selected={n.id === sel}
                    match={!!matches?.has(n.id)}
                    dim={isDim(n.id)}
                    onActivate={activate}
                    onHover={setHovered}
                  />
                );
              })}
            </g>
          </svg>
        )}

        {tipNode && tipBox && (
          <div
            role="tooltip"
            className="pointer-events-none absolute z-10 max-w-[min(360px,90%)] -translate-x-1/2 -translate-y-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-lg"
            style={{ left: v.x + (tipBox.x + tipBox.w / 2) * v.k, top: v.y + tipBox.y * v.k - 6 }}
          >
            <div className="font-semibold text-text">
              {tipNode.kind === "equation" ? tipNode.label : tipNode.defined ? "Defined symbol" : "Used but never defined"}
              {tipNode.key && tipNode.kind === "equation" && tipNode.key !== tipNode.label ? (
                <span className="ml-1.5 font-mono font-normal text-faint">{tipNode.key}</span>
              ) : null}
            </div>
            <code className="mt-0.5 block break-all font-mono text-[11px] text-muted">{tipNode.latex}</code>
            <div className="mt-0.5 text-faint">
              {tipNode.kind === "symbol" ? "used in " + tipNode.uses + (tipNode.uses === 1 ? " equation, " : " equations, ") : ""}
              {tipNode.kind === "symbol" && tipNode.defined ? "defined at " : ""}
              {linesText(tipNode.lines)}
            </div>
          </div>
        )}

        {equations > 0 && (
          <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-3 rounded-md bg-surface/80 px-2 py-1 text-[10px] text-faint">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-4 rounded-full border border-accent/60 bg-accent/10" /> defined
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-4 rounded-full border border-danger/60 bg-danger/10" /> undefined
            </span>
            <span className="flex items-center gap-1">
              <svg width="18" height="4" aria-hidden>
                <line x1="0" y1="2" x2="18" y2="2" className="stroke-faint" strokeDasharray="4 3" />
              </svg>
              feeds
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ nodes */

function NodeView({
  node,
  box,
  selected,
  match,
  dim,
  onActivate,
  onHover,
}: {
  node: GraphNode;
  box: { x: number; y: number; w: number; h: number };
  selected: boolean;
  match: boolean;
  dim: boolean;
  onActivate: (n: GraphNode) => void;
  onHover: (id: string | null) => void;
}) {
  const eq = node.kind === "equation";
  const raw = (error: Error) => (
    <span className="font-mono text-[11px] text-muted" title={error.message}>
      {node.latex}
    </span>
  );
  const shape = eq
    ? "fill-surface " + (selected ? "stroke-accent" : match ? "stroke-accent/70" : "stroke-border-strong")
    : node.defined
      ? "fill-accent/10 " + (selected || match ? "stroke-accent" : "stroke-accent/50")
      : "fill-danger/10 " + (selected || match ? "stroke-danger" : "stroke-danger/60");
  // A long equation is clipped with a fade rather than cut mid-command; the tooltip has it all.
  const long = node.latex.length > 34;

  return (
    <g
      data-node=""
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={(eq ? node.label + ": " : node.defined ? "Symbol " : "Undefined symbol ") + node.latex}
      transform={`translate(${box.x},${box.y})`}
      className="cursor-pointer outline-none transition-opacity duration-200 [&:focus-visible>rect]:stroke-accent"
      opacity={dim ? 0.25 : 1}
      onClick={(e) => {
        e.stopPropagation();
        onActivate(node);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(node);
        }
      }}
      onPointerEnter={() => onHover(node.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(node.id)}
      onBlur={() => onHover(null)}
    >
      <rect
        width={box.w}
        height={box.h}
        rx={eq ? 10 : box.h / 2}
        className={shape}
        strokeWidth={selected ? 2 : 1}
      />
      {eq ? (
        <>
          <text x={10} y={15} className="fill-faint" style={{ fontSize: 10, fontWeight: 600 }}>
            {node.label.length > 26 ? node.label.slice(0, 25) + "\u2026" : node.label}
          </text>
          {node.lines && (
            <text x={box.w - 10} y={15} textAnchor="end" className="fill-faint" style={{ fontSize: 9 }}>
              L{node.lines[0]}
            </text>
          )}
          <foreignObject x={8} y={20} width={box.w - 16} height={box.h - 24}>
            <div
              className="flex h-full items-center overflow-hidden whitespace-nowrap text-[12px] leading-none text-text"
              style={long ? { maskImage: "linear-gradient(to right, black 82%, transparent)", WebkitMaskImage: "linear-gradient(to right, black 82%, transparent)" } : undefined}
            >
              <InlineMath math={displayLatex(node.latex)} renderError={raw} />
            </div>
          </foreignObject>
        </>
      ) : (
        <foreignObject x={6} y={0} width={box.w - 12} height={box.h}>
          <div className="flex h-full items-center justify-center overflow-hidden whitespace-nowrap text-[13px] leading-none text-text">
            <InlineMath math={node.latex} renderError={raw} />
          </div>
        </foreignObject>
      )}
    </g>
  );
}

/**
 * Formula graph tab: the equation flow (rows + dependency arcs, scales to long
 * papers) by default, with the node-link network one click away.
 */
export default function FormulaGraph(props: StudioContext) {
  const [view, setView] = useState<"flow" | "network">("flow");
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1">
        <div role="radiogroup" aria-label="Graph view" className="relative grid grid-cols-2 rounded-md border border-border bg-bg p-0.5">
          <span
            aria-hidden
            className="spring absolute bottom-0.5 left-0.5 top-0.5 rounded bg-surface-2 shadow-sm"
            style={{ width: "calc((100% - 4px) / 2)", transform: view === "network" ? "translateX(100%)" : "none" }}
          />
          {(["flow", "network"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => setView(v)}
              title={v === "flow" ? "Equations in document order with dependency arcs - best for long papers" : "Node-link graph of equations and symbols - best for a handful of equations"}
              className={"press press-soft relative z-10 rounded px-2.5 py-0.5 text-[11px] font-semibold " + (view === v ? "text-text" : "text-faint hover:text-muted")}
            >
              {v === "flow" ? "Flow" : "Network"}
            </button>
          ))}
        </div>
      </div>
      <div key={view} className="min-h-0 flex-1 animate-fade-in">
        {view === "flow" ? <FormulaFlow {...props} /> : <NetworkGraph {...props} />}
      </div>
    </div>
  );
}
