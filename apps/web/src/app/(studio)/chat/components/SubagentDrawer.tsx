"use client";

import { useEffect, useRef } from "react";
import { getAgentIcon } from "@/lib/agent-icons";
import type { SubagentInfo } from "@/hooks/useCommandRoom";

interface SubagentDrawerProps {
  subagent: SubagentInfo | null;
  onClose: () => void;
  onGotoParent: (sessionId: string) => void;
  onRequestStop: (subagent: SubagentInfo) => void;
  onPrioritize: (subagent: SubagentInfo) => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function SubagentDrawer({ subagent, onClose, onGotoParent, onRequestStop, onPrioritize }: SubagentDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 6G-6th: focus trap. While the drawer is open, Tab / Shift+Tab must
  // cycle within the panel — without this, a keyboard-only user tabs into
  // the page underneath and the modal becomes a phantom. The trap is
  // mounted only when `subagent` is non-null (the component returns null
  // otherwise), and we restore focus to the previously-focused element on
  // close so the trigger button isn't left in a "lost focus" state.
  useEffect(() => {
    if (!subagent) return;
    previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const panel = panelRef.current;
    if (!panel) return;

    // Focus the first focusable element inside the drawer. The close
    // button is the first interactive control in the header, which is a
    // sensible initial focus target for a modal.
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const first = focusables[0];
    first?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = panel!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (!panel!.contains(active)) {
        // Focus escaped the panel (e.g. via a screen-reader virtual cursor)
        // — pull it back to the first item.
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever opened the drawer. Use a microtask so
      // the close-state update doesn't clobber the focus call.
      const previous = previousFocusRef.current;
      if (previous && document.body.contains(previous)) {
        queueMicrotask(() => previous.focus());
      }
    };
  }, [subagent, onClose]);

  if (!subagent) return null;

  const icon = getAgentIcon(subagent.role);
  const label = subagent.role.replace(/-/g, " ").toUpperCase();
  const isDone = subagent.status === "completed";
  const isFailed = subagent.status === "failed";
  const isActive = subagent.status === "active";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${label} agent details`}
        className="fixed right-0 top-0 bottom-0 w-96 border-l-2 border-black bg-white z-50 flex flex-col shadow-[-8px_0_24px_rgba(0,0,0,0.15)]"
      >
        {/* Header */}
        <div className="shrink-0 border-b-2 border-black bg-[#ededfb] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 border-2 border-black flex items-center justify-center ${isActive ? "bg-[#0055FF] text-white" : isDone ? "bg-[#2ECC71] text-white" : "bg-[#df2b31] text-white"}`}>
              <span className="material-symbols-outlined text-lg" aria-hidden="true">{icon}</span>
            </div>
            <div>
              <div className="font-[var(--font-label)] text-sm font-bold uppercase">{label}</div>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 border border-black ${isActive ? "bg-[#0055FF] animate-pulse" : isDone ? "bg-[#2ECC71]" : "bg-[#df2b31]"}`} />
                <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#434656]">
                  {isActive ? "Running" : isDone ? "Completed" : "Failed"}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 border-2 border-black flex items-center justify-center hover:bg-[#df2b31] hover:text-white transition-colors"
            title="Close"
            aria-label="Close drawer"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Task */}
          <section>
            <div className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1.5">Task</div>
            <div className="border-2 border-black bg-white p-3">
              <p className="font-[var(--font-terminal)] text-xs leading-relaxed">{subagent.task}</p>
            </div>
          </section>

          {/* Output (if completed) */}
          {isDone && subagent.output && (
            <section>
              <div className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1.5">Output</div>
              <div className="border-2 border-black bg-[#f8f8ff] p-3 max-h-64 overflow-y-auto">
                <pre className="font-[var(--font-terminal)] text-[11px] leading-relaxed whitespace-pre-wrap">{subagent.output}</pre>
              </div>
            </section>
          )}

          {/* Error (if failed) */}
          {isFailed && subagent.error && (
            <section>
              <div className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1.5">Error</div>
              <div className="border-2 border-black bg-[#f5e7e7] p-3">
                <p className="font-[var(--font-terminal)] text-[11px] text-[#df2b31] leading-relaxed">{subagent.error}</p>
              </div>
            </section>
          )}

          {/* Active placeholder */}
          {isActive && (
            <section>
              <div className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1.5">Progress</div>
              <div className="border-2 border-black bg-white p-4 flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-4 border-black border-t-[#0055FF] animate-spin" aria-hidden="true" />
                <span className="font-[var(--font-terminal)] text-xs uppercase text-[#737688]">Agent is working...</span>
              </div>
            </section>
          )}

          {/* Meta */}
          <section>
            <div className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1.5">Details</div>
            <div className="border-2 border-black bg-white divide-y divide-black">
              <div className="flex justify-between px-3 py-2">
                <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#737688]">Ticket</span>
                <span className="font-[var(--font-terminal)] text-[10px]">
                  {/* 29-M-subagent-ticketid-guard: previous shape
                      called `subagent.ticketId.replace(...)` without
                      a nullish check. A subagent record that hasn't
                      yet been linked to a ticket (e.g. mid-spawn
                      before the quest-bridge createQuestTicket call
                      lands) would render the literal string
                      "undefined" in the UI. Defensive guard. */}
                  {subagent.ticketId ? subagent.ticketId.replace("ticket-", "#") : "—"}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#737688]">Parent Session</span>
                <span className="font-[var(--font-terminal)] text-[10px] truncate max-w-[140px]">{subagent.parentSessionId}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#737688]">Spawned</span>
                <span className="font-[var(--font-terminal)] text-[10px]">{new Date(subagent.spawnedAt).toLocaleTimeString()}</span>
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t-2 border-black bg-[#f3f2ff] p-4">
          <div className="grid grid-cols-1 gap-2">
            {isActive && (
              <>
                <button
                  onClick={() => onPrioritize(subagent)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-black bg-[#fff7eb] hover:bg-[#FF9500] transition-colors py-2 font-[var(--font-label)] text-xs font-bold uppercase"
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">priority_high</span>
                  Prioritize This Work
                </button>
                <button
                  onClick={() => onRequestStop(subagent)}
                  className="w-full flex items-center justify-center gap-2 border-2 border-black bg-white hover:bg-black hover:text-white transition-colors py-2 font-[var(--font-label)] text-xs font-bold uppercase"
                >
                  <span className="material-symbols-outlined text-sm" aria-hidden="true">pause_circle</span>
                  Ask Producer To Stop
                </button>
              </>
            )}
            <button
              onClick={() => {
                onGotoParent(subagent.parentSessionId);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-2 border-2 border-black bg-white hover:bg-[#0055FF] hover:text-white transition-colors py-2 font-[var(--font-label)] text-xs font-bold uppercase"
            >
              <span className="material-symbols-outlined text-sm" aria-hidden="true">arrow_back</span>
              Go to Parent Session
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
