import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_TAGLINE } from "@/lib/site";

/** Social preview card, rendered once at build time into a static PNG. */
export const alt = SITE_NAME + " - " + SITE_TAGLINE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#f6f4f1",
          color: "#121110",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -2 }}>
          markdown<span style={{ color: "#ff751f" }}>2</span>Latex
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <div style={{ display: "flex", fontSize: 44, lineHeight: 1.2, maxWidth: 900 }}>
            Paste messy LLM math. Get LaTeX that compiles on the first try.
          </div>
          <div
            style={{
              display: "flex",
              gap: 18,
              fontSize: 26,
              color: "#6e6962",
              fontFamily: "monospace",
            }}
          >
            <span>{"\\[ \\]  ->  $$"}</span>
            <span style={{ color: "#ff751f" }}>|</span>
            <span>{"align  ->  align*"}</span>
            <span style={{ color: "#ff751f" }}>|</span>
            <span>{"dx  ->  \\,dx"}</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
