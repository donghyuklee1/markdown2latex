/**
 * highlight.ts - a ~40 line LaTeX tokenizer for the output pane.
 *
 * A full syntax-highlighting library would be ~100x the bundle for one language
 * we already understand. Returns escaped HTML, so the result is safe to hand to
 * dangerouslySetInnerHTML.
 */

const TOKEN_RE = new RegExp(
  [
    "(%[^\\n]*)", // 1 comment
    "(\\\\(?:begin|end)\\{[^}\\n]*\\})", // 2 environment
    "(\\\\\\\\)", // 3 row break
    "(\\\\[A-Za-z]+\\*?)", // 4 command
    "(\\\\[^A-Za-z])", // 5 escaped char
    "(\\$\\$|\\$)", // 6 math delimiter
    "([{}\\[\\]])", // 7 group
    "(&|\\^|_)", // 8 operator-ish
    "(\\d+\\.?\\d*)", // 9 number
  ].join("|"),
  "g",
);

const CLASSES = [
  "text-slate-500 italic", // comment
  "text-fuchsia-400", // environment
  "text-rose-400 font-semibold", // row break
  "text-sky-400", // command
  "text-sky-300/80", // escaped char
  "text-amber-400 font-semibold", // delimiter
  "text-slate-500", // group
  "text-emerald-400", // operator
  "text-orange-300", // number
];

function escapeHtml(src: string): string {
  return src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Highlight one line of LaTeX. Returns HTML with escaped content. */
export function highlightLine(line: string): string {
  if (!line) return "";
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;

  while ((m = TOKEN_RE.exec(line))) {
    if (m.index > last) out += escapeHtml(line.slice(last, m.index));
    const groupIdx = m.findIndex((g, i) => i > 0 && g !== undefined) - 1;
    const cls = CLASSES[groupIdx] ?? "";
    out += '<span class="' + cls + '">' + escapeHtml(m[0]) + "</span>";
    last = m.index + m[0].length;
  }
  if (last < line.length) out += escapeHtml(line.slice(last));
  return out;
}
