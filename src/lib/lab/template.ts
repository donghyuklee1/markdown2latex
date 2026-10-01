/**
 * template.ts - move a paper between venue templates (NeurIPS, IEEEtran, LNCS,
 * ACM acmart, Springer Nature sn-jnl) without retyping the front matter.
 *
 * Three steps: detect the source template from \documentclass and packages;
 * read the title, authors, affiliations, emails, abstract and keywords out of
 * that template's own idiom into neutral `PaperMeta`; then write the target's
 * class line, packages and front matter, and carry the body across untouched
 * except for the few environment conventions that genuinely differ (starred
 * floats, IEEE-only macros, proof environments, acknowledgments, bibliography
 * style). Anything that cannot be inferred - ACM rights metadata, CCS
 * concepts, Nature's declarations - is returned as a TODO rather than invented.
 *
 * Pure and total: unknown or malformed input still produces output.
 */
import { maskTex, readGroup, skipOptional } from "./flatten";

export type TemplateId = "neurips" | "ieee" | "lncs" | "acm" | "nature" | "article";
export type TargetId = Exclude<TemplateId, "article">;
/** IEEE: journal vs conference class option. ACM: acmsmall vs sigconf. */
export type Variant = "journal" | "conference";

export const TEMPLATE_LABELS: Record<TemplateId, string> = {
  neurips: "NeurIPS",
  ieee: "IEEE",
  lncs: "Springer LNCS",
  acm: "ACM",
  nature: "Springer Nature",
  article: "Plain article",
};

export interface Affiliation {
  raw: string;
  department?: string;
  institution: string;
  city?: string;
  country?: string;
}

export interface Author {
  name: string;
  affiliations: Affiliation[];
  email?: string;
  thanks?: string;
  corresponding?: boolean;
}

export interface PaperMeta {
  title: string;
  shortTitle?: string;
  authors: Author[];
  abstract: string;
  keywords: string[];
  acknowledgments?: string;
  bibStyle?: string;
}

export interface TemplateResult {
  output: string;
  from: TemplateId;
  to: TargetId;
  changes: string[];
  todos: string[];
  meta: PaperMeta;
}

/* --------------------------------------------------------------- scanning */

interface Cmd {
  name: string;
  start: number;
  end: number;
  star: boolean;
  opt: string | null;
  /** Argument values, read from the masked text so comments are already gone. */
  args: string[];
}

/** Find `\name*[opt]{a1}...{aN}` in [from, to), skipping comments and verbatim. */
function findCmds(masked: string, names: string[], nArgs: number, from = 0, to = masked.length): Cmd[] {
  const re = new RegExp("\\\\(" + names.join("|") + ")(?![A-Za-z@])(\\*?)", "g");
  re.lastIndex = from;
  const out: Cmd[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) && m.index < to) {
    let pos = m.index + m[0].length;
    const optEnd = skipOptional(masked, pos);
    const opt = optEnd > pos ? masked.slice(masked.indexOf("[", pos) + 1, optEnd - 1) : null;
    pos = optEnd;
    const args: string[] = [];
    let ok = true;
    for (let k = 0; k < nArgs; k++) {
      const g = readGroup(masked, pos);
      if (!g) {
        ok = false;
        break;
      }
      args.push(g.value);
      pos = g.end;
    }
    if (!ok) continue;
    out.push({ name: m[1], start: m.index, end: pos, star: m[2] === "*", opt, args });
    re.lastIndex = pos;
  }
  return out;
}

interface Env {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
}

function findEnv(masked: string, name: string, from = 0, to = masked.length): Env | null {
  const esc = name.replace(/\*/g, "\\*");
  const b = new RegExp("\\\\begin\\s*\\{" + esc + "\\}", "g");
  b.lastIndex = from;
  const m = b.exec(masked);
  if (!m || m.index >= to) return null;
  const e = new RegExp("\\\\end\\s*\\{" + esc + "\\}", "g");
  e.lastIndex = m.index + m[0].length;
  const n = e.exec(masked);
  if (!n) return null;
  return { start: m.index, end: n.index + n[0].length, bodyStart: m.index + m[0].length, bodyEnd: n.index };
}

/** Remove `\name{...}` (with optional [..]) and return [stripped, removed args]. */
function takeCmd(s: string, name: string): [string, string[]] {
  const got: string[] = [];
  let out = s;
  for (let guard = 0; guard < 50; guard++) {
    const m = new RegExp("\\\\" + name + "(?![A-Za-z@])\\*?").exec(out);
    if (!m) break;
    const pos = skipOptional(out, m.index + m[0].length);
    const g = readGroup(out, pos);
    if (!g) {
      out = out.slice(0, m.index) + out.slice(m.index + m[0].length);
      continue;
    }
    got.push(g.value);
    out = out.slice(0, m.index) + out.slice(g.end);
  }
  return [out, got];
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Strip text-formatting wrappers so an affiliation or email reads as plain text. */
function unwrap(s: string): string {
  let out = s;
  for (let k = 0; k < 6; k++) {
    const next = out
      .replace(/\\href\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:texttt|textit|textbf|textsf|textrm|emph|url|mbox|textnormal|orgdiv|orgname|orgaddress|street|city|postcode|state|country|institution|department|streetaddress)\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\(?:small|footnotesize|normalsize|it|bf|tt|sf|rm|centering)(?![A-Za-z])\s*/g, "");
    if (next === out) break;
    out = next;
  }
  return squash(out.replace(/~/g, " ").replace(/\\(?:quad|qquad|,|;|\s)/g, " "));
}

const EMAIL_RE = /(?:\\\{[^{}]*\\\}|[A-Za-z0-9._%+-]+)@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

