"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import type {
  AssetsData,
  GameAsset,
  ArtBibleConfig,
  CreateAssetRequest,
  UpdateAssetRequest,
  WSEvent,
} from "@game-studio/types";

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

export function useAssets() {
  const [data, setData] = useState<AssetsData>(DEFAULT_ASSETS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchAssets = useCallback(async () => {
    try {
      const result = await apiFetch<AssetsData>("/api/assets");
      setData(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch assets:", err);
      setError(err instanceof Error ? err.message : "Failed to load assets");
      setData(DEFAULT_ASSETS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (
        event.type === "asset:created" ||
        event.type === "asset:updated" ||
        event.type === "asset:deleted"
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchAssets();
        }, 300);
      }
    },
    [fetchAssets]
  );

  useWebSocket(onWSEvent);

  useEffect(() => {
    return () => {
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
      const updated = await apiFetch<GameAsset>(`/api/assets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await fetchAssets();
      return updated;
    },
    [fetchAssets]
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

  const retry = useCallback(() => {
    setLoading(true);
    fetchAssets();
  }, [fetchAssets]);

  return {
    data,
    loading,
    error,
    retry,
    createAsset,
    updateAsset,
    deleteAsset,
    updateArtBible,
  };
}
