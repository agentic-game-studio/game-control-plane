"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((toast) =>
      window.setTimeout(() => onDismiss(toast.id), NOTIFICATION_TOAST_DURATION_MS)
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
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