function cleanName(s: string): string {
  let out = s;
  for (const c of ["thanks", "inst", "orcidID", "orcid", "IEEEauthorrefmark", "IEEEmembership", "footnote", "textsuperscript", "footnotemark", "affilmark"])
    out = takeCmd(out, c)[0];
  out = out
    .replace(/\$\s*\^\s*\{?[^$]*\}?\s*\$/g, "")
    .replace(/\\(?:fnm|sur|spfx|pfx|sfx|dgr)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\\\/g, " ")
    .replace(/~/g, " ");
  return squash(out).replace(/^[,\s]+|[,\s]+$/g, "");
}

/** "Dept. of X, Uni Y, City, Country" -> structured parts. Heuristic, so ACM output gets a TODO. */
export function parseAffiliation(raw: string): Affiliation {
  const text = unwrap(raw.replace(/\\\\/g, ","));
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  if (!parts.length) return { raw: text, institution: "" };
  const dept = /^(department|dept\.?|school|faculty|institute for|division|lab|laboratory|group|chair)\b/i.test(parts[0]) && parts.length > 1;
  const department = dept ? parts.shift() : undefined;
  const institution = parts.shift() ?? "";
  const country = parts.length ? parts.pop() : undefined;
  const city = parts.length ? parts.join(", ") : undefined;
  return { raw: text, department, institution, city, country };
}

/** Split a block on top-level `\\` lines. */
function lines(s: string): string[] {
  return s
    .split(/\\\\(?:\[[^\]]*\])?/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Split on top-level separators (`\and`, `\And`, `\AND`), ignoring ones inside braces. */
function splitTop(s: string, re: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && depth === 0) {
      const m = re.exec(s.slice(i));
      if (m && m.index === 0) {
        out.push(s.slice(last, i));
        last = i + m[0].length;
        i = last - 1;
        continue;
      }
      i++;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
  }
  out.push(s.slice(last));
  return out.map((x) => x.trim()).filter(Boolean);
}

/* -------------------------------------------------------------- detection */

export function detectTemplate(tex: string): TemplateId {
  const m = maskTex(tex).masked;
  const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(m)?.[1].trim() ?? "";
  if (cls === "IEEEtran") return "ieee";
  if (cls === "llncs") return "lncs";
  if (cls === "acmart") return "acm";
  if (cls === "sn-jnl") return "nature";
  if (/\\usepackage\s*(?:\[[^\]]*\])?\s*\{\s*neurips_\d{4}\s*\}/.test(m)) return "neurips";
  return "article";
}

/** The class options in effect, e.g. "journal" for IEEE, "sigconf" for ACM. */
function classOptions(masked: string): string[] {
  const m = /\\documentclass\s*\[([^\]]*)\]/.exec(masked);
  return m ? m[1].split(",").map((s) => s.trim()) : [];
}

/* ------------------------------------------------------------- extraction */

/** Read the front matter of `tex` (in template `from`) into neutral metadata. */
export function extractMeta(tex: string, from: TemplateId = detectTemplate(tex)): PaperMeta {
  const { masked } = maskTex(tex);
  const title = findCmds(masked, ["title"], 1)[0];
  const short = findCmds(masked, ["titlerunning", "shorttitle"], 1)[0];
  const meta: PaperMeta = {
    title: title ? squash(title.args[0]) : "",
    shortTitle: title?.opt ? squash(title.opt) : short ? squash(short.args[0]) : undefined,
    authors: [],
    abstract: "",
    keywords: [],
  };

  // Abstract: environment everywhere except sn-jnl's \abstract{} command.
  const absEnv = findEnv(masked, "abstract");
  if (absEnv) meta.abstract = tex.slice(absEnv.bodyStart, absEnv.bodyEnd);
  else {
    const a = findCmds(masked, ["abstract"], 1)[0];
    if (a) meta.abstract = tex.slice(masked.indexOf("{", a.start + 9) + 1, a.end - 1);
  }
  // LNCS writes \keywords inside the abstract; lift it out before keeping the text.
  const kwIn = findCmds(maskTex(meta.abstract).masked, ["keywords"], 1)[0];
  if (kwIn) meta.abstract = meta.abstract.slice(0, kwIn.start) + meta.abstract.slice(kwIn.end);
  meta.abstract = meta.abstract.replace(/^\s*\n|\s+$/g, "").replace(/^[ \t]+/, "");

  const kwEnv = findEnv(masked, "IEEEkeywords");
  const kwRaw = kwEnv ? masked.slice(kwEnv.bodyStart, kwEnv.bodyEnd) : kwIn ? kwIn.args[0] : (findCmds(masked, ["keywords"], 1)[0]?.args[0] ?? "");
  meta.keywords = kwRaw
    .split(/\\and(?![A-Za-z])|[,;]|\\sep(?![A-Za-z])/)
    .map(squash)
    .map((k) => k.replace(/\.$/, ""))
    .filter(Boolean);

  const style = findCmds(masked, ["bibliographystyle"], 1)[0];
  if (style) meta.bibStyle = style.args[0].trim();
  meta.acknowledgments = findAck(tex, masked)?.content;
  meta.authors = readAuthors(masked, from);
  return meta;
}

function readAuthors(masked: string, from: TemplateId): Author[] {
  if (from === "acm") return readAcmAuthors(masked);
  if (from === "nature") return readNatureAuthors(masked);
  if (from === "lncs") return readLncsAuthors(masked);
  const a = findCmds(masked, ["author"], 1)[0];
  if (!a) return [];
  const body = a.args[0];
  if (from === "ieee" && /\\IEEEauthorblockN/.test(body)) return readIeeeBlocks(body);
  if (from === "ieee") return readIeeeJournal(body);
  return readStackedAuthors(body);
}

