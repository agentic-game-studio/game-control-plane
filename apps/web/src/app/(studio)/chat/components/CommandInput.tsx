"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface CommandInputProps {
  onSend: (input: string, images?: string[]) => void;
  isLoading?: boolean;
  queueCount?: number;
  statusHint?: string;
}

const MAX_PASTED_IMAGES = 4;
const MAX_IMAGE_BYTES = 1_000_000; // 1MB per image; matches the 5MB body limit on the API

export const COMMANDS = [
  { cmd: "/autonomous", desc: "Start autonomous production loop" },
  { cmd: "/spawn", desc: "Bring an agent online (manual)" },
  { cmd: "/approve", desc: "Approve last agent request" },
  { cmd: "/done", desc: "Complete agent task" },
  { cmd: "/compact", desc: "Compact session into new generation" },
  { cmd: "/clear", desc: "Clear the chat" },
  { cmd: "/stop", desc: "Stop processing + clear queue" },
  { cmd: "/help", desc: "Show available commands" },
  { cmd: "/cost", desc: "Show token usage (legacy)" },
  { cmd: "/diff", desc: "Show recent changes" },
  { cmd: "/plan", desc: "Create execution plan" },
  { cmd: "/sprint", desc: "Summarize current sprint" },
  { cmd: "/verify", desc: "Run auto-verification" },
  { cmd: "/context", desc: "Show context window usage" },
  { cmd: "/inject", desc: "Inject context into producer" },
  { cmd: "/consult", desc: "Consult a director" },
  { cmd: "/tree", desc: "Show agent hierarchy" },
  { cmd: "/mcp", desc: "Check Godot MCP status" },
  { cmd: "/export", desc: "Export session as markdown" },
  { cmd: "/ralphloop", desc: "Run research→plan→code→verify loop" },
];

interface PendingImage {
  file: File;
  previewUrl: string;
}

