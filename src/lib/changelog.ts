/**
 * changelog.ts - the patch notes shown in the app (sign-in screen footer,
 * account menu). Newest first; the first entry's version is the app's version
 * and must match package.json (tests/changelog.spec.ts). Pure data, ASCII.
 */

export interface Release {
  version: string;
  /** ISO date. */
  date: string;
  title: string;
  /** One line each, short. */
  notes: string[];
}

export const CHANGELOG: ReadonlyArray<Release> = [
  {
    version: "1.4.0",
    date: "2026-10-03",
    title: "Selection assistant and figure preview",
    notes: [
      "Selection toolbar in the editor and the output: locate the counterpart, meaning, connections, preview.",
      "Source-to-output correspondence by maths block, with whitespace-tolerant matching.",
      "Symbol connections: which equations define and use the selected quantities.",
      "Figure Optimizer: live before/after preview at the chosen DPI, layout and quality.",
      "Derivation explanations transition smoothly between steps.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-03",
    title: "Account-scoped workspaces and document sync",
    notes: [
      "Per-account storage namespaces isolate documents, history, snippets and analyses on shared devices.",
      "Documents sync across devices, merged per document by most recent edit.",
      "Sign-out flushes pending changes before clearing the local workspace.",
      "Share links survive the OAuth round trip.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-03",
    title: "Vision transcription, AI mode and Google Drive",
    notes: [
      "Image and PDF transcription to Markdown, LaTeX or formulas only - printed or handwritten.",
      "AI mode: background derivation analysis with cancellation and equation-level caching.",
      "Physics-aware dimensional analysis that excludes abstract mathematics; AI-inferred units.",
      "Google Drive export (source, clean LaTeX, full document, PNG) and import (drive.file scope).",
      "Gemini model fallback across families, honouring Retry-After.",
      "Gemini API keys stored encrypted with Supabase Vault.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-02",
    title: "Derivation analysis",
    notes: [
      "Derivation notes with transitively reduced top-down and bottom-up dependency graphs.",
      "Variable extraction to a booktabs notation table; idea maps exportable as TikZ.",
      "Parallel structured-output (JSON schema) requests with minimal model thinking.",
      "Paper preview zoom from 50% to 200%, with Ctrl/Cmd + scroll.",
      "Cross-device history with search.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-02",
    title: "Document engine",
    notes: [
      "Typesetting of full .tex documents: numbering, \\ref / \\eqref / \\cite, theorems, booktabs, bibliography.",
      "Structural auto-repair: brackets, matrix grids, environments and KaTeX compatibility.",
      "Check & Fix with KaTeX-verified repairs.",
      "Research tools: arXiv extractor, paper flattener, BibTeX cleaner, journal templates.",
      "Open in Overleaf with XeLaTeX detection, diff view and export formats.",
      "249 categorised starter snippets with smart insertion.",
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
