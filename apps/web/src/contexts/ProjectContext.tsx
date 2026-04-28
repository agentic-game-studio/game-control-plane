"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Project, WSEvent } from "@game-studio/types";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

const STORAGE_KEY = "studio:current-project-id";

interface ProjectContextValue {
  projects: Project[];
  currentProject: Project | null;
  currentProjectId: string | null;
  selectProject: (projectId: string | null) => void;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchProjects = useCallback(async () => {
    try {
      const result = await apiFetch<Project[]>("/api/dashboard/projects");
      setProjects(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
      setError(err instanceof Error ? err.message : "Failed to load projects");
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + restore selection from localStorage.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setCurrentProjectId(stored);
    } catch {
      // localStorage unavailable
    }
    fetchProjects();
  }, [fetchProjects]);

  // If the currently selected project no longer exists, clear it.
  useEffect(() => {
    if (
      currentProjectId &&
      projects.length > 0 &&
      !projects.find((p) => p.id === currentProjectId)
    ) {
      setCurrentProjectId(null);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, [projects, currentProjectId]);

  // Refresh on project WS events (debounced).
  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (
        event.type === "project:created" ||
        event.type === "project:updated" ||
        event.type === "project:deleted"
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchProjects();
        }, 300);
      }
    },
    [fetchProjects],
  );
  useWebSocket(onWSEvent);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const selectProject = useCallback((projectId: string | null) => {
    setCurrentProjectId(projectId);
    try {
      if (projectId) {
        localStorage.setItem(STORAGE_KEY, projectId);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  const currentProject = useMemo(
    () => projects.find((p) => p.id === currentProjectId) ?? null,
    [projects, currentProjectId],
  );

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      currentProject,
      currentProjectId,
      selectProject,
      loading,
      error,
      refresh: fetchProjects,
    }),
    [projects, currentProject, currentProjectId, selectProject, loading, error, fetchProjects],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) {
    throw new Error("useProject must be used within ProjectProvider");
  }
  return ctx;
}
