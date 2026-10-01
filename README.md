<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="static/logo-dark.png">
  <img alt="markdown2Latex" src="static/logo-light.png" width="320">
</picture>

### Paste messy LLM math. Get LaTeX that compiles on the first try.

<a href="https://github.com/donghyuklee1/markdown2latex/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/donghyuklee1/markdown2latex/ci.yml?branch=main&label=CI&style=flat-square" alt="CI status"></a>
<a href="LICENSE"><img src="https://img.shields.io/github/license/donghyuklee1/markdown2latex?style=flat-square&color=ff751f" alt="MIT license"></a>
<a href="package.json"><img src="https://img.shields.io/badge/Next.js-16-000?style=flat-square&logo=nextdotjs" alt="Next.js 16"></a>
<a href="https://github.com/sponsors/donghyuklee1"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-Sponsor-ff751f?style=flat-square&logo=githubsponsors&logoColor=white" alt="Buy me a coffee on GitHub Sponsors"></a>

<a href="#quickstart"><b>Quickstart</b></a>
&nbsp;&middot;&nbsp;
<a href="#what-it-fixes"><b>What it fixes</b></a>
&nbsp;&middot;&nbsp;
<a href="#keyboard-shortcuts"><b>Shortcuts</b></a>
&nbsp;&middot;&nbsp;
<a href="examples/"><b>Examples</b></a>
&nbsp;&middot;&nbsp;
<a href="docs/ENGINE.md"><b>How it works</b></a>

<br/>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="static/readme/screenshot-dark.png">
  <img alt="The markdown2Latex workspace: messy LLM output on the left, clean LaTeX on the right, with delimiter modes and cleanup toggles above." src="static/readme/screenshot-light.png" width="100%">
</picture>

</div>

<br/>

ChatGPT, Claude and DeepSeek all write LaTeX, and all of them write it slightly
wrong: `\[...\]` where your editor wants `$$`, an `align` block uselessly wrapped
in `$$`, a missing `\\` at the end of a row, prose sitting bare inside the maths,
`\int f(x) dx` with no thin space, and a zero-width space you cannot see but
`pdflatex` can.

CleanMath fixes all of that in one paste, live, as you type - entirely in your
browser.

<table>
<tr>
<th width="50%">Pasted from an LLM</th>
<th width="50%">What you copy out</th>
</tr>
<tr>
<td valign="top">

```latex
Here is the loss:
\[
L(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f(x_i))^2
\]
For alignment:
$$
\begin{align}
a = b + c \\
d = e + f (some raw text here)
\end{align}
$$
And \( \int_0^1 sin x dx \).
```

</td>
<td valign="top">

```latex
Here is the loss:
$$
L(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f(x_i))^2
$$
For alignment:
\begin{align*}
a &= b + c \\
d &= e + f \text{ (some raw text here)}
\end{align*}
And $\int_0^1 \sin x\,dx$.
```

</td>
</tr>
</table>

The `$$` around the `align` is **gone** (a hard Overleaf error), the `align` is
**starred** so it will not renumber your paper, the rows grew their missing `&`
and `\text{}`, `sin` became an upright `\sin`, and the integral got its `\,dx`.
More before/after pairs, in all three delimiter modes: [`examples/`](examples/).

## Quickstart

```bash
git clone https://github.com/donghyuklee1/markdown2latex.git
cd markdown2latex
npm install
npm run dev        # http://localhost:3000
```

Node 20.9+ (22 recommended). The editor opens pre-filled with a messy LLM
answer, so you can see what it does before typing anything.

## What it fixes

<table>
<tr><th>Area</th><th>In the LLM's output</th><th>What you get</th></tr>
<tr><td rowspan="3"><b>Delimiters</b></td>
  <td><code>\[ ... \]</code>, <code>\( ... \)</code></td><td>Your chosen style: <code>$$</code> / <code>$</code>, <code>equation*</code> / <code>align*</code>, or inline-only</td></tr>
<tr><td><code>$$</code> wrapped around an <code>align</code> / <code>equation</code></td><td>Outer delimiter removed. <code>pmatrix</code>, <code>cases</code>, <code>aligned</code> keep theirs - they need math mode</td></tr>
<tr><td>An unclosed <code>$</code> or <code>$$</code></td><td>Reported on the exact line; the preview keeps rendering</td></tr>
<tr><td rowspan="3"><b>Environments</b></td>
  <td><code>\begin{align}</code> numbering your paper</td><td>Starred to <code>align*</code></td></tr>
