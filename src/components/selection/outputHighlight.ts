/**
 * outputHighlight.ts - "show this part of the output": the selection toolbar
 * asks for a range of output lines, the code view tints and scrolls to them.
 */
export interface OutputHighlight {
  from: number;
  to: number;
  /** Changes on every request, so asking twice re-runs the animation. */
  at: number;
}

let current: OutputHighlight | null = null;
const listeners = new Set<() => void>();

export const outputHighlight = {
  get: () => current,
  getServer: () => null,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  show(from: number, to: number) {
    current = { from, to, at: Date.now() };
    for (const l of listeners) l();
  },
  clear() {
    current = null;
    for (const l of listeners) l();
  },
};
