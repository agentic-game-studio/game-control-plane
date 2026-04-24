"use client";

import { useMemo } from "react";
import type { DocumentDetail } from "@game-studio/types";

interface DocumentViewerProps {
  document: DocumentDetail | null;
  onSelect: (slug: string) => void;
  loading: boolean;
}

/** Minimal markdown-to-HTML renderer */
function renderMarkdown(md: string, onWikilink: (target: string) => void): string {
  let html = md;

  // Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre class="bg-black text-green-400 p-2 border-2 border-black my-2 text-xs overflow-x-auto"><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-black text-green-400 px-1 text-xs">$1</code>');

  // Wikilinks [[target]] — rendered as clickable spans
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => {
    const slug = target.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    return `<span data-wikilink="${slug}" class="text-blue-600 underline cursor-pointer hover:text-blue-800">[[${target}]]</span>`;
  });

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-1">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-2 border-b-2 border-black pb-1">$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-4 border-black pl-2 italic opacity-80 my-1">$1</blockquote>');

  // Tables (pipe-delimited)
  const tableRegex = /(\|.+\|[\r\n]+\|[-| :]+\|[\r\n]+((?:\|.+\|[\r\n]*)+))/g;
  html = html.replace(tableRegex, (match) => {
    const rows = match.trim().split("\n").filter((r) => r.trim());
    if (rows.length < 2) return match;

    const headerCells = rows[0].split("|").filter((c) => c.trim());
    const bodyRows = rows.slice(2);

    let table = '<table class="w-full border-2 border-black text-xs my-2"><thead><tr>';
    for (const cell of headerCells) {
      table += `<th class="border-2 border-black p-1 bg-surface-container text-left">${cell.trim()}</th>`;
    }
    table += "</tr></thead><tbody>";

    for (const row of bodyRows) {
      const cells = row.split("|").filter((c) => c.trim());
      table += "<tr>";
      for (const cell of cells) {
        table += `<td class="border-2 border-black p-1">${cell.trim()}</td>`;
      }
      table += "</tr>";
    }

    table += "</tbody></table>";
    return table;
  });

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>');

  // Paragraphs: double newline splits
  html = html.replace(/\n\n/g, '</p><p class="my-1">');

  // Wrap in paragraph if not starting with block element
  if (!html.startsWith("<h") && !html.startsWith("<pre") && !html.startsWith("<table")) {
    html = `<p class="my-1">${html}</p>`;
  }

  return html;
}

export default function DocumentViewer({ document, onSelect, loading }: DocumentViewerProps) {
  const htmlContent = useMemo(() => {
    if (!document) return "";
    return renderMarkdown(document.content, onSelect);
  }, [document, onSelect]);

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