/** NeurIPS / article: `Name \\ Affil \\ \texttt{email} \And ...`. */
function readStackedAuthors(body: string): Author[] {
  return splitTop(body, /^\\(?:AND|And|and)(?![A-Za-z])/).flatMap((block) => {
    const [, thanks] = takeCmd(block, "thanks");
    const ls = lines(block);
    if (!ls.length) return [];
    const name = cleanName(ls[0]);
    let email: string | undefined;
    const affil: string[] = [];
    for (const l of ls.slice(1)) {
      const e = EMAIL_RE.exec(unwrap(l));
      if (e) email = e[0];
      else affil.push(unwrap(l));
    }
    // "A \quad B \\ Shared Uni" lists several names on one line.
    const names = name.split(/\s{2,}|\\quad|\\qquad/).map(squash).filter(Boolean);
    const affiliation = affil.length ? [parseAffiliation(affil.join(", "))] : [];
    return names.map((n, k) => ({ name: n, affiliations: affiliation, email: k === 0 ? email : undefined, thanks: k === 0 && thanks.length ? squash(thanks.join(" ")) : undefined }));
  });
}

function readIeeeBlocks(body: string): Author[] {
  const out: Author[] = [];
  const m = maskTex(body).masked;
  for (const c of findCmds(m, ["IEEEauthorblockN", "IEEEauthorblockA"], 1)) {
    if (c.name === "IEEEauthorblockN") {
      for (const n of c.args[0].split(/,|\s+and\s+|\\and(?![A-Za-z])/).map(cleanName).filter(Boolean)) out.push({ name: n, affiliations: [] });
      continue;
    }
    const ls = lines(c.args[0]);
    const affil: string[] = [];
    let email: string | undefined;
    for (const l of ls) {
      const e = EMAIL_RE.exec(unwrap(l));
      if (e) email = e[0];
      else affil.push(unwrap(takeCmd(l, "IEEEauthorrefmark")[0]));
    }
    // An A block describes every name since the previous A block.
    const pending = out.filter((a) => !a.affiliations.length);
    for (const a of pending.length ? pending : out.slice(-1)) {
      if (affil.length) a.affiliations = [parseAffiliation(affil.join(", "))];
      if (email && !a.email) a.email = email;
    }
  }
  return out;
}

/** IEEE Transactions: `A,~\IEEEmembership{..} and B \thanks{A is with ...}`. */
function readIeeeJournal(body: string): Author[] {
  const [rest, thanks] = takeCmd(body, "thanks");
  const names = takeCmd(rest, "IEEEmembership")[0]
    .replace(/~/g, " ")
    .split(/,|\s+and\s+|\\and(?![A-Za-z])/)
    .map(cleanName)
    .filter(Boolean);
  const out: Author[] = names.map((name) => ({ name, affiliations: [] }));
  thanks.forEach((t, k) => {
    const e = EMAIL_RE.exec(t);
    const affil = squash(t.replace(/\(?\s*e-?mail:?[^)]*\)?\.?/i, "").replace(/^.*?\bis (?:with|at)\s+(?:the\s+)?/i, "").replace(/\.$/, ""));
    const who = thanks.length === out.length ? out[k] : undefined;
    if (who) {
      who.affiliations = affil ? [parseAffiliation(affil)] : [];
      if (e) who.email = e[0];
    }
  });
  return out;
}

function readLncsAuthors(masked: string): Author[] {
  const a = findCmds(masked, ["author"], 1)[0];
  const inst = findCmds(masked, ["institute"], 1)[0];
  if (!a) return [];
  const institutes = inst ? splitTop(inst.args[0], /^\\and(?![A-Za-z])/) : [];
  const parsed = institutes.map((block) => {
    const [noMail, mails] = takeCmd(block, "email");
    const [noUrl] = takeCmd(noMail, "url");
    return { affil: parseAffiliation(lines(noUrl).map(unwrap).join(", ")), emails: mails.map(unwrap) };
  });
  const authors = splitTop(a.args[0], /^\\and(?![A-Za-z])/).map((block) => {
    const [, insts] = takeCmd(block, "inst");
    const idx = (insts[0] ?? (parsed.length === 1 ? "1" : ""))
      .split(",")
      .map((x) => parseInt(x, 10) - 1)
      .filter((k) => k >= 0 && k < parsed.length);
    const [, thanks] = takeCmd(block, "thanks");
    return { name: cleanName(block), affiliations: idx.map((k) => parsed[k].affil), idx, thanks: thanks.length ? squash(thanks.join(" ")) : undefined } as Author & { idx: number[] };
  });
  // Emails sit in the institute block: hand them out in order to that institute's authors.
  parsed.forEach((p, k) => {
    const members = authors.filter((x) => x.idx[0] === k);
    p.emails.forEach((e, j) => {
      if (members[j]) members[j].email = e;
    });
  });
  return authors.map(({ name, affiliations, email, thanks }) => ({ name, affiliations, email, thanks }));
}

function readAcmAuthors(masked: string): Author[] {
  const out: Author[] = [];
  for (const c of findCmds(masked, ["author", "affiliation", "email"], 1)) {
    if (c.name === "author") {
      out.push({ name: cleanName(c.args[0]), affiliations: [] });
      continue;
    }
    // \affiliation and \email apply to every author since the last \affiliation.
    const since: Author[] = [];
    for (let k = out.length - 1; k >= 0 && (c.name === "email" ? !out[k].email : !out[k].affiliations.length); k--) since.unshift(out[k]);
    const targets = c.name === "email" ? out.slice(-1) : since.length ? since : out.slice(-1);
    if (c.name === "email") for (const t of targets) t.email = unwrap(c.args[0]);
    else {
      const field = (n: string) => {
        const f = findCmds(c.args[0], [n], 1)[0];
        return f ? unwrap(f.args[0]) : undefined;
      };
      const parts = ["department", "institution", "streetaddress", "city", "state", "country"].map(field);
      const affil: Affiliation = {
        raw: parts.filter(Boolean).join(", "),
        department: parts[0],
        institution: parts[1] ?? unwrap(c.args[0]),
        city: [parts[3], parts[4]].filter(Boolean).join(", ") || undefined,
        country: parts[5],
      };
      for (const t of targets) t.affiliations.push(affil);
    }
  }
  return out;
}

