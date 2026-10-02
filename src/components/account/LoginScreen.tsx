"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, Check, Loader2, LogIn, X } from "lucide-react";
import { accountStore, accountsEnabled, clearSignInError, LAST_PROVIDER_KEY, signIn, type Provider } from "./cloud";
import { GithubMark, GoogleMark } from "./icons";

/* --------------------------------------------- open/close from anywhere */

let open = false;
const listeners = new Set<() => void>();
const setOpen = (v: boolean) => {
  open = v;
  for (const l of listeners) l();
};
export const openLogin = () => setOpen(true);
const loginStore = {
  get: () => open,
  getServer: () => false,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

const PROVIDERS: ReadonlyArray<{ id: Provider; label: string; Mark: typeof GoogleMark; cls: string }> = [
  { id: "google", label: "Continue with Google", Mark: GoogleMark, cls: "border-border bg-surface text-text hover:border-border-strong hover:bg-surface-2" },
  { id: "github", label: "Continue with GitHub", Mark: GithubMark, cls: "border-transparent bg-[#24292f] text-white hover:bg-[#32383f] dark:bg-[#f0f3f6] dark:text-[#24292f] dark:hover:bg-white" },
];

function lastProvider(): Provider | null {
  try {
    const v = window.localStorage.getItem(LAST_PROVIDER_KEY);
    return v === "google" || v === "github" ? v : null;
  } catch {
    return null;
  }
}

/** Google and GitHub buttons; the one used last in this browser comes first, marked. */
export function ProviderButtons({ size = "md" }: { size?: "md" | "lg" }) {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [last] = useState(lastProvider);
  const ordered = last ? [...PROVIDERS].sort((a) => (a.id === last ? -1 : 1)) : PROVIDERS;

  const go = async (p: Provider) => {
    setBusy(p);
    try {
      await signIn(p); // leaves the page for the provider
    } catch {
      setBusy(null);
    }
  };

  return (
    <div className={"space-y-2 " + (last ? "pt-1.5" : "")}>
      {ordered.map(({ id, label, Mark, cls }) => (
        <button
          key={id}
          type="button"
          onClick={() => void go(id)}
          disabled={!!busy || acc.status === "loading"}
          className={
            "press relative flex w-full items-center justify-center gap-2.5 rounded-xl border font-semibold shadow-sm transition-colors disabled:cursor-wait disabled:opacity-70 " +
            (size === "lg" ? "h-11 text-sm " : "h-9 text-xs ") +
            cls
          }
        >
          {busy === id ? <Loader2 size={16} className="animate-spin" /> : <Mark size={size === "lg" ? 18 : 15} />}
          {busy === id ? "Redirecting to " + (id === "google" ? "Google" : "GitHub") + "..." : label}
          {/* On the top edge, not inside: it never covers the label, however narrow the button. */}
          {id === last && !busy && (
            <span className="pointer-events-none absolute -top-2 right-3 rounded-full border border-accent/30 bg-surface px-1.5 py-px text-[9.5px] font-semibold leading-[14px] text-accent shadow-sm">
              Last used
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Header button for signed-out visitors. */
export function SignInButton() {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  if (!accountsEnabled || acc.status === "signed-in") return null;
  return (
    <button
      type="button"
      onClick={openLogin}
      disabled={acc.status === "loading"}
      className="press flex h-8 items-center gap-1.5 rounded-lg bg-text px-3 text-xs font-semibold text-bg shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {acc.status === "loading" ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
      <span className="hidden sm:inline">Sign in</span>
    </button>
  );
}

/**
 * The sign-in screen: two provider buttons and what an account is for. Opens
 * from the header button, and by itself when a sign-in comes back with an
 * error (the user cancelled, or the provider refused).
 */
export default function LoginScreen() {
  const isOpen = useSyncExternalStore(loginStore.subscribe, loginStore.get, loginStore.getServer);
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const card = useRef<HTMLDivElement>(null);
  const shown = isOpen || !!acc.error;

  const close = () => {
    setOpen(false);
    clearSignInError();
  };

  useEffect(() => {
    if (acc.status === "signed-in" && open) setOpen(false);
  }, [acc.status]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    card.current?.querySelector<HTMLButtonElement>("button[data-autofocus]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!shown) return null;
  const cancelled = acc.error && /denied|cancel/i.test(acc.error);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={card} role="dialog" aria-modal="true" aria-label="Sign in" className="themed ob-card relative w-full max-w-[380px] rounded-2xl border border-border bg-surface p-7 shadow-2xl">
        <button type="button" data-autofocus onClick={close} aria-label="Close" className="press absolute right-3 top-3 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
          <X size={15} />
        </button>
        <div className="flex flex-col items-center text-center">
          <Image src="/logo-light.png" alt="markdown2Latex" width={891} height={302} className="logo-light h-9 w-auto" />
          <Image src="/logo-dark.png" alt="markdown2Latex" width={891} height={302} className="logo-dark h-9 w-auto" />
          <h2 className="mt-4 text-lg font-semibold text-text">Sign in</h2>
          <p className="mt-1 text-[13px] text-muted">Keep your work on every device.</p>
        </div>

        {acc.error && (
          <div className="mt-4 flex gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertCircle size={14} className="mt-px shrink-0" />
            {cancelled ? "Sign-in was cancelled. Choose a provider to try again." : "Sign-in failed: " + acc.error}
          </div>
        )}

        <div className="mt-5">
          <ProviderButtons size="lg" />
        </div>

        <ul className="mt-5 space-y-1.5 text-[12.5px] text-muted">
          {["Your history on all your devices", "Derivation analyses saved, not re-run", "Your theme, colours and snippets"].map((t) => (
            <li key={t} className="flex items-center gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <Check size={10} strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>

        <div className="mt-5 border-t border-border pt-4 text-center">
          <p className="text-[11px] leading-snug text-faint">We receive only your name, email and profile picture. Your Gemini key never leaves this browser.</p>
          <button type="button" onClick={close} className="press mt-2 text-xs font-semibold text-muted underline-offset-2 hover:text-text hover:underline">
            Continue without an account
          </button>
        </div>
      </div>
    </div>
  );
}
