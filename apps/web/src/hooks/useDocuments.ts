"use client";
import { useState, useCallback } from "react";
import type {
  DocumentEntry,
  DocumentDetail,
  CategoryMeta,
  GraphData,
  WSEvent,
} from "@game-studio/types";
import { apiFetch } from "@/lib/api";
import { useAbortableEffect } from "./useAbortableEffect";

interface UseDocumentsReturn {
  documents: DocumentEntry[];
  categories: CategoryMeta[];
  selectedDocument: DocumentDetail | null;
  graphData: GraphData | null;
  selectedId: string | null;
  selectDocument: (slug: string) => void;
  refresh: () => void;
  loading: boolean;
  error: string | null;
}

export function useDocuments(projectId?: string): UseDocumentsReturn {
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";

  const fetchDocuments = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await apiFetch<{ documents: DocumentEntry[]; categories: CategoryMeta[] }>(`/api/documents${qs}`, { signal });
      setDocuments(data.documents);
      setCategories(data.categories);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(String(err));
    }
  }, [qs]);

  const fetchGraph = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await apiFetch<{ graph: GraphData }>(`/api/documents/graph/data${qs}`, { signal });
      setGraphData(data.graph);
    } catch (err) {
      // graph fetch is non-critical
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }, [qs]);

  // 15-H-useDocuments-dead-ref: the previous useEffect held a
  // `loadAbortRef` to abort the previous controller on qs change.
  // But the effect's cleanup also called `controller.abort()` on the
  // local var, so the ref-based abort was always a no-op (the previous
  // controller was already aborted by the cleanup before the new effect
  // ran). useAbortableEffect does the right thing in one helper —
  // creates a controller, passes the signal to the work, and aborts
  // the controller on unmount or deps change. selectDocument/refresh
  // are user-triggered and keep their per-call controller so they
  // don't clobber the initial-load signal.
  useAbortableEffect(async (signal) => {
    setLoading(true);
    try {
      await Promise.all([fetchDocuments(signal), fetchGraph(signal)]);
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [fetchDocuments, fetchGraph]);

  // Select a document
  const selectDocument = useCallback(async (slug: string) => {
    setSelectedId(slug);
    // Per-call controller: aborting the previous select is fine but
    // we don't want to clobber the *initial* load controller.
    const controller = new AbortController();
    try {
      const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${slug}${qs}`, { signal: controller.signal });
      setSelectedDocument(data.document);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(String(err));
    }
  }, [qs]);

  // Force refresh
  const refresh = useCallback(async () => {
    const controller = new AbortController();
    try {
      await apiFetch<void>(`/api/documents/refresh${qs}`, { method: "POST", signal: controller.signal });
      await Promise.all([fetchDocuments(controller.signal), fetchGraph(controller.signal)]);
      if (selectedId) {
        const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${selectedId}${qs}`, { signal: controller.signal });
        setSelectedDocument(data.document);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(String(err));
    }
  }, [fetchDocuments, fetchGraph, selectedId, qs]);

  return {
    documents,
    categories,
    selectedDocument,
    graphData,
    selectedId,
    selectDocument,
    refresh,
    loading,
    error,
  };
}
