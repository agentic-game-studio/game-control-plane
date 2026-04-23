"use client";

import { useDocuments } from "@/hooks/useDocuments";
import FileTree from "./components/FileTree";
import DocumentViewer from "./components/DocumentViewer";
import KnowledgeGraph from "./components/KnowledgeGraph";

export default function WikiPage() {
  const {
    documents,
    categories,
    selectedDocument,
    graphData,
    selectedId,
    selectDocument,
    refresh,
    loading,
    error,
  } = useDocuments();

  return (
    <div className="flex h-full">
      <FileTree
        documents={documents}
        categories={categories}
        selectedId={selectedId}
        onSelect={selectDocument}
        onRefresh={refresh}
      />
      <DocumentViewer
        document={selectedDocument}
        onSelect={selectDocument}
        loading={loading}
      />
      <KnowledgeGraph
        graphData={graphData}
        selectedId={selectedId}
        onSelect={selectDocument}
        categories={categories}
      />
      {error && (
        <div className="fixed bottom-4 right-4 border-2 border-red-600 bg-red-100 text-red-800 px-3 py-2 font-[var(--font-terminal)] text-xs">
          {error}
        </div>
      )}
    </div>
  );
}
