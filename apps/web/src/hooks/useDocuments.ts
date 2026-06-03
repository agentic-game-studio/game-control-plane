"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import type {
  DocumentEntry,
  DocumentDetail,
  CategoryMeta,
  GraphData,
  WSEvent,
} from "@game-studio/types";
import { apiFetch } from "@/lib/api";

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
  // 14-FH10-unmount-cancel: hold a long-lived controller for
  // the effect-driven fetches. selectDocument/refresh are
  // user-triggered so they get a per-call controller instead.
  // On unmount we abort the in-flight fetch so React doesn't
  // warn about a state update on an unmounted component, and
  // a quick projectId switch doesn't trigger an old fetch's
  // setState to clobber the new data.
  const loadAbortRef = useRef<AbortController | null>(null);

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

  // Initial load — abort in-flight on unmount or qs change.
  useEffect(() => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    (async () => {
      setLoading(true);
      try {
        await Promise.all([fetchDocuments(controller.signal), fetchGraph(controller.signal)]);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      controller.abort();
    };
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
