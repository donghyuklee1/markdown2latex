/**
 * defaultText.ts - sample payloads so the tool proves itself before the user
 * types anything. The first entry pre-fills the input on first visit.
 */

/** Zero-width space, injected at runtime so this file stays ASCII-clean. */
const ZWSP = String.fromCharCode(0x200b);
/** Non-breaking space - the other invisible that LLM copy-paste leaves behind. */
const NBSP = String.fromCharCode(0x00a0);

export interface Example {
  id: string;
  label: string;
  /** One-liner shown in the example picker. */
  blurb: string;
  text: string;
}

/**
 * The canonical messy LLM answer: `\[...\]` display math, an `align` wrapped in
 * a redundant `$$`, a missing `\\` row ending, raw prose inside the maths, and
 * `\(...\)` inline delimiters.
 */
const LLM_CLASSIC = String.raw`Here is the equation for the loss function:
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
And inline math like \( E = mc^2 \).`;

const KOREAN_NOTES = String.raw`정규분포의 확률밀도함수는 다음과 같습니다:
\[
p(x) = \frac{1}{\sqrt{2${ZWSP}\pi\sigma^2}} \exp\left(-\frac{(x-\mu)^2}{2\sigma^2}\right)
\]
여기서 \( \mu \) 는 평균, \(\sigma\) 는 표준편차입니다.

교차 엔트로피 손실:
$$
\begin{align}
\mathcal{L} = -\sum_{i} y_i \log \hat{y}_i (교차 엔트로피)
\mathcal{L}_{reg} = \mathcal{L} + \lambda \|w\|^2 (가중치 감쇠 포함)
\end{align}
$$
조건: \( \alpha${NBSP}\le \beta \) 이고 \(0 < \theta \le \pi\).`;

const UNICODE_SOUP = String.raw`The gradient satisfies $\nabla f(x) \ne 0$ whenever $x \in \Omega$.

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
$$`;

const BROKEN = String.raw`This answer got truncated mid-derivation.

The variance decomposes as $$
\mathrm{Var}(y) = \mathbb{E}[(y - \bar{y})^2]

and the bias term is \( b = \mathbb{E}[\hat{\theta}] - \theta

which should have closed properly.`;

export const EXAMPLES: ReadonlyArray<Example> = [
  {
    id: "llm-classic",
    label: "Classic LLM answer",
    blurb: "Mixed delimiters, a redundant $$ around align, a missing row break",
    text: LLM_CLASSIC,
  },
  {
    id: "korean-notes",
    label: "Korean study notes",
    blurb: "Hangul prose inside math blocks, plus smuggled zero-width spaces",
    text: KOREAN_NOTES,
  },
  {
    id: "unicode-soup",
    label: "Unicode + matrices",
    blurb: "Matrix rows missing their row breaks",
    text: UNICODE_SOUP,
  },
  {
    id: "broken",
    label: "Truncated answer",
    blurb: "Unclosed $$ and \\( - see the safety net catch them",
    text: BROKEN,
  },
];

export const DEFAULT_TEXT = EXAMPLES[0].text;
