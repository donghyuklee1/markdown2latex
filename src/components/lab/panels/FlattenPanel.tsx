"use client";

/**
 * FlattenPanel - load a multi-file LaTeX project (files, a folder, or a zip /
 * tar.gz), pick the main file, and get one self-contained .tex plus a zip with
 * exactly the files arXiv needs. All the logic lives in lib/lab/flatten.ts.
 */
import { useMemo, useState } from "react";
import { FileArchive, FolderOpen, Sparkles, X } from "lucide-react";
import { bytesOf, textOf, zip, type ArchiveFile } from "@/lib/lab/archive";
import { flattenProject, mainCandidates, normPath } from "@/lib/lab/flatten";
import { useToast } from "@/components/Toast";
import { Button, Field, FileDrop, Notice, Pane, Stats, Switch, TextOutput, ToolFrame, Toolbar, TwoPane, downloadBlob, formatBytes, inputClass } from "../kit";

/** Files decoded as text; everything else (figures) is only referenced by path. */
const TEXT_EXT = /\.(tex|ltx|bbl|bib|sty|cls|bst|clo|cfg|def|txt|bbx|cbx)$/i;
/** Support files a build may need beside the flattened source. */
const SHIP_EXT = /\.(sty|cls|bst|clo|cfg|def|bbx|cbx)$/i;
const OUT = "main_flattened.tex";

function sampleProject(): ArchiveFile[] {
  const files: Record<string, string> = {
    "main.tex": String.raw`\documentclass[conference]{IEEEtran}
\usepackage{graphicx}
\graphicspath{{figs/}}
% Draft notes: remember to cut section 3 if over the page limit.

\begin{document}
\title{A Small Multi-File Paper}
\author{\IEEEauthorblockN{Ada Lovelace}}
\maketitle

\input{sections/intro}
\input{sections/method}

\bibliographystyle{IEEEtran}
\bibliography{refs}
\end{document}
`,
    "sections/intro.tex": String.raw`\section{Introduction}
Large models are expensive~\cite{vaswani2017}. % TODO: stronger opening
We fix that at 50\% of the cost.
`,
    "sections/method.tex": String.raw`\section{Method}
\input{sections/method/loss}

\begin{figure}[t]
  \centering
  \includegraphics[width=\columnwidth]{overview}
  \caption{Overview of the pipeline.}
\end{figure}
`,
    "sections/method/loss.tex": String.raw`We minimise
\begin{equation}
  \mathcal{L} = \sum_i \ell(x_i, y_i).
\end{equation}
`,
    // Plain string: the TeX quotes are backticks, which would end a template literal.
    "main.bbl":
      "\\begin{thebibliography}{1}\n\\bibitem{vaswani2017}\nA.~Vaswani \\emph{et al.}, ``Attention is all you need,'' in \\emph{NeurIPS}, 2017.\n\\end{thebibliography}\n",
    "refs.bib": "@inproceedings{vaswani2017, title={Attention is all you need}, year={2017}}\n",
  };
  return [...Object.entries(files).map(([path, text]) => ({ path, data: bytesOf(text) })), { path: "figs/overview.pdf", data: bytesOf("%PDF-1.4\n% placeholder figure\n") }];
}

