"use client";

/**
 * Tensor -> Matrix: paste a NumPy / PyTorch printout (or just a shape) and get
 * the LaTeX matrix plus the `\mathbf{X} \in \mathbb{R}^{...}` statement for a
 * methodology section, with a live KaTeX preview.
 */
import { useMemo, useState } from "react";
import { BlockMath } from "@/components/Katex";
import { DEFAULT_TENSOR, dimNames, tensorToTex, type Convention, type Decimals, type FieldChoice, type MatrixEnv, type TensorOptions, type VectorOrientation } from "@/lib/lab/tensor2tex";
import { Field, inputClass, Notice, Pane, Segmented, Stats, Switch, TextInput, TextOutput, ToolFrame, Toolbar, TwoPane } from "../kit";

const SAMPLES: ReadonlyArray<{ label: string; text: string }> = [
  { label: "NumPy 2D", text: "array([[ 0.5   , -1.25  ,  2.    ],\n       [ 3.1416,  0.    , -0.0001]], dtype=float32)" },
  { label: "PyTorch 4D shape", text: "torch.Size([32, 3, 224, 224])" },
  {
    label: "Summarized",
    text: "array([[   0,    1,    2, ...,   97,   98,   99],\n       [ 100,  101,  102, ...,  197,  198,  199],\n       ...,\n       [9900, 9901, 9902, ..., 9997, 9998, 9999]])",
  },
  { label: "Complex", text: "array([[1.+2.j, 0.-1.j],\n       [3.5+0.j, 2.-2.j]])" },
  { label: "3D tensor", text: "tensor([[[1, 2],\n         [3, 4]],\n\n        [[5, 6],\n         [7, 8]]], device='cuda:0')" },
  { label: "Symbolic", text: "x.shape = (B, T, D)" },
];

const select = inputClass + " pr-7";

