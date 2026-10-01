/**
 * insertion.ts - inserting a snippet or symbol so that it renders.
 *
 * Bare LaTeX typed into prose is just text, so the preview shows it raw. When
 * the cursor is outside any maths, a symbol goes in as inline `$...$` and a
 * snippet as its own `$$ ... $$` block; inside maths it goes in as-is. `@` in a
 * template marks where the current selection goes (select `x`, insert
 * `\hat{@}` -> `\hat{x}`).
 */
import { tokenize } from "./cleaner";

/** Is `offset` strictly inside a math span (between its delimiters)? */
export function isInMath(src: string, offset: number): boolean {
  const { tokens } = tokenize(src);
  return tokens.some((t, i) => {
    if (t.kind === "text") return false;
    const end = i + 1 < tokens.length ? tokens[i + 1].start : src.length;
    return offset > t.start && offset < end;
  });
}

/** Snippets that already carry their own delimiters or display environment. */
const SELF_CONTAINED = /^\s*(?:\$|\\\[|\\\(|\\begin\{(?:equation|align|gather|multline|flalign|alignat|eqnarray|displaymath)\*?\})/;

export interface Insertion {
  /** Replaces value.slice(start, end). */
  text: string;
  /** Absolute caret position after the insert. */
  caret: number;
}

export function planInsertion(value: string, start: number, end: number, template: string, kind: "inline" | "display"): Insertion {
  const selected = value.slice(start, end);
  const at = template.indexOf("@");
  const body = at < 0 ? template : template.slice(0, at) + selected + template.slice(at + 1);
  const caretIn = (offset: number) => start + offset;
  const inside = at < 0 ? body.length : at + selected.length;

  if (isInMath(value, start)) return { text: body, caret: caretIn(inside) };

  const selfContained = SELF_CONTAINED.test(body);
  if (kind === "inline") {
    if (selfContained) return { text: body, caret: caretIn(inside) };
    // The caret stays inside the new span, so typing continues in maths. A
    // span is never glued to a neighbouring word ("The $\theta$classifier").
    const inner = at < 0 ? body.trimEnd() : body;
    const lead = start > 0 && /[A-Za-z0-9]/.test(value[start - 1]) ? " " : "";
    const tail = end < value.length && /[A-Za-z0-9]/.test(value[end]) ? " " : "";
    return { text: lead + "$" + inner + "$" + tail, caret: caretIn(lead.length + 1 + (at < 0 ? inner.length : inside)) };
  }

  // A display block sits on lines of its own.
  const before = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
  const after = end < value.length && value[end] !== "\n" ? "\n" : "";
  if (selfContained) {
    const text = before + body.trim() + after;
    return { text, caret: caretIn(at < 0 ? text.length - after.length : before.length + inside) };
  }
  const open = before + "$$\n";
  const text = open + body.trim() + "\n$$" + after;
  return { text, caret: caretIn(at < 0 ? text.length - after.length : open.length + inside) };
}
