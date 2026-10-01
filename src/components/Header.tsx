import { ShieldCheck, Sigma, Star } from "lucide-react";

/** lucide-react v1 dropped brand marks, so the GitHub octicon is inlined. */
function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-2.92-.89-2.92-3.5 0-.73.26-1.33.69-1.8-.07-.17-.3-.87.07-1.81 0 0 .56-.18 1.83.69.53-.15 1.1-.22 1.67-.22s1.14.07 1.67.22c1.27-.88 1.83-.69 1.83-.69.37.94.14 1.64.07 1.81.43.47.69 1.06.69 1.8 0 2.62-1.15 3.3-2.93 3.5.3.26.56.76.56 1.54 0 1.07-.01 1.94-.01 2.21 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
    </svg>
  );
}

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
          <GithubMark size={14} />
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
