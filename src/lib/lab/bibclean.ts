/**
 * bibclean.ts - parse, repair and pretty-print a .bib file.
 *
 * The pain: a bibliography assembled from Google Scholar, DBLP, publisher
 * pages and a co-author's old file has three key styles, half-filled entries,
 * the same paper twice, and a bare `&` in a journal name that kills the
 * Overleaf compile three pages into the reference list. This module turns
 * that into one consistent file and reports what it changed.
 *
 * Pipeline: parse (tolerant, never throws) -> dedupe -> normalize authors,
 * venues, pages -> escape / protect capitals -> regenerate keys -> validate
 * -> print. `rewriteCites` then carries the key changes into a .tex file.
 *
 * Pure: no DOM, no I/O. Problems are returned as warnings with line numbers.
 */

/* ------------------------------------------------------------------- types */

export type KeyPattern = "authorYearWord" | "AuthorYear" | "keep";
export type VenueMode = "full" | "abbrev" | "keep";

export interface BibOptions {
  keys: KeyPattern;
  venues: VenueMode;
  dedupe: boolean;
  normalizeAuthors: boolean;
  /** Escape bare `& % # _ $` in text fields. */
  escape: boolean;
  /** Brace words like BERT / ImageNet in titles so styles keep their case. */
  protectCaps: boolean;
  sort: boolean;
}

export const DEFAULT_BIB_OPTIONS: BibOptions = {
  keys: "authorYearWord",
  venues: "keep",
  dedupe: true,
  normalizeAuthors: true,
  escape: true,
  protectCaps: false,
  sort: false,
};

export interface BibField {
  /** Lowercased field name. */
  name: string;
  /** Resolved value: braces/quotes stripped, `#` concatenations and macros expanded. */
  value: string;
  line: number;
}

export interface BibEntry {
  /** Lowercased entry type, e.g. "article". */
  type: string;
  key: string;
  fields: BibField[];
  line: number;
}

export type BibItem = { kind: "entry"; entry: BibEntry } | { kind: "raw"; text: string; line: number };

export interface BibWarning {
  line: number;
  key: string;
  message: string;
}

export interface BibStats {
  /** Entries in the output. */
  entries: number;
  /** Entries read from the input, before merging. */
  parsed: number;
  duplicatesMerged: number;
  keysChanged: number;
  authorsNormalized: number;
  venuesChanged: number;
  pagesFixed: number;
  escaped: number;
  protectedWords: number;
  warnings: number;
}

export interface BibResult {
  output: string;
  entries: number;
  /** Old key -> new key, for every input key (merged duplicates map to the survivor). */
  keyMap: Record<string, string>;
  /** `from` is the removed entry's original key, `into` the survivor's final key. */
  merged: { from: string; into: string }[];
  warnings: BibWarning[];
  stats: BibStats;
}

/* ----------------------------------------------------------------- parsing */

const MONTHS: ReadonlyArray<[string, string]> = [
  ["jan", "January"], ["feb", "February"], ["mar", "March"], ["apr", "April"],
  ["may", "May"], ["jun", "June"], ["jul", "July"], ["aug", "August"],
  ["sep", "September"], ["oct", "October"], ["nov", "November"], ["dec", "December"],
];

