"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

/** An inline button on the toast, e.g. "Undo" after clearing the editor. */
export interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

type Push = (message: string, kind?: ToastKind, action?: ToastAction) => void;

const ToastContext = createContext<Push>(() => {});

/** Fire a toast from anywhere under <ToastProvider>. */
export function useToast(): Push {
  return useContext(ToastContext);
}

const ICONS: Record<ToastKind, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info,
};

/* Solid panel fill rather than a colour wash: a toast floats over arbitrary
 * content, and a 10%-opacity tint is unreadable against the output pane. */
const TONES: Record<ToastKind, string> = {
  success: "border-accent/50 bg-surface text-accent",
  error: "border-danger/50 bg-surface text-danger",
  info: "border-border-strong bg-surface text-muted",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<Push>((message, kind = "success", action) => {
    const id = nextId.current++;
    // Keep at most three on screen; a rapid Cmd+Enter burst should not stack up.
    setToasts((prev) => [...prev.slice(-2), { id, message, kind, action }]);
    // A toast with a button stays long enough to reach for it.
    window.setTimeout(() => dismiss(id), action ? 6000 : 1900);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        // Top-centred, not bottom: the copy button is a sticky bottom bar, and a
        // success toast that lands on top of the control that triggered it hides
        // the thing the user is looking at. The header's middle is empty.
        className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              className={
                "flex animate-toast-in items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-xl shadow-black/15 backdrop-blur " +
                TONES[t.kind]
              }
            >
              <Icon size={15} strokeWidth={2.5} />
              {t.message}
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.run();
                    dismiss(t.id);
                  }}
                  className="press pointer-events-auto -mr-2 ml-1 rounded-full bg-accent px-3 py-0.5 text-xs font-semibold text-accent-ink hover:bg-accent/85"
                >
                  {t.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
