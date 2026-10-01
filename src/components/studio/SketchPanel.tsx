"use client";

/**
 * SketchPanel.tsx - Sketch -> TikZ. Draw with mouse, trackpad or pen; every
 * stroke is recognised as a clean shape or connector (src/lib/studio/sketch.ts)
 * and the diagram is emitted as TikZ with a live preview.
 *
 * Everything on screen is drawn from the model through `layoutDiagram`, the
 * same geometry `toSvg` and `toTikz` use, so what you see is what compiles.
 * No vision service, no upload: strokes never leave the page.
 */
import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Download, Redo2, Sparkles, TextCursorInput, Trash2, Undo2 } from "lucide-react";
import { Button, IconAction, Notice, Pane, Segmented, Switch, TextInput, TextOutput, downloadText } from "@/components/lab/kit";
import { useToast } from "@/components/Toast";
import {
  applyStroke,
  edgeGeometry,
  emptyDiagram,
  FONT_CM,
  hitTest,
  layoutDiagram,
  moveNode,
  parseTikz,
  PX_PER_CM,
  removeItem,
  resizeNode,
  sampleDiagram,
  setLabel,
  toSvg,
  toTikz,
  type Diagram,
  type Layout,
  type Pt,
  type SketchOptions,
  type StrokePoint,
} from "@/lib/studio/sketch";
import type { StudioContext } from "./types";

type Tool = "draw" | "select" | "text" | "erase";
type View = "preview" | "tikz" | "import";

interface History {
  past: Diagram[];
  present: Diagram;
  future: Diagram[];
}

/** A drag in progress (Select tool). Lives in a ref: only pointer handlers touch it. */
type Drag =
  | { kind: "move"; id: string; start: Pt; orig: Diagram }
  | { kind: "resize"; id: string; fixed: Pt; orig: Diagram };

interface Editing {
  id: string;
  value: string;
  /** Position inside the canvas box, px. */
  left: number;
  top: number;
}

const GRID = 0.25;
const INK = "rgb(var(--text))";
const ACCENT = "rgb(var(--accent))";
const STROKE_W = (0.8 / 28.45) * PX_PER_CM; // 0.8pt, as in the TikZ

const TOOLS = [
  { id: "draw", label: "Draw", title: "Draw shapes and arrows - each stroke is recognised" },
  { id: "select", label: "Select", title: "Drag nodes (connectors follow), drag corner handles to resize" },
  { id: "text", label: "Text", title: "Click a node or edge to edit its label ($...$ for math)" },
  { id: "erase", label: "Erase", title: "Click a node or edge to delete it" },
] as const;

const VIEWS = [
  { id: "preview", label: "Preview" },
  { id: "tikz", label: "TikZ" },
  { id: "import", label: "Paste TikZ" },
] as const;

