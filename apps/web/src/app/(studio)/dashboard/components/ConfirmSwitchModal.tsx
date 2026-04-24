"use client";

import { Modal } from "@/components/Modal";
import type { Project } from "@game-studio/types";

interface ConfirmSwitchModalProps {
  project: Project | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmSwitchModal({
  project,
  isOpen,
  onClose,
  onConfirm,
}: ConfirmSwitchModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="SWITCH DIRECTORY"
      onSubmit={onConfirm}
      submitLabel="CONFIRM"
    >
      <div className="flex flex-col gap-4">
        {project ? (
          <>
            <p className="font-[var(--font-terminal)] text-sm text-[#434656]">
              Switch current directory to:
            </p>
            <div className="border-2 border-black bg-[#f3f2ff] p-4 flex items-center gap-3">
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
            <p className="font-[var(--font-terminal)] text-xs text-[#737688]">
              This will affect Comms, Quests, Assets, and Wiki contexts.
            </p>
          </>
        ) : (
          <p className="font-[var(--font-terminal)] text-sm text-[#737688]">
            No project selected.
          </p>
        )}
      </div>
    </Modal>
  );
}