function readNatureAuthors(masked: string): Author[] {
  const affils = new Map<string, Affiliation>();
  for (const c of findCmds(masked, ["affil"], 1)) {
    const f = (n: string) => {
      const x = findCmds(c.args[0], [n], 1)[0];
      return x ? unwrap(x.args[0]) : undefined;
    };
    const raw = unwrap(c.args[0].replace(/\\\\/g, ","));
    affils.set((c.opt ?? "1").trim(), {
      raw,
      department: f("orgdiv"),
      institution: f("orgname") ?? raw,
      city: f("city"),
      country: f("country"),
    });
  }
  const out: Author[] = [];
  for (const c of findCmds(masked, ["author", "email"], 1)) {
    if (c.name === "email") {
      if (out.length) out[out.length - 1].email = unwrap(c.args[0]);
      continue;
    }
    out.push({
      name: cleanName(c.args[0]),
      corresponding: c.star,
      affiliations: (c.opt ?? "")
        .split(",")
        .map((k) => affils.get(k.trim()))
        .filter((a): a is Affiliation => !!a),
    });
  }
  return out;
}

/* ------------------------------------------------------- acknowledgments */

interface AckBlock {
  start: number;
  end: number;
  content: string;
}

/** Find the acknowledgments in any template's form. */
function findAck(tex: string, masked: string): AckBlock | null {
  for (const env of ["ack", "acks", "credits"]) {
    const e = findEnv(masked, env);
    if (e) {
      const content = tex.slice(e.bodyStart, e.bodyEnd).replace(/\\subsubsection\*?\s*\{\\ackname\}/, "");
      return { start: e.start, end: e.end, content: content.trim() };
    }
  }
  const h = /\\(?:section|subsection|subsubsection)\*?\s*\{\s*Acknowledge?ments?\s*\}|\\bmhead\s*\{\s*Acknowledge?ments?\s*\}/i.exec(masked);
  if (!h) return null;
  // A heading form runs until the next sectioning or bibliography command.
  const stop = /\\(?:section|chapter|appendix|bibliography|bibliographystyle|printbibliography|bmhead|end\s*\{document\}|begin\s*\{thebibliography\})(?![A-Za-z])/g;
  stop.lastIndex = h.index + h[0].length;
  const s = stop.exec(masked);
  const end = s ? s.index : masked.length;
  return { start: h.index, end, content: tex.slice(h.index + h[0].length, end).trim() };
}

function renderAck(content: string, to: TargetId): string {
  switch (to) {
    case "neurips":
      return "\\begin{ack}\n" + content + "\n\\end{ack}\n\n";
    case "ieee":
      return "\\section*{Acknowledgment}\n" + content + "\n\n";
    case "lncs":
      return "\\subsubsection*{Acknowledgements.}\n" + content + "\n\n";
    case "acm":
      return "\\begin{acks}\n" + content + "\n\\end{acks}\n\n";
    case "nature":
      return "\\bmhead{Acknowledgements}\n" + content + "\n\n";
  }
}

/* ------------------------------------------------------------ generation */

const BIB_STYLE: Record<TargetId, string | null> = {
  neurips: "plainnat",
  ieee: "IEEEtran",
  lncs: "splncs04",
  acm: "ACM-Reference-Format",
  nature: null, // sn-jnl picks the style from a class option
};

/** Templates that set two columns (keep figure* / table*). */
const twoColumn = (to: TargetId, variant: Variant) => to === "ieee" || (to === "acm" && variant === "conference");

function classLine(to: TargetId, variant: Variant): string {
  switch (to) {
    case "neurips":
      return "\\documentclass{article}\n\n% Submission (anonymous) mode; use [preprint] or [final] for the camera-ready.\n\\usepackage{neurips_2025}";
    case "ieee":
      return "\\documentclass[" + (variant === "journal" ? "journal" : "conference") + "]{IEEEtran}";
    case "lncs":
      return "\\documentclass[runningheads]{llncs}";
    case "acm":
      return "\\documentclass[" + (variant === "journal" ? "acmsmall" : "sigconf") + "]{acmart}";
    case "nature":
      return "\\documentclass[pdflatex,sn-nature]{sn-jnl}";
  }
}

/** The packages each venue's own template starts with (added only when missing). */
const REQUIRED: Record<TargetId, string[]> = {
  neurips: ["[utf8]{inputenc}", "[T1]{fontenc}", "{hyperref}", "{url}", "{booktabs}", "{amsfonts}", "{nicefrac}", "{microtype}", "{xcolor}"],
  ieee: ["{cite}", "{amsmath,amssymb,amsfonts}", "{graphicx}", "{textcomp}", "{xcolor}"],
  lncs: ["[T1]{fontenc}", "{graphicx}"],
  acm: [],
  nature: ["{graphicx}", "{amsmath,amssymb,amsfonts}", "{amsthm}"],
};

/** Packages the target class already loads, or forbids; a second \usepackage clashes. */
const DROP_PACKAGES: Record<TargetId, string[]> = {
  neurips: ["natbib", "geometry", "fullpage", "times"],
  ieee: ["geometry", "fullpage", "times"],
  lncs: ["geometry", "fullpage", "times"],
  acm: ["natbib", "geometry", "fullpage", "times", "amsthm", "hyperref"],
  nature: ["natbib", "geometry", "fullpage", "times"],
};

/** Preamble commands that belong to one venue and mean nothing (or break) elsewhere. */
const TEMPLATE_ONLY =
  /^\s*\\(?:IEEEoverridecommandlockouts|IEEEpeerreviewmaketitle|markboth|acmConference|acmBooktitle|acmYear|acmDOI|acmISBN|acmPrice|acmJournal|acmVolume|acmNumber|acmArticle|acmMonth|acmSubmissionID|setcopyright|copyrightyear|settopmatter|received|ccsdesc|jyear|theoremstyle\{thmstyle\w+\})(?![A-Za-z]).*$/;

/** Theorem-like environments llncs already defines; redefining them is an error. */
const LLNCS_THEOREMS = new Set(["theorem", "lemma", "corollary", "proposition", "definition", "example", "remark", "claim", "conjecture", "exercise", "note", "problem", "property", "question", "solution", "case"]);

