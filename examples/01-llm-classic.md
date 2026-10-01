# Classic LLM answer

> Mixed delimiters, a redundant $$ around align, a missing row break

## Input

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

## Output - Standard mode

`$ inline, $$ display - Obsidian, Notion, GitHub`

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

_3 math block(s) normalized, no issues._

## Output - Academic mode

`\begin{equation*} / \begin{align*} - Overleaf, paper drafts`

```latex
Here is the equation for the loss function:
\begin{equation*}
L(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f(x_i))^2
\end{equation*}
Also, for alignment:
\begin{align*}
a &= b + c \\
d &= e + f \text{ (some raw text here)}
\end{align*}
And inline math like $E = mc^2$.
```

_3 math block(s) normalized, no issues._

## Output - Inline-only mode

`Everything collapses to $ ... $ - chat, commit messages`

```latex
Here is the equation for the loss function:
$L(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f(x_i))^2$
Also, for alignment:
\begin{align*}
a &= b + c \\
d &= e + f \text{ (some raw text here)}
\end{align*}
And inline math like $E = mc^2$.
```

_3 math block(s) normalized, no issues._
