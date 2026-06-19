/**
 * Returns a stable callback that yields `true` while the
 * component is mounted. Use it to gate setState calls inside
 * async work (especially WebSocket onmessage handlers and
 * user-triggered fetches) so a stale callback from a previous
 * route/component doesn't trigger React's "state update on
 * unmounted component" warning.
 *
 *   const isMounted = useIsMounted();
 *   const onEvent = useCallback((e) => {
 *     void fetchSomething().then((data) => {
 *       if (isMounted()) setState(data);
 *     });
 *   }, [isMounted]);
 *
 * Most hooks now use the AbortController pattern in
 * useAbortableEffect for effect-driven fetches, but this
 * helper is still useful for event-driven fetches (WS
 * callbacks, user clicks fired mid-flight).
 */
"use client";
import { useCallback, useEffect, useRef } from "react";

export function useIsMounted(): () => boolean {
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return useCallback(() => mountedRef.current, []);
}
