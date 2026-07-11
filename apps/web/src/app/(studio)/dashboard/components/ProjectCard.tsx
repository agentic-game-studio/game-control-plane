"use client";

import type { Project, ProjectEngine } from "@game-studio/types";

interface MCPStatus {
  status: "not_running" | "connected" | "disconnected";
  serverRunning?: boolean;
  godotConnected?: boolean;
  projectInfo?: {
    name: string;
    version: string;
  };
  error?: string;
}

interface ProjectCardProps {
  project: Project;
  isSelected?: boolean;
  onClick?: () => void;
  onRequestDelete?: (id: string) => void;
  mcpStatus?: MCPStatus | null;
  onLaunchEditor?: () => void;
}

const ENGINE_COLORS: Record<ProjectEngine, string> = {
  unity: "bg-[#222c37]",
  unreal: "bg-[#0e1128]",
  godot: "bg-[#478cbf]",
  phaser: "bg-[#c90000]",
  threejs: "bg-[#000000]",
  babylon: "bg-[#bb464b]",
  bevy: "bg-[#232326]",
  playcanvas: "bg-[#f3714f]",
};

export function ProjectCard({ project, isSelected, onClick, onRequestDelete, mcpStatus, onLaunchEditor }: ProjectCardProps) {
  const isGodot = project.engine === "godot";

  // Godot MCP connection status indicator
  const getMCPIndicator = () => {
    if (!isGodot || !mcpStatus) return null;

    if (mcpStatus.status === "connected") {
      return (
        <div className="flex items-center gap-1 text-green-600" title={`Connected to ${mcpStatus.projectInfo?.name || "Godot project"}`}>
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="material-symbols-outlined text-xs">bolt</span>
        </div>
      );
    }

    if (mcpStatus.status === "disconnected") {
      return (
        <div className="flex items-center gap-1 text-red-500" title={mcpStatus.error || "Godot MCP disconnected"}>
          <span className="w-2 h-2 rounded-full bg-red-500" />
          <span className="material-symbols-outlined text-xs">warning</span>
          {onLaunchEditor && (
            <button
              onClick={(e) => { e.stopPropagation(); onLaunchEditor(); }}
              className="ml-1 font-[var(--font-label)] text-[9px] font-bold uppercase px-1.5 py-0.5 bg-black text-white hover:bg-red-600 transition-colors"
            >
              Launch
            </button>
          )}
        </div>
      );
    }

    // not_running
    return (
      <div className="flex items-center gap-1 text-yellow-500" title="Waiting for Godot editor to connect">
        <span className="w-2 h-2 rounded-full bg-yellow-500" />
        <span className="material-symbols-outlined text-xs">hourglass_top</span>
        {onLaunchEditor && (
          <button
            onClick={(e) => { e.stopPropagation(); onLaunchEditor(); }}
            className="ml-1 font-[var(--font-label)] text-[9px] font-bold uppercase px-1.5 py-0.5 bg-black text-white hover:bg-green-600 transition-colors"
          >
            Launch
          </button>
        )}
      </div>
    );
  };

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
      {/* Header: Icon + Name + Engine Tag + MCP Status */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white shrink-0">
          <span className="material-symbols-outlined">{project.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-[var(--font-terminal)] text-sm font-bold uppercase truncate">
              {project.name}
            </h3>
            <div className="flex items-center gap-2">
              {getMCPIndicator()}
              {project.engine && (
                <span
                  className={`font-[var(--font-terminal)] text-[10px] font-bold uppercase text-white px-2 py-0.5 ${ENGINE_COLORS[project.engine]}`}
                >
                  {project.engine.toUpperCase()}
                </span>
              )}
              {onRequestDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestDelete(project.id);
                  }}
                  className="w-6 h-6 border-2 border-black flex items-center justify-center hover:bg-[#c13301] hover:text-white hover:border-[#c13301] transition-colors"
                  title="Remove from dashboard"
                  // 10-L8: announce destructive action to assistive tech
                  aria-label={`Remove project ${project.name} from dashboard`}
                >
                  <span className="material-symbols-outlined text-xs" aria-hidden="true">logout</span>
                </button>
              )}
            </div>
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
