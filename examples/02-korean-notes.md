# Korean study notes

> Hangul prose inside math blocks, plus smuggled zero-width spaces

## Input

```markdown
정규분포의 확률밀도함수는 다음과 같습니다:
\[
p(x) = \frac{1}{\sqrt{2​\pi\sigma^2}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
\]
여기서 \( \mu \) 는 평균, \(\sigma\) 는 표준편차입니다.

교차 엔트로피 손실:
$$
\begin{align}
\mathcal{L} = -\sum_{i} y_i \log \hat{y}_i (교차 엔트로피)
\mathcal{L}_{reg} = \mathcal{L} + \lambda \|w\|^2 (가중치 감쇠 포함)
\end{align}
$$
조건: \( \alpha \le \beta \) 이고 \(0 < \theta \le \pi\).
```

## Output - Standard mode

`$ inline, $$ display - Obsidian, Notion, GitHub`

```latex
정규분포의 확률밀도함수는 다음과 같습니다:
$$
p(x) = \frac{1}{\sqrt{2\pi\sigma^2}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
$$
여기서 $\mu$ 는 평균, $\sigma$ 는 표준편차입니다.

교차 엔트로피 손실:
\begin{align*}
\mathcal{L} &= -\sum_{i} y_i \log \hat{y}_i \text{ (교차 엔트로피)} \\
\mathcal{L}_{reg} &= \mathcal{L} + \lambda \|w\|^2 \text{ (가중치 감쇠 포함)}
\end{align*}
조건: $\alpha \le \beta$ 이고 $0 < \theta \le \pi$.
```

_6 math block(s) normalized, no issues._

## Output - Academic mode

`\begin{equation*} / \begin{align*} - Overleaf, paper drafts`

```latex
정규분포의 확률밀도함수는 다음과 같습니다:
\begin{equation*}
p(x) = \frac{1}{\sqrt{2\pi\sigma^2}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
\end{equation*}
여기서 $\mu$ 는 평균, $\sigma$ 는 표준편차입니다.

교차 엔트로피 손실:
\begin{align*}
\mathcal{L} &= -\sum_{i} y_i \log \hat{y}_i \text{ (교차 엔트로피)} \\
\mathcal{L}_{reg} &= \mathcal{L} + \lambda \|w\|^2 \text{ (가중치 감쇠 포함)}
\end{align*}
조건: $\alpha \le \beta$ 이고 $0 < \theta \le \pi$.
```

_6 math block(s) normalized, no issues._

## Output - Inline-only mode

`Everything collapses to $ ... $ - chat, commit messages`

```latex
정규분포의 확률밀도함수는 다음과 같습니다:
$p(x) = \frac{1}{\sqrt{2\pi\sigma^2}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)$
여기서 $\mu$ 는 평균, $\sigma$ 는 표준편차입니다.

교차 엔트로피 손실:
\begin{align*}
\mathcal{L} &= -\sum_{i} y_i \log \hat{y}_i \text{ (교차 엔트로피)} \\
\mathcal{L}_{reg} &= \mathcal{L} + \lambda \|w\|^2 \text{ (가중치 감쇠 포함)}
\end{align*}
조건: $\alpha \le \beta$ 이고 $0 < \theta \le \pi$.
```

_6 math block(s) normalized, no issues._
