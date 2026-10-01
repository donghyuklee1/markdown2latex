<div align="left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="static/logo-dark.svg">
    <img alt="CleanMath - markdown2latex" src="static/logo-light.svg" width="500">
  </picture>
</div>

<a href="https://github.com/donghyuklee1/markdown2latex/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/donghyuklee1/markdown2latex/ci.yml?branch=main&label=CI&style=flat-square" alt="CI status"></a>
<a href="LICENSE"><img src="https://img.shields.io/github/license/donghyuklee1/markdown2latex?style=flat-square&color=5eead4" alt="MIT license"></a>
<a href="package.json"><img src="https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs" alt="Next.js 16"></a>

---

<div align="center">
  <a href="examples/"><b>Examples</b></a>
  &nbsp;·&nbsp;
  <a href="docs/ENGINE.md"><b>How the engine works</b></a>
  &nbsp;·&nbsp;
  <a href=".github/CONTRIBUTING.md"><b>Contributing</b></a>
  &nbsp;·&nbsp;
  <a href="#quickstart"><b>Quickstart</b></a>
</div>

<br/>

# Stop hand-fixing LLM math.

ChatGPT, Claude and DeepSeek all write LaTeX, and all of them write it slightly
wrong: `\[...\]` where your editor wants `$$`, an `align` block uselessly wrapped
in `$$`, a missing `\\` at the end of a row, prose sitting bare inside the maths,
and a zero-width space you cannot see but `pdflatex` can.

CleanMath fixes that in one paste. Everything runs in your browser - no upload, no
account, no server.

**Pasted from an LLM:**

```markdown
Here is the equation for the loss function:
\[
L(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f(x_i))^2
\]
Also, for alignment:
$$
\begin{align}
a = b + c \\
d = e + f (some raw text here)
\end{align}
$$
And inline math like \( E = mc^2 \).
```

**What CleanMath gives you:**

```latex
Here is the equation for the loss function:
$$
L(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f(x_i))^2
$$
Also, for alignment:
\begin{align*}
a &= b + c \\
d &= e + f \text{ (some raw text here)}
\end{align*}
And inline math like $E = mc^2$.
```

Three things happened there that are easy to miss: the redundant `$$` around the
`align` is **gone** (that one is a hard Overleaf error), the `align` got
**starred** so it will not renumber your paper's equations, and the second row
grew the `&` anchor and a `\text{}` wrapper it was missing.

More before/after pairs, in all three delimiter modes: [`examples/`](examples/).

## Quickstart

**1. Clone and install** (Node 20.9+, 22 recommended):

```bash
git clone https://github.com/donghyuklee1/markdown2latex.git
cd markdown2latex
npm install
```

**2. Run it:**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The input pane is pre-filled
with a messy LLM answer, so you can see what it does before typing anything.

**3. Or build the static app:**

```bash
npm run build && npm start
```

**4. Or run it in Docker:**

```bash
docker build -t cleanmath . && docker run -p 3000:3000 cleanmath
```

## What it fixes

| Problem in LLM output | What CleanMath does |
| --- | --- |
| `\[ ... \]` display delimiters | Converted to your chosen display style |
| `\( ... \)` inline delimiters | Converted to `$ ... $` |
| `$$` wrapped around an `align` / `equation` | Outer delimiter stripped - the usual Overleaf compile error |
| `\begin{align}` auto-numbering your paper | Starred to `align*` |
| Rows missing their `\\` terminator | Added, to every row but the last |
| Align rows missing their `&` anchor | Inserted before the first top-level `=` |
| Prose sitting bare inside math | Wrapped in `\text{...}`, Hangul included |
| Zero-width spaces, NBSP, smart quotes | Removed or replaced |
| Unicode `<=`, Greek letters, operators | Converted to real commands |
| An unclosed `$` or `$$` | Reported on the exact line - never crashes the preview |

## Delimiter modes

