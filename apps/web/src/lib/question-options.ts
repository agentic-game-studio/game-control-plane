/**
 * Single source of truth for the A..H letter labels used to prefix
 * multi-choice question options. Previously duplicated in
 * QuestionMessage.tsx and QuestionToolbar.tsx — if one component
 * was edited (e.g. to add an "I" option for 9+ items) the other
 * would silently fall back to a numeric index and render an
 * inconsistent UI.
 *
 * Eight slots matches the LLM AskUserQuestion tool's max options
 * (1-4 multiSelect, but multi-question rounds can stack up to 8
 * visible options in the same chat message). Beyond 8 the helper
 * returns undefined and consumers should fall back to a numeric
 * label or split the question.
 */
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export function optionLetter(index: number): string {
  return OPTION_LETTERS[index] ?? String(index + 1);
}