function surname(name: string): [string, string] {
  const parts = name.split(/\s+/);
  if (parts.length < 2) return ["", name];
  return [parts.slice(0, -1).join(" "), parts[parts.length - 1]];
}

function affilText(a: Affiliation): string {
  return a.raw || [a.department, a.institution, a.city, a.country].filter(Boolean).join(", ");
}

function uniqueAffils(authors: Author[]): Affiliation[] {
  const seen: Affiliation[] = [];
  for (const a of authors) for (const f of a.affiliations) if (!seen.some((s) => affilText(s) === affilText(f))) seen.push(f);
  return seen;
}

function renderFront(meta: PaperMeta, to: TargetId, variant: Variant, todos: string[]): string {
  const title = meta.title || "TODO: Title";
  const abstract = meta.abstract || "TODO: abstract.";
  const authors = meta.authors.length ? meta.authors : [{ name: "TODO: Author", affiliations: [] } as Author];
  const kws = meta.keywords;
  const out: string[] = [];
  switch (to) {
    case "neurips": {
      out.push("\\title{" + title + "}\n");
      const blocks = authors.map((a) => {
        const rows = ["  " + a.name + (a.thanks ? "\\thanks{" + a.thanks + "}" : "")];
        for (const f of a.affiliations) rows.push("  " + affilText(f));
        if (a.email) rows.push("  \\texttt{" + a.email + "}");
        return rows.join(" \\\\\n");
      });
      out.push("\\author{%\n" + blocks.join(" \\And\n") + "\n}\n", "\\maketitle\n", "\\begin{abstract}\n" + abstract + "\n\\end{abstract}\n");
      break;
    }
    case "ieee": {
      out.push("\\title{" + title + "}\n");
      if (variant === "conference") {
        const blocks = authors.map((a) => {
          const rows = a.affiliations.map((f) => "\\textit{" + affilText(f) + "}");
          if (a.email) rows.push(a.email);
          return "\\IEEEauthorblockN{" + a.name + "}\n\\IEEEauthorblockA{" + (rows.join(" \\\\\n") || "TODO: affiliation") + "}";
        });
        out.push("\\author{" + blocks.join("\n\\and\n") + "}\n");
      } else {
        const names = authors.map((a) => a.name.replace(/ /g, "~"));
        const thanks = authors
          .filter((a) => a.affiliations.length || a.email)
          .map((a) => "\\thanks{" + a.name + " is with " + (a.affiliations.map(affilText).join("; ") || "TODO") + (a.email ? " (e-mail: " + a.email + ")" : "") + ".}%");
        out.push("\\author{" + names.join(", ") + "%\n" + thanks.join("\n") + "}\n");
        todos.push("IEEE journal: add \\IEEEmembership{Member, IEEE} after each author name where it applies.");
        todos.push("IEEE journal: set the running head with \\markboth{Journal name}{Author et al.: Short title}.");
      }
      out.push("\\maketitle\n", "\\begin{abstract}\n" + abstract + "\n\\end{abstract}\n");
      if (kws.length) out.push("\\begin{IEEEkeywords}\n" + kws.join(", ") + "\n\\end{IEEEkeywords}\n");
      break;
    }
    case "lncs": {
      out.push("\\title{" + title + "}");
      if (meta.shortTitle) out.push("\\titlerunning{" + meta.shortTitle + "}");
      const affs = uniqueAffils(authors);
      const names = authors.map((a) => {
        const idx = a.affiliations.map((f) => affs.findIndex((s) => affilText(s) === affilText(f)) + 1).filter((k) => k > 0);
        return a.name + (idx.length && affs.length > 1 ? "\\inst{" + idx.join(",") + "}" : "") + (a.thanks ? "\\thanks{" + a.thanks + "}" : "");
      });
      out.push("\n\\author{" + names.join(" \\and\n") + "}");
      const [, last] = surname(authors[0].name);
      out.push("\\authorrunning{" + (authors.length > 2 ? surname(authors[0].name)[0].charAt(0) + ". " + last + " et al." : authors.map((a) => a.name).join(" and ")) + "}\n");
      const insts = affs.map((f) => {
        const mails = authors.filter((a) => a.email && a.affiliations[0] && affilText(a.affiliations[0]) === affilText(f)).map((a) => "\\email{" + a.email + "}");
        return affilText(f) + (mails.length ? " \\\\\n" + mails.join(", ") : "");
      });
      const orphans = authors.filter((a) => a.email && !a.affiliations.length).map((a) => "\\email{" + a.email + "}");
      if (orphans.length) insts.push(orphans.join(", "));
      out.push("\\institute{" + (insts.join("\n\\and\n") || "TODO: institute") + "}\n", "\\maketitle\n");
      out.push("\\begin{abstract}\n" + abstract + (kws.length ? "\n\n\\keywords{" + kws.join(" \\and ") + "}" : "") + "\n\\end{abstract}\n");
      break;
    }
    case "acm": {
      out.push((meta.shortTitle ? "\\title[" + meta.shortTitle + "]{" : "\\title{") + title + "}\n");
      for (const a of authors) {
        const rows = ["\\author{" + a.name + "}"];
        if (a.email) rows.push("\\email{" + a.email + "}");
        for (const f of a.affiliations.length ? a.affiliations : [{ raw: "", institution: "TODO" } as Affiliation]) {
          const parts = ["  \\institution{" + (f.institution || "TODO") + "}"];
          if (f.department) parts.unshift("  \\department{" + f.department + "}");
          if (f.city) parts.push("  \\city{" + f.city + "}");
          parts.push("  \\country{" + (f.country || "TODO") + "}");
          rows.push("\\affiliation{%\n" + parts.join("\n") + "}");
        }
        out.push(rows.join("\n") + "\n");
      }
      out.push("\\begin{abstract}\n" + abstract + "\n\\end{abstract}\n");
      out.push("% TODO: CCS concepts from https://dl.acm.org/ccs (\\begin{CCSXML}...\\end{CCSXML} and \\ccsdesc[500]{...})\n");
      if (kws.length) out.push("\\keywords{" + kws.join(", ") + "}\n");
      out.push("\\maketitle\n");
      break;
    }
    case "nature": {
      out.push((meta.shortTitle ? "\\title[" + meta.shortTitle + "]{" : "\\title{") + title + "}\n");
      const affs = uniqueAffils(authors);
      const anyStar = authors.some((a) => a.corresponding);
      authors.forEach((a, k) => {
        const [first, last] = surname(a.name);
        const idx = a.affiliations.map((f) => affs.findIndex((s) => affilText(s) === affilText(f)) + 1).filter((x) => x > 0);
        const star = a.corresponding || (!anyStar && k === 0) ? "*" : "";
        out.push("\\author" + star + "[" + (idx.join(",") || "1") + "]{\\fnm{" + first + "} \\sur{" + last + "}}" + (a.email ? "\\email{" + a.email + "}" : ""));
      });
      out.push("");
      affs.forEach((f, k) => {
        const org = [f.department ? "\\orgdiv{" + f.department + "}" : "", "\\orgname{" + (f.institution || affilText(f)) + "}"];
        const addr = [f.city ? "\\city{" + f.city + "}" : "", f.country ? "\\country{" + f.country + "}" : ""].filter(Boolean);
        if (addr.length) org.push("\\orgaddress{" + addr.join(", ") + "}");
        out.push("\\affil" + (k === 0 ? "*" : "") + "[" + (k + 1) + "]{" + org.filter(Boolean).join(", ") + "}");
      });
      out.push("\n\\abstract{" + abstract + "}\n");
      if (kws.length) out.push("\\keywords{" + kws.join(", ") + "}\n");
      out.push("\\maketitle\n");
      break;
    }
  }
  return out.join("\n");
}

