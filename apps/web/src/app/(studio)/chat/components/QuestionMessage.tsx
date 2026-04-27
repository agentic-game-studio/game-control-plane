"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import type { ChatMessage } from "@/hooks/useCommandRoom";
import { renderMarkdown } from "@/lib/markdown";

interface QuestionMessageProps {
  msg: ChatMessage;
  onAnswer: (questionId: string, selected: string[], customInput?: string) => void;
  sender?: string;
  isAnswered?: boolean;
  answerContent?: string;
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hr = String(d.getHours()).padStart(2, "0");
    const mn = String(d.getMinutes()).padStart(2, "0");
    return `${mo}/${day} ${hr}:${mn}`;
  } catch {
    return ts;
  }
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export default function QuestionMessage({ msg, onAnswer, sender, isAnswered, answerContent }: QuestionMessageProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // isAnswered from props (persistent across refresh), hasSubmitted from local state (immediate feedback)
  const isLocked = hasSubmitted || !!isAnswered;

  const question = msg.question;
  if (!question) return null;

  const isMultiple = question.allowMultiple;
  const hasCustomInput = question.allowCustomInput;

  const toggleOption = useCallback((id: string) => {
    if (isLocked) return;
    setSelected((prev) => {
      if (isMultiple) {
        return prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      }
      return [id];
    });
  }, [isMultiple, isLocked]);

  const handleSubmit = useCallback(() => {
    if (selected.length === 0 && !customInput.trim()) return;
    setIsSubmitting(true);
    onAnswer(question.questionId, selected, customInput.trim() || undefined);
    setHasSubmitted(true);
  }, [selected, customInput, question.questionId, onAnswer]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (isLocked) return;
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
  }, [question.options, toggleOption, isLocked]);

  // Parse selected IDs from answerContent when answered via history (refresh/tab switch)
  const parsedSelected = useMemo(() => {
    if (!answerContent) return [];
    const match = answerContent.match(/Selected: ([^\n]+)/);
    if (!match) return [];
    return match[1].split(", ").map((s) => s.trim()).filter(Boolean);
  }, [answerContent]);

  const effectiveSelected = isLocked && parsedSelected.length > 0 ? parsedSelected : selected;
  const isSelected = (id: string) => effectiveSelected.includes(id);
  const canSubmit = (selected.length > 0 || (hasCustomInput && customInput.trim().length > 0)) && !isLocked;
  const selectedCount = effectiveSelected.length;

  return (
    <div className="flex gap-4 w-full max-w-4xl self-start">
      {/* Agent avatar */}
      <div className="w-12 h-12 shrink-0 border-2 border-black bg-[#c13301] flex justify-center items-center text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] relative z-10">
        <span className="material-symbols-outlined">help</span>
      </div>

      <div className="flex-1">
        {/* Sender + timestamp row */}
        <div className="flex items-baseline gap-3 mb-1.5 ml-2">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase">
            {sender ? sender.replace(/-/g, "_").toUpperCase() : "PRODUCER"}
          </span>
          <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
            {formatTime(msg.timestamp)}
          </span>
          <span className="font-[var(--font-label)] text-[9px] uppercase bg-black text-white px-1.5 py-0.5 border border-black">
            {isMultiple ? "MULTI-SELECT" : "SINGLE-SELECT"}
          </span>
        </div>

        {/* Message bubble */}
        <div className="relative group">
          <div className="absolute left-[-10px] top-4 w-0 h-0 border-y-[6px] border-y-transparent border-r-[10px] border-r-black z-0" />
          <div className="absolute left-[-6px] top-[18px] w-0 h-0 border-y-[4px] border-y-transparent border-r-[8px] border-r-white z-10" />

          <div className="border-2 border-black bg-white shadow-[4px_4px_0_0_rgba(0,0,0,1)] relative z-10 overflow-hidden">
            {/* Header bar */}
            <div className="bg-black p-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-white text-sm">quiz</span>
                <span className="font-[var(--font-label)] text-[10px] uppercase text-white tracking-widest">
                  Decision Required
                </span>
              </div>
              {isLocked ? (
                <span className="font-[var(--font-terminal)] text-[10px] text-white bg-[#2ECC71] px-2 py-0.5 border border-white flex items-center gap-1">
                  <span className="material-symbols-outlined text-[10px]">check_circle</span>
                  SUBMITTED
                </span>
              ) : selectedCount > 0 ? (
                <span className="font-[var(--font-terminal)] text-[10px] text-white bg-[#c13301] px-2 py-0.5 border border-white">
                  {selectedCount} selected
                </span>
              ) : null}
            </div>

            <div className="p-5">
              {/* Question text — render markdown */}
              <div
                className="font-[var(--font-terminal)] text-[15px] mb-5 leading-relaxed prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(question.question) }}
              />

              {/* Options */}
              <div className="space-y-2.5 mb-5">
                {question.options.map((option, index) => {
                  const letter = OPTION_LETTERS[index] ?? String(index + 1);
                  const checked = isSelected(option.id);

                  return (
                    <button
                      key={option.id}
                      ref={(el) => { optionRefs.current[index] = el; }}
                      onClick={() => toggleOption(option.id)}
                      onKeyDown={(e) => handleKeyDown(e, index)}
                      disabled={isLocked}
                      className={`
                        w-full text-left p-0 border-2 transition-all duration-150
                        ${isLocked
                          ? checked
                            ? "border-[#0055FF] bg-[#f0f4ff] opacity-70"
                            : "border-[#e1e1ef] bg-[#faf8ff] opacity-50"
                          : checked
                          ? "border-[#0055FF] bg-[#f0f4ff] shadow-none"
                          : "border-black bg-white hover:border-[#0055FF] hover:bg-[#fafbff] shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]"
                        }
                      `}
                    >
                      <div className="flex items-stretch">
                        {/* Letter indicator */}
                        <div className={`
                          w-10 shrink-0 flex items-center justify-center border-r-2 transition-colors
                          ${checked
                            ? "border-[#0055FF] bg-[#0055FF] text-white"
                            : "border-black bg-[#f3f2ff] text-[#434656]"
                          }
                        `}>
                          <span className="font-[var(--font-terminal)] text-sm font-bold">
                            {letter}
                          </span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 p-3 flex items-center gap-3">
                          {/* Checkbox/Radio */}
                          <div className={`
                            w-5 h-5 border-2 shrink-0 flex items-center justify-center transition-colors
                            ${isMultiple ? "" : "rounded-full"}
                            ${checked ? "border-[#0055FF] bg-[#0055FF]" : "border-black bg-white"}
                          `}>
                            {checked && (
                              <span className="material-symbols-outlined text-white text-sm">
                                {isMultiple ? "check" : "circle"}
                              </span>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <span className={`
                              font-[var(--font-terminal)] text-sm block
                              ${checked ? "font-bold text-[#0055FF]" : "text-[#191b25]"}
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
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Custom input */}
              {hasCustomInput && (
                <div className="mb-5">
                  <label className="block font-[var(--font-label)] text-[10px] uppercase text-[#737688] tracking-widest mb-1.5">
                    Other / Additional Details
                  </label>
                  <textarea
                    value={customInput}
                    onChange={(e) => isLocked ? undefined : setCustomInput(e.target.value)}
                    placeholder={isLocked ? "Submitted" : "Type your own response here..."}
                    disabled={isLocked}
                    className={`w-full border-2 p-3 font-[var(--font-terminal)] text-sm resize-none focus:outline-none bg-[#faf8ff] placeholder:text-[#737688]/50 ${
                      isLocked ? "border-[#e1e1ef] text-[#737688] cursor-not-allowed" : "border-black focus:border-[#0055FF]"
                    }`}
                    rows={3}
                  />
                </div>
              )}

              {/* Submit footer */}
              <div className="flex items-center justify-between pt-4 border-t-2 border-black">
                <span className="font-[var(--font-terminal)] text-xs text-[#737688]">
                  {isLocked
                    ? answerContent
                      ? `Submitted: ${answerContent}`
                      : `Submitted: ${selected.map((id) => question.options.find((o) => o.id === id)?.label).filter(Boolean).join(", ")}`
                    : isMultiple
                    ? `Select ${selectedCount > 0 ? `${selectedCount} selected` : "one or more"}`
                    : "Select one option"}
                  {hasCustomInput && !isLocked && " or add details below"}
                  {!answerContent && isLocked && customInput.trim() && ` | Additional: ${customInput.trim()}`}
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!canSubmit || isSubmitting || isLocked}
                  className={`
                    border-2 px-5 py-2.5 font-[var(--font-label)] text-xs font-bold uppercase
                    transition-all duration-150 flex items-center gap-2
                    ${isLocked
                      ? "border-[#2ECC71] bg-[#2ECC71] text-white cursor-default"
                      : canSubmit && !isSubmitting
                      ? "border-black bg-[#0055FF] text-white hover:bg-black hover:text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]"
                      : "border-black bg-[#e7e7f5] text-[#737688] cursor-not-allowed"
                    }
                  `}
                >
                  <span className="material-symbols-outlined text-sm">
                    {isLocked ? "check_circle" : isSubmitting ? "sync" : "send"}
                  </span>
                  {isLocked ? "SUBMITTED" : isSubmitting ? "SUBMITTING..." : "SUBMIT"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
