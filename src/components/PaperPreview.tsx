"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Columns2, FileDown, Image as ImageIcon, ListTree, Minus, Moon, MousePointerClick, Plus, Square, Sun } from "lucide-react";
import { renderPaper, refText, type Block, type Paper, type Row, type Run } from "@/lib/texRender";
import { BlockMath, InlineMath } from "./Katex";
import { getPaletteServerSnapshot, getPaletteSnapshot, getThemeServerSnapshot, getThemeSnapshot, subscribeToTheme } from "@/lib/theme";

/**
 * Paper preview: a LaTeX document typeset like the PDF Overleaf would give you
 * - numbered sections and equations, real tables, theorem blocks - plus what a
 * PDF cannot do: hover a reference to see its target, double-click anything to
 * jump to its source, flip to two columns, and save the page as a PDF.
 */

interface Props {
  /** Document body (already cleaned) and the whole document, for its preamble. */
  body: string;
  full: string;
  fontSize: number;
  /** Jump the editor to the source of a block (its raw LaTeX). */
  onSource: (src: string) => void;
  scrollerRef: React.RefObject<HTMLDivElement | null>;
}

type Hover = { key: string; x: number; y: number } | null;

/* -------------------------------------------------------------- runs */

function RunsView({ runs, paper, onRef, onHover }: { runs: Run[]; paper: Paper; onRef: (key: string) => void; onHover: (h: Hover) => void }) {
  return (
    <>
      {runs.map((r, i) => {
        switch (r.t) {
          case "text":
            return <span key={i}>{r.v}</span>;
          case "math":
            return <InlineMath key={i} math={r.v} renderError={() => <code className="paper-error">{"$" + r.v + "$"}</code>} />;
          case "b":
            return <b key={i}><RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} /></b>;
          case "i":
            return <i key={i}><RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} /></i>;
          case "tt":
            return <code key={i} className="paper-tt"><RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} /></code>;
          case "sc":
            return <span key={i} style={{ fontVariant: "small-caps" }}><RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} /></span>;
          case "u":
            return <u key={i}><RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} /></u>;
          case "sf":
            return <span key={i} className="font-sans"><RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} /></span>;
          case "br":
            return <br key={i} />;
          case "fn":
            return <sup key={i} className="paper-fn">{r.n}</sup>;
          case "url":
            return (
              <a key={i} href={r.href} target="_blank" rel="noreferrer noopener" className="paper-link">
                <RunsView runs={r.v} paper={paper} onRef={onRef} onHover={onHover} />
              </a>
            );
          case "cite":
            return (
              <span key={i} className="paper-cite" title={r.keys.join(", ")}>
                [{r.keys.map((k) => paper.cites[k] ?? "?").join(", ")}]
              </span>
            );
          case "ref": {
            const { text, ok } = refText(paper, r.key, r.style);
            return ok ? (
              <button
                key={i}
                type="button"
                className="paper-ref"
                onClick={(e) => {
                  e.stopPropagation();
                  onRef(r.key);
                }}
                onMouseEnter={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  onHover({ key: r.key, x: box.left + box.width / 2, y: box.bottom });
                }}
                onMouseLeave={() => onHover(null)}
              >
                {text}
              </button>
            ) : (
              <span key={i} className="paper-undefined" title={"Undefined reference: " + r.key}>
                ??
              </span>
            );
          }
        }
      })}
    </>
  );
}

/* ------------------------------------------------------------- blocks */

