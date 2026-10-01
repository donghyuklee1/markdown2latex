import { Github, ShieldCheck, Sigma, Star } from "lucide-react";

export const GITHUB_URL = "https://github.com/donghyuklee1/markdown2latex";

export default function Header() {
  return (
    <header className="flex shrink-0 items-center gap-4 border-b border-ink-800 px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/25">
          <Sigma size={19} strokeWidth={2.5} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-semibold leading-tight tracking-tight text-white">
            CleanMath
          </h1>
          <p className="truncate text-xs leading-tight text-slate-500">
            Messy LLM math in. Compilation-ready LaTeX out.
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <span
          title="Your text is parsed in this tab and never sent anywhere."
          className="hidden items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-xs font-medium text-slate-400 sm:flex"
        >
          <ShieldCheck size={13} className="text-accent" />
          100% client-side
        </span>

        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="group flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 py-1.5 pl-3 pr-1.5 text-xs font-medium text-slate-300 transition-colors hover:border-ink-600 hover:text-white"
        >
          <Github size={14} />
          <span className="hidden sm:inline">Star on GitHub</span>
          <span className="flex items-center gap-1 rounded-full bg-ink-800 px-2 py-0.5 text-slate-400 transition-colors group-hover:bg-accent/15 group-hover:text-accent">
            <Star size={11} strokeWidth={2.5} />
            Star
          </span>
        </a>
      </div>
    </header>
  );
}
