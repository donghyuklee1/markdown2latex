import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#07090d",
          900: "#0b0e14",
          850: "#10141c",
          800: "#161b25",
          700: "#1f2632",
          600: "#2b3442",
        },
        accent: {
          DEFAULT: "#5eead4",
          soft: "#2dd4bf",
          deep: "#0f766e",
        },
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      keyframes: {
        "toast-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "toast-in": "toast-in 140ms ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
