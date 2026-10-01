import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { THEME_BOOTSTRAP } from "@/lib/theme";

export const metadata: Metadata = {
  title: "markdown2Latex - LLM markdown to LaTeX math cleaner",
  description:
    "Paste messy LLM math, get compilation-ready LaTeX. Normalizes delimiters, repairs align environments, wraps stray prose in \\text{}. Runs entirely in your browser.",
  applicationName: "markdown2Latex",
  keywords: ["LaTeX", "KaTeX", "Overleaf", "Obsidian", "ChatGPT", "markdown", "math"],
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = {
  // Matches --bg in each theme so the mobile browser chrome blends in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#181715" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before the first paint, so a dark-mode user
            never sees a flash of the light palette. The third justified
            dangerouslySetInnerHTML site (see AGENTS.md): THEME_BOOTSTRAP is a
            compile-time constant with no user input in it - stored palette
            values are only ever read at runtime, validated as hex, and written
            through style.setProperty, never into markup. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
