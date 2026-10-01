/**
 * types.ts - the contract between the cleaner workspace and Studio features.
 * Every Studio panel gets the live document and a way to point back into it.
 */
export interface StudioContext {
  /** The editor's raw text (what the user typed or pasted). */
  input: string;
  /** The cleaned LaTeX currently shown in the output pane. */
  output: string;
  /** Select and scroll to input lines [from, to] (1-indexed, inclusive). */
  selectLines: (from: number, to: number) => void;
  /** Append text to the editor (with undo). */
  insert: (text: string) => void;
}
