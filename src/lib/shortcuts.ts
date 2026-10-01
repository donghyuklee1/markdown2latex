/**
 * shortcuts.ts - every keyboard shortcut, in one table.
 *
 * The same table drives the key handler and the help dialog, so the two cannot
 * drift apart. App shortcuts use Alt (Option on a Mac) and match on
 * `event.code`, because on macOS Option+letter produces a symbol in
 * `event.key` (Option+V is "√"). Mod is Cmd on Apple platforms, Ctrl elsewhere,
 * and is only used where the meaning matches the OS convention (copy, save).
 */

export type ShortcutId =
  | "copy"
  | "download"
  | "cleanClipboard"
  | "share"
  | "modeStandard"
  | "modeAcademic"
  | "modeInline"
  | "togglePreview"
  | "toggleTheme"
  | "toggleWrap"
  | "fontUp"
  | "fontDown"
  | "fontReset"
  | "focusInput"
  | "focusOutput"
  | "help";

export interface Shortcut {
  id: ShortcutId;
  /** Display form: "Mod", "Alt" and "Shift" are mapped per platform. */
  keys: string;
  label: string;
  group: "Output" | "Editing" | "View";
  mod?: boolean;
  alt?: boolean;
  /** Matched against event.code. */
  code?: string;
  /** Matched against event.key, for keys whose code varies by layout. */
  key?: string;
}

export const SHORTCUTS: ReadonlyArray<Shortcut> = [
  { id: "copy", keys: "Mod+Enter", label: "Copy clean LaTeX", group: "Output", mod: true, key: "Enter" },
  { id: "download", keys: "Mod+S", label: "Download as a file", group: "Output", mod: true, code: "KeyS" },
  { id: "share", keys: "Alt+L", label: "Copy a share link", group: "Output", alt: true, code: "KeyL" },
  { id: "cleanClipboard", keys: "Alt+V", label: "Clean the clipboard: paste, clean, copy", group: "Editing", alt: true, code: "KeyV" },
  { id: "modeStandard", keys: "Alt+1", label: "Standard delimiters", group: "Editing", alt: true, code: "Digit1" },
  { id: "modeAcademic", keys: "Alt+2", label: "Academic delimiters", group: "Editing", alt: true, code: "Digit2" },
  { id: "modeInline", keys: "Alt+3", label: "Inline-only delimiters", group: "Editing", alt: true, code: "Digit3" },
  { id: "togglePreview", keys: "Alt+P", label: "Switch code / live preview", group: "View", alt: true, code: "KeyP" },
  { id: "focusInput", keys: "Alt+[", label: "Maximise the input pane", group: "View", alt: true, code: "BracketLeft" },
  { id: "focusOutput", keys: "Alt+]", label: "Maximise the output pane", group: "View", alt: true, code: "BracketRight" },
  { id: "toggleWrap", keys: "Alt+W", label: "Toggle word wrap", group: "View", alt: true, code: "KeyW" },
  { id: "fontUp", keys: "Alt+=", label: "Larger text", group: "View", alt: true, code: "Equal" },
  { id: "fontDown", keys: "Alt+-", label: "Smaller text", group: "View", alt: true, code: "Minus" },
  { id: "fontReset", keys: "Alt+0", label: "Reset text size", group: "View", alt: true, code: "Digit0" },
  { id: "toggleTheme", keys: "Alt+T", label: "Light / dark theme", group: "View", alt: true, code: "KeyT" },
  { id: "help", keys: "?", label: "Show this list", group: "View", key: "?" },
];

/** Shortcuts that also exist inside the editor, without a modifier. */
export const EDITOR_KEYS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: "Tab", label: "Indent (two spaces)" },
  { keys: "Shift+Tab", label: "Outdent" },
  { keys: "Esc", label: "Leave the editor, so Tab moves focus again" },
];

interface KeyLike {
  key: string;
  code: string;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/**
 * Which shortcut, if any, a key event triggers. `typing` is true while focus is
 * in a text field, where a bare `?` must type a question mark.
 */
export function matchShortcut(e: KeyLike, typing: boolean): ShortcutId | null {
  const mod = e.metaKey || e.ctrlKey;
  for (const s of SHORTCUTS) {
    if (!!s.mod !== mod || !!s.alt !== e.altKey) continue;
    if (s.code ? s.code !== e.code : s.key !== e.key) continue;
    if (!s.mod && !s.alt && typing) continue;
    return s.id;
  }
  return null;
}
