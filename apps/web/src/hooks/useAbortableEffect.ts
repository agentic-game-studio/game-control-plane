/**
 * Run an async effect with an AbortSignal that fires on unmount
 * (or when the deps change). The signal can be passed straight
 * through to apiFetch so the in-flight request is cancelled,
 * preventing:
 *   1) React's "state update on unmounted component" warning
 *      in StrictMode dev double-mount, and
 *   2) a stale fetch from the previous deps set overwriting the
 *      new fetch's data when the user navigates or switches
 *      projects quickly.
 *
 * The callback may be async. If it throws (other than the
 * AbortError the controller itself fires), the error is rethrown
 * so existing error boundaries see it. AbortErrors are swallowed
 * silently — they indicate the effect was cancelled, not that
 * the operation failed.
 */
"use client";
import { useEffect } from "react";

export function useAbortableEffect(
  effect: (signal: AbortSignal) => void | Promise<void>,
  deps: ReadonlyArray<unknown>,
): void {
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void Promise.resolve()
      .then(() => effect(controller.signal))
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Rethrow so the surrounding error boundary (or React's
        // unhandled-promise handler) surfaces real failures.
        throw err;
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
