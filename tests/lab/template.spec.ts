import { check, finish } from "../harness";
import { convertTemplate, detectTemplate, extractMeta, type PaperMeta } from "../../src/lib/lab/template";

const BODY = String.raw`\section{Introduction}
Transformers~\cite{vaswani2017} are large. % keep this comment
\begin{equation}
  \mathcal{L} = \sum_i \ell(x_i)
  \label{eq:loss}
\end{equation}
\begin{verbatim}
\begin{figure*} stays verbatim
\end{verbatim}
`;

const NEURIPS = String.raw`\documentclass{article}
\usepackage[final]{neurips_2024}
\usepackage{amsmath}
\usepackage{natbib}
\newcommand{\R}{\mathbb{R}}

\title{Sparse Attention Is All You Prune}

\author{%
  Ada Lovelace\thanks{Work done at Analytical Labs.} \\
  Department of Computer Science\\
  University of Cambridge, Cambridge, UK \\
  \texttt{ada@cam.ac.uk} \\
  \And
  Alan Turing \\
  Google DeepMind, London, UK \\
  \texttt{alan@deepmind.com} \\
}

\begin{document}

\maketitle

\begin{abstract}
We prune attention heads by 60\% with no loss in accuracy.
\end{abstract}

` + BODY + String.raw`\begin{figure*}[t]
  \centering
  \includegraphics[width=\textwidth]{figs/overview}
  \caption{Overview.}
\end{figure*}

\begin{ack}
We thank the reviewers.
\end{ack}

\bibliographystyle{plainnat}
\bibliography{refs}

\end{document}
`;

const IEEE = String.raw`\documentclass[conference]{IEEEtran}
\IEEEoverridecommandlockouts
\usepackage{cite}
\usepackage{amsmath}

\begin{document}

\title{Fast Kernels}

\author{\IEEEauthorblockN{Grace Hopper}
\IEEEauthorblockA{\textit{Dept. of Navy Computing} \\
\textit{Yale University}\\
New Haven, USA \\
grace@yale.edu}
\and
\IEEEauthorblockN{John Backus}
\IEEEauthorblockA{\textit{IBM Research} \\
San Jose, USA \\
backus@ibm.com}
}

\maketitle

\begin{abstract}
Kernels, faster.
\end{abstract}

\begin{IEEEkeywords}
GPU, compilers, kernels
\end{IEEEkeywords}

\section{Introduction}
\IEEEPARstart{T}{his} paper is short.
\begin{IEEEproof}
Trivial.
\end{IEEEproof}

\section*{Acknowledgment}
Thanks to the Navy.

\bibliographystyle{IEEEtran}
\bibliography{refs}
\end{document}
`;

const IEEE_JOURNAL = String.raw`\documentclass[journal]{IEEEtran}
\begin{document}
\title{Journal Paper}
\author{Michael~Shell,~\IEEEmembership{Member,~IEEE,}
        and~John~Doe,~\IEEEmembership{Fellow,~OSA}%
\thanks{M. Shell is with Georgia Institute of Technology, Atlanta, USA (e-mail: shell@gatech.edu).}%
\thanks{J. Doe is with Anonymous University, Paris, France.}}
\maketitle
\section{Intro}
x
\end{document}
`;

const LNCS = String.raw`\documentclass[runningheads]{llncs}
\begin{document}
\title{Proof Nets}
\author{Kurt G\"odel\inst{1} \and Emmy Noether\inst{2}}
\authorrunning{K. G\"odel and E. Noether}
\institute{Princeton University, Princeton, USA \\ \email{kurt@ias.edu} \and
University of G\"ottingen, Germany \\ \email{emmy@uni-goettingen.de}}
\maketitle
\begin{abstract}
Short abstract.
\keywords{logic \and proofs \and nets}
\end{abstract}
\section{Intro}
Body.
\end{document}
`;

const ACM = String.raw`\documentclass[sigconf]{acmart}
\setcopyright{acmlicensed}
\acmConference[KDD '25]{KDD}{August}{Toronto}
\begin{document}
\title{Graph Things}
\author{Ann Smith}
\email{ann@mit.edu}
\affiliation{%
  \institution{MIT}
  \city{Cambridge}
  \country{USA}}
\author{Bob Lee}
\affiliation{\institution{ETH Zurich}\country{Switzerland}}
\begin{abstract}
Graphs.
\end{abstract}
\begin{CCSXML}
<ccs2012></ccs2012>
\end{CCSXML}
\ccsdesc[500]{Computing methodologies}
\keywords{graphs, learning}
\maketitle
\section{Intro}
Body.
\begin{acks}
Funded.
\end{acks}
\end{document}
`;

