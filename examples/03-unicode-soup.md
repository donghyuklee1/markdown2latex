# Unicode + matrices

> Matrix rows missing their row breaks

## Input

```markdown
The gradient satisfies $\nabla f(x) \ne 0$ whenever $x \in \Omega$.

Convergence requires:
$$
\|x_{k+1} - x^*\| \le \rho \cdot \|x_k - x^*\|, \quad 0 < \rho < 1
$$

Matrix form:
$$
\begin{pmatrix}
a & b
c & d
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
=
\begin{pmatrix} e \\ f \end{pmatrix}
$$
```

## Output - Standard mode

`$ inline, $$ display - Obsidian, Notion, GitHub`

```latex
The gradient satisfies $\nabla f(x) \ne 0$ whenever $x \in \Omega$.

Convergence requires:
$$
\|x_{k+1} - x^*\| \le \rho \cdot \|x_k - x^*\|, \quad 0 < \rho < 1
$$

Matrix form:
\begin{pmatrix}
a & b \\
c & d \\
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
= \\
\begin{pmatrix} e \\ f
\end{pmatrix}
```

_4 math block(s) normalized, no issues._

## Output - Academic mode

`\begin{equation*} / \begin{align*} - Overleaf, paper drafts`

```latex
The gradient satisfies $\nabla f(x) \ne 0$ whenever $x \in \Omega$.

Convergence requires:
\begin{equation*}
\|x_{k+1} - x^*\| \le \rho \cdot \|x_k - x^*\|, \quad 0 < \rho < 1
\end{equation*}

Matrix form:
\begin{pmatrix}
a & b \\
c & d \\
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
= \\
\begin{pmatrix} e \\ f
\end{pmatrix}
```

_4 math block(s) normalized, no issues._

## Output - Inline-only mode

`Everything collapses to $ ... $ - chat, commit messages`

```latex
The gradient satisfies $\nabla f(x) \ne 0$ whenever $x \in \Omega$.

Convergence requires:
$\|x_{k+1} - x^*\| \le \rho \cdot \|x_k - x^*\|, \quad 0 < \rho < 1$

Matrix form:
\begin{pmatrix}
a & b \\
c & d \\
\end{pmatrix}
\begin{pmatrix} x \\ y \end{pmatrix}
= \\
\begin{pmatrix} e \\ f
\end{pmatrix}
```

_4 math block(s) normalized, no issues._
