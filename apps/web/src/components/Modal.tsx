"use client";

import { useEffect, useRef } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel = "Submit",
  submitDisabled = false,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Remember the element that had focus before opening so we can restore it
    // on close — without this, focus is lost to <body> and keyboard users
    // lose their place in the page.
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog so Tab/Shift+Tab cycles through its controls
    // and screen readers announce it as a modal.
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    // Trap focus inside the dialog. If Tab would move focus past the last
    // element, wrap it back to the first; same for Shift+Tab on the first.
    // Also close on Escape (Q9-5) — keyboard users expect this convention
    // and the absence of it forces a mouse trip to the close button.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus on unmount/close.
      previouslyFocusedRef.current?.focus?.();
      // 29-L-modal-prev-focus-reset: clear the ref after restoring.
      // If the previously-focused element is later detached (e.g. it
      // was a button inside a list item that just got removed), the
      // next modal open would still try to refocus the detached node
      // — a silent no-op. Reset to null so the next capture starts
      // fresh from document.activeElement.
      previouslyFocusedRef.current = null;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-auto">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="relative bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] w-full max-w-2xl p-6 m-auto"
      >
        <div className="flex justify-between items-center border-b-2 border-black pb-4 mb-4">
          <h2 id="modal-title" className="font-[var(--font-headline)] text-2xl font-bold uppercase">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="w-8 h-8 border-2 border-black flex items-center justify-center hover:bg-black hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">close</span>
          </button>
        </div>
        <div className="mb-6">{children}</div>
        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 border-2 border-black bg-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          {onSubmit && (
            <button
              onClick={onSubmit}
              disabled={submitDisabled}
              className="flex-1 border-2 border-black bg-primary text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black retro-press disabled:opacity-50 transition-colors"
            >
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface FormFieldProps {
  label: string;
  children: React.ReactNode;
}

export function FormField({ label, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</label>
      {children}
    </div>
  );
}
