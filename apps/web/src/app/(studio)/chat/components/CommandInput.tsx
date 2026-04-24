"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface CommandInputProps {
  onSend: (input: string) => void;
}

const COMMANDS = [
  { cmd: "/clear", desc: "Clear the chat" },
  { cmd: "/help", desc: "Show available commands" },
  { cmd: "/spawn", desc: "Bring an agent online" },
  { cmd: "/cost", desc: "Show mock token usage" },
  { cmd: "/diff", desc: "Show recent changes" },
];

export default function CommandInput({ onSend }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    setShowHints(v.startsWith("/") && !v.includes(" "));
  };

  const handleSelectCommand = (cmd: string) => {
    setValue(cmd + " ");
    setShowHints(false);
    textareaRef.current?.focus();
  };

  const handleSend = () => {
    if (!value.trim()) return;
    onSend(value);
    setValue("");
    setShowHints(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-black p-4 z-30 shadow-[0_-4px_0_0_rgba(0,0,0,0.05)]">
      <div className="max-w-4xl mx-auto flex gap-4 relative">
        {showHints && (
          <div className="absolute bottom-full left-0 mb-2 w-full bg-white border-2 border-black shadow-[4px_4px_0_0_rgba(0,0,0,1)] z-40">
            <div className="p-2">
              <span className="font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest block mb-2">Commands</span>
              {COMMANDS.map((c) => (
                <button
                  key={c.cmd}
                  onClick={() => handleSelectCommand(c.cmd)}
                  className="w-full flex items-center gap-3 p-2 hover:bg-[#f3f2ff] text-left transition-colors"
                >
                  <code className="font-[var(--font-terminal)] text-sm text-[#0055FF] font-bold bg-white border border-black px-2 py-0.5 text-xs">{c.cmd}</code>
                  <span className="font-[var(--font-terminal)] text-xs text-[#434656]">{c.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
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
