import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "CleanMath - LLM Markdown to LaTeX math cleaner",
  description:
    "Paste messy LLM math, get compilation-ready LaTeX. Normalizes delimiters, repairs align environments, wraps stray prose in \\text{}. Runs entirely in your browser.",
  applicationName: "CleanMath",
  keywords: ["LaTeX", "KaTeX", "Overleaf", "Obsidian", "ChatGPT", "markdown", "math"],
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#07090d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
