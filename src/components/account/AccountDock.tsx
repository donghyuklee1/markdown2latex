"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Cloud, CloudOff, FilePlus2, History, Keyboard, Loader2, LogOut, Minus, Moon, Plus, RefreshCw, Sun, Trash2, UserRound } from "lucide-react";
import { initials } from "@/lib/account";
import { docs, MAX_DOCS } from "@/lib/documents";
import { aiStore, FONT_MAX, FONT_MIN, uiStore } from "@/lib/persistedStore";
import { getThemeServerSnapshot, getThemeSnapshot, setTheme, subscribeToTheme } from "@/lib/theme";
import { setShortcutsOpen } from "../ShortcutsDialog";
import { useToast } from "../Toast";
import { accountStore, accountsEnabled, deleteCloudData, initAccount, signIn, signOut, type Provider } from "./cloud";
import { GithubMark, GoogleMark } from "./icons";

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

function Avatar({ size }: { size: number }) {
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
  const [busy, setBusy] = useState<Provider | null>(null);
  const toast = useToast();
  const p = acc.profile;

  const go = async (provider: Provider) => {
    setBusy(provider);
    try {
      await signIn(provider); // navigates away to the provider
    } catch (e) {
      toast("Sign-in failed: " + (e instanceof Error ? e.message : String(e)), "info");
      setBusy(null);
    }
  };

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
            <div className="space-y-1.5 pt-0.5">
              {(
                [
                  ["google", "Continue with Google", GoogleMark],
                  ["github", "Continue with GitHub", GithubMark],
                ] as const
              ).map(([id, label, Mark]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => void go(id)}
                  disabled={!!busy || acc.status === "loading"}
                  className="press flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface font-semibold text-text shadow-sm transition-colors hover:border-border-strong disabled:opacity-60"
                >
                  {busy === id ? <Loader2 size={14} className="animate-spin" /> : <Mark size={15} />} {label}
                </button>
              ))}
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
 * Bottom-left dock: a few everyday actions above the account circle. It sits
 * in the left rail's column - the margin a wide screen leaves empty.
 */
export default function AccountDock() {
  const toast = useToast();
  const theme = useSyncExternalStore(subscribeToTheme, getThemeSnapshot, getThemeServerSnapshot);
  const actions = [
    {
      label: "New document",
      keys: "",
      icon: FilePlus2,
      run: () => {
        if (uiStore.get().view !== "clean") uiStore.set({ ...uiStore.get(), view: "clean" });
        if (docs.create("", "") === null) toast("Up to " + MAX_DOCS + " tabs - close one first", "info");
      },
    },
    { label: "History", keys: "", icon: History, run: () => openRail("history") },
    { label: "Keyboard shortcuts", keys: "?", icon: Keyboard, run: () => setShortcutsOpen(true) },
    { label: theme === "dark" ? "Light theme" : "Dark theme", keys: "", icon: theme === "dark" ? Sun : Moon, run: () => setTheme(theme === "dark" ? "light" : "dark") },
  ];
  return (
    <div
      className="fixed bottom-4 z-40 hidden w-11 flex-col items-center gap-1.5 lg:flex"
      // Line up with the left rail, whose column is centred with the page.
      style={{ left: "max(1rem, calc((100vw - 1910px) / 2 + 1rem))" }}
    >
      <nav aria-label="Quick actions" className="themed flex flex-col items-center gap-0.5 rounded-xl border border-border bg-surface p-1 shadow-sm">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.run}
            aria-label={a.label}
            className="press group relative flex h-8 w-8 items-center justify-center rounded-lg text-faint hover:bg-surface-2 hover:text-text"
          >
            <a.icon size={15} />
            <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 translate-x-[-4px] whitespace-nowrap rounded-md bg-text px-2 py-1 text-[11px] font-medium text-bg opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
              {a.label}
              {a.keys && <span className="ml-1.5 font-mono opacity-60">{a.keys}</span>}
            </span>
          </button>
        ))}
      </nav>
      <AccountCircle size={40} placement="dock" />
    </div>
  );
}