function lineIndex(src: string): (pos: number) => number {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (pos) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Index just past the `}` matching the `{` at `open`, or -1 if unbalanced. */
function braceEnd(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Parse a .bib source. Never throws: anything it cannot read becomes a warning
 * and parsing resumes at the next line that starts with `@`.
 */
export function parseBib(src: string): { items: BibItem[]; strings: Record<string, string>; warnings: BibWarning[] } {
  const items: BibItem[] = [];
  const warnings: BibWarning[] = [];
  const macros = new Map<string, string>(MONTHS);
  const strings: Record<string, string> = {};
  const lineAt = lineIndex(src);
  const n = src.length;
  const warn = (pos: number, key: string, message: string) => warnings.push({ line: lineAt(pos), key, message });
  const skipWs = (j: number) => {
    while (j < n && /\s/.test(src[j])) j++;
    return j;
  };
  /** Next `@` that starts a line, after `from` - where recovery resumes. */
  const recover = (from: number) => {
    const re = /\n[ \t]*@/g;
    re.lastIndex = from;
    const m = re.exec(src);
    return m ? m.index + m[0].length - 1 : n;
  };

  /** One field value: `{...}`, `"..."`, a number or a macro, joined by `#`. */
  const parseValue = (start: number, key: string): { value: string; end: number } | null => {
    let j = start;
    let value = "";
    for (;;) {
      j = skipWs(j);
      const c = src[j];
      if (c === "{") {
        const e = braceEnd(src, j);
        const inner = e === -1 ? "" : src.slice(j + 1, e - 1);
        // A brace that swallows the next entry is really an unclosed brace.
        if (e === -1 || /\n[ \t]*@[a-zA-Z]+[ \t]*[{(]/.test(inner)) {
          warn(j, key, "Unbalanced braces in a field value - entry cut short here");
          return null;
        }
        value += inner;
        j = e;
      } else if (c === '"') {
        let k = j + 1;
        let depth = 0;
        for (; k < n; k++) {
          const ch = src[k];
          if (ch === "\\") k++;
          else if (ch === "{") depth++;
          else if (ch === "}") depth--;
          else if (ch === '"' && depth <= 0) break;
          else if (ch === "@" && src[k - 1] === "\n") k = n;
        }
        if (k >= n) {
          warn(j, key, "Unterminated quoted value - entry cut short here");
          return null;
        }
        value += src.slice(j + 1, k);
        j = k + 1;
      } else if (c !== undefined && /[0-9]/.test(c)) {
        const m = /^[0-9]+/.exec(src.slice(j, j + 40))!;
        value += m[0];
        j += m[0].length;
      } else if (c !== undefined && /[^\s#,{}"=()]/.test(c)) {
        const m = /^[^\s#,{}"=()]+/.exec(src.slice(j, j + 200))!;
        const name = m[0];
        const hit = macros.get(name.toLowerCase());
        if (hit === undefined) {
          warn(j, key, 'Undefined @string macro "' + name + '" - kept as literal text');
          value += name;
        } else value += hit;
        j += name.length;
      } else {
        warn(j, key, "Expected a value ({...}, \"...\", number or macro)");
        return null;
      }
      const after = skipWs(j);
      if (src[after] === "#") j = after + 1;
      else return { value: collapse(value), end: j };
    }
  };

  const gap = (from: number, to: number) => {
    const text = src.slice(from, to);
    let reported = false;
    let pos = from;
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.startsWith("%")) items.push({ kind: "raw", text: t, line: lineAt(pos) });
      else if (t && !reported) {
        warn(pos + line.indexOf(t[0]), "", "Text outside any entry was ignored");
        reported = true;
      }
      pos += line.length + 1;
    }
  };

  let i = 0;
  while (i < n) {
    const at = src.indexOf("@", i);
    gap(i, at === -1 ? n : at);
    if (at === -1) break;
    let j = skipWs(at + 1);
    const typeM = /^[A-Za-z][\w-]*/.exec(src.slice(j, j + 40));
    if (!typeM) {
      warn(at, "", "Stray @ ignored");
      i = at + 1;
      continue;
    }
    const type = typeM[0].toLowerCase();
    j = skipWs(j + typeM[0].length);
    const open = src[j];
    if (open !== "{" && open !== "(") {
      warn(at, "", "Expected { after @" + typeM[0]);
      i = j;
      continue;
    }
    const close = open === "{" ? "}" : ")";

    if (type === "comment" || type === "preamble") {
      let end = -1;
      if (open === "{") end = braceEnd(src, j);
      else {
        const k = src.indexOf(")", j);
        end = k === -1 ? -1 : k + 1;
      }
      if (end === -1) {
        warn(at, "", "Unclosed @" + type + " - skipped to the next entry");
        i = recover(j);
        continue;
      }
      items.push({ kind: "raw", text: src.slice(at, end), line: lineAt(at) });
      i = end;
      continue;
    }

    if (type === "string") {
      j = skipWs(j + 1);
      const nameM = /^[^\s=,{}"#()]+/.exec(src.slice(j, j + 200));
      const eq = nameM ? skipWs(j + nameM[0].length) : j;
      if (!nameM || src[eq] !== "=") {
        warn(at, "", "Malformed @string - expected name = value");
        i = recover(j);
        continue;
      }
      const v = parseValue(eq + 1, "@string");
      if (!v) {
        i = recover(eq);
        continue;
      }
      macros.set(nameM[0].toLowerCase(), v.value);
      strings[nameM[0]] = v.value;
      const k = skipWs(v.end);
      i = src[k] === close ? k + 1 : k;
      continue;
    }

    // A regular entry: key, then `name = value` pairs.
    j++;
    const keyM = /^[^,\s}){(]*/.exec(src.slice(j, j + 500))!;
    const key = keyM[0];
    const entry: BibEntry = { type, key, fields: [], line: lineAt(at) };
    if (!key) warn(at, "", "Entry @" + type + " has no cite key");
    items.push({ kind: "entry", entry });
    j += key.length;
    for (;;) {
      j = skipWs(j);
      if (j >= n) {
        warn(at, key, "Entry is never closed");
        i = n;
        break;
      }
      const c = src[j];
      if (c === close) {
        i = j + 1;
        break;
      }
      if (c === ",") {
        j++;
        continue;
      }
      if (c === "@" && src[j - 1] === "\n") {
        warn(at, key, "Entry is never closed");
        i = j;
        break;
      }
      const nameM = /^[^\s=,{}"#()]+/.exec(src.slice(j, j + 200));
      if (!nameM) {
        warn(j, key, 'Unexpected "' + c + '" - skipped to the next entry');
        i = recover(j);
        break;
      }
      const fieldStart = j;
      const eq = skipWs(j + nameM[0].length);
      if (src[eq] !== "=") {
        warn(j, key, 'Field "' + nameM[0] + '" has no "= value" - skipped to the next entry');
        i = recover(j);
        break;
      }
      const v = parseValue(eq + 1, key);
      if (!v) {
        i = recover(fieldStart);
        break;
      }
      const name = nameM[0].toLowerCase();
      if (entry.fields.some((f) => f.name === name)) warn(fieldStart, key, 'Duplicate field "' + name + '" - first one kept');
      else entry.fields.push({ name, value: v.value, line: lineAt(fieldStart) });
      j = skipWs(v.end);
      if (src[j] !== "," && src[j] !== close && j < n) warn(j, key, 'Missing comma after field "' + name + '"');
    }
  }
  return { items, strings, warnings };
}

/* ------------------------------------------------------------ text helpers */

const LATEX_LETTERS: Record<string, string> = {
  ss: "ss", o: "o", O: "O", ae: "ae", AE: "AE", oe: "oe", OE: "OE", aa: "a", AA: "A", l: "l", L: "L", i: "i", j: "j",
};
const UNICODE_LETTERS: Record<string, string> = {
  "\u00df": "ss", "\u00f8": "o", "\u00d8": "O", "\u0142": "l", "\u0141": "L", "\u00e6": "ae", "\u00c6": "AE",
  "\u0153": "oe", "\u0152": "OE", "\u0111": "d", "\u0110": "D", "\u0131": "i",
};

/** LaTeX accents and Unicode letters to plain ASCII: `M{\"u}ller` -> `Muller`. */
export function asciiFold(s: string): string {
  return s
    .replace(/\\(ss|o|O|ae|AE|oe|OE|aa|AA|l|L|i|j)(?![a-zA-Z])\s*/g, (_, c: string) => LATEX_LETTERS[c])
    .replace(/\\[`'^"~=.]/g, "")
    .replace(/\\[cvuHkrdbt](?![a-zA-Z])\s*/g, "")
    .replace(/\\[a-zA-Z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .replace(/[\u00df\u00f8\u00d8\u0142\u0141\u00e6\u00c6\u0153\u0152\u0111\u0110\u0131]/g, (c) => UNICODE_LETTERS[c])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Split at depth-0 whitespace (and `~`), keeping brace groups whole. */
function words(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      cur += c + s[++i];
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    if (depth === 0 && (/\s/.test(c) || c === "~")) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** Split at depth-0 commas. */
function commaParts(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) {
      cur += c + s[++i];
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/* ----------------------------------------------------------------- authors */

export interface PersonName {
  first: string;
  von: string;
  last: string;
  jr: string;
  /** `{OpenAI}` or `others`: printed verbatim. */
  literal?: string;
}

/** BibTeX's "von" test: the first letter (past braces and accent commands) is lowercase. */
function isLowerWord(w: string): boolean {
  if (w.startsWith("{") && !w.startsWith("{\\")) return false;
  const letter = /[A-Za-z]/.exec(w.replace(/^\{?\\[a-zA-Z]+\s*|^\{?\\[^a-zA-Z]/, ""));
  return !!letter && letter[0] === letter[0].toLowerCase();
}

/** Split an author field at depth-0 ` and `. */
export function splitAuthors(field: string): string[] {
  const out: string[][] = [[]];
  for (const w of words(field)) {
    if (w.toLowerCase() === "and") out.push([]);
    else out[out.length - 1].push(w);
  }
  return out.map((ws) => ws.join(" ")).filter(Boolean);
}

/** Parse one name in any of BibTeX's three forms. */
export function parseName(name: string): PersonName {
  const t = name.trim();
  if (t.toLowerCase() === "others") return { first: "", von: "", last: "", jr: "", literal: "others" };
  if (t.startsWith("{") && braceEnd(t, 0) === t.length) return { first: "", von: "", last: t, jr: "", literal: t };
  const parts = commaParts(t);
  if (parts.length === 1) {
    const ws = words(t);
    if (ws.length === 1) return { first: "", von: "", last: ws[0], jr: "" };
    // First von Last: von starts at the first lowercase word, Last is the rest (at least one word).
    let v = ws.findIndex((w, i) => i < ws.length - 1 && isLowerWord(w));
    if (v === -1) v = ws.length - 1;
    let l = v;
    while (l < ws.length - 1 && isLowerWord(ws[l])) l++;
    return { first: ws.slice(0, v).join(" "), von: ws.slice(v, l).join(" "), last: ws.slice(l).join(" "), jr: "" };
  }
  const head = words(parts[0]);
  let l = 0;
  while (l < head.length - 1 && isLowerWord(head[l])) l++;
  const von = head.slice(0, l).join(" ");
  const last = head.slice(l).join(" ");
  if (parts.length === 2) return { first: parts[1], von, last, jr: "" };
  return { first: parts.slice(2).join(", "), von, last, jr: parts[1] };
}

/** `J` -> `J.`, `J.R.` -> `J. R.`; full names untouched. */
function fixInitials(first: string): string {
  return words(first)
    .map((w) => (/^[A-Z]$/.test(w) ? w + "." : /^([A-Z]\.){2,}$/.test(w) ? w.replace(/\./g, ". ").trim() : w))
    .join(" ")
    .replace(/\s+/g, " ");
}

export function formatName(p: PersonName): string {
  if (p.literal) return p.literal;
  const last = (p.von ? p.von + " " : "") + p.last;
  const first = fixInitials(p.first);
  if (p.jr) return last + ", " + p.jr + ", " + first;
  return first ? last + ", " + first : last;
}

/** Normalize an author/editor list to `Last, First M. and ...`. */
export function normalizeAuthors(field: string): string {
  return splitAuthors(field).map((a) => formatName(parseName(a))).join(" and ");
}

/* ------------------------------------------------------------------ venues */

interface Venue {
  full: string;
  abbr: string;
  aliases?: string[];
}

/**
 * Curated venues. Conferences carry their acronym in parentheses in the
 * abbreviated form, the way IEEE-style reference lists print them.
 */
const VENUES: ReadonlyArray<Venue> = [
  // Journals - machine learning, vision, AI.
  { full: "IEEE Transactions on Pattern Analysis and Machine Intelligence", abbr: "IEEE Trans. Pattern Anal. Mach. Intell.", aliases: ["TPAMI", "IEEE TPAMI", "PAMI"] },
  { full: "IEEE Transactions on Image Processing", abbr: "IEEE Trans. Image Process.", aliases: ["TIP", "IEEE TIP"] },
  { full: "IEEE Transactions on Neural Networks and Learning Systems", abbr: "IEEE Trans. Neural Netw. Learn. Syst.", aliases: ["TNNLS"] },
  { full: "IEEE Transactions on Information Theory", abbr: "IEEE Trans. Inf. Theory" },
  { full: "IEEE Transactions on Signal Processing", abbr: "IEEE Trans. Signal Process." },
  { full: "International Journal of Computer Vision", abbr: "Int. J. Comput. Vis.", aliases: ["IJCV"] },
  { full: "Journal of Machine Learning Research", abbr: "J. Mach. Learn. Res.", aliases: ["JMLR", "The Journal of Machine Learning Research"] },
  { full: "Transactions on Machine Learning Research", abbr: "Trans. Mach. Learn. Res.", aliases: ["TMLR"] },
  { full: "Machine Learning", abbr: "Mach. Learn." },
  { full: "Artificial Intelligence", abbr: "Artif. Intell." },
  { full: "Journal of Artificial Intelligence Research", abbr: "J. Artif. Intell. Res.", aliases: ["JAIR"] },
  { full: "Neural Computation", abbr: "Neural Comput." },
  { full: "Neural Networks", abbr: "Neural Netw." },
  { full: "Nature Machine Intelligence", abbr: "Nat. Mach. Intell." },
  { full: "ACM Computing Surveys", abbr: "ACM Comput. Surv." },
  { full: "ACM Transactions on Graphics", abbr: "ACM Trans. Graph.", aliases: ["TOG"] },
  { full: "Communications of the ACM", abbr: "Commun. ACM", aliases: ["CACM"] },
  { full: "Journal of the ACM", abbr: "J. ACM", aliases: ["JACM"] },
  // Conferences.
  { full: "Advances in Neural Information Processing Systems", abbr: "Adv. Neural Inf. Process. Syst. (NeurIPS)", aliases: ["NeurIPS", "NIPS", "Neural Information Processing Systems", "Conference on Neural Information Processing Systems", "Advances in Neural Information Processing Systems (NIPS)", "Adv. Neural Inf. Process. Syst."] },
  { full: "Proceedings of the International Conference on Machine Learning", abbr: "Proc. Int. Conf. Mach. Learn. (ICML)", aliases: ["ICML", "International Conference on Machine Learning"] },
  { full: "International Conference on Learning Representations", abbr: "Int. Conf. Learn. Represent. (ICLR)", aliases: ["ICLR"] },
  { full: "Proceedings of the IEEE/CVF Conference on Computer Vision and Pattern Recognition", abbr: "Proc. IEEE/CVF Conf. Comput. Vis. Pattern Recognit. (CVPR)", aliases: ["CVPR", "IEEE Conference on Computer Vision and Pattern Recognition", "Computer Vision and Pattern Recognition", "IEEE Computer Society Conference on Computer Vision and Pattern Recognition", "Proc. IEEE Conf. Comput. Vis. Pattern Recognit."] },
  { full: "Proceedings of the IEEE/CVF International Conference on Computer Vision", abbr: "Proc. IEEE/CVF Int. Conf. Comput. Vis. (ICCV)", aliases: ["ICCV", "IEEE International Conference on Computer Vision", "International Conference on Computer Vision"] },
  { full: "Proceedings of the European Conference on Computer Vision", abbr: "Proc. Eur. Conf. Comput. Vis. (ECCV)", aliases: ["ECCV", "European Conference on Computer Vision"] },
  { full: "Proceedings of the AAAI Conference on Artificial Intelligence", abbr: "Proc. AAAI Conf. Artif. Intell. (AAAI)", aliases: ["AAAI", "AAAI Conference on Artificial Intelligence"] },
  { full: "Proceedings of the International Joint Conference on Artificial Intelligence", abbr: "Proc. Int. Joint Conf. Artif. Intell. (IJCAI)", aliases: ["IJCAI", "International Joint Conference on Artificial Intelligence"] },
  { full: "Proceedings of the Annual Meeting of the Association for Computational Linguistics", abbr: "Proc. Annu. Meet. Assoc. Comput. Linguist. (ACL)", aliases: ["ACL", "Association for Computational Linguistics", "Annual Meeting of the Association for Computational Linguistics"] },
  { full: "Proceedings of the Conference on Empirical Methods in Natural Language Processing", abbr: "Proc. Conf. Empir. Methods Nat. Lang. Process. (EMNLP)", aliases: ["EMNLP", "Empirical Methods in Natural Language Processing"] },
  { full: "Proceedings of the Conference of the North American Chapter of the Association for Computational Linguistics", abbr: "Proc. Conf. North Am. Chapter Assoc. Comput. Linguist. (NAACL)", aliases: ["NAACL", "NAACL-HLT", "North American Chapter of the Association for Computational Linguistics"] },
  { full: "Proceedings of the ACM SIGKDD International Conference on Knowledge Discovery and Data Mining", abbr: "Proc. ACM SIGKDD Int. Conf. Knowl. Discov. Data Min. (KDD)", aliases: ["KDD", "SIGKDD"] },
  { full: "Proceedings of the International Conference on Artificial Intelligence and Statistics", abbr: "Proc. Int. Conf. Artif. Intell. Stat. (AISTATS)", aliases: ["AISTATS"] },
  { full: "Proceedings of the Conference on Uncertainty in Artificial Intelligence", abbr: "Proc. Conf. Uncertain. Artif. Intell. (UAI)", aliases: ["UAI"] },
  { full: "Proceedings of the Conference on Learning Theory", abbr: "Proc. Conf. Learn. Theory (COLT)", aliases: ["COLT"] },
  { full: "Proceedings of the IEEE International Conference on Robotics and Automation", abbr: "Proc. IEEE Int. Conf. Robot. Autom. (ICRA)", aliases: ["ICRA"] },
  { full: "Proceedings of the IEEE International Conference on Acoustics, Speech and Signal Processing", abbr: "Proc. IEEE Int. Conf. Acoust. Speech Signal Process. (ICASSP)", aliases: ["ICASSP"] },
  // Science, physics, chemistry, mathematics, statistics.
  { full: "Nature", abbr: "Nature" },
  { full: "Science", abbr: "Science" },
  { full: "Nature Communications", abbr: "Nat. Commun." },
  { full: "Proceedings of the National Academy of Sciences", abbr: "Proc. Natl. Acad. Sci. U.S.A.", aliases: ["PNAS", "Proceedings of the National Academy of Sciences of the United States of America", "Proc. Natl. Acad. Sci."] },
  { full: "Physical Review Letters", abbr: "Phys. Rev. Lett.", aliases: ["PRL"] },
  { full: "Physical Review A", abbr: "Phys. Rev. A" },
  { full: "Physical Review B", abbr: "Phys. Rev. B" },
  { full: "Physical Review D", abbr: "Phys. Rev. D" },
  { full: "Physical Review E", abbr: "Phys. Rev. E" },
  { full: "Reviews of Modern Physics", abbr: "Rev. Mod. Phys." },
  { full: "Journal of the American Chemical Society", abbr: "J. Am. Chem. Soc.", aliases: ["JACS"] },
  { full: "Angewandte Chemie International Edition", abbr: "Angew. Chem. Int. Ed." },
  { full: "Annals of Mathematics", abbr: "Ann. Math." },
  { full: "SIAM Journal on Computing", abbr: "SIAM J. Comput." },
  { full: "SIAM Journal on Numerical Analysis", abbr: "SIAM J. Numer. Anal." },
  { full: "SIAM Journal on Optimization", abbr: "SIAM J. Optim." },
  { full: "SIAM Journal on Scientific Computing", abbr: "SIAM J. Sci. Comput." },
  { full: "SIAM Review", abbr: "SIAM Rev." },
  { full: "Annals of Statistics", abbr: "Ann. Stat.", aliases: ["The Annals of Statistics"] },
  { full: "Journal of the American Statistical Association", abbr: "J. Am. Stat. Assoc.", aliases: ["JASA"] },
  { full: "Journal of the Royal Statistical Society: Series B", abbr: "J. R. Stat. Soc. Ser. B", aliases: ["Journal of the Royal Statistical Society Series B (Statistical Methodology)"] },
  { full: "Cell", abbr: "Cell" },
  { full: "The New England Journal of Medicine", abbr: "N. Engl. J. Med.", aliases: ["NEJM"] },
];

/** Words dropped before venue matching (and by ISO 4 when abbreviating). */
const VENUE_DROP = new Set(["proceedings", "proc", "of", "the", "in", "on", "and", "for", "volume", "vol", "part"]);

function venueKey(s: string): string {
  return asciiFold(
    s
      .replace(/\\&/g, " and ")
      .replace(/&/g, " and ")
      .replace(/\([^)]*\)/g, " "),
  )
    .toLowerCase()
    .replace(/'\d\d\b/g, " ")
    .replace(/\b\d+(st|nd|rd|th)\b/g, " ")
    .replace(/[^a-z]+/g, " ")
    .split(" ")
    .filter((w) => w && !VENUE_DROP.has(w))
    .join(" ");
}

const VENUE_INDEX: Map<string, Venue> = (() => {
  const m = new Map<string, Venue>();
  for (const v of VENUES) for (const name of [v.full, v.abbr, ...(v.aliases ?? [])]) m.set(venueKey(name), v);
  return m;
})();

/** ISO 4 / LTWA word abbreviations used when a venue is not in the table. */
const LTWA: Record<string, string> = {
  transactions: "Trans.", journal: "J.", international: "Int.", conference: "Conf.", proceedings: "Proc.",
  intelligence: "Intell.", analysis: "Anal.", machine: "Mach.", learning: "Learn.", research: "Res.",
  review: "Rev.", reviews: "Rev.", letters: "Lett.", physics: "Phys.", physical: "Phys.", chemistry: "Chem.",
  chemical: "Chem.", society: "Soc.", american: "Am.", mathematics: "Math.", mathematical: "Math.",
  science: "Sci.", sciences: "Sci.", scientific: "Sci.", engineering: "Eng.", computer: "Comput.",
  computing: "Comput.", computational: "Comput.", communications: "Commun.", systems: "Syst.",
  information: "Inf.", processing: "Process.", applied: "Appl.", applications: "Appl.", statistics: "Stat.",
  statistical: "Stat.", annals: "Ann.", advances: "Adv.", advanced: "Adv.", networks: "Netw.",
  recognition: "Recognit.", vision: "Vis.", graphics: "Graph.", software: "Softw.", technology: "Technol.",
  electronics: "Electron.", biology: "Biol.", biological: "Biol.", medicine: "Med.", medical: "Med.",
  national: "Natl.", academy: "Acad.", quarterly: "Q.", symposium: "Symp.", annual: "Annu.",
  theoretical: "Theor.", robotics: "Robot.", automation: "Autom.", language: "Lang.", languages: "Lang.",
  linguistics: "Linguist.", association: "Assoc.", optimization: "Optim.", numerical: "Numer.",
  industrial: "Ind.", european: "Eur.", royal: "R.", series: "Ser.", acoustics: "Acoust.",
  knowledge: "Knowl.", discovery: "Discov.", management: "Manag.", artificial: "Artif.",
  foundations: "Found.", geometry: "Geom.", environmental: "Environ.", materials: "Mater.",
  biomedical: "Biomed.", molecular: "Mol.", nuclear: "Nucl.", optics: "Opt.", psychology: "Psychol.",
  economics: "Econ.", economic: "Econ.", operations: "Oper.", bulletin: "Bull.", experimental: "Exp.",
  mechanics: "Mech.", astronomy: "Astron.", neuroscience: "Neurosci.", cognitive: "Cogn.",
  programming: "Program.", distributed: "Distrib.", security: "Secur.", multimedia: "Multimed.",
  visualization: "Vis.", interaction: "Interact.", human: "Hum.", sensing: "Sens.", wireless: "Wirel.",
  representations: "Represent.", empirical: "Empir.", natural: "Nat.", uncertainty: "Uncertain.",
  methods: "Methods", theory: "Theory", workshop: "Worksh.",
};
const ISO4_DROP = new Set(["of", "the", "on", "and", "for", "in", "&", "\\&"]);

/** ISO 4 fallback: abbreviate word by word, drop articles and conjunctions. Single-word titles stay. */
export function iso4(name: string): string {
  const ws = name.trim().split(/\s+/);
  if (ws.length < 2) return name.trim();
  return ws
    .filter((w, i) => i === 0 || !ISO4_DROP.has(w.toLowerCase()))
    .map((w) => {
      const m = /^([^A-Za-z]*)([A-Za-z]+)([^A-Za-z]*)$/.exec(w);
      if (!m) return w;
      const hit = LTWA[m[2].toLowerCase()];
      return hit ? m[1] + hit + m[3].replace(/^\./, "") : w;
    })
    .join(" ");
}

/** Venue name in the requested form. `keep`, or an unknown venue in `full` mode, returns it unchanged. */
export function abbreviateVenue(name: string, mode: VenueMode): string {
  if (mode === "keep") return name;
  const hit = VENUE_INDEX.get(venueKey(name));
  if (hit) return mode === "full" ? hit.full : hit.abbr;
  return mode === "abbrev" ? iso4(name) : name;
}

/* ----------------------------------------------------- escaping, capitals */

/** Fields whose content is a URL, path or identifier - never escaped. */
const VERBATIM_FIELDS = new Set(["url", "doi", "file", "eprint", "pdf", "link", "archiveprefix", "primaryclass", "eprintclass", "eprinttype", "isbn", "issn", "keywords", "urldate", "crossref", "key"]);
/** Commands whose (first) argument is a URL or label. */
const VERBATIM_ARGS = /^\\(url|href|path|nolinkurl|doi|ref|eqref|label|cite[a-zA-Z]*)\s*\{/;

const isEscaped = (s: string, i: number) => {
  let k = 0;
  while (i - 1 - k >= 0 && s[i - 1 - k] === "\\") k++;
  return k % 2 === 1;
};

/**
 * Escape bare `& % # _ $`. Paired `$...$` is treated as math and skipped,
 * as are already-escaped characters and URL / label arguments.
 */
export function escapeSpecials(value: string): { value: string; count: number } {
  const dollars: number[] = [];
  for (let i = 0; i < value.length; i++) if (value[i] === "$" && !isEscaped(value, i)) dollars.push(i);
  const math = dollars.length % 2 === 0;
  let out = "";
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && !isEscaped(value, i)) {
      const m = VERBATIM_ARGS.exec(value.slice(i));
      if (m) {
        const end = braceEnd(value, i + m[0].length - 1);
        if (end !== -1) {
          out += value.slice(i, end);
          i = end - 1;
          continue;
        }
      }
      out += c;
      continue;
    }
    if (c === "$" && !isEscaped(value, i)) {
      if (math) {
        const close = dollars[dollars.indexOf(i) + 1];
        out += value.slice(i, close + 1);
        i = close;
      } else {
        out += "\\$";
        count++;
      }
      continue;
    }
    if ("&%#_".includes(c) && !isEscaped(value, i)) {
      out += "\\" + c;
      count++;
      continue;
    }
    out += c;
  }
  return { value: out, count };
}

/** Does a word need braces to survive a lowercasing style? (BERT, ImageNet, GPT-3, U-Net, 3D) */
function needsProtect(core: string): boolean {
  if (core.length < 2 || !/[A-Za-z]/.test(core)) return false;
  const parts = core.split("-");
  return parts.some((p) => /[A-Z]/.test(p.slice(1))) || (parts.length > 1 && parts.some((p) => /^[A-Z]$/.test(p)));
}

/** Brace title words with internal capitals; braced groups, math and commands are left alone. */
export function protectCapitals(title: string): { value: string; count: number } {
  let out = "";
  let count = 0;
  let i = 0;
  const n = title.length;
  while (i < n) {
    const c = title[i];
    if (c === "{") {
      const e = braceEnd(title, i);
      const stop = e === -1 ? n : e;
      out += title.slice(i, stop);
      i = stop;
    } else if (c === "$" && !isEscaped(title, i)) {
      const close = title.indexOf("$", i + 1);
      const stop = close === -1 ? n : close + 1;
      out += title.slice(i, stop);
      i = stop;
    } else if (c === "\\") {
      const m = /^\\([a-zA-Z]+|.)/.exec(title.slice(i));
      const len = m ? m[0].length : 1;
      out += title.slice(i, i + len);
      i += len;
    } else if (/\s/.test(c)) {
      out += c;
      i++;
    } else {
      let j = i;
      while (j < n && !/[\s{}$\\]/.test(title[j])) j++;
      // A word glued to a brace or command (`Na\"ive`, `x{y}`) is not a plain word: copy it as is.
      const glued = j < n && /[{}$\\]/.test(title[j]);
      const word = title.slice(i, j);
      const m = /^([("'`]*)(.*?)([)"'.,:;!?]*)$/.exec(word)!;
      if (!glued && needsProtect(m[2])) {
        out += m[1] + "{" + m[2] + "}" + m[3];
        count++;
      } else out += word;
      i = j;
    }
  }
  return { value: out, count };
}

/** `12-34`, `12 - 34`, `12\u201334` -> `12--34`. */
export function fixPages(pages: string): string {
  const m = /^\s*([A-Za-z]?\d+)\s*(?:-{1,3}|\u2013|\u2014)\s*([A-Za-z]?\d+)\s*$/.exec(pages);
  return m ? m[1] + "--" + m[2] : pages;
}

/* -------------------------------------------------------------------- keys */

const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "on", "of", "towards", "toward", "to", "in", "for", "and", "or", "with", "via", "at", "by",
  "from", "into", "is", "are", "do", "does", "how", "what", "why", "when", "which", "can", "we", "beyond", "about",
]);

const get = (e: BibEntry, name: string) => e.fields.find((f) => f.name === name)?.value ?? "";

function keyParts(e: BibEntry): { name: string; year: string; word: string } {
  const people = get(e, "author") || get(e, "editor");
  const first = people ? parseName(splitAuthors(people)[0] ?? "") : null;
  const name = first && first.literal !== "others" ? asciiFold(first.last).replace(/[^A-Za-z0-9]/g, "") : "";
  const year = (/\d{4}/.exec(get(e, "year")) ?? /\d{4}/.exec(get(e, "date")))?.[0] ?? "";
  const title = asciiFold(get(e, "title").replace(/\$[^$]*\$/g, " ")).toLowerCase();
  const word = title.split(/[^a-z0-9]+/).find((w) => w && !TITLE_STOPWORDS.has(w) && /[a-z]/.test(w)) ?? "";
  return { name, year, word };
}

function baseKey(e: BibEntry, pattern: KeyPattern): string {
  const { name, year, word } = keyParts(e);
  // Nothing to build a key from: a made-up "anon" key is worse than the user's own.
  if (!name && !word && e.key) return e.key;
  if (pattern === "AuthorYear") {
    const who = name || word || "Anon";
    return who[0].toUpperCase() + who.slice(1) + year;
  }
  return (name.toLowerCase() || "anon") + year + word;
}

const suffix = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : suffix(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));

/* --------------------------------------------------------------- dedupe */

export function normalizeDoi(doi: string): string {
  return doi.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
}

function titleKey(title: string): string {
  return asciiFold(title).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/* -------------------------------------------------------------- validation */

/** Required fields per type; `a|b` means either. */
const REQUIRED: Record<string, string[]> = {
  article: ["author", "title", "journal|journaltitle", "year|date"],
  book: ["author|editor", "title", "publisher", "year|date"],
  booklet: ["title"],
  inbook: ["author|editor", "title", "chapter|pages", "publisher", "year|date"],
  incollection: ["author", "title", "booktitle", "publisher", "year|date"],
  inproceedings: ["author", "title", "booktitle", "year|date"],
  conference: ["author", "title", "booktitle", "year|date"],
  manual: ["title"],
  mastersthesis: ["author", "title", "school|institution", "year|date"],
  phdthesis: ["author", "title", "school|institution", "year|date"],
  thesis: ["author", "title", "school|institution", "year|date"],
  misc: [],
  online: ["title", "url|doi"],
  proceedings: ["title", "year|date"],
  techreport: ["author", "title", "institution", "year|date"],
  report: ["author", "title", "institution", "year|date"],
  unpublished: ["author", "title", "note"],
};

function validate(e: BibEntry): string[] {
  const req = REQUIRED[e.type];
  if (!req) return ['Unknown entry type "@' + e.type + '"'];
  const msgs: string[] = [];
  for (const r of req) {
    const alts = r.split("|");
    if (!alts.some((a) => get(e, a).trim())) msgs.push("@" + e.type + " is missing " + alts.join(" or "));
  }
  const year = get(e, "year");
  if (year && !/^\d{4}$/.test(year.trim())) msgs.push('Year "' + year + '" is not a 4-digit year');
  if (e.type === "misc" && !get(e, "title")) msgs.push("@misc has no title");
  return msgs;
}

/* ------------------------------------------------------------------ output */

const FIELD_ORDER = ["author", "title", "journal", "booktitle", "editor", "volume", "number", "pages", "year", "publisher", "doi", "url"];

export function formatEntry(e: BibEntry): string {
  const rank = (f: BibField) => {
    const r = FIELD_ORDER.indexOf(f.name);
    return r === -1 ? FIELD_ORDER.length : r;
  };
  const fields = e.fields
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map(({ f }) => "  " + f.name + " = {" + f.value + "}");
  return "@" + e.type + "{" + e.key + (fields.length ? ",\n" + fields.join(",\n") + "\n" : "\n") + "}";
}

/* -------------------------------------------------------------------- main */

const TEXT_SKIP_FIELDS = (name: string) => VERBATIM_FIELDS.has(name) || name.includes("url");

/** Clean a .bib file. Never throws. */
export function cleanBib(src: string, options: BibOptions = DEFAULT_BIB_OPTIONS): BibResult {
  const { items, warnings } = parseBib(src);
  const stats: BibStats = {
    entries: 0, parsed: 0, duplicatesMerged: 0, keysChanged: 0, authorsNormalized: 0,
    venuesChanged: 0, pagesFixed: 0, escaped: 0, protectedWords: 0, warnings: 0,
  };
  const all = items.flatMap((it) => (it.kind === "entry" ? [it.entry] : []));
  stats.parsed = all.length;
  const original = new Map<BibEntry, string>(all.map((e) => [e, e.key]));

  // --- dedupe: by DOI, else by title (only when neither side has a different DOI).
  const removed = new Set<BibEntry>();
  const mergedInto: { from: BibEntry; into: BibEntry; fromKey: string }[] = [];
  if (options.dedupe) {
    const byDoi = new Map<string, BibEntry>();
    const byTitle = new Map<string, BibEntry>();
    for (const e of all) {
      const doi = normalizeDoi(get(e, "doi"));
      const tk = titleKey(get(e, "title"));
      let target = doi ? byDoi.get(doi) : undefined;
      if (!target && tk.length >= 12) {
        const t = byTitle.get(tk);
        const tDoi = t ? normalizeDoi(get(t, "doi")) : "";
        if (t && (!doi || !tDoi || doi === tDoi)) target = t;
      }
      if (!target) {
        if (doi) byDoi.set(doi, e);
        if (tk.length >= 12) byTitle.set(tk, e);
        continue;
      }
      // Keep the more complete entry's fields; the first one's position.
      const filled = (x: BibEntry) => x.fields.filter((f) => f.value.trim()).length;
      const [rich, poor] = filled(e) > filled(target) ? [e, target] : [target, e];
      const fields = rich.fields.slice();
      for (const f of poor.fields) {
        const have = fields.find((g) => g.name === f.name);
        if (!have) fields.push(f);
        else if (!have.value.trim() && f.value.trim()) fields[fields.indexOf(have)] = f;
      }
      target.fields = fields;
      if (rich === e) {
        target.type = e.type;
        target.key = e.key;
      }
      removed.add(e);
      // When the later entry is richer it takes over the first one's slot, so the first one's key is the one that goes away.
      mergedInto.push({ from: e, into: target, fromKey: original.get(rich === e ? target : e)! });
      if (doi) byDoi.set(doi, target);
      const nd = normalizeDoi(get(target, "doi"));
      if (nd) byDoi.set(nd, target);
    }
  }
  const entries = all.filter((e) => !removed.has(e));
  stats.duplicatesMerged = mergedInto.length;

  // --- field-level normalization.
  for (const e of entries) {
    for (const f of e.fields) {
      if (options.normalizeAuthors && (f.name === "author" || f.name === "editor")) {
        const v = normalizeAuthors(f.value);
        if (v !== f.value) stats.authorsNormalized++;
        f.value = v;
      }
      if (f.name === "journal" || f.name === "booktitle" || f.name === "journaltitle") {
        const v = abbreviateVenue(f.value, options.venues);
        if (v !== f.value) stats.venuesChanged++;
        f.value = v;
      }
      if (f.name === "pages") {
        const v = fixPages(f.value);
        if (v !== f.value) stats.pagesFixed++;
        f.value = v;
      }
      if (options.protectCaps && f.name === "title") {
        const r = protectCapitals(f.value);
        stats.protectedWords += r.count;
        f.value = r.value;
      }
      if (options.escape && !TEXT_SKIP_FIELDS(f.name)) {
        const r = escapeSpecials(f.value);
        stats.escaped += r.count;
        f.value = r.value;
      }
    }
  }

  // --- keys.
  if (options.keys === "keep") {
    for (const e of entries) if (!e.key) e.key = baseKey(e, "authorYearWord");
  } else {
    const groups = new Map<string, BibEntry[]>();
    for (const e of entries) {
      const b = baseKey(e, options.keys);
      groups.set(b, [...(groups.get(b) ?? []), e]);
    }
    for (const [b, es] of groups) es.forEach((e, i) => (e.key = es.length > 1 ? b + suffix(i) : b));
  }
  const seen = new Map<string, BibEntry>();
  for (const e of entries) {
    if (seen.has(e.key)) warnings.push({ line: e.line, key: e.key, message: "Duplicate cite key (also on line " + seen.get(e.key)!.line + ")" });
    else seen.set(e.key, e);
  }

  const keyMap: Record<string, string> = {};
  const mapKey = (old: string, now: string) => {
    if (!old) return;
    if (old in keyMap && keyMap[old] !== now) warnings.push({ line: 0, key: old, message: "Key used by more than one input entry; \\cite rewrites use the first" });
    else keyMap[old] = now;
  };
  for (const e of all) {
    const old = original.get(e)!;
    if (!removed.has(e)) {
      mapKey(old, e.key);
      if (old !== e.key) stats.keysChanged++;
    }
  }
  // Survivors that took over a duplicate's key: map the duplicate's original key too.
  const finalOf = (x: BibEntry): BibEntry => {
    const m = mergedInto.find((p) => p.from === x);
    return m ? finalOf(m.into) : x;
  };
  const merged = mergedInto.map(({ from, fromKey }) => {
    const into = finalOf(from).key;
    mapKey(original.get(from)!, into);
    return { from: fromKey, into };
  });

  // --- validation.
  for (const e of entries) for (const m of validate(e)) warnings.push({ line: e.line, key: e.key, message: m });

  // --- output.
  const kept = items.filter((it) => it.kind === "raw" || !removed.has(it.entry));
  const ordered = options.sort
    ? [
        ...kept.filter((it) => it.kind === "raw"),
        ...kept
          .filter((it): it is Extract<BibItem, { kind: "entry" }> => it.kind === "entry")
          .sort((a, b) => a.entry.key.toLowerCase().localeCompare(b.entry.key.toLowerCase())),
      ]
    : kept;
  const blocks: string[] = [];
  ordered.forEach((it, i) => {
    const text = it.kind === "raw" ? it.text : formatEntry(it.entry);
    // Consecutive % comment lines stay together; everything else gets a blank line.
    const prev = ordered[i - 1];
    const sep = i === 0 ? "" : prev.kind === "raw" && it.kind === "raw" && prev.text.startsWith("%") ? "\n" : "\n\n";
    blocks.push(sep + text);
  });
  warnings.sort((a, b) => a.line - b.line);
  stats.entries = entries.length;
  stats.warnings = warnings.length;
  return { output: blocks.join("") + (blocks.length ? "\n" : ""), entries: entries.length, keyMap, merged, warnings, stats };
}

/* ------------------------------------------------------------- tex rewrite */

/**
 * Rewrite cite keys in a .tex source: `\cite`, `\citep`, `\citet`,
 * `\parencite`, `\textcite`, `\autocite`, `\nocite`, starred forms, optional
 * `[..]` arguments, comma lists, and the multi-cite `\cites{a}{b}` family.
 * Keys not in the map are reported as `missing` (unless they are new keys).
 */
export function rewriteCites(tex: string, keyMap: Record<string, string>): { tex: string; replaced: number; missing: string[] } {
  const known = new Set(Object.values(keyMap));
  const missing = new Set<string>();
  let replaced = 0;
  const swapList = (list: string) => {
    const seen = new Set<string>();
    return list
      .split(",")
      .map((raw) => {
        const k = raw.trim();
        if (!k || k === "*") return raw;
        const to = Object.prototype.hasOwnProperty.call(keyMap, k) ? keyMap[k] : undefined;
        if (to === undefined) {
          if (!known.has(k)) missing.add(k);
          return raw;
        }
        if (to !== k) replaced++;
        // Two merged duplicates cited together collapse to one key.
        if (seen.has(to)) return null;
        seen.add(to);
        return raw.replace(k, to);
      })
      .filter((x): x is string => x !== null)
      .join(",");
  };
  const re = /\\([a-zA-Z]*cite[a-zA-Z]*)\*?/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tex))) {
    const cmd = m[1];
    if (cmd === "citestyle") continue;
    let j = m.index + m[0].length;
    const multi = /cites$/.test(cmd);
    let groups = 0;
    let rebuilt = "";
    // Optional args and key groups, possibly repeated for \cites.
    for (;;) {
      // After its key group a single-key command is done: `\cite{a} [see]` keeps the bracket as text.
      if (groups && !multi) break;
      const ws = /^\s*/.exec(tex.slice(j))![0];
      const c = tex[j + ws.length];
      if (c === "[" || c === "(") {
        const close = tex.indexOf(c === "[" ? "]" : ")", j + ws.length);
        if (close === -1) break;
        rebuilt += tex.slice(j, close + 1);
        j = close + 1;
        continue;
      }
      if (c === "{") {
        const close = tex.indexOf("}", j + ws.length);
        if (close === -1) break;
        rebuilt += ws + "{" + swapList(tex.slice(j + ws.length + 1, close)) + "}";
        j = close + 1;
        groups++;
        continue;
      }
      break;
    }
    if (!groups) continue;
    out += tex.slice(last, m.index + m[0].length) + rebuilt;
    last = j;
    re.lastIndex = j;
  }
  return { tex: out + tex.slice(last), replaced, missing: [...missing] };
}
