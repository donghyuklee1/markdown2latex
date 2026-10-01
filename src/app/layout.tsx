import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { THEME_BOOTSTRAP } from "@/lib/theme";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL, THEME_COLORS } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME + " - " + SITE_TAGLINE, template: "%s | " + SITE_NAME },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ["LaTeX", "KaTeX", "Overleaf", "Obsidian", "ChatGPT", "Claude", "markdown", "math", "converter"],
  alternates: { canonical: "/" },
  icons: { icon: "/icon.png", apple: "/icon.png" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_NAME + " - " + SITE_TAGLINE,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  // Matches --bg in each theme so the mobile browser chrome blends in.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
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