export default function FlattenPanel() {
  const toast = useToast();
  const [files, setFiles] = useState<ArchiveFile[]>([]);
  const [main, setMain] = useState("");
  const [strip, setStrip] = useState(false);
  const [inlineBbl, setInlineBbl] = useState(true);

  const project = useMemo(() => {
    const text = files.filter((f) => TEXT_EXT.test(f.path)).map((f) => ({ path: f.path, text: textOf(f.data) }));
    const other = files.filter((f) => !TEXT_EXT.test(f.path)).map((f) => f.path);
    return { text, other, candidates: mainCandidates(text) };
  }, [files]);

  const result = useMemo(
    () => (files.length ? flattenProject(project.text, { main: main || undefined, stripComments: strip, inlineBbl, otherPaths: project.other }) : null),
    [files.length, project, main, strip, inlineBbl],
  );

  const load = (next: ArchiveFile[]) => {
    setFiles(next);
    setMain("");
    const tex = next.filter((f) => /\.tex$/i.test(f.path)).length;
    toast("Loaded " + next.length + " file(s), " + tex + " .tex", tex ? "success" : "error");
  };

  const downloadZip = () => {
    if (!result?.mainPath) return;
    const root = result.mainPath.includes("/") ? result.mainPath.slice(0, result.mainPath.lastIndexOf("/") + 1) : "";
    const rel = (p: string) => (root && p.startsWith(root) ? p.slice(root.length) : p);
    const byPath = new Map(files.map((f) => [normPath(f.path), f.data]));
    const out: ArchiveFile[] = [{ path: OUT, data: bytesOf(result.output.endsWith("\n") ? result.output : result.output + "\n") }];
    const add = (path: string, as = rel(path)) => {
      const data = byPath.get(path);
      if (data && !out.some((f) => f.path === as)) out.push({ path: as, data });
    };
    for (const a of result.assets) if (a.resolvedPath) add(a.resolvedPath);
    for (const p of byPath.keys()) if (SHIP_EXT.test(p)) add(p);
    // A .bbl that was not pasted in must be named after the new main file to be found.
    if (result.bblPath && !result.bblInlined) add(result.bblPath, OUT.replace(/\.tex$/, ".bbl"));
    downloadBlob(new Blob([zip(out) as BlobPart], { type: "application/zip" }), "arxiv_flattened.zip");
    toast("Saved arxiv_flattened.zip (" + out.length + " files)");
  };

  const roleOf = (path: string): string => {
    const p = normPath(path);
    if (!result) return "";
    if (p === result.mainPath) return "main";
    if (result.inlined.includes(p)) return "inlined";
    if (result.assets.some((a) => a.resolvedPath === p)) return "figure";
    if (p === result.bblPath) return result.bblInlined ? "inlined" : "shipped";
    if (SHIP_EXT.test(p)) return "shipped";
    return "";
  };

  const linesOut = result?.output ? result.output.split("\n").length : 0;
  const missingAssets = result?.assets.filter((a) => !a.resolvedPath).length ?? 0;

  return (
    <ToolFrame
      title="Paper Flattener"
      slug="tex-flatten"
      pain="Journals and arXiv want one .tex file, but your paper is split across \input{sections/...} files, a .bib, and a figures folder."
    >
      {!files.length ? (
        <>
          <FileDrop
            directory
            onFiles={load}
            title="Drop your LaTeX project"
            hint="Files, a whole folder, or a .zip / .tar.gz (an Overleaf or arXiv source download). Nothing leaves your browser."
            icon={FolderOpen}
          />
          <div className="flex justify-center">
            <Button icon={Sparkles} onClick={() => load(sampleProject())}>
              Load sample project
            </Button>
          </div>
        </>
      ) : (
        <>
          <Toolbar>
            <Field label="Main file">
              <select className={inputClass + " min-w-48"} value={main || result?.mainPath || ""} onChange={(e) => setMain(e.target.value)} aria-label="Main file">
                {!result?.mainPath && <option value="">(none found)</option>}
                {project.text
                  .filter((f) => /\.tex$/i.test(f.path))
                  .map((f) => (
                    <option key={f.path} value={normPath(f.path)}>
                      {normPath(f.path)}
                      {project.candidates.includes(normPath(f.path)) ? "" : " (no \\documentclass)"}
                    </option>
                  ))}
              </select>
            </Field>
            <Switch checked={strip} onChange={setStrip} label="Strip comments" hint="Remove % comments and comment environments; verbatim and \url are left alone" />
            <Switch checked={inlineBbl} onChange={setInlineBbl} label="Inline .bbl" hint="Replace \bibliography{} with the compiled .bbl - arXiv does not run BibTeX for you" />
            <div className="ml-auto flex gap-2">
              <Button icon={X} variant="ghost" onClick={() => setFiles([])}>
                Close project
              </Button>
              <Button icon={FileArchive} variant="primary" disabled={!result?.mainPath} onClick={downloadZip}>
                Download arXiv-ready zip
              </Button>
            </div>
          </Toolbar>

          {result && (
            <Stats
              items={[
                { label: "files inlined", value: result.inlined.length, tone: "ok" },
                { label: "warnings", value: result.warnings.length, tone: result.warnings.length ? "warn" : "ok" },
                { label: "figures", value: result.assets.length - missingAssets + "/" + result.assets.length, tone: missingAssets ? "warn" : undefined },
                { label: "lines in", value: result.linesIn },
                { label: "lines out", value: linesOut },
                { label: "bibliography", value: result.bblInlined ? ".bbl inlined" : result.bblPath ? ".bbl shipped" : "none" },
              ]}
            />
          )}

          {result && result.warnings.length > 0 && (
            <Notice tone="warn">
              <ul className="space-y-0.5">
                {result.warnings.slice(0, 30).map((w, i) => (
                  <li key={i}>
                    {w.file && (
                      <code className="mr-1.5 font-mono text-[11px] text-faint">
                        {w.file}
                        {w.line ? ":" + w.line : ""}
                      </code>
                    )}
                    {w.message}
                  </li>
                ))}
                {result.warnings.length > 30 && <li className="text-faint">...and {result.warnings.length - 30} more</li>}
              </ul>
            </Notice>
          )}

          <TwoPane>
            <Pane label={"Project - " + files.length + " files"}>
              <ul className="scroll-slim min-h-0 flex-1 overflow-auto py-1 font-mono text-[12px]">
                {files
                  .slice()
                  .sort((a, b) => a.path.localeCompare(b.path))
                  .map((f) => {
                    const role = roleOf(f.path);
                    return (
                      <li key={f.path} className="flex items-center gap-2 px-3 py-1 hover:bg-surface-2">
                        <span className={"min-w-0 flex-1 truncate " + (role ? "text-text" : "text-faint")} title={f.path}>
                          {f.path}
                        </span>
                        {role && (
                          <span
                            className={
                              "shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider " +
                              (role === "main" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted")
                            }
                          >
                            {role}
                          </span>
                        )}
                        <span className="w-16 shrink-0 text-right text-[11px] text-faint">{formatBytes(f.data.length)}</span>
                      </li>
                    );
                  })}
              </ul>
            </Pane>
            <TextOutput label={OUT} value={result?.output ?? ""} filename={OUT} emptyText="No main file: add a .tex with \documentclass and \begin{document}." />
          </TwoPane>
        </>
      )}
    </ToolFrame>
  );
}
