"use client";

import { useState } from "react";
import { useDashboard } from "@/hooks/useDashboard";
import { useCurrentProject } from "@/hooks/useCurrentProject";
import { DataLoader } from "@/components/DataLoader";
import { StatsCards } from "./components/StatsCards";
import { ProjectGrid } from "./components/ProjectGrid";
import { ActivityLog } from "./components/ActivityLog";
import { NewProjectModal } from "./components/NewProjectModal";

export default function DashboardPage() {
  const { data, loading, error, retry, createProject } = useDashboard();
  const { currentProject, selectProject } = useCurrentProject(data.projects);
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="flex flex-col h-full p-8 gap-6">
      {/* Header */}
      <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] p-4">
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
