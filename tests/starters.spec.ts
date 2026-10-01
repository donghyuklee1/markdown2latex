import katex from "katex";
import { check, finish } from "./harness";
import { prepareForKatex } from "../src/lib/cleaner";
import { KATEX_OPTIONS } from "../src/lib/katexOptions";
import { STARTER_CATEGORIES, STARTER_COUNT } from "../src/lib/starters";

const broken: string[] = [];
for (const c of STARTER_CATEGORIES) {
  for (const s of c.items) {
    try {
      katex.renderToString(prepareForKatex(s.latex), { ...KATEX_OPTIONS, displayMode: true });
    } catch (err) {
      broken.push(c.id + " / " + s.name + ": " + (err as Error).message.split("\n")[0]);
    }
  }
}
check("every starter renders in KaTeX", broken.join("\n") || "none", "none");
const ids = STARTER_CATEGORIES.flatMap((c) => c.items.map((s) => s.id));
check("starter ids are unique", String(new Set(ids).size === ids.length), "true");
check("no empty category", STARTER_CATEGORIES.filter((c) => !c.items.length).map((c) => c.id).join(",") || "none", "none");
console.log("  info  " + STARTER_COUNT + " starters in " + STARTER_CATEGORIES.length + " categories");
finish("starters");
