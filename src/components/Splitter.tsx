"use client";

import { useRef } from "react";

interface Props {
  /** "x" drags left/right (a column divider), "y" drags up/down (a height grip). */
  orientation: "x" | "y";
  value: number;
  min: number;
  max: number;
  /** Where a double-click or Enter puts it back. */
  defaultValue: number;
  /** One arrow-key press; Shift moves four times as far. */
  step: number;
  /** Value units per pixel of pointer travel, read when a drag starts. */
  unitsPerPixel: () => number;
  onChange: (next: number) => void;
  label: string;
  className?: string;
}

/**
 * A drag handle that also works without a mouse: it is a focusable
 * `role="separator"` with arrow keys, Home/End and Enter, and a double-click
 * snaps it back to the default. Pointer capture keeps the drag alive when the
 * cursor outruns the handle or leaves the window.
 */
export default function Splitter({
  orientation,
  value,
  min,
  max,
  defaultValue,
  step,
  unitsPerPixel,
  onChange,
  label,
  className = "",
}: Props) {
  const drag = useRef<{ start: number; from: number; scale: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const horizontal = orientation === "x";

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: horizontal ? e.clientX : e.clientY, from: value, scale: unitsPerPixel() };
    document.documentElement.dataset.resizing = orientation;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const pos = horizontal ? e.clientX : e.clientY;
    onChange(clamp(d.from + (pos - d.start) * d.scale));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    delete document.documentElement.dataset.resizing;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir =
      e.key === (horizontal ? "ArrowLeft" : "ArrowUp") ? -1 : e.key === (horizontal ? "ArrowRight" : "ArrowDown") ? 1 : 0;
    if (dir) {
      e.preventDefault();
      onChange(clamp(value + dir * step * (e.shiftKey ? 4 : 1)));
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(min);
    } else if (e.key === "End") {
      e.preventDefault();
      onChange(max);
    } else if (e.key === "Enter") {
      e.preventDefault();
      onChange(defaultValue);
    }
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemin={Math.round(min * 100) / 100}
      aria-valuemax={Math.round(max * 100) / 100}
      aria-valuenow={Math.round(value * 100) / 100}
      title={label + " - drag, or use the arrow keys. Double-click to reset."}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onChange(defaultValue)}
      onKeyDown={onKeyDown}
      className={
        "group relative flex shrink-0 select-none items-center justify-center outline-none " +
        (horizontal ? "w-2.5 cursor-col-resize self-stretch " : "h-3 w-full cursor-row-resize ") +
        className
      }
    >
      {/* The visible pill. It grows and takes the accent colour on hover, focus
          and while dragging, so the handle announces itself only when wanted. */}
      <span
        className={
          "spring rounded-full bg-border-strong group-hover:bg-accent group-focus-visible:bg-accent group-active:bg-accent " +
          (horizontal
            ? "h-10 w-1 group-hover:h-16 group-active:h-24"
            : "h-1 w-10 group-hover:w-16 group-active:w-24")
        }
      />
    </div>
  );
}
