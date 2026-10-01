/**
 * tools.ts - the Research Lab's table of contents. One entry per tool; the
 * sidebar, the URL-less selection state and the lazy loading all read from it.
 */
import { lazy, type ComponentType } from "react";

/** Panel modules, by tool. Kept separate so the Lab can warm them in advance. */
export const PANEL_LOADERS = {
  arxiv: () => import("./panels/ArxivPanel"),
  flatten: () => import("./panels/FlattenPanel"),
  tex2prose: () => import("./panels/Tex2ProsePanel"),
  symbols: () => import("./panels/SymbolsPanel"),
  tensor: () => import("./panels/TensorPanel"),
  bib: () => import("./panels/BibPanel"),
  template: () => import("./panels/TemplatePanel"),
  resizer: () => import("./panels/ResizerPanel"),
  images: () => import("./panels/ImagesPanel"),
} as const;
import {
  ArrowLeftRight,
  BookMarked,
  FileSearch,
  Grid3x3,
  ImageDown,
  Layers,
  ListTree,
  Ruler,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

export type ToolId =
  | "arxiv"
  | "flatten"
  | "tex2prose"
  | "symbols"
  | "tensor"
  | "bib"
  | "template"
  | "resizer"
  | "images";

export interface ToolInfo {
  id: ToolId;
  title: string;
  /** The CLI-style name from the spec, shown as a badge. */
  slug: string;
  icon: LucideIcon;
  group: "Sources" | "Writing" | "Submission";
  /** One line for the sidebar. */
  summary: string;
  Panel: ComponentType;
}

export const TOOLS: ReadonlyArray<ToolInfo> = [
  { id: "arxiv", title: "arXiv Formula Extractor", slug: "arxiv-math-scraper", icon: FileSearch, group: "Sources", summary: "Exact LaTeX of any equation, from the paper's source", Panel: lazy(PANEL_LOADERS.arxiv) },
  { id: "flatten", title: "Paper Flattener", slug: "tex-flatten", icon: Layers, group: "Sources", summary: "Inline \\input files and the .bbl into one .tex", Panel: lazy(PANEL_LOADERS.flatten) },
  { id: "tex2prose", title: "LLM Proofreading Shield", slug: "tex2prose", icon: ShieldCheck, group: "Writing", summary: "Hide maths and citations from an LLM, then restore them", Panel: lazy(PANEL_LOADERS.tex2prose) },
  { id: "symbols", title: "Symbol Table", slug: "symbol-table", icon: ListTree, group: "Writing", summary: "Every symbol used, flagged if never defined", Panel: lazy(PANEL_LOADERS.symbols) },
  { id: "tensor", title: "Tensor → Matrix", slug: "tensor2tex", icon: Grid3x3, group: "Writing", summary: "NumPy / PyTorch output to bmatrix, with shapes", Panel: lazy(PANEL_LOADERS.tensor) },
  { id: "bib", title: "BibTeX Cleaner", slug: "bibclean", icon: BookMarked, group: "Submission", summary: "Keys, names, journals, duplicates, escaping", Panel: lazy(PANEL_LOADERS.bib) },
  { id: "template", title: "Journal Template Converter", slug: "template-convert", icon: ArrowLeftRight, group: "Submission", summary: "NeurIPS ↔ IEEE ↔ LNCS ↔ ACM ↔ Nature", Panel: lazy(PANEL_LOADERS.template) },
  { id: "resizer", title: "Overflow Resizer", slug: "auto-resizer", icon: Ruler, group: "Submission", summary: "Fit wide equations and tables to the column", Panel: lazy(PANEL_LOADERS.resizer) },
  { id: "images", title: "Figure Optimizer", slug: "tex-img-opt", icon: ImageDown, group: "Submission", summary: "Shrink figures to print DPI, zip for Overleaf", Panel: lazy(PANEL_LOADERS.images) },
];

export const TOOL_GROUPS: ReadonlyArray<ToolInfo["group"]> = ["Sources", "Writing", "Submission"];
