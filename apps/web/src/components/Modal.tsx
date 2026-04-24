"use client";

import { useState } from "react";

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] w-full max-w-md p-6">
        <div className="flex justify-between items-center border-b-2 border-black pb-4 mb-4">
          <h2 className="font-[var(--font-headline)] text-2xl font-bold uppercase">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 border-2 border-black flex items-center justify-center hover:bg-black hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
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
