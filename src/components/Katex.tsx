"use client";

import { useMemo } from "react";
import katex from "katex";
import { KATEX_OPTIONS } from "@/lib/katexOptions";

/**
 * Minimal KaTeX bindings.
 *
 * This used to be `react-katex`, which is unmaintained: it ships no usable types
 * (its `dist/react-katex.d.ts` is a mis-packaged coverage report) and its React
 * peer range caps out at 18, which blocked the React 19 / Next 16 upgrade needed
 * to clear several Next.js security advisories. It was a ~60 line wrapper around
 * `katex.renderToString`, so it is now a ~40 line one, here.
 *
 * `renderToString` rather than `katex.render` on a ref, so the preview also
 * renders during SSR and the first paint is not blank.
 */

interface MathProps {
  math: string;
  /** Takes over rendering when KaTeX cannot parse the input. */
  renderError?: (error: Error) => React.ReactNode;
}

function useRendered(math: string, displayMode: boolean) {
  return useMemo(() => {
    try {
      return { html: katex.renderToString(math, { ...KATEX_OPTIONS, displayMode }), error: null };
    } catch (error) {
      return { html: "", error: error instanceof Error ? error : new Error(String(error)) };
    }
  }, [math, displayMode]);
}

export function InlineMath({ math, renderError }: MathProps) {
  const { html, error } = useRendered(math, false);
  if (error) return <>{renderError ? renderError(error) : null}</>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function BlockMath({ math, renderError }: MathProps) {
  const { html, error } = useRendered(math, true);
  if (error) return <>{renderError ? renderError(error) : null}</>;
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