/* --------------------------------------------------------------- convert */

interface Range {
  start: number;
  end: number;
  rep?: string;
}

/** Remove ranges from text; a range that leaves its line empty takes the line with it. */
function applyRanges(text: string, ranges: Range[]): string {
  const sorted = ranges.slice().sort((a, b) => a.start - b.start);
  const out: string[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start < cursor) continue;
    let { start, end } = r;
    if (r.rep === undefined) {
      const ls = text.lastIndexOf("\n", start - 1) + 1;
      let le = text.indexOf("\n", end);
      if (le < 0) le = text.length;
      if (!text.slice(ls, start).trim() && !text.slice(end, le).replace(/%.*$/, "").trim() && ls >= cursor) {
        start = ls;
        end = Math.min(text.length, le + 1);
      }
    }
    out.push(text.slice(cursor, start), r.rep ?? "");
    cursor = end;
  }
  out.push(text.slice(cursor));
  return out.join("");
}

/** Replace regex matches found in the masked text (so never inside comments/verbatim). */
function replaceOutside(text: string, re: RegExp, rep: (m: RegExpExecArray) => string): [string, number] {
  const masked = maskTex(text).masked;
  const ranges: Range[] = [];
  const g = new RegExp(re.source, "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(masked))) ranges.push({ start: m.index, end: m.index + m[0].length, rep: rep(m) });
  return [applyRanges(text, ranges), ranges.length];
}

export function convertTemplate(tex: string, to: TargetId, variant: Variant = to === "ieee" ? "journal" : "conference"): TemplateResult {
  const from = detectTemplate(tex);
  const meta = extractMeta(tex, from);
  const changes: string[] = [];
  const todos: string[] = [];
  const { masked } = maskTex(tex);

  const beginDoc = /\\begin\s*\{document\}/.exec(masked);
  const endDoc = masked.lastIndexOf("\\end{document}");
  if (!beginDoc) {
    todos.push("No \\begin{document} found - paste the main .tex file.");
    return { output: tex, from, to, changes, todos, meta };
  }
  const bodyStart = beginDoc.index + beginDoc[0].length;
  const bodyEnd = endDoc > bodyStart ? endDoc : masked.length;
  const firstSection = /\\(?:section|chapter)\*?\s*[[{]/.exec(masked.slice(bodyStart));
  const frontEnd = firstSection ? bodyStart + firstSection.index : bodyEnd;

  /* ---- 1. remove front matter wherever it is (preamble, or body before the first \section) */
  const remove: Range[] = [];
  const front = (r: Range) => r.start < bodyStart || r.end <= frontEnd;
  for (const c of findCmds(masked, ["title", "titlerunning", "shorttitle", "subtitle", "author", "authorrunning", "institute", "affiliation", "affil", "email", "orcid", "keywords", "date", "abstract", "thanks", "additionalaffiliation"], 1))
    if (front(c)) remove.push(c);
  for (const c of findCmds(masked, ["maketitle", "IEEEpeerreviewmaketitle", "IEEEdisplaynontitleabstractindextext"], 0)) if (front(c)) remove.push(c);
  for (const env of ["abstract", "IEEEkeywords", "CCSXML"]) {
    const e = findEnv(masked, env);
    if (e && front(e)) remove.push(e);
  }
  if (from === "acm") for (const c of findCmds(masked, ["ccsdesc"], 1)) remove.push(c);
  const ack = findAck(tex, masked);
  if (ack) remove.push({ start: ack.start, end: ack.end, rep: renderAck(ack.content, to) });
  if (ack && ack.content) changes.push("Acknowledgments rewritten in the " + TEMPLATE_LABELS[to] + " form.");

  /* ---- 2. preamble: drop the old class and template-only lines, keep the user's macros */
  const preambleRanges: Range[] = [];
  const cls = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/.exec(masked);
  if (cls) preambleRanges.push({ start: cls.index, end: cls.index + cls[0].length });
  const drop = new Set(DROP_PACKAGES[to]);
  const removedPkgs: string[] = [];
  for (const c of findCmds(masked, ["usepackage", "RequirePackage"], 1, 0, beginDoc.index)) {
    const names = c.args[0].split(",").map((s) => s.trim());
    if (names.some((n) => /^neurips_\d{4}$/.test(n))) {
      preambleRanges.push(c);
      changes.push("Removed \\usepackage{" + names.join(",") + "} (NeurIPS style file).");
      continue;
    }
    const keep = names.filter((n) => !drop.has(n));
    if (keep.length === names.length) continue;
    removedPkgs.push(...names.filter((n) => drop.has(n)));
    if (!keep.length) preambleRanges.push(c);
    else preambleRanges.push({ start: c.start, end: c.end, rep: "\\usepackage" + (c.opt !== null ? "[" + c.opt + "]" : "") + "{" + keep.join(",") + "}" });
  }
  if (removedPkgs.length) changes.push("Removed " + removedPkgs.map((p) => "\\usepackage{" + p + "}").join(", ") + " - the " + TEMPLATE_LABELS[to] + " class loads or forbids " + (removedPkgs.length > 1 ? "them" : "it") + ".");
  let lineStart = 0;
  let templateOnly = 0;
  for (const line of masked.slice(0, beginDoc.index).split("\n")) {
    if (TEMPLATE_ONLY.test(line)) {
      preambleRanges.push({ start: lineStart, end: lineStart + line.length });
      templateOnly++;
    }
    lineStart += line.length + 1;
  }
  if (templateOnly) changes.push("Removed " + templateOnly + " " + TEMPLATE_LABELS[from] + "-specific preamble line(s) (rights, conference or running-head metadata).");

  let preamble = applyRanges(tex.slice(0, beginDoc.index), [...preambleRanges, ...remove.filter((r) => r.end <= beginDoc.index)]);
  let body = applyRanges(
    tex.slice(beginDoc.index + beginDoc[0].length, bodyEnd),
    remove.filter((r) => r.start >= bodyStart).map((r) => ({ ...r, start: r.start - bodyStart, end: r.end - bodyStart })),
  );
  const tail = tex.slice(bodyEnd);

  // llncs predefines the common theorem environments and \proof.
  if (to === "lncs") {
    let n = 0;
    [preamble, n] = replaceOutside(preamble, /\\newtheorem\s*\{(\w+)\}[^\n]*/, (m) => (LLNCS_THEOREMS.has(m[1]) ? "% " + m[0] + " % template-convert: llncs already defines " + m[1] : m[0]));
    if (/% \\newtheorem/.test(preamble) && n) changes.push("Commented out \\newtheorem lines for environments llncs already defines.");
    if (/\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*amsthm/.test(maskTex(preamble).masked)) {
      [preamble] = replaceOutside(preamble, /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^}]*amsthm[^}]*\}/, (m) => "\\let\\proof\\relax\\let\\endproof\\relax % llncs defines proof; amsthm would clash\n" + m[0]);
      changes.push("Added \\let\\proof\\relax before amsthm (llncs already defines proof).");
    }
  }
  if (to === "acm" && /\\newtheorem/.test(maskTex(preamble).masked)) todos.push("acmart predefines theorem, lemma, definition, ...: drop your duplicate \\newtheorem lines or pass the acmthm=false class option.");

  /* ---- 3. body conventions */
  const two = twoColumn(to, variant);
  if (!two) {
    let n = 0;
    [body, n] = replaceOutside(body, /\\(begin|end)\s*\{(figure|table|algorithm)\*\}/, (m) => "\\" + m[1] + "{" + m[2] + "}");
    if (n) changes.push("Converted " + n / 2 + " figure*/table* environment(s) to single-column figure/table.");
  } else if (!(from === "ieee" || (from === "acm" && classOptions(masked).includes("sigconf")))) {
    todos.push("Two-column target: figures, tables and equations sized for \\textwidth may overflow \\columnwidth - switch wide floats to figure*/table* and check the Overflow Resizer.");
  }
  if (from === "ieee" && to !== "ieee") {
    let n = 0;
    [body, n] = replaceOutside(body, /\\IEEEPARstart\s*\{([^{}]*)\}\s*\{([^{}]*)\}/, (m) => m[1] + m[2]);
    if (n) changes.push("Replaced \\IEEEPARstart drop cap with plain text.");
    [body, n] = replaceOutside(body, /\\IEEEraisesectionheading\s*\{(\\section\*?\s*\{[^{}]*\}(?:\\label\{[^{}]*\})?)\s*\}/, (m) => m[1]);
    if (n) changes.push("Unwrapped \\IEEEraisesectionheading.");
    [body, n] = replaceOutside(body, /\\(begin|end)\s*\{IEEEproof\}/, (m) => "\\" + m[1] + "{proof}");
    if (n) changes.push("Renamed IEEEproof to proof.");
    [body] = replaceOutside(body, /[ \t]*\\(?:IEEEtriggeratref\s*\{[^{}]*\}|IEEEpeerreviewmaketitle|IEEEdisplaynontitleabstractindextext)/, () => "");
    if (/\\(?:begin\{IEEEbiography|IEEEbiographynophoto)/.test(maskTex(body).masked)) todos.push("Author biographies (IEEEbiography) are IEEE-only - remove them or move them to the cover letter.");
    if (/\\begin\s*\{IEEEeqnarray/.test(maskTex(body).masked)) todos.push("IEEEeqnarray needs \\usepackage{IEEEtrantools} outside IEEEtran (or convert to align).");
  }
  if (to === "ieee" && from !== "ieee") {
    let n = 0;
    [body, n] = replaceOutside(body, /\\(begin|end)\s*\{proof\}/, (m) => "\\" + m[1] + "{IEEEproof}");
    if (n) changes.push("Renamed proof to IEEEproof (IEEEtran's own proof environment).");
  }

  // Bibliography style.
  const style = BIB_STYLE[to];
  const bm = maskTex(body).masked;
  const hasBib = /\\bibliography\s*\{/.test(bm);
  const hasStyle = /\\bibliographystyle\s*\{/.test(bm);
  if (style === null) {
    if (hasStyle) {
      [body] = replaceOutside(body, /[ \t]*\\bibliographystyle\s*\{[^{}]*\}[ \t]*\n?/, () => "");
      changes.push("Removed \\bibliographystyle - sn-jnl sets the reference style through its class option (sn-nature).");
    }
  } else if (hasStyle) {
    let n = 0;
    [body, n] = replaceOutside(body, /\\bibliographystyle\s*\{([^{}]*)\}/, (m) => (m[1].trim() === style ? m[0] : "\\bibliographystyle{" + style + "}"));
    if (meta.bibStyle !== style && n) changes.push("Bibliography style " + (meta.bibStyle ?? "?") + " -> " + style + ".");
  } else if (hasBib) {
    [body] = replaceOutside(body, /\\bibliography\s*\{/, (m) => "\\bibliographystyle{" + style + "}\n" + m[0]);
    changes.push("Added \\bibliographystyle{" + style + "}.");
  }
  if (/\\printbibliography/.test(bm)) todos.push("biblatex detected: most publishers want BibTeX with their .bst - switch to \\bibliography{} or check the venue allows biblatex.");
  if ((to === "ieee" || to === "lncs") && /\\cite[tp]\*?\s*[[{]/.test(bm)) todos.push("\\citep/\\citet are natbib commands; " + TEMPLATE_LABELS[to] + " uses numeric \\cite - replace them or load natbib.");

  /* ---- 4. assemble */
  const have = maskTex(preamble).masked;
  const loaded = (pkg: string) => new RegExp("\\\\usepackage\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^}]*\\b" + pkg + "\\b").test(have);
  // cite and natbib cannot be loaded together; a natbib paper keeps natbib.
  const natbibPaper = loaded("natbib") || /\\cite[tp]\*?\s*[[{]/.test(bm);
  // Only the names not already loaded: \usepackage{amsmath} twice is noise.
  const missing = REQUIRED[to].flatMap((spec) => {
    if (spec === "{cite}" && natbibPaper) return [];
    const opt = /^\[[^\]]*\]/.exec(spec)?.[0] ?? "";
    const names = spec.slice(opt.length + 1, -1).split(",").filter((n) => !loaded(n));
    return names.length ? [opt + "{" + names.join(",") + "}"] : [];
  });
  const extra: string[] = [];
  const needs = (pkg: string) => !loaded(pkg) && !missing.some((spec) => spec.includes(pkg));
  if (/\\includegraphics/.test(maskTex(body).masked) && to !== "acm" && needs("graphicx")) extra.push("{graphicx}");
  if (to === "neurips" && /\\begin\s*\{proof\}/.test(maskTex(body).masked) && needs("amsthm")) extra.push("{amsthm}");
  const pkgLines = [...missing, ...extra].map((s) => "\\usepackage" + s);
  if (pkgLines.length) changes.push("Added " + TEMPLATE_LABELS[to] + " template packages: " + [...missing, ...extra].join(", ") + ".");

  const head = classLine(to, variant);
  changes.unshift("\\documentclass: " + TEMPLATE_LABELS[from] + " -> " + head.split("\n")[0].replace(/^\\documentclass/, "") + (to === "neurips" ? " + neurips_2025" : "") + ".");
  changes.splice(1, 0, "Front matter rewritten in the " + TEMPLATE_LABELS[to] + " idiom: title, " + meta.authors.length + " author(s), " + uniqueAffils(meta.authors).length + " affiliation(s), abstract" + (meta.keywords.length ? ", " + meta.keywords.length + " keyword(s)" : "") + ".");
  if (to === "neurips" && meta.keywords.length) changes.push("Dropped keywords: NeurIPS papers have none.");

  const frontMatter = renderFront(meta, to, variant, todos);
  preamble = preamble.replace(/^\s*\n/, "").replace(/\n{3,}/g, "\n\n");
  const output =
    head +
    "\n" +
    (pkgLines.length ? pkgLines.join("\n") + "\n" : "") +
    (preamble.trim() ? "\n" + preamble.replace(/\s+$/, "") + "\n" : "") +
    "\n\\begin{document}\n\n" +
    frontMatter +
    "\n" +
    body.replace(/^\s*\n/, "").replace(/\n{3,}/g, "\n\n") +
    (tail || "\n\\end{document}\n");

  /* ---- 5. what still needs a human */
  if (!meta.title) todos.push("No \\title found.");
  if (!meta.authors.length) todos.push("No authors found - fill in the author block.");
  if (meta.authors.some((a) => !a.affiliations.length)) todos.push("Some authors have no affiliation - check the author block.");
  switch (to) {
    case "neurips":
      todos.push("Append the NeurIPS Paper Checklist (required; desk-rejected without it).");
      todos.push("Update neurips_2025 to this year's style file, and switch to [final] for the camera-ready.");
      break;
    case "ieee":
      todos.push("Check the page limit and the IEEE copyright notice for the specific venue.");
      break;
    case "lncs":
      todos.push("Optional: add ORCID iDs with \\orcidID{0000-...} after each author name.");
      break;
    case "acm":
      todos.push("Add \\acmConference[Short]{Name}{Date}{Venue}, \\acmYear, \\acmDOI and \\acmISBN from your rights form.");
      todos.push("Set \\setcopyright{...} from the ACM rights form.");
      todos.push("Generate CCS concepts at https://dl.acm.org/ccs and paste the CCSXML and \\ccsdesc lines.");
      todos.push("Check the \\institution / \\city / \\country split of each affiliation (inferred from free text).");
      break;
    case "nature":
      todos.push("Add the required Declarations section: Funding, Competing interests, Ethics approval, Data availability, Code availability, Author contributions.");
      todos.push("Check the \\orgdiv / \\orgname / \\orgaddress split of each affiliation (inferred from free text).");
      break;
  }
  return { output, from, to, changes, todos, meta };
}
