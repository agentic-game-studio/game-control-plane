"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { DashboardData } from "@game-studio/types";
import { DataLoader } from "@/components/DataLoader";

const engineIcons: Record<string, string> = {
  unity: "view_in_ar",
  godot: "layers",
  unreal: "swords",
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const dashboardData = await apiFetch<DashboardData>("/api/dashboard");
      setData(dashboardData);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load dashboard";
      setError(message);
      console.error("Failed to fetch dashboard data:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData, retryCount]);

  useEffect(() => {
    if (data) {
      const interval = setInterval(() => fetchData(false), 30000);
      return () => clearInterval(interval);
    }
  }, [data, fetchData]);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  const creditsPercent = data
    ? Math.round((data.summary.credits.current / data.summary.credits.max) * 100)
    : 84;

  return (
    <DataLoader loading={loading} error={error} onRetry={handleRetry}>
      <div className="p-[var(--spacing-gutter)] flex flex-col gap-[var(--spacing-gutter)]">
        {/* Top Section: Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[var(--spacing-gutter)]">
          {/* Total Projects */}
          <div className="border-2 border-black bg-white p-4 relative">
            <div className="font-[var(--font-terminal)] text-sm uppercase border-b-2 border-black pb-2 mb-4">
              Total Projects
            </div>
            <div className="font-[var(--font-headline)] text-primary text-5xl font-bold leading-none">
              {data?.summary.totalProjects ?? "—"}
            </div>
            <div className="absolute bottom-4 right-4 w-4 h-4 bg-primary border-2 border-black" />
          </div>

          {/* Active Agents */}
          <div className="border-2 border-black bg-white p-4 relative">
            <div className="font-[var(--font-terminal)] text-sm uppercase border-b-2 border-black pb-2 mb-4">
              Active Agents
            </div>
            <div className="font-[var(--font-headline)] text-black text-5xl font-bold leading-none">
              {data?.summary.activeAgents?.toString().padStart(2, "0") ?? "—"}
            </div>
            <div className="absolute bottom-4 right-4 w-4 h-4 bg-black border-2 border-black" />
          </div>

          {/* Power Meter (Credits) */}
          <div className="border-2 border-black bg-white p-4 flex flex-col justify-between">
            <div className="flex justify-between items-center border-b-2 border-black pb-2 mb-4">
              <span className="font-[var(--font-terminal)] text-sm uppercase">
                Available Credits
              </span>
              <span className="font-[var(--font-terminal)] text-sm font-bold text-secondary">
                {data
                  ? `${data.summary.credits.current} / ${data.summary.credits.max}`
                  : "—"}
              </span>
            </div>
            <div className="h-6 border-2 border-black bg-surface-container-high w-full relative">
              <div
                className="absolute top-0 left-0 h-full bg-secondary border-r-2 border-black flex items-center overflow-hidden"
                style={{ width: `${creditsPercent}%` }}
              >
                <div className="w-full h-full stripe-pattern" />
              </div>
            </div>
            <div className="text-right mt-1 font-[var(--font-label)] text-xs font-bold uppercase text-outline">
              SYS_POWER_LVL
            </div>
          </div>
        </div>

        {/* Middle Section: Projects + Activity Log */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[var(--spacing-gutter)] flex-1 min-h-[400px]">
          {/* Active Projects Grid */}
          <div className="lg:col-span-2 border-2 border-black bg-white flex flex-col">
            <div className="border-b-2 border-black p-3 bg-black text-white flex justify-between items-center">
              <span className="font-[var(--font-terminal)] text-sm uppercase">
                &gt; ACTIVE_DIRECTORIES
              </span>
              <button className="bg-primary text-white border-2 border-white px-2 py-1 font-[var(--font-label)] text-xs font-bold uppercase hover:bg-white hover:text-black hover:border-black retro-press transition-all">
                + NEW_PROJ
              </button>
            </div>
            <div className="p-[var(--spacing-gutter)] grid grid-cols-1 sm:grid-cols-2 gap-[var(--spacing-gutter)] overflow-y-auto">
              {data?.projects.slice(0, 3).map((project) => (
                <div
                  key={project.id}
                  className="border-2 border-black p-4 hover:bg-surface-container transition-colors group"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 border-2 border-black bg-white flex items-center justify-center">
                      <span className="material-symbols-outlined text-3xl">
                        {engineIcons[project.engine] ?? "view_in_ar"}
                      </span>
                    </div>
                    <span className="border-2 border-black px-2 py-1 text-xs font-[var(--font-terminal)] bg-primary text-white uppercase">
                      {project.engine}
                    </span>
                  </div>
                  <h3 className="font-[var(--font-headline)] text-lg font-semibold uppercase mb-1 group-hover:text-primary transition-colors">
                    {project.name}
                  </h3>
                  <p className="font-[var(--font-terminal)] text-sm text-outline mb-4">
                    {project.description}
                  </p>
                  <div className="w-full border-2 border-black h-4 bg-white relative">
                    <div
                      className="absolute top-0 left-0 h-full bg-black"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <div className="text-right font-[var(--font-label)] text-xs font-bold uppercase mt-1">
                    {project.progress}% COMPLETED
                  </div>
                </div>
              ))}

              {/* Empty Slot */}
              <div className="border-2 border-black border-dashed p-4 flex flex-col items-center justify-center min-h-[160px] bg-surface-container-low hover:bg-white transition-colors cursor-pointer retro-press">
                <span className="material-symbols-outlined text-4xl text-outline mb-2">add_box</span>
                <span className="font-[var(--font-terminal)] text-sm text-outline uppercase">
                  INIT_NEW_PROJECT
                </span>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className="border-2 border-black bg-white flex flex-col h-full max-h-[500px] lg:max-h-none">
            <div className="border-b-2 border-black p-3 bg-black text-white">
              <span className="font-[var(--font-terminal)] text-sm uppercase">
                &gt; SYS_LOG
              </span>
            </div>
            <div className="p-4 font-[var(--font-terminal)] text-sm overflow-y-auto flex-1 bg-[#F0F0F0] flex flex-col gap-2">
              {data?.activityLog.map((entry) => (
                <div key={entry.id} className="flex gap-2">
                  <span className="text-outline">[{entry.timestamp}]</span>
                  <span
                    className={
                      entry.level === "warn"
                        ? "text-secondary uppercase"
                        : entry.source === "SYS"
                          ? "text-black"
                          : "text-primary"
                    }
                  >
                    {entry.source}
                  </span>
                  <span className="text-black">{entry.message}</span>
                </div>
              ))}
              <div className="flex gap-2 opacity-50 mt-auto pt-4">
                <span className="blinking-cursor">_</span>
                <span>waiting for input...</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DataLoader>
  );
}