function TableView({ rows, cols, paper, onRef, onHover }: { rows: Row[]; cols: Array<"l" | "c" | "r">; paper: Paper; onRef: (k: string) => void; onHover: (h: Hover) => void }) {
  return (
    <div className="paper-table-wrap">
      <table className="paper-table">
        <tbody>
          {rows.map((row, i) =>
            row.cells.length === 0 ? (
              <tr key={i} className={"rule-" + row.rule}>
                <td colSpan={Math.max(1, cols.length)} />
              </tr>
            ) : (
              <tr key={i} className={row.rule ? "rule-" + row.rule : ""}>
                {row.cells.map((c, j) => (
                  <td key={j} colSpan={c.span} style={{ textAlign: c.align === "l" ? "left" : c.align === "r" ? "right" : "center" }}>
                    <RunsView runs={c.runs} paper={paper} onRef={onRef} onHover={onHover} />
                  </td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

function BlocksView(props: { blocks: Block[]; paper: Paper; onRef: (k: string) => void; onHover: (h: Hover) => void; onSource: (src: string) => void }) {
  const { blocks, paper, onRef, onHover, onSource } = props;
  const runs = (r: Run[]) => <RunsView runs={r} paper={paper} onRef={onRef} onHover={onHover} />;
  const sub = (b: Block[]) => <BlocksView {...props} blocks={b} />;
  const src = (b: Block) => ({
    onDoubleClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onSource(b.src);
    },
    "data-src": "",
  });

  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "title":
            return (
              <header key={i} className="paper-title" {...src(b)}>
                <h1>{runs(b.title)}</h1>
                {b.authors.length > 0 && (
                  <div className="paper-authors">
                    {b.authors.map((a, k) => (
                      <span key={k}>{runs(a)}</span>
                    ))}
                  </div>
                )}
                {b.date && b.date.length > 0 && <div className="paper-date">{runs(b.date)}</div>}
              </header>
            );
          case "heading": {
            const H = (b.level === 1 ? "h2" : b.level === 2 ? "h3" : "h4") as "h2";
            return (
              <H key={i} id={b.id} className={"paper-h" + b.level} {...src(b)}>
                {b.num && <span className="paper-num">{b.num}</span>}
                {runs(b.v)}
              </H>
            );
          }
          case "p":
            return (
              <p key={i} className={b.center ? "text-center" : ""} {...src(b)}>
                {runs(b.v)}
              </p>
            );
          case "math":
            return (
              <div key={i} id={b.id} className="paper-math" {...src(b)}>
                <BlockMath math={b.latex} renderError={(err) => <code className="paper-error" title={err.message}>{b.latex}</code>} />
              </div>
            );
          case "theorem":
            return (
              <div key={i} id={b.id} className={"paper-theorem" + (b.italic ? " italic-body" : "")} {...src(b)}>
                <span className="paper-theorem-head">
                  {b.label}
                  {b.num ? " " + b.num : ""}
                </span>
                {b.note && <span className="paper-theorem-note"> ({runs(b.note)})</span>}
                <span className="paper-theorem-head">.</span> {sub(b.body)}
              </div>
            );
          case "proof":
            return (
              <div key={i} className="paper-proof" {...src(b)}>
                <i>Proof{b.note ? <> ({runs(b.note)})</> : null}.</i> {sub(b.body)}
                <span className="paper-qed">{"∎"}</span>
              </div>
            );
          case "list": {
            const L = b.kind === "enumerate" ? "ol" : "ul";
            return (
              <L key={i} className={"paper-list paper-" + b.kind} {...src(b)}>
                {b.items.map((it, k) => (
                  <li key={k}>
                    {it.label && <b className="mr-1">{runs(it.label)}</b>}
                    {sub(it.body)}
                  </li>
                ))}
              </L>
            );
          }
          case "table":
            return (
              <figure key={i} id={b.id} className="paper-float" {...src(b)}>
                {b.caption && (
                  <figcaption>
                    <b>Table {b.num}:</b> {runs(b.caption)}
                  </figcaption>
                )}
                <TableView rows={b.rows} cols={b.cols} paper={paper} onRef={onRef} onHover={onHover} />
              </figure>
            );
          case "figure":
            return (
              <figure key={i} id={b.id} className="paper-float" {...src(b)}>
                <div className="paper-figure-box">
                  {b.images.length ? (
                    b.images.map((img) => (
                      <span key={img} className="paper-figure-file">
                        <ImageIcon size={18} />
                        {img}
                      </span>
                    ))
                  ) : (
                    <span className="paper-figure-file">
                      <ImageIcon size={18} />
                      figure
                    </span>
                  )}
                </div>
                {b.caption && (
                  <figcaption>
                    <b>Figure {b.num}:</b> {runs(b.caption)}
                  </figcaption>
                )}
              </figure>
            );
          case "algorithm":
            return (
              <figure key={i} id={b.id} className="paper-algorithm" {...src(b)}>
                <div className="paper-algorithm-cap">
                  <b>Algorithm {b.num ?? ""}</b> {b.caption && runs(b.caption)}
                </div>
                <ol>
                  {b.lines.map((l, k) => (
                    <li key={k} style={{ paddingLeft: l.depth * 1.4 + "em" }}>
                      {runs(l.runs)}
                    </li>
                  ))}
                </ol>
              </figure>
            );
          case "abstract":
            return (
              <section key={i} className="paper-abstract" {...src(b)}>
                <div className="paper-abstract-title">Abstract</div>
                {sub(b.body)}
              </section>
            );
          case "quote":
            return (
              <blockquote key={i} className="paper-quote" {...src(b)}>
                {sub(b.body)}
              </blockquote>
            );
          case "code":
            return (
              <pre key={i} className="paper-code" {...src(b)}>
                {b.v}
              </pre>
            );
          case "bib":
            return (
              <section key={i} className="paper-bib" {...src(b)}>
                <h2 className="paper-h1">References</h2>
                <ol>
                  {b.items.map((it) => (
                    <li key={it.key}>
                      <span className="paper-bib-num">[{it.num}]</span> {runs(it.v)}
                    </li>
                  ))}
                </ol>
              </section>
            );
        }
      })}
    </>
  );
}

/** Find a block by anchor id, anywhere in the tree. */
function findBlock(blocks: Block[], id: string): Block | null {
  for (const b of blocks) {
    if ("id" in b && b.id === id) return b;
    const kids = "body" in b && Array.isArray(b.body) ? b.body : b.t === "list" ? b.items.flatMap((it) => it.body) : [];
    const hit = findBlock(kids, id);
    if (hit) return hit;
  }
  return null;
}

/* ----------------------------------------------------- print to PDF */

/**
 * Print just the paper: a new same-origin window gets clones of this page's
 * stylesheets and of the rendered sheet (DOM nodes, never an HTML string),
 * then the browser's own print dialog - where "Save as PDF" lives.
 */
function printSheet(sheet: HTMLElement, title: string) {
  const win = window.open("", "_blank", "width=900,height=1100");
  if (!win) return false;
  const doc = win.document;
  doc.title = title;
  for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) doc.head.appendChild(doc.importNode(node, true));
  const style = doc.createElement("style");
  // The margins are drawn into the document, not left to @page: side padding
  // applies on every page, and a table's thead/tfoot repeat on every printed
  // page in Chrome, giving top and bottom margins - so the PDF is the same even
  // when the print dialog's "Margins" is set to None.
  style.textContent =
    "@page{size:A4;margin:0}html,body{background:#fff!important;margin:0;padding:0}" +
    ".print-frame{width:100%;border-collapse:collapse}.print-frame td{padding:0}" +
    ".print-frame .print-body{padding:0 18mm}.print-frame .print-gap{height:16mm}" +
    "@media screen{.print-frame{max-width:210mm;margin:0 auto}}";
  doc.head.appendChild(style);
  doc.documentElement.dataset.theme = "light";
  const clone = doc.importNode(sheet, true) as HTMLElement;
  clone.classList.remove("paper-theme");
  // Print at a paper's own size, not the on-screen zoom.
  clone.style.fontSize = "";
  clone.style.zoom = "";
  const frame = doc.createElement("table");
  frame.className = "print-frame";
  const section = (tag: "thead" | "tbody" | "tfoot", cls: string, content?: HTMLElement) => {
    const part = doc.createElement(tag);
    const row = doc.createElement("tr");
    const cell = doc.createElement("td");
    cell.className = cls;
    if (content) cell.appendChild(content);
    row.appendChild(cell);
    part.appendChild(row);
    frame.appendChild(part);
  };
  section("thead", "print-gap");
  section("tbody", "print-body", clone);
  section("tfoot", "print-gap");
  doc.body.appendChild(frame);
  const go = () => {
    win.focus();
    win.print();
  };
  // Give the cloned stylesheets and KaTeX fonts a moment to load.
  void (doc.fonts?.ready ?? Promise.resolve()).then(() => setTimeout(go, 250));
  return true;
}

/* -------------------------------------------------------------- view */

const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const nearestZoom = (z: number) => ZOOMS.reduce((best, v, i) => (Math.abs(v - z) < Math.abs(ZOOMS[best] - z) ? i : best), 0);

export default function PaperPreview({ body, full, fontSize, onSource, scrollerRef }: Props) {
  const paper = useMemo(() => renderPaper(body, full), [body, full]);
  const [cols, setCols] = useState<1 | 2>(1);
  const [zoom, setZoom] = useState(1);
  const zoomBy = (dir: 1 | -1) => setZoom((z) => ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, nearestZoom(z) + dir))]);
  const [ink, setInk] = useState<"paper" | "theme">("paper");
  const [tocOpen, setTocOpen] = useState(false);
  const [hover, setHover] = useState<Hover>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // The preview's equation colour (the swatches): applied when one is picked;
  // "Ink" leaves the paper's own black, as in the PDF.
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const palette = useSyncExternalStore(subscribeToTheme, getPaletteSnapshot, getPaletteServerSnapshot);
  const mathColor = palette[theme]?.math ?? null;

  // Ctrl/Cmd + scroll (and trackpad pinch, which arrives as ctrl+wheel) zooms
  // the paper instead of the whole page; needs a non-passive listener.
  useEffect(() => {
    const desk = sheetRef.current?.parentElement;
    if (!desk) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const step = Math.max(-50, Math.min(50, e.deltaY)); // a mouse notch is ~100, a trackpad tick ~2
      setZoom((z) => Math.min(2, Math.max(0.5, Math.round(z * Math.exp(-step * 0.003) * 100) / 100)));
    };
    desk.addEventListener("wheel", onWheel, { passive: false });
    return () => desk.removeEventListener("wheel", onWheel);
  }, []);

  const jump = (id: string) => {
    const el = sheetRef.current?.querySelector<HTMLElement>("#" + CSS.escape(id));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("paper-flash");
    void el.offsetWidth; // restart the flash animation
    el.classList.add("paper-flash");
  };
  const onRef = (key: string) => {
    const target = paper.labels[key];
    if (target) jump(target.id);
  };

  const hovered = hover ? paper.labels[hover.key] : null;
  const hoveredBlock = hovered ? findBlock(paper.blocks, hovered.id) : null;
  const pages = Math.max(1, Math.round((paper.stats.words / 500 + paper.stats.equations * 0.06 + (paper.stats.tables + paper.stats.figures) * 0.25) * 10) / 10);

  return (
    <div ref={scrollerRef} className="paper-desk scroll-slim relative h-full overflow-auto" onClick={() => setTocOpen(false)}>
      {/* toolbar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-border bg-surface/90 px-2 py-1 text-[11px] text-faint backdrop-blur">
        <div className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setTocOpen((v) => !v);
            }}
            className={"press flex h-6 items-center gap-1 rounded-md px-2 font-semibold " + (tocOpen ? "bg-accent/10 text-accent" : "hover:bg-surface-2 hover:text-text")}
            disabled={!paper.toc.length}
            title="Table of contents"
          >
            <ListTree size={12} /> Contents
          </button>
          {tocOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-64 animate-pop-in overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-xl" onClick={(e) => e.stopPropagation()}>
              {paper.toc.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    jump(t.id);
                    setTocOpen(false);
                  }}
                  className="press-soft block w-full truncate rounded px-2 py-1 text-left text-xs text-text hover:bg-surface-2"
                  style={{ paddingLeft: 8 + (t.level - 1) * 12 }}
                >
                  {t.num && <span className="mr-1.5 font-semibold text-muted">{t.num}</span>}
                  {t.text}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex rounded-md border border-border bg-bg p-0.5">
          <button type="button" onClick={() => setCols(1)} title="One column" aria-pressed={cols === 1} className={"press rounded px-1.5 py-0.5 " + (cols === 1 ? "bg-surface-2 text-text" : "hover:text-muted")}>
            <Square size={12} />
          </button>
          <button type="button" onClick={() => setCols(2)} title="Two columns, like a conference paper" aria-pressed={cols === 2} className={"press rounded px-1.5 py-0.5 " + (cols === 2 ? "bg-surface-2 text-text" : "hover:text-muted")}>
            <Columns2 size={12} />
          </button>
        </div>
        <div className="flex items-center rounded-md border border-border bg-bg p-0.5" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomBy(-1)} disabled={zoom <= ZOOMS[0]} title="Zoom out (Ctrl/Cmd + scroll)" aria-label="Zoom out" className="press rounded px-1 py-0.5 hover:bg-surface-2 hover:text-text disabled:opacity-30">
            <Minus size={12} />
          </button>
          <button type="button" onClick={() => setZoom(1)} title="Reset to 100%" className="press w-10 rounded py-0.5 text-center font-mono tabular-nums hover:bg-surface-2 hover:text-text">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} title="Zoom in (Ctrl/Cmd + scroll)" aria-label="Zoom in" className="press rounded px-1 py-0.5 hover:bg-surface-2 hover:text-text disabled:opacity-30">
            <Plus size={12} />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setInk((v) => (v === "paper" ? "theme" : "paper"))}
          title={ink === "paper" ? "White paper - switch to the app's colours" : "App colours - switch to white paper"}
          className="press flex h-6 items-center rounded-md px-1.5 hover:bg-surface-2 hover:text-text"
        >
          {ink === "paper" ? <Sun size={12} /> : <Moon size={12} />}
        </button>
        <button
          type="button"
          onClick={() => sheetRef.current && printSheet(sheetRef.current, "Paper preview")}
          title="Open the print dialog with just the paper - choose Save as PDF"
          className="press flex h-6 items-center gap-1 rounded-md px-2 font-semibold hover:bg-surface-2 hover:text-text"
        >
          <FileDown size={12} /> Save as PDF
        </button>
        <span className="ml-auto hidden items-center gap-2 sm:flex">
          <span>{paper.stats.words.toLocaleString()} words</span>·<span>{paper.stats.equations} eq.</span>·<span>{paper.stats.tables} tables</span>·<span>~{pages} pages</span>
          <span className="hidden items-center gap-1 lg:flex" title="Double-click any paragraph, equation or table to jump to its source">
            · <MousePointerClick size={11} /> double-click to source
          </span>
        </span>
      </div>

      <div
        ref={sheetRef}
        className={"paper-sheet paper" + (cols === 2 ? " paper-cols-2" : "") + (ink === "theme" ? " paper-theme" : "")}
        // Zoomed, the sheet keeps its page width and the desk scrolls, as in a PDF viewer.
        style={{ fontSize: fontSize + 2, zoom, ...(zoom !== 1 ? { width: "50rem", maxWidth: "none" } : {}), ...(mathColor ? ({ "--paper-math": mathColor } as React.CSSProperties) : {}) }}
      >
        <BlocksView blocks={paper.blocks} paper={paper} onRef={onRef} onHover={setHover} onSource={onSource} />
        {paper.footnotes.length > 0 && (
          <footer className="paper-footnotes">
            {paper.footnotes.map((f, k) => (
              <div key={k}>
                <sup>{k + 1}</sup> <RunsView runs={f} paper={paper} onRef={onRef} onHover={setHover} />
              </div>
            ))}
          </footer>
        )}
      </div>

      {/* reference preview: what a \ref points at, without scrolling away */}
      {hover && hovered && (
        <div
          className="pointer-events-none fixed z-50 max-w-md -translate-x-1/2 animate-pop-in rounded-lg border border-border bg-surface p-3 text-sm text-text shadow-2xl shadow-black/20"
          style={{ left: Math.min(Math.max(hover.x, 220), window.innerWidth - 220), top: hover.y + 8 }}
        >
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">
            {hovered.name} {hovered.text}
          </div>
          {hoveredBlock?.t === "math" ? (
            <div className="paper overflow-hidden bg-transparent p-0 text-[14px]">
              <BlockMath math={hoveredBlock.latex} renderError={() => <code>{hoveredBlock.latex}</code>} />
            </div>
          ) : hoveredBlock && "caption" in hoveredBlock && hoveredBlock.caption ? (
            <div className="paper bg-transparent p-0 text-[14px]">
              <RunsView runs={hoveredBlock.caption} paper={paper} onRef={() => {}} onHover={() => {}} />
            </div>
          ) : hoveredBlock?.t === "heading" ? (
            <div className="paper bg-transparent p-0 font-semibold">
              <RunsView runs={hoveredBlock.v} paper={paper} onRef={() => {}} onHover={() => {}} />
            </div>
          ) : hoveredBlock?.t === "theorem" ? (
            <div className="paper bg-transparent p-0 text-[14px] italic">
              {hoveredBlock.note ? <RunsView runs={hoveredBlock.note} paper={paper} onRef={() => {}} onHover={() => {}} /> : hoveredBlock.label}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
