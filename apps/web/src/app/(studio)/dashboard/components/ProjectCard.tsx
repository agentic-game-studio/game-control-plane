"use client";

import type { Project, ProjectEngine } from "@game-studio/types";

interface ProjectCardProps {
  project: Project;
  isSelected?: boolean;
  onClick?: () => void;
}

const ENGINE_COLORS: Record<ProjectEngine, string> = {
  unity: "bg-[#222c37]",
  unreal: "bg-[#0e1128]",
  godot: "bg-[#478cbf]",
  phaser: "bg-[#c90000]",
  threejs: "bg-[#000000]",
};

export function ProjectCard({ project, isSelected, onClick }: ProjectCardProps) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`border-2 p-4 flex flex-col gap-3 transition-all ${
        isSelected
          ? "border-[#0055FF] bg-[#f3f2ff] shadow-[4px_4px_0_0_#0055FF]"
          : "border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)]"
      } ${onClick ? "cursor-pointer" : ""}`}
    >
      {/* Header: Icon + Name + Engine Tag */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white shrink-0">
          <span className="material-symbols-outlined">{project.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-[var(--font-terminal)] text-sm font-bold uppercase truncate">
              {project.name}
            </h3>
            {project.engine && (
              <span
                className={`font-[var(--font-terminal)] text-[10px] font-bold uppercase text-white px-2 py-0.5 ${ENGINE_COLORS[project.engine]}`}
              >
                {project.engine.toUpperCase()}
              </span>
            )}
          </div>
          <p className="font-[var(--font-terminal)] text-xs text-[#737688] line-clamp-2 mt-1">
            {project.description || "No description"}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-auto">
        <div className="flex justify-between items-center mb-1">
          <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#737688] tracking-wider">
            Progress
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] font-bold">
            {project.progress}%
          </span>
        </div>
        <div className="w-full h-3 border-2 border-black bg-[#f3f2ff] relative overflow-hidden">
          <div
            className="h-full bg-black stripe-pattern transition-all duration-300"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* Footer: Workspace path if set */}
      {project.workspacePath && (
        <div className="flex items-center gap-1 text-[#737688]">
          <span className="material-symbols-outlined text-xs">folder</span>
          <span className="font-[var(--font-terminal)] text-[10px] truncate">
            {project.workspacePath}
          </span>
        </div>
      )}
    </div>
  );
}
