/**
 * ocr.ts - an image (or PDF) of mathematics, transcribed to Markdown or LaTeX
 * by Gemini's vision. This file builds the request and validates the answer;
 * the network call is the browser's (components/ai/ImageConvert.tsx).
 *
 * Structured output: the model must answer with JSON matching OCR_SCHEMA, so
 * there is nothing to scrape out of prose. The content then goes through the
 * normal cleaner like any pasted text. Pure, ASCII-only.
 */
import { geminiSchema, thinkingConfig } from "./derivation";

export type OcrFormat = "markdown" | "latex" | "formulas";

export const OCR_FORMATS: ReadonlyArray<{ id: OcrFormat; label: string; hint: string }> = [
  { id: "markdown", label: "Markdown + math", hint: "Everything: text, headings, lists, tables; maths as $...$ and $$...$$" },
  { id: "latex", label: "LaTeX", hint: "A LaTeX body: \\section, itemize, tabular, equation / align" },
  { id: "formulas", label: "Formulas only", hint: "Just the mathematics, one display block each" },
];

/** What the browser may send (Gemini's inline-data limit is generous; we stay well below). */
export const OCR_MIME = /^(image\/(png|jpeg|webp|heic|heif)|application\/pdf)$/;
export const OCR_MAX_BYTES = 15 * 1024 * 1024;

export const OCR_SCHEMA = {
  type: "object",
  properties: {
    content: { type: "string" },
    title: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["content", "title", "warnings"],
};

const RULES: Record<OcrFormat, string[]> = {
  markdown: [
    "Transcribe ALL of the content into Markdown.",
    "Every mathematical expression in LaTeX: inline as $...$, display maths as $$...$$ on lines of their own.",
    "Keep the structure: # headings, lists, Markdown tables, bold and italics where the source has them.",
  ],
  latex: [
    "Transcribe ALL of the content into a LaTeX document body (no \\documentclass, no preamble, no \\begin{document}).",
    "Use \\section / \\subsection for headings, itemize / enumerate for lists, tabular for tables, $...$ inline, and equation / align environments for display maths.",
  ],
  formulas: [
    "Extract ONLY the mathematical formulas, in reading order.",
    "Write each as display maths $$...$$, separated by a blank line. Keep equation numbers as \\tag{n}.",
  ],
};

/** The prompt for a format; `hint` is optional extra guidance from the user. */
export function ocrPrompt(format: OcrFormat, hint = ""): string {
  return [
    "You are a precise transcriber of mathematical documents, printed or handwritten.",
    ...RULES[format],
    "Reproduce exactly what is written: do not solve, simplify, summarise, translate or correct the mathematics.",
    "Use standard LaTeX that KaTeX renders (\\frac, \\sqrt, \\sum, \\int, \\mathbf, \\begin{pmatrix} ...).",
    "Mark anything unreadable as [illegible] and list doubts in warnings (short sentences). title: the content's subject in under 8 words.",
    hint.trim() ? "The user adds: " + hint.trim().slice(0, 300) : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The generateContent body: the prompt, the image inline, and the JSON schema. */
export function ocrRequest(format: OcrFormat, mimeType: string, base64: string, model = "", hint = "", thinking = true): object {
  const think = thinking ? thinkingConfig(model) : undefined;
  return {
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }, { text: ocrPrompt(format, hint) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: geminiSchema(OCR_SCHEMA),
      ...(think ? { thinkingConfig: think } : {}),
    },
  };
}

export interface OcrResult {
  content: string;
  title: string;
  warnings: string[];
}

/** Validate the model's JSON. A stray code fence around the content is removed. */
export function parseOcr(raw: unknown): OcrResult | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (typeof r.content !== "string" || !r.content.trim()) return null;
  const content = r.content
    .trim()
    .replace(/^```(?:markdown|md|latex|tex)?\s*\n([\s\S]*?)\n```$/i, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
  return {
    content,
    title: typeof r.title === "string" ? r.title.trim().slice(0, 80) : "",
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w): w is string => typeof w === "string" && !!w.trim()).map((w) => w.trim().slice(0, 200)).slice(0, 8) : [],
  };
}
