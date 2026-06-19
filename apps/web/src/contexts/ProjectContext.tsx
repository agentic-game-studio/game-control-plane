"use client";
import { createLogger } from "../lib/logger";
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
import { WS_REFETCH_DEBOUNCE_MS } from "@/lib/timing";
const logger = createLogger("ProjectContext");

// 29-L-project-context-versioned-cache: bump the suffix on the
// `projects-cache` key to v1. The previous unversioned key would
// silently serve stale serialized project arrays across a
// deploy that changed the Project interface (an added/renamed
// field), and localStorage entries never expire. Versioned keys
// mean a breaking change to the cached shape automatically
// purges the previous value on the first read of the new key.
const STORAGE_KEY = "studio:current-project-id";
const CACHE_KEY = "studio:projects-cache-v1";

interface ProjectContextValue {
  projects: Project[];
  currentProject: Project | null;
  currentProjectId: string | null;
  selectProject: (projectId: string | null) => void;
  /** Clear the current project selection. Equivalent to
   * `selectProject(null)` but named for logout-style call sites so
   * intent is obvious at the call site. */
  clearProject: () => void;
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
      // Cache the fresh list so a transient API failure on the next load
      // can still surface a usable (if stale) UI instead of a broken one.
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(result));
      } catch { /* localStorage unavailable */ }
    } catch (err) {
      logger.error("Failed to fetch projects", { err: err });
      // Q9-14: fall back to cached projects first, then only surface the
      // error banner if cache is also empty. The previous order set the
      // banner unconditionally on API failure, which confuses offline
      // reloads — the user sees a red error but the project list still
      // renders fine from cache.
      let cacheHit = false;
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          setProjects(JSON.parse(cached) as Project[]);
          cacheHit = true;
        } else {
          setProjects([]);
        }
      } catch {
        setProjects([]);
      }
      if (cacheHit) {
        // API failed but cache served us. Don't show a banner — the UI
        // is usable. Clear any prior error.
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Failed to load projects");
      }
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
        }, WS_REFETCH_DEBOUNCE_MS);
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
      clearProject: () => selectProject(null),
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
