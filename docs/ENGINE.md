# The cleanup engine

All of it lives in [`src/lib/cleaner.ts`](../src/lib/cleaner.ts): one pure,
synchronous, dependency-free module. No DOM, no React, no I/O. That constraint is
what lets the same code run on every keystroke in the browser and under plain
node in CI.

```
normalizeUnicode  ->  tokenize  ->  per-block cleanup  ->  re-emit  ->  tidy
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../static/readme/pipeline-dark.svg">
  <img alt="CleanMath pipeline: messy LLM text is normalized, tokenized into prose and math, each math block is cleaned and re-emitted, producing compilation-ready LaTeX." src="../static/readme/pipeline-light.svg" width="100%">
</picture>

## 1. normalizeUnicode

Document-wide, before anything is parsed:

- CRLF and CR collapse to LF.
- Invisible codepoints are deleted: zero-width space / non-joiner / joiner, word
  joiner, BOM, soft hyphen, Mongolian vowel separator, Arabic letter mark, and
  the invisible math operators (`U+2061`-`U+2064`).
- Exotic spaces (NBSP, en/em spaces, ideographic space) become a plain space.
- Smart quotes and ellipses become their ASCII equivalents.

These are the characters that make a copy-pasted equation fail to compile with an
error message pointing at nothing visible.

## 2. tokenize

A hand-written scanner, not a regex chain. It walks the string once and emits
`text`, `inline` and `display` tokens. It recognises:

| Opener | Closer | Result |
| --- | --- | --- |
| `\[` | `\]` | display |
| `\(` | `\)` | inline |
| `$$` | `$$` | display |
| `$` | `$` | inline |
| `\begin{env}` | `\end{env}` | display, `env` recorded |

Why a scanner:

- **Escapes.** `\$5` is a price, not a delimiter. `\\]` is a row break followed by
  a bracket, not the end of a display block. A scanner that skips escape pairs
  gets these right; a regex alternation does not.
- **Nesting.** `\begin{align}` inside `\begin{align}` is matched by depth
  counting.
- **Code.** Fenced blocks and inline backticks pass through untouched, so a
  markdown answer that *documents* LaTeX is not rewritten.

### The safety net

An unterminated delimiter never throws and never swallows the rest of the
document. The opener degrades to literal text, an `Issue { line, severity,
message }` is recorded, and scanning continues. The UI paints that line red in
both the gutter and the editor body, and the preview keeps rendering everything
else - which is what you want while you are still typing.

One extra guard: a `$ ... $` span containing a blank line is treated as unclosed.
Without it, a single stray `$` would consume the remainder of the document.

## 3. Per-block cleanup

Applied to math payloads only, so prose keeps its own typography:

- **Unicode math to commands.** `<=` becomes `\leq`, Greek letters become
  `\alpha`, `ℝ` becomes `\mathbb{R}`, and so on - about 110 glyphs. The table is
  keyed by hex codepoint. Runs of super/subscript glyphs become one group
  (`x²³` -> `x^{23}`, never the double-superscript `x^{2}^{3}`), and `√` carries
  its operand into braces (`√(x+1)` -> `\sqrt{x+1}`).
- **Escape repair.** `\\frac` from a JSON-escaped string becomes `\frac` - only
  for a list of known commands, and never when the pair is itself preceded by a
  backslash, so a real row break before `\text` survives. Markdown's `x\_1`
  becomes `x_1` outside `\text{}`. Python's `x**2` becomes `x^{2}` when the
  exponent is one clear atom, a `{...}` group or a `(...)` group.
- **`\text{}` auto-escaping** (toggle). Prose inside math is wrapped so it
  typesets as words rather than a product of variables.

The `\text{}` pass is the one place where a bug silently changes the user's
mathematics, so it is deliberately conservative. LaTeX commands and existing
`\text{...}` bodies are masked behind `NUL` placeholders first, so a command name
is never mistaken for an English word. Then only two things are wrapped:

- A parenthesised group that is *all* letters, digits, spaces and light
  punctuation, **and** contains either Hangul or two consecutive words of 2+
  letters. `(some raw text here)` qualifies. `(y_i - f(x_i))^2`, `(a + b)` and
  `(n)` do not.
- A run of two or more consecutive plain words, or a run of Hangul.

A single symbol is never wrapped. Neither is anything containing an operator, nor
a run made only of differentials (`dx dy`).
When in doubt the pass does nothing, because leaving `(n)` alone costs the user a
keystroke while wrapping `(a + b)` costs them a wrong equation.

### Smart spacing (toggle)

TeX ignores spaces in math mode, so the author's spacing intent is lost unless it
is written as LaTeX. This pass recognises four cases:

- **Differentials.** In a block containing `\int`, `\iint`, `\iiint` or `\oint`, a
  `d` plus one variable (or a Greek command) gets a thin space: `f(x) dx` ->
  `f(x)\,dx`, `dx dy` -> `\,dx\,dy`. It needs a space after an operand, or a
  closing bracket or digit right before it, so `\frac{dy}{dx}` and `add` never
  qualify, and an existing `\,dx` is left alone.
- **Function names.** Bare `sin`, `log`, `max`, ... become `\sin`, `\log`,
  `\max`, which TeX sets upright with operator spacing. Not inside a longer word
  (`argmax`), not after a script marker (`x_{max}` is a label) and not inside
  `\mathrm{}` or `\text{}`.
- **`\text{}` edges.** `x \text{if} y` renders as "xify". Where the group touches
  an operand, a space goes inside it: `x \text{ if } y`. Next to a relation or
  `\quad` nothing is added - the spacing is already there.
- **Operator tidy.** Source spacing around binary `+ - = < >` becomes exactly one
  space. A small per-line tokenizer tracks braces, so `x_{i+1}` and `e^{-x}` are
  untouched, `-` after a non-operand stays a unary sign (`= -1`, `(-1)`), opaque
  arguments (`\label{a-b}`, `\text{well-known}`) are never entered, and
  compound operators (`<=`, `:=`, `->`) stay glued. `&=` keeps its anchor
  attached. This one only changes how the LaTeX reads, not how it renders.

## 4. Re-emission

`detectEnvWrapper` first checks whether a display block is *exactly* one
`\begin{...}...\end{...}` - by depth-matching the first `\begin`, so
`\begin{pmatrix}..\end{pmatrix} = \begin{pmatrix}..\end{pmatrix}` is correctly
seen as three things. If the environment is display math itself (`align`,
`equation`, `gather`, `multline`, ...), the outer `$$` or `\[` is dropped.
Nesting a display delimiter around an `align` is the most common compile error in
LLM output, and it is the one fix most worth having.

Environments that only work *inside* math mode - `pmatrix`, `cases`, `aligned`,
`array` - keep their delimiters. Stripping those is the opposite compile error.

Numbered environments are starred (`align` -> `align*`, `equation` ->
`equation*`), because a snippet pasted into the middle of a paper should not
silently renumber the author's own equations.

### Row repair (toggle)

Inside row-based environments:

- Matrices and other row environments nested inside a larger display block are
  repaired too.
- Every row but the last gets a `\\` terminator, unless it already ends in one,
  in an `&`, in an open brace, or in a structural command.
- In align-like environments only, a row with no `&` gets one inserted before its
  first top-level `=`. Depth counting keeps it out of `{...}` groups, and
  `<=`, `>=`, `!=`, `:=` and `==` are skipped. Rows whose relation is `\le` or
  `\ge` are left alone rather than guessed at.

### Delimiter modes

| Mode | Plain display block | Inline | Existing environment |
| --- | --- | --- | --- |
| Standard | `$$ ... $$` | `$ ... $` | kept bare, starred |
| Academic | `\begin{equation*}`, or `\begin{align*}` when the block has rows | `$ ... $` | kept bare, starred |
| Inline-only | collapsed to `$ ... $` | `$ ... $` | kept bare, starred |

Academic mode never wraps multi-row content in `equation*`, which holds exactly
one row - it promotes it to `align*` instead.

## 5. Tidy

Trailing whitespace is stripped per line, runs of 3+ blank lines collapse to one,
and the document is trimmed.

## Invariants

Two properties are enforced by [`tests/cleaner.spec.ts`](../tests/cleaner.spec.ts)
and must not be weakened:

1. **Idempotence.** `cleanMath(cleanMath(x)) === cleanMath(x)`. Clean output is a
   fixed point.
2. **Every output parses.** All bundled examples, in all three delimiter modes,
   are rendered through KaTeX with `throwOnError: true`.

## The preview path

`segment()` reuses the same tokenizer on the *cleaned* output, so the preview
shows what the clipboard will contain rather than a separate interpretation.

`prepareForKatex()` bridges the gap between amsmath and KaTeX's subset: it unwraps
`equation*` / `displaymath` (which KaTeX has no environment for), maps `multline`
to `gather*` and `flalign` / `eqnarray` / `alignat` to `align*`, and strips
`\label` and `\nonumber`. Without it a perfectly valid Overleaf snippet would
render as a red error box and read as a CleanMath bug.

A block KaTeX still cannot parse renders as an inline red chip with the parse
error in its tooltip, and the rest of the document keeps rendering.
