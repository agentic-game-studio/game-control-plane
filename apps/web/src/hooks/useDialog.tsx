"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

/**
 * Promise-based dialog API.
 *
 * Browser `alert()` and `confirm()` are blocking, ignore our design
 * system, and aren't styleable. This hook wraps a tiny context that
 * renders a single accessible confirm dialog at the app root and
 * returns a `confirm(message)` / `alert(message)` pair of async
 * functions. Components call them like the native versions, but the
 * UI is consistent with the rest of the app and respects focus +
 * keyboard interaction.
 *
 * Usage:
 *   const { confirm, alert } = useDialog();
 *   if (await confirm("Delete this session?")) { ... }
 */
interface DialogRequest {
  kind: "alert" | "confirm";
  message: string;
  resolve: (value: boolean) => void;
}

interface DialogContextValue {
  confirm: (message: string) => Promise<boolean>;
  alert: (message: string) => Promise<void>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<DialogRequest | null>(null);

  const confirm = useCallback((message: string) =>
    new Promise<boolean>((resolve) => {
      setCurrent({ kind: "confirm", message, resolve });
    }), []);

  const alert = useCallback((message: string) =>
    new Promise<void>((resolve) => {
      setCurrent({ kind: "alert", message, resolve: () => resolve() });
    }), []);

  const close = useCallback((value: boolean) => {
    if (current) current.resolve(value);
    setCurrent(null);
  }, [current]);

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {current && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-message"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => close(false)}
            aria-hidden="true"
          />
          <div className="relative bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] w-full max-w-md p-6 m-auto">
            <p id="dialog-message" className="mb-6 text-sm whitespace-pre-wrap">
              {current.message}
            </p>
            <div className="flex gap-4">
              {current.kind === "confirm" && (
                <button
                  onClick={() => close(false)}
                  // For confirms, autoFocus the Cancel button so a stray
                  // Enter press doesn't accidentally confirm a destructive
                  // action (delete, stop, reset). For alerts, only OK is
                  // rendered, so it gets the focus.
                  autoFocus
                  className="flex-1 border-2 border-black bg-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={() => close(true)}
                autoFocus={current.kind === "alert"}
                className="flex-1 border-2 border-black bg-primary text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black retro-press transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) {
    // Components calling useDialog outside a DialogProvider fall back
    // to the native browser dialogs so the page still works (e.g. in
    // storybook or a route that didn't wire the provider).
    return {
      confirm: async (message: string) => window.confirm(message),
      alert: async (message: string) => window.alert(message),
    };
  }
  return ctx;
}
