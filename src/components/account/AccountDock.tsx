"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Cloud, CloudOff, History, Keyboard, Loader2, LogOut, Minus, Moon, Plus, RefreshCw, Sparkle, Sun, Trash2, UserRound, X } from "lucide-react";
import { initials } from "@/lib/account";
import { aiStore, FONT_MAX, FONT_MIN, uiStore } from "@/lib/persistedStore";
import { getThemeServerSnapshot, getThemeSnapshot, setTheme, subscribeToTheme } from "@/lib/theme";
import { setShortcutsOpen } from "../ShortcutsDialog";
import { openTour, tourPending, useTourOpen } from "../onboarding/Onboarding";
import { useToast } from "../Toast";
import { accountStore, accountsEnabled, ackSignIn, deleteCloudData, initAccount, signOut } from "./cloud";
import { ProviderButtons } from "./LoginScreen";

/** Ask the workspace to open one of its rail panels (it listens for this). */
export function openRail(id: string): void {
  window.dispatchEvent(new CustomEvent("cleanmath:open-rail", { detail: id }));
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago";
}

/* ----------------------------------------------------------- avatar */

export function Avatar({ size }: { size: number }) {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const [broken, setBroken] = useState<string | null>(null);
  const p = acc.profile;
  if (acc.status === "loading") return <Loader2 size={size * 0.45} className="animate-spin text-faint" />;
  if (!p) return <UserRound size={size * 0.5} strokeWidth={2} />;
  if (p.avatar && broken !== p.avatar)
    // eslint-disable-next-line @next/next/no-img-element -- a provider avatar URL; next/image would need every host allow-listed
    return <img src={p.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(p.avatar)} className="h-full w-full object-cover" />;
  return <span className="text-[13px] font-semibold">{initials(p.name)}</span>;
}

/* ------------------------------------------------------------- menu */

function Row({ icon: Icon, label, onClick, danger }: { icon: typeof Cloud; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={"press-soft flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium " + (danger ? "text-danger hover:bg-danger/10" : "text-text hover:bg-surface-2")}
    >
      <Icon size={14} className={danger ? "" : "text-faint"} /> {label}
    </button>
  );
}

