/**
 * Client-side timing constants. Centralised so a single tweak
 * retunes every polling interval, debounce, and toast duration
 * in the app, and so reviewers can audit all the "magic
 * numbers" in one place.
 *
 * Backend-side timing lives in apps/api/src/config.ts.
 */

// WebSocket reconnect delay after a drop. 1s is fast enough to
// feel instant on a flaky local network, slow enough to not
// hammer the server when it's down.
export const WS_RECONNECT_DELAY_MS = 1_000;

// WebSocket server ping interval. The server expects a ping
// every 25s and drops the socket after 30s of silence.
export const WS_PING_INTERVAL_MS = 25_000;

// Debounce window for refetching entity lists (tickets, assets,
// dashboard, settings) after a stream of WS events. 300ms
// collapses a burst (e.g. dragging a ticket across all four
// columns emits 4 move events) into a single refetch.
export const WS_REFETCH_DEBOUNCE_MS = 300;

// Polling intervals for backend status probes.
export const MCP_HEALTH_POLL_MS = 10_000;
export const DASHBOARD_SERVER_STATUS_POLL_MS = 60_000;

// Auto-dismiss duration for success toasts. Failure toasts
// stay until the user dismisses them.
export const SUCCESS_TOAST_DURATION_MS = 3_000;
export const NOTIFICATION_TOAST_DURATION_MS = 5_000;
