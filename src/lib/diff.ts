/**
 * diff.ts - what did the cleaner actually change?
 *
 * A line diff (Myers' O(ND) algorithm) between the input and the output, with a
 * second, word-level pass over each changed line pair so the view can point at
 * the exact `$$` that was stripped or the `&` that was added.
 */

export type DiffKind = "equal" | "insert" | "delete";

export interface Piece {
  text: string;
  /** True when this run differs from the other side of the line pair. */
  changed: boolean;
}

export interface DiffLine {
  kind: DiffKind;
  /** 1-indexed line numbers; absent on the side the line does not exist. */
  before?: number;
  after?: number;
  pieces: Piece[];
}

/** Myers diff over two sequences. Returns the edit script as runs of equal/insert/delete. */
export function diffSequence<T>(a: ReadonlyArray<T>, b: ReadonlyArray<T>): Array<{ kind: DiffKind; items: T[] }> {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  // Walk the trace backwards to recover the path.
  const ops: Array<{ kind: DiffKind; item: T }> = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) ops.push({ kind: "equal", item: a[--x] }), y--;
    if (d === 0) break;
    if (x === prevX) ops.push({ kind: "insert", item: b[--y] });
    else ops.push({ kind: "delete", item: a[--x] });
  }
  while (x > 0 && y > 0) ops.push({ kind: "equal", item: a[--x] }), y--;
  ops.reverse();

  const runs: Array<{ kind: DiffKind; items: T[] }> = [];
  for (const op of ops) {
    const last = runs[runs.length - 1];
    if (last && last.kind === op.kind) last.items.push(op.item);
    else runs.push({ kind: op.kind, items: [op.item] });
  }
  return runs;
}

/** Words, commands, numbers, whitespace runs and single symbols. */
const WORD = /\s+|\\[A-Za-z]+\*?|\\.|[A-Za-z]+|\d+|[\s\S]/g;

function wordDiff(before: string, after: string): { before: Piece[]; after: Piece[] } {
  const runs = diffSequence(before.match(WORD) ?? [], after.match(WORD) ?? []);
  const b: Piece[] = [];
  const a: Piece[] = [];
  for (const run of runs) {
    const text = run.items.join("");
    if (run.kind !== "insert") b.push({ text, changed: run.kind === "delete" });
    if (run.kind !== "delete") a.push({ text, changed: run.kind === "insert" });
  }
  return { before: b, after: a };
}

/** Unified diff of input vs output, line by line, with word-level detail on changed pairs. */
export function diffLines(before: string, after: string): DiffLine[] {
  const runs = diffSequence(before.split("\n"), after.split("\n"));
  const out: DiffLine[] = [];
  let bl = 1;
  let al = 1;

  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.kind === "equal") {
      for (const text of run.items) out.push({ kind: "equal", before: bl++, after: al++, pieces: [{ text, changed: false }] });
      continue;
    }
    // A delete run followed by an insert run is a set of edited lines: pair them
    // up so each pair gets a word-level diff instead of two solid blocks.
    const deleted = run.kind === "delete" ? run.items : [];
    const next = runs[r + 1];
    const inserted = run.kind === "insert" ? run.items : next?.kind === "insert" ? next.items : [];
    if (run.kind === "delete" && next?.kind === "insert") r++;

    const pairs = Math.min(deleted.length, inserted.length);
    const pairedAfter: Piece[][] = [];
    for (let i = 0; i < deleted.length; i++) {
      if (i < pairs) {
        const w = wordDiff(deleted[i], inserted[i]);
        out.push({ kind: "delete", before: bl++, pieces: w.before });
        pairedAfter.push(w.after);
      } else {
        out.push({ kind: "delete", before: bl++, pieces: [{ text: deleted[i], changed: true }] });
      }
    }
    for (let i = 0; i < inserted.length; i++) {
      out.push({ kind: "insert", after: al++, pieces: pairedAfter[i] ?? [{ text: inserted[i], changed: true }] });
    }
  }
  return out;
}
