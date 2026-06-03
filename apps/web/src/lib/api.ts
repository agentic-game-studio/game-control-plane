export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

// 13-M-apiFetch: bound request time with AbortController. Without
// this, a hung backend (or a connection that established the TCP
// socket but never returned a response) leaves the React hook
// awaiting `fetch` forever — the spinner never resolves, the user
// can't navigate away from the page, and the hook never enters its
// error branch where it could show a retry. 30s matches the slow
// `/api/autonomous/start` budget and is generous for the fast
// CRUD endpoints (settings, tickets, gates) that should finish
// in <1s.
const DEFAULT_TIMEOUT_MS = 30_000;

// 14-M-retry: retry transient network failures (status 502/503/504,
// fetch rejection, and the timeout we throw ourselves). Skip 4xx —
// those are user errors and retrying would multiply the side
// effect (e.g. a POST that returned 400 will likely 400 again).
// Backoff 250ms, 750ms, 2.25s — short enough to feel instant for a
// blip, capped so a downed backend doesn't block the UI for 30s.
const RETRYABLE_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [250, 750, 2_250];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  // 14-FH10-caller-abort: if the caller passed their own
  // AbortSignal (typical pattern in useEffect cleanup so an
  // unmount cancels the in-flight fetch), combine it with our
  // timeout controller. EITHER signal aborting cancels the
  // request, so callers can compose their own unmount-cleanup
  // signal with our 30s safety net.
  const callerSignal = options?.signal;
  // 17-H3: only retry safe methods. POST/PATCH/DELETE may have
  // side effects (ticket create, project delete, etc.) and the
  // backend doesn't honor an Idempotency-Key, so retrying a 502
  // from a POST re-fires the original write and produces duplicates.
  // GET/HEAD/OPTIONS are read-only and safe to retry.
  const method = (options?.method ?? "GET").toUpperCase();
  const isRetryable = method === "GET" || method === "HEAD" || method === "OPTIONS";
  let lastError: unknown = undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          ...options?.headers,
        },
      });

      if (RETRYABLE_STATUSES.has(res.status) && isRetryable && attempt < MAX_RETRIES) {
        // Drain the body so the connection can be reused by the
        // browser's connection pool.
        try { await res.text(); } catch { /* ignore */ }
        await sleep(RETRY_DELAYS_MS[attempt], controller.signal);
        continue;
      }

      if (!res.ok) {
        let message = `API error ${res.status}`;
        try {
          const body = await res.json();
          message = body.error ?? body.message ?? message;
        } catch {
          // Non-JSON response — use status text
          message = res.statusText || message;
        }
        throw new Error(message);
      }

      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "API error");
      return json.data as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Distinguish caller-initiated abort (unmount, deps change)
        // from timeout so the caller can ignore the former silently.
        if (callerSignal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        // Our own timeout — retry if we have budget and method is safe.
        if (isRetryable && attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAYS_MS[attempt], controller.signal);
          continue;
        }
        throw new Error(`API request timed out after ${DEFAULT_TIMEOUT_MS}ms (${path})`);
      }
      // Network-level failure (fetch rejected). Retry only safe methods.
      if (err instanceof TypeError && isRetryable && attempt < MAX_RETRIES) {
        lastError = err;
        await sleep(RETRY_DELAYS_MS[attempt], controller.signal);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      if (callerSignal) {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    }
  }
  // All retries exhausted on a network error.
  throw lastError instanceof Error ? lastError : new Error(`API request failed after ${MAX_RETRIES} retries (${path})`);
}
