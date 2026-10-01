/**
 * The exact KaTeX configuration the preview renders with.
 *
 * Shared with tests/cleaner.spec.ts on purpose: a render check that used
 * different options could pass while the app showed a red error box. Notably
 * `strict` changes whether some inputs throw, so it has to be the same value in
 * both places.
 */
import type { KatexOptions } from "katex";

export const KATEX_OPTIONS: Readonly<KatexOptions> = {
  throwOnError: true,
  // KaTeX only emits raw HTML and URLs for \href, \htmlClass and friends when
  // `trust` is set. It stays off: this input is whatever the user pasted.
  trust: false,
  // "warn" (the default) would log to the console on every keystroke for input
  // that renders perfectly well.
  strict: false,
};
