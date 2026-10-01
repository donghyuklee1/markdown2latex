import katex from "katex";
import { check, finish } from "../harness";
import { KATEX_OPTIONS } from "../../src/lib/katexOptions";
import { tensorToTex, type TensorOptions } from "../../src/lib/lab/tensor2tex";

/** Every LaTeX string produced here must also render in KaTeX. */
const rendered: string[] = [];
function tex(input: string, options: Partial<TensorOptions> = {}) {
  const r = tensorToTex(input, options);
  if (r.latex) rendered.push(r.latex);
  return r;
}
const bare = { annotate: false };

/* ----------------------------------------------------------------- parse */

check("numpy repr with dtype", tex("array([[1., 2.],\n       [3., 4.]], dtype=float32)", bare).latex, "\\mathbf{X} = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}");
check("numpy print() without commas", tex("[[1 2]\n [3 4]]", bare).latex, "\\mathbf{X} = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}");
check(
  "pytorch repr with device and grad_fn",
  tex("tensor([[ 0.1234, -1.2000],\n        [ 2.0000,  3.0000]], device='cuda:0', grad_fn=<AddBackward0>)", bare).latex,
  "\\mathbf{X} = \\begin{bmatrix} 0.1234 & -1.2 \\\\ 2 & 3 \\end{bmatrix}",
);
check("scalar tensor(3.) is plain, not bold", tex("tensor(3.)", bare).latex, "X = 3");
check("plain python list, shape inferred", tex("[[1, 2, 3], [4, 5, 6]]").shape.join("x"), "2x3");
check("interpreter prompt and command line are skipped", tex(">>> x\narray([1, 2])", { ...bare, vector: "row" }).latex, "\\mathbf{X} = \\begin{bmatrix} 1 & 2 \\end{bmatrix}");

const ragged = tex("[[1, 2], [3]]");
check("ragged array is reported, not rendered", ragged.latex + "|" + ragged.error?.message, "|Ragged array: expected shape (2) but this element has shape (1).");
check("ragged error points at the offending row", ragged.error ? ragged.error.line + ":" + ragged.error.column : "none", "1:10");
const junk = tex("[[1, 2],\n [3, x]]");
check("bad token: error with line and column", junk.error ? junk.error.line + ":" + junk.error.column + " " + junk.error.message : "none", "2:6 Unexpected \"x\" - expected a number, [ or ].");
check("unclosed bracket never throws", tex("[[1, 2], [3, 4]").error?.message ?? "none", "Unclosed [ - the array ends before its closing bracket.");
check("empty input -> empty result, no error", JSON.stringify([tex("  ").latex, tex("  ").error]), '["",null]');

/* ------------------------------------------------------------ formatting */

check("integers stay integers even with fixed decimals", tex("array([[1, 20], [3, 4]])", { ...bare, decimals: 2 }).latex, "\\mathbf{X} = \\begin{bmatrix} 1 & 20 \\\\ 3 & 4 \\end{bmatrix}");
check("floats get fixed decimals", tex("[1., 2.5]", { ...bare, decimals: 2, vector: "row" }).latex, "\\mathbf{X} = \\begin{bmatrix} 1.00 & 2.50 \\end{bmatrix}");
check(
  "nan / inf / -inf / scientific",
  tex("[1.2e-04, nan, inf, -inf, 12345.6]", { ...bare, vector: "row" }).latex,
  "\\mathbf{X} = \\begin{bmatrix} 1.2 \\times 10^{-4} & \\mathrm{NaN} & \\infty & -\\infty & 1.23 \\times 10^{4} \\end{bmatrix}",
);
check("scientific does not fire on 0 or at 1e-3", tex("[0., 0.001, 9999.5]", { ...bare, vector: "row" }).latex, "\\mathbf{X} = \\begin{bmatrix} 0 & 0.001 & 9999.5 \\end{bmatrix}");
check("large integers are not turned scientific", tex("[100000, 2]", { ...bare, vector: "row" }).latex, "\\mathbf{X} = \\begin{bmatrix} 100000 & 2 \\end{bmatrix}");
check("complex numbers, numpy style", tex("array([1.+2.j, 0.-1.j, 3.5-0.5j])", { vector: "row" }).lines.join(" ; "), "\\mathbf{X} = \\begin{bmatrix} 1 + 2i & -i & 3.5 - 0.5i \\end{bmatrix} ; \\mathbf{X} \\in \\mathbb{C}^{d}, \\quad d = 3");
check("python complex list items in parentheses", tex("[(1+2j), (3-1j)]", { ...bare, vector: "row" }).latex, "\\mathbf{X} = \\begin{bmatrix} 1 + 2i & 3 - i \\end{bmatrix}");
check("booleans as 1/0 with {0,1} field", tex("tensor([True, False])", { vector: "row" }).lines.join(" ; "), "\\mathbf{X} = \\begin{bmatrix} 1 & 0 \\end{bmatrix} ; \\mathbf{X} \\in \\{0,1\\}^{d}, \\quad d = 2");
check("booleans as T/F", tex("[True, False]", { ...bare, bools: "TF", vector: "row" }).latex, "\\mathbf{X} = \\begin{bmatrix} \\mathrm{T} & \\mathrm{F} \\end{bmatrix}");

/* ------------------------------------------------------------ structure */

