# Research report (.tex)

> A whole LaTeX paper: macros, numbered equations, theorems, a table - open Live Preview

## Input

```markdown
\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm,booktabs,graphicx}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newcommand{\vx}{\mathbf{x}}
\newcommand{\vw}{\mathbf{w}}
\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator*{\argmin}{arg\,min}
\DeclareMathOperator{\softmax}{softmax}

\title{Sparse Attention for Long-Context Retrieval:\\ A Technical Report}
\author{Research Team \and Applied Science Group}
\date{October 2026}

\begin{document}
\maketitle

\begin{abstract}
We study a sparse attention mechanism that keeps the cost of a forward pass
linear in the context length $n$ while retaining the accuracy of dense
attention on retrieval tasks. We derive the estimator, bound its error
(Theorem~\ref{thm:error}), and report results on three benchmarks in
Table~\ref{tab:results}.
\end{abstract}

\section{Introduction}\label{sec:intro}
Dense attention over a context of $n$ tokens costs $O(n^2 d)$ time, which
dominates inference once $n$ exceeds a few thousand~\cite{vaswani2017}. Most
of that cost is spent on pairs whose attention weight is negligible. Our
contributions are:
\begin{itemize}
\item a top-$k$ estimator of the attention output with a closed-form error
bound (Section~\ref{sec:method});
\item a training objective that makes the bound tight (Eq.~\eqref{eq:loss});
\item experiments showing a $6.1\times$ speed-up at equal accuracy
(Section~\ref{sec:results}).
\end{itemize}

\section{Method}\label{sec:method}
\subsection{Dense attention}
Given queries $Q \in \R^{n \times d}$, keys $K \in \R^{n \times d}$ and values
$V \in \R^{n \times d_v}$, scaled dot-product attention is
\begin{equation}
\operatorname{Attn}(Q, K, V) = \softmax\left( \frac{QK^\top}{\sqrt{d}} \right) V. \label{eq:attn}
\end{equation}

\subsection{Top-$k$ estimator}
For a query $\mathbf{q}_i$ let $S_i$ be the indices of its $k$ largest scores.
We replace the row of \eqref{eq:attn} by
\begin{align}
\hat{\mathbf{o}}_i &= \sum_{j \in S_i} \frac{e^{s_{ij}}}{Z_i}\, \mathbf{v}_j, \label{eq:est} \\
Z_i &= \sum_{j \in S_i} e^{s_{ij}}, \qquad s_{ij} = \frac{\mathbf{q}_i^\top \mathbf{k}_j}{\sqrt{d}}. \nonumber
\end{align}

\begin{definition}[Tail mass]
The tail mass of query $i$ is $\tau_i = \sum_{j \notin S_i} p_{ij}$, where
$p_{ij}$ are the dense attention weights.
\end{definition}

\begin{theorem}[Approximation error]\label{thm:error}
If $\lVert \mathbf{v}_j \rVert_2 \le B$ for all $j$, then
\begin{equation}
\lVert \hat{\mathbf{o}}_i - \mathbf{o}_i \rVert_2 \le 2 B \tau_i. \label{eq:bound}
\end{equation}
\end{theorem}

\begin{proof}
Write $\mathbf{o}_i = (1 - \tau_i)\, \hat{\mathbf{o}}_i + \tau_i\, \bar{\mathbf{v}}$,
where $\bar{\mathbf{v}}$ is the tail average. Then
$\hat{\mathbf{o}}_i - \mathbf{o}_i = \tau_i (\hat{\mathbf{o}}_i - \bar{\mathbf{v}})$,
and both terms have norm at most $B$.
\end{proof}

\subsection{Training objective}
To keep the tail mass small we add a penalty to the task loss:
\begin{equation}
\mathcal{L}(\vw) = \mathcal{L}_{\text{task}}(\vw) + \lambda \sum_{i=1}^{n} \tau_i(\vw), \label{eq:loss}
\end{equation}
and train with
$\vw^\star = \argmin_{\vw} \mathcal{L}(\vw)$.

\begin{lemma}
The penalty in \eqref{eq:loss} is differentiable almost everywhere in $\vw$.
\end{lemma}

\section{Results}\label{sec:results}
Table~\ref{tab:results} compares dense attention with our estimator at
$k = 64$. Accuracy is within $0.3$ points while latency drops sharply.

\begin{table}[h]
\centering
\caption{Retrieval accuracy (\%) and latency at $n = 32\,768$.}\label{tab:results}
\begin{tabular}{lccc}
\toprule
Method & Accuracy & Latency (ms) & Memory (GB) \\
\midrule
Dense attention & 91.4 & 412 & 38.2 \\
Sliding window & 84.0 & 71 & 6.1 \\
Top-$k$ (ours) & \textbf{91.1} & \textbf{67} & \textbf{5.8} \\
\bottomrule
\end{tabular}
\end{table}

\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{latency.pdf}
\caption{Latency versus context length; the estimator scales linearly.}\label{fig:latency}
\end{figure}

As Figure~\ref{fig:latency} shows, the gap widens with $n$, matching the
$O(nkd)$ cost of \eqref{eq:est} against $O(n^2 d)$ for \eqref{eq:attn}.

\section{Conclusion}
A top-$k$ estimator with the bound of Theorem~\ref{thm:error} recovers dense
accuracy at a fraction of the cost.

\begin{thebibliography}{9}
\bibitem{vaswani2017} A. Vaswani et al. Attention is all you need. \emph{NeurIPS}, 2017.
\bibitem{child2019} R. Child et al. Generating long sequences with sparse transformers. \emph{arXiv:1904.10509}, 2019.
\end{thebibliography}

\end{document}
```

