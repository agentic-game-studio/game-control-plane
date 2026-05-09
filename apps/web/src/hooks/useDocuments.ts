"use client";
import { useState, useEffect, useCallback } from "react";
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

  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";

  const fetchDocuments = useCallback(async () => {
    try {
      const data = await apiFetch<{ documents: DocumentEntry[]; categories: CategoryMeta[] }>(`/api/documents${qs}`);
      setDocuments(data.documents);
      setCategories(data.categories);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, [qs]);

  const fetchGraph = useCallback(async () => {
    try {
      const data = await apiFetch<{ graph: GraphData }>(`/api/documents/graph/data${qs}`);
      setGraphData(data.graph);
    } catch {
      // graph fetch is non-critical
    }
  }, [qs]);

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchDocuments(), fetchGraph()]);
      setLoading(false);
    })();
  }, [fetchDocuments, fetchGraph]);

  // Select a document
  const selectDocument = useCallback(async (slug: string) => {
    setSelectedId(slug);
    try {
      const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${slug}${qs}`);
      setSelectedDocument(data.document);
    } catch (err) {
      setError(String(err));
    }
  }, [qs]);

  // Force refresh
  const refresh = useCallback(async () => {
    try {
      await apiFetch<void>(`/api/documents/refresh${qs}`, { method: "POST" });
      await Promise.all([fetchDocuments(), fetchGraph()]);
      if (selectedId) {
        const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${selectedId}${qs}`);
        setSelectedDocument(data.document);
      }
    } catch (err) {
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
