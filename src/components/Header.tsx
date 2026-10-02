import Image from "next/image";
import Link from "next/link";
import { Coffee, Star } from "lucide-react";
import { GITHUB_URL, SPONSOR_URL } from "@/lib/site";
import { ShortcutsButton } from "./ShortcutsDialog";
import { ViewSwitch } from "./AppShell";
import PalettePicker from "./PalettePicker";
import ThemeToggle from "./ThemeToggle";
import { GithubMark } from "./account/icons";
import { AccountButton } from "./account/AccountDock";
import { SignInButton } from "./account/LoginScreen";
import AiModeToggle from "./ai/AiModeToggle";


function Wordmark() {
  return (
    <Link href="/" className="flex shrink-0 items-center" aria-label="markdown2Latex home">
      <Image
        src="/logo-light.png"
        alt="markdown2Latex"
        width={891}
        height={302}
        priority
        className="logo-light h-6 w-auto sm:h-8"
      />
      <Image
        src="/logo-dark.png"
        alt="markdown2Latex"
        width={891}
        height={302}
        priority
        className="logo-dark h-6 w-auto sm:h-8"
      />
    </Link>
  );
}

export default function Header() {
  return (
    <header className="themed shrink-0 border-b border-border">
      {/* Same max width and side padding as the workspace below, so the wordmark's
          left edge lines up with the panels. */}
      <div className="mx-auto flex w-full max-w-[1910px] items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
      <Wordmark />
      <ViewSwitch />

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

        <AiModeToggle />
        <ShortcutsButton />
        <ThemeToggle />
        <PalettePicker />
        <SignInButton />
        {/* Below lg there is no margin for the dock: the account circle lives here. */}
        <AccountButton />
      </div>
      </div>
    </header>
  );
}
