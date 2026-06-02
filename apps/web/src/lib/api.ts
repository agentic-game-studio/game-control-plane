const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
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

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
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
      throw new Error(`API request timed out after ${DEFAULT_TIMEOUT_MS}ms (${path})`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