## Output - Standard mode

`$ inline, $$ display - Obsidian, Notion, GitHub`

```latex
\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm,booktabs,graphicx}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newcommand{\vx}{\mathbf{x}}
\newcommand{\vw}{\mathbf{w}}
\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator*{\argmin}{arg\,min}
\DeclareMathOperator{\softmax}{softmax}

\title{Sparse Attention for Long-Context Retrieval:\\ A Technical Report}
\author{Research Team \and Applied Science Group}
\date{October 2026}

\begin{document}
\maketitle

\begin{abstract}
We study a sparse attention mechanism that keeps the cost of a forward pass
linear in the context length $n$ while retaining the accuracy of dense
attention on retrieval tasks. We derive the estimator, bound its error
(Theorem~\ref{thm:error}), and report results on three benchmarks in
Table~\ref{tab:results}.
\end{abstract}

\section{Introduction}\label{sec:intro}
Dense attention over a context of $n$ tokens costs $O(n^2 d)$ time, which
dominates inference once $n$ exceeds a few thousand~\cite{vaswani2017}. Most
of that cost is spent on pairs whose attention weight is negligible. Our
contributions are:
\begin{itemize}
\item a top-$k$ estimator of the attention output with a closed-form error
bound (Section~\ref{sec:method});
\item a training objective that makes the bound tight (Eq.~\eqref{eq:loss});
\item experiments showing a $6.1\times$ speed-up at equal accuracy
(Section~\ref{sec:results}).
\end{itemize}

\section{Method}\label{sec:method}
\subsection{Dense attention}
Given queries $Q \in \R^{n \times d}$, keys $K \in \R^{n \times d}$ and values
$V \in \R^{n \times d_v}$, scaled dot-product attention is
\begin{equation}
\operatorname{Attn}(Q, K, V) = \softmax\left( \frac{QK^\top}{\sqrt{d}} \right) V. \label{eq:attn}
\end{equation}

\subsection{Top-$k$ estimator}
For a query $\mathbf{q}_i$ let $S_i$ be the indices of its $k$ largest scores.
We replace the row of \eqref{eq:attn} by
\begin{align}
\hat{\mathbf{o}}_i &= \sum_{j \in S_i} \frac{e^{s_{ij}}}{Z_i}\, \mathbf{v}_j, \label{eq:est} \\
Z_i &= \sum_{j \in S_i} e^{s_{ij}}, \qquad s_{ij} = \frac{\mathbf{q}_i^\top \mathbf{k}_j}{\sqrt{d}}. \nonumber
\end{align}

\begin{definition}[Tail mass]
The tail mass of query $i$ is $\tau_i = \sum_{j \notin S_i} p_{ij}$, where
$p_{ij}$ are the dense attention weights.
\end{definition}

\begin{theorem}[Approximation error]\label{thm:error}
If $\lVert \mathbf{v}_j \rVert_2 \le B$ for all $j$, then
\begin{equation}
\lVert \hat{\mathbf{o}}_i - \mathbf{o}_i \rVert_2 \le 2 B \tau_i. \label{eq:bound}
\end{equation}
\end{theorem}

\begin{proof}
Write $\mathbf{o}_i = (1 - \tau_i)\, \hat{\mathbf{o}}_i + \tau_i\, \bar{\mathbf{v}}$,
where $\bar{\mathbf{v}}$ is the tail average. Then
$\hat{\mathbf{o}}_i - \mathbf{o}_i = \tau_i (\hat{\mathbf{o}}_i - \bar{\mathbf{v}})$,
and both terms have norm at most $B$.
\end{proof}

\subsection{Training objective}
To keep the tail mass small we add a penalty to the task loss:
\begin{equation}
\mathcal{L}(\vw) = \mathcal{L}_{\text{task}}(\vw) + \lambda \sum_{i=1}^{n} \tau_i(\vw), \label{eq:loss}
\end{equation}
and train with
$\vw^\star = \argmin_{\vw} \mathcal{L}(\vw)$.

\begin{lemma}
The penalty in \eqref{eq:loss} is differentiable almost everywhere in $\vw$.
\end{lemma}

\section{Results}\label{sec:results}
Table~\ref{tab:results} compares dense attention with our estimator at
$k = 64$. Accuracy is within $0.3$ points while latency drops sharply.

\begin{table}[h]
\centering
\caption{Retrieval accuracy (\%) and latency at $n = 32\,768$.}\label{tab:results}
\begin{tabular}{lccc}
\toprule
Method & Accuracy & Latency (ms) & Memory (GB) \\
\midrule
Dense attention & 91.4 & 412 & 38.2 \\
Sliding window & 84.0 & 71 & 6.1 \\
Top-$k$ (ours) & \textbf{91.1} & \textbf{67} & \textbf{5.8} \\
\bottomrule
\end{tabular}
\end{table}

\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{latency.pdf}
\caption{Latency versus context length; the estimator scales linearly.}\label{fig:latency}
\end{figure}

As Figure~\ref{fig:latency} shows, the gap widens with $n$, matching the
$O(nkd)$ cost of \eqref{eq:est} against $O(n^2 d)$ for \eqref{eq:attn}.

\section{Conclusion}
A top-$k$ estimator with the bound of Theorem~\ref{thm:error} recovers dense
accuracy at a fraction of the cost.

\begin{thebibliography}{9}
\bibitem{vaswani2017} A. Vaswani et al. Attention is all you need. \emph{NeurIPS}, 2017.
\bibitem{child2019} R. Child et al. Generating long sequences with sparse transformers. \emph{arXiv:1904.10509}, 2019.
\end{thebibliography}

\end{document}
```

