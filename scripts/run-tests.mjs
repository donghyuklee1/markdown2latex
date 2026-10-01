/**
 * run-tests.mjs - runs every tests/**\/*.spec.ts in its own tsx process, in a
 * stable order, and fails if any does. Spec files stay independent scripts.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const specs = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".spec.ts")) specs.push(p);
  }
};
walk("tests");

let failed = 0;
for (const spec of specs) {
  console.log("\n# " + spec);
  const r = spawnSync(process.execPath, ["--import", "tsx", spec], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log("\n" + (failed ? failed + " of " + specs.length + " spec files failed" : "all " + specs.length + " spec files passed"));
process.exit(failed ? 1 : 0);
