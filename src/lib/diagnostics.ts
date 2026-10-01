/**
 * diagnostics.ts - "would this actually render?" for every cleaned math block.
 *
 * The tokenizer already reports unclosed delimiters. This catches what it
 * cannot see: an unbalanced brace inside a block, an undefined macro, a
 * misspelled environment. Each cleaned block is parsed by KaTeX with the
 * preview's own options, and a failure is mapped back to a line of the *input*
 * so the editor can paint it.
 *
 * Pure apart from KaTeX itself, which needs no DOM - so it runs under the tests.
 */
import katex from "katex";
import { prepareForKatex, segment, type MathBlock } from "./cleaner";
import { KATEX_OPTIONS } from "./katexOptions";

export interface Diagnostic {
  /** 1-indexed input line. */
  line: number;
  message: string;
}

const newlinesBefore = (s: string, pos: number) => (s.slice(0, Math.max(0, pos)).match(/\n/g) ?? []).length;

/** KaTeX prefixes "KaTeX parse error: " and appends a position; keep the useful middle. */
function tidyMessage(raw: string): string {
  return raw
    .replace(/^KaTeX parse error:\s*/, "")
    .replace(/\s+at position \d+:[\s\S]*$/, "")
    .trim();
}

export function diagnose(blocks: ReadonlyArray<MathBlock>): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const block of blocks) {
    for (const seg of segment(block.emitted)) {
      if (seg.type === "text") continue;
      const latex = prepareForKatex(seg.value);
      try {
        katex.renderToString(latex, { ...KATEX_OPTIONS, displayMode: seg.type === "display" });
      } catch (err) {
        const parse = err instanceof katex.ParseError ? err : null;
        // Cleaning keeps a display block's rows on their own lines, so the row
        // KaTeX stopped on is the row in the input. Clamp in case it moved.
        const offset = parse?.position !== undefined ? newlinesBefore(latex, parse.position) : 0;
        out.push({
          line: Math.min(block.endLine, Math.max(block.line, block.bodyLine + offset)),
          message: tidyMessage(parse?.rawMessage ?? (err as Error).message),
        });
        break; // one report per block: the first error is the one to fix
      }
    }
  }
  return out;
}
