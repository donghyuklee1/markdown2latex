"use client";

/**
 * LLM Proofreading Shield: protect LaTeX behind numbered placeholders, send the
 * prose to a model, then paste the reply back and restore the LaTeX.
 *
 * The session (placeholder -> original) lives in component state; it can be
 * downloaded as JSON and loaded again, because the round trip through a model
 * often spans more than one sitting.
 */
import { useMemo, useRef, useState } from "react";
import { ClipboardCopy, FileJson, FolderOpen, Save, Sparkles } from "lucide-react";
import { useToast } from "@/components/Toast";
import {
  DEFAULT_PROTECT,
  parseSession,
  prompt,
  protect,
  restore,
  serializeSession,
  type ProtectOptions,
  type Session,
} from "@/lib/lab/tex2prose";
import { Button, downloadText, Notice, Segmented, Stats, Switch, TextInput, TextOutput, ToolFrame, Toolbar, TwoPane, useCopy } from "../kit";

const SAMPLE = [
  "Following \\citet{vaswani2017}, we model a sequence $x_{1:T}$ with attention",
  "(Section~\\ref{sec:model}). The training objective is",
  "\\begin{equation}\\label{eq:objective}",
  "  \\mathcal{L}(\\theta) = -\\sum_{t=1}^{T} \\log p_\\theta(x_t \\mid x_{<t}),",
  "\\end{equation}",
  "which we minimise with Adam \\citep[p.~4]{kingma2015} at a learning rate of $3 \\times 10^{-4}$.",
  "As Eq.~\\eqref{eq:objective} shows, the loss is additive over positions,\\footnote{This holds",
  "for any autoregressive factorisation; see \\cite{bengio2003} for an early discussion.}",
  "so we report it per token. % TODO: add the perplexity table",
  "\\label{par:loss}",
].join("\n");

type Step = "protect" | "restore";

