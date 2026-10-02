/**
 * correspond.ts - which part of the output a part of the input became, and
 * back.
 *
 * The cleaner reports every maths block with its input lines and exactly what
 * it emitted, in order. Finding each emission in the output in turn gives the
 * blocks' output ranges; the prose between consecutive blocks is then the
 * same "gap" on both sides. A selection maps to its counterpart:
 *
 *  - inside a block: the same text inside the other side's block when it
 *    survived cleaning, otherwise the whole block;
 *  - in prose: the same text inside the corresponding gap, otherwise the
 *    whole gap.
 *
 * Pure, ASCII-only.
 */

export interface BlockSpan {
  /** 1-indexed input lines, inclusive. */
  line: number;
  endLine: number;
  /** Exactly what the cleaner wrote for this block. */
  emitted: string;
}

export interface Range {
  start: number;
  end: number;
}

interface Pair {
  input: Range;
  output: Range;
  kind: "block" | "gap";
}

export interface Correspondence {
  pairs: Pair[];
}

/** Offset of the start of each line (index 0 = line 1). */
export function lineStarts(text: string): number[] {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") out.push(i + 1);
  return out;
}

/** 1-indexed first and last line a range touches. */
export function linesOf(text: string, r: Range): [number, number] {
  const starts = lineStarts(text);
  const lineAt = (off: number) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= off) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  return [lineAt(r.start), lineAt(Math.max(r.start, r.end - 1))];
}

export function buildCorrespondence(input: string, output: string, blocks: ReadonlyArray<BlockSpan>): Correspondence {
  const inStarts = lineStarts(input);
  const lineEnd = (line: number) => (line < inStarts.length ? inStarts[line] - 1 : input.length);
  const pairs: Pair[] = [];
  let inPos = 0;
  let outPos = 0;
  for (const b of blocks) {
    const at = b.emitted ? output.indexOf(b.emitted, outPos) : -1;
    if (at < 0) continue; // not found in order: leave it to the surrounding gap
    const inStart = inStarts[Math.max(0, b.line - 1)] ?? input.length;
    const inEnd = Math.max(inStart, lineEnd(b.endLine));
    if (inStart < inPos) continue;
    pairs.push({ kind: "gap", input: { start: inPos, end: inStart }, output: { start: outPos, end: at } });
    pairs.push({ kind: "block", input: { start: inStart, end: inEnd }, output: { start: at, end: at + b.emitted.length } });
    inPos = inEnd;
    outPos = at + b.emitted.length;
  }
  pairs.push({ kind: "gap", input: { start: inPos, end: input.length }, output: { start: outPos, end: output.length } });
  return { pairs };
}

export interface Mapped extends Range {
  /** The selected text itself was found on the other side. */
  exact: boolean;
  kind: "block" | "gap";
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Find `needle` in `hay` within [from, to), tolerating whitespace differences. */
function findIn(hay: string, needle: string, from: number, to: number): Range | null {
  const slice = hay.slice(from, to);
  const direct = slice.indexOf(needle);
  if (direct >= 0) return { start: from + direct, end: from + direct + needle.length };
  const n = squash(needle);
  if (n.length < 2) return null;
  // Whitespace-insensitive: build a pattern from the words.
  const words = n.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const m = new RegExp(words.join("\\s+")).exec(slice);
  return m ? { start: from + m.index, end: from + m.index + m[0].length } : null;
}

/** The counterpart of a selection on the other side. */
export function mapRange(c: Correspondence, from: "input" | "output", r: Range, fromText: string, toText: string): Mapped | null {
  const to = from === "input" ? "output" : "input";
  const pair = c.pairs.find((p) => r.start >= p[from].start && r.start < Math.max(p[from].end, p[from].start + 1)) ?? c.pairs.find((p) => r.start <= p[from].end);
  if (!pair) return null;
  const selected = fromText.slice(r.start, r.end);
  const target = pair[to];
  const trimmed = selected.trim();
  if (trimmed) {
    const hit = findIn(toText, trimmed, target.start, target.end);
    if (hit) return { ...hit, exact: true, kind: pair.kind };
  }
  if (target.end <= target.start) return null;
  return { start: target.start, end: target.end, exact: false, kind: pair.kind };
}
