"use client";

import { AlertTriangle, Blocks, CheckCircle2, Languages, WrapText } from "lucide-react";
import { DELIMITER_MODES, type ConfigOptions, type DelimiterMode, type Issue } from "@/lib/cleaner";

interface Props {
  options: ConfigOptions;
  onChange: (next: ConfigOptions) => void;
  blocks: number;
  issues: Issue[];
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  icon: Icon,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon: typeof WrapText;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={hint}
      onClick={() => onChange(!checked)}
      className={
        "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors " +
        (checked
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-muted")
      }
    >
      <Icon size={13} strokeWidth={2.5} />
      <span className="whitespace-nowrap">{label}</span>
      <span
        className={
          "relative h-3.5 w-6 shrink-0 rounded-full transition-colors " +
          (checked ? "bg-accent/80" : "bg-border-strong")
        }
      >
        <span
          className={
            "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-bg transition-all " +
            (checked ? "left-3" : "left-0.5")
          }
        />
      </span>
    </button>
  );
}

/**
 * Floating preference strip. Sits directly above the output so the effect of a
 * toggle is visible in the same glance that flipped it.
 */
export default function ControlBar({ options, onChange, blocks, issues }: Props) {
  const set = (patch: Partial<ConfigOptions>) => onChange({ ...options, ...patch });

  return (
    <div className="themed flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
      <div className="flex rounded-lg border border-border bg-bg p-0.5">
        {DELIMITER_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            title={mode.hint}
            onClick={() => set({ delimiterMode: mode.id as DelimiterMode })}
            className={
              "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors " +
              (options.delimiterMode === mode.id
                ? "bg-surface-2 text-text shadow-sm"
                : "text-faint hover:text-muted")
            }
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="h-6 w-px bg-surface-2" />

      <Toggle
        label="Auto \text{}"
        hint="Wrap prose found inside math blocks in \text{...} so it typesets as words, not variables."
        checked={options.autoText}
        onChange={(v) => set({ autoText: v })}
        icon={Languages}
      />
      <Toggle
        label="Fix row breaks"
        hint="Add the missing \\ row terminators and & alignment anchors inside align / matrix environments."
        checked={options.fixLineBreaks}
        onChange={(v) => set({ fixLineBreaks: v })}
        icon={WrapText}
      />

      <div className="ml-auto flex items-center gap-3 pr-1 text-xs">
        <span className="flex items-center gap-1.5 text-faint" title="Math blocks normalized">
          <Blocks size={13} />
          <span className="font-mono">{blocks}</span>
          <span className="hidden sm:inline">{blocks === 1 ? "block" : "blocks"}</span>
        </span>
        {issues.length > 0 ? (
          <span className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle size={13} />
            <span className="font-mono">{issues.length}</span>
            <span className="hidden sm:inline">{issues.length === 1 ? "issue" : "issues"}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-accent">
            <CheckCircle2 size={13} />
            <span className="hidden sm:inline">Clean</span>
          </span>
        )}
      </div>
    </div>
  );
}