export default function Tex2ProsePanel() {
  const toast = useToast();
  const copy = useCopy();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("protect");
  const [tex, setTex] = useState("");
  const [options, setOptions] = useState<ProtectOptions>(DEFAULT_PROTECT);
  const [reply, setReply] = useState("");
  /** A session loaded from disk overrides the one derived from the current input. */
  const [loaded, setLoaded] = useState<Session | null>(null);

  const protectedText = useMemo(() => (tex.trim() ? protect(tex, options) : null), [tex, options]);
  const session = loaded ?? protectedText?.session ?? null;
  const restored = useMemo(() => (session && reply.trim() ? restore(reply, session) : null), [reply, session]);

  const hasPairs = session ? Object.keys(session.entries).some((k) => k.startsWith("/")) : false;
  const instructions = prompt({ prefix: session?.prefix ?? "", paired: hasPairs });
  const set = (patch: Partial<ProtectOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const entryCount = session ? Object.keys(session.entries).length : 0;

  const loadSession = async (file: File | undefined) => {
    if (!file) return;
    const result = parseSession(await file.text());
    if ("error" in result) return toast(file.name + ": " + result.error, "error");
    setLoaded(result.session);
    setStep("restore");
    toast("Loaded session with " + Object.keys(result.session.entries).length + " placeholders", "success");
  };

  const stats = protectedText?.stats;
  const kinds = stats ? Object.entries(stats.counts).sort((a, b) => b[1] - a[1]) : [];

  return (
    <ToolFrame
      title="LLM Proofreading Shield"
      slug="tex2prose"
      pain="Pasting LaTeX into DeepL or a chatbot wastes tokens and the model mangles math, citations and references - send numbered placeholders instead and put the LaTeX back afterwards."
    >
      <Toolbar>
        <Segmented<Step>
          label="Step"
          value={step}
          onChange={setStep}
          options={[
            { id: "protect", label: "1 Protect", title: "Replace LaTeX with placeholders" },
            { id: "restore", label: "2 Restore", title: "Put the LaTeX back into the model's reply" },
          ]}
        />
        {step === "protect" ? (
          <>
            <Switch checked={options.floats} onChange={(v) => set({ floats: v })} label="Hide floats" hint="Replace whole figure / table / algorithm environments" />
            <Switch checked={options.stripComments} onChange={(v) => set({ stripComments: v })} label="Strip % comments" hint="Comments are not sent and are not restored" />
            <Switch checked={options.strict} onChange={(v) => set({ strict: v })} label="Strict" hint="Also wrap \textbf{..} as [B_1]..[/B_1] and hide every other command" />
            <Button icon={Sparkles} onClick={() => setTex(SAMPLE)}>
              Load sample
            </Button>
            <Button
              variant="primary"
              icon={ClipboardCopy}
              disabled={!protectedText}
              onClick={() => protectedText && void copy(instructions + "\n\n---\n\n" + protectedText.prose, "Copied instructions + prose")}
            >
              Copy with instructions
            </Button>
          </>
        ) : (
          <>
            <Button icon={FolderOpen} onClick={() => fileRef.current?.click()}>
              Load session
            </Button>
            {loaded && (
              <Button variant="ghost" onClick={() => setLoaded(null)}>
                Use current input instead
              </Button>
            )}
          </>
        )}
        <Button
          icon={Save}
          disabled={!session || !entryCount}
          onClick={() => {
            if (!session) return;
            downloadText(serializeSession(session) + "\n", "tex2prose-session.json");
            toast("Saved tex2prose-session.json");
          }}
        >
          Download session
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void loadSession(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Toolbar>

      {step === "protect" ? (
        <>
          {stats && (
            <Stats
              items={[
                { label: "placeholders", value: entryCount },
                ...kinds.map(([k, n]) => ({ label: k.toLowerCase(), value: n })),
                { label: "chars", value: stats.inputChars.toLocaleString() + " → " + stats.proseChars.toLocaleString() },
                { label: "tokens saved ≈", value: stats.tokensSaved.toLocaleString(), tone: "ok" as const },
              ]}
            />
          )}
          {loaded && <Notice tone="warn">A loaded session is active, so step 2 restores against it, not against this input.</Notice>}
          {protectedText?.session.prefix && (
            <Notice tone="info">
              The input already contains placeholder-like text, so tokens use the prefix <code>{protectedText.session.prefix}</code> (e.g.{" "}
              <code>[{protectedText.session.prefix}MATH_1]</code>).
            </Notice>
          )}
          <TwoPane>
            <TextInput label="LaTeX" value={tex} onChange={setTex} placeholder="Paste a paragraph or a whole section of LaTeX..." />
            <TextOutput label="Prose to send" value={protectedText?.prose ?? ""} highlight={false} filename="prose.txt" emptyText="Placeholders appear here." />
          </TwoPane>
          <Notice>
            <span className="font-semibold">Prompt prepended by &quot;Copy with instructions&quot;:</span>
            <span className="mt-1 block whitespace-pre-wrap font-mono text-[11px]">{instructions}</span>
          </Notice>
        </>
      ) : (
        <>
          {!session ? (
            <Notice tone="warn">No session yet - protect some LaTeX in step 1, or load a saved session.</Notice>
          ) : (
            <Stats
              items={[
                { label: "session", value: loaded ? "loaded" : "from step 1" },
                { label: "placeholders", value: entryCount },
                ...(restored
                  ? [
                      { label: "missing", value: restored.missing.length, tone: restored.missing.length ? ("danger" as const) : ("ok" as const) },
                      { label: "duplicated", value: restored.duplicated.length, tone: restored.duplicated.length ? ("warn" as const) : ("ok" as const) },
                      { label: "unknown", value: restored.unknown.length, tone: restored.unknown.length ? ("warn" as const) : ("ok" as const) },
                      { label: "repaired", value: restored.repaired },
                    ]
                  : []),
              ]}
            />
          )}
          {restored && <RestoreReport missing={restored.missing} duplicated={restored.duplicated} unknown={restored.unknown} repaired={restored.repaired} />}
          <TwoPane>
            <TextInput label="Model's reply" value={reply} onChange={setReply} placeholder="Paste the corrected or translated text from the model..." />
            <TextOutput label="Restored LaTeX" value={restored?.tex ?? ""} filename="restored.tex" emptyText="Restored LaTeX appears here." />
          </TwoPane>
          {session && (
            <p className="flex items-center gap-1.5 text-[11px] text-faint">
              <FileJson size={12} /> Keep the session file if you will come back later - the placeholders mean nothing without it.
            </p>
          )}
        </>
      )}
    </ToolFrame>
  );
}

function RestoreReport({ missing, duplicated, unknown, repaired }: { missing: string[]; duplicated: string[]; unknown: string[]; repaired: number }) {
  if (!missing.length && !duplicated.length && !unknown.length) {
    return (
      <Notice tone="ok">
        Every placeholder came back exactly once.{repaired ? " " + repaired + " mangled token" + (repaired === 1 ? " was" : "s were") + " recognised and repaired." : ""}
      </Notice>
    );
  }
  return (
    <Notice tone={missing.length ? "error" : "warn"}>
      {missing.length > 0 && (
        <div>
          <span className="font-semibold">Missing ({missing.length}):</span> <code>{missing.join(" ")}</code> - the model dropped these; nothing was inserted for them, so add the LaTeX back by hand.
        </div>
      )}
      {duplicated.length > 0 && (
        <div>
          <span className="font-semibold">Duplicated ({duplicated.length}):</span> <code>{duplicated.join(" ")}</code> - restored at every occurrence; check which one to keep.
        </div>
      )}
      {unknown.length > 0 && (
        <div>
          <span className="font-semibold">Unknown ({unknown.length}):</span> <code>{unknown.join(" ")}</code> - not in this session; left as written.
        </div>
      )}
    </Notice>
  );
}
