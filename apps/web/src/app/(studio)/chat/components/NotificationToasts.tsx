"use client";

import { useEffect, useRef } from "react";
import { NOTIFICATION_TOAST_DURATION_MS } from "@/lib/timing";
import type { ActivityItem } from "@/hooks/useCommandRoom";

interface NotificationToastsProps {
  toasts: ActivityItem[];
  onDismiss: (id: string) => void;
}

const KIND_STYLES: Record<ActivityItem["kind"], { border: string; bg: string; icon: string }> = {
  spawned: { border: "border-[#0055FF]", bg: "bg-[#eef4ff]", icon: "play_arrow" },
  completed: { border: "border-[#2ECC71]", bg: "bg-[#effaf3]", icon: "check_circle" },
  failed: { border: "border-[#df2b31]", bg: "bg-[#fff1f1]", icon: "error" },
  status: { border: "border-black", bg: "bg-white", icon: "notes" },
};

export default function NotificationToasts({ toasts, onDismiss }: NotificationToastsProps) {
  // 15-H-toast-timer-reset: previous useEffect re-created ALL timers
  // every time `toasts` changed (e.g. a new toast arriving). The
  // cleanup cleared every pending timer, then the effect re-armed
  // a full-duration timer for each existing toast. A toast that had
  // been on screen for 4.9s of its 5s window would jump back to
  // 5s when a fresh toast arrived. Track which toasts we've already
  // scheduled so the effect only arms timers for NEW toasts.
  const scheduledRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const liveIds = new Set(toasts.map((t) => t.id));
    // Schedule dismiss for any toast we haven't seen before.
    for (const toast of toasts) {
      if (scheduledRef.current.has(toast.id)) continue;
      scheduledRef.current.add(toast.id);
      const timer = window.setTimeout(() => {
        onDismiss(toast.id);
        // Don't remove from scheduledRef here — the dismiss callback
        // may update state asynchronously, and the effect will run
        // again with the new toasts list. The scheduledRef is
        // garbage-collected when the toast is no longer in `toasts`.
      }, NOTIFICATION_TOAST_DURATION_MS);
      timersRef.current.set(toast.id, timer);
    }
    // Clear timers for toasts that were dismissed externally (e.g. user
    // clicked the X button before the 5s elapsed).
    for (const [id, timer] of timersRef.current) {
      if (!liveIds.has(id)) {
        window.clearTimeout(timer);
        timersRef.current.delete(id);
        scheduledRef.current.delete(id);
      }
    }
    return () => {
      // On unmount only — clear all timers. The live-id sweep above
      // handles per-toast cleanup during the component's lifetime.
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }
      timersRef.current.clear();
      scheduledRef.current.clear();
    };
  }, [toasts, onDismiss]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-24 right-5 z-[80] flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]">
      {toasts.map((toast) => {
        const style = KIND_STYLES[toast.kind];
        return (
          <div
            key={toast.id}
            className={`border-2 border-black ${style.border} ${style.bg} shadow-[4px_4px_0_0_rgba(0,0,0,1)]`}
          >
            <div className="px-3 py-2 flex items-start gap-2">
              <span className="material-symbols-outlined text-sm mt-0.5">{style.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-[var(--font-label)] text-[10px] font-bold uppercase">
                  {toast.title}
                </div>
                <div className="font-[var(--font-terminal)] text-[10px] text-[#434656] mt-1 break-words line-clamp-3">
                  {toast.detail}
                </div>
              </div>
              <button
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="w-6 h-6 border border-black bg-white hover:bg-black hover:text-white transition-colors flex items-center justify-center shrink-0"
                title="Dismiss"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
