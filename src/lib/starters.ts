/**
 * starters.ts - the built-in snippet library, by category.
 *
 * Every entry must render in KaTeX on its own (tests/starters.spec.ts checks
 * all of them), so a typo here can never reach the palette. ASCII only, like
 * the rest of src/lib.
 */

export interface Starter {
  id: string;
  name: string;
  latex: string;
}

export interface StarterCategory {
  id: string;
  label: string;
  items: Starter[];
}

/** Compact authoring form: [name, latex]; ids are derived. */
type Raw = ReadonlyArray<readonly [string, string]>;

const cat = (id: string, label: string, raw: Raw): StarterCategory => ({
  id,
  label,
  items: raw.map(([name, latex], i) => ({ id: "s-" + id + "-" + i, name, latex })),
});

export const STARTER_CATEGORIES: ReadonlyArray<StarterCategory> = [
  cat("structure", "Structure", [
    ["Aligned derivation", String.raw`\begin{aligned}
  f(x) &= (x + 1)^2 \\
       &= x^2 + 2x + 1
\end{aligned}`],
    ["Piecewise (cases)", String.raw`f(x) = \begin{cases}
  x^2 & \text{if } x \ge 0 \\
  -x & \text{otherwise}
\end{cases}`],
    ["2x2 matrix", String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}`],
    ["3x3 matrix", String.raw`\begin{pmatrix} a_{11} & a_{12} & a_{13} \\ a_{21} & a_{22} & a_{23} \\ a_{31} & a_{32} & a_{33} \end{pmatrix}`],
    ["General m x n matrix", String.raw`A = \begin{bmatrix} a_{11} & \cdots & a_{1n} \\ \vdots & \ddots & \vdots \\ a_{m1} & \cdots & a_{mn} \end{bmatrix}`],
    ["Determinant bars", String.raw`\begin{vmatrix} a & b \\ c & d \end{vmatrix} = ad - bc`],
    ["Column vector", String.raw`\mathbf{x} = \begin{bmatrix} x_1 \\ x_2 \\ \vdots \\ x_n \end{bmatrix}`],
    ["Augmented matrix", String.raw`\left[\begin{array}{cc|c} 1 & 2 & 3 \\ 4 & 5 & 6 \end{array}\right]`],
    ["Block matrix", String.raw`M = \begin{bmatrix} A & B \\ C & D \end{bmatrix}`],
    ["Gathered equations", String.raw`\begin{gathered} x + y = 1 \\ x - y = 3 \end{gathered}`],
    ["System of equations", String.raw`\left\{ \begin{aligned} 2x + y &= 5 \\ x - 3y &= -1 \end{aligned} \right.`],
    ["Underbrace annotation", String.raw`\underbrace{a + b + \cdots + z}_{26 \text{ terms}}`],
    ["Overbrace annotation", String.raw`\overbrace{1 + 1 + \cdots + 1}^{n \text{ times}} = n`],
    ["Stacked condition", String.raw`\sum_{\substack{0 \le i \le m \\ 0 < j < n}} P(i, j)`],
    ["Definition by colon-equals", String.raw`f(x) \coloneqq \int_0^x g(t)\,dt`],
    ["Boxed result", String.raw`\boxed{E = mc^2}`],
    ["Tagged equation", String.raw`a^2 + b^2 = c^2 \tag{1}`],
    ["Long division style fraction", String.raw`\cfrac{1}{1 + \cfrac{1}{1 + \cfrac{1}{1 + x}}}`],
  ]),

  cat("calculus", "Calculus", [
    ["Derivative definition", String.raw`f'(x) = \lim_{h \to 0} \frac{f(x + h) - f(x)}{h}`],
    ["Fundamental theorem", String.raw`\int_a^b f'(x)\,dx = f(b) - f(a)`],
    ["Chain rule", String.raw`\frac{d}{dx} f(g(x)) = f'(g(x))\, g'(x)`],
    ["Product rule", String.raw`(fg)' = f'g + fg'`],
    ["Quotient rule", String.raw`\left(\frac{f}{g}\right)' = \frac{f'g - fg'}{g^2}`],
    ["Integration by parts", String.raw`\int u\,dv = uv - \int v\,du`],
    ["Taylor series", String.raw`f(x) = \sum_{n=0}^{\infty} \frac{f^{(n)}(a)}{n!} (x - a)^n`],
    ["Maclaurin of e^x", String.raw`e^x = \sum_{n=0}^{\infty} \frac{x^n}{n!} = 1 + x + \frac{x^2}{2!} + \cdots`],
    ["Partial derivative", String.raw`\frac{\partial f}{\partial x_i}(\mathbf{x})`],
    ["Gradient", String.raw`\nabla f = \left( \frac{\partial f}{\partial x_1}, \dots, \frac{\partial f}{\partial x_n} \right)^\top`],
    ["Hessian", String.raw`\mathbf{H}_{ij} = \frac{\partial^2 f}{\partial x_i \, \partial x_j}`],
    ["Jacobian", String.raw`\mathbf{J} = \begin{bmatrix} \frac{\partial f_1}{\partial x_1} & \cdots & \frac{\partial f_1}{\partial x_n} \\ \vdots & \ddots & \vdots \\ \frac{\partial f_m}{\partial x_1} & \cdots & \frac{\partial f_m}{\partial x_n} \end{bmatrix}`],
    ["Double integral", String.raw`\iint_D f(x, y)\,dA`],
    ["Change of variables", String.raw`\int_{\Omega} f(\mathbf{x})\,d\mathbf{x} = \int_{\Phi^{-1}(\Omega)} f(\Phi(\mathbf{u}))\, \lvert \det J_\Phi(\mathbf{u}) \rvert \, d\mathbf{u}`],
    ["Gaussian integral", String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}`],
    ["Limit definition", String.raw`\forall \varepsilon > 0 \; \exists \delta > 0 : \lvert x - a \rvert < \delta \implies \lvert f(x) - L \rvert < \varepsilon`],
    ["L'Hopital's rule", String.raw`\lim_{x \to a} \frac{f(x)}{g(x)} = \lim_{x \to a} \frac{f'(x)}{g'(x)}`],
    ["Divergence theorem", String.raw`\iiint_V (\nabla \cdot \mathbf{F})\,dV = \oiint_{\partial V} \mathbf{F} \cdot d\mathbf{S}`],
    ["Stokes' theorem", String.raw`\iint_S (\nabla \times \mathbf{F}) \cdot d\mathbf{S} = \oint_{\partial S} \mathbf{F} \cdot d\mathbf{r}`],
    ["Leibniz integral rule", String.raw`\frac{d}{dt} \int_{a}^{b} f(x, t)\,dx = \int_a^b \frac{\partial f}{\partial t}\,dx`],
  ]),

  cat("linalg", "Linear algebra", [
    ["Matrix product", String.raw`(AB)_{ij} = \sum_{k=1}^{n} A_{ik} B_{kj}`],
    ["Inner product", String.raw`\langle \mathbf{x}, \mathbf{y} \rangle = \mathbf{x}^\top \mathbf{y} = \sum_{i=1}^n x_i y_i`],
    ["Euclidean norm", String.raw`\lVert \mathbf{x} \rVert_2 = \sqrt{\sum_{i=1}^n x_i^2}`],
    ["p-norm", String.raw`\lVert \mathbf{x} \rVert_p = \left( \sum_{i=1}^n \lvert x_i \rvert^p \right)^{1/p}`],
    ["Frobenius norm", String.raw`\lVert A \rVert_F = \sqrt{\sum_{i,j} a_{ij}^2} = \sqrt{\operatorname{tr}(A^\top A)}`],
    ["Eigen equation", String.raw`A\mathbf{v} = \lambda \mathbf{v}, \quad \det(A - \lambda I) = 0`],
    ["Eigendecomposition", String.raw`A = Q \Lambda Q^{-1}`],
    ["SVD", String.raw`A = U \Sigma V^\top`],
    ["Inverse of 2x2", String.raw`\begin{bmatrix} a & b \\ c & d \end{bmatrix}^{-1} = \frac{1}{ad - bc} \begin{bmatrix} d & -b \\ -c & a \end{bmatrix}`],
    ["Trace", String.raw`\operatorname{tr}(A) = \sum_{i=1}^n a_{ii} = \sum_{i=1}^n \lambda_i`],
    ["Rank-nullity", String.raw`\operatorname{rank}(A) + \operatorname{nullity}(A) = n`],
    ["Projection matrix", String.raw`P = A (A^\top A)^{-1} A^\top`],
    ["Least squares", String.raw`\hat{\mathbf{x}} = \arg\min_{\mathbf{x}} \lVert A\mathbf{x} - \mathbf{b} \rVert_2^2 = (A^\top A)^{-1} A^\top \mathbf{b}`],
    ["Cauchy-Schwarz", String.raw`\lvert \langle \mathbf{u}, \mathbf{v} \rangle \rvert \le \lVert \mathbf{u} \rVert \, \lVert \mathbf{v} \rVert`],
    ["Kronecker product", String.raw`A \otimes B = \begin{bmatrix} a_{11} B & \cdots & a_{1n} B \\ \vdots & \ddots & \vdots \\ a_{m1} B & \cdots & a_{mn} B \end{bmatrix}`],
    ["Positive definite", String.raw`\mathbf{x}^\top A \mathbf{x} > 0 \quad \forall \mathbf{x} \ne \mathbf{0}`],
    ["Rotation matrix", String.raw`R(\theta) = \begin{bmatrix} \cos\theta & -\sin\theta \\ \sin\theta & \cos\theta \end{bmatrix}`],
    ["Cross product", String.raw`\mathbf{a} \times \mathbf{b} = \begin{vmatrix} \mathbf{i} & \mathbf{j} & \mathbf{k} \\ a_1 & a_2 & a_3 \\ b_1 & b_2 & b_3 \end{vmatrix}`],
  ]),

  cat("probability", "Probability & statistics", [
    ["Bayes' theorem", String.raw`P(A \mid B) = \frac{P(B \mid A)\, P(A)}{P(B)}`],
    ["Law of total probability", String.raw`P(A) = \sum_{i} P(A \mid B_i)\, P(B_i)`],
    ["Expectation", String.raw`\mathbb{E}_{x \sim p(x)}[f(x)] = \int f(x)\, p(x)\,dx`],
    ["Variance", String.raw`\operatorname{Var}(X) = \mathbb{E}\left[(X - \mu)^2\right] = \mathbb{E}[X^2] - \mathbb{E}[X]^2`],
    ["Covariance", String.raw`\operatorname{Cov}(X, Y) = \mathbb{E}\left[(X - \mathbb{E}[X])(Y - \mathbb{E}[Y])\right]`],
    ["Correlation", String.raw`\rho_{XY} = \frac{\operatorname{Cov}(X, Y)}{\sigma_X \sigma_Y}`],
    ["Gaussian density", String.raw`\mathcal{N}(x \mid \mu, \sigma^2) = \frac{1}{\sqrt{2\pi\sigma^2}} \exp\left(-\frac{(x - \mu)^2}{2\sigma^2}\right)`],
    ["Multivariate Gaussian", String.raw`\mathcal{N}(\mathbf{x} \mid \boldsymbol{\mu}, \Sigma) = \frac{1}{(2\pi)^{d/2} \lvert \Sigma \rvert^{1/2}} \exp\left(-\tfrac{1}{2} (\mathbf{x} - \boldsymbol{\mu})^\top \Sigma^{-1} (\mathbf{x} - \boldsymbol{\mu})\right)`],
    ["Binomial", String.raw`P(X = k) = \binom{n}{k} p^k (1 - p)^{n - k}`],
    ["Poisson", String.raw`P(X = k) = \frac{\lambda^k e^{-\lambda}}{k!}`],
    ["Exponential", String.raw`f(x; \lambda) = \lambda e^{-\lambda x}, \quad x \ge 0`],
    ["Beta distribution", String.raw`f(x; \alpha, \beta) = \frac{x^{\alpha - 1} (1 - x)^{\beta - 1}}{B(\alpha, \beta)}`],
    ["Sample mean and variance", String.raw`\bar{x} = \frac{1}{n} \sum_{i=1}^n x_i, \qquad s^2 = \frac{1}{n - 1} \sum_{i=1}^n (x_i - \bar{x})^2`],
    ["Central limit theorem", String.raw`\sqrt{n}\,(\bar{X}_n - \mu) \xrightarrow{d} \mathcal{N}(0, \sigma^2)`],
    ["Markov's inequality", String.raw`P(X \ge a) \le \frac{\mathbb{E}[X]}{a}`],
    ["Chebyshev's inequality", String.raw`P(\lvert X - \mu \rvert \ge k\sigma) \le \frac{1}{k^2}`],
    ["Hoeffding's inequality", String.raw`P\left(\bar{X} - \mathbb{E}[\bar{X}] \ge t\right) \le \exp\left(-\frac{2n^2 t^2}{\sum_{i=1}^n (b_i - a_i)^2}\right)`],
    ["Likelihood", String.raw`\mathcal{L}(\theta) = \prod_{i=1}^n p(x_i \mid \theta)`],
    ["Maximum likelihood", String.raw`\hat{\theta}_{\text{MLE}} = \arg\max_{\theta} \sum_{i=1}^n \log p(x_i \mid \theta)`],
    ["MAP estimate", String.raw`\hat{\theta}_{\text{MAP}} = \arg\max_{\theta} \; p(\mathcal{D} \mid \theta)\, p(\theta)`],
    ["Confidence interval", String.raw`\bar{x} \pm z_{\alpha/2} \frac{\sigma}{\sqrt{n}}`],
    ["t-statistic", String.raw`t = \frac{\bar{x} - \mu_0}{s / \sqrt{n}}`],
  ]),

  cat("ml", "Machine learning", [
    ["Linear regression", String.raw`\hat{y} = \mathbf{w}^\top \mathbf{x} + b`],
    ["Mean squared error", String.raw`\mathrm{MSE} = \frac{1}{N} \sum_{i=1}^{N} (y_i - \hat{y}_i)^2`],
    ["Ridge regression", String.raw`\min_{\mathbf{w}} \lVert \mathbf{y} - X\mathbf{w} \rVert_2^2 + \lambda \lVert \mathbf{w} \rVert_2^2`],
    ["Lasso", String.raw`\min_{\mathbf{w}} \frac{1}{2N} \lVert \mathbf{y} - X\mathbf{w} \rVert_2^2 + \lambda \lVert \mathbf{w} \rVert_1`],
    ["Logistic regression", String.raw`P(y = 1 \mid \mathbf{x}) = \sigma(\mathbf{w}^\top \mathbf{x} + b) = \frac{1}{1 + e^{-(\mathbf{w}^\top \mathbf{x} + b)}}`],
    ["Binary cross-entropy", String.raw`\mathcal{L} = -\frac{1}{N} \sum_{i=1}^N \left[ y_i \log \hat{y}_i + (1 - y_i) \log (1 - \hat{y}_i) \right]`],
    ["Cross-entropy (multiclass)", String.raw`\mathcal{L}_{\text{CE}} = -\sum_{c=1}^{C} y_c \log \hat{p}_c`],
    ["Softmax", String.raw`\operatorname{softmax}(\mathbf{z})_i = \frac{e^{z_i}}{\sum_{j=1}^{K} e^{z_j}}`],
    ["SVM (hinge loss)", String.raw`\min_{\mathbf{w}, b} \frac{1}{2} \lVert \mathbf{w} \rVert^2 + C \sum_{i=1}^N \max\left(0, 1 - y_i (\mathbf{w}^\top \mathbf{x}_i + b)\right)`],
    ["Kernel trick (RBF)", String.raw`k(\mathbf{x}, \mathbf{x}') = \exp\left(-\frac{\lVert \mathbf{x} - \mathbf{x}' \rVert^2}{2\ell^2}\right)`],
    ["k-means objective", String.raw`\min_{\{C_k\}} \sum_{k=1}^{K} \sum_{\mathbf{x} \in C_k} \lVert \mathbf{x} - \boldsymbol{\mu}_k \rVert^2`],
    ["PCA", String.raw`\mathbf{w}_1 = \arg\max_{\lVert \mathbf{w} \rVert = 1} \mathbf{w}^\top \Sigma \mathbf{w}`],
    ["Bias-variance decomposition", String.raw`\mathbb{E}\left[(y - \hat{f})^2\right] = \operatorname{Bias}[\hat{f}]^2 + \operatorname{Var}[\hat{f}] + \sigma^2`],
    ["Gaussian process", String.raw`f(\mathbf{x}) \sim \mathcal{GP}\left(m(\mathbf{x}), k(\mathbf{x}, \mathbf{x}')\right)`],
    ["Naive Bayes", String.raw`\hat{y} = \arg\max_{y} \; P(y) \prod_{i=1}^{d} P(x_i \mid y)`],
    ["Precision, recall, F1", String.raw`F_1 = 2 \cdot \frac{\mathrm{precision} \cdot \mathrm{recall}}{\mathrm{precision} + \mathrm{recall}}`],
    ["Empirical risk", String.raw`\hat{R}(f) = \frac{1}{n} \sum_{i=1}^{n} \ell\big(f(x_i), y_i\big)`],
    ["EM: E-step", String.raw`Q(\theta \mid \theta^{(t)}) = \mathbb{E}_{Z \mid X, \theta^{(t)}}\left[ \log p(X, Z \mid \theta) \right]`],
  ]),

  cat("dl", "Deep learning", [
    ["Scaled dot-product attention", String.raw`\operatorname{Attention}(Q, K, V) = \operatorname{softmax}\left( \frac{QK^\top}{\sqrt{d_k}} \right) V`],
    ["Multi-head attention", String.raw`\operatorname{MultiHead}(Q, K, V) = \operatorname{Concat}(\mathrm{head}_1, \dots, \mathrm{head}_h)\, W^O`],
    ["Attention head", String.raw`\mathrm{head}_i = \operatorname{Attention}(Q W_i^Q, K W_i^K, V W_i^V)`],
    ["Sinusoidal positional encoding", String.raw`PE_{(pos, 2i)} = \sin\left( \frac{pos}{10000^{2i / d_{\text{model}}}} \right)`],
    ["Layer normalization", String.raw`\operatorname{LN}(\mathbf{x}) = \gamma \odot \frac{\mathbf{x} - \mu}{\sqrt{\sigma^2 + \epsilon}} + \beta`],
    ["Residual block", String.raw`\mathbf{y} = \mathcal{F}(\mathbf{x}, \{W_i\}) + \mathbf{x}`],
    ["Dense layer", String.raw`\mathbf{h}^{(l)} = \sigma\left( W^{(l)} \mathbf{h}^{(l-1)} + \mathbf{b}^{(l)} \right)`],
    ["ReLU and GELU", String.raw`\operatorname{ReLU}(x) = \max(0, x), \qquad \operatorname{GELU}(x) = x\,\Phi(x)`],
    ["Sigmoid and tanh", String.raw`\sigma(x) = \frac{1}{1 + e^{-x}}, \qquad \tanh(x) = \frac{e^x - e^{-x}}{e^x + e^{-x}}`],
    ["2D convolution", String.raw`(I * K)(i, j) = \sum_{m} \sum_{n} I(i - m, j - n)\, K(m, n)`],
    ["Conv output size", String.raw`H_{\text{out}} = \left\lfloor \frac{H_{\text{in}} + 2p - k}{s} \right\rfloor + 1`],
    ["Backprop (chain rule)", String.raw`\frac{\partial \mathcal{L}}{\partial W^{(l)}} = \boldsymbol{\delta}^{(l)} \left( \mathbf{h}^{(l-1)} \right)^\top`],
    ["LSTM gates", String.raw`\begin{aligned}
  f_t &= \sigma(W_f [h_{t-1}, x_t] + b_f) \\
  i_t &= \sigma(W_i [h_{t-1}, x_t] + b_i) \\
  c_t &= f_t \odot c_{t-1} + i_t \odot \tanh(W_c [h_{t-1}, x_t] + b_c) \\
  h_t &= o_t \odot \tanh(c_t)
\end{aligned}`],
    ["VAE ELBO", String.raw`\mathcal{L}(\theta, \phi) = \mathbb{E}_{q_\phi(z \mid x)}\left[ \log p_\theta(x \mid z) \right] - D_{\mathrm{KL}}\left( q_\phi(z \mid x) \,\Vert\, p(z) \right)`],
    ["Reparameterization trick", String.raw`z = \mu + \sigma \odot \epsilon, \quad \epsilon \sim \mathcal{N}(0, I)`],
    ["GAN objective", String.raw`\min_G \max_D \; \mathbb{E}_{x \sim p_{\text{data}}}[\log D(x)] + \mathbb{E}_{z \sim p_z}[\log(1 - D(G(z)))]`],
    ["Diffusion forward process", String.raw`q(x_t \mid x_{t-1}) = \mathcal{N}\left( x_t; \sqrt{1 - \beta_t}\, x_{t-1}, \beta_t I \right)`],
    ["Diffusion training loss", String.raw`\mathcal{L}_{\text{simple}} = \mathbb{E}_{t, x_0, \epsilon}\left[ \lVert \epsilon - \epsilon_\theta(\sqrt{\bar{\alpha}_t}\, x_0 + \sqrt{1 - \bar{\alpha}_t}\, \epsilon, t) \rVert^2 \right]`],
    ["Contrastive (InfoNCE)", String.raw`\mathcal{L} = -\log \frac{\exp(\operatorname{sim}(z_i, z_j) / \tau)}{\sum_{k \ne i} \exp(\operatorname{sim}(z_i, z_k) / \tau)}`],
    ["Dropout", String.raw`\tilde{\mathbf{h}} = \frac{1}{1 - p}\, \mathbf{m} \odot \mathbf{h}, \quad m_i \sim \operatorname{Bernoulli}(1 - p)`],
    ["Policy gradient", String.raw`\nabla_\theta J(\theta) = \mathbb{E}_{\pi_\theta}\left[ \nabla_\theta \log \pi_\theta(a \mid s)\, Q^{\pi}(s, a) \right]`],
    ["Bellman equation", String.raw`V^\pi(s) = \sum_a \pi(a \mid s) \sum_{s', r} p(s', r \mid s, a) \left[ r + \gamma V^\pi(s') \right]`],
  ]),

  cat("optimization", "Optimization", [
    ["Gradient descent", String.raw`\theta_{t+1} = \theta_t - \eta \nabla_\theta \mathcal{L}(\theta_t)`],
    ["SGD with momentum", String.raw`\begin{aligned} v_{t+1} &= \mu v_t - \eta \nabla \mathcal{L}(\theta_t) \\ \theta_{t+1} &= \theta_t + v_{t+1} \end{aligned}`],
    ["Adam", String.raw`\begin{aligned}
  m_t &= \beta_1 m_{t-1} + (1 - \beta_1) g_t \\
  v_t &= \beta_2 v_{t-1} + (1 - \beta_2) g_t^2 \\
  \theta_t &= \theta_{t-1} - \eta \, \frac{\hat{m}_t}{\sqrt{\hat{v}_t} + \epsilon}
\end{aligned}`],
    ["Newton's method", String.raw`\mathbf{x}_{k+1} = \mathbf{x}_k - \left[ \nabla^2 f(\mathbf{x}_k) \right]^{-1} \nabla f(\mathbf{x}_k)`],
    ["Constrained problem", String.raw`\begin{aligned} \min_{x} \quad & f(x) \\ \text{s.t.} \quad & g_i(x) \le 0, \quad i = 1, \dots, m \\ & h_j(x) = 0, \quad j = 1, \dots, p \end{aligned}`],
    ["Lagrangian", String.raw`\mathcal{L}(x, \lambda, \nu) = f(x) + \sum_{i=1}^{m} \lambda_i g_i(x) + \sum_{j=1}^{p} \nu_j h_j(x)`],
    ["KKT conditions", String.raw`\nabla f(x^*) + \sum_i \lambda_i^* \nabla g_i(x^*) = 0, \quad \lambda_i^* g_i(x^*) = 0, \quad \lambda_i^* \ge 0`],
    ["Convexity", String.raw`f(\lambda x + (1 - \lambda) y) \le \lambda f(x) + (1 - \lambda) f(y)`],
    ["L-smoothness", String.raw`\lVert \nabla f(x) - \nabla f(y) \rVert \le L \lVert x - y \rVert`],
    ["Linear program", String.raw`\min_{\mathbf{x}} \; \mathbf{c}^\top \mathbf{x} \quad \text{s.t.} \quad A\mathbf{x} \le \mathbf{b}, \; \mathbf{x} \ge \mathbf{0}`],
    ["Proximal operator", String.raw`\operatorname{prox}_{\lambda f}(v) = \arg\min_x \left( f(x) + \frac{1}{2\lambda} \lVert x - v \rVert_2^2 \right)`],
    ["Convergence rate", String.raw`f(x_k) - f^* \le \frac{L \lVert x_0 - x^* \rVert^2}{2k}`],
  ]),

  cat("info", "Information theory", [
    ["Entropy", String.raw`H(X) = -\sum_{x} p(x) \log p(x)`],
    ["Cross-entropy", String.raw`H(p, q) = -\sum_{x} p(x) \log q(x)`],
    ["KL divergence", String.raw`D_{\mathrm{KL}}(P \,\Vert\, Q) = \sum_{x} P(x) \log \frac{P(x)}{Q(x)}`],
    ["Mutual information", String.raw`I(X; Y) = \sum_{x, y} p(x, y) \log \frac{p(x, y)}{p(x)\, p(y)}`],
    ["Conditional entropy", String.raw`H(Y \mid X) = -\sum_{x, y} p(x, y) \log p(y \mid x)`],
    ["Chain rule of entropy", String.raw`H(X, Y) = H(X) + H(Y \mid X)`],
    ["Jensen-Shannon divergence", String.raw`\mathrm{JSD}(P \,\Vert\, Q) = \tfrac{1}{2} D_{\mathrm{KL}}(P \,\Vert\, M) + \tfrac{1}{2} D_{\mathrm{KL}}(Q \,\Vert\, M), \quad M = \tfrac{1}{2}(P + Q)`],
    ["Channel capacity", String.raw`C = B \log_2\left(1 + \frac{S}{N}\right)`],
    ["Perplexity", String.raw`\mathrm{PPL} = \exp\left( -\frac{1}{N} \sum_{i=1}^N \log p(w_i \mid w_{<i}) \right)`],
  ]),

  cat("mechanics", "Physics: mechanics", [
    ["Newton's second law", String.raw`\mathbf{F} = m\mathbf{a} = \frac{d\mathbf{p}}{dt}`],
    ["Kinematics", String.raw`x(t) = x_0 + v_0 t + \tfrac{1}{2} a t^2`],
    ["Kinetic and potential energy", String.raw`E = \tfrac{1}{2} m v^2 + m g h`],
    ["Universal gravitation", String.raw`F = G \frac{m_1 m_2}{r^2}`],
    ["Simple harmonic motion", String.raw`\ddot{x} + \omega^2 x = 0, \quad x(t) = A \cos(\omega t + \phi)`],
    ["Lagrangian mechanics", String.raw`\frac{d}{dt} \left( \frac{\partial L}{\partial \dot{q}_i} \right) - \frac{\partial L}{\partial q_i} = 0`],
    ["Hamilton's equations", String.raw`\dot{q} = \frac{\partial H}{\partial p}, \qquad \dot{p} = -\frac{\partial H}{\partial q}`],
    ["Angular momentum", String.raw`\mathbf{L} = \mathbf{r} \times \mathbf{p}, \qquad \boldsymbol{\tau} = \frac{d\mathbf{L}}{dt}`],
    ["Moment of inertia", String.raw`I = \int r^2 \, dm`],
    ["Navier-Stokes", String.raw`\rho \left( \frac{\partial \mathbf{u}}{\partial t} + (\mathbf{u} \cdot \nabla) \mathbf{u} \right) = -\nabla p + \mu \nabla^2 \mathbf{u} + \mathbf{f}`],
  ]),

  cat("em", "Physics: electromagnetism", [
    ["Maxwell's equations", String.raw`\begin{aligned}
  \nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
  \nabla \cdot \mathbf{B} &= 0 \\
  \nabla \times \mathbf{E} &= -\frac{\partial \mathbf{B}}{\partial t} \\
  \nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{aligned}`],
    ["Coulomb's law", String.raw`\mathbf{F} = \frac{1}{4\pi\varepsilon_0} \frac{q_1 q_2}{r^2} \hat{\mathbf{r}}`],
    ["Lorentz force", String.raw`\mathbf{F} = q(\mathbf{E} + \mathbf{v} \times \mathbf{B})`],
    ["Ohm's law and power", String.raw`V = IR, \qquad P = IV = I^2 R`],
    ["Capacitor energy", String.raw`U = \tfrac{1}{2} C V^2 = \frac{Q^2}{2C}`],
    ["RC circuit", String.raw`V_C(t) = V_0 \left( 1 - e^{-t / RC} \right)`],
    ["Wave equation", String.raw`\nabla^2 \mathbf{E} = \mu_0 \varepsilon_0 \frac{\partial^2 \mathbf{E}}{\partial t^2}`],
    ["Poynting vector", String.raw`\mathbf{S} = \frac{1}{\mu_0} \mathbf{E} \times \mathbf{B}`],
  ]),

  cat("quantum", "Physics: quantum", [
    ["Schrodinger equation", String.raw`i\hbar \frac{\partial}{\partial t} \Psi(\mathbf{r}, t) = \hat{H} \Psi(\mathbf{r}, t)`],
    ["Time-independent Schrodinger", String.raw`-\frac{\hbar^2}{2m} \nabla^2 \psi + V\psi = E\psi`],
    ["Uncertainty principle", String.raw`\sigma_x \sigma_p \ge \frac{\hbar}{2}`],
    ["Photon energy", String.raw`E = h\nu = \frac{hc}{\lambda}`],
    ["de Broglie wavelength", String.raw`\lambda = \frac{h}{p}`],
    ["Bra-ket expectation", String.raw`\langle \hat{A} \rangle = \langle \psi \vert \hat{A} \vert \psi \rangle`],
    ["Commutator", String.raw`[\hat{x}, \hat{p}] = \hat{x}\hat{p} - \hat{p}\hat{x} = i\hbar`],
    ["Qubit state", String.raw`\lvert \psi \rangle = \alpha \lvert 0 \rangle + \beta \lvert 1 \rangle, \quad \lvert \alpha \rvert^2 + \lvert \beta \rvert^2 = 1`],
    ["Pauli matrices", String.raw`\sigma_x = \begin{pmatrix} 0 & 1 \\ 1 & 0 \end{pmatrix}, \quad \sigma_y = \begin{pmatrix} 0 & -i \\ i & 0 \end{pmatrix}, \quad \sigma_z = \begin{pmatrix} 1 & 0 \\ 0 & -1 \end{pmatrix}`],
    ["Hydrogen energy levels", String.raw`E_n = -\frac{13.6\,\mathrm{eV}}{n^2}`],
  ]),

  cat("thermo", "Physics: thermo & relativity", [
    ["Ideal gas law", String.raw`PV = nRT`],
    ["First law", String.raw`\Delta U = Q - W`],
    ["Entropy (Boltzmann)", String.raw`S = k_B \ln \Omega`],
    ["Boltzmann distribution", String.raw`p_i = \frac{e^{-E_i / k_B T}}{\sum_j e^{-E_j / k_B T}}`],
    ["Partition function", String.raw`Z = \sum_i e^{-\beta E_i}, \quad \beta = \frac{1}{k_B T}`],
    ["Heat equation", String.raw`\frac{\partial u}{\partial t} = \alpha \nabla^2 u`],
    ["Mass-energy equivalence", String.raw`E = mc^2`],
    ["Energy-momentum relation", String.raw`E^2 = (pc)^2 + (m_0 c^2)^2`],
    ["Lorentz factor", String.raw`\gamma = \frac{1}{\sqrt{1 - v^2 / c^2}}`],
    ["Time dilation", String.raw`\Delta t' = \gamma \, \Delta t`],
    ["Einstein field equations", String.raw`G_{\mu\nu} + \Lambda g_{\mu\nu} = \frac{8\pi G}{c^4} T_{\mu\nu}`],
  ]),

  cat("signals", "Signal processing", [
    ["Fourier transform", String.raw`\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi}\,dx`],
    ["Inverse Fourier transform", String.raw`f(x) = \int_{-\infty}^{\infty} \hat{f}(\xi)\, e^{2\pi i x \xi}\,d\xi`],
    ["Fourier series", String.raw`f(x) = \frac{a_0}{2} + \sum_{n=1}^{\infty} \left( a_n \cos nx + b_n \sin nx \right)`],
    ["DFT", String.raw`X_k = \sum_{n=0}^{N-1} x_n \, e^{-2\pi i k n / N}`],
    ["Convolution", String.raw`(f * g)(t) = \int_{-\infty}^{\infty} f(\tau)\, g(t - \tau)\,d\tau`],
    ["Convolution theorem", String.raw`\mathcal{F}\{f * g\} = \mathcal{F}\{f\} \cdot \mathcal{F}\{g\}`],
    ["Laplace transform", String.raw`F(s) = \int_0^{\infty} f(t)\, e^{-st}\,dt`],
    ["Z-transform", String.raw`X(z) = \sum_{n=-\infty}^{\infty} x[n]\, z^{-n}`],
    ["Transfer function", String.raw`H(s) = \frac{Y(s)}{X(s)} = \frac{b_m s^m + \cdots + b_0}{a_n s^n + \cdots + a_0}`],
    ["Nyquist rate", String.raw`f_s > 2 f_{\max}`],
    ["Parseval's theorem", String.raw`\int_{-\infty}^{\infty} \lvert f(t) \rvert^2\,dt = \int_{-\infty}^{\infty} \lvert \hat{f}(\xi) \rvert^2\,d\xi`],
  ]),

  cat("ode", "Differential equations", [
    ["First-order linear ODE", String.raw`\frac{dy}{dx} + P(x)\, y = Q(x)`],
    ["Integrating factor", String.raw`\mu(x) = e^{\int P(x)\,dx}`],
    ["Second-order linear ODE", String.raw`a y'' + b y' + c y = 0`],
    ["Exponential growth", String.raw`\frac{dN}{dt} = rN \implies N(t) = N_0 e^{rt}`],
    ["Logistic growth", String.raw`\frac{dN}{dt} = rN\left(1 - \frac{N}{K}\right)`],
    ["Linear system", String.raw`\dot{\mathbf{x}} = A\mathbf{x}, \qquad \mathbf{x}(t) = e^{At} \mathbf{x}_0`],
    ["Laplace's equation", String.raw`\nabla^2 \phi = \frac{\partial^2 \phi}{\partial x^2} + \frac{\partial^2 \phi}{\partial y^2} = 0`],
    ["Wave equation (1D)", String.raw`\frac{\partial^2 u}{\partial t^2} = c^2 \frac{\partial^2 u}{\partial x^2}`],
    ["Euler's method", String.raw`y_{n+1} = y_n + h\, f(t_n, y_n)`],
    ["Runge-Kutta 4", String.raw`y_{n+1} = y_n + \frac{h}{6}\left( k_1 + 2k_2 + 2k_3 + k_4 \right)`],
    ["Lotka-Volterra", String.raw`\begin{aligned} \dot{x} &= \alpha x - \beta x y \\ \dot{y} &= \delta x y - \gamma y \end{aligned}`],
  ]),

  cat("discrete", "Discrete math & logic", [
    ["Summation formulas", String.raw`\sum_{k=1}^{n} k = \frac{n(n + 1)}{2}, \qquad \sum_{k=1}^{n} k^2 = \frac{n(n + 1)(2n + 1)}{6}`],
    ["Geometric series", String.raw`\sum_{k=0}^{\infty} r^k = \frac{1}{1 - r}, \quad \lvert r \rvert < 1`],
    ["Binomial theorem", String.raw`(x + y)^n = \sum_{k=0}^{n} \binom{n}{k} x^{n-k} y^k`],
    ["Binomial coefficient", String.raw`\binom{n}{k} = \frac{n!}{k!\,(n - k)!}`],
    ["Inclusion-exclusion", String.raw`\lvert A \cup B \rvert = \lvert A \rvert + \lvert B \rvert - \lvert A \cap B \rvert`],
    ["Stirling's approximation", String.raw`n! \sim \sqrt{2\pi n} \left( \frac{n}{e} \right)^n`],
    ["Big-O definition", String.raw`f(n) = O(g(n)) \iff \exists c, n_0 : \forall n \ge n_0, \; f(n) \le c\, g(n)`],
    ["Master theorem form", String.raw`T(n) = a\, T\!\left(\frac{n}{b}\right) + f(n)`],
    ["Recurrence (Fibonacci)", String.raw`F_n = F_{n-1} + F_{n-2}, \quad F_0 = 0, \; F_1 = 1`],
    ["Set builder", String.raw`S = \{ x \in \mathbb{R} \mid x^2 < 2 \}`],
    ["De Morgan's laws", String.raw`\neg (P \land Q) \equiv \neg P \lor \neg Q, \qquad \neg (P \lor Q) \equiv \neg P \land \neg Q`],
    ["Quantified statement", String.raw`\forall x \in X, \; \exists y \in Y : P(x, y)`],
    ["Induction", String.raw`\big( P(0) \land \forall n \, (P(n) \Rightarrow P(n + 1)) \big) \Rightarrow \forall n \, P(n)`],
    ["Handshake lemma", String.raw`\sum_{v \in V} \deg(v) = 2\lvert E \rvert`],
    ["Euler's formula (graphs)", String.raw`V - E + F = 2`],
  ]),

  cat("algebra", "Algebra & number theory", [
    ["Quadratic formula", String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`],
    ["Difference of squares", String.raw`a^2 - b^2 = (a - b)(a + b)`],
    ["Logarithm rules", String.raw`\log_b(xy) = \log_b x + \log_b y, \qquad \log_b x^k = k \log_b x`],
    ["Change of base", String.raw`\log_b x = \frac{\ln x}{\ln b}`],
    ["Modular congruence", String.raw`a \equiv b \pmod{n}`],
    ["Fermat's little theorem", String.raw`a^{p-1} \equiv 1 \pmod{p}, \quad p \nmid a`],
    ["Euler's theorem", String.raw`a^{\varphi(n)} \equiv 1 \pmod{n}, \quad \gcd(a, n) = 1`],
    ["Bezout's identity", String.raw`\gcd(a, b) = ax + by \quad \text{for some } x, y \in \mathbb{Z}`],
    ["Prime number theorem", String.raw`\pi(x) \sim \frac{x}{\ln x}`],
    ["Riemann zeta", String.raw`\zeta(s) = \sum_{n=1}^{\infty} \frac{1}{n^s} = \prod_{p} \frac{1}{1 - p^{-s}}`],
    ["Group axioms", String.raw`\forall a, b, c \in G: \; (ab)c = a(bc), \; \exists e : ea = a, \; \exists a^{-1} : a^{-1} a = e`],
    ["Polynomial", String.raw`p(x) = \sum_{k=0}^{n} a_k x^k = a_n x^n + \cdots + a_1 x + a_0`],
  ]),

  cat("geometry", "Geometry & trigonometry", [
    ["Pythagorean theorem", String.raw`a^2 + b^2 = c^2`],
    ["Distance formula", String.raw`d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}`],
    ["Law of cosines", String.raw`c^2 = a^2 + b^2 - 2ab \cos\gamma`],
    ["Law of sines", String.raw`\frac{a}{\sin\alpha} = \frac{b}{\sin\beta} = \frac{c}{\sin\gamma}`],
    ["Pythagorean identity", String.raw`\sin^2\theta + \cos^2\theta = 1`],
    ["Angle addition", String.raw`\sin(\alpha \pm \beta) = \sin\alpha \cos\beta \pm \cos\alpha \sin\beta`],
    ["Double angle", String.raw`\cos 2\theta = \cos^2\theta - \sin^2\theta = 1 - 2\sin^2\theta`],
    ["Circle area and circumference", String.raw`A = \pi r^2, \qquad C = 2\pi r`],
    ["Sphere volume and surface", String.raw`V = \tfrac{4}{3} \pi r^3, \qquad A = 4\pi r^2`],
    ["Heron's formula", String.raw`A = \sqrt{s(s - a)(s - b)(s - c)}, \quad s = \tfrac{a + b + c}{2}`],
    ["Line through two points", String.raw`y - y_1 = \frac{y_2 - y_1}{x_2 - x_1} (x - x_1)`],
    ["Ellipse", String.raw`\frac{x^2}{a^2} + \frac{y^2}{b^2} = 1`],
    ["Dot product angle", String.raw`\cos\theta = \frac{\mathbf{u} \cdot \mathbf{v}}{\lVert \mathbf{u} \rVert \, \lVert \mathbf{v} \rVert}`],
  ]),

  cat("complex", "Complex analysis", [
    ["Euler's formula", String.raw`e^{i\theta} = \cos\theta + i \sin\theta`],
    ["Euler's identity", String.raw`e^{i\pi} + 1 = 0`],
    ["Polar form", String.raw`z = r e^{i\theta} = r(\cos\theta + i\sin\theta)`],
    ["Modulus and conjugate", String.raw`\lvert z \rvert = \sqrt{z \bar{z}} = \sqrt{a^2 + b^2}`],
    ["De Moivre's theorem", String.raw`(\cos\theta + i\sin\theta)^n = \cos n\theta + i \sin n\theta`],
    ["Cauchy-Riemann equations", String.raw`\frac{\partial u}{\partial x} = \frac{\partial v}{\partial y}, \qquad \frac{\partial u}{\partial y} = -\frac{\partial v}{\partial x}`],
    ["Cauchy's integral formula", String.raw`f(a) = \frac{1}{2\pi i} \oint_\gamma \frac{f(z)}{z - a}\,dz`],
    ["Residue theorem", String.raw`\oint_\gamma f(z)\,dz = 2\pi i \sum_k \operatorname{Res}(f, a_k)`],
    ["Laurent series", String.raw`f(z) = \sum_{n=-\infty}^{\infty} a_n (z - z_0)^n`],
  ]),
];

/** Total number of starters, for the panel's header. */
export const STARTER_COUNT = STARTER_CATEGORIES.reduce((n, c) => n + c.items.length, 0);