/** A labelled <select> bound to one option value. */
function Choice<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<[T, string]> }) {
  return (
    <Field label={label}>
      <select className={select} value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

export default function TensorPanel() {
  const [input, setInput] = useState("");
  const [o, setO] = useState<TensorOptions>(DEFAULT_TENSOR);
  const set = (patch: Partial<TensorOptions>) => setO((prev) => ({ ...prev, ...patch }));

  const result = useMemo(() => tensorToTex(input, o), [input, o]);
  const output = result.latex ? "\\[\n" + result.latex + "\n\\]" : "";
  const rank = result.rank;
  const preset = (c: Convention) => (rank ? dimNames(rank, { convention: c, customDims: "" }).join(" \u00d7 ") : c);

  return (
    <ToolFrame
      title="Tensor → Matrix"
      slug="tensor2tex"
      pain="Turning NumPy and PyTorch printouts into LaTeX matrices and shape statements for a methodology section is slow and error-prone."
    >
      <Toolbar>
        <Choice<MatrixEnv>
          label="Environment"
          value={o.env}
          onChange={(env) => set({ env })}
          options={[
            ["bmatrix", "bmatrix [ ]"],
            ["pmatrix", "pmatrix ( )"],
            ["vmatrix", "vmatrix | |"],
            ["Bmatrix", "Bmatrix { }"],
            ["array", "array {rr}"],
          ]}
        />
        <Choice<string>
          label="Decimals"
          value={String(o.decimals)}
          onChange={(d) => set({ decimals: (d === "auto" ? "auto" : Number(d)) as Decimals })}
          options={[["auto", "auto"], ...[0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), String(d)] as [string, string])]}
        />
        <Field label="Variable">
          <input className={inputClass + " w-24"} value={o.name} onChange={(e) => set({ name: e.target.value })} spellCheck={false} aria-label="Variable name" />
        </Field>
        <Choice<Convention>
          label="Dimension names"
          value={o.convention}
          onChange={(convention) => set({ convention })}
          options={[
            ["standard", "Standard: " + preset("standard")],
            ["alternate", "Alternate: " + preset("alternate")],
            ["custom", "Custom..."],
          ]}
        />
        {o.convention === "custom" && (
          <Field label="Names (comma list)">
            <input className={inputClass + " w-36"} value={o.customDims} placeholder="N, L, D" onChange={(e) => set({ customDims: e.target.value })} spellCheck={false} />
          </Field>
        )}
        <Choice<FieldChoice>
          label="Field"
          value={o.field}
          onChange={(field) => set({ field })}
          options={[
            ["auto", "auto"],
            ["R", "\u211d real"],
            ["C", "\u2102 complex"],
            ["Z", "\u2124 integer"],
            ["B", "{0,1} boolean"],
          ]}
        />
        <Field label="Vectors">
          <Segmented<VectorOrientation>
            label="Vector orientation"
            value={o.vector}
            onChange={(vector) => set({ vector })}
            options={[
              { id: "column", label: "Column" },
              { id: "row", label: "Row" },
              { id: "transpose", label: "Row\u1d40", title: "Row written with a transpose: a column vector on one line" },
            ]}
          />
        </Field>
      </Toolbar>
      <Toolbar>
        <Switch checked={o.annotate} onChange={(annotate) => set({ annotate })} label="Shape statement" hint="Add X \in R^{...} and the concrete sizes" />
        <Switch checked={o.dimStyle === "numbers"} onChange={(v) => set({ dimStyle: v ? "numbers" : "names" })} label="Sizes in exponent" hint="R^{32 x 3} instead of R^{N x C}" />
        <Switch checked={o.scientific} onChange={(scientific) => set({ scientific })} label="Scientific" hint="1.2 x 10^{-3} for |x| >= 1e4 or < 1e-3" />
        <Switch checked={o.lowercaseVector} onChange={(lowercaseVector) => set({ lowercaseVector })} label="Lowercase vectors" hint="Write vectors as bold x" />
        <Switch checked={o.bools === "TF"} onChange={(v) => set({ bools: v ? "TF" : "01" })} label="Booleans as T/F" />
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-faint">Samples</span>
          {SAMPLES.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setInput(s.text)}
              className="press press-soft rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium text-muted hover:border-border-strong hover:text-text"
            >
              {s.label}
            </button>
          ))}
        </div>
      </Toolbar>

      {result.error ? (
        <Notice tone="error">
          Line {result.error.line}, column {result.error.column}: {result.error.message}
        </Notice>
      ) : (
        result.latex && (
          <Stats
            items={[
              { label: "shape", value: "(" + result.shape.map((s) => (s === null ? "?" : s)).join(", ") + (result.shape.length === 1 ? "," : "") + ")" },
              { label: "rank", value: rank },
              { label: "elements", value: result.elements === null ? "unknown" : result.elements.toLocaleString() },
              ...(result.dtype ? [{ label: "dtype", value: result.dtype }] : []),
              ...(result.shapeOnly ? [{ label: "input", value: "shape only" }] : []),
            ]}
          />
        )
      )}
      {result.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <TwoPane>
        <TextInput
          label="NumPy / PyTorch output"
          value={input}
          onChange={setInput}
          accept=".txt,.py,.log,text/*"
          placeholder={"array([[1., 2.],\n       [3., 4.]], dtype=float32)\n\nor tensor(...), [[1 2]\n [3 4]], torch.Size([32, 3, 224, 224]), (B, T, D)"}
        />
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <Pane label="Preview">
            <div className="scroll-slim flex min-h-[120px] flex-1 items-center justify-center overflow-auto p-4 text-text">
              {result.latex ? (
                <BlockMath math={result.latex} renderError={(e) => <span className="font-mono text-xs text-danger">{e.message}</span>} />
              ) : (
                <span className="text-sm text-faint">The rendered matrix appears here.</span>
              )}
            </div>
          </Pane>
          <TextOutput label="LaTeX" value={output} filename="tensor.tex" emptyText="LaTeX appears here." />
        </div>
      </TwoPane>
    </ToolFrame>
  );
}
