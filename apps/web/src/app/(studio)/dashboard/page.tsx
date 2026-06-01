"use client";

import { useState, useEffect, useCallback } from "react";
import { useDashboard } from "@/hooks/useDashboard";
import { useProject } from "@/contexts/ProjectContext";
import { DataLoader } from "@/components/DataLoader";
import { StatsCards } from "./components/StatsCards";
import { ProjectGrid } from "./components/ProjectGrid";
import { ActivityLog } from "./components/ActivityLog";
import { NewProjectModal } from "./components/NewProjectModal";
import { apiFetch } from "@/lib/api";

interface MCPStatus {
  status: "not_running" | "connected" | "disconnected";
  serverRunning?: boolean;
  godotConnected?: boolean;
  projectInfo?: { name: string; version: string };
  error?: string;
}

interface ServerStatus {
  found: boolean;
  installed: boolean;
  built: boolean;
  serverDir?: string;
  error?: string;
}

export default function DashboardPage() {
  const { data, loading, error, retry, createProject, createDemoProject, deleteProject } = useDashboard();
  const { currentProject, selectProject } = useProject();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mcpStatuses, setMcpStatuses] = useState<Record<string, MCPStatus>>({});
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [settingUp, setSettingUp] = useState(false);

  // Check server status
  const checkServerStatus = useCallback(async () => {
    try {
      const result = await apiFetch<ServerStatus>("/api/dashboard/server-status");
      setServerStatus(result);
    } catch {
      setServerStatus({ found: false, installed: false, built: false, error: "Failed to check" });
    }
  }, []);

  // Setup server
  const setupServer = async () => {
    setSettingUp(true);
    try {
      await apiFetch<{ installed: boolean; built: boolean }>(
        "/api/dashboard/setup-server",
        { method: "POST" }
      );
      await checkServerStatus();
    } catch (err) {
      console.error("Server setup failed:", err);
    } finally {
      setSettingUp(false);
    }
  };

  // Launch Godot editor for a project
  const launchEditor = async (projectId: string) => {
    try {
      await apiFetch<{ success: boolean }>(`/api/dashboard/projects/${projectId}/launch-editor`, {
        method: "POST",
      });
    } catch (err) {
      console.error("Failed to launch Godot editor:", err);
    }
  };

  const launchDemoProject = async () => {
    try {
      const project = await createDemoProject();
      selectProject(project.id);
    } catch (err) {
      console.error("Failed to create demo project:", err);
    }
  };

  // Check server status on mount and periodically
  useEffect(() => {
    checkServerStatus();
    const interval = setInterval(checkServerStatus, 60000);
    return () => clearInterval(interval);
  }, [checkServerStatus]);

  // Poll MCP health for Godot projects
  const checkMCPHealth = useCallback(async () => {
    const godotProjects = data.projects.filter((p) => p.engine === "godot");
    if (godotProjects.length === 0) return;

    const statuses: Record<string, MCPStatus> = {};
    await Promise.all(
      godotProjects.map(async (project) => {
        try {
          const result = await apiFetch<MCPStatus>(
            `/api/dashboard/projects/${project.id}/mcp-health`
          );
          statuses[project.id] = result;
        } catch {
          statuses[project.id] = { status: "disconnected", error: "Failed to check" };
        }
      })
    );
    setMcpStatuses(statuses);
  }, [data.projects]);

  // Poll every 10 seconds
  useEffect(() => {
    checkMCPHealth();
    const interval = setInterval(checkMCPHealth, 10000);
    return () => clearInterval(interval);
  }, [checkMCPHealth]);

  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 border-2 border-black bg-black flex items-center justify-center text-white">
              <span className="material-symbols-outlined">dashboard</span>
            </div>
            <div>
              <h1 className="font-[var(--font-terminal)] text-xl font-bold uppercase tracking-widest">
                Mission Control
              </h1>
              <span className="font-[var(--font-terminal)] text-xs text-[#737688] uppercase">
                {loading
                  ? "System Overview // Initializing..."
                  : error
                    ? "System Overview // Connection Lost"
                    : "System Overview // Online"}
              </span>
            </div>
          </div>

          {/* Server Status */}
          <div className="flex items-center gap-2">
            {/* Godot MCP Server Status */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-2 border-black bg-[#f3f2ff]">
              <span className="material-symbols-outlined text-sm">terminal</span>
              {serverStatus?.found ? (
                serverStatus.built ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="font-[var(--font-terminal)] text-xs">MCP Server Ready</span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-yellow-500" />
                    <span className="font-[var(--font-terminal)] text-xs">MCP Server Needs Build</span>
                    <button
                      onClick={setupServer}
                      disabled={settingUp}
                      className="font-[var(--font-label)] text-xs font-bold uppercase px-2 py-0.5 bg-black text-white hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                    >
                      {settingUp ? "Building..." : "Build"}
                    </button>
                  </>
                )
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="font-[var(--font-terminal)] text-xs text-red-600">MCP Not Found</span>
                  <button
                    onClick={setupServer}
                    disabled={settingUp}
                    className="font-[var(--font-label)] text-xs font-bold uppercase px-2 py-0.5 bg-black text-white hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                  >
                    {settingUp ? "Setting up..." : "Setup"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <DataLoader loading={loading} error={error} onRetry={retry}>
        {/* Stats Cards */}
        <StatsCards data={data} />

        {/* Main Content */}
        <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
          {/* Project Grid */}
          <div className="flex-[2] min-h-0">
            <ProjectGrid
              projects={data.projects}
              currentProject={currentProject}
              onSelectProject={(project) => selectProject(project.id)}
              onNewProject={() => setIsModalOpen(true)}
              onDemoProject={launchDemoProject}
              onDeleteProject={deleteProject}
              mcpStatuses={mcpStatuses}
              onLaunchEditor={launchEditor}
            />
          </div>

          {/* Activity Log */}
          <div className="flex-1 min-h-0">
            <ActivityLog entries={data.activityLog} />
          </div>
        </div>
      </DataLoader>

      {/* New Project Modal */}
      <NewProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={createProject}
      />
    </div>
  );
}
