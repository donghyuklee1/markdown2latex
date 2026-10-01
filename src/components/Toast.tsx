"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type Push = (message: string, kind?: ToastKind) => void;

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

const TONES: Record<ToastKind, string> = {
  success: "border-accent/40 bg-accent/10 text-accent",
  error: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  info: "border-ink-600 bg-ink-800 text-slate-300",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const push = useCallback<Push>((message, kind = "success") => {
    const id = nextId.current++;
    // Keep at most three on screen; a rapid Cmd+Enter burst should not stack up.
    setToasts((prev) => [...prev.slice(-2), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 1900);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        // Top-centred, not bottom: the copy button is a sticky bottom bar, and a
        // success toast that lands on top of the control that triggered it hides
        // the thing the user is looking at. The header's middle is empty.
        className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.kind];
          return (
            <div
              key={t.id}
              className={
                "flex animate-toast-in items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-xl shadow-black/40 backdrop-blur " +
                TONES[t.kind]
              }
            >
              <Icon size={15} strokeWidth={2.5} />
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
