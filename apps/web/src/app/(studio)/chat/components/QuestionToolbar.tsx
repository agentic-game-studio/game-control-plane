"use client";

import { useState, useCallback } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { optionLetter } from "@/lib/question-options";

interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

interface QuestionToolbarProps {
  questionId: string;
  question: string;
  options: QuestionOption[];
  allowMultiple?: boolean;
  onAnswer: (questionId: string, selected: string[], customInput?: string) => void;
  disabled?: boolean;
}

export default function QuestionToolbar({
  questionId,
  question,
  options,
  allowMultiple = false,
  onAnswer,
  disabled = false,
}: QuestionToolbarProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const toggleOption = useCallback((id: string) => {
    if (disabled || isSubmitting) return;
    setSelected((prev) => {
      if (allowMultiple) {
        return prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id];
      }
      return [id];
    });
  }, [allowMultiple, disabled, isSubmitting]);

  const handleSubmit = useCallback(() => {
    if (selected.length === 0 || disabled || isSubmitting) return;
    setIsSubmitting(true);
    onAnswer(questionId, selected);
  }, [questionId, selected, disabled, isSubmitting, onAnswer]);

  const canSubmit = selected.length > 0 && !disabled && !isSubmitting;

  // Single-click submit for single-select questions
  const handleSingleClick = useCallback((id: string) => {
    if (disabled || isSubmitting) return;
    setSelected([id]);
    setIsSubmitting(true);
    onAnswer(questionId, [id]);
  }, [questionId, disabled, isSubmitting, onAnswer]);

  return (
    <div className="border-b-2 border-black bg-[#fafbff]">
      {/* Question header */}
      <div className="px-4 py-2 border-b border-[#e1e1ef]">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[#c13301] text-sm">quiz</span>
          <span className="font-[var(--font-label)] text-[10px] uppercase tracking-widest text-[#c13301]">
            Decision Required
          </span>
          {selected.length > 0 && (
            <span className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
              {selected.length} selected
            </span>
          )}
        </div>
      </div>

      {/* Question text */}
      <div
        className="px-4 py-2 font-[var(--font-terminal)] text-xs text-[#434656] border-b border-[#e1e1ef] line-clamp-2"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(question) }}
      />

      {/* Quick-select options */}
      <div className="flex items-center gap-2 px-4 py-2 overflow-x-auto">
        <span className="font-[var(--font-label)] text-[9px] uppercase tracking-widest text-[#737688] shrink-0">
          Quick-select:
        </span>
        {options.map((option, index) => {
          const letter = optionLetter(index);
          const isSelected = selected.includes(option.id);

          // For single-select, show as clickable card
          if (!allowMultiple) {
            return (
              <button
                key={option.id}
                onClick={() => handleSingleClick(option.id)}
                disabled={disabled || isSubmitting}
                className={`
                  shrink-0 px-3 py-2 border-2 font-[var(--font-label)] text-[10px] font-bold uppercase
                  transition-all duration-150 flex items-center gap-2
                  ${isSelected
                    ? "border-[#0055FF] bg-[#0055FF] text-white"
                    : "border-black bg-white hover:bg-black hover:text-white"
                  }
                  ${disabled || isSubmitting ? "opacity-50 cursor-not-allowed" : ""}
                `}
                title={option.description}
              >
                <span className="font-[var(--font-terminal)] text-sm">({letter})</span>
                <span>{option.label}</span>
              </button>
            );
          }

          // For multi-select, toggle behavior
          return (
            <button
              key={option.id}
              onClick={() => toggleOption(option.id)}
              disabled={disabled || isSubmitting}
              className={`
                shrink-0 px-3 py-2 border-2 font-[var(--font-label)] text-[10px] font-bold uppercase
                transition-all duration-150 flex items-center gap-2
                ${isSelected
                  ? "border-[#0055FF] bg-[#0055FF] text-white"
                  : "border-black bg-white hover:bg-black hover:text-white"
                }
                ${disabled || isSubmitting ? "opacity-50 cursor-not-allowed" : ""}
              `}
              title={option.description}
            >
              <span className={isSelected ? "text-white" : "text-[#737688]"}>
                <span className="material-symbols-outlined text-sm">
                  {isSelected ? "check_box" : "check_box_outline_blank"}
                </span>
              </span>
              <span className="font-[var(--font-terminal)] text-sm">({letter})</span>
              <span>{option.label}</span>
            </button>
          );
        })}

        {/* Submit button for multi-select */}
        {allowMultiple && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`
              shrink-0 px-4 py-2 border-2 font-[var(--font-label)] text-[10px] font-bold uppercase
              transition-all duration-150 flex items-center gap-2
              ${canSubmit
                ? "border-[#0055FF] bg-[#0055FF] text-white hover:bg-[#0044cc]"
                : "border-[#e1e1ef] bg-[#e7e7f5] text-[#737688] cursor-not-allowed"
              }
            `}
          >
            <span className="material-symbols-outlined text-sm">{isSubmitting ? "sync" : "check"}</span>
            {isSubmitting ? "SUBMITTING..." : "SUBMIT"}
          </button>
        )}
      </div>
    </div>
  );
}
