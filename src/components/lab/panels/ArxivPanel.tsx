"use client";

/**
 * arXiv Formula Extractor: fetch a paper's LaTeX source from arxiv.org (or take
 * a dropped source package) and list every display equation, exactly as the
 * author wrote it, with copy buttons that bring the needed macros along.
 *
 * The one network call is `fetch(sourceUrl(id))` in `load` - the paper ID goes
 * to arxiv.org and nothing else leaves the page. Parsing is lib/lab/arxiv.ts.
 */
import { useMemo, useState } from "react";
import { Braces, CloudDownload, Copy, Search, WandSparkles, X } from "lucide-react";
import { BlockMath } from "@/components/Katex";
import { useToast } from "@/components/Toast";
import {
  expandMacros,
  extractEquations,
  parseArxivId,
  prepareSource,
  renderable,
  searchEquations,
  sourceUrl,
  withDefinitions,
  type Equation,
  type MacroDef,
  type SourceFile,
} from "@/lib/lab/arxiv";
import type { ArchiveFile } from "@/lib/lab/archive";
import { Button, FileDrop, Field, Notice, Pane, Stats, Switch, ToolFrame, Toolbar, inputClass, useCopy } from "../kit";

interface Loaded {
  label: string;
  files: SourceFile[];
  binaryCount: number;
}

const PAGE = 40;

/** A friendly sentence for each way the arXiv request can fail. */
function httpMessage(status: number, id: string): string {
  if (status === 404) return "arXiv has no paper " + id + " (404). Check the ID - old-style IDs need their archive, e.g. hep-th/9901001.";
  if (status === 403 || status === 429 || status === 503) return "arXiv is rate-limiting requests (HTTP " + status + "). Wait a minute and retry, or download the source from the paper's page and drop it below.";
  return "arXiv answered HTTP " + status + ". Try again, or drop a downloaded source package below.";
}

export default function ArxivPanel() {
  const toast = useToast();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [query, setQuery] = useState("");
  const [inline, setInline] = useState(false);
  const [expand, setExpand] = useState(true);
  const [limit, setLimit] = useState(PAGE);

  const extraction = useMemo(() => (loaded ? extractEquations(loaded.files, { inline }) : null), [loaded, inline]);
  const macros = useMemo(() => new Map((extraction?.macros ?? []).map((d) => [d.name, d])), [extraction]);
  const hits = useMemo(() => (extraction ? searchEquations(extraction.equations, query) : []), [extraction, query]);

  const accept = async (entries: ArchiveFile[], label: string) => {
    const prepared = await prepareSource(entries);
    if ("error" in prepared) {
      setError(prepared.error);
      toast(prepared.error, "error");
      return;
    }
    setError(null);
    setLoaded({ label, files: prepared.files, binaryCount: prepared.binaryCount });
    setQuery("");
    setLimit(PAGE);
    toast("Loaded " + label);
  };

  const load = async () => {
    const parsed = parseArxivId(input);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      try {
        // The only request this tool makes: the paper ID, to arxiv.org.
        res = await fetch(sourceUrl(parsed.id));
      } catch {
        const msg = "Could not reach arxiv.org - you may be offline, or an extension blocked the request. Download the source from the paper's page (Other formats > Source) and drop it below.";
        setError(msg);
        toast("arxiv.org unreachable", "error");
        return;
      }
      if (!res.ok) {
        const msg = httpMessage(res.status, parsed.id);
        setError(msg);
        toast(res.status === 404 ? "Paper not found" : "arXiv request failed", "error");
        return;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      await accept([{ path: parsed.id.replace(/\//g, "_"), data: bytes }], "arXiv:" + parsed.id);
    } catch (err) {
      const msg = "Download failed: " + (err instanceof Error ? err.message : String(err));
      setError(msg);
      toast(msg, "error");
    } finally {
      setBusy(false);
    }
  };

  const eqs = extraction?.equations ?? [];
  const shown = hits.slice(0, limit);

  return (
    <ToolFrame title="arXiv Formula Extractor" slug="arxiv-math-scraper" pain="Copying an equation out of a PDF breaks it - \sum turns into P and brackets vanish - but the paper's LaTeX source has it exactly.">
      <Toolbar>
        <div className="min-w-[240px] flex-1">
          <Field label="arXiv ID or link">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !busy) void load();
              }}
              placeholder="2301.12345, arXiv:hep-th/9901001 or https://arxiv.org/abs/..."
              spellCheck={false}
              className={inputClass}
            />
          </Field>
        </div>
        <Button variant="primary" icon={CloudDownload} busy={busy} disabled={!input.trim()} onClick={() => void load()}>
          Fetch source
        </Button>
      </Toolbar>

      <Notice>
        Only the paper ID is sent, to arxiv.org, to download the paper&apos;s public LaTeX source. Nothing else leaves this page - unpacking and parsing happen here.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}

      {!loaded && (
        <FileDrop
          title="or drop a downloaded source .tar.gz / .zip / .tex"
          hint="For offline use, or when arXiv rate-limits. A folder works too."
          accept=".gz,.tgz,.tar,.zip,.tex,.sty"
          directory
          onFiles={(files) => void accept(files, files.length === 1 ? files[0].path : files.length + " files")}
        />
      )}

      {loaded && extraction && (
        <>
          <Toolbar>
            <div className="min-w-[220px] flex-1">
              <Field label="Search" hint="A label (eq:loss), a number ((3), eq. 3), or text from the formula or the sentence before it.">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(PAGE);
                    }}
                    placeholder="eq:loss, (3), \nabla, gradient..."
                    spellCheck={false}
                    className={inputClass + " pl-8"}
                  />
                </div>
              </Field>
            </div>
            <Switch checked={inline} onChange={setInline} label="Include inline math" hint="Also list $...$ and \(...\)" />
            <Switch checked={expand} onChange={setExpand} label="Expand user macros" hint="Preview and show the formula with the paper's \newcommand macros substituted" />
            <Button
              icon={X}
              onClick={() => {
                setLoaded(null);
                setQuery("");
                setError(null);
              }}
            >
              Clear
            </Button>
          </Toolbar>

          <Stats
            items={[
              { label: "source", value: loaded.label },
              { label: "files", value: extraction.files.length + " of " + loaded.files.length + (loaded.binaryCount ? " (+" + loaded.binaryCount + " binary)" : "") },
              { label: "equations", value: eqs.length, tone: eqs.length ? "ok" : "warn" },
              { label: "macros", value: extraction.macros.length },
              ...(query ? [{ label: "matches", value: hits.length }] : []),
            ]}
          />

          {extraction.error && <Notice tone="error">{extraction.error}</Notice>}
          {extraction.warnings.length > 0 && (
            <Notice tone="warn">
              <details>
                <summary className="cursor-pointer">
                  {extraction.warnings.length} note{extraction.warnings.length === 1 ? "" : "s"} while reading the source
                </summary>
                <ul className="mt-1 list-disc pl-4">
                  {extraction.warnings.slice(0, 50).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </details>
            </Notice>
          )}
          <p className="text-[11px] leading-snug text-faint">
            Equation numbers are estimates: they follow numbered environments, \nonumber/\notag, \tag, subequations and \numberwithin, but not custom counters or class-specific schemes.
          </p>

          <div className="flex flex-col gap-3 pb-4">
            {shown.map((h) => (
              <EquationCard key={h.eq.index + ":" + h.eq.file + ":" + h.eq.line} eq={h.eq} macros={macros} expand={expand} />
            ))}
            {hits.length > shown.length && (
              <Button className="self-center" onClick={() => setLimit((n) => n + PAGE)}>
                Show {Math.min(PAGE, hits.length - shown.length)} more of {hits.length - shown.length}
              </Button>
            )}
            {query && !hits.length && <Notice>No equation matches &ldquo;{query}&rdquo;.</Notice>}
          </div>
        </>
      )}
    </ToolFrame>
  );
}

