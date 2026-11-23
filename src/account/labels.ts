// Words for values ORION stores as names: a decision's category, its stakes and status, an outcome rating, and the
// enum values the archive reads back (`very_hard`, `strongly_against`). The stored value never changes; only what is
// shown does. In English each one reads exactly as it always has.
import { msg, t } from "../i18n/index.ts";

/** Stored names written out as words: `GO_NO_GO` → "Go no go", `very_hard` → "Very hard". */
export const words = (value: unknown): string => {
  const raw = (value === null || value === undefined ? "" : String(value)).replace(/[_-]+/g, " ").trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "";
};

// Every value the screens and exports can show, so the Korean dictionary covers each one. The English is what
// `words()` makes of the stored value.
const TERMS = new Set([
  // Decision status, stakes, robustness, stability
  msg("Open"), msg("Decided"), msg("Tiny"), msg("Normal"), msg("Significant"), msg("Major"),
  msg("Robust"), msg("Fragile"), msg("Tossup"), msg("High"), msg("Medium"), msg("Low"), msg("Moderate"),
  // Reversibility
  msg("Easy"), msg("Somewhat"), msg("Hard"), msg("Very hard"),
  // Outcome ratings
  msg("Great"), msg("Good"), msg("Neutral"), msg("Bad"), msg("Very bad"),
  // Check-ins
  msg("Pending"), msg("Done"), msg("Skipped"), msg("Missed"),
  // How a choice sat against the comparison
  msg("None"), msg("Aligned"), msg("Against"), msg("Strongly against"),
  // Where a value came from
  msg("User stated"), msg("Model inferred"), msg("Model assumed"), msg("User confirmed"), msg("Manual"),
  // Constraints, evidence, criteria
  msg("Soft"), msg("Preference"), msg("User provided"), msg("Document"), msg("Link"), msg("Note"), msg("Calculation"),
  msg("Fact"), msg("Assumption"), msg("Maximize"), msg("Minimize"),
]);

/** A stored name in the current language: the word ORION shows for it, or the stored text if it is not one of ours. */
export function term(value: unknown): string {
  const english = words(value);
  return TERMS.has(english) ? t(english) : english;
}

const CATEGORIES = new Set([
  msg("Everyday"), msg("Food"), msg("Health"), msg("Fitness"), msg("Time"), msg("Money"),
  msg("Purchase"), msg("Work"), msg("Career"), msg("Business"), msg("Education"),
  msg("Relationships"), msg("Family"), msg("Social"), msg("Travel"), msg("Home"),
  msg("Transportation"), msg("Technology"), msg("Lifestyle"), msg("Personal growth"),
  msg("Major life decision"), msg("Custom"),
]);

/** A decision category ("Money") in the current language. */
export const categoryLabel = (category: string): string => (CATEGORIES.has(category) ? t(category) : category);

const STAKES: Record<string, string> = {
  tiny: msg("tiny stakes"), normal: msg("normal stakes"), significant: msg("significant stakes"), major: msg("major stakes"),
};
/** "normal stakes", for a tag. */
export const stakesLabel = (stakes: string): string => (STAKES[stakes] ? t(STAKES[stakes]) : t("{stakes} stakes", { stakes }));

const STATUS: Record<string, string> = { open: msg("open"), decided: msg("decided") };
/** A saved decision's status ("decided"), for a tag. */
export const statusLabel = (status: string): string => (STATUS[status] ? t(STATUS[status]) : status);

const RATINGS: Record<string, string> = {
  Great: msg("Great"), Good: msg("Good"), Neutral: msg("Neutral"), Bad: msg("Bad"), "Very bad": msg("Very bad"),
};
/** An outcome rating as stored ("Very bad") in the current language. */
export const ratingLabel = (rating: string): string => (RATINGS[rating] ? t(RATINGS[rating]) : rating);
