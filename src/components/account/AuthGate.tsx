"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AlertCircle, Check, ChevronLeft, ChevronRight, Loader2, Lock, Pause, Play } from "lucide-react";
import { AiArt, CleanArt, DerivationArt, PreviewArt, WorkflowArt } from "../onboarding/Onboarding";
import ThemeToggle from "../ThemeToggle";
import { accountStore, accountsEnabled, clearSignInError, initAccount } from "./cloud";
import { ProviderButtons } from "./LoginScreen";

/* ------------------------------------------------------- the guide */

const MANUAL = [
  { art: CleanArt, title: "Paste what the AI wrote", body: "Drop in an answer from ChatGPT, Claude or Gemini. Broken delimiters, stray Markdown and bad environments are fixed as you type." },
  { art: WorkflowArt, title: "Copy LaTeX that compiles", body: "The clean result is on the right. One click - or Cmd/Ctrl + Enter - copies it, ready for Overleaf, Obsidian or a paper." },
  { art: PreviewArt, title: "See it as a paper", body: "Live Preview typesets a whole document like Overleaf's PDF: numbered equations, references, zoom, contents, Save as PDF." },
  { art: DerivationArt, title: "Understand the derivation", body: "Derivation notes show how each formula builds on the others, with plain-language explanations and a notation table." },
  { art: AiArt, title: "Bring in images, add AI", body: "Paste a photo of handwritten maths to get LaTeX. With your own free Gemini key, AI mode explains derivations as you write." },
];
const STEP_MS = 6500;

/**
 * The how-to-use animation: each step's illustration plays, its progress bar
 * fills, and the next follows. Hover (or the pause button) holds it; the
 * arrows and the bars step by hand.
 */
function Manual() {
  const [i, setI] = useState(0);
  // Reduced motion: no automatic advancing - the arrows and bars step by hand.
  const [paused, setPaused] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const [hover, setHover] = useState(false);
  const hold = paused || hover;
  const S = MANUAL[i];
  const go = (n: number) => setI((n + MANUAL.length) % MANUAL.length);
  return (
    <div className="w-full" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-xl shadow-black/5">
        <div key={i} className="ob-enter-next">
          <div className="ob-stage relative h-[230px] overflow-hidden border-b border-border sm:h-[250px]">
            <S.art />
          </div>
          <div className="space-y-1.5 px-6 pb-2 pt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              How it works · {i + 1} / {MANUAL.length}
            </div>
            <h2 className="text-lg font-semibold text-text">{S.title}</h2>
            <p className="min-h-[66px] text-[13px] leading-relaxed text-muted">{S.body}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 px-6 pb-5 pt-1">
          <div className="flex flex-1 gap-1.5">
            {MANUAL.map((m, k) => (
              <button key={m.title} type="button" onClick={() => go(k)} aria-label={"Step " + (k + 1) + ": " + m.title} className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                <span
                  key={k === i ? "run-" + i : "idle"}
                  className={"block h-full rounded-full bg-accent " + (k < i ? "w-full" : k === i ? "manual-fill" : "w-0")}
                  style={k === i ? { animationDuration: STEP_MS + "ms", animationPlayState: hold ? "paused" : "running" } : undefined}
                  onAnimationEnd={() => k === i && go(i + 1)}
                />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5 text-faint">
            <button type="button" onClick={() => go(i - 1)} aria-label="Previous step" className="press rounded-md p-1 hover:bg-surface-2 hover:text-text">
              <ChevronLeft size={16} />
            </button>
            <button type="button" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"} className="press rounded-md p-1 hover:bg-surface-2 hover:text-text">
              {paused ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button type="button" onClick={() => go(i + 1)} aria-label="Next step" className="press rounded-md p-1 hover:bg-surface-2 hover:text-text">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- screens */

function Logo({ className = "h-8" }: { className?: string }) {
  return (
    <>
      <Image src="/logo-light.png" alt="markdown2Latex" width={891} height={302} priority className={"logo-light w-auto " + className} />
      <Image src="/logo-dark.png" alt="markdown2Latex" width={891} height={302} priority className={"logo-dark w-auto " + className} />
    </>
  );
}

function Splash({ label }: { label: string }) {
  return (
    <div className="themed flex min-h-screen flex-col items-center justify-center gap-4 bg-bg">
      <Logo className="h-10 animate-fade-in" />
      <span className="flex items-center gap-2 text-xs text-faint">
        <Loader2 size={13} className="animate-spin" /> {label}
      </span>
    </div>
  );
}

function Welcome() {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const cancelled = acc.error && /denied|cancel/i.test(acc.error);
  return (
    <div className="themed flex min-h-screen flex-col bg-bg">
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-4">
        <Logo />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-8 px-5 pb-10 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
        <section className="order-2 animate-fade-in lg:order-1">
          <Manual />
        </section>
        <section className="order-1 lg:order-2">
          <div className="ob-card mx-auto w-full max-w-[400px] rounded-2xl border border-border bg-surface p-7 shadow-2xl shadow-black/10">
            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-text">
              Paste messy LLM math.
              <br />
              Get LaTeX that compiles.
            </h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">Sign in to start - your documents, history and settings stay private to your account, on every device.</p>

            {acc.error && (
              <div className="mt-4 flex gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
                <AlertCircle size={14} className="mt-px shrink-0" />
                <span className="flex-1">{cancelled ? "Sign-in was cancelled. Choose a provider to try again." : "Sign-in failed: " + acc.error}</span>
                <button type="button" onClick={clearSignInError} className="font-semibold underline">
                  OK
                </button>
              </div>
            )}

            <div className="mt-5">
              <ProviderButtons size="lg" />
            </div>

            <ul className="mt-5 space-y-1.5 text-[12.5px] text-muted">
              {["Free - no credit card, no setup", "Your work syncs across your devices", "Image to LaTeX and AI notes with your own key"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <Check size={10} strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
            <p className="mt-5 flex gap-1.5 border-t border-border pt-4 text-[11px] leading-snug text-faint">
              <Lock size={12} className="mt-px shrink-0" />
              We receive only your name, email and profile picture. Each account&apos;s data is visible to that account alone; signing out removes it from this device.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

/**
 * Sign in first. With accounts set up on this deployment, the app opens only
 * for a signed-in user, on that user's own data (storageScope.ts); everyone
 * else gets the welcome screen with the animated guide. Without accounts
 * (local development) the app opens as before.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  useEffect(() => initAccount(), []);
  if (!accountsEnabled) return <>{children}</>;
  if (acc.status === "signed-in" && acc.ready) return <>{children}</>;
  if (acc.status === "signed-in") return <Splash label="Opening your documents..." />;
  if (acc.status === "checking" || (acc.status === "loading" && !acc.error)) return <Splash label="Signing you in..." />;
  return <Welcome />;
}
