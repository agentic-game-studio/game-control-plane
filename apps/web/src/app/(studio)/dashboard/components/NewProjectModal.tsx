"use client";

import { useState, useCallback } from "react";
import { Modal, FormField } from "@/components/Modal";
import type { ProjectIcon, CreateProjectRequest } from "@game-studio/types";

const PROJECT_ICONS: ProjectIcon[] = [
  "folder",
  "sports_esports",
  "code",
  "brush",
  "music_note",
  "map",
  "psychology",
  "bug_report",
  "description",
  "stadia_controller",
  "view_in_ar",
  "animation",
];

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (request: CreateProjectRequest) => Promise<unknown>;
}

export function NewProjectModal({ isOpen, onClose, onSubmit }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<ProjectIcon>("folder");
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handlePickFolder = useCallback(async () => {
    setPickerError(null);
    const w = window as typeof window & { showDirectoryPicker?: () => Promise<{ name: string }> };
    if (typeof window === "undefined" || typeof w.showDirectoryPicker !== "function") {
      setPickerError("Browser does not support folder picker. Use text input below.");
      return;
    }
    try {
      const handle = await w.showDirectoryPicker();
      setWorkspacePath(handle.name);
    } catch {
      // User cancelled or denied permission
      setPickerError("Folder selection cancelled. Use text input below.");
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) {
      setSubmitError("Project name is required");
      return;
    }
    if (name.trim().length > 100) {
      setSubmitError("Project name must be 100 characters or less");
      return;
    }
    if (description.length > 500) {
      setSubmitError("Description must be 500 characters or less");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        workspacePath,
        engine: undefined, // null by default on backend
      });
      // Reset form
      setName("");
      setDescription("");
      setIcon("folder");
      setWorkspacePath(null);
      setPickerError(null);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }, [name, description, icon, workspacePath, onSubmit, onClose]);

  const handleClose = useCallback(() => {
    setSubmitError(null);
    setPickerError(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="NEW PROJECT"
      onSubmit={handleSubmit}
      submitLabel={submitting ? "CREATING..." : "CREATE"}
      submitDisabled={submitting}
    >
      <div className="flex flex-col gap-4">
        {/* Project Name */}
        <FormField label="Project Name *">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            className="w-full border-2 border-black bg-[#faf8ff] p-2 font-[var(--font-terminal)] text-sm focus:outline-none focus:bg-white"
            placeholder="Enter project name..."
          />
        </FormField>

        {/* Description */}
        <FormField label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full border-2 border-black bg-[#faf8ff] p-2 font-[var(--font-terminal)] text-sm focus:outline-none focus:bg-white resize-none"
            placeholder="Enter project description..."
          />
        </FormField>

        {/* Icon Picker */}
        <FormField label="Icon">
          <div className="grid grid-cols-6 gap-2">
            {PROJECT_ICONS.map((iconName) => (
              <button
                key={iconName}
                type="button"
                onClick={() => setIcon(iconName)}
                className={`w-10 h-10 border-2 flex items-center justify-center transition-colors ${
                  icon === iconName
                    ? "border-black bg-black text-white"
                    : "border-[#e1e1ef] bg-[#faf8ff] text-[#737688] hover:border-black hover:text-black"
                }`}
                title={iconName}
              >
                <span className="material-symbols-outlined text-lg">{iconName}</span>
              </button>
            ))}
          </div>
        </FormField>

        {/* Folder Picker */}
        <FormField label="Workspace Directory">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePickFolder}
                className="border-2 border-black bg-[#f3f2ff] px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-black hover:text-white transition-colors"
              >
                Select Folder
              </button>
              {workspacePath ? (
                <span className="font-[var(--font-terminal)] text-xs text-[#434656] truncate">
                  {workspacePath}
                </span>
              ) : (
                <span className="font-[var(--font-terminal)] text-xs text-[#737688]">
                  No directory selected
                </span>
              )}
            </div>
            {pickerError && (
              <span className="font-[var(--font-terminal)] text-xs text-[#737688]">
                {pickerError}
              </span>
            )}
            <input
              type="text"
              value={workspacePath ?? ""}
              onChange={(e) => setWorkspacePath(e.target.value || null)}
              className="w-full border-2 border-black bg-[#faf8ff] p-2 font-[var(--font-terminal)] text-sm focus:outline-none focus:bg-white"
              placeholder="Or enter directory path manually..."
            />
          </div>
        </FormField>

        {/* Error */}
        {submitError && (
          <div className="border-2 border-red-600 bg-red-50 p-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-red-600 text-sm">error</span>
            <span className="font-[var(--font-terminal)] text-xs text-red-600">
              {submitError}
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
