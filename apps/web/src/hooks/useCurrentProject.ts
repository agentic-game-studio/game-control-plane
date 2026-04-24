"use client";

import { useState, useEffect, useCallback } from "react";
import type { Project } from "@game-studio/types";

const STORAGE_KEY = "studio:current-project-id";

export function useCurrentProject(projects: Project[]) {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setCurrentProjectId(stored);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Validate: if stored project no longer exists, clear it
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

  const currentProject = projects.find((p) => p.id === currentProjectId) ?? null;

  return { currentProjectId, currentProject, selectProject };
}