_36 math block(s) normalized, no issues._

## Output - Academic mode

`\begin{equation*} / \begin{align*} - Overleaf, paper drafts`

```latex
\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm,booktabs,graphicx}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newcommand{\vx}{\mathbf{x}}
\newcommand{\vw}{\mathbf{w}}
\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator*{\argmin}{arg\,min}
\DeclareMathOperator{\softmax}{softmax}

\title{Sparse Attention for Long-Context Retrieval:\\ A Technical Report}
\author{Research Team \and Applied Science Group}
\date{October 2026}

\begin{document}
\maketitle

\begin{abstract}
We study a sparse attention mechanism that keeps the cost of a forward pass
linear in the context length $n$ while retaining the accuracy of dense
attention on retrieval tasks. We derive the estimator, bound its error
(Theorem~\ref{thm:error}), and report results on three benchmarks in
Table~\ref{tab:results}.
\end{abstract}

\section{Introduction}\label{sec:intro}
Dense attention over a context of $n$ tokens costs $O(n^2 d)$ time, which
dominates inference once $n$ exceeds a few thousand~\cite{vaswani2017}. Most
of that cost is spent on pairs whose attention weight is negligible. Our
contributions are:
\begin{itemize}
\item a top-$k$ estimator of the attention output with a closed-form error
bound (Section~\ref{sec:method});
\item a training objective that makes the bound tight (Eq.~\eqref{eq:loss});
\item experiments showing a $6.1\times$ speed-up at equal accuracy
(Section~\ref{sec:results}).
\end{itemize}

\section{Method}\label{sec:method}
\subsection{Dense attention}
Given queries $Q \in \R^{n \times d}$, keys $K \in \R^{n \times d}$ and values
$V \in \R^{n \times d_v}$, scaled dot-product attention is
\begin{equation}
\operatorname{Attn}(Q, K, V) = \softmax\left( \frac{QK^\top}{\sqrt{d}} \right) V. \label{eq:attn}
\end{equation}

\subsection{Top-$k$ estimator}
For a query $\mathbf{q}_i$ let $S_i$ be the indices of its $k$ largest scores.
We replace the row of \eqref{eq:attn} by
\begin{align}
\hat{\mathbf{o}}_i &= \sum_{j \in S_i} \frac{e^{s_{ij}}}{Z_i}\, \mathbf{v}_j, \label{eq:est} \\
Z_i &= \sum_{j \in S_i} e^{s_{ij}}, \qquad s_{ij} = \frac{\mathbf{q}_i^\top \mathbf{k}_j}{\sqrt{d}}. \nonumber
\end{align}

\begin{definition}[Tail mass]
The tail mass of query $i$ is $\tau_i = \sum_{j \notin S_i} p_{ij}$, where
$p_{ij}$ are the dense attention weights.
\end{definition}

\begin{theorem}[Approximation error]\label{thm:error}
If $\lVert \mathbf{v}_j \rVert_2 \le B$ for all $j$, then
\begin{equation}
\lVert \hat{\mathbf{o}}_i - \mathbf{o}_i \rVert_2 \le 2 B \tau_i. \label{eq:bound}
\end{equation}
\end{theorem}

\begin{proof}
Write $\mathbf{o}_i = (1 - \tau_i)\, \hat{\mathbf{o}}_i + \tau_i\, \bar{\mathbf{v}}$,
where $\bar{\mathbf{v}}$ is the tail average. Then
$\hat{\mathbf{o}}_i - \mathbf{o}_i = \tau_i (\hat{\mathbf{o}}_i - \bar{\mathbf{v}})$,
and both terms have norm at most $B$.
\end{proof}

\subsection{Training objective}
To keep the tail mass small we add a penalty to the task loss:
\begin{equation}
\mathcal{L}(\vw) = \mathcal{L}_{\text{task}}(\vw) + \lambda \sum_{i=1}^{n} \tau_i(\vw), \label{eq:loss}
\end{equation}
and train with
$\vw^\star = \argmin_{\vw} \mathcal{L}(\vw)$.

\begin{lemma}
The penalty in \eqref{eq:loss} is differentiable almost everywhere in $\vw$.
\end{lemma}

\section{Results}\label{sec:results}
Table~\ref{tab:results} compares dense attention with our estimator at
$k = 64$. Accuracy is within $0.3$ points while latency drops sharply.

\begin{table}[h]
\centering
\caption{Retrieval accuracy (\%) and latency at $n = 32\,768$.}\label{tab:results}
\begin{tabular}{lccc}
\toprule
Method & Accuracy & Latency (ms) & Memory (GB) \\
\midrule
Dense attention & 91.4 & 412 & 38.2 \\
Sliding window & 84.0 & 71 & 6.1 \\
Top-$k$ (ours) & \textbf{91.1} & \textbf{67} & \textbf{5.8} \\
\bottomrule
\end{tabular}
\end{table}

\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{latency.pdf}
\caption{Latency versus context length; the estimator scales linearly.}\label{fig:latency}
\end{figure}

As Figure~\ref{fig:latency} shows, the gap widens with $n$, matching the
$O(nkd)$ cost of \eqref{eq:est} against $O(n^2 d)$ for \eqref{eq:attn}.

\section{Conclusion}
A top-$k$ estimator with the bound of Theorem~\ref{thm:error} recovers dense
accuracy at a fraction of the cost.

\begin{thebibliography}{9}
\bibitem{vaswani2017} A. Vaswani et al. Attention is all you need. \emph{NeurIPS}, 2017.
\bibitem{child2019} R. Child et al. Generating long sequences with sparse transformers. \emph{arXiv:1904.10509}, 2019.
\end{thebibliography}

\end{document}
```

