import Image from "next/image";
import Link from "next/link";
import { Coffee, Star } from "lucide-react";
import { GITHUB_URL, SPONSOR_URL } from "@/lib/site";
import { ShortcutsButton } from "./ShortcutsDialog";
import PalettePicker from "./PalettePicker";
import ThemeToggle from "./ThemeToggle";


/** lucide-react v1 dropped brand marks, so the GitHub octicon is inlined. */
function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-2.92-.89-2.92-3.5 0-.73.26-1.33.69-1.8-.07-.17-.3-.87.07-1.81 0 0 .56-.18 1.83.69.53-.15 1.1-.22 1.67-.22s1.14.07 1.67.22c1.27-.88 1.83-.69 1.83-.69.37.94.14 1.64.07 1.81.43.47.69 1.06.69 1.8 0 2.62-1.15 3.3-2.93 3.5.3.26.56.76.56 1.54 0 1.07-.01 1.94-.01 2.21 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="markdown2Latex home">
      <Image
        src="/logo-light.png"
        alt="markdown2Latex"
        width={1094}
        height={436}
        priority
        className="logo-light h-8 w-auto sm:h-10"
      />
      <Image
        src="/logo-dark.png"
        alt="markdown2Latex"
        width={1094}
        height={436}
        priority
        className="logo-dark h-8 w-auto sm:h-10"
      />
    </Link>
  );
}

export default function Header() {
  return (
    <header className="themed flex shrink-0 items-center gap-4 border-b border-border px-4 py-3 sm:px-6">
      <Wordmark />

      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="press group flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface py-1.5 pl-2.5 pr-1.5 text-xs font-medium text-muted transition-colors hover:border-border-strong hover:text-text"
        >
          <GithubMark size={14} />
          <span className="hidden sm:inline">Star</span>
          <span className="flex items-center rounded bg-surface-2 px-1.5 py-0.5 text-faint transition-colors group-hover:bg-accent/15 group-hover:text-accent">
            <Star size={11} strokeWidth={2.5} />
          </span>
        </a>

        <a
          href={SPONSOR_URL}
          target="_blank"
          rel="noreferrer noopener"
          title="Buy the developer a coffee on GitHub Sponsors"
          className="press flex h-8 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-2.5 text-xs font-semibold text-accent transition-colors hover:border-accent hover:bg-accent hover:text-accent-ink"
        >
          <Coffee size={14} strokeWidth={2.25} />
          <span className="hidden sm:inline">Buy me a coffee</span>
        </a>

        <ShortcutsButton />
        <ThemeToggle />
        <PalettePicker />
      </div>
    </header>
  );
}
