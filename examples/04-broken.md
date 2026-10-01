# Truncated answer

> Unclosed $$ and \( - see the safety net catch them

## Input

```markdown
This answer got truncated mid-derivation.

The variance decomposes as $$
\mathrm{Var}(y) = \mathbb{E}[(y - \bar{y})^2]

and the bias term is \( b = \mathbb{E}[\hat{\theta}] - \theta

which should have closed properly.
```

## Output - Standard mode

`$ inline, $$ display - Obsidian, Notion, GitHub`

```latex
This answer got truncated mid-derivation.

The variance decomposes as $$
\mathrm{Var}(y) = \mathbb{E}[(y - \bar{y})^2]

and the bias term is \( b = \mathbb{E}[\hat{\theta}] - \theta

which should have closed properly.
```

_0 math block(s) normalized, 2 issue(s) reported: line 3, line 6._

## Output - Academic mode

`\begin{equation*} / \begin{align*} - Overleaf, paper drafts`

```latex
This answer got truncated mid-derivation.

The variance decomposes as $$
\mathrm{Var}(y) = \mathbb{E}[(y - \bar{y})^2]

and the bias term is \( b = \mathbb{E}[\hat{\theta}] - \theta

which should have closed properly.
```

_0 math block(s) normalized, 2 issue(s) reported: line 3, line 6._

## Output - Inline-only mode

`Everything collapses to $ ... $ - chat, commit messages`

```latex
This answer got truncated mid-derivation.

The variance decomposes as $$
\mathrm{Var}(y) = \mathbb{E}[(y - \bar{y})^2]

and the bias term is \( b = \mathbb{E}[\hat{\theta}] - \theta

which should have closed properly.
```

_0 math block(s) normalized, 2 issue(s) reported: line 3, line 6._
