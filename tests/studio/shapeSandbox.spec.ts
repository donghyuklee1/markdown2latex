import { check, finish } from "../harness";
import {
  analyzeSandbox,
  extractDeclarations,
  latexBlocksFromSource,
  parseMapping,
  runCode,
  SAMPLE_CODE,
  SAMPLE_LATEX,
  symbolKey,
} from "../../src/lib/studio/shapeSandbox";

/** `name shape` for one variable, or the first error message. */
function shapeOf(code: string, name: string): string {
  const r = runCode(code);
  const v = r.variables.find((x) => x.name === name);
  return v ? v.shape : "missing; errors: " + r.errors.map((e) => e.message).join(" | ");
}
const errorsOf = (code: string) => runCode(code).errors.filter((e) => e.severity === "error").map((e) => e.line + ": " + e.message).join("\n") || "none";

/* ---- matmul */
check(
  "matmul: inner-dim mismatch is reported precisely",
  errorsOf("x = torch.randn(32, 128, 512)\nW = torch.randn(256, 512)\ny = x @ W"),
  "3: matmul: (32, 128, 512) @ (256, 512) - inner dims 512 vs 256",
);
check("matmul: batched @ matrix broadcasts the batch dims", shapeOf("x = torch.randn(32, 128, 512)\nW = torch.randn(512, 256)\ny = x @ W", "y"), "(32, 128, 256)");
check("matmul: vector on the right drops the column", shapeOf("A = np.zeros((3, 4))\nv = np.ones(4)\ny = np.matmul(A, v)", "y"), "(3,)");
check("bmm: batch dims must agree", errorsOf("a = torch.randn(4, 2, 3)\nb = torch.randn(5, 3, 7)\nc = torch.bmm(a, b)"), "3: bmm: batch dims 4 vs 5");

/* ---- broadcasting */
check("broadcast: (B, T, D) + (D,) is legal and not flagged", errorsOf("x = torch.randn(32, 128, 512)\nb = torch.zeros(512)\ny = x + b"), "none");
check("broadcast: size-1 dims stretch", shapeOf("x = torch.randn(32, 1, 512)\nm = torch.randn(128, 1)\ny = x * m", "y"), "(32, 128, 512)");
check(
  "broadcast: incompatible trailing dims are flagged",
  errorsOf("x = torch.randn(32, 128)\nb = torch.zeros(64)\ny = x + b"),
  "3: add: cannot broadcast (32, 128) with (64,) - dim -1: 128 vs 64",
);

/* ---- names, unpacking, symbolic dims */
check("tuple assignment binds ints", shapeOf("B, T, D = 32, 128, 512\nx = torch.randn(B, T, D)", "x"), "(32, 128, 512)");
check("unassigned names stay symbolic", shapeOf("x = torch.randn(B, T, D)\ny = x.mean(dim=1)", "y"), "(B, D)");
check("x.shape unpacking feeds later shapes", shapeOf("x = torch.randn(4, 5, 6)\nB, T, D = x.shape\nh = D // 2\nz = torch.zeros((B, h))", "z"), "(4, 3)");
check("unpack count mismatch is an error", errorsOf("x = torch.randn(4, 5)\nB, T, D = x.shape"), "2: unpack: expected 3 values, got 2");
check("len(), .size(i), .shape[-1]", shapeOf("x = torch.randn(7, 8, 9)\nn = len(x) + x.size(1) + x.shape[-1]", "n"), "= 24");

/* ---- reshape family */
check("view infers -1", shapeOf("x = torch.randn(32, 128, 512)\ny = x.view(32, 128, 8, -1)", "y"), "(32, 128, 8, 64)");
check("view with symbolic dims cancels by name", shapeOf("x = torch.randn(B, T, D)\ny = x.reshape(B, T, 8, -1)", "y"), "(B, T, 8, D // 8)");
check(
  "reshape: element-count mismatch is reported",
  errorsOf("x = torch.randn(32, 128, 512)\ny = x.reshape(32, 128, 8, 32)"),
  "2: reshape: cannot view (32, 128, 512) (2097152 elements) as (32, 128, 8, 32) (1048576 elements)",
);
check("flatten(1) and unsqueeze/squeeze", shapeOf("x = torch.randn(2, 3, 4, 5)\ny = x.flatten(1).unsqueeze(0).squeeze(0)", "y"), "(2, 60)");
check("permute / transpose / .T / .mT", shapeOf("x = torch.randn(2, 3, 4)\na = x.permute(2, 0, 1).transpose(0, 1).mT", "a") + " " + shapeOf("m = np.zeros((3, 4))\nt = m.T", "t"), "(2, 3, 4) (4, 3)");
check("permute with a wrong arity is an error", errorsOf("x = torch.randn(2, 3, 4)\ny = x.permute(1, 0)"), "2: permute: (2, 3, 4) has 3 dims but 2 were given");

