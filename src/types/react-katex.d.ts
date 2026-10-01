/**
 * react-katex@3 ships no usable type definitions (its `dist/react-katex.d.ts`
 * is a mis-packaged coverage report directory, and package.json has no `types`
 * field). This is the minimal surface CleanMath uses.
 */
declare module "react-katex" {
  import type { ComponentType, ReactNode } from "react";
  import type { KatexOptions } from "katex";

  export interface MathComponentProps {
    math?: string;
    children?: ReactNode;
    /** Colour used by the default error rendering. */
    errorColor?: string;
    /** Takes over rendering when KaTeX throws a ParseError. */
    renderError?: (error: Error) => ReactNode;
    settings?: KatexOptions;
    as?: string;
  }

  export const InlineMath: ComponentType<MathComponentProps>;
  export const BlockMath: ComponentType<MathComponentProps>;
}
