"use client";

/**
 * BibPanel - the BibTeX Cleaner. Everything is derived from the .bib text and
 * the options with useMemo; the cleaner itself lives in lib/lab/bibclean.ts.
 * A second pair of panes carries the key changes into a .tex file.
 */
import { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import { useToast } from "@/components/Toast";
import { DEFAULT_BIB_OPTIONS, cleanBib, rewriteCites, type BibOptions, type KeyPattern, type VenueMode } from "@/lib/lab/bibclean";
import { Button, Field, Notice, Pane, Segmented, Stats, Switch, TextInput, TextOutput, Toolbar, ToolFrame, TwoPane } from "../kit";

const SAMPLE = String.raw`% Exported from three different places - typical before a deadline.
@string{pami = "IEEE Transactions on Pattern Analysis and Machine Intelligence"}

@inproceedings{Vaswani_2017,
  title={Attention is All you Need},
  author={Ashish Vaswani and Noam Shazeer and Niki Parmar and Jakob Uszkoreit and others},
  booktitle={Advances in Neural Information Processing Systems 30 (NIPS 2017)},
  pages={5998-6008},
  year={2017}
}

@article{he2016,
  author = "He, K and Zhang, X and Ren, S and Sun, J",
  title = "Deep Residual Learning for Image Recognition",
  booktitle = "CVPR",
  year = 2016,
  doi = {https://doi.org/10.1109/CVPR.2016.90}
}

@INPROCEEDINGS{He_2016_CVPR,
  AUTHOR = {Kaiming He and Xiangyu Zhang and Shaoqing Ren and Jian Sun},
  TITLE = {Deep Residual Learning for Image Recognition},
  BOOKTITLE = {Proceedings of the IEEE Conference on Computer Vision and Pattern Recognition (CVPR)},
  PAGES = {770-778},
  MONTH = jun,
  YEAR = {2016},
  DOI = {10.1109/cvpr.2016.90}
}

@article{Lowe2004,
  author = {David G. Lowe},
  title = {Distinctive Image Features from Scale-Invariant Keypoints},
  journal = {International Journal of Computer Vision},
  volume = {60}, number = {2},
  pages = {91--110},
  year = {2004}
}

@article{maaten08,
  author = {Laurens van der Maaten and Geoffrey Hinton},
  title = {Visualizing Data using t-SNE},
  journal = {Journal of Machine Learning Research},
  volume = 9,
  pages = {2579 - 2605},
  year = {2008}
}

@article{devlin_bert,
  author = {Jacob Devlin and Ming-Wei Chang and Kenton Lee and Kristina Toutanova},
  title = {BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
  journal = {Proceedings of NAACL-HLT},
  year = {2019}
}

@article{Smith_2023,
  author = {Smith, J. and M{\"u}ller, Anna},
  title = {Retrieval & Reasoning at 100% Scale},
  journal = {Journal of Data Science & Analytics},
  year = {2023},
  url = {https://example.org/papers/retrieval_reasoning?id=42&v=2}
}

@article{lecun,
  author = {LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey},
  title = {Deep learning},
  journal = {Nature},
  year = {2015}
}

@misc{openai2023gpt4,
  author = {{OpenAI}},
  title = {GPT-4 Technical Report},
  howpublished = {arXiv preprint arXiv:2303.08774},
  year = {2023}
}

@article{pami_paper,
  author = {Ross Girshick and Jeff Donahue and Trevor Darrell and Jitendra Malik},
  title = {Region-Based Convolutional Networks for Accurate Object Detection and Segmentation},
  journal = pami,
  volume = {38},
  pages = {142-158},
  year = {2016}
}
`;

const SAMPLE_TEX = String.raw`\section{Related work}
Transformers \citep{Vaswani_2017} replaced recurrence; residual networks
\citep[see][Sec.~3]{he2016, He_2016_CVPR} made depth trainable, and
\citet{devlin_bert} showed pre-training transfers. Classic features
\cite{Lowe2004} and embeddings \parencite{maaten08} still matter \cite{lecun,missing_key}.
`;

const KEY_OPTIONS: ReadonlyArray<{ id: KeyPattern; label: string; title: string }> = [
  { id: "authorYearWord", label: "vaswani2017attention", title: "author + year + first title word" },
  { id: "AuthorYear", label: "Vaswani2017", title: "Author + year" },
  { id: "keep", label: "Keep", title: "Leave keys as they are" },
];
const VENUE_OPTIONS: ReadonlyArray<{ id: VenueMode; label: string; title: string }> = [
  { id: "keep", label: "Keep", title: "Leave journal / booktitle as written" },
  { id: "full", label: "Full", title: "Expand known venues to their full names" },
  { id: "abbrev", label: "Abbrev.", title: "ISO 4 abbreviations (curated table + word-level fallback)" },
];

export default function BibPanel() {
  const toast = useToast();
  const [bib, setBib] = useState("");
  const [tex, setTex] = useState("");
  const [opts, setOpts] = useState<BibOptions>(DEFAULT_BIB_OPTIONS);
  const set = <K extends keyof BibOptions>(k: K, v: BibOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const result = useMemo(() => (bib.trim() ? cleanBib(bib, opts) : null), [bib, opts]);
  const cites = useMemo(() => (result && tex.trim() ? rewriteCites(tex, result.keyMap) : null), [result, tex]);

  const loadSample = () => {
    const prev = { bib, tex };
    setBib(SAMPLE);
    setTex(SAMPLE_TEX);
    toast("Loaded a messy sample .bib and .tex", "info", prev.bib || prev.tex ? { label: "Undo", run: () => (setBib(prev.bib), setTex(prev.tex)) } : undefined);
  };

  const s = result?.stats;
  return (
    <ToolFrame
      title="BibTeX Cleaner"
      slug="bibclean"
      pain="Bibliographies merged from Scholar, DBLP and co-authors come with three key styles, missing fields, duplicates and a bare & that breaks the Overleaf compile."
    >
      <Toolbar>
        <Field label="Cite keys">
          <Segmented label="Cite key pattern" value={opts.keys} options={KEY_OPTIONS} onChange={(v) => set("keys", v)} />
        </Field>
        <Field label="Venues">
          <Segmented label="Journal and booktitle names" value={opts.venues} options={VENUE_OPTIONS} onChange={(v) => set("venues", v)} />
        </Field>
        <Switch label="Merge duplicates" checked={opts.dedupe} onChange={(v) => set("dedupe", v)} hint="Same DOI, or same title when DOIs do not conflict" />
        <Switch label="Authors" checked={opts.normalizeAuthors} onChange={(v) => set("normalizeAuthors", v)} hint="Rewrite names as Last, First M." />
        <Switch label="Escape & % # _" checked={opts.escape} onChange={(v) => set("escape", v)} hint="Never touches url / doi / eprint fields or $math$" />
        <Switch label="Protect caps" checked={opts.protectCaps} onChange={(v) => set("protectCaps", v)} hint="Brace {BERT}, {ImageNet} so styles keep their case" />
        <Switch label="Sort" checked={opts.sort} onChange={(v) => set("sort", v)} hint="Sort entries by key" />
        <Button icon={FlaskConical} onClick={loadSample} className="ml-auto">
          Load sample
        </Button>
      </Toolbar>

      {s && (
        <Stats
          items={[
            { label: "entries", value: s.entries },
            { label: "duplicates merged", value: s.duplicatesMerged, tone: s.duplicatesMerged ? "ok" : undefined },
            { label: "keys changed", value: s.keysChanged },
            { label: "authors", value: s.authorsNormalized },
            { label: "venues", value: s.venuesChanged },
            { label: "escaped", value: s.escaped },
            { label: "warnings", value: s.warnings, tone: s.warnings ? "warn" : "ok" },
          ]}
        />
      )}

      <TwoPane>
        <TextInput label="references.bib (input)" value={bib} onChange={setBib} accept=".bib,.txt,text/*" placeholder="Paste or drop a .bib file - or press Load sample." className="h-[480px]" />
        <TextOutput label="Cleaned" value={result?.output ?? ""} filename="references.bib" emptyText="The cleaned .bib appears here." className="h-[480px]" />
      </TwoPane>

      {result && (result.warnings.length > 0 || result.merged.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Pane label={"Warnings (" + result.warnings.length + ")"} className="!min-h-0">
            {result.warnings.length ? (
              <ul className="scroll-slim max-h-56 divide-y divide-border overflow-auto text-xs">
                {result.warnings.map((w, i) => (
                  <li key={i} className="flex gap-2 px-3 py-1.5">
                    <span className="w-12 shrink-0 font-mono text-faint">{w.line ? "L" + w.line : ""}</span>
                    {w.key && <code className="shrink-0 font-mono text-accent">{w.key}</code>}
                    <span className="text-muted">{w.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-xs text-faint">No warnings.</p>
            )}
          </Pane>
          <Pane label={"Merged (" + result.merged.length + ")"} className="!min-h-0">
            {result.merged.length ? (
              <ul className="scroll-slim max-h-56 divide-y divide-border overflow-auto text-xs">
                {result.merged.map((m, i) => (
                  <li key={i} className="px-3 py-1.5 font-mono text-muted">
                    {m.from} <span className="text-faint">{"->"}</span> <span className="text-text">{m.into}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-xs text-faint">No duplicates found.</p>
            )}
          </Pane>
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-text">Rewrite \cite keys in your .tex</h3>
        <p className="text-xs text-muted">
          Paste the paper; every \cite, \citep, \citet, \parencite, \textcite (with optional arguments and comma lists) is updated to the new keys, merged duplicates included.
        </p>
      </div>
      {!result && tex.trim() && <Notice tone="warn">Add a .bib above first - the key map comes from it.</Notice>}
      {cites && (
        <Stats
          items={[
            { label: "keys rewritten", value: cites.replaced, tone: cites.replaced ? "ok" : undefined },
            { label: "not in .bib", value: cites.missing.length ? cites.missing.join(", ") : 0, tone: cites.missing.length ? "danger" : "ok" },
          ]}
        />
      )}
      <TwoPane>
        <TextInput label="main.tex (input)" value={tex} onChange={setTex} accept=".tex,.txt,text/*" placeholder="Paste the .tex that cites these entries." className="h-[320px]" />
        <TextOutput label="main.tex (rewritten)" value={cites?.tex ?? ""} filename="main.tex" emptyText="The .tex with updated \cite keys appears here." className="h-[320px]" />
      </TwoPane>
    </ToolFrame>
  );
}