/* ---- reductions, cat/stack, einsum */
check("sum(dim, keepdim=True) keeps a 1; keepdim=False drops it", shapeOf("x = torch.randn(2, 3, 4)\na = x.sum(dim=-1, keepdim=True)", "a") + " " + shapeOf("x = torch.randn(2, 3, 4)\nb = x.sum(dim=-1, keepdim=False)", "b"), "(2, 3, 1) (2, 3)");
check("max(dim) unpacks to values, indices", shapeOf("x = torch.randn(2, 3)\nv, i = x.max(dim=1)", "i"), "(2,)");
check("cat sums the concat dim", shapeOf("a = torch.randn(2, 3)\nb = torch.randn(2, 5)\nc = torch.cat([a, b], dim=1)", "c"), "(2, 8)");
check("cat with mismatched other dims is an error", errorsOf("a = torch.randn(2, 3)\nb = torch.randn(4, 5)\nc = torch.cat([a, b], dim=1)"), "3: cat: sizes must match except in dim 1 - (2, 3) vs (4, 5) at dim 0");
check("stack inserts a new dim", shapeOf("a = torch.randn(2, 3)\nc = torch.stack([a, a, a], dim=0)", "c"), "(3, 2, 3)");
check("einsum reads the subscripts", shapeOf("q = torch.randn(2, 8, 10, 64)\nk = torch.randn(2, 8, 12, 64)\ns = torch.einsum('bhqd,bhkd->bhqk', q, k)", "s"), "(2, 8, 10, 12)");
check("einsum flags a letter bound to two sizes", errorsOf("a = torch.randn(3, 4)\nb = torch.randn(5, 6)\nc = torch.einsum('ij,jk->ik', a, b)"), "3: einsum: 'j' is 4 in operand 1 but 5 in operand 2");

/* ---- layers and literals */
check("nn.Linear maps the last dim", shapeOf("lin = nn.Linear(512, 256)\nx = torch.randn(8, 512)\ny = F.relu(lin(x))", "y"), "(8, 256)");
check(
  "nn.Linear with the wrong in_features is an error",
  errorsOf("lin = nn.Linear(256, 10)\nx = torch.randn(8, 512)\ny = lin(x)"),
  "3: Linear(256, 10): input (8, 512) has last dim 512, expected in_features 256",
);
check("nn.Conv2d output size", shapeOf("conv = nn.Conv2d(3, 16, 3, stride=2, padding=1)\nimg = torch.randn(8, 3, 32, 32)\nf = conv(img)", "f"), "(8, 16, 16, 16)");
check("subscripts: int, slice, ellipsis, None", shapeOf("x = torch.randn(4, 5, 512)\nD = 64\ny = x[:, 0][..., :D][None]", "y"), "(1, 4, 64)");
check("torch.tensor of a nested list", shapeOf("t = torch.tensor([[1, 2, 3], [4, 5, 6]])", "t"), "(2, 3)");
check("ragged nested list is an error", errorsOf("t = np.array([[1, 2], [3]])"), "1: tensor: nested lists have unequal lengths (ragged)");

/* ---- robustness */
{
  const r = runCode("import torch\nfor i in range(3):\n    x = i\nB = 4\nx = torch.zeros(B, 2)\ny = x @@ 2\nz = x.sum(0)");
  check("for-blocks warn and are skipped; syntax errors do not stop evaluation", r.errors.map((e) => e.severity + "@" + e.line).join(" ") + " | " + r.variables.map((v) => v.name + v.shape).join(" "), "warning@2 error@6 | B= 4 x(4, 2) z(2,)");
}

