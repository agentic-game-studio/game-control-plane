"use client";

import { useCallback, useEffect, useState } from "react";
import { useProject } from "@/contexts/ProjectContext";
import { ProjectGuard } from "@/components/ProjectGuard";
import { DataLoader } from "@/components/DataLoader";
import { apiFetch } from "@/lib/api";
import type { BuildPlatform, GameBuild } from "@game-studio/types";

const PLATFORMS: BuildPlatform[] = ["web", "windows", "macos", "linux", "android", "ios"];

export default function BuildsPage() {
  return (
    <ProjectGuard>
      <BuildsPageInner />
    </ProjectGuard>
  );
}

function BuildsPageInner() {
  const { currentProject } = useProject();
  const [builds, setBuilds] = useState<GameBuild[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<BuildPlatform | null>(null);

  const loadBuilds = useCallback(async () => {
    if (!currentProject?.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<GameBuild[]>(`/api/builds?projectId=${currentProject.id}`);
      setBuilds(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load builds");
    } finally {
      setLoading(false);
    }
  }, [currentProject?.id]);

  useEffect(() => {
    void loadBuilds();
  }, [loadBuilds]);

  const handleExport = async (platform: BuildPlatform) => {
    if (!currentProject?.id) return;
    setExporting(platform);
    try {
      await apiFetch<GameBuild>("/api/builds/export", {
        method: "POST",
        body: JSON.stringify({ projectId: currentProject.id, platform, bumpVersion: true }),
      });
      await loadBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const handleSmoke = async (buildId: string) => {
    if (!currentProject?.id) return;
    try {
      await apiFetch(`/api/builds/${buildId}/smoke`, {
        method: "POST",
        body: JSON.stringify({ projectId: currentProject.id }),
      });
      await loadBuilds();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Smoke test failed");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="border-b-2 border-black p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-[var(--font-headline)] text-xl font-bold uppercase">Builds</h1>
          <p className="font-[var(--font-terminal)] text-xs text-black/70 mt-1">
            Export history and smoke tests for {currentProject?.name ?? "project"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((platform) => (
            <button
              key={platform}
              type="button"
              disabled={!!exporting}
              onClick={() => void handleExport(platform)}
              className="border-2 border-black px-3 py-1 font-[var(--font-terminal)] text-xs font-bold uppercase hover:bg-[#0055FF] hover:text-white disabled:opacity-50"
            >
              {exporting === platform ? "Exporting…" : `Export ${platform}`}
            </button>
          ))}
        </div>
      </header>

      <DataLoader loading={loading} error={error} onRetry={() => void loadBuilds()}>
        <div className="flex-1 overflow-y-auto p-4">
          {builds.length === 0 ? (
            <p className="font-[var(--font-terminal)] text-sm">No builds yet. Run an export to create one.</p>
          ) : (
            <div className="grid gap-3">
              {builds.map((build) => (
                <article key={build.id} className="border-2 border-black p-4 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="font-[var(--font-headline)] text-sm font-bold uppercase">
                        v{build.version} — {build.platform}
                      </h2>
                      <p className="font-[var(--font-terminal)] text-xs mt-1">
                        {build.preset ?? "default preset"} · {new Date(build.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge status={build.status} smoke={build.smokeTestPassed} />
                  </div>
                  {build.artifactPath && (
                    <p className="font-[var(--font-terminal)] text-xs mt-2 break-all">{build.artifactPath}</p>
                  )}
                  {build.error && (
                    <p className="font-[var(--font-terminal)] text-xs text-red-700 mt-2">{build.error}</p>
                  )}
                  {build.changelog && (
                    <pre className="font-[var(--font-terminal)] text-xs mt-2 whitespace-pre-wrap bg-black/5 p-2 max-h-32 overflow-y-auto">
                      {build.changelog.slice(0, 500)}
                    </pre>
                  )}
                  <div className="mt-3 flex gap-2">
                    {build.status === "success" && (
                      <button
                        type="button"
                        onClick={() => void handleSmoke(build.id)}
                        className="border-2 border-black px-2 py-1 font-[var(--font-terminal)] text-xs uppercase hover:bg-[#0055FF] hover:text-white"
                      >
                        Re-run smoke
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </DataLoader>
    </div>
  );
}

function StatusBadge({ status, smoke }: { status: GameBuild["status"]; smoke?: boolean }) {
  const colors: Record<GameBuild["status"], string> = {
    pending: "bg-yellow-200",
    building: "bg-blue-200",
    success: smoke ? "bg-green-200" : "bg-yellow-200",
    failed: "bg-red-200",
  };
  const label = status === "success" ? (smoke ? "success + smoke ok" : "success (smoke pending)") : status;
  return (
    <span className={`border-2 border-black px-2 py-0.5 font-[var(--font-terminal)] text-xs uppercase ${colors[status]}`}>
      {label}
    </span>
  );
}
