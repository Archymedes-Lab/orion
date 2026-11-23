// 0–3 adaptive questions, highest information gain first (§4, §5).
// Accepts any extraction-shaped object (local or server-validated).
import type { Stakes } from "../types.ts";

interface QuestionSource {
  stakes: Stakes;
  factors: { label: string }[];
  missingInformation: { question: string; expectedInformationGain: number }[];
}

// Every answer is "this factor matters most" (it boosts that factor's weight),
// so every question must ask exactly that, about the factors actually on screen.
const FRAMES = [
  (list: string) => `Which matters most to you right now: ${list}?`,
  (list: string) => `A year from now, which will you be glad you put first: ${list}?`,
  (list: string) => `Which would you most regret getting wrong: ${list}?`,
];

function listOf(labels: string[]): string {
  const names = labels.map((l) => l.toLowerCase());
  return names.length <= 2 ? names.join(" or ") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

export function generateQuestions(
  extraction: QuestionSource,
  alreadyAsked = 0
): { question: string; expectedInformationGain: number }[] {
  const budget = extraction.stakes === "tiny" ? 1 : extraction.stakes === "normal" ? 2 : 3;
  const remaining = Math.max(0, budget - alreadyAsked);
  // One factor leaves nothing to prioritise.
  if (remaining === 0 || extraction.factors.length < 2) return [];
  const list = listOf(extraction.factors.map((f) => f.label));
  const extra = extraction.missingInformation ?? [];
  const merged = [
    ...extra,
    ...FRAMES.map((frame, i) => ({
      question: frame(list),
      expectedInformationGain: Math.round((0.9 - i * 0.2) * 100) / 100,
    })),
  ];
  return merged.slice(0, remaining);
}