/* prefers-reduced-motion as an external store: no effect, hydration-safe. */
const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia(motionQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const reducedMotion = () => window.matchMedia(motionQuery).matches;

const pathOf = (pts: ReadonlyArray<Pt>) =>
  pts.map((p, i) => (i ? "L" : "M") + (p.x * PX_PER_CM).toFixed(1) + " " + (p.y * PX_PER_CM).toFixed(1)).join(" ");

export default function SketchPanel({ insert }: StudioContext) {
  const toast = useToast();
  const gridId = useId();
  const [hist, setHist] = useState<History>(() => ({ past: [], present: emptyDiagram(), future: [] }));
  const model = hist.present;
  const [tool, setTool] = useState<Tool>("draw");
  const [snap, setSnap] = useState(true);
  const [standalone, setStandalone] = useState(false);
  const [view, setView] = useState<View>("preview");
  const [stroke, setStroke] = useState<StrokePoint[] | null>(null);
  const [ghost, setGhost] = useState<{ d: string; key: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [status, setStatus] = useState("Draw a box, circle or diamond. A line from one shape to another becomes an arrow.");
  const [importText, setImportText] = useState("");
  const [importIssues, setImportIssues] = useState<string[]>([]);
  const reduce = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);

  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const lastEdge = useRef<{ edgeId: string; t?: number } | undefined>(undefined);

  const opts: SketchOptions = useMemo(() => ({ grid: GRID, snap }), [snap]);
  const layout = useMemo(() => layoutDiagram(model), [model]);
  const tikz = useMemo(() => toTikz(model, { standalone }), [model, standalone]);
  const empty = model.nodes.length === 0 && model.edges.length === 0;

  /* ------------------------------------------------------------ history */

  const commit = useCallback((next: Diagram) => {
    setHist((h) => (next === h.present ? h : { past: [...h.past.slice(-99), h.present], present: next, future: [] }));
  }, []);
  const undo = () => {
    lastEdge.current = undefined;
    setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h));
  };
  const redo = () => setHist((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h));

  /* ---------------------------------------------------------- pointer i/o */

  /** Client coordinates -> model cm, through the SVG's own transform (handles letterboxing). */
  const toModel = (clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x / PX_PER_CM, y: p.y / PX_PER_CM };
  };
  /** Model cm -> px inside the canvas box, for the inline label editor. */
  const toBox = (p: Pt): { left: number; top: number } => {
    const svg = svgRef.current, box = boxRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !box || !ctm) return { left: 0, top: 0 };
    const s = new DOMPoint(p.x * PX_PER_CM, p.y * PX_PER_CM).matrixTransform(ctm);
    const r = box.getBoundingClientRect();
    return { left: s.x - r.left, top: s.y - r.top };
  };

  const openEditor = (id: string) => {
    const node = model.nodes.find((n) => n.id === id);
    const edge = model.edges.find((e) => e.id === id);
    let at: Pt | null = node ? { x: node.x, y: node.y } : null;
    if (edge) {
      const g = edgeGeometry(model, edge);
      const lbl = layout.edges.find((e) => e.id === id)?.label;
      if (lbl) at = { x: lbl.x / PX_PER_CM, y: lbl.y / PX_PER_CM };
      else if (g) {
        const k = Math.floor((g.length - 2) / 2);
        at = { x: (g[k].x + g[k + 1].x) / 2, y: (g[k].y + g[k + 1].y) / 2 };
      }
    }
    if (!at) return;
    setSelected(id);
    setEditing({ id, value: node?.label ?? edge?.label ?? "", ...toBox(at) });
  };
  const commitEdit = () => {
    if (!editing) return;
    const cur = model.nodes.find((n) => n.id === editing.id)?.label ?? model.edges.find((e) => e.id === editing.id)?.label;
    if (cur !== undefined && cur !== editing.value) commit(setLabel(model, editing.id, editing.value));
    setEditing(null);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = toModel(e.clientX, e.clientY);
    if (!p) return;
    boxRef.current?.focus({ preventScroll: true });
    if (editing) commitEdit();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "draw") {
      setSelected(null);
      setStroke([{ ...p, t: e.timeStamp }]);
      return;
    }
    const corner = (e.target as Element).getAttribute?.("data-corner");
    if (tool === "select" && corner && selected) {
      const n = model.nodes.find((x) => x.id === selected);
      if (n) {
        const [sx, sy] = corner.split(",").map(Number);
        // Resize around the opposite corner, which stays put.
        drag.current = { kind: "resize", id: n.id, fixed: { x: n.x - (sx * n.w) / 2, y: n.y - (sy * n.h) / 2 }, orig: model };
        return;
      }
    }
    const hit = hitTest(model, p, 0.25);
    if (tool === "erase") {
      if (hit) {
        commit(removeItem(model, hit.id));
        setStatus("Erased " + hit.id);
      }
      return;
    }
    if (tool === "text") {
      if (hit) openEditor(hit.id);
      return;
    }
    setSelected(hit?.id ?? null);
    if (hit?.type === "node") drag.current = { kind: "move", id: hit.id, start: p, orig: model };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "draw" && stroke) {
      // Coalesced events keep fast pen strokes smooth (pressure is ignored).
      const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
      const list = evs.length ? evs : [e.nativeEvent];
      const add: StrokePoint[] = [];
      for (const ev of list) {
        const p = toModel(ev.clientX, ev.clientY);
        if (p) add.push({ ...p, t: ev.timeStamp });
      }
      if (add.length) setStroke((s) => (s ? [...s, ...add] : s));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = toModel(e.clientX, e.clientY);
    if (!p) return;
    const next =
      d.kind === "move"
        ? moveNode(d.orig, d.id, p.x - d.start.x, p.y - d.start.y, opts)
        : resizeNode(d.orig, d.id, { x: d.fixed.x, y: d.fixed.y, w: p.x - d.fixed.x, h: p.y - d.fixed.y }, opts);
    // Live update without a history entry; the drag is recorded once on release.
    setHist((h) => ({ ...h, present: next }));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const d = drag.current;
    if (d) {
      drag.current = null;
      setHist((h) => (h.present === d.orig ? h : { past: [...h.past.slice(-99), d.orig], present: h.present, future: [] }));
      return;
    }
    if (tool !== "draw" || !stroke) return;
    const pts = stroke;
    setStroke(null);
    const res = applyStroke(model, pts, opts, lastEdge.current);
    lastEdge.current = res.last;
    setStatus(res.action === "rejected" ? res.message + " - try again" : res.action === "node" ? "Recognised " + res.message : res.message);
    if (res.action !== "rejected") commit(res.model);
    if (!reduce) {
      // The freehand ink fades while the clean shape fades in: the "morph".
      const key = e.timeStamp;
      setGhost({ d: pathOf(pts), key });
      window.setTimeout(() => setGhost((g) => (g && g.key === key ? null : g)), 260);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      commit(removeItem(model, selected));
      setSelected(null);
    } else if (e.key === "Escape") setSelected(null);
    else if (e.key === "Enter" && selected) {
      e.preventDefault();
      openEditor(selected);
    }
  };

  /* ------------------------------------------------------------- actions */

  const clear = () => {
    if (empty) return;
    const prev = model;
    commit(emptyDiagram(model.width, model.height));
    setSelected(null);
    lastEdge.current = undefined;
    toast("Canvas cleared", "info", { label: "Undo", run: () => commit(prev) });
  };
  const loadSample = () => {
    commit(sampleDiagram());
    setSelected(null);
    lastEdge.current = undefined;
    setStatus("Sample loaded - drag nodes with Select, edit labels with Text.");
  };
  const loadImport = () => {
    const { model: m, issues } = parseTikz(importText);
    setImportIssues(issues);
    if (!m.nodes.length && !m.edges.length) return toast("No nodes or paths found in that TikZ", "error");
    commit(m);
    setSelected(null);
    toast("Loaded " + m.nodes.length + " nodes, " + m.edges.length + " edges" + (issues.length ? " (" + issues.length + " skipped)" : ""));
  };

  const selNode = tool === "select" ? layout.nodes.find((n) => n.id === selected) : undefined;
  const cursor = tool === "draw" ? "crosshair" : tool === "text" ? "text" : tool === "erase" ? "pointer" : "default";

  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Tool" value={tool} options={TOOLS} onChange={(t) => (setTool(t), setEditing(null))} />
        <IconAction icon={Undo2} label="Undo (Cmd/Ctrl+Z)" disabled={!hist.past.length} onClick={undo} />
        <IconAction icon={Redo2} label="Redo (Shift+Cmd/Ctrl+Z)" disabled={!hist.future.length} onClick={redo} />
        <IconAction icon={Trash2} label="Clear canvas" disabled={empty} onClick={clear} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Switch checked={snap} onChange={setSnap} label="Snap" hint={"Snap to a " + GRID + " cm grid"} />
          <Button icon={Sparkles} onClick={loadSample}>
            Load sample
          </Button>
        </div>
      </div>

      <div
        ref={boxRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Sketch canvas. Draw shapes with the pointer; Cmd/Ctrl+Z to undo."
        className="relative aspect-[4/3] min-h-[320px] w-full overflow-hidden rounded-xl border border-border bg-surface outline-none focus-visible:border-accent/60"
      >
        <svg
          ref={svgRef}
          viewBox={"0 0 " + layout.width + " " + layout.height}
          className="absolute inset-0 h-full w-full select-none"
          style={{ touchAction: "none", cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            const p = toModel(e.clientX, e.clientY);
            const hit = p && tool !== "erase" ? hitTest(model, p, 0.25) : null;
            if (hit) openEditor(hit.id);
          }}
        >
          <defs>
            <pattern id={gridId} width={GRID * 2 * PX_PER_CM} height={GRID * 2 * PX_PER_CM} patternUnits="userSpaceOnUse">
              <circle cx={0.75} cy={0.75} r={0.75} fill="rgb(var(--border-strong))" />
            </pattern>
          </defs>
          <rect width={layout.width} height={layout.height} fill={"url(#" + gridId + ")"} opacity={snap ? 0.9 : 0.4} />
          <DiagramShapes layout={layout} selected={selected} animate={!reduce} />
          {selNode &&
            [
              [-1, -1],
              [1, -1],
              [-1, 1],
              [1, 1],
            ].map(([sx, sy]) => (
              <rect
                key={sx + "," + sy}
                data-corner={sx + "," + sy}
                x={selNode.cx + (sx * selNode.w) / 2 - 5}
                y={selNode.cy + (sy * selNode.h) / 2 - 5}
                width={10}
                height={10}
                rx={2}
                fill="rgb(var(--surface))"
                stroke={ACCENT}
                strokeWidth={1.5}
                style={{ cursor: sx === sy ? "nwse-resize" : "nesw-resize" }}
              />
            ))}
          {ghost && (
            <path key={ghost.key} d={ghost.d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.7}>
              <animate attributeName="opacity" from="0.7" to="0" dur="0.25s" fill="freeze" />
            </path>
          )}
          {stroke && stroke.length > 1 && (
            <path d={pathOf(stroke)} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </svg>
        {empty && !stroke && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-faint">
            Draw here - boxes, circles, diamonds, arrows. Or load the sample.
          </div>
        )}
        {editing && (
          <input
            autoFocus
            value={editing.value}
            aria-label="Label"
            placeholder="Label, $math$ ok"
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              else if (e.key === "Escape") setEditing(null);
              e.stopPropagation();
            }}
            style={{ left: editing.left, top: editing.top }}
            className="absolute w-44 -translate-x-1/2 -translate-y-1/2 rounded-md border border-accent/60 bg-bg px-2 py-1 text-center font-mono text-[12px] text-text shadow-md outline-none"
          />
        )}
      </div>
      <p aria-live="polite" className="-mt-1 min-h-[1rem] text-[11px] leading-snug text-faint">
        {status}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Output" value={view} options={VIEWS} onChange={setView} />
        <Switch checked={standalone} onChange={setStandalone} label="Standalone" hint="Wrap in a compilable \documentclass{standalone} document" />
        <Button
          variant="primary"
          icon={TextCursorInput}
          className="ml-auto"
          disabled={empty}
          onClick={() => {
            insert(tikz);
            toast("TikZ inserted into the editor");
          }}
        >
          Insert into editor
        </Button>
      </div>

      {view === "preview" && (
        <Pane
          label="Preview"
          className="min-h-[220px]"
          right={
            <IconAction
              icon={Download}
              label="Download diagram.svg"
              disabled={empty}
              onClick={() => {
                downloadText(toSvg(model, { crop: true }), "diagram.svg");
                toast("Saved diagram.svg");
              }}
            />
          }
        >
          {empty ? (
            <div className="flex flex-1 items-center justify-center px-6 py-10 text-center text-sm text-faint">The TikZ picture, as it will compile, appears here.</div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-3">
              <svg
                viewBox={[layout.bounds.x, layout.bounds.y, layout.bounds.w, layout.bounds.h].join(" ")}
                className="max-h-[320px] w-full"
                role="img"
                aria-label="Diagram preview"
              >
                <DiagramShapes layout={layout} selected={null} animate={false} />
              </svg>
            </div>
          )}
        </Pane>
      )}
      {view === "tikz" && <TextOutput label="TikZ" value={empty ? "" : tikz} filename="diagram.tex" className="max-h-[420px]" emptyText="Draw something to get TikZ." />}
      {view === "import" && (
        <div className="flex flex-col gap-2">
          <TextInput
            label="Paste TikZ"
            value={importText}
            onChange={setImportText}
            placeholder={"\\node[box, minimum width=2cm, minimum height=1cm] (n1) at (2,7) {Encoder};\n\\draw[->] (n1) -- (n2);"}
            className="min-h-[200px]"
          />
          <div className="flex items-center gap-2">
            <Button icon={Sparkles} disabled={!importText.trim()} onClick={loadImport}>
              Load into canvas
            </Button>
            <span className="text-[11px] text-faint">Reads code generated here: nodes at (x,y), and \draw with --, -| and |-.</span>
          </div>
          {importIssues.length > 0 && (
            <Notice tone="warn">
              {importIssues.length} thing{importIssues.length === 1 ? "" : "s"} skipped or approximated:
              <ul className="mt-1 list-disc pl-4">
                {importIssues.slice(0, 8).map((s, i) => (
                  <li key={i} className="font-mono text-[11px]">
                    {s}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}

/** Nodes, connectors, heads and labels from the shared layout - the canvas and the preview both use it. */
function DiagramShapes({ layout, selected, animate }: { layout: Layout; selected: string | null; animate: boolean }) {
  const font = FONT_CM * PX_PER_CM;
  const anim = animate ? "motion-safe:animate-fade-in" : "";
  return (
    <g fontFamily="var(--font-serif)" fontSize={font}>
      {layout.edges.map((e) => {
        const color = e.id === selected ? ACCENT : INK;
        return (
          <g key={e.id} className={anim}>
            <polyline points={e.points.map((p) => p.x + "," + p.y).join(" ")} fill="none" stroke={color} strokeWidth={STROKE_W} />
            {/* A wide invisible stroke makes thin connectors easy to hit with a finger. */}
            <polyline points={e.points.map((p) => p.x + "," + p.y).join(" ")} fill="none" stroke="transparent" strokeWidth={12} />
            {e.heads.map((h, i) => (
              <polygon key={i} points={h.map((p) => p.x + "," + p.y).join(" ")} fill={color} />
            ))}
            {e.label && (
              <text x={e.label.x} y={e.label.y} textAnchor={e.label.anchor} dominantBaseline={e.label.baseline} fill={color}>
                {e.label.text}
              </text>
            )}
          </g>
        );
      })}
      {layout.nodes.map((n) => {
        const color = n.id === selected ? ACCENT : INK;
        const common = { fill: "rgb(var(--surface))", fillOpacity: 0.001, stroke: color, strokeWidth: n.id === selected ? STROKE_W * 1.8 : STROKE_W };
        return (
          <g key={n.id} className={anim}>
            {n.kind === "rect" ? (
              <rect x={n.cx - n.w / 2} y={n.cy - n.h / 2} width={n.w} height={n.h} rx={n.rx} {...common} />
            ) : n.kind === "ellipse" ? (
              <ellipse cx={n.cx} cy={n.cy} rx={n.w / 2} ry={n.h / 2} {...common} />
            ) : (
              <polygon points={n.points.map((p) => p.x + "," + p.y).join(" ")} {...common} />
            )}
            {n.label && (
              <text x={n.cx} y={n.cy} textAnchor="middle" dominantBaseline="middle" fill={color}>
                {n.label}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
}
