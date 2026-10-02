/**
 * BrandMark - the LaTeX and Overleaf wordmarks as CSS masks, so their colour
 * comes from CSS (`currentColor`): they follow the theme and button states
 * instead of being fixed-colour bitmaps. Sources: public/brand/*.png, built by
 * `npm run logos` from static/brand-src/ (gemini.png and gemini-star.png are
 * cropped from static/brand-src/gemini.png, which already has an alpha channel).
 */
const MARKS = {
  latex: { src: "/brand/latex.png", ratio: 1877 / 700, label: "LaTeX" },
  overleaf: { src: "/brand/overleaf.png", ratio: 709 / 212, label: "Overleaf" },
  gemini: { src: "/brand/gemini.png", ratio: 520 / 161, label: "Gemini" },
} as const;

export default function BrandMark({
  mark,
  height = "1em",
  className = "",
}: {
  mark: keyof typeof MARKS;
  /** CSS height; width follows the artwork's aspect ratio. */
  height?: string;
  className?: string;
}) {
  const m = MARKS[mark];
  const mask = "url(" + m.src + ") center / contain no-repeat";
  return (
    <span
      role="img"
      aria-label={m.label}
      className={"inline-block shrink-0 bg-current align-middle " + className}
      style={{ height, aspectRatio: String(m.ratio), WebkitMask: mask, mask }}
    />
  );
}

/** The Gemini sparkle, in its own colours (a gradient a mask cannot carry). */
export function GeminiStar({ size = 14, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- a 3 KB static icon; next/image adds nothing in a static export
  return <img src="/brand/gemini-star.png" alt="" width={size} height={size} className={"inline-block shrink-0 " + className} />;
}
