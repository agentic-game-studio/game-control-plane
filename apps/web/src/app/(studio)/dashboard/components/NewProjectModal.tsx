"use client";

import { useState, useCallback } from "react";
import { Modal, FormField } from "@/components/Modal";
import type { ProjectIcon, CreateProjectRequest } from "@game-studio/types";
import { apiFetch } from "@/lib/api";
import { DirectoryBrowser } from "./DirectoryBrowser";

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

interface PathValidation {
  valid: boolean;
  resolved: string;
  exists: boolean;
  isDirectory: boolean;
  error?: string;
}

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
  const [pathValidation, setPathValidation] = useState<PathValidation | null>(null);
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);

  const validatePath = useCallback(async (path: string) => {
    if (!path.trim()) {
      setPathValidation(null);
      return;
    }
    setValidating(true);
    try {
      const result = await apiFetch<{ success: boolean; data: PathValidation }>(
        "/api/dashboard/validate-path",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path.trim() }),
        }
      );
      setPathValidation(result.data);
    } catch {
      setPathValidation(null);
    } finally {
      setValidating(false);
    }
  }, []);

  const handlePathBlur = useCallback(() => {
    if (workspacePath) {
      validatePath(workspacePath);
    }
  }, [workspacePath, validatePath]);

  const handlePathChange = useCallback((value: string) => {
    setWorkspacePath(value || null);
    setPathValidation(null);
    setSubmitError(null);
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

    // Validate absolute path before submit
    if (workspacePath && workspacePath.startsWith("/")) {
      if (!pathValidation) {
        await validatePath(workspacePath);
      }
      if (pathValidation && !pathValidation.valid) {
        setSubmitError(pathValidation.error ?? "Invalid workspace path");
        return;
      }
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        workspacePath,
        engine: undefined,
      });
      // Reset form
      setName("");
      setDescription("");
      setIcon("folder");
      setWorkspacePath(null);
      setPathValidation(null);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }, [name, description, icon, workspacePath, pathValidation, validatePath, onSubmit, onClose]);

  const handleClose = useCallback(() => {
    setSubmitError(null);
    setPathValidation(null);
    onClose();
  }, [onClose]);

  return (
    <>
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

        {/* Workspace Directory */}
        <FormField label="Workspace Directory">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={workspacePath ?? ""}
                onChange={(e) => handlePathChange(e.target.value)}
                onBlur={handlePathBlur}
                className="flex-1 border-2 border-black bg-[#faf8ff] p-2 font-[var(--font-mono)] text-sm focus:outline-none focus:bg-white"
                placeholder="/Users/you/my-game or my-game (relative)"
              />
              <button
                type="button"
                onClick={() => setBrowserOpen(true)}
                className="shrink-0 border-2 border-black bg-[#f3f2ff] px-3 py-2 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
              >
                BROWSE
              </button>
              {workspacePath && (
                <button
                  type="button"
                  onClick={() => workspacePath && validatePath(workspacePath)}
                  disabled={validating}
                  className="shrink-0 border-2 border-black bg-[#f3f2ff] px-3 py-2 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black hover:text-white transition-colors disabled:opacity-50"
                >
                  {validating ? "..." : "CHECK"}
                </button>
              )}
            </div>
            {/* Path validation feedback */}
            {pathValidation && workspacePath && (
              <div className={`flex items-center gap-2 px-2 py-1 border ${
                pathValidation.valid
                  ? "border-[#2ECC71] bg-[#2ECC71]/10"
                  : "border-[#df2b31] bg-[#df2b31]/10"
              }`}>
                <span className={`material-symbols-outlined text-sm ${
                  pathValidation.valid ? "text-[#2ECC71]" : "text-[#df2b31]"
                }`}>
                  {pathValidation.valid ? "check_circle" : "cancel"}
                </span>
                <span className={`font-[var(--font-terminal)] text-[10px] ${
                  pathValidation.valid ? "text-[#2ECC71]" : "text-[#df2b31]"
                }`}>
                  {pathValidation.valid
                    ? pathValidation.resolved
                    : pathValidation.error ?? "Invalid path"}
                </span>
              </div>
            )}
            <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
              On the hosted demo, Browse shows the Railway server workspace. Use a relative name, or use CLOUD_DEMO from the dashboard.
            </span>
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

      <DirectoryBrowser
        isOpen={browserOpen}
        onClose={() => setBrowserOpen(false)}
        onSelect={(selectedPath) => {
          handlePathChange(selectedPath);
          validatePath(selectedPath);
        }}
        initialPath={workspacePath?.startsWith("/") ? workspacePath : undefined}
      />
    </>
  );
}
