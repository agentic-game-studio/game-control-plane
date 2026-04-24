"use client";

/** Minimal markdown-to-HTML renderer (safe — escapes HTML first) */
export function renderMarkdown(md: string): string {
  let html = md;

  // Escape HTML entities
  html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre class="bg-black text-green-400 p-2 border-2 border-black my-2 text-xs overflow-x-auto font-[var(--font-terminal)]"><code>${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-[#e1e1ef] border border-black px-1 text-xs font-[var(--font-terminal)]">$1</code>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4 class="text-sm font-bold mt-3 mb-1 font-[var(--font-label)]">$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-4 mb-1 font-[var(--font-label)]">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-1 font-[var(--font-label)] border-b-2 border-black pb-1">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-2 border-b-2 border-black pb-1 font-[var(--font-label)]">$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong class=\"font-bold\">$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em class=\"italic\">$1</em>");

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-4 border-black pl-3 italic opacity-80 my-2 bg-[#f3f2ff] py-1">$1</blockquote>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr class="border-t-2 border-black my-3" />');

  // Tables (pipe-delimited)
  const tableRegex = /(\|.+\|[\r\n]+\|[-| :]+\|[\r\n]+((?:\|.+\|[\r\n]*)+))/g;
  html = html.replace(tableRegex, (match) => {
    const rows = match.trim().split("\n").filter((r) => r.trim());
    if (rows.length < 2) return match;

    const headerCells = rows[0].split("|").filter((c) => c.trim());
    const bodyRows = rows.slice(2);

    let table = '<table class="w-full border-2 border-black text-sm my-3 font-[var(--font-terminal)]"><thead><tr class="bg-[#0055FF] text-white">';
    for (const cell of headerCells) {
      table += `<th class="border-2 border-black p-1.5 text-left">${cell.trim()}</th>`;
    }
    table += "</tr></thead><tbody>";

    for (const row of bodyRows) {
      const cells = row.split("|").filter((c) => c.trim());
      table += "<tr>";
      for (const cell of cells) {
        table += `<td class="border-2 border-black p-1.5">${cell.trim()}</td>`;
      }
      table += "</tr>";
    }

    table += "</tbody></table>";
    return table;
  });

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal my-0.5">$1</li>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4 list-disc my-0.5">$1</li>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#0055FF] underline hover:bg-[#0055FF] hover:text-white px-0.5 transition-colors">$1</a>');

  // Paragraphs: double newline splits
  html = html.replace(/\n\n/g, '</p><p class="my-2">');

  // Single newline → <br>
  html = html.replace(/\n/g, "<br />");

  // Wrap in paragraph if not starting with block element
  if (!html.startsWith("<h") && !html.startsWith("<pre") && !html.startsWith("<table") && !html.startsWith("<blockquote") && !html.startsWith("<hr") && !html.startsWith("<li")) {
    html = `<p class="my-2">${html}</p>`;
  }

  return html;
}
