# Spacing + escapes

> Bare sin, dx with no thin space, glued \text{}, x**2 and JSON-escaped \\frac

## Input

```markdown
The Gaussian integral, as a chatbot typed it:
$$
\int_{-\infty}^{\infty} e^{-x**2} dx=√π
$$
Pythagoras holds for all $x∈ℝ$: $sin(x)²+cos(x)²=1$.

A piecewise definition pasted from JSON:
$$
f(x) = \\frac{1}{x} \text{if} x>0, \quad x\_0=1
$$
```

## Output - Standard mode

`$ inline, $$ display - Obsidian, Notion, GitHub`

```latex
The Gaussian integral, as a chatbot typed it:
$$
\int_{-\infty}^{\infty} e^{-x^{2}}\,dx = \sqrt{\pi}
$$
Pythagoras holds for all $x\in \mathbb{R}$: $\sin(x)^{2} + \cos(x)^{2} = 1$.

A piecewise definition pasted from JSON:
$$
f(x) = \frac{1}{x} \text{ if } x > 0, \quad x_0 = 1
$$
```

_4 math block(s) normalized, no issues._

## Output - Academic mode

`\begin{equation*} / \begin{align*} - Overleaf, paper drafts`

```latex
The Gaussian integral, as a chatbot typed it:
\begin{equation*}
\int_{-\infty}^{\infty} e^{-x^{2}}\,dx = \sqrt{\pi}
\end{equation*}
Pythagoras holds for all $x\in \mathbb{R}$: $\sin(x)^{2} + \cos(x)^{2} = 1$.

A piecewise definition pasted from JSON:
\begin{equation*}
f(x) = \frac{1}{x} \text{ if } x > 0, \quad x_0 = 1
\end{equation*}
```

_4 math block(s) normalized, no issues._

## Output - Inline-only mode

`Everything collapses to $ ... $ - chat, commit messages`

```latex
The Gaussian integral, as a chatbot typed it:
$\int_{-\infty}^{\infty} e^{-x^{2}}\,dx = \sqrt{\pi}$
Pythagoras holds for all $x\in \mathbb{R}$: $\sin(x)^{2} + \cos(x)^{2} = 1$.

A piecewise definition pasted from JSON:
$f(x) = \frac{1}{x} \text{ if } x > 0, \quad x_0 = 1$
```

_4 math block(s) normalized, no issues._