<tr><td>Rows missing their <code>\\</code></td><td>Added to every row but the last, nested matrices included</td></tr>
<tr><td>Align rows missing their <code>&amp;</code></td><td>Inserted before the first top-level <code>=</code></td></tr>
<tr><td rowspan="3"><b>Characters</b></td>
  <td>Zero-width spaces, NBSP, smart quotes</td><td>Removed or replaced</td></tr>
<tr><td>Unicode <code>≤</code>, <code>α</code>, <code>ℝ</code>, <code>x²</code>, <code>a₁₂</code>, <code>√(x+1)</code></td><td><code>\leq</code>, <code>\alpha</code>, <code>\mathbb{R}</code>, <code>x^{2}</code>, <code>a_{12}</code>, <code>\sqrt{x+1}</code> - about 110 glyphs</td></tr>
<tr><td>JSON <code>\\frac</code>, markdown <code>x\_1</code>, Python <code>x**2</code></td><td><code>\frac</code>, <code>x_1</code>, <code>x^{2}</code></td></tr>
<tr><td><b>Prose</b></td>
  <td>Words sitting bare inside math</td><td>Wrapped in <code>\text{...}</code>, Hangul included</td></tr>
<tr><td rowspan="4"><b>Spacing</b><br/><sub>Smart spacing toggle</sub></td>
  <td><code>\int f(x) dx</code></td><td><code>\int f(x)\,dx</code></td></tr>
<tr><td>Bare <code>sin x</code>, <code>log n</code>, <code>max</code></td><td>Upright <code>\sin x</code>, <code>\log n</code>, <code>\max</code></td></tr>
<tr><td><code>x \text{if} y</code>, rendering as "xify"</td><td><code>x \text{ if } y</code></td></tr>
<tr><td><code>a+  b=c</code></td><td><code>a + b = c</code> - unary minus, scripts and labels untouched</td></tr>
</table>

Every rule is conservative by design: each one has a test where it must fire
**and** a test where it must not. `(y_i - f(x_i))^2` will never become text.

## The workspace

- **Live** - the output updates on every keystroke, as code or as a rendered
  KaTeX preview with your choice of equation colour.
- **Resizable** - drag the divider between the panes (or focus it and use the
  arrow keys; double-click resets). On a phone, drag the grip under the editor.
  Maximise either pane, change the text size, toggle word wrap.
- **Nothing gets lost** - your draft, layout and settings are saved in this
  browser. Clear, paste, open and examples all come with an **Undo**.
- **Files in, files out** - drop a `.md`, `.tex` or `.txt` file on the editor, or
  download the result as `.md` / `.tex`.
- **Share links** - one click copies a link that opens your input. It is
  compressed into the URL after `#`, which browsers never send to a server.
- **Clean clipboard** - paste, clean and copy back in a single click (`Alt+V`),
  without touching the editor.
- **Themes** - light and dark, plus a palette editor with an eyedropper.

## Keyboard shortcuts

| Shortcut | Action | | Shortcut | Action |
| --- | --- | --- | --- | --- |
| `⌘/Ctrl` `Enter` | Copy clean LaTeX | | `Alt` `P` | Code / live preview |
| `⌘/Ctrl` `S` | Download as a file | | `Alt` `[` / `]` | Maximise input / output |
| `Alt` `L` | Copy a share link | | `Alt` `W` | Word wrap |
| `Alt` `V` | Clean the clipboard | | `Alt` `=` / `-` / `0` | Text size |
| `Alt` `1` / `2` / `3` | Standard / Academic / Inline | | `Alt` `T` | Light / dark |
| `Tab` / `Shift` `Tab` | Indent / outdent in the editor | | `?` | All shortcuts |

`Alt` is `⌥ Option` on a Mac.

## Delimiter modes

| Mode | Display math | Use it for |
| --- | --- | --- |
| **Standard** | `$$ ... $$` | Obsidian, Notion, GitHub, most markdown |
| **Academic** | `\begin{equation*}` / `\begin{align*}` | Overleaf, paper drafts |
| **Inline-only** | collapsed to `$ ... $` | Chat, code comments, commit messages |

