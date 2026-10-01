import { check, finish } from "../harness";
import {
  analyzeEquation,
  analyzeUnits,
  describeDims,
  equationsFromSource,
  formatBaseUnits,
  parseOverride,
  parseUnitExpression,
  SAMPLE_EQUATIONS,
} from "../../src/lib/studio/units";

const status = (latex: string, overrides: Record<string, string> = {}) => analyzeEquation(latex, overrides).status;
const kinds = (latex: string, overrides: Record<string, string> = {}) =>
  analyzeEquation(latex, overrides).notes.filter((n) => n.kind !== "assumption").map((n) => n.kind).join(",") || "none";

/* ---- formatting */
check("base units use middle dots and superscripts", formatBaseUnits([1, 2, -2, 0, 0, 0, 0]), "kg\u00b7m\u00b2\u00b7s\u207b\u00b2");
check("describe names the nearest SI quantity", describeDims([1, 2, -2, 0, 0, 0, 0]), "Energy [kg\u00b7m\u00b2\u00b7s\u207b\u00b2] (J)");
check("rational exponents print as fractions", formatBaseUnits([0, 0.5, 0, 0, 0, 0, 0]), "m^(1/2)");

/* ---- the canonical pair */
check("E = mc^2 is consistent", status("E = mc^2"), "consistent");
check("E = mc is a mismatch", status("E = mc"), "mismatch");
check(
  "mismatch message names both sides",
  analyzeEquation("E = m c").message,
  "Left side: Energy [kg\u00b7m\u00b2\u00b7s\u207b\u00b2] (J), Right side: Momentum [kg\u00b7m\u00b7s\u207b\u00b9] - mismatch",
);

/* ---- sums */
check("a sum of energies passes", status("E = \\frac{1}{2} m v^2 + m g h"), "consistent");
check("an inconsistent sum is flagged as a missing term", kinds("x = x_0 + v_0 t + \\frac{1}{2} v t^2"), "sum");
check("missing-term text mentions both terms", /x_0 is Length.*missing term\?/.test(analyzeEquation("x = x_0 + v t^2").notes[0].message) ? "yes" : "no", "yes");

/* ---- functions */
check("\\sin(\\omega t) passes", status("y = r \\sin(\\omega t)"), "consistent");
check("\\sin(t) flags a non-dimensionless argument", kinds("y = r\\sin(t)"), "function");
check("e^{-t/\\tau} passes", kinds("x = x_0 e^{-t/\\tau}"), "none");
check("e^{t} flags its exponent", kinds("x = x_0 e^{t}"), "function");
check("\\ln(x/x_0) passes but \\ln x flags", kinds("t = \\tau \\ln(x/x_0)") + " / " + kinds("t = \\tau \\ln x"), "none / function");

/* ---- powers, roots, derivatives, integrals */
check("\\sqrt{L/g} is a time (with T overridden to a period)", status("T = 2\\pi\\sqrt{\\frac{L}{g}}", { T: "time" }), "consistent");
check("without the override, T is a temperature and mismatches", status("T = 2\\pi\\sqrt{\\frac{L}{g}}"), "mismatch");
check("\\sqrt[3]{V_0} of a volume is a length", status("r = \\sqrt[3]{V_0}", { V_0: "volume" }), "consistent");
check("symbolic exponent on a dimensional base is flagged", kinds("y = x^{n}", { n: "dimensionless" }), "power");
check("symbolic exponent on a dimensionless base is fine", kinds("y = y_0 \\alpha^{n}", { n: "dimensionless" }), "none");
check("Leibniz derivative dx/dt = v", status("\\frac{dx}{dt} = v"), "consistent");
check("second derivative d^2x/dt^2 = a", status("\\frac{d^2 x}{dt^2} = a"), "consistent");
check("wave equation with partials", status("\\frac{\\partial^2 y}{\\partial t^2} = c^2 \\frac{\\partial^2 y}{\\partial x^2}"), "consistent");
check("wrong wave equation (missing c^2) is caught", status("\\frac{\\partial^2 y}{\\partial t^2} = \\frac{\\partial^2 y}{\\partial x^2}"), "mismatch");
check("\\int F\\,dx = W", status("W = \\int_0^L F \\, dx"), "consistent");
check("\\dot{x} is a velocity", status("\\dot{x} = v"), "consistent");
check("\\nabla adds 1/L", status("\\vec{F} = -\\nabla U"), "consistent");

