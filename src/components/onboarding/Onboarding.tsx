"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Check, Cloud, Copy, FileDown, History, Keyboard, Moon, Laptop, Smartphone, X } from "lucide-react";
import { InlineMath } from "@/components/Katex";
import { GeminiStar } from "@/components/BrandMark";
import BrandMark from "@/components/BrandMark";
import { markSeen, ONBOARDING_KEY, reviveOnboarding, shouldOnboard } from "@/lib/onboarding";
import { accountStore } from "../account/cloud";
import { KeyForm } from "../ai/AiKeyDialog";
import { Avatar } from "../account/AccountDock";

/* --------------------------------------------- open/close from anywhere */

let open = false;
const listeners = new Set<() => void>();
export function openTour(): void {
  open = true;
  for (const l of listeners) l();
}
function closeTour(): void {
  open = false;
  for (const l of listeners) l();
}
const tourStore = {
  get: () => open,
  getServer: () => false,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Whether the tour is on screen (other overlays wait for it). */
export function useTourOpen(): boolean {
  return useSyncExternalStore(tourStore.subscribe, tourStore.get, tourStore.getServer);
}

function readSeen() {
  try {
    return reviveOnboarding(window.localStorage.getItem(ONBOARDING_KEY));
  } catch {
    return reviveOnboarding(null);
  }
}
/** This account has not seen the tour yet, so it is about to open. */
export const tourPending = (userId: string | null | undefined): boolean => shouldOnboard(readSeen(), userId);

function rememberSeen(userId: string) {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, JSON.stringify(markSeen(readSeen(), userId)));
  } catch {
    // Storage blocked: the tour may show again next time - harmless.
  }
}

/* ------------------------------------------------------- illustrations */

/** Messy LLM output on the left becomes clean, rendered LaTeX on the right. */
function CleanArt() {
  return (
    <div className="flex h-full items-center justify-center gap-3 px-4">
      <div className="ob-slide-l w-[42%] space-y-1.5 rounded-lg border border-border bg-bg p-2.5 font-mono text-[10.5px] leading-snug text-muted">
        <div>
          Energy is <span className="ob-strike">\( E=mc^2 \)</span>
        </div>
        <div>
          <span className="ob-strike">$$</span> \sum_i x_i <span className="ob-strike">$</span>
        </div>
        <div className="text-faint">**where** c is ...</div>
      </div>
      <div className="ob-arrow flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink shadow-md">
        <ArrowRight size={15} />
      </div>
      <div className="ob-slide-r w-[42%] space-y-1.5 rounded-lg border border-accent/40 bg-surface p-2.5 text-[12px] text-text shadow-sm">
        <div className="ob-line" style={{ animationDelay: "900ms" }}>
          Energy is <InlineMath math="E=mc^2" renderError={() => <span>E=mc^2</span>} />
        </div>
        <div className="ob-line text-center" style={{ animationDelay: "1150ms" }}>
          <InlineMath math="\sum_i x_i" renderError={() => <span>sum x</span>} />
        </div>
        <div className="ob-line text-[11px] text-muted" style={{ animationDelay: "1400ms" }}>
          where <InlineMath math="c" renderError={() => <span>c</span>} /> is ...
        </div>
      </div>
    </div>
  );
}