check("vector: column by default", tex("[1, 2]", bare).latex, "\\mathbf{X} = \\begin{bmatrix} 1 \\\\ 2 \\end{bmatrix}");
check("vector: transposed row, lowercase name", tex("[1, 2]", { ...bare, vector: "transpose", lowercaseVector: true }).latex, "\\mathbf{x} = \\begin{bmatrix} 1 & 2 \\end{bmatrix}^{\\top}");
check("pmatrix environment", tex("[[1]]", { ...bare, env: "pmatrix" }).latex, "\\mathbf{X} = \\begin{pmatrix} 1 \\end{pmatrix}");
check("array environment with column spec", tex("[[1, 2]]", { ...bare, env: "array" }).latex, "\\mathbf{X} = \\left[\\begin{array}{rr} 1 & 2 \\end{array}\\right]");
check(
  "summarized 2D: cdots, vdots, ddots",
  tex("array([[   0,    1, ...,   98,   99],\n       [ 100,  101, ...,  198,  199],\n       ...,\n       [9900, 9901, ..., 9998, 9999]])", bare).latex,
  "\\mathbf{X} = \\begin{bmatrix} 0 & 1 & \\cdots & 98 & 99 \\\\ 100 & 101 & \\cdots & 198 & 199 \\\\ \\vdots & \\vdots & \\ddots & \\vdots & \\vdots \\\\ 9900 & 9901 & \\cdots & 9998 & 9999 \\end{bmatrix}",
);
const summ = tex("[ 0  1  2 ... 7  8  9]");
check("summarized dims are unknown, not miscounted", JSON.stringify([summ.shape, summ.elements, summ.warnings.length]), "[[null],null,1]");
const cube = tex("np.arange(8).reshape(2,2,2)\narray([[[0, 1],\n        [2, 3]],\n\n       [[4, 5],\n        [6, 7]]])");
check(
  "3D: labelled slices plus annotation",
  cube.lines.join(" ; "),
  "\\mathbf{X}_{0,:,:} = \\begin{bmatrix} 0 & 1 \\\\ 2 & 3 \\end{bmatrix} ; \\mathbf{X}_{1,:,:} = \\begin{bmatrix} 4 & 5 \\\\ 6 & 7 \\end{bmatrix} ; \\mathbf{X} \\in \\mathbb{R}^{B \\times T \\times D}, \\quad B = 2,\\ T = 2,\\ D = 2",
);
check("3D: slice limit summarizes the rest", tex("[[[1]],[[2]],[[3]]]", { ...bare, maxSlices: 1 }).lines.join(" ; "), "\\mathbf{X}_{0,:,:} = \\begin{bmatrix} 1 \\end{bmatrix} ; \\vdots \\quad \\text{(2 more slices)}");
check("more than 10 columns warns about MaxMatrixCols", tex("[[" + Array.from({ length: 12 }, (_, k) => k).join(", ") + "]]").warnings.some((w) => w.includes("MaxMatrixCols")) ? "warned" : "silent", "warned");
check("10 columns do not warn", tex("[[" + Array.from({ length: 10 }, (_, k) => k).join(", ") + "]]").warnings.length.toString(), "0");

/* ------------------------------------------------------------ shapes */

const size = tex("torch.Size([32, 3, 224, 224])");
check("torch.Size -> NCHW annotation with sizes", size.latex, "\\mathbf{X} \\in \\mathbb{R}^{N \\times C \\times H \\times W}, \\quad N = 32,\\ C = 3,\\ H = 224,\\ W = 224");
check("torch.Size is shape-only with known element count", JSON.stringify([size.shapeOnly, size.elements]), "[true,4816896]");
check("NHWC convention", tex("(32, 224, 224, 3)", { convention: "alternate" }).dims.join(""), "NHWC");
check("symbolic shape keeps its names", tex("x.shape = (B, T, D)").latex, "\\mathbf{X} \\in \\mathbb{R}^{B \\times T \\times D}");
check("dimStyle numbers", tex("(2, 3)", { dimStyle: "numbers" }).latex, "\\mathbf{X} \\in \\mathbb{R}^{2 \\times 3}");
check("custom dims", tex("(4, 5)", { convention: "custom", customDims: "S, F" }).latex, "\\mathbf{X} \\in \\mathbb{R}^{S \\times F}, \\quad S = 4,\\ F = 5");
check("custom dims of the wrong length fall back with a warning", tex("(4, 5)", { convention: "custom", customDims: "a,b,c" }).dims.join("") + " " + tex("(4, 5)", { convention: "custom", customDims: "a,b,c" }).warnings.length, "mn 1");
check("a tuple with decimals is data, not a shape", tex("(1.5, 2)").shapeOnly ? "shape" : "not shape", "not shape");
check("Greek variable name uses \\boldsymbol", tex("(3, 3)", { name: "\\Theta" }).latex.startsWith("\\boldsymbol{\\Theta}") ? "yes" : "no", "yes");
check("field override", tex("(3,)", { field: "Z" }).latex, "\\mathbf{X} \\in \\mathbb{Z}^{d}, \\quad d = 3");

/* ------------------------------------------------------------ KaTeX */

let failures = 0;
for (const latex of rendered) {
  try {
    katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode: true, throwOnError: true });
  } catch (e) {
    failures++;
    console.log("    KaTeX failed on: " + latex + "\n    " + (e as Error).message);
  }
}
check("every LaTeX string above renders in KaTeX (" + rendered.length + " strings)", String(failures), "0");

finish("tensor2tex");
