"use client";
import { createLogger } from "../lib/logger";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
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
 * Concurrent calls are queued (Q9-7): if two components call confirm()
 * back-to-back, the second is shown only after the first resolves.
 * Previously the second call's `setCurrent` overwrote `current`,
 * stranding the first call's promise (it never resolved).
 *
 * Usage:
 *   const { confirm, alert } = useDialog();
 *   if (await confirm("Delete this session?")) { ... }
 */
const logger = createLogger("useDialog");

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
  // Pending dialogs. Each `confirm()`/`alert()` call pushes here and the
  // close handler drains FIFO. A ref (not state) so the enqueue path
  // doesn't have to wait for a re-render to see the latest queue.
  const queueRef = useRef<DialogRequest[]>([]);
  // 12-C1: mirror `current` in a ref so `close` doesn't rely on a
  // stale-closure read of `current`. Two failure modes the old code
  // had:
  //   1) Double-click on OK fires `close` twice with the same captured
  //      `current` — the second call would `shift()` the queue again
  //      and skip the next dialog entirely.
  //   2) A close from the previous render (still bound to the old
  //      `current`) could resolve the wrong promise if the user
  //      interacts mid-render.
  // The ref makes `close` deps-free and idempotent.
  const currentRef = useRef<DialogRequest | null>(null);

  const enqueue = useCallback((req: DialogRequest) => {
    // Use a functional updater so two synchronous enqueues both observe
    // the latest `current` — without this, two calls in the same tick
    // would both see `current === null` and the second would overwrite
    // the first.
    setCurrent((prev) => {
      if (prev) {
        queueRef.current.push(req);
        return prev;
      }
      currentRef.current = req;
      return req;
    });
  }, []);

  const confirm = useCallback((message: string) =>
    new Promise<boolean>((resolve) => {
      enqueue({ kind: "confirm", message, resolve });
    }), [enqueue]);

  const alert = useCallback((message: string) =>
    new Promise<void>((resolve) => {
      enqueue({ kind: "alert", message, resolve: () => resolve() });
    }), [enqueue]);

  const close = useCallback((value: boolean) => {
    const active = currentRef.current;
    if (!active) return; // idempotent: ignore double-click / backdrop while empty
    currentRef.current = null;
    active.resolve(value);
    // Drain the queue: if anything is waiting, show it next; otherwise
    // clear `current` so the dialog unmounts.
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  }, []);

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
    //
    // 10-L6: guard window/document before calling the natives. A
    // server-render that reaches this branch (e.g. a stray useDialog
    // call from a component used in a server component, or a test
    // harness without jsdom) would throw `window is not defined`.
    // Also: in the absence of a real dialog, the user has no way to
    // recover from a missing-provider — log so the bug surfaces in
    // dev. Default `confirm` to false (Cancel) so a missing-provider
    // page is safe-by-default for destructive operations.
    const nativeConfirm = (msg: string): boolean => {
      if (typeof window === "undefined") {
        logger.warn("useDialog: no provider in scope; defaulting confirm to false");
        return false;
      }
      return window.confirm(msg);
    };
    const nativeAlert = (msg: string): void => {
      if (typeof window === "undefined") {
        logger.warn("useDialog: no provider in scope; alert suppressed");
        return;
      }
      window.alert(msg);
    };
    return {
      confirm: async (message: string) => nativeConfirm(message),
      alert: async (message: string) => nativeAlert(message),
    };
  }
  return ctx;
}
