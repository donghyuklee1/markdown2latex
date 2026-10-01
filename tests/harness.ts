/**
 * harness.ts - the whole "test framework": named equality checks and a summary.
 * Each spec file imports `check`, runs synchronously or awaits, then calls
 * `finish()`, which exits non-zero on any failure.
 */
let failures = 0;
let passes = 0;

export function check(name: string, actual: string, expected: string): void {
  if (actual === expected) {
    passes++;
    console.log("  pass  " + name);
    return;
  }
  failures++;
  console.log("  FAIL  " + name);
  console.log("    expected:\n" + expected.split("\n").map((l) => "      | " + l).join("\n"));
  console.log("    actual:\n" + actual.split("\n").map((l) => "      | " + l).join("\n"));
}

export function finish(suite: string): void {
  console.log("");
  if (failures) {
    console.log(suite + ": " + failures + " check(s) failed");
    process.exit(1);
  }
  console.log(suite + ": all " + passes + " checks passed");
}
