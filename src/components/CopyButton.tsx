"use client";

import { useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";

/* The platform never changes mid-session, so there is nothing to subscribe to -
 * but routing the read through useSyncExternalStore keeps the server snapshot
 * explicit and avoids a hydration mismatch on the shortcut hint. */
const neverChanges = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);
const assumeNotMac = () => false;

interface Props {
  onCopy: () => void;
  copied: boolean;
  disabled?: boolean;
  /** Shown next to the label so the user knows how much is going to the clipboard. */
  charCount: number;
}

/**
 * The one button that matters. The text is already computed and memoized before
 * this renders, so the click is a single clipboard write - no work in between.
 */
export default function CopyButton({ onCopy, copied, disabled, charCount }: Props) {
  const isMac = useSyncExternalStore(neverChanges, readIsMac, assumeNotMac);

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      className={
        "group flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold transition-all " +
        "disabled:cursor-not-allowed disabled:border disabled:border-ink-700 disabled:bg-ink-800 disabled:text-slate-600 " +
        (copied
          ? "bg-accent text-ink-950 shadow-lg shadow-accent/20"
          : "bg-accent text-ink-950 hover:bg-accent-soft active:scale-[0.99] enabled:shadow-lg enabled:shadow-accent/20")
      }
    >
      {copied ? <Check size={17} strokeWidth={3} /> : <Copy size={16} strokeWidth={2.5} />}
      <span>{copied ? "Copied to clipboard" : "Copy Clean LaTeX"}</span>
      {!disabled && (
        <kbd className="ml-1 hidden rounded-md bg-ink-950/15 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide sm:inline">
          {isMac ? "⌘" : "Ctrl"}
          {"↵"}
        </kbd>
      )}
      {charCount > 0 && (
        <span className="ml-auto hidden font-mono text-[11px] font-medium opacity-60 md:inline">
          {charCount.toLocaleString()} chars
        </span>
      )}
    </button>
  );
}
