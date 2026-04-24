"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useCommandRoom";

interface QuestionMessageProps {
  msg: ChatMessage;
  onAnswer: (questionId: string, selected: string[], customInput?: string) => void;
  sender?: string;
}

export default function QuestionMessage({ msg, onAnswer, sender }: QuestionMessageProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const question = msg.question;
  if (!question) return null;

  const isMultiple = question.allowMultiple;
  const hasCustomInput = question.allowCustomInput;

  const toggleOption = useCallback((id: string) => {
    setSelected((prev) => {
      if (isMultiple) {
        return prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      }
      return [id];
    });
  }, [isMultiple]);

  const handleSubmit = useCallback(() => {
    if (selected.length === 0 && !customInput.trim()) return;
    setIsSubmitting(true);
    onAnswer(question.questionId, selected, customInput.trim() || undefined);
  }, [selected, customInput, question.questionId, onAnswer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % question.options.length;
      optionRefs.current[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = (index - 1 + question.options.length) % question.options.length;
      optionRefs.current[prevIndex]?.focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleOption(question.options[index].id);
    }
  }, [question.options, toggleOption]);

  const isSelected = (id: string) => selected.includes(id);
  const canSubmit = selected.length > 0 || (hasCustomInput && customInput.trim().length > 0);

  return (
    <div className="flex gap-4 w-full max-w-4xl self-start">
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#0055FF] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">help</span>
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3 mb-1 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">
            {sender ? sender.replace(/-/g, "_").toUpperCase() : "GAME_DIRECTOR"}
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">{msg.timestamp}</span>
        </div>
        <div className="relative group">
          <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
          <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />
          <div className="border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10">
            {/* Question text */}
            <p className="font-[var(--font-terminal)] text-base mb-4">
              {question.question}
            </p>

            {/* Options */}
            <div className="space-y-2 mb-4">
              {question.options.map((option, index) => (
                <button
                  key={option.id}
                  ref={(el) => { optionRefs.current[index] = el; }}
                  onClick={() => toggleOption(option.id)}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  className={`
                    w-full text-left p-3 border-2 transition-all duration-150
                    ${isSelected(option.id)
                      ? "border-[#0055FF] bg-[#f0f4ff]"
                      : "border-black bg-white hover:border-[#0055FF] hover:bg-[#fafbff]"
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    {/* Checkbox/Radio indicator */}
                    <div className={`
                      w-5 h-5 border-2 shrink-0 flex items-center justify-center
                      ${isMultiple ? "rounded" : "rounded-full"}
                      ${isSelected(option.id) ? "border-[#0055FF] bg-[#0055FF]" : "border-black"}
                    `}>
                      {isSelected(option.id) && (
                        <span className="material-symbols-outlined text-white text-sm">
                          {isMultiple ? "check" : "circle"}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <span className={`
                        font-[var(--font-terminal)] text-sm
                        ${isSelected(option.id) ? "font-bold text-[#0055FF]" : ""}
                      `}>
                        {option.label}
                      </span>
                      {option.description && (
                        <p className="font-[var(--font-terminal)] text-xs text-[#737688] mt-0.5">
                          {option.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Custom input */}
            {hasCustomInput && (
              <div className="mb-4">
                <label className="block font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1">
                  Other / Additional Details
                </label>
                <textarea
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  placeholder="Add your own input..."
                  className="w-full border-2 border-black p-2 font-[var(--font-terminal)] text-sm resize-none focus:outline-none focus:border-[#0055FF]"
                  rows={2}
                />
              </div>
            )}

            {/* Submit button */}
            <div className="flex items-center justify-between pt-2 border-t-2 border-black">
              <span className="font-[var(--font-terminal)] text-xs text-[#737688]">
                {isMultiple ? "Select multiple options" : "Select one option"}
                {hasCustomInput && " or enter custom input"}
              </span>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                className={`
                  border-2 border-black px-4 py-2 font-[var(--font-label)] text-xs font-bold uppercase
                  transition-all duration-150 shadow-[2px_2px_0_0_rgba(0,0,0,1)]
                  ${canSubmit && !isSubmitting
                    ? "bg-[#0055FF] text-white hover:bg-black hover:text-white"
                    : "bg-[#e7e7f5] text-[#737688] cursor-not-allowed"
                  }
                `}
              >
                {isSubmitting ? "SUBMITTING..." : "SUBMIT"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
