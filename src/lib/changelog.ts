/**
 * changelog.ts - the patch notes shown in the app (sign-in screen footer,
 * account menu). Newest first; the first entry's version is the app's version
 * and must match package.json (tests/changelog.spec.ts). Pure data, ASCII.
 */

export interface Release {
  version: string;
  /** ISO date. */
  date: string;
  title: string;
  /** One line each, short. */
  notes: string[];
}

export const CHANGELOG: ReadonlyArray<Release> = [
  {
    version: "1.3.0",
    date: "2026-10-03",
    title: "Sign in, and your work is yours",
    notes: [
      "Sign in with Google or GitHub to start - the welcome screen shows how the app works.",
      "Documents, history and settings are private to your account, even on a shared computer.",
      "Documents sync to your account; signing out removes them from the device.",
      "A short welcome after your first sign-in.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-03",
    title: "AI mode, Image to LaTeX and Google Drive",
    notes: [
      "AI mode with your own free Gemini key - on the moment you save it.",
      "Paste or drop a photo, screenshot or PDF of maths to get LaTeX or Markdown.",
      "Save to and open from Google Drive.",
      "The unit checker tells physics from abstract maths: no more false mismatches.",
      "Busy Gemini models are retried and replaced automatically.",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-02",
    title: "Derivation notes and accounts",
    notes: [
      "Derivation notes: notes, top-down and bottom-up views, a notation table and an idea map.",
      "History, analyses and preferences sync across devices.",
      "Zoom in the paper preview; the account circle at the bottom left.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-02",
    title: "A whole paper, live",
    notes: [
      "Overleaf-style paper preview with references, contents and Save as PDF.",
      "Structural auto-repair, Check & Fix, and 249 starter snippets.",
      "Tools, the Studio Workbench, document tabs, Open in Overleaf and the diff view.",
      "Light and dark themes with a palette editor.",
    ],
  },
];

export const APP_VERSION = CHANGELOG[0].version;
