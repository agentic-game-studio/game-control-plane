"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface CommandInputProps {
  onSend: (input: string) => void;
}

export default function CommandInput({ onSend }: CommandInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSend = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-black p-4 z-30 shadow-[0_-4px_0_0_rgba(0,0,0,0.05)]">
      <div className="max-w-4xl mx-auto flex gap-4">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full h-12 border-2 border-black bg-white p-3 pr-10 font-[var(--font-terminal)] text-base focus:outline-none focus:ring-2 focus:ring-[#0055FF] resize-none"
            placeholder="Enter command or reply..."
          />
          <div className="absolute right-3 top-3 text-[#737688]">
            <span className="animate-pulse block w-2 h-4 bg-black" />
          </div>
        </div>
        <button
          onClick={handleSend}
          className="h-12 px-6 border-2 border-black bg-black text-white font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] retro-press shadow-[2px_2px_0_0_rgba(0,85,255,1)] transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">send</span>
          EXECUTE
        </button>
      </div>
    </div>
  );
}
