import { check, finish } from "./harness";
import { bottomUp, mergeAi, namesIn, offlineModel, reduceEdges, topDown, variablesTable, type Step } from "../src/lib/derivation";

const SRC = String.raw`The critical field:
$$E_{crit} = \frac{q N_a W_{BR}}{\epsilon_s}$$
The breakdown voltage:
$$V_{BR} \approx \frac{1}{2} E_{crit} W_{BR}$$
Hence the doping:
$$N_a = \frac{\epsilon_s E_{crit}^2}{2 q V_{BR}}$$
where $q$ is the electron charge and $\epsilon_s$ is the permittivity of silicon.`;

/* --- names ------------------------------------------------------------------ */
check("subscripts are part of a name", namesIn("V_{BR} = E_{crit} W_{BR} + N_a").join(" "), "V_{BR} E_{crit} W_{BR} N_{a}");
check("loop indices and operator limits are not names", namesIn("\\sum_i x_i + h_{t+1} + \\max_{k} y").join(" "), "x h y");
check("functions and text are not names", namesIn("\\exp(z) + \\text{loss} + \\mathbf{W}_q").join(" "), "z \\mathbf{W}_{q}");

/* --- offline model ---------------------------------------------------------- */
const d = offlineModel(SRC);
check("offline: steps in a chain with roles", d.steps.map((s) => s.kind + ":" + s.uses.join(",")).join(" | "), "definition: | intermediate:s1 | final:s2");
check("offline: summaries name what a step defines", d.steps[1].summary, "Defines $V_{BR}$ from 2 quantities.");
check("offline: prose definitions reach the variable table", d.variables.filter((v) => v.meaning).map((v) => v.symbol + "=" + v.meaning).join("; "), "q=electron charge; \\epsilon_{s}=permittivity of silicon");

/* --- reduction and views ----------------------------------------------------- */
const mk = (id: string, uses: string[], kind: Step["kind"] = "intermediate"): Step => ({ id, kind, latex: "", title: id, summary: "", explanation: "", uses, lines: null, label: null });
const red = reduceEdges([mk("a", []), mk("b", ["a"]), mk("c", ["a", "b"]), mk("d", ["a", "b", "c"])]);
check("transitive reduction keeps only direct steps", red.map((s) => s.id + "<" + s.uses.join(",")).join(" "), "a< b<a c<b d<c");
const diamond = { title: "", steps: [mk("a", [], "definition"), mk("b", ["a"]), mk("c", ["a"]), mk("d", ["b", "c"], "final")], variables: [], ideas: [], ideaLinks: [], source: "offline" as const };
const tree = topDown(diamond)[0];
const flat = (n: ReturnType<typeof topDown>[0]): string => n.step.id + (n.ref ? "*" : "") + (n.children.length ? "(" + n.children.map(flat).join(",") + ")" : "");
check("top-down: rooted at the result, a shared step expands once", flat(tree), "d(b(a),c(a*))");
check("bottom-up: layers from foundations to result", bottomUp(diamond).map((l) => l.map((s) => s.id).join(",")).join(" / "), "a / b,c / d");

/* --- AI merge ---------------------------------------------------------------- */
const ai = {
  title: "Avalanche breakdown doping",
  steps: [
    { id: "a1", kind: "assumption", latex: "", title: "Abrupt junction", summary: "One-sided step junction.", explanation: "Assume $N_d \\gg N_a$.", uses: [] },
    { id: "s1", kind: "definition", title: "Critical field", summary: "Peak field at breakdown.", explanation: "From Gauss's law.", uses: ["a1"] },
    { id: "s2", kind: "intermediate", title: "Breakdown voltage", summary: "Triangle area.", explanation: "Integrate the field.", uses: ["s1", "a1"] },
    { id: "s3", kind: "final", title: "Doping from breakdown", summary: "Solve for $N_a$.", explanation: "Combine.", uses: ["s2", "s1", "s9"] },
    { id: "evil", kind: "final", title: "Invented", summary: "", explanation: "", uses: [] },
    { id: "s2", kind: "final", title: "duplicate", summary: "", explanation: "", uses: [] },
  ],
  variables: [{ symbol: "N_{a}", meaning: "acceptor doping", units: "cm^-3", domain: "", source: "inferred" }, { symbol: "", meaning: "x", source: "explicit" }],
  ideas: [{ id: "i1", label: "Gauss's law", detail: "Charge sets the field.", steps: ["s1", "nope"] }, { id: "i2", label: "Breakdown", detail: "Field hits the limit.", steps: ["s3"] }],
  ideaLinks: [{ from: "i1", to: "i2", label: "determines" }, { from: "i1", to: "ghost", label: "x" }],
};
const m = mergeAi(ai, d);
check("AI: invented and duplicate steps are dropped, assumptions kept", m.steps.map((s) => s.id).join(","), "a1,s1,s2,s3");
check("AI: equations keep their source lines and LaTeX", String(m.steps.find((s) => s.id === "s1")!.lines?.[0]) + " " + (m.steps.find((s) => s.id === "s1")!.latex.startsWith("E_{crit}") ? "ok" : "lost"), "2 ok");
check("AI: dependencies are validated and reduced", m.steps.map((s) => s.id + "<" + s.uses.join(",")).join(" "), "a1< s1<a1 s2<s1 s3<s2");
check("AI: ideas keep only real steps and links", m.ideas.map((i) => i.id + ":" + i.steps.join(",")).join(" ") + " | " + m.ideaLinks.length, "i1:s1 i2:s3 | 1");
check("AI: garbage input degrades to the offline model's variables", mergeAi(null, d).variables.length === d.variables.length ? "ok" : "lost", "ok");

/* --- LaTeX table --------------------------------------------------------------- */
const t = variablesTable([{ symbol: "N_a", meaning: "doping & density", units: "cm^-3", domain: "", source: "inferred", line: null }]);
check("variable table: booktabs, escaped text, units column only when needed", [t.includes("\\toprule"), t.includes("doping \\& density"), t.includes("Units"), !t.includes("Domain")].join(","), "true,true,true,true");
finish("derivation");