const NATURE = String.raw`\documentclass[pdflatex,sn-mathphys-num]{sn-jnl}
\begin{document}
\title[Short]{Long Nature Title}
\author*[1,2]{\fnm{Marie} \sur{Curie}}\email{marie@sorbonne.fr}
\author[2]{\fnm{Pierre} \sur{Curie}}
\affil*[1]{\orgdiv{Physics}, \orgname{Sorbonne}, \orgaddress{\city{Paris}, \country{France}}}
\affil[2]{\orgname{ESPCI}, \orgaddress{\country{France}}}
\abstract{Radium.}
\keywords{radioactivity, polonium}
\maketitle
\section{Intro}
Body.
\end{document}
`;

const authors = (m: PaperMeta) => m.authors.map((a) => a.name + " <" + (a.email ?? "") + "> [" + a.affiliations.map((f) => f.institution + "/" + (f.country ?? "")).join(";") + "]").join(" | ");

// detection
check("detect: neurips/ieee/lncs/acm/nature/article", [NEURIPS, IEEE, LNCS, ACM, NATURE, "\\documentclass{article}"].map(detectTemplate).join(","), "neurips,ieee,lncs,acm,nature,article");
check("detect: a commented-out neurips package is not NeurIPS", detectTemplate("\\documentclass{article}\n% \\usepackage{neurips_2024}\n"), "article");

// extraction per idiom
check("extract NeurIPS stacked authors", authors(extractMeta(NEURIPS)), "Ada Lovelace <ada@cam.ac.uk> [University of Cambridge/UK] | Alan Turing <alan@deepmind.com> [Google DeepMind/UK]");
check("extract NeurIPS \\thanks", String(extractMeta(NEURIPS).authors[0].thanks), "Work done at Analytical Labs.");
check("extract IEEE author blocks", authors(extractMeta(IEEE)), "Grace Hopper <grace@yale.edu> [Yale University/USA] | John Backus <backus@ibm.com> [IBM Research/USA]");
check("extract IEEE keywords env", extractMeta(IEEE).keywords.join("|"), "GPU|compilers|kernels");
check("extract IEEE journal \\IEEEmembership + \\thanks", authors(extractMeta(IEEE_JOURNAL)), "Michael Shell <shell@gatech.edu> [Georgia Institute of Technology/USA] | John Doe <> [Anonymous University/France]");
check("extract LNCS \\inst + \\institute + \\email", authors(extractMeta(LNCS)), 'Kurt G\\"odel <kurt@ias.edu> [Princeton University/USA] | Emmy Noether <emmy@uni-goettingen.de> [University of G\\"ottingen/Germany]');
check("extract LNCS keywords out of the abstract", extractMeta(LNCS).keywords.join("|") + " / " + extractMeta(LNCS).abstract, "logic|proofs|nets / Short abstract.");
check("extract ACM author + affiliation + email", authors(extractMeta(ACM)), "Ann Smith <ann@mit.edu> [MIT/USA] | Bob Lee <> [ETH Zurich/Switzerland]");
check("extract sn-jnl author*/affil*", authors(extractMeta(NATURE)) + " " + extractMeta(NATURE).authors[0].corresponding, "Marie Curie <marie@sorbonne.fr> [Sorbonne/France;ESPCI/France] | Pierre Curie <> [ESPCI/France] true");
check("extract sn-jnl \\abstract{} and short title", extractMeta(NATURE).abstract + " / " + extractMeta(NATURE).shortTitle, "Radium. / Short");

