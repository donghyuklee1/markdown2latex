# AGENTS.md

Instructions for coding agents working in this repository. Humans should read
[`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md) and
[`docs/ENGINE.md`](docs/ENGINE.md) instead - they cover the same ground in more
depth.

## What this project is

CleanMath turns messy LLM-generated math into LaTeX that compiles on the first
try. Next.js 16 App Router, React 19, single static page, Tailwind, KaTeX.
Everything runs in the browser. The one server piece is `app/api/analyze`, and
nothing else may be added: no other route handlers, no server actions, no
analytics, and no request that carries user text except the click-triggered
exits below. Privacy is a product feature, not an implementation detail. There
are exactly four exits, all deliberate and all triggered by an explicit click:

- **Open in Overleaf** (`components/exporters.ts`) POSTs the document to
  Overleaf's `/docs` endpoint - only on an explicit click, and its tooltip says so.
- **PNG export** `fetch`es KaTeX's font files - this site's own static assets,
  carrying no user data - to inline them into the image.
- **arXiv Formula Extractor** (`lab/panels/ArxivPanel.tsx`) fetches
  `https://arxiv.org/src/<id>` - the only thing sent is the paper ID the user
  typed. Use `/src/`, not `/e-print/`: the latter redirects without CORS headers.
- **Derivation notes -> Analyze with Gemini** (`components/derivation/gemini.ts`)
  sends the document to Google's Gemini API. With the user's own key the
  browser calls Google directly (key stored in their browser, sent as the
  `x-goog-api-key` header, never in a URL). Without one it goes through
  `app/api/analyze/route.ts`, which holds the site key (`GEMINI_API_KEY`, a
  server secret). That route must stay narrow: it accepts only `{ input }`,
  builds the prompt itself via `geminiRequest`, refuses cross-origin calls,
  rate-limits per visitor and per day, and stores and logs nothing
  (`tests/api.spec.ts`). Either way `mergeAi` validates the answer.

Anything else that would send data off the page does not belong.

> **Next.js 16 is newer than most training data.** APIs, conventions and file
> layout differ from Next 13/14 - `next lint` is gone, `useSyncExternalStore` is
> the expected way to read external state, and the App Router has moved on. Check
> `node_modules/next/dist/docs/` before writing Next-specific code. (`next dev`
> normally appends a block saying this; it is disabled via `agentRules: false` in
> `next.config.mjs` because this file is hand-maintained.)

## Commands

```bash
npm install
npm run dev        # http://localhost:3000
npm run verify     # lint + typecheck + test + build  <- run this before finishing
npm test           # engine conformance + KaTeX render checks
npm run examples   # regenerate examples/ (commit the diff)
```

`npm run verify` is the gate. CI runs the same steps and additionally fails if
`examples/` is stale.

## Architecture

| Path | Role |
| --- | --- |
| `src/lib/cleaner.ts` | The engine. Pure, synchronous, no DOM, no React, no I/O. |
| `src/lib/highlight.ts` | LaTeX highlighter for the output pane. Escapes before it wraps. |
| `src/lib/defaultText.ts` | Sample inputs, also the fixtures for tests and examples. |
| `src/lib/optionsStore.ts` | Preferences as an external store over `localStorage`. |
| `src/lib/persistedStore.ts` | Store factory, plus the draft and layout (split, font size, wrap, tab) stores. |
| `src/lib/shortcuts.ts` | The shortcut table. Drives both the key handler and the `?` dialog. |
| `src/lib/share.ts` | URL-fragment share links. Standard web APIs only, so it runs under node tests. |
| `src/lib/site.ts` | Site name, URL (`NEXT_PUBLIC_SITE_URL`) and links. |
| `src/lib/diagnostics.ts` | KaTeX-parses each cleaned block; maps failures to input lines. |
| `src/lib/diff.ts` | Myers line diff with word-level detail, for the Diff tab. |
| `src/lib/latexDocument.ts` | Cleaned output -> full .tex document (markdown prose to LaTeX). |
| `src/components/exporters.ts` | Clipboard, downloads, PNG rendering, the Overleaf form post. |
| `src/lib/katexOptions.ts` | The one KaTeX config. Shared with the tests on purpose. |
| `src/components/Katex.tsx` | Local KaTeX bindings. Replaced the unmaintained `react-katex`. |
| `src/components/*` | All client components. DOM APIs belong here. |
| `tests/cleaner.spec.ts` | Plain-node checks, run with `tsx`. No test framework. |

The `lib/` stores (`optionsStore`, `persistedStore`, `theme`) may touch
`localStorage` and `window` inside their snapshot and setter functions - never at
module load, so they still import under node. Everything else in `lib/` stays
free of browser APIs.

The purity of `cleaner.ts` is load-bearing: it is what lets the engine run on
every keystroke and be tested without a browser. If a change seems to need a
browser API in the engine, the design is wrong.

## Tools, Studio, documents

`src/components/ResearchLab.tsx` is the **Tools** view (header switch "Editor |
Tools", `Alt+R`) with nine tools. Each tool is three files:

| Path | Role |
| --- | --- |
| `src/lib/lab/<tool>.ts` | Pure logic. Same rules as the engine: no DOM, no network, `\uXXXX` escapes, never throws. |
| `src/components/lab/panels/<Tool>Panel.tsx` | The UI, built only from `src/components/lab/kit.tsx`. Lazy-loaded via `lab/tools.ts`. |
| `tests/lab/<tool>.spec.ts` | Checks via `tests/harness.ts`; `npm test` runs every `tests/**/*.spec.ts`. |

Shared pieces: `src/lib/lab/archive.ts` reads `.zip` / `.tar` / `.tar.gz` and
writes `.zip` with web-standard APIs only; `lab/tools.ts` is the registry (title,
slug, group, icon). A new tool adds a registry entry and those three files.

The **Studio** features live beside the editor: `components/studio/` (Workbench
drawer, formula graph/flow) with pure logic in `src/lib/studio/`, all taking the
`StudioContext` contract in `components/studio/types.ts`.

Editor-level modules: `lib/repair.ts` (Check & Fix: KaTeX-verified repairs),
`lib/texDocument.ts` (whole `.tex` documents: preamble passthrough, preamble
macros -> KaTeX `macros`, a small prose reader for the preview), and
`lib/documents.ts` (tabs, history, snippets, file names). Document macros reach
every KaTeX render through `MacroContext` in `components/Katex.tsx`.

`tests/lab/ascii.spec.ts` enforces rule 1 for all of `src/lib/`: something on
the maintainer's machine has been seen decoding `\uXXXX` escapes back into
literal characters after saves, and this guard catches it in CI.

## Rules specific to this codebase

1. **Non-ASCII characters in `src/lib/` are written as `\uXXXX` escapes or built
   with `String.fromCharCode`.** Never paste a literal zero-width space, NBSP or
   Greek letter into the engine. Half this project's job is hunting invisible
   codepoints; they must stay greppable and must survive any copy-paste.

2. **Never weaken the two invariants.** Idempotence
   (`cleanMath(cleanMath(x)) === cleanMath(x)`) and "every example renders in
   KaTeX across all three modes" are both asserted in `tests/cleaner.spec.ts`.

3. **A new cleanup rule needs two tests**: one that fails without the rule, and
   one pinning down an input where it must *not* fire. The second matters more.
   `(y_i - f(x_i))^2` must never be wrapped in `\text{}`. If a rule cannot be made
   safe by default, put it behind a flag in `ConfigOptions`.

4. **Errors are reported, never thrown.** The tokenizer degrades an unterminated
   delimiter to literal text and records an `Issue`. A malformed input must still
   produce output and a rendering preview - the user is usually mid-keystroke.

5. **HTML sinks have exactly five justified call sites.**
   `MathOutput` writes highlighted code through `highlightLine`, which escapes
   before it wraps; `Katex` writes `katex.renderToString` output, which cannot
   emit raw HTML because `trust` is off; `layout.tsx` inlines `THEME_BOOTSTRAP`,
   a constant string that only ever writes validated hex through
   `style.setProperty`; `exporters.ts` sets `innerHTML` on an off-screen node
   from the same trusted `renderToString` output, to draw the PNG export;
   `lab/kit.tsx`'s `TextOutput` writes `highlightLine` output, the same escaping
   argument as `MathOutput`. Any sixth call site needs the same kind of argument,
   in a comment, or it does not belong. Tool panels display results
   through `TextOutput` or the `Katex` components, never their own sink.

6. **Do not restore state in an effect.** Preferences come from
   `src/lib/optionsStore.ts` via `useSyncExternalStore`, which keeps the first
   paint hydration-safe and syncs across tabs. `react-hooks/set-state-in-effect`
   is an error, not a warning.

## Before finishing

Run `npm run verify`. If you changed engine behaviour, also run `npm run examples`
and commit the resulting diff - it is the human-readable record of what changed.
