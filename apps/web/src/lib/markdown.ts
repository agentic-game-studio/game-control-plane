"use client";

/** Minimal markdown-to-HTML renderer (safe — escapes HTML first) */
export function renderMarkdown(md: string, options?: { wikilinks?: boolean }): string {
  // Convert literal \n (from LLM JSON) to actual newlines
  let html = md.replace(/\\n/g, "\n");

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

  // Task lists: - [ ] or - [x]
  html = html.replace(
    /^- \[ \] (.+)$/gm,
    '<li class="ml-4 list-disc my-0.5"><input type="checkbox" disabled class="mr-2 accent-black" />$1</li>'
  );
  html = html.replace(
    /^- \[x\] (.+)$/gi,
    '<li class="ml-4 list-disc my-0.5"><input type="checkbox" checked disabled class="mr-2 accent-black" />$1</li>'
  );

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del class="opacity-60 line-through">$1</del>');

  // Links [text](url) — allowlist safe schemes (S6 + C4 + 12-H22).
  // The previous blocklist was bypassable via ` Javascript:alert(1)`;
  // the previous allowlist chain still let through `java\nscript:alert(1)`
  // because browsers strip ASCII whitespace from href values before
  // scheme parsing. The 4th-pass C4 fix added a control-char reject and
  // an allowlist, but the test order was tight enough to leave
  // subtle bypasses: `url.trim()` only strips ASCII whitespace, not
  // Unicode whitespace (` `, ` `-` `) which browsers
  // also strip before scheme parsing, and the allowlist was
  // a positive list, not a deny-list — a future maintainer could
  // add `data:` or `javascript:` to the allowed prefix list and
  // re-introduce XSS.
  //
  // 12-H22: tighten further with three independent checks:
  //  1. Reject any URL containing ASCII control chars OR Unicode
  //     whitespace (browser-stripped-before-parse category).
  //  2. Strip leading/trailing ASCII + Unicode whitespace before
  //     scheme parsing (the regex `^https?:` only matches if the
  //     first non-whitespace char is the scheme letter, not a
  //     Unicode-seeming prefix).
  //  3. Defence-in-depth scheme deny-list: explicitly reject
  //     `javascript:`, `data:`, `vbscript:`, `file:` — schemes
  //     browsers interpret as code or local file access. Even
  //     if the allowlist has a bug, this deny-list catches it.
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    // 1. control chars + Unicode whitespace (browsers strip both before scheme parse)
    if (new RegExp("[\\x00-\\x1f\\x7f\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]").test(url)) {
      return `[${text}](${url})`;
    }
    // 2. ASCII + Unicode trim
    const trimmed = url.replace(new RegExp("^[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+|[\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+$", "g"), "");
    // 3. deny-list explicit dangerous schemes. Lowercase first so
    //    `JAVASCRIPT:` and `Javascript:` (which some HTTP clients
    //    can be tricked into normalising) are caught by the same
    //    regex — case-insensitive flags are below, but a redundant
    //    lowercase guard makes the intent obvious to readers and
    //    protects against a future maintainer removing the `/i`
    //    flag from the allowlist test below.
    const normalised = trimmed.toLowerCase();
    if (/^(javascript|data|vbscript|file):/i.test(normalised)) {
      return `[${text}](${url})`;
    }
    // Allowlist safe schemes.
    if (!/^(https?:|mailto:|#|\/|\/\/)/i.test(trimmed)) return `[${text}](${url})`;
    const safeHref = trimmed.replace(/"/g, "&quot;");
    return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="text-[#0055FF] underline hover:bg-[#0055FF] hover:text-white px-0.5 transition-colors">${text}</a>`;
  });

  // Wikilinks [[target]] — when the `wikilinks` option is set, render as
  // clickable spans (wiki viewer) instead of plain text. The slug is
  // sanitized to a-z, 0-9, `-` to mirror the previous DocumentViewer
  // behavior; the inner `target` text is HTML-escaped upstream, so the
  // span is XSS-safe.
  //
  // 17-C1: previously, `DocumentViewer.tsx` shipped its own `renderMarkdown`
  // that didn't apply the 4-layer XSS defenses from this file (no link
  // handler at all, but a future maintainer adding one would have shipped
  // an XSS because the local renderer skipped the URL allowlist + control-
  // char reject). Centralising here so the wiki viewer can't drift from
  // the chat renderer.
  if (options?.wikilinks) {
    html = html.replace(/\[\[([^\]]+)\]\]/g, (_m, target) => {
      const slug = target.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      return `<span data-wikilink="${slug}" class="text-blue-600 underline cursor-pointer hover:text-blue-800">[[${target}]]</span>`;
    });
  }

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