export default function CommandInput({ onSend, isLoading, queueCount = 0, statusHint }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Store File objects (not Base64) and use URL.createObjectURL for the preview.
  // This avoids the memory cost of base64-encoding every pasted image at
  // paste time — a 2MB PNG becomes a ~2.7MB base64 string kept in React state
  // until the user sends or removes the image. We convert to base64 only when
  // the user actually sends. The preview URL is revoked on remove/unmount so
  // we don't leak object URLs across renders.
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);

  // Revoke any object URLs we still hold when the component unmounts so the
  // browser can release the underlying blob memory.
  useEffect(() => {
    return () => {
      pendingImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    };
    // We intentionally only run this on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Filter commands based on input
  const filteredCommands = COMMANDS.filter((cmd) =>
    cmd.cmd.toLowerCase().startsWith(value.toLowerCase())
  );

  const handleSend = async (text?: string) => {
    const input = text ?? value;
    if (!input.trim() && pendingImages.length === 0) return;

    // Convert Files → base64 at send time (not paste time) so the heavy
    // strings only exist in memory during the API call.
    let base64Images: string[] | undefined;
    if (pendingImages.length > 0) {
      base64Images = await Promise.all(pendingImages.map((img) => fileToBase64(img.file)));
    }
    onSend(input, base64Images);
    setValue("");
    setShowHints(false);
    // Revoke preview URLs and clear pending state. Use the setter form so we
    // get the current list at the time of clearing.
    setPendingImages((current) => {
      current.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // 18-C-hints-dead: if the hints dropdown is open and the user
      // hits Enter, prefer selecting the highlighted command over
      // sending raw text. This matches the visual affordance of the
      // highlighted item and prevents the user from having to mouse
      // over to confirm a pick.
      if (showHints && filteredCommands.length > 0) {
        const pick = filteredCommands[selectedIndex] ?? filteredCommands[0];
        if (pick) {
          handleSelectCommand(pick.cmd);
          return;
        }
      }
      handleSend();
      return;
    }
    // 18-C-hints-dead: arrow-key navigation through the hints list.
    if (showHints && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowHints(false);
        return;
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    // 18-C-hints-dead: show the slash-command autocomplete dropdown
    // whenever the input starts with "/" and could match at least one
    // command. Previously `showHints` was initialized to `false` and
    // only ever set to `false` (on send / on select), so the dropdown
    // never appeared — typing `/spawn`, `/help`, etc. silently
    // matched nothing visible. Reset selectedIndex so keyboard
    // navigation always starts at the first match.
    const hasLeadingSlash = next.trimStart().startsWith("/");
    if (!hasLeadingSlash) {
      if (showHints) setShowHints(false);
    } else {
      const matches = COMMANDS.filter((cmd) =>
        cmd.cmd.toLowerCase().startsWith(next.trimStart().toLowerCase()),
      );
      if (matches.length === 0) {
        if (showHints) setShowHints(false);
      } else if (!showHints) {
        setShowHints(true);
        setSelectedIndex(0);
      }
    }
  };

  const handleSelectCommand = (cmd: string) => {
    setValue(cmd);
    setShowHints(false);
    textareaRef.current?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const imageItems: DataTransferItem[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    e.preventDefault();

    setPendingImages((prev) => {
      const remainingSlots = MAX_PASTED_IMAGES - prev.length;
      if (remainingSlots <= 0) {
        // Already at the cap — silently drop rather than spam alerts on
        // bulk paste. Browser will show the images in the clipboard tool
        // until the user sends or removes existing ones.
        return prev;
      }
      const accepted = imageItems.slice(0, remainingSlots);
      const newEntries: PendingImage[] = [];
      for (const item of accepted) {
        const file = item.getAsFile();
        if (!file) continue;
        if (file.size > MAX_IMAGE_BYTES) {
          // Skip oversized — converting these to base64 at send time would
          // bloat the request past the 5MB body limit. Drop silently; users
          // can paste smaller images or use a file upload route.
          continue;
        }
        newEntries.push({ file, previewUrl: URL.createObjectURL(file) });
      }
      return [...prev, ...newEntries];
    });
  };

  const removeImage = (index: number) => {
    setPendingImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-black p-4 z-30 shadow-[0_-4px_0_0_rgba(0,0,0,0.05)]">
      <div className="max-w-4xl mx-auto flex flex-col gap-3 relative">
        {/* Pending image previews */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                <img src={img.previewUrl} alt={`Pasted ${i + 1}`} className="h-16 w-auto object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-[#df2b31] text-white border border-black flex items-center justify-center text-xs hover:bg-black"
                  title="Remove image"
                  aria-label={`Remove pasted image ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-4 relative">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              className="w-full h-12 border-2 border-black bg-white p-3 font-[var(--font-terminal)] text-base focus:outline-none focus:ring-2 focus:ring-[#0055FF] resize-none"
              placeholder={
                queueCount > 0
                  ? `${queueCount} in queue — type to add more...`
                  : isLoading
                    ? "Processing... (type to queue next)"
                    : statusHint ?? "Enter command or reply..."
              }
            />

            {/* Slash command hints */}
            {showHints && filteredCommands.length > 0 && (
              <div
                ref={hintsRef}
                className="absolute bottom-full left-0 right-0 mb-1 border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] max-h-48 overflow-y-auto"
              >
                <div className="p-2 border-b border-[#e1e1ef]">
                  <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest">Commands</span>
                </div>
                {filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.cmd}
                    onClick={() => handleSelectCommand(cmd.cmd)}
                    className={`w-full px-3 py-2 flex items-center gap-3 text-left font-[var(--font-terminal)] text-sm hover:bg-[#f0f0ff] ${
                      index === selectedIndex ? "bg-[#e7e7f5]" : ""
                    }`}
                  >
                    <code className="font-[var(--font-terminal)] text-sm text-[#0055FF] font-bold bg-white border border-black px-2 py-0.5 text-xs">
                      {cmd.cmd}
                    </code>
                    <span className="text-[#434656]">{cmd.desc}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => handleSend()}
            className={`h-12 px-6 border-2 border-black font-[var(--font-label)] text-xs font-bold uppercase retro-press flex items-center gap-2 transition-colors ${
              isLoading
                ? "bg-[#0055FF] text-white shadow-[2px_2px_0_0_rgba(0,85,255,1)]"
                : "bg-black text-white hover:bg-[#0055FF] shadow-[2px_2px_0_0_rgba(0,85,255,1)]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {queueCount > 0 ? "playlist_add" : isLoading ? "sync" : "send"}
            </span>
            {queueCount > 0 ? `QUEUE +${queueCount}` : isLoading ? "WORKING..." : "EXECUTE"}
          </button>
        </div>
      </div>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