| Mode | Display math | Use it for |
| --- | --- | --- |
| **Standard** | `$$ ... $$` | Obsidian, Notion, GitHub, most markdown |
| **Academic** | `\begin{equation*}` / `\begin{align*}` | Overleaf, paper drafts |
| **Inline-only** | collapsed to `$ ... $` | Chat, code comments, commit messages |

Existing environments stay bare in every mode - wrapping them is what broke the
snippet in the first place. Your mode and toggles persist in `localStorage`.

## Shortcuts

| Key | Action |
| --- | --- |
| `Cmd` / `Ctrl` + `Enter` | Copy clean LaTeX |
| Click a red line number | Jump the caret to the broken delimiter |

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="static/readme/pipeline-dark.svg">
  <img alt="CleanMath pipeline: messy LLM text is normalized, tokenized into prose and math, each math block is cleaned and re-emitted, producing compilation-ready LaTeX." src="static/readme/pipeline-light.svg" width="100%">
</picture>

The engine is a hand-written scanner rather than a pile of regexes, because the
hard cases are all about context: `\$5` is a price, `\\]` is a row break followed
by a bracket, and a fenced code block that *documents* LaTeX must not be rewritten
at all. It runs synchronously on every keystroke - there is no debounce, because
there is nothing slow enough to need one.

Two invariants are enforced in CI:

- **Idempotence** - `cleanMath(cleanMath(x)) === cleanMath(x)`.
- **Everything parses** - every bundled example, in all three modes, is rendered
  through KaTeX with `throwOnError: true`.

Full write-up: [`docs/ENGINE.md`](docs/ENGINE.md).

## Project layout

```
src/
├── components/
│   ├── Header.tsx        Title + GitHub star badge
│   ├── Workspace.tsx     Two-pane layout, state, Cmd+Enter, clipboard
│   ├── ControlBar.tsx    Delimiter mode + formatting toggles
│   ├── MathInput.tsx     Textarea, paste/clear, red error lines
│   ├── MathOutput.tsx    Clean-code tab + live KaTeX preview tab
│   ├── CopyButton.tsx    The one button that matters
│   └── Katex.tsx         Local KaTeX bindings (~40 lines, no react-katex)
├── lib/
│   ├── cleaner.ts        The engine: tokenizer, rules, re-emission
│   ├── highlight.ts      ~40-line LaTeX highlighter for the output pane
│   ├── optionsStore.ts   Preferences, as an external store over localStorage
│   ├── katexOptions.ts   One KaTeX config, shared by the preview and the tests
│   └── defaultText.ts    Sample messy inputs
└── app/
    └── page.tsx          The single page
```

## Development

```bash
npm run verify     # lint + typecheck + engine tests + production build
npm test           # engine conformance + KaTeX render checks
npm run examples   # regenerate examples/ from the engine
```

`npm test` runs 31 checks, including the ones that exist purely to keep the
`\text{}` pass from getting greedy: `(y_i - f(x_i))^2` must never become text.

## Privacy

There is no backend. No route handlers, no server actions, no analytics, no
telemetry. Your text is parsed by JavaScript in your tab and never leaves it - the
only thing stored anywhere is your toggle preferences, in `localStorage`.

Verify it yourself: the build output is `○ (Static) prerendered as static
content`, and `src/` contains no `fetch` of any kind.

## Roadmap

- [ ] Shareable permalinks that encode the input in the URL fragment (still no server)
- [ ] A `cleanmath` CLI sharing the same engine, for piping files
- [ ] Table conversion: markdown tables to `tabular`
- [ ] More target presets: Typst, MathJax v2, Quarto
- [ ] Browser extension: clean on copy, straight from the chat window

## Contributing

Issues and PRs welcome - see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).
A new cleanup rule needs a test that fails without it **and** a test pinning down
where it must not fire; the second one matters more.

## License

[MIT](LICENSE)
