"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useAbortableEffect } from "./useAbortableEffect";
import { WS_REFETCH_DEBOUNCE_MS } from "@/lib/timing";
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
  // 28-M-use-assets-rescan-abort: holds the in-flight rescan
  // controller so a subsequent rescan (or unmount) can abort the
  // previous one. The same pattern as useDocuments' refreshAbortRef.
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // 15-H-assets-duplicate-fetch: the previous code had BOTH a
  // useEffect(setLoading+fetchAssets) AND a useAbortableEffect that
  // both fired on mount — two parallel GETs, the first response
  // discarded. Removed that duplicate useEffect; useAbortableEffect is
  // now the single source of truth for the initial fetch and handles
  // its own abort on unmount via the signal.
  //
  // mountedRef is still needed for `rescan`, which is a user-triggered
  // action (button click) that does NOT go through useAbortableEffect.
  // Without it, a user clicking "rescan" and then navigating away
  // mid-flight would call setState on an unmounted component. We could
  // wrap rescan in a fresh AbortController, but the simpler mountedRef
  // is fine here because rescan is rare (one user click at a time) and
  // the only consequence of leaking is a harmless React warning.

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
        setData(result);
        setError(null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        logger.error("Failed to fetch assets", { err: err });
        setError(err instanceof Error ? err.message : "Failed to load assets");
        setData(DEFAULT_ASSETS);
      } finally {
        setLoading(false);
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

  // 14-FH10-unmount-cancel: useAbortableEffect cancels the in-flight
  // request on unmount via its signal, replacing the previous
  // useEffect+mountedRef pattern that kept the request alive for up
  // to 30s. rescan() and the WS-driven fetchAssets stay as-is since
  // they're user- or event-triggered.
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
        }, WS_REFETCH_DEBOUNCE_MS);
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
      // 28-M-use-assets-rescan-abort: abort any in-flight rescan
      // fetch on unmount.
      abortRef.current?.abort();
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
    // 28-M-use-assets-rescan-abort: route the fetch through an
    // AbortController so navigating away mid-rescan cancels the
    // in-flight request. mountedRef only suppresses the post-await
    // setState — the network call ran to completion. Mirror the
    // 28-H-commandroom-init-abort pattern: per-call controller,
    // abort on unmount.
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    try {
      const result = await apiFetch<AssetsData>(`/api/assets${qs}`, { signal: controller.signal });
      if (!mountedRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Rescan failed");
    } finally {
      if (mountedRef.current && abortRef.current === controller) {
        abortRef.current = null;
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
