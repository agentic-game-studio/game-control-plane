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

export function useDocuments(): UseDocumentsReturn {
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [categories, setCategories] = useState<CategoryMeta[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentDetail | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      const data = await apiFetch<{ documents: DocumentEntry[]; categories: CategoryMeta[] }>("/api/documents");
      setDocuments(data.documents);
      setCategories(data.categories);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const fetchGraph = useCallback(async () => {
    try {
      const data = await apiFetch<{ graph: GraphData }>("/api/documents/graph/data");
      setGraphData(data.graph);
    } catch {
      // graph fetch is non-critical
    }
  }, []);

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
      const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${slug}`);
      setSelectedDocument(data.document);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  // Force refresh
  const refresh = useCallback(async () => {
    try {
      await apiFetch<void>("/api/documents/refresh", { method: "POST" });
      await Promise.all([fetchDocuments(), fetchGraph()]);
      if (selectedId) {
        const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${selectedId}`);
        setSelectedDocument(data.document);
      }
    } catch (err) {
      setError(String(err));
    }
  }, [fetchDocuments, fetchGraph, selectedId]);

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
