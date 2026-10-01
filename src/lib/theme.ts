/**
 * theme.ts - light/dark selection plus per-theme colour overrides.
 *
 * Both live in one external store for the same reasons as optionsStore: no
 * setState-in-effect, a hydration-safe server snapshot, and cross-tab sync.
 *
 * The actual styling is done by writing CSS custom properties on <html>, so a
 * theme change or a picked colour restyles everything at once without any
 * component re-rendering for colour reasons.
 */

export type ThemeName = "light" | "dark";

export const THEME_STORAGE_KEY = "cleanmath:theme:v1";
export const PALETTE_STORAGE_KEY = "cleanmath:palette:v1";

/** The subset of tokens the palette picker exposes. */
export const EDITABLE_TOKENS = [
  { id: "bg", label: "Background", hint: "The page behind everything" },
  { id: "surface", label: "Panel", hint: "Input and output pane fill" },
  { id: "border", label: "Border", hint: "Pane outlines and dividers" },
  { id: "text", label: "Text", hint: "Primary foreground" },
  { id: "muted", label: "Muted text", hint: "Labels, counts, hints" },
  { id: "accent", label: "Accent", hint: "The orange from the wordmark" },
] as const;

export type EditableToken = (typeof EDITABLE_TOKENS)[number]["id"];

export type PaletteOverrides = Partial<Record<EditableToken, string>>;
/** Overrides are kept per theme: a colour picked for dark should not leak into light. */
export type StoredPalette = Partial<Record<ThemeName, PaletteOverrides>>;

/* ------------------------------------------------------------ colour utils */

/** "#ff751f" -> "255 117 31", the form the CSS variables are written in. */
export function hexToTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1];
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  const n = parseInt(body, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** "255 117 31" -> "#ff751f", for seeding the colour inputs. */
export function tripletToHex(triplet: string): string {
  const parts = triplet.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return "#000000";
  return "#" + parts.slice(0, 3).map((n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0")).join("");
}

/** What a token currently resolves to, overrides included. */
export function readToken(token: EditableToken): string {
  if (typeof window === "undefined") return "#000000";
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`);
  return tripletToHex(value || "0 0 0");
}

/* ------------------------------------------------------------------- state */

let theme: ThemeName | null = null;
let palette: StoredPalette | null = null;
const listeners = new Set<() => void>();

const notify = () => {
  for (const l of listeners) l();
};

function readStoredTheme(): ThemeName {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    /* fall through to the media query */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredPalette(): StoredPalette {
  try {
    const raw = window.localStorage.getItem(PALETTE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredPalette) : {};
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------------- applying */

/**
 * Push theme + overrides into the DOM. Called by the store and, before React
 * ever runs, by the inline bootstrap script in the document head.
 */
export function applyToDom(next: ThemeName, overrides: PaletteOverrides): void {
  const root = document.documentElement;
  root.dataset.theme = next;
  for (const { id } of EDITABLE_TOKENS) {
    const hex = overrides[id];
    const triplet = hex ? hexToTriplet(hex) : null;
    if (triplet) root.style.setProperty(`--${id}`, triplet);
    else root.style.removeProperty(`--${id}`);
  }
}

/* ------------------------------------------------- useSyncExternalStore API */

export function getThemeSnapshot(): ThemeName {
  if (theme) return theme;
  theme = readStoredTheme();
  return theme;
}

/** SSR renders the light theme; the head script corrects it before first paint. */
export function getThemeServerSnapshot(): ThemeName {
  return "light";
}

export function getPaletteSnapshot(): StoredPalette {
  if (palette) return palette;
  palette = readStoredPalette();
  return palette;
}

const EMPTY_PALETTE: StoredPalette = {};
export function getPaletteServerSnapshot(): StoredPalette {
  return EMPTY_PALETTE;
}

export function subscribeToTheme(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY && event.key !== PALETTE_STORAGE_KEY) return;
    theme = null;
    palette = null;
    applyToDom(getThemeSnapshot(), getPaletteSnapshot()[getThemeSnapshot()] ?? {});
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/* ----------------------------------------------------------------- actions */

function persist(): void {
  try {
    if (theme) window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    if (palette) window.localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(palette));
  } catch {
    // The app works fine without persistence.
  }
}

export function setTheme(next: ThemeName): void {
  theme = next;
  palette = palette ?? readStoredPalette();
  applyToDom(next, palette[next] ?? {});
  persist();
  notify();
}

export function setTokenOverride(token: EditableToken, hex: string | null): void {
  const current = getThemeSnapshot();
  const base = getPaletteSnapshot();
  const forTheme: PaletteOverrides = { ...(base[current] ?? {}) };
  if (hex) forTheme[token] = hex;
  else delete forTheme[token];
  palette = { ...base, [current]: forTheme };
  applyToDom(current, forTheme);
  persist();
  notify();
}

/** Drop every override for the active theme, back to the wordmark palette. */
export function resetPalette(): void {
  const current = getThemeSnapshot();
  palette = { ...getPaletteSnapshot(), [current]: {} };
  applyToDom(current, {});
  persist();
  notify();
}

/* ------------------------------------------------------------- eyedropper */

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperCtor {
  new (): { open: (options?: { signal?: AbortSignal }) => Promise<EyeDropperResult> };
}

/** Chromium-only; callers must degrade to the native colour input without it. */
export function eyeDropperSupported(): boolean {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

/** Sample a pixel from anywhere on screen. Resolves null if the user cancels. */
export async function pickColorFromScreen(): Promise<string | null> {
  const Ctor = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  if (!Ctor) return null;
  try {
    const { sRGBHex } = await new Ctor().open();
    return sRGBHex;
  } catch {
    // AbortError when the user presses Escape - not an error worth surfacing.
    return null;
  }
}

/**
 * Runs in <head> before first paint, so the correct theme is on screen from the
 * first frame instead of flashing light and correcting. Stringified into the
 * document, so it must stay dependency-free.
 */
export const THEME_BOOTSTRAP = `(function(){try{
var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";}
document.documentElement.dataset.theme=t;
var p=JSON.parse(localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)})||"{}")[t]||{};
for(var k in p){var m=/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(p[k]).trim());if(!m)continue;
var b=m[1];if(b.length===3){b=b[0]+b[0]+b[1]+b[1]+b[2]+b[2];}var n=parseInt(b,16);
document.documentElement.style.setProperty("--"+k,((n>>16)&255)+" "+((n>>8)&255)+" "+(n&255));}
}catch(e){}})();`;
