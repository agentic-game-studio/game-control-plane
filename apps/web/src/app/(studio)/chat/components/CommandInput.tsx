"use client";

import { useState, useRef, useEffect, type KeyboardEvent } from "react";

interface CommandInputProps {
  onSend: (input: string) => void;
}

const SLASH_COMMANDS = [
  { cmd: "/spawn", hint: "Bring an agent online", icon: "smart_toy" },
  { cmd: "/approve", hint: "Approve last agent request", icon: "check_circle" },
  { cmd: "/done", hint: "Complete agent task", icon: "task_alt" },
  { cmd: "/clear", hint: "Clear chat history", icon: "delete" },
  { cmd: "/help", hint: "Show available commands", icon: "help" },
  { cmd: "/cost", hint: "Show estimated costs", icon: "attach_money" },
  { cmd: "/diff", hint: "View recent changes", icon: "compare" },
];

export default function CommandInput({ onSend }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [showHints, setShowHints] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hintsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Filter commands based on input
  const filteredCommands = SLASH_COMMANDS.filter((cmd) =>
    cmd.cmd.toLowerCase().startsWith(value.toLowerCase())
  );

  const handleSend = (text?: string) => {
    const input = text ?? value;
    if (!input.trim()) return;
    onSend(input);
    setValue("");
    setShowHints(false);
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
          setValue(cmd.cmd + " ");
          setShowHints(false);
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setValue(newValue);

    // Show hints when user types /
    if (newValue.startsWith("/")) {
      setShowHints(true);
      setSelectedIndex(0);
    } else {
      setShowHints(false);
    }
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-white border-t-2 border-black p-4 z-30 shadow-[0_-4px_0_0_rgba(0,0,0,0.05)]">
      <div className="max-w-4xl mx-auto flex gap-4">
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

          {/* Slash command hints */}
          {showHints && filteredCommands.length > 0 && (
            <div
              ref={hintsRef}
              className="absolute bottom-full left-0 right-0 mb-1 border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] max-h-48 overflow-y-auto"
            >
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.cmd}
                  onClick={() => {
                    setValue(cmd.cmd + " ");
                    setShowHints(false);
                    textareaRef.current?.focus();
                  }}
                  className={`w-full px-3 py-2 flex items-center gap-3 text-left font-[var(--font-terminal)] text-sm hover:bg-[#f0f0ff] ${
                    index === selectedIndex ? "bg-[#e7e7f5]" : ""
                  }`}
                >
                  <span className="material-symbols-outlined text-base text-[#0055FF]">
                    {cmd.icon}
                  </span>
                  <span className="font-bold text-[#0055FF]">{cmd.cmd}</span>
                  <span className="text-[#737688]">{cmd.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => handleSend()}
          className="h-12 px-6 border-2 border-black bg-black text-white font-[var(--font-label)] text-xs font-bold uppercase hover:bg-[#0055FF] retro-press shadow-[2px_2px_0_0_rgba(0,85,255,1)] transition-colors flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">send</span>
          EXECUTE
        </button>
      </div>
    </div>
  );
}