/** Paste on the left, copy on the right. */
function WorkflowArt() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      <div className="flex w-full max-w-sm gap-2">
        <div className="flex-1 rounded-lg border border-border bg-bg p-2">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-faint">Paste</div>
          {[70, 90, 55, 80].map((w, i) => (
            <div key={i} className="ob-type mb-1 h-1.5 rounded bg-border-strong/70" style={{ width: w + "%", animationDelay: i * 180 + "ms" }} />
          ))}
        </div>
        <div className="flex-1 rounded-lg border border-accent/30 bg-surface p-2">
          <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-accent">Clean LaTeX</div>
          {[60, 85, 50, 75].map((w, i) => (
            <div key={i} className="ob-type mb-1 h-1.5 rounded bg-accent/40" style={{ width: w + "%", animationDelay: 900 + i * 140 + "ms" }} />
          ))}
        </div>
      </div>
      <div className="ob-pop flex items-center gap-2" style={{ animationDelay: "1700ms" }}>
        <span className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-ink shadow-md">
          <Copy size={12} /> Copy Clean
        </span>
        <span className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">⌘ Enter</span>
        <span className="ob-pop flex items-center gap-1 text-[11px] font-semibold text-accent" style={{ animationDelay: "2200ms" }}>
          <Check size={13} /> Copied
        </span>
      </div>
    </div>
  );
}

/** A paper page drawing itself, then the export buttons. */
function PreviewArt() {
  return (
    <div className="flex h-full items-center justify-center gap-5 px-6">
      <div className="ob-zoom relative h-[150px] w-[112px] rounded-sm bg-white p-3 shadow-lg ring-1 ring-black/5">
        <div className="ob-type mx-auto mb-2 h-1.5 w-3/5 rounded bg-neutral-800" />
        {[100, 92, 96, 70].map((w, i) => (
          <div key={i} className="ob-type mb-1 h-1 rounded bg-neutral-300" style={{ width: w + "%", animationDelay: 300 + i * 120 + "ms" }} />
        ))}
        <div className="ob-type my-2 flex justify-center text-[9px] text-neutral-800" style={{ animationDelay: "850ms" }}>
          <InlineMath math="\nabla\cdot E=\rho/\varepsilon_0" renderError={() => <span>div E</span>} />
        </div>
        {[95, 88, 60].map((w, i) => (
          <div key={i} className="ob-type mb-1 h-1 rounded bg-neutral-300" style={{ width: w + "%", animationDelay: 1000 + i * 120 + "ms" }} />
        ))}
      </div>
      <div className="space-y-2">
        <div className="ob-pop flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text shadow-sm" style={{ animationDelay: "1400ms" }}>
          <FileDown size={13} /> Save as PDF
        </div>
        <div className="ob-pop flex items-center gap-1.5 rounded-lg border border-[#138a07]/40 bg-[#138a07]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[#138a07] shadow-sm" style={{ animationDelay: "1650ms" }}>
          Open in <BrandMark mark="overleaf" height="1.05em" />
        </div>
        <div className="ob-pop flex items-center gap-1 text-[10.5px] text-faint" style={{ animationDelay: "1900ms" }}>
          − 125% + zoom · Contents · two columns
        </div>
      </div>
    </div>
  );
}

