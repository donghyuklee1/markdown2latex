"use client";

import { AlertTriangle, Blocks, CheckCircle2, Languages, Minus, Plus, Space, WrapText } from "lucide-react";
import { DELIMITER_MODES, type ConfigOptions, type DelimiterMode, type Issue } from "@/lib/cleaner";
import { DEFAULT_UI, FONT_MAX, FONT_MIN } from "@/lib/persistedStore";

interface Props {
  options: ConfigOptions;
  onChange: (next: ConfigOptions) => void;
  blocks: number;
  issues: Issue[];
  fontSize: number;
  onFontSize: (next: number) => void;
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
      aria-label={label}
      title={hint}
      onClick={() => onChange(!checked)}
      className={
        "press flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium " +
        (checked
          ? "border-accent/40 bg-accent/10 text-accent hover:bg-accent/15"
          : "border-border bg-surface text-muted hover:border-border-strong hover:text-text")
      }
    >
      <Icon size={13} strokeWidth={2.5} />
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      <span
        className={
          "relative h-3.5 w-6 shrink-0 rounded-full transition-colors duration-200 " +
          (checked ? "bg-accent/80" : "bg-border-strong")
        }
      >
        {/* The knob overshoots slightly and settles, like a physical switch. */}
        <span
          className={
            "spring absolute top-0.5 h-2.5 w-2.5 rounded-full bg-bg shadow-sm " +
            (checked ? "left-3" : "left-0.5")
          }
        />
      </span>
    </button>
  );
}

/**
 * Delimiter mode picker. The highlight is one element that slides between the
 * options rather than three that blink on and off, so a change of mode reads as
 * movement in the direction you clicked.
 */
function ModePicker({ value, onChange }: { value: DelimiterMode; onChange: (m: DelimiterMode) => void }) {
  const idx = Math.max(0, DELIMITER_MODES.findIndex((m) => m.id === value));
  return (
    <div
      role="radiogroup"
      aria-label="Delimiter style"
      className="relative grid grid-cols-3 rounded-lg border border-border bg-bg p-0.5"
    >
      <span
        aria-hidden
        className="spring absolute bottom-0.5 left-0.5 top-0.5 rounded-md bg-surface-2 shadow-sm"
        style={{ width: "calc((100% - 4px) / 3)", transform: `translateX(${idx * 100}%)` }}
      />
      {DELIMITER_MODES.map((mode, i) => (
        <button
          key={mode.id}
          type="button"
          role="radio"
          aria-checked={i === idx}
          title={mode.hint + " (Alt+" + (i + 1) + ")"}
          onClick={() => onChange(mode.id)}
          className={
            "press-soft press relative z-10 rounded-md px-2.5 py-1.5 text-xs font-semibold sm:px-3 " +
            (i === idx ? "text-text" : "text-faint hover:text-muted")
          }
        >
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function FontSize({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const btn =
    "press flex h-6 w-6 items-center justify-center rounded-md text-faint hover:bg-surface-2 hover:text-text disabled:opacity-30";
  return (
    <div className="flex items-center rounded-lg border border-border bg-bg p-0.5" role="group" aria-label="Text size">
      <button type="button" className={btn} onClick={() => onChange(value - 1)} disabled={value <= FONT_MIN} title="Smaller text (Alt+-)" aria-label="Smaller text">
        <Minus size={12} strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={() => onChange(DEFAULT_UI.fontSize)}
        title="Text size - click to reset (Alt+0)"
        className="press min-w-[2.6rem] rounded-md px-1 text-center font-mono text-[11px] text-muted hover:text-text"
      >
        {value}px
      </button>
      <button type="button" className={btn} onClick={() => onChange(value + 1)} disabled={value >= FONT_MAX} title="Larger text (Alt+=)" aria-label="Larger text">
        <Plus size={12} strokeWidth={2.5} />
      </button>
    </div>
  );
}

/**
 * Floating preference strip. Sits directly above the output so the effect of a
 * toggle is visible in the same glance that flipped it.
 */
export default function ControlBar({ options, onChange, blocks, issues, fontSize, onFontSize }: Props) {
  const set = (patch: Partial<ConfigOptions>) => onChange({ ...options, ...patch });

  return (
    <div className="themed flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
      <ModePicker value={options.delimiterMode} onChange={(m) => set({ delimiterMode: m })} />

      <div className="hidden h-6 w-px bg-border sm:block" />

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
      <Toggle
        label="Smart spacing"
        hint="Recognise spacing LaTeX gets wrong: \, before dx in integrals, upright \sin / \log, spaces inside \text{} where it meets maths, and single spaces around + - =."
        checked={options.smartSpacing}
        onChange={(v) => set({ smartSpacing: v })}
        icon={Space}
      />

      <div className="ml-auto flex items-center gap-3 pr-1 text-xs">
        <FontSize value={fontSize} onChange={onFontSize} />
        <span className="flex items-center gap-1.5 text-faint" title="Math blocks normalized">
          <Blocks size={13} />
          <span className="font-mono">{blocks}</span>
          <span className="hidden md:inline">{blocks === 1 ? "block" : "blocks"}</span>
        </span>
        {issues.length > 0 ? (
          <span className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle size={13} />
            <span className="font-mono">{issues.length}</span>
            <span className="hidden md:inline">{issues.length === 1 ? "issue" : "issues"}</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 font-medium text-accent">
            <CheckCircle2 size={13} />
            <span className="hidden md:inline">Clean</span>
          </span>
        )}
      </div>
    </div>
  );
}