Display environments you already wrote (`align`, `equation`, `gather`, ...) stay
bare in every mode - wrapping them is what broke the snippet in the first place.

## Deploying as a website

The whole app prerenders to static pages - the page itself, `robots.txt`,
`sitemap.xml`, the install manifest and the social preview image - so it can go
anywhere that serves Next.js.

```bash
NEXT_PUBLIC_SITE_URL=https://your.domain npm run build && npm start
```

`NEXT_PUBLIC_SITE_URL` is the one setting: canonical links, the sitemap and
link previews all derive from it ([`src/lib/site.ts`](src/lib/site.ts)). On Vercel,
set it as an environment variable and import the repo. For anything else there is
a Dockerfile:

```bash
docker build -t markdown2latex . && docker run -p 3000:3000 markdown2latex
```

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="static/readme/pipeline-dark.svg">
  <img alt="Pipeline: messy LLM text is normalized, tokenized into prose and math, each math block is cleaned and re-emitted, producing compilation-ready LaTeX." src="static/readme/pipeline-light.svg" width="100%">
</picture>

The engine is a hand-written scanner rather than a pile of regexes, because the
hard cases are all about context: `\$5` is a price, `\\]` is a row break followed
by a bracket, and a fenced code block that *documents* LaTeX must not be rewritten
at all. It is pure and synchronous, so it runs on every keystroke with no
debounce. Two invariants are enforced in CI:

- **Idempotence** - cleaning clean output changes nothing, for every example in
  every mode.
- **Everything parses** - every example, in all three modes, renders through
  KaTeX with `throwOnError: true`.

Full write-up: [`docs/ENGINE.md`](docs/ENGINE.md).

<details>
<summary><b>Project layout</b></summary>

```
src/
├── app/
│   ├── page.tsx              The single page
│   ├── layout.tsx            Metadata, theme bootstrap
│   └── manifest.ts, robots.ts, sitemap.ts, opengraph-image.tsx
├── components/
│   ├── Workspace.tsx         State, layout, shortcuts, clipboard, share, download
│   ├── ControlBar.tsx        Delimiter mode, cleanup toggles, text size
│   ├── MathInput.tsx         Editor: gutter, error lines, drop, indent, examples
│   ├── MathOutput.tsx        Clean-code and live-preview tabs
│   ├── Splitter.tsx          Pointer + keyboard resize handle
│   ├── ShortcutsDialog.tsx   The `?` panel
│   ├── Header.tsx, ThemeToggle.tsx, PalettePicker.tsx, MathColorPicker.tsx
│   └── CopyButton.tsx, Toast.tsx, Katex.tsx, ui.tsx
└── lib/
    ├── cleaner.ts            The engine: tokenizer, rules, re-emission
    ├── shortcuts.ts          One table for key handling and the help panel
    ├── share.ts              URL-fragment share links (deflate + base64url)
    ├── persistedStore.ts     Draft and layout, as external stores
    ├── optionsStore.ts, theme.ts, site.ts
    └── highlight.ts, katexOptions.ts, defaultText.ts
```

</details>

## Development

```bash
npm run verify     # lint + typecheck + tests + production build - run before pushing
npm test           # 58 checks: engine rules, KaTeX rendering, share links, shortcuts
npm run examples   # regenerate examples/ (CI fails if it is stale)
npm run logos      # rebuild the logo PNGs from static/logo-source.png
```

## Privacy

There is no backend: no route handlers, no server actions, no analytics, no
`fetch`. Your text is parsed in your tab and stored only in your browser's
`localStorage`. Share links carry the text in the URL fragment, which is never
sent in a request.

## Roadmap

- [x] Shareable links that encode the input in the URL fragment
- [ ] A `cleanmath` CLI sharing the same engine, for piping files
- [ ] Table conversion: markdown tables to `tabular`
- [ ] More target presets: Typst, MathJax v2, Quarto
- [ ] Browser extension: clean on copy, straight from the chat window

## Support

If this saves you a round of Overleaf errors, you can
[buy the developer a coffee](https://github.com/sponsors/donghyuklee1) on GitHub
Sponsors. Stars help too.

## Contributing

Issues and PRs welcome - see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).
A new cleanup rule needs a test that fails without it **and** a test pinning down
where it must not fire; the second one matters more.

## License

[MIT](LICENSE)
