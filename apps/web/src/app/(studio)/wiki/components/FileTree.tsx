"use client";

import { useState } from "react";
import type { DocumentEntry, CategoryMeta } from "@game-studio/types";

interface FileTreeProps {
  documents: DocumentEntry[];
  categories: CategoryMeta[];
  selectedId: string | null;
  onSelect: (slug: string) => void;
  onRefresh: () => void;
}

export default function FileTree({ documents, categories, selectedId, onSelect, onRefresh }: FileTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(categories.map((c) => c.id)));

  const toggleCategory = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group documents by category
  const byCategory = new Map<string, DocumentEntry[]>();
  for (const doc of documents) {
    const list = byCategory.get(doc.category) ?? [];
    list.push(doc);
    byCategory.set(doc.category, list);
  }

  return (
    <aside className="w-[280px] border-r-2 border-black flex flex-col bg-surface shrink-0">
      {/* Header */}
      <div className="h-10 border-b-2 border-black flex items-center justify-between px-[var(--spacing-sm)] bg-surface-container text-on-surface font-[var(--font-terminal)] text-sm uppercase">
        <div className="flex items-center">
          <span className="material-symbols-outlined mr-[var(--spacing-xs)] text-base">folder_open</span>
          SYS.DIR / DOCS
        </div>
        <button
          onClick={onRefresh}
          className="p-0.5 hover:bg-surface-container border-2 border-transparent hover:border-black retro-press"
          title="Refresh"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
        </button>
      </div>

      {/* Folder Tree */}
      <div className="flex-1 overflow-y-auto p-[var(--spacing-sm)] font-[var(--font-terminal)] text-xs font-bold uppercase flex flex-col gap-[var(--spacing-xs)]">
        {categories.filter((cat) => (byCategory.get(cat.id)?.length ?? 0) > 0).map((cat) => {
          const docs = byCategory.get(cat.id) ?? [];
          const isExpanded = expanded.has(cat.id);

          return (
            <div key={cat.id}>
              {/* Category folder header */}
              <button
                onClick={() => toggleCategory(cat.id)}
                className="w-full text-left p-[var(--spacing-xs)] border-2 border-transparent hover:border-black hover:bg-surface-container flex items-center gap-[var(--spacing-xs)]"
              >
                <span className="material-symbols-outlined text-base">
                  {isExpanded ? "expand_more" : "chevron_right"}
                </span>
                <span className="material-symbols-outlined text-base">{cat.icon}</span>
                <span className="flex-1 truncate">{cat.label}</span>
                <span className="text-[10px] opacity-50">{docs.length}</span>
              </button>

              {/* Document items */}
              {isExpanded && (
                <div className="ml-4 flex flex-col gap-0.5">
                  {docs.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => onSelect(doc.id)}
                      className={`w-full text-left p-[var(--spacing-xs)] border-2 flex items-center gap-[var(--spacing-xs)] ${
                        selectedId === doc.id
                          ? "border-black bg-primary-container text-on-primary"
                          : "border-transparent hover:border-black hover:bg-surface-container"
                      }`}
                    >
                      <span className="material-symbols-outlined text-base">description</span>
                      <span className="truncate normal-case">{doc.filename}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {documents.length === 0 && (
          <div className="text-center opacity-50 py-8 normal-case">
            <span className="material-symbols-outlined text-3xl block mb-2">note_add</span>
            No documents yet
          </div>
        )}
      </div>
    </aside>
  );
}