/* ---- LaTeX declarations */
{
  const blocks = latexBlocksFromSource(
    "Let $\\mathbf{W}_q \\in \\mathbb{R}^{d \\times d_k}$ and\n$$x \\in \\mathbb{R}^{d},\\quad Z \\in \\mathbb{C}^{B \\times T \\times D},\\quad m \\in \\{0,1\\}^{n}$$\nfor $i \\in \\{1, \\dots, n\\}$.",
  );
  const d = extractDeclarations(blocks);
  check(
    "declarations: names normalized, dims split, fields and lines kept",
    d.map((x) => x.name + ":" + x.field + ":" + x.dims.map((y) => y.value ?? y.name).join("x") + "@" + x.line).join(" "),
    "W_q:R:dxd_k@1 x:R:d@2 Z:C:BxTxD@2 m:{0,1}:n@2",
  );
}
check("declarations: d_{\\text{model}} normalizes to d_model", extractDeclarations([{ text: "E \\in \\mathbb{R}^{V \\times d_{\\text{model}}}", line: null }])[0].dims[1].name ?? "", "d_model");
check("symbolKey makes W_q, Wq, w_q and \\mathbf{W}_{q} agree", [symbolKey("W_q"), symbolKey("Wq"), symbolKey("w_q"), symbolKey("\\mathbf{W}_{q}")].join(","), "wq,wq,wq,wq");

/* ---- matching, bindings, equations */
{
  const r = analyzeSandbox(SAMPLE_CODE, latexBlocksFromSource(SAMPLE_LATEX));
  check("sample: code runs clean", r.errors.length + " errors", "0 errors");
  check("sample: exactly W_v mismatches", r.checks.map((c) => c.latexName + "=" + c.status).join(" "), "X=match W_q=match W_k=match W_v=mismatch W_o=match");
  check("sample: d binds 512 and d_k is a conflict", r.bindings.map((b) => b.symbol + "=" + b.value + (b.conflict ? "!" : "")).join(" "), "d=512 d_k=64! n=128");
  check("sample: equations define Q/K/V/A and catch A W_o", r.equationChecks.map((e) => e.status).join(" "), "match match match match mismatch");
  check("sample: batch dim is ignored with a note", r.checks[0].note, "ignoring leading batch dim(s) (32,)");
}
{
  const latex = [{ text: "\\mathbf{W} \\in \\mathbb{R}^{m \\times n},\\ x \\in \\mathbb{R}^{n},\\ b \\in \\mathbb{R}^{m}", line: 1 }, { text: "y = \\mathbf{W}x + b", line: 2 }];
  const ok = analyzeSandbox("", latex);
  check("equation: y = Wx + b checks (and defines y)", ok.equationChecks.map((e) => e.status + " " + e.rhsShape).join(";"), "match m");
  const bad = analyzeSandbox("", [latex[0], { text: "y = x\\mathbf{W}", line: 2 }]);
  check("equation: x W with x in R^n and W in R^{m x n} is flagged", bad.equationChecks.map((e) => e.status).join(";"), "mismatch");
  const bias = analyzeSandbox("", [{ text: "X \\in \\mathbb{R}^{n \\times d}, W \\in \\mathbb{R}^{d \\times k}, b \\in \\mathbb{R}^{k}, Y \\in \\mathbb{R}^{n \\times k}", line: 1 }, { text: "Y = XW + b", line: 2 }]);
  check("equation: row-broadcast bias is legal", bias.equationChecks.map((e) => e.status + ":" + e.note).join(";"), "match:");
}
{
  const code = "proj = torch.randn(64, 32)";
  const latex = [{ text: "P \\in \\mathbb{R}^{64 \\times 32}", line: 1 }];
  check("unmatched symbol is unknown", analyzeSandbox(code, latex).checks[0].status, "unknown");
  check("an explicit mapping pairs P with proj", analyzeSandbox(code, latex, { mapping: parseMapping("P = proj") }).checks.map((c) => c.codeVar + ":" + c.status).join(""), "proj:match");
  check("a mapped variable with another shape mismatches", analyzeSandbox("proj = torch.randn(32, 64)", latex, { mapping: { P: "proj" } }).checks[0].status, "mismatch");
}

finish("shapeSandbox");
