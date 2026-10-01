"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Blocks, CheckCircle2, Languages, Minus, PanelRightOpen, Plus, SlidersHorizontal, Space, WrapText } from "lucide-react";
import { DELIMITER_MODES, VECTOR_STYLES, type ConfigOptions, type DelimiterMode, type VectorStyle } from "@/lib/cleaner";
import { DEFAULT_UI, FONT_MAX, FONT_MIN, type PrimaryAction } from "@/lib/persistedStore";

interface Props {
  options: ConfigOptions;
  onChange: (next: ConfigOptions) => void;
  blocks: number;
  /** Tokenizer issues plus KaTeX diagnostics. */
  problems: number;
  fontSize: number;
  onFontSize: (next: number) => void;
  primaryAction: PrimaryAction;
  onPrimaryAction: (next: PrimaryAction) => void;
  benchOpen: boolean;
  onToggleBench: () => void;
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
        "press press-soft flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium " +
        (checked ? "bg-accent/10 text-accent hover:bg-accent/15" : "text-muted hover:bg-surface-2 hover:text-text")
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

/** Segmented choice used inside the settings popover. */
function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col rounded-lg border border-border bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={
            "press press-soft rounded-md px-2 py-1.5 text-[11px] font-semibold " +
            (o.id === value ? "bg-surface-2 text-text shadow-sm" : "text-faint hover:text-muted")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SettingRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-xs font-semibold text-text">{title}</div>
        <div className="text-[11px] leading-snug text-faint">{hint}</div>
      </div>
      {children}
    </div>
  );
}

/**
 * Academic settings: the normalisations a paper author cares about but a chat
 * user rarely does, so they live one click away instead of on the bar.
 */
function AcademicSettings({
  options,
  set,
  primaryAction,
  onPrimaryAction,
}: {
  options: ConfigOptions;
  set: (patch: Partial<ConfigOptions>) => void;
  primaryAction: PrimaryAction;
  onPrimaryAction: (next: PrimaryAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const changed =
    options.vectorStyle !== "keep" || !options.operatorNames || !options.starEnvironments || !options.repairStructure || primaryAction !== "copy";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Academic settings: vector notation, operator names, numbering"
        className={
          "press relative flex h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium " +
          (open
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-surface text-muted hover:border-border-strong hover:text-text")
        }
      >
        <SlidersHorizontal size={14} strokeWidth={2.25} />
        <span className="hidden lg:inline">Academic</span>
        {changed && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Academic settings"
          className="absolute left-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] animate-pop-in space-y-4 rounded-xl border border-border bg-surface p-4 shadow-xl shadow-black/10"
        >
          <SettingRow title="Vector notation" hint="Rewrite \vec, \mathbf, \boldsymbol and \bm to one style.">
            <Choice<VectorStyle>
              label="Vector notation"
              value={options.vectorStyle}
              onChange={(v) => set({ vectorStyle: v })}
              options={VECTOR_STYLES.map((v) => ({ id: v.id, label: v.label, title: v.example }))}
            />
          </SettingRow>

          <SettingRow title="Operator names" hint="sin(x), max, log n become upright \sin(x), \max, \log n.">
            <Choice<"on" | "off">
              label="Operator names"
              value={options.operatorNames ? "on" : "off"}
              onChange={(v) => set({ operatorNames: v === "on" })}
              options={[{ id: "on", label: "Upgrade" }, { id: "off", label: "Leave as typed" }]}
            />
          </SettingRow>

          <SettingRow title="Equation numbering" hint="Starred environments never renumber the equations in your paper.">
            <Choice<"on" | "off">
              label="Equation numbering"
              value={options.starEnvironments ? "on" : "off"}
              onChange={(v) => set({ starEnvironments: v === "on" })}
              options={[{ id: "on", label: "align → align*" }, { id: "off", label: "Keep numbered" }]}
            />
          </SettingRow>

          <SettingRow
            title="Auto-repair structure"
            hint="Close missing braces and \\left/\\right, widen array columns, escape %, set snake_case names as text, fix environment typos and illegal nesting, map \\bm."
          >
            <Choice<"on" | "off">
              label="Auto-repair structure"
              value={options.repairStructure ? "on" : "off"}
              onChange={(v) => set({ repairStructure: v === "on" })}
              options={[{ id: "on", label: "Repair" }, { id: "off", label: "Leave as typed" }]}
            />
          </SettingRow>

          <SettingRow title="Primary action" hint="What Cmd/Ctrl + Enter does.">
            <Choice<PrimaryAction>
              label="Primary action"
              value={primaryAction}
              onChange={onPrimaryAction}
              options={[{ id: "copy", label: "Copy LaTeX" }, { id: "overleaf", label: "Open in Overleaf" }]}
            />
          </SettingRow>
        </div>
      )}
    </div>
  );
}

/**
 * Floating preference strip. Sits directly above the output so the effect of a
 * toggle is visible in the same glance that flipped it.
 */
export default function ControlBar({
  options,
  onChange,
  blocks,
  problems,
  fontSize,
  onFontSize,
  primaryAction,
  onPrimaryAction,
  benchOpen,
  onToggleBench,
}: Props) {
  const set = (patch: Partial<ConfigOptions>) => onChange({ ...options, ...patch });

  return (
    <div className="themed flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
      <ModePicker value={options.delimiterMode} onChange={(m) => set({ delimiterMode: m })} />

      <div className="hidden h-6 w-px bg-border sm:block" />

      {/* The three cleanup switches read as one control: a single pill group. */}
      <div role="group" aria-label="Cleanup rules" className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border bg-bg p-0.5">
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
      </div>

      <AcademicSettings options={options} set={set} primaryAction={primaryAction} onPrimaryAction={onPrimaryAction} />

      <button
        type="button"
        onClick={onToggleBench}
        aria-expanded={benchOpen}
        title="Studio Workbench: shape sandbox, unit checker, sketch to TikZ (Alt+B)"
        className={
          "press flex h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium " +
          (benchOpen
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border bg-surface text-muted hover:border-border-strong hover:text-text")
        }
      >
        <PanelRightOpen size={14} strokeWidth={2.25} />
        <span className="hidden lg:inline">Workbench</span>
      </button>

      <div className="ml-auto flex items-center gap-3 pr-1 text-xs">
        <FontSize value={fontSize} onChange={onFontSize} />
        <span className="flex items-center gap-1.5 text-faint" title="Math blocks normalized">
          <Blocks size={13} />
          <span className="font-mono">{blocks}</span>
          <span className="hidden md:inline">{blocks === 1 ? "block" : "blocks"}</span>
        </span>
        {problems > 0 ? (
          <span className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle size={13} />
            <span className="font-mono">{problems}</span>
            <span className="hidden md:inline">{problems === 1 ? "issue" : "issues"}</span>
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
