"use client";

import { forwardRef, useSyncExternalStore } from "react";
import type { LucideIcon } from "lucide-react";

/* The platform never changes mid-session, so there is nothing to subscribe to -
 * but routing the read through useSyncExternalStore keeps the server snapshot
 * explicit and avoids a hydration mismatch on shortcut hints. */
const neverChanges = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);
const assumeNotMac = () => false;

export function useIsMac(): boolean {
  return useSyncExternalStore(neverChanges, readIsMac, assumeNotMac);
}

/** "Mod" is Cmd on Apple platforms and Ctrl elsewhere; "Alt" is Option on a Mac. */
export function useKeyLabel(): (key: string) => string {
  const isMac = useIsMac();
  return (key) =>
    key
      .replace("Mod", isMac ? "⌘" : "Ctrl")
      .replace("Alt", isMac ? "⌥" : "Alt")
      .replace("Shift", isMac ? "⇧" : "Shift")
      .replace("Enter", "↵")
      .replace(/\+/g, isMac ? "" : "+");
}

export function Kbd({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={
        "inline-flex min-w-[1.5em] items-center justify-center rounded-md border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-muted " +
        className
      }
    >
      {children}
    </kbd>
  );
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  /** Accessible name, and the tooltip unless `title` overrides it. */
  label: string;
  /** Pressed / selected styling for toggles. */
  active?: boolean;
  /** Show the label as text next to the icon from this breakpoint up. */
  showLabel?: "always" | "sm" | "never";
  size?: number;
}

/**
 * The small square button used in pane headers. Every one gets the same press
 * feedback, focus ring and active state, so the toolbar reads as one system.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, active, showLabel = "never", size = 14, className = "", title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={title ?? label}
      className={
        "press flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg text-xs font-medium disabled:opacity-35 " +
        (showLabel === "never" ? "w-7 " : "px-2 ") +
        (active
          ? "bg-accent/10 text-accent hover:bg-accent/20 "
          : "text-faint hover:bg-surface-2 hover:text-text ") +
        className
      }
      {...rest}
    >
      <Icon size={size} strokeWidth={2.25} />
      {showLabel !== "never" && (
        <span className={showLabel === "sm" ? "hidden sm:inline" : ""}>{label}</span>
      )}
    </button>
  );
});
