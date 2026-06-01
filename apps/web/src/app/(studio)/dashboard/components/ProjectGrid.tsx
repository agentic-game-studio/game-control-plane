"use client";

import { useState } from "react";
import type { Project } from "@game-studio/types";
import { ProjectCard } from "./ProjectCard";
import { ConfirmSwitchModal } from "./ConfirmSwitchModal";
import { DeleteConfirmModal } from "./DeleteConfirmModal";

interface MCPStatus {
  status: "not_running" | "connected" | "disconnected";
  serverRunning?: boolean;
  godotConnected?: boolean;
  projectInfo?: { name: string; version: string };
  error?: string;
}

interface ProjectGridProps {
  projects: Project[];
  currentProject: Project | null;
  onSelectProject: (project: Project) => void;
  onNewProject: () => void;
  onDemoProject?: () => void;
  isCreatingDemo?: boolean;
  onDeleteProject?: (id: string) => void;
  mcpStatuses?: Record<string, MCPStatus>;
  onLaunchEditor?: (projectId: string) => void;
}

export function ProjectGrid({
  projects,
  currentProject,
  onSelectProject,
  onNewProject,
  onDemoProject,
  isCreatingDemo = false,
  onDeleteProject,
  mcpStatuses = {},
  onLaunchEditor,
}: ProjectGridProps) {
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const pendingDeleteProject = pendingDeleteId
    ? projects.find((p) => p.id === pendingDeleteId) ?? null
    : null;

  const handleCardClick = (project: Project) => {
    if (project.id === currentProject?.id) return;
    setPendingProject(project);
  };

  const handleConfirmSwitch = () => {
    if (pendingProject) {
      onSelectProject(pendingProject);
      setPendingProject(null);
    }
  };

  const handleConfirmDelete = () => {
    if (pendingDeleteId && onDeleteProject) {
      onDeleteProject(pendingDeleteId);
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Current Directory Panel */}
      <div className="border-2 border-black bg-black text-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="font-[var(--font-terminal)] text-xs uppercase tracking-wider mb-2 opacity-70">
          {`> CURRENT_DIRECTORY`}
        </div>
        {currentProject ? (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-white bg-white flex items-center justify-center text-black">
              <span className="material-symbols-outlined">{currentProject.icon}</span>
            </div>
            <div>
              <div className="font-[var(--font-terminal)] text-sm font-bold uppercase">
                {currentProject.name}
              </div>
              <div className="font-[var(--font-terminal)] text-xs opacity-70">
                {currentProject.description || "No description"}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-white/30 flex items-center justify-center text-white/30">
              <span className="material-symbols-outlined">folder_off</span>
            </div>
            <div className="font-[var(--font-terminal)] text-sm opacity-50">
              No directory selected
            </div>
          </div>
        )}
      </div>

      {/* Section Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="font-[var(--font-terminal)] text-xs font-bold uppercase tracking-wider">
            {`> ACTIVE_DIRECTORIES`}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {onDemoProject && (
            <button
              onClick={onDemoProject}
              disabled={isCreatingDemo}
              className="border-2 border-black bg-[#2ECC71] text-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase tracking-wider hover:bg-white disabled:bg-gray-300 disabled:cursor-not-allowed disabled:hover:bg-gray-300 transition-colors shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] disabled:shadow-[4px_4px_0_0_rgba(0,0,0,1)] disabled:translate-x-0 disabled:translate-y-0"
            >
              {isCreatingDemo ? "CREATING..." : "CLOUD_DEMO"}
            </button>
          )}
          <button
            onClick={onNewProject}
            className="border-2 border-black bg-black text-white px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase tracking-wider hover:bg-white hover:text-black transition-colors shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px]"
          >
            + NEW_PROJ
          </button>
        </div>
      </div>

      {/* Project Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={project}
            isSelected={project.id === currentProject?.id}
            onClick={() => handleCardClick(project)}
            onRequestDelete={onDeleteProject ? (id) => setPendingDeleteId(id) : undefined}
            mcpStatus={mcpStatuses[project.id]}
            onLaunchEditor={onLaunchEditor ? () => onLaunchEditor(project.id) : undefined}
          />
        ))}
        {/* Empty slot */}
        <button
          onClick={onNewProject}
          className="border-2 border-dashed border-[#737688] bg-[#faf8ff] p-4 flex flex-col items-center justify-center gap-2 min-h-[160px] hover:border-black hover:bg-[#f3f2ff] transition-colors"
        >
          <span className="material-symbols-outlined text-[#737688]">add</span>
          <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
            Add Project
          </span>
        </button>
      </div>

      {projects.length === 0 && (
        <div className="border-2 border-black bg-[#faf8ff] p-8 text-center">
          <span className="material-symbols-outlined text-[#737688] text-3xl mb-2 block">
            folder_open
          </span>
          <p className="font-[var(--font-terminal)] text-sm text-[#737688]">
            No active directories found.
          </p>
          <p className="font-[var(--font-terminal)] text-xs text-[#737688] mt-1">
            Use CLOUD_DEMO for an online judge-safe project, or create a new project.
          </p>
        </div>
      )}

      {/* Confirm Switch Modal */}
      <ConfirmSwitchModal
        project={pendingProject}
        isOpen={pendingProject !== null}
        onClose={() => setPendingProject(null)}
        onConfirm={handleConfirmSwitch}
      />

      {/* Delete Confirm Modal */}
      <DeleteConfirmModal
        project={pendingDeleteProject}
        isOpen={pendingDeleteId !== null}
        onClose={() => setPendingDeleteId(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