function EquationCard({ eq, macros, expand }: { eq: Equation; macros: ReadonlyMap<string, MacroDef>; expand: boolean }) {
  const copy = useCopy();
  const expansion = useMemo(() => expandMacros(eq.latex, macros), [eq, macros]);
  const shownLatex = expand ? expansion.text : eq.body;
  const math = useMemo(() => renderable(eq, expand ? expansion.text : eq.latex), [eq, expand, expansion]);

  // The expanded block keeps the original wrapper (\begin{align} ... \end{align}).
  const expandedBlock = useMemo(() => {
    const at = eq.source.indexOf(eq.body);
    if (at < 0 || !eq.body) return expansion.text;
    return eq.source.slice(0, at) + expansion.text + eq.source.slice(at + eq.body.length);
  }, [eq, expansion]);

  const number = eq.numbers.length ? eq.numbers.map((n) => "(" + n + ")").join(" ") : "unnumbered";
  return (
    <Pane
      className="min-h-0"
      label={number}
      right={
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5 pr-1 text-[11px] text-faint">
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono">{eq.env}</code>
          {eq.labels.map((l) => (
            <code key={l} className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-accent">
              {l}
            </code>
          ))}
          <span className="font-mono">
            {eq.file}:{eq.line}
          </span>
        </div>
      }
    >
      <div className="flex flex-col gap-2 p-3">
        {eq.context && <p className="line-clamp-2 text-[11px] leading-snug text-faint">&hellip;{eq.context}</p>}
        <div className="scroll-slim overflow-x-auto py-1 text-text">
          <BlockMath
            math={math}
            renderError={(err) => (
              <div className="text-[11px] text-faint">
                KaTeX cannot draw this one ({err.message.replace(/^KaTeX parse error:\s*/, "").slice(0, 120)}) - the source below is still exact.
              </div>
            )}
          />
        </div>
        <pre className="scroll-slim max-h-48 overflow-auto rounded-lg bg-bg p-2 font-mono text-[12px] leading-5 text-text">{shownLatex}</pre>
        {expand && expansion.skipped.length > 0 && (
          <p className="text-[11px] text-faint">
            Left unexpanded: {expansion.skipped.map((s) => "\\" + s.name + " (" + s.reason + ")").join(", ")}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button icon={Copy} title="The block exactly as written in the source" onClick={() => void copy(eq.source, "LaTeX copied")}>
            Copy LaTeX
          </Button>
          <Button
            icon={Braces}
            disabled={!eq.macros.length}
            title={eq.macros.length ? "Prepends " + eq.macros.map((m) => "\\" + m).join(", ") : "Uses no user macros"}
            onClick={() => void copy(withDefinitions(eq, macros), "Copied with " + eq.macros.length + " definition" + (eq.macros.length === 1 ? "" : "s"))}
          >
            Copy with macro definitions
          </Button>
          <Button icon={WandSparkles} disabled={!expansion.expanded.length} title="User macros substituted, so it pastes anywhere" onClick={() => void copy(expandedBlock, "Expanded LaTeX copied")}>
            Copy expanded
          </Button>
        </div>
      </div>
    </Pane>
  );
}
