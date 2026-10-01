/**
 * site.ts - the one place that knows what this deployment is called and where
 * it lives. Set NEXT_PUBLIC_SITE_URL when deploying (e.g. on Vercel); canonical
 * links, the sitemap and social previews all derive from it.
 */
export const SITE_NAME = "markdown2Latex";
export const SITE_TAGLINE = "LLM markdown to LaTeX math cleaner";
export const SITE_DESCRIPTION =
  "Paste messy LLM math, get compilation-ready LaTeX. Normalizes delimiters, repairs align environments, fixes spacing and wraps stray prose in \\text{}. Runs entirely in your browser.";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

export const GITHUB_URL = "https://github.com/donghyuklee1/markdown2latex";
/** Also declared in .github/FUNDING.yml, which puts a Sponsor button on the repo. */
export const SPONSOR_URL = "https://github.com/sponsors/donghyuklee1";

/** Matches --bg in each theme, for browser chrome and the install manifest. */
export const THEME_COLORS = { light: "#f6f4f1", dark: "#181715" } as const;