_36 math block(s) normalized, no issues._

## Output - Inline-only mode

`Everything collapses to $ ... $ - chat, commit messages`

```latex
\documentclass[11pt]{article}
\usepackage{amsmath,amssymb,amsthm,booktabs,graphicx}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newcommand{\vx}{\mathbf{x}}
\newcommand{\vw}{\mathbf{w}}
\newcommand{\R}{\mathbb{R}}
\DeclareMathOperator*{\argmin}{arg\,min}
\DeclareMathOperator{\softmax}{softmax}

\title{Sparse Attention for Long-Context Retrieval:\\ A Technical Report}
\author{Research Team \and Applied Science Group}
\date{October 2026}

\begin{document}
\maketitle

\begin{abstract}
We study a sparse attention mechanism that keeps the cost of a forward pass
linear in the context length $n$ while retaining the accuracy of dense
attention on retrieval tasks. We derive the estimator, bound its error
(Theorem~\ref{thm:error}), and report results on three benchmarks in
Table~\ref{tab:results}.
\end{abstract}

\section{Introduction}\label{sec:intro}
Dense attention over a context of $n$ tokens costs $O(n^2 d)$ time, which
dominates inference once $n$ exceeds a few thousand~\cite{vaswani2017}. Most
of that cost is spent on pairs whose attention weight is negligible. Our
contributions are:
\begin{itemize}
\item a top-$k$ estimator of the attention output with a closed-form error
bound (Section~\ref{sec:method});
\item a training objective that makes the bound tight (Eq.~\eqref{eq:loss});
\item experiments showing a $6.1\times$ speed-up at equal accuracy
(Section~\ref{sec:results}).
\end{itemize}

\section{Method}\label{sec:method}
\subsection{Dense attention}
Given queries $Q \in \R^{n \times d}$, keys $K \in \R^{n \times d}$ and values
$V \in \R^{n \times d_v}$, scaled dot-product attention is
\begin{equation}
\operatorname{Attn}(Q, K, V) = \softmax\left( \frac{QK^\top}{\sqrt{d}} \right) V. \label{eq:attn}
\end{equation}

\subsection{Top-$k$ estimator}
For a query $\mathbf{q}_i$ let $S_i$ be the indices of its $k$ largest scores.
We replace the row of \eqref{eq:attn} by
\begin{align}
\hat{\mathbf{o}}_i &= \sum_{j \in S_i} \frac{e^{s_{ij}}}{Z_i}\, \mathbf{v}_j, \label{eq:est} \\
Z_i &= \sum_{j \in S_i} e^{s_{ij}}, \qquad s_{ij} = \frac{\mathbf{q}_i^\top \mathbf{k}_j}{\sqrt{d}}. \nonumber
\end{align}

\begin{definition}[Tail mass]
The tail mass of query $i$ is $\tau_i = \sum_{j \notin S_i} p_{ij}$, where
$p_{ij}$ are the dense attention weights.
\end{definition}

\begin{theorem}[Approximation error]\label{thm:error}
If $\lVert \mathbf{v}_j \rVert_2 \le B$ for all $j$, then
\begin{equation}
\lVert \hat{\mathbf{o}}_i - \mathbf{o}_i \rVert_2 \le 2 B \tau_i. \label{eq:bound}
\end{equation}
\end{theorem}

\begin{proof}
Write $\mathbf{o}_i = (1 - \tau_i)\, \hat{\mathbf{o}}_i + \tau_i\, \bar{\mathbf{v}}$,
where $\bar{\mathbf{v}}$ is the tail average. Then
$\hat{\mathbf{o}}_i - \mathbf{o}_i = \tau_i (\hat{\mathbf{o}}_i - \bar{\mathbf{v}})$,
and both terms have norm at most $B$.
\end{proof}

\subsection{Training objective}
To keep the tail mass small we add a penalty to the task loss:
\begin{equation}
\mathcal{L}(\vw) = \mathcal{L}_{\text{task}}(\vw) + \lambda \sum_{i=1}^{n} \tau_i(\vw), \label{eq:loss}
\end{equation}
and train with
$\vw^\star = \argmin_{\vw} \mathcal{L}(\vw)$.

\begin{lemma}
The penalty in \eqref{eq:loss} is differentiable almost everywhere in $\vw$.
\end{lemma}

\section{Results}\label{sec:results}
Table~\ref{tab:results} compares dense attention with our estimator at
$k = 64$. Accuracy is within $0.3$ points while latency drops sharply.

\begin{table}[h]
\centering
\caption{Retrieval accuracy (\%) and latency at $n = 32\,768$.}\label{tab:results}
\begin{tabular}{lccc}
\toprule
Method & Accuracy & Latency (ms) & Memory (GB) \\
\midrule
Dense attention & 91.4 & 412 & 38.2 \\
Sliding window & 84.0 & 71 & 6.1 \\
Top-$k$ (ours) & \textbf{91.1} & \textbf{67} & \textbf{5.8} \\
\bottomrule
\end{tabular}
\end{table}

\begin{figure}[h]
\centering
\includegraphics[width=0.8\linewidth]{latency.pdf}
\caption{Latency versus context length; the estimator scales linearly.}\label{fig:latency}
\end{figure}

As Figure~\ref{fig:latency} shows, the gap widens with $n$, matching the
$O(nkd)$ cost of \eqref{eq:est} against $O(n^2 d)$ for \eqref{eq:attn}.

\section{Conclusion}
A top-$k$ estimator with the bound of Theorem~\ref{thm:error} recovers dense
accuracy at a fraction of the cost.

\begin{thebibliography}{9}
\bibitem{vaswani2017} A. Vaswani et al. Attention is all you need. \emph{NeurIPS}, 2017.
\bibitem{child2019} R. Child et al. Generating long sequences with sparse transformers. \emph{arXiv:1904.10509}, 2019.
\end{thebibliography}

\end{document}
```

_36 math block(s) normalized, no issues._
