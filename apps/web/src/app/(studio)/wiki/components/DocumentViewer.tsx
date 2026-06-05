"use client";

import { useMemo } from "react";
import type { DocumentDetail } from "@game-studio/types";
import { renderMarkdown } from "@/lib/markdown";

interface DocumentViewerProps {
  document: DocumentDetail | null;
  onSelect: (slug: string) => void;
  loading: boolean;
}

export default function DocumentViewer({ document, onSelect, loading }: DocumentViewerProps) {
  const htmlContent = useMemo(() => {
    if (!document) return "";
    // 17-C1: route the wiki viewer through the hardened lib/markdown.ts
    // renderer (with wikilink support) instead of the local copy that
    // skipped the 4-layer XSS defenses.
    return renderMarkdown(document.content, { wikilinks: true });
  }, [document]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const wikilink = target.closest("[data-wikilink]");
    if (wikilink) {
      const slug = (wikilink as HTMLElement).dataset.wikilink;
      if (slug) onSelect(slug);
    }
  };

  return (
    <section className="flex-1 flex flex-col bg-surface-container-lowest relative">
      {/* Toolbar */}
      <div className="h-10 border-b-2 border-black flex items-center px-[var(--spacing-md)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase justify-between">
        <div className="flex items-center">
          <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">edit_document</span>
          {document ? `EDIT: ${document.filename}` : "NO DOCUMENT SELECTED"}
        </div>
        {document && (
          <div className="flex gap-[var(--spacing-sm)]">
            {document.status && (
              <span className="text-[10px] border-2 border-black px-1 py-0.5 bg-white">{document.status}</span>
            )}
            <span className="text-[10px] border-2 border-black px-1 py-0.5 bg-primary-container text-white">
              {document.category}
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 p-[var(--spacing-lg)] font-[var(--font-terminal)] text-base leading-relaxed overflow-y-auto">
        {loading && !document ? (
          <div className="flex items-center justify-center h-full opacity-50">
            <span className="material-symbols-outlined animate-spin mr-2">progress_activity</span>
            LOADING...
          </div>
        ) : document ? (
          <div
            onClick={handleClick}
            className="prose-sm"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full opacity-50">
            <span className="material-symbols-outlined text-4xl mb-2">article</span>
            <p className="font-[var(--font-terminal)] text-sm uppercase">Select a document from the file tree</p>
          </div>
        )}
      </div>
    </section>
  );
}