// generation: NeurIPS -> IEEE
{
  const r = convertTemplate(NEURIPS, "ieee", "conference");
  check("NeurIPS->IEEE: class line", r.output.split("\n")[0], "\\documentclass[conference]{IEEEtran}");
  check("NeurIPS->IEEE: neurips package gone", String(/neurips_2024/.test(r.output)), "false");
  check("NeurIPS->IEEE: author blocks", String(r.output.includes("\\IEEEauthorblockN{Alan Turing}\n\\IEEEauthorblockA{\\textit{Google DeepMind, London, UK} \\\\\nalan@deepmind.com}")), "true");
  check("NeurIPS->IEEE: two-column keeps figure*", String(r.output.includes("\\begin{figure*}[t]")), "true");
  check("NeurIPS->IEEE: bib style", String(r.output.includes("\\bibliographystyle{IEEEtran}") && !r.output.includes("plainnat")), "true");
  check("NeurIPS->IEEE: ack becomes \\section*{Acknowledgment}", String(r.output.includes("\\section*{Acknowledgment}\nWe thank the reviewers.")), "true");
  check("NeurIPS->IEEE: body text and comments unchanged", String(r.output.includes(BODY)), "true");
  check("NeurIPS->IEEE: user macros kept", String(r.output.includes("\\newcommand{\\R}{\\mathbb{R}}")), "true");
}
{
  const r = convertTemplate(NEURIPS, "ieee", "journal");
  check("NeurIPS->IEEE journal: \\thanks author block + membership todo", String(r.output.includes("\\author{Ada~Lovelace, Alan~Turing%\n\\thanks{Ada Lovelace is with") && r.todos.some((t) => t.includes("IEEEmembership"))), "true");
}
// single-column targets
{
  const r = convertTemplate(NEURIPS, "lncs");
  check("NeurIPS->LNCS: figure* -> figure", String(r.output.includes("\\begin{figure}[t]") && r.output.includes("\\end{figure}\n") && !/\\begin\{figure\*\}\[t\]/.test(r.output)), "true");
  check("NeurIPS->LNCS: verbatim figure* untouched", String(r.output.includes("\\begin{figure*} stays verbatim")), "true");
  check("NeurIPS->LNCS: \\inst + \\institute with \\email", String(r.output.includes("\\author{Ada Lovelace\\inst{1}") && r.output.includes("\\institute{Department of Computer Science, University of Cambridge, Cambridge, UK \\\\\n\\email{ada@cam.ac.uk}")), "true");
  check("NeurIPS->LNCS: splncs04", String(r.output.includes("\\bibliographystyle{splncs04}")), "true");
}
{
  const r = convertTemplate(NEURIPS, "acm");
  const o = r.output;
  check("NeurIPS->ACM: abstract and keywords before \\maketitle", String(o.indexOf("\\begin{abstract}") < o.indexOf("\\maketitle")), "true");
  check("NeurIPS->ACM: natbib dropped (acmart loads it)", String(/\\usepackage\{natbib\}/.test(o)), "false");
  check("NeurIPS->ACM: structured affiliation", String(o.includes("\\affiliation{%\n  \\institution{Google DeepMind}\n  \\city{London}\n  \\country{UK}}")), "true");
  check("NeurIPS->ACM: rights/CCS/conference todos", String(["acmConference", "setcopyright", "CCS"].every((k) => r.todos.some((t) => t.includes(k)))), "true");
  check("NeurIPS->ACM: acks env", String(o.includes("\\begin{acks}\nWe thank the reviewers.\n\\end{acks}")), "true");
}
{
  const r = convertTemplate(NEURIPS, "nature");
  check("NeurIPS->Nature: sn-jnl authors and affils", String(r.output.includes("\\author*[1]{\\fnm{Ada} \\sur{Lovelace}}\\email{ada@cam.ac.uk}") && r.output.includes("\\affil[2]{\\orgname{Google DeepMind}, \\orgaddress{\\city{London}, \\country{UK}}}")), "true");
  check("NeurIPS->Nature: \\bibliographystyle removed, declarations todo", String(!r.output.includes("\\bibliographystyle") && r.todos.some((t) => t.includes("Declarations"))), "true");
}
// leaving IEEE
{
  const r = convertTemplate(IEEE, "neurips");
  const o = r.output;
  check("IEEE->NeurIPS: \\IEEEPARstart becomes text", String(o.includes("\nThis paper is short.")), "true");
  check("IEEE->NeurIPS: IEEEproof -> proof (+amsthm)", String(o.includes("\\begin{proof}\nTrivial.\n\\end{proof}") && o.includes("\\usepackage{amsthm}")), "true");
  check("IEEE->NeurIPS: keywords dropped, IEEE preamble line removed", String(!o.includes("IEEEkeywords") && !o.includes("IEEEoverridecommandlockouts")), "true");
  check("IEEE->NeurIPS: stacked author block", String(o.includes("  Grace Hopper \\\\\n  Dept. of Navy Computing, Yale University, New Haven, USA \\\\\n  \\texttt{grace@yale.edu} \\And")), "true");
  check("IEEE->NeurIPS: ack heading -> ack env", String(o.includes("\\begin{ack}\nThanks to the Navy.\n\\end{ack}")), "true");
  check("IEEE->NeurIPS: checklist todo", String(r.todos.some((t) => t.includes("Checklist"))), "true");
}
check("proof -> IEEEproof entering IEEE", String(convertTemplate("\\documentclass{article}\n\\begin{document}\n\\begin{proof}x\\end{proof}\n\\end{document}\n", "ieee").output.includes("\\begin{IEEEproof}x\\end{IEEEproof}")), "true");
check("ACM->LNCS drops rights, conference and CCS lines", String(!convertTemplate(ACM, "lncs").output.match(/setcopyright|acmConference|CCSXML|ccsdesc/)), "true");
check("ACM->LNCS: keywords move inside abstract", String(convertTemplate(ACM, "lncs").output.includes("Graphs.\n\n\\keywords{graphs \\and learning}\n\\end{abstract}")), "true");
check(
  "LNCS target comments out predefined \\newtheorem, guards amsthm",
  String(
    ((o) => o.includes("% \\newtheorem{theorem}{Theorem}") && o.includes("\\newtheorem{assumption}{Assumption}\n") && o.includes("\\let\\proof\\relax"))(
      convertTemplate("\\documentclass{article}\n\\usepackage{amsthm}\n\\newtheorem{theorem}{Theorem}\n\\newtheorem{assumption}{Assumption}\n\\begin{document}\nx\n\\end{document}\n", "lncs").output,
    ),
  ),
  "true",
);
check("no \\begin{document}: input returned unchanged with a todo", ((r) => String(r.output === "junk" && r.todos.length === 1))(convertTemplate("junk", "acm")), "true");

finish("template");