function AccountMenu({ onClose }: { onClose: () => void }) {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const ui = useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.getServer);
  const ai = useSyncExternalStore(aiStore.subscribe, aiStore.get, aiStore.getServer);
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  const p = acc.profile;

  const sync = acc.sync;
  const syncLine =
    sync.state === "syncing" ? "Syncing..." : sync.state === "error" ? "Sync paused - retrying" : sync.state === "offline" ? "Offline - will sync later" : sync.at ? "Synced " + ago(sync.at) : "Sync on";

  return (
    <div className="w-72 space-y-1 p-1.5 text-xs" onClick={(e) => e.stopPropagation()}>
      {p ? (
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15 text-accent">
            <Avatar size={40} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-text">{p.name}</span>
            <span className="block truncate text-faint">
              {p.email}
              {p.provider && " · " + (p.provider === "github" ? "GitHub" : p.provider === "google" ? "Google" : p.provider)}
            </span>
          </span>
        </div>
      ) : (
        <div className="space-y-2 px-2 py-2">
          <p className="text-sm font-semibold text-text">Sign in</p>
          <p className="leading-snug text-faint">Keep your history, analyses and preferences on every device. Your work still saves in this browser without an account.</p>
          {accountsEnabled ? (
            <div className="pt-0.5">
              <ProviderButtons />
            </div>
          ) : (
            <p className="rounded-lg bg-surface-2 px-2 py-1.5 leading-snug text-muted">Accounts are not set up on this deployment yet.</p>
          )}
        </div>
      )}

      {p && (
        <div className="flex items-center gap-1.5 rounded-lg bg-surface-2/70 px-2.5 py-1.5 text-muted">
          {sync.state === "offline" || sync.state === "error" ? <CloudOff size={13} /> : sync.state === "syncing" ? <RefreshCw size={13} className="animate-spin" /> : <Cloud size={13} className="text-accent" />}
          {syncLine}
          {sync.pending > 0 && <span className="ml-auto text-faint">{sync.pending} queued</span>}
        </div>
      )}

      <div className="my-1 h-px bg-border" />
      <div className="space-y-2 px-2.5 py-1">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Preferences{p ? " · synced" : ""}</div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Theme</span>
          <div className="flex rounded-md border border-border bg-bg p-0.5">
            {(["light", "dark"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTheme(t)} aria-pressed={theme === t} className={"press flex items-center gap-1 rounded px-2 py-0.5 " + (theme === t ? "bg-surface-2 text-text" : "text-faint hover:text-muted")}>
                {t === "light" ? <Sun size={11} /> : <Moon size={11} />} {t === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Font size</span>
          <div className="flex items-center rounded-md border border-border bg-bg p-0.5">
            <button type="button" aria-label="Smaller" disabled={ui.fontSize <= FONT_MIN} onClick={() => uiStore.set({ ...ui, fontSize: ui.fontSize - 1 })} className="press rounded px-1 py-0.5 text-faint hover:text-text disabled:opacity-30">
              <Minus size={11} />
            </button>
            <span className="w-10 text-center font-mono tabular-nums text-text">{ui.fontSize}px</span>
            <button type="button" aria-label="Larger" disabled={ui.fontSize >= FONT_MAX} onClick={() => uiStore.set({ ...ui, fontSize: ui.fontSize + 1 })} className="press rounded px-1 py-0.5 text-faint hover:text-text disabled:opacity-30">
              <Plus size={11} />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted">Gemini key</span>
          <button
            type="button"
            onClick={() => {
              uiStore.set({ ...uiStore.get(), view: "clean", tab: "graph" });
              onClose();
            }}
            className="press rounded-md px-1.5 py-0.5 text-faint hover:bg-surface-2 hover:text-text"
            title="Manage it in Derivation notes (key icon)"
          >
            {ai.apiKey ? "Your own key" : "Shared (site)"}
          </button>
        </div>
      </div>
      <div className="my-1 h-px bg-border" />
      <Row
        icon={History}
        label={p ? "History on all devices" : "History"}
        onClick={() => {
          openRail("history");
          onClose();
        }}
      />
      <Row
        icon={Keyboard}
        label="Keyboard shortcuts"
        onClick={() => {
          setShortcutsOpen(true);
          onClose();
        }}
      />
      <Row
        icon={Sparkle}
        label="Take the tour"
        onClick={() => {
          openTour();
          onClose();
        }}
      />
      {p && (
        <>
          <div className="my-1 h-px bg-border" />
          <Row
            icon={LogOut}
            label="Sign out"
            onClick={() => {
              void signOut().then(() => toast("Signed out - your work stays in this browser"));
              onClose();
            }}
          />
          {confirmDelete ? (
            <div className="space-y-1.5 rounded-lg bg-danger/10 p-2 text-danger">
              <p className="leading-snug">Delete your cloud history, analyses and synced preferences? This browser keeps its copy.</p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void deleteCloudData().then(
                      () => toast("Cloud data deleted"),
                      (e: unknown) => toast("Delete failed: " + (e instanceof Error ? e.message : String(e)), "info"),
                    );
                    setConfirmDelete(false);
                  }}
                  className="press flex-1 rounded-md bg-danger px-2 py-1 font-semibold text-bg"
                >
                  Delete
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)} className="press flex-1 rounded-md border border-danger/30 px-2 py-1 font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <Row icon={Trash2} label="Delete cloud data" danger onClick={() => setConfirmDelete(true)} />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------- circle + popover */

function useAccountInit() {
  useEffect(() => initAccount(), []);
}

function AccountCircle({ size, placement }: { size: number; placement: "dock" | "header" }) {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const signedIn = acc.status === "signed-in";
  const pending = acc.sync.state === "error" || acc.sync.state === "offline";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={signedIn ? "Account: " + acc.profile?.name : "Account and settings"}
        aria-expanded={open}
        title={signedIn ? acc.profile?.name : "Account and settings"}
        className={
          "press relative flex items-center justify-center overflow-hidden rounded-full border-2 shadow-sm transition-[border-color,box-shadow] " +
          (open ? "border-accent shadow-md " : signedIn ? "border-surface hover:border-accent/60 " : "border-border bg-surface text-faint hover:border-border-strong hover:text-text ") +
          (signedIn ? "bg-accent/15 text-accent" : "")
        }
        style={{ width: size, height: size }}
      >
        <Avatar size={size} />
      </button>
      {pending && <span className="pointer-events-none absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-amber-500" aria-hidden />}
      {open && (
        <div
          role="dialog"
          aria-label="Account and settings"
          className={
            "themed absolute z-50 animate-pop-in rounded-xl border border-border bg-surface shadow-2xl shadow-black/20 " +
            (placement === "dock" ? "bottom-0 left-full ml-3 origin-bottom-left" : "right-0 top-full mt-2 origin-top-right")
          }
        >
          <AccountMenu onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/** Header version, for screens without a left margin (below lg). */
export function AccountButton() {
  useAccountInit();
  return (
    <div className="lg:hidden">
      <AccountCircle size={32} placement="header" />
    </div>
  );
}

/**
 * The account circle, bottom left, centred in the blank margin left of the
 * panes. That margin is the page's side offset (when the screen is wider than
 * the 1910px layout) plus the 1rem padding, the 44px rail column and its
 * 10px gap; the 40px circle sits in its middle.
 */
const DOCK_LEFT = "calc((max(0px, (100vw - 1910px) / 2) + 70px) / 2 - 20px)";

export default function AccountDock() {
  return (
    <>
      <div className="fixed bottom-4 z-40 hidden lg:block" style={{ left: DOCK_LEFT }}>
        <AccountCircle size={40} placement="dock" />
      </div>
      <WelcomeCard />
    </>
  );
}

/**
 * Just back from Google or GitHub: the profile picture and name, next to the
 * circle that now carries the picture, for a few seconds.
 */
function WelcomeCard() {
  const acc = useSyncExternalStore(accountStore.subscribe, accountStore.get, accountStore.getServer);
  const tourOpen = useTourOpen();
  // After a first sign-in the tour greets first; this card follows it.
  const show = acc.justSignedIn && acc.ready && !!acc.profile && !tourOpen && !tourPending(acc.profile.id);
  useEffect(() => {
    if (!show) return;
    const t = window.setTimeout(ackSignIn, 5000);
    return () => window.clearTimeout(t);
  }, [show]);
  if (!show) return null;
  const p = acc.profile!;
  return (
    <div
      role="status"
      className="themed fixed bottom-4 left-4 z-[60] flex animate-pop-in items-center gap-3 rounded-2xl border border-border bg-surface py-2.5 pl-2.5 pr-3 shadow-2xl shadow-black/15 lg:bottom-3.5 lg:left-[calc((max(0px,(100vw-1910px)/2)+70px)/2+32px)]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/15 text-accent ring-2 ring-accent/30">
        <Avatar size={44} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-text">Welcome, {p.name.split(" ")[0]}</span>
        <span className="block text-[11px] text-faint">
          Signed in with {p.provider === "github" ? "GitHub" : p.provider === "google" ? "Google" : p.provider || "your account"} · syncing your work
        </span>
      </span>
      <button type="button" onClick={ackSignIn} aria-label="Dismiss" className="press ml-1 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text">
        <X size={13} />
      </button>
    </div>
  );
}
