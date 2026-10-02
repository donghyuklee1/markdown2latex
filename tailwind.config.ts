import type { Config } from "tailwindcss";

/**
 * Every colour resolves to a CSS custom property, which is what lets the theme
 * toggle and the palette picker restyle the whole app by writing a handful of
 * variables instead of swapping class names.
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // `dark:` follows the app's own theme switch (data-theme), not the OS setting.
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: token("bg"),
        surface: token("surface"),
        "surface-2": token("surface-2"),
        border: token("border"),
        "border-strong": token("border-strong"),
        text: token("text"),
        muted: token("muted"),
        faint: token("faint"),
        accent: token("accent"),
        "accent-ink": token("accent-ink"),
        danger: token("danger"),
        ok: token("ok"),
        overleaf: token("overleaf"),
        syn: {
          cmd: token("syn-cmd"),
          env: token("syn-env"),
          delim: token("syn-delim"),
          num: token("syn-num"),
          brace: token("syn-brace"),
          op: token("syn-op"),
          comment: token("syn-comment"),
          break: token("syn-break"),
        },
      },
      fontFamily: {
        sans: "var(--font-sans)",
        serif: "var(--font-serif)",
        mono: "var(--font-mono)",
      },
      keyframes: {
        "toast-in": {
          from: { opacity: "0", transform: "translateY(-8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(3px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(-4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "toast-in": "toast-in 140ms ease-out",
        "pop-in": "pop-in 120ms ease-out",
        "fade-in": "fade-in 160ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
