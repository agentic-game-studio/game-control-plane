"use client";

import type { Project } from "@game-studio/types";

interface DeleteConfirmModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmModal({
  project,
  isOpen,
  onClose,
  onConfirm,
}: DeleteConfirmModalProps) {
  if (!isOpen || !project) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white border-2 border-black shadow-[8px_8px_0_0_rgba(0,0,0,1)] w-[90vw] max-w-[520px] min-w-[300px] p-4 sm:p-6 m-auto">
        {/* Header */}
        <div className="flex justify-between items-center border-b-2 border-black pb-3 sm:pb-4 mb-3 sm:mb-4">
          <h2 className="font-[var(--font-headline)] text-lg sm:text-xl font-bold uppercase text-[#c13301]">
            REMOVE FROM DASHBOARD
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 border-2 border-black flex items-center justify-center hover:bg-black hover:text-white transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="mb-6 flex flex-col gap-4">
          <p className="font-[var(--font-terminal)] text-sm text-[#434656]">
            Remove this project from the dashboard?
          </p>
          <div className="border-2 border-[#c13301] bg-[#c13301]/10 p-3 flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
              <span className="material-symbols-outlined">{project.icon}</span>
            </div>
            <div>
              <div className="font-[var(--font-terminal)] text-sm font-bold uppercase">
                {project.name}
              </div>
              <div className="font-[var(--font-terminal)] text-xs text-[#737688]">
                {project.description || "No description"}
              </div>
            </div>
          </div>
          <p className="font-[var(--font-terminal)] text-xs text-[#c13301]">
            The project will be removed from the dashboard and any active sessions will be closed. Workspace files will NOT be deleted.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            onClick={onClose}
            className="flex-1 border-2 border-black bg-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-surface-container transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 border-2 border-[#c13301] bg-[#c13301] text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#972500] hover:border-[#972500] transition-colors"
          >
            REMOVE
          </button>
        </div>
      </div>
    </div>
  );
}
