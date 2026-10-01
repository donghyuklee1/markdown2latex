"use client";

import { Check, Copy } from "lucide-react";
import { useIsMac } from "./ui";

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
  const isMac = useIsMac();

  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      className={
        "press press-soft group flex w-full items-center justify-center gap-2.5 rounded-xl px-4 py-3 text-sm font-semibold " +
        "disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-surface-2 disabled:text-faint " +
        (copied
          ? "bg-accent text-accent-ink shadow-lg shadow-accent/25"
          : "bg-accent text-accent-ink hover:bg-accent/90 hover:shadow-xl enabled:shadow-lg enabled:shadow-accent/25")
      }
    >
      {copied ? <Check size={17} strokeWidth={3} /> : <Copy size={16} strokeWidth={2.5} />}
      <span>{copied ? "Copied to clipboard" : "Copy Clean LaTeX"}</span>
      {!disabled && (
        <kbd className="ml-1 hidden rounded-md bg-bg/15 px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide sm:inline">
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
