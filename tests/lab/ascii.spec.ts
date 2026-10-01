/**
 * AGENTS.md rule 1: non-ASCII in src/lib/ is written as \uXXXX escapes. Half
 * of this project hunts invisible codepoints, so they must stay greppable.
 * This guard exists because an editor once silently decoded escapes back into
 * literal characters. defaultText.ts holds the Korean sample on purpose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { check, finish } from "../harness";

const offenders: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !p.endsWith("defaultText.ts")) {
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (/[^\x00-\x7F]/.test(line)) offenders.push(p + ":" + (i + 1));
      });
    }
  }
};
walk("src/lib");
check("src/lib is ASCII-only (escapes, not literal characters)", offenders.join("\n") || "clean", "clean");
finish("ascii");
