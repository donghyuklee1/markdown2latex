"use client";

import { useSyncExternalStore } from "react";
import { Plus } from "lucide-react";
import {
  getPaletteServerSnapshot,
  getPaletteSnapshot,
  getThemeServerSnapshot,
  getThemeSnapshot,
  readToken,
  setTokenOverride,
  subscribeToTheme,
  type ThemeName,
} from "@/lib/theme";

/**
 * Presets per theme: the same hue needs a darker shade on cream and a lighter
 * one on near-black to stay readable. `null` is "Ink" - no override, so the
 * maths follows the text colour.
 */
const PRESETS: ReadonlyArray<{ label: string; hex: Record<ThemeName, string | null> }> = [
  { label: "Ink", hex: { light: null, dark: null } },
  { label: "Orange", hex: { light: "#c2410c", dark: "#ff8c42" } },
  { label: "Blue", hex: { light: "#1d4ed8", dark: "#7cb4ff" } },
  { label: "Green", hex: { light: "#15803d", dark: "#6ee7a0" } },
  { label: "Purple", hex: { light: "#7e22ce", dark: "#c4a1ff" } },
  { label: "Red", hex: { light: "#b91c1c", dark: "#ff8a80" } },
];

/**
 * Colour swatches for the rendered equations in the Live Preview. Writes the
 * `math` palette token, so the choice persists per theme, syncs across tabs and
 * also shows up in the full palette editor.
 */
export default function MathColorPicker() {
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const palette = useSyncExternalStore(subscribeToTheme, getPaletteSnapshot, getPaletteServerSnapshot);
  const current = palette[theme]?.math?.toLowerCase() ?? null;
  const isPreset = PRESETS.some((p) => p.hex[theme] === current);

  return (
    <div className="mr-1 flex items-center gap-1" role="radiogroup" aria-label="Preview math colour">
      {PRESETS.map(({ label, hex }) => {
        const value = hex[theme];
        const selected = value === current;
        return (
          <button
            key={label}
            type="button"
            role="radio"
            aria-checked={selected}
            title={label === "Ink" ? "Ink - same as the text" : label}
            onClick={() => setTokenOverride("math", value)}
            className={
              "press h-5 w-5 rounded-full border border-border-strong hover:scale-110 " +
              (selected ? "ring-2 ring-accent ring-offset-2 ring-offset-surface" : "")
            }
            style={{ backgroundColor: value ?? "rgb(var(--text))" }}
          />
        );
      })}

      <label
        title="Custom colour"
        className={
          "relative flex h-5 w-5 cursor-pointer items-center justify-center overflow-hidden rounded-full border transition-transform hover:scale-110 " +
          (current && !isPreset
            ? "border-border-strong ring-2 ring-accent ring-offset-2 ring-offset-surface"
            : "border-dashed border-border-strong text-faint")
        }
        style={current && !isPreset ? { backgroundColor: current } : undefined}
      >
        {!(current && !isPreset) && <Plus size={11} strokeWidth={2.5} />}
        <input
          type="color"
          value={current ?? readToken("math")}
          onChange={(e) => setTokenOverride("math", e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          aria-label="Custom preview math colour"
        />
      </label>
    </div>
  );
}
