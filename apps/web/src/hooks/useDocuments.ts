"use client";
import { useState, useCallback, useRef, useEffect } from "react";
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

// 27-L-useDocuments-err-msg: centralized error-message extractor.
// The previous shape was `setError(String(err))` at 3 sites; a
// rejected Promise of a plain object (`throw {foo: 1}`) would land
// in `setError` as the string "[object Object]". Extract the same
// `err instanceof Error ? err.message : String(err)` pattern used
// in useDashboard.ts:37 and useTickets.ts:45 — keep it in one
// place so the convention is the same across all hooks.
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
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
      setError(extractErrorMessage(err));
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
      setError(extractErrorMessage(err));
    }
  }, [qs]);

  // Force refresh
  // 27-L-useDocuments-refresh-abort: hold the in-flight controller
  // in a ref so a subsequent refresh call aborts the previous one.
  // The previous shape created a fresh `new AbortController()` per
  // call and never aborted the previous — a user spamming the
  // "Force refresh" button could have N parallel in-flight requests
  // racing to setDocuments / setGraphData. Last-write-wins, so
  // visible state was usually correct, but the network and CPU
  // waste on the losers is real, and a slow earlier response could
  // overwrite a faster later one with stale data.
  const refreshAbortRef = useAbortableRefresh();
  const refresh = useCallback(async () => {
    const controller = new AbortController();
    refreshAbortRef.beginRefresh(controller);
    try {
      await apiFetch<void>(`/api/documents/refresh${qs}`, { method: "POST", signal: controller.signal });
      await Promise.all([fetchDocuments(controller.signal), fetchGraph(controller.signal)]);
      if (selectedId) {
        const data = await apiFetch<{ document: DocumentDetail }>(`/api/documents/${selectedId}${qs}`, { signal: controller.signal });
        setSelectedDocument(data.document);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(extractErrorMessage(err));
    }
  }, [fetchDocuments, fetchGraph, selectedId, qs, refreshAbortRef]);

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

// 27-L-useDocuments-refresh-abort: ref-based abort for the
// refresh() function. A useRef-only variant is too small to deserve
// its own hook file, so it's inlined here. beginRefresh() aborts
// the previous controller (if any) and stores the new one. The
// effect's cleanup on unmount also aborts the in-flight one, so
// leaving the page mid-refresh doesn't leave a fetch in flight.
function useAbortableRefresh() {
  const ref = useRef<AbortController | null>(null);
  useEffect(() => () => ref.current?.abort(), []);
  return {
    beginRefresh(next: AbortController) {
      ref.current?.abort();
      ref.current = next;
    },
  };
}
