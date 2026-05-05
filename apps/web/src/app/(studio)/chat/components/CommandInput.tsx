"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface CommandInputProps {
  onSend: (input: string, images?: string[]) => void;
  isLoading?: boolean;
}

const COMMANDS = [
  { cmd: "/spawn", desc: "Bring an agent online" },
  { cmd: "/approve", desc: "Approve last agent request" },
  { cmd: "/done", desc: "Complete agent task" },
  { cmd: "/compact", desc: "Compact session into new generation" },
  { cmd: "/clear", desc: "Clear the chat" },
  { cmd: "/help", desc: "Show available commands" },
  { cmd: "/cost", desc: "Show mock token usage" },
  { cmd: "/diff", desc: "Show recent changes" },
];

export default function CommandInput({ onSend, isLoading }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Filter commands based on input
  const filteredCommands = COMMANDS.filter((cmd) =>
    cmd.cmd.toLowerCase().startsWith(value.toLowerCase())
  );

  const handleSend = (text?: string) => {
    const input = text ?? value;
    if (!input.trim() && pendingImages.length === 0) return;
    if (isLoading) return;
    onSend(input, pendingImages.length > 0 ? pendingImages : undefined);
    setValue("");
    setShowHints(false);
    setPendingImages([]);
  };

  const handleSelectCommand = (cmd: string) => {
    setValue(cmd + " ");
    setShowHints(false);
    textareaRef.current?.focus();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    setShowHints(v.startsWith("/") && !v.includes(" "));
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showHints && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          handleSelectCommand(cmd.cmd);
        }
        return;
      }
      if (e.key === "Escape") {
        setShowHints(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items;
    const imageItems: DataTransferItem[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    e.preventDefault();

    const newImages: string[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      const base64 = await fileToBase64(file);
      newImages.push(base64);
    }

    setPendingImages((prev) => [...prev, ...newImages]);
  };

  const removeImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-black p-4 z-30 shadow-[0_-4px_0_0_rgba(0,0,0,0.05)]">
      <div className="max-w-4xl mx-auto flex flex-col gap-3 relative">
        {/* Pending image previews */}
        {pendingImages.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {pendingImages.map((img, i) => (
              <div key={i} className="relative group border-2 border-black shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
                <img src={img} alt={`Pasted ${i + 1}`} className="h-16 w-auto object-cover" />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-[#df2b31] text-white border border-black flex items-center justify-center text-xs hover:bg-black"
                  title="Remove image"
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
              disabled={isLoading}
              className={`w-full h-12 border-2 border-black bg-white p-3 font-[var(--font-terminal)] text-base focus:outline-none focus:ring-2 focus:ring-[#0055FF] resize-none ${
                isLoading ? "opacity-50 cursor-not-allowed bg-[#f3f2ff]" : ""
              }`}
              placeholder={isLoading ? "Processing..." : "Enter command or reply..."}
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
            disabled={isLoading}
            className={`h-12 px-6 border-2 border-black font-[var(--font-label)] text-xs font-bold uppercase retro-press flex items-center gap-2 transition-colors ${
              isLoading
                ? "bg-[#e7e7f5] text-[#737688] cursor-not-allowed shadow-none"
                : "bg-black text-white hover:bg-[#0055FF] shadow-[2px_2px_0_0_rgba(0,85,255,1)]"
            }`}
          >
            <span
              className={`material-symbols-outlined text-sm ${isLoading ? "animate-spin" : ""}`}
            >
              {isLoading ? "sync" : "send"}
            </span>
            {isLoading ? "WORKING..." : "EXECUTE"}
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