/* ---- units */
check("unit expressions: m/s^2", describeDims(parseUnitExpression("m/s^2") ?? []), "Acceleration [m\u00b7s\u207b\u00b2]");
check("unit expressions with prefixes and \\Omega", [parseUnitExpression("kg m^2 s^-2"), parseUnitExpression("k\\Omega"), parseUnitExpression("\\mu m"), parseUnitExpression("J/(mol K)")].map((d) => (d ? describeDims(d) : "null")).join(" | "), "Energy [kg\u00b7m\u00b2\u00b7s\u207b\u00b2] (J) | Resistance [kg\u00b7m\u00b2\u00b7s\u207b\u00b3\u00b7A\u207b\u00b2] (\u03a9) | Length [m] | Molar gas constant [kg\u00b7m\u00b2\u00b7s\u207b\u00b2\u00b7K\u207b\u00b9\u00b7mol\u207b\u00b9]");
check("numbers with units on the right-hand side", status("g \\approx 9.81\\,\\mathrm{m/s^2}") + " " + status("v = 3\\,\\mathrm{km}\\,\\mathrm{h}^{-1}"), "consistent consistent");
check("a wrong unit is caught", status("v = 3\\,\\mathrm{kg}"), "mismatch");
check("eV is an energy", status("E = 13.6\\,\\text{eV}"), "consistent");

/* ---- symbols, overrides, relations */
check("unknown symbols make the result incomplete, not a mismatch", status("E = m c^2 \\xi"), "incomplete");
check("an override resolves the unknown", status("E = m c^2 \\xi", { "\\xi": "dimensionless" }), "consistent");
check("free-form override `kg m^2 s^-2`", status("Z = E", { Z: "kg m^2 s^-2" }), "consistent");
check("overrides accept quantity labels", describeDims(parseOverride("Spring constant") ?? []), "Spring constant [kg\u00b7s\u207b\u00b2]");
check("h is Planck's constant next to a frequency", status("E = h\\nu"), "consistent");
check("h is a height otherwise", status("U = m g h"), "consistent");
check("\\propto is not compared strictly", status("F \\propto m"), "skipped");
check("\\le is compared", status("v \\le c") + " " + status("v \\le m"), "consistent mismatch");
check("subscripted symbols fall back to their base letter", status("E_k = \\frac{1}{2} m_e v_1^2"), "consistent");

/* ---- documents */
{
  const eqs = equationsFromSource("Text\n$$E = mc^2$$\nmore $p = m v$ and\n\\begin{align}\nF &= m a \\\\\n  &= \\frac{dp}{dt}\n\\end{align}");
  check("equations come with their lines; align continuations inherit the LHS", eqs.map((e) => e.line + ":" + e.latex).join(" | "), "2:E = mc^2 | 3:p = m v | 5:F = m a | 6:F = \\frac{dp}{dt}");
}
{
  const a = analyzeUnits(equationsFromSource(SAMPLE_EQUATIONS));
  check("sample: one mismatch, one inconsistent sum, the rest consistent", a.results.map((r) => r.status[0]).join(""), "cmcmccccc");
  check("symbol table lists every symbol with its source", a.symbols.filter((s) => s.symbol === "c" || s.symbol === "x_0").map((s) => s.symbol + ":" + s.quantity + ":" + s.source).join(" "), "c:velocity:default x_0:length:default");
}

finish("units");