/** Steps assembling into a derivation, with Gemini explaining them. */
function DerivationArt() {
  const cards = [
    { x: 24, y: 112, t: "Definition", c: "text-[rgb(var(--syn-num))]" },
    { x: 196, y: 112, t: "Assumption", c: "text-[rgb(var(--syn-env))]" },
    { x: 110, y: 62, t: "Step", c: "text-muted" },
    { x: 110, y: 12, t: "Result", c: "text-accent" },
  ];
  return (
    <div className="flex h-full items-center justify-center">
      <div className="relative h-[150px] w-[300px]">
        <svg className="absolute inset-0" width="300" height="150" aria-hidden>
          {[
            [69, 112, 155, 92],
            [241, 112, 155, 92],
            [155, 62, 155, 42],
          ].map(([x1, y1, x2, y2], i) => (
            <path key={i} d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`} className="ob-draw text-border-strong" stroke="currentColor" strokeWidth="1.6" fill="none" style={{ animationDelay: 500 + i * 300 + "ms" }} />
          ))}
        </svg>
        {cards.map((c, i) => (
          <div key={c.t} className="ob-pop absolute w-[90px] rounded-lg border border-border bg-surface px-2 py-1.5 shadow-sm" style={{ left: c.x, top: c.y, animationDelay: i * 250 + "ms" }}>
            <div className={"text-[8.5px] font-bold uppercase tracking-wide " + c.c}>{c.t}</div>
            <div className="mt-1 h-1 w-4/5 rounded bg-border-strong/60" />
          </div>
        ))}
        <div className="ob-pop absolute -right-6 top-6 flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-1 text-[10px] font-semibold text-text shadow-md" style={{ animationDelay: "1500ms" }}>
          <span className="inline-flex">
            <GeminiStar size={12} />
          </span>
          explains each step
        </div>
      </div>
    </div>
  );
}

/** The dock at the bottom left, and your work following you across devices. */
function AccountArt() {
  return (
    <div className="flex h-full items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="ob-pop space-y-1 rounded-lg border border-border bg-surface p-2 text-[9.5px] text-muted shadow-sm" style={{ animationDelay: "300ms" }}>
          {[History, Moon, Keyboard].map((Icon, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Icon size={10} className="text-faint" />
              <span className="h-1 rounded bg-border-strong/60" style={{ width: [42, 34, 48][i] }} />
            </div>
          ))}
        </div>
        <span className="ob-ring relative flex h-10 w-10 items-center justify-center rounded-full border-2 border-accent bg-accent/15 text-[12px] font-semibold text-accent">
          You
        </span>
        <span className="text-[9.5px] text-faint">bottom left</span>
      </div>
      <div className="relative flex h-[120px] w-[170px] items-center justify-center">
        <svg className="absolute inset-0" width="170" height="120" aria-hidden>
          <path d="M85,48 C60,60 40,70 28,92" className="ob-dash text-accent/60" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
          <path d="M85,48 C110,60 130,70 142,92" className="ob-dash text-accent/60" stroke="currentColor" strokeWidth="1.5" fill="none" strokeDasharray="4 4" />
        </svg>
        <span className="ob-float absolute left-1/2 top-3 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Cloud size={22} />
        </span>
        <span className="ob-pop absolute bottom-1 left-1 flex flex-col items-center text-muted" style={{ animationDelay: "400ms" }}>
          <Laptop size={22} />
        </span>
        <span className="ob-pop absolute bottom-1 right-3 flex flex-col items-center text-muted" style={{ animationDelay: "650ms" }}>
          <Smartphone size={20} />
        </span>
      </div>
    </div>
  );
}

/** AI mode: Gemini working beside the editor. */
function AiArt() {
  return (
    <div className="flex h-full items-center justify-center gap-6 px-6">
      <span className="ob-ring relative flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface shadow-md">
        <span className="inline-flex">
          <GeminiStar size={28} />
        </span>
      </span>
      <div className="space-y-2">
        {["Explains derivations as you write", "Image \u2192 LaTeX / Markdown", "Fills in units for the unit check"].map((t, i) => (
          <div key={t} className="ob-pop flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text shadow-sm" style={{ animationDelay: 200 + i * 220 + "ms" }}>
            <Check size={12} className="text-ok" /> {t}
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS: Array<{ art: () => React.JSX.Element; title: (name: string) => string; body: string; extra?: () => React.JSX.Element }> = [
  {
    art: CleanArt,
    title: (name: string) => (name ? "Welcome, " + name.split(" ")[0] + "!" : "Welcome!"),
    body: "markdown2Latex turns the messy maths an AI gives you into clean LaTeX that compiles the first time.",
  },
  {
    art: WorkflowArt,
    title: () => "Paste, then copy",
    body: "Paste on the left - delimiters, stray Markdown and broken environments are fixed as you type. Copy the clean result with one click or ⌘/Ctrl + Enter.",
  },
  {
    art: PreviewArt,
    title: () => "See it as a paper",
    body: "Live Preview lays your document out like Overleaf: zoom in and out, jump through the contents, save a PDF, or open it in Overleaf.",
  },
  {
    art: DerivationArt,
    title: () => "Understand the derivation",
    body: "Derivation notes show how your equations build on each other - top-down from the result or bottom-up from the definitions. Analyze with Gemini adds plain-language explanations and a notation table.",
  },
  {
    art: AiArt,
    title: () => "Turn on AI mode (optional)",
    body: "Paste your own free Gemini key and AI mode switches on at once. Nothing is sent until you do, and the key goes only to Google.",
    extra: () => <KeyForm compact />,
  },
  {
    art: AccountArt,
    title: () => "Yours on every device",
    body: "Your history, analyses and preferences now sync to your account. The circle at the bottom left holds your profile, settings and history - and this tour, any time.",
  },
];

/* ---------------------------------------------------------------- tour */

export default function Onboarding() {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const isOpen = useSyncExternalStore(tourStore.subscribe, tourStore.get, tourStore.getServer);
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const primary = useRef<HTMLButtonElement>(null);
  const userId = acc.profile?.id ?? null;

  // First sign-in: once the account's synced preferences are in (another
  // device may already have seen the tour), open it if this account has not.
  useEffect(() => {
    if (acc.status !== "signed-in" || !acc.ready || !userId) return;
    if (shouldOnboard(readSeen(), userId)) {
      const t = window.setTimeout(openTour, 600);
      return () => window.clearTimeout(t);
    }
  }, [acc.status, acc.ready, userId]);

  const finish = () => {
    if (userId) rememberSeen(userId);
    closeTour();
    setStep(0);
  };
  const go = (to: number) => {
    if (to < 0) return;
    if (to >= STEPS.length) return finish();
    setDir(to > step ? 1 : -1);
    setStep(to);
  };

  useEffect(() => {
    if (!isOpen) return;
    primary.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") go(step + 1);
      else if (e.key === "ArrowLeft") go(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!isOpen) return null;
  const S = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="themed ob-card relative w-full max-w-[520px] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
        <button type="button" onClick={finish} aria-label="Skip the tour" className="press absolute right-3 top-3 z-10 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
          <X size={15} />
        </button>
        {/* key remounts the slide, so its animation plays every time it is shown */}
        <div key={step} className={dir > 0 ? "ob-enter-next" : "ob-enter-prev"}>
          <div className="ob-stage relative h-[210px] overflow-hidden border-b border-border">
            <S.art />
          </div>
          <div className="space-y-2 px-6 pb-2 pt-5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">
              Step {step + 1} of {STEPS.length}
            </div>
            <h2 className="flex items-center gap-2.5 text-lg font-semibold text-text">
              {step === 0 && acc.profile && (
                <span className="ob-pop flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15 text-accent ring-2 ring-accent/30">
                  <Avatar size={36} />
                </span>
              )}
              {S.title(acc.profile?.name ?? "")}
            </h2>
            <p className="min-h-[60px] text-[13px] leading-relaxed text-muted">{S.body}</p>
            {S.extra && <div className="pb-1">{S.extra()}</div>}
          </div>
        </div>
        <div className="flex items-center gap-2 px-6 pb-5 pt-2">
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                tabIndex={-1}
                onClick={() => go(i)}
                className={"h-1.5 rounded-full transition-all duration-300 " + (i === step ? "w-5 bg-accent" : i < step ? "w-1.5 bg-accent/40" : "w-1.5 bg-border-strong")}
              />
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            {step > 0 ? (
              <button type="button" onClick={() => go(step - 1)} className="press flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-muted hover:bg-surface-2 hover:text-text">
                <ArrowLeft size={13} /> Back
              </button>
            ) : (
              <button type="button" onClick={finish} className="press rounded-lg px-2.5 py-1.5 text-xs font-semibold text-faint hover:bg-surface-2 hover:text-text">
                Skip
              </button>
            )}
            <button ref={primary} type="button" onClick={() => go(step + 1)} className="press flex items-center gap-1 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-accent-ink shadow-sm hover:bg-accent/90">
              {last ? "Start writing" : "Next"} {last ? <Check size={13} /> : <ArrowRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
