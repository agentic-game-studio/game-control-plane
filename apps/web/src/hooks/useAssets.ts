"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useAbortableEffect } from "./useAbortableEffect";
import type {
  AssetsData,
  GameAsset,
  ArtBibleConfig,
  CreateAssetRequest,
  UpdateAssetRequest,
  WSEvent,
} from "@game-studio/types";

const logger = createLogger("useAssets");

const DEFAULT_ASSETS: AssetsData = {
  assets: [],
  artBible: {
    baseTextureRes: 256,
    maxPolycount: 1500,
    enforcePalette: true,
    strictOrthographic: false,
    snapToGrid: true,
    gridSize: 8,
  },
};

export function useAssets(projectId?: string) {
  const [data, setData] = useState<AssetsData>(DEFAULT_ASSETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastProjectId = useRef<string | undefined>(projectId);
  const mountedRef = useRef(true);
  // Q9-6: single-flight de-dup. Two consumers (assets page + Producer
  // chat) can mount the hook in the same render and fire a parallel
  // GET each. The second call wastes a round-trip and worsens the
  // "loading" flicker. We coalesce by remembering the in-flight promise
  // keyed by projectId — subsequent callers await the same promise.
  const inflightRef = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const fetchAssets = useCallback(async () => {
    const key = projectId ?? "";
    if (inflightRef.current && inflightRef.current.key === key) {
      return inflightRef.current.promise;
    }
    const promise = (async () => {
      try {
        const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const result = await apiFetch<AssetsData>(`/api/assets${qs}`);
        if (!mountedRef.current) return;
        setData(result);
        setError(null);
      } catch (err) {
        logger.error("Failed to fetch assets", { err: err });
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load assets");
        setData(DEFAULT_ASSETS);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
        // Clear the inflight ref only if it still matches this run —
        // a key change mid-flight would have already installed a new
        // entry that we mustn't blow away.
        if (inflightRef.current?.key === key) {
          inflightRef.current = null;
        }
      }
    })();
    inflightRef.current = { key, promise };
    return promise;
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    fetchAssets();
  }, [fetchAssets]);

  // 14-FH10-unmount-cancel: separate useAbortableEffect for the
  // initial fetch so unmount cancels the request. The previous
  // useEffect+mountedRef pattern worked but kept the request in
  // flight for up to 30s. rescan() and the WS-driven fetchAssets
  // stay as-is since they're user- or event-triggered.
  useAbortableEffect(async (signal) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    try {
      const result = await apiFetch<AssetsData>(`/api/assets${qs}`, { signal });
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load assets");
      setData(DEFAULT_ASSETS);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (
        event.type === "asset:created" ||
        event.type === "asset:updated" ||
        event.type === "asset:deleted" ||
        event.type === "asset:generated"
      ) {
        // 10-L5: ignore events for other projects. A multi-project
        // workspace used to refetch on every asset:* event from any
        // project — each refetch scans the workspace directory and
        // can take 200-500ms. With 4 projects open and an active
        // generation pipeline, this dominated the network tab and
        // occasionally starved the active project's polling.
        const eventProjectId = "projectId" in event ? event.projectId : null;
        if (projectId && eventProjectId && eventProjectId !== projectId) {
          return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchAssets();
        }, 300);
      }
    },
    [fetchAssets, projectId]
  );

  useWebSocket(onWSEvent);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const createAsset = useCallback(
    async (request: CreateAssetRequest) => {
      const newAsset = await apiFetch<GameAsset>("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      await fetchAssets();
      return newAsset;
    },
    [fetchAssets]
  );

  const updateAsset = useCallback(
    async (id: string, updates: UpdateAssetRequest) => {
      const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
      const updated = await apiFetch<GameAsset>(`/api/assets/${id}${qs}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await fetchAssets();
      return updated;
    },
    [fetchAssets, projectId]
  );

  const deleteAsset = useCallback(
    async (id: string) => {
      await apiFetch(`/api/assets/${id}`, {
        method: "DELETE",
      });
      await fetchAssets();
    },
    [fetchAssets]
  );

  const updateArtBible = useCallback(
    async (updates: Partial<ArtBibleConfig>) => {
      const result = await apiFetch<{ artBible: ArtBibleConfig }>(
        "/api/assets/art-bible",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );
      setData((prev) => ({ ...prev, artBible: result.artBible }));
      return result.artBible;
    },
    []
  );

  const generateAsset = useCallback(
    async (params: {
      prompt: string;
      name: string;
      type?: string;
      category?: string;
      width?: number;
      height?: number;
      steps?: number;
      seed?: number;
      removeBg?: boolean;
      negativePrompt?: string;
      gridSize?: number;
      spriteSheet?: boolean;
      spriteCols?: number;
      spriteRows?: number;
      tags?: string[];
      workspacePath?: string;
    }) => {
      const result = await apiFetch<{ asset: GameAsset | null; log: string }>(
        "/api/assets/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        }
      );
      await fetchAssets();
      return result;
    },
    [fetchAssets]
  );

  const generateAssetBatch = useCallback(
    async (presetsFile: string, workspacePath?: string) => {
      const result = await apiFetch<{ generated: GameAsset[]; log: string }>(
        "/api/assets/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ presetsFile, workspacePath }),
        }
      );
      await fetchAssets();
      return result;
    },
    [fetchAssets]
  );

  const rescan = useCallback(async () => {
    setLoading(true);
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
    try {
      const result = await apiFetch<AssetsData>(`/api/assets${qs}`);
      if (!mountedRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [projectId]);

  const retry = useCallback(() => {
    setLoading(true);
    fetchAssets();
  }, [fetchAssets]);

  return {
    data,
    loading,
    error,
    retry,
    rescan,
    createAsset,
    updateAsset,
    deleteAsset,
    updateArtBible,
    generateAsset,
    generateAssetBatch,
  };
}
