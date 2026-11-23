// Plain English for everything ORION works out.
//
// The engine's vocabulary — confidence, robustness, reversibility, value of information, provenance — is
// precise and worth keeping, but it is not what a person asks. Each readout below pairs the question
// somebody actually has ("Would the answer change?") with an answer in ordinary words, and keeps the
// technical name available for anyone who wants it.
//
// This file only ever rephrases numbers the engine produced. It never invents a value, never softens an
// uncertain result into a certain one, and never turns a score into a probability of something happening
// in the world. If the engine has no reading, the readout says so rather than guessing.

import { msg, t } from "../i18n/index.ts";

export type ReadoutTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface Readout {
  /** The question in the person's words. Used as a heading or a disclosure summary. */
  question: string;
  /** The answer in a few words. Never a number on its own. */
  answer: string;
  /** One sentence saying what that means for them. */
  detail: string;
  /** The engine's own name for this, for the "what is this?" line. */
  technical: string;
  tone: ReadoutTone;
}

/**
 * The plain name for each idea in the interface, with the technical term kept beside it. Screens should
 * read from here rather than writing their own wording, so the same idea is never called two things.
 */
export const TERMS = {
  confidence: { plain: msg("How strong is this recommendation?"), technical: msg("Decision confidence") },
  robustness: { plain: msg("Would the answer change?"), technical: msg("Robustness analysis") },
  reversibility: { plain: msg("How easy is it to change your mind?"), technical: msg("Reversibility") },
  information: { plain: msg("What should you find out first?"), technical: msg("Value of information") },
  opportunityCost: { plain: msg("What would you give up?"), technical: msg("Opportunity cost") },
  evidence: { plain: msg("How reliable is the information?"), technical: msg("Evidence quality") },
  scenarios: { plain: msg("What if things turn out differently?"), technical: msg("Scenario analysis") },
  impact: { plain: msg("What helps or hurts each option?"), technical: msg("Impact matrix") },
  uncertainty: { plain: msg("What is still unclear?"), technical: msg("Uncertainty") },
  downside: { plain: msg("What could go wrong?"), technical: msg("Downside analysis") },
  sensitivity: { plain: msg("What would change the answer?"), technical: msg("Sensitivity analysis") },
  aftermath: { plain: msg("What happens after you choose?"), technical: msg("Aftermath projection") },
} as const;

export type TermKey = keyof typeof TERMS;

/** How sure ORION is of its own comparison — not how likely the option is to work out. */
export function confidencePlain(value: number | null | undefined): Readout {
  const base = { question: t(TERMS.confidence.plain), technical: t(TERMS.confidence.technical) };
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { ...base, answer: t("Not worked out yet"), detail: t("ORION has not scored enough of this decision to say."), tone: "neutral" };
  }
  if (value >= 0.7) {
    return { ...base, answer: t("Strong"), detail: t("The estimates behind this are firm enough that small errors would not change which option leads."), tone: "success" };
  }
  if (value >= 0.4) {
    return { ...base, answer: t("Reasonable"), detail: t("The comparison holds up, but some estimates are rough. Worth a second look before anything hard to undo."), tone: "info" };
  }
  return { ...base, answer: t("Shaky"), detail: t("Several estimates are guesses. Treat this as a starting point for thinking, not an answer."), tone: "warning" };
}

/** Whether a small change in the person's situation would move the leader. */
export function robustnessPlain(stability: string | null | undefined): Readout {
  const base = { question: t(TERMS.robustness.plain), technical: t(TERMS.robustness.technical) };
  if (stability === "high") {
    return { ...base, answer: t("Probably not"), detail: t("The same option stays ahead when the estimates are nudged either way."), tone: "success" };
  }
  if (stability === "medium") {
    return { ...base, answer: t("It might"), detail: t("A moderate change in one of the things you weighed would be enough to put another option ahead."), tone: "warning" };
  }
  if (stability === "low") {
    return { ...base, answer: t("Easily"), detail: t("This is close. Small differences in what you care about would change which option leads."), tone: "danger" };
  }
  return { ...base, answer: t("Not worked out yet"), detail: t("There is not enough scored here to test it."), tone: "neutral" };
}

/** How hard the choice would be to walk back. Drives how much care it deserves. */
export function reversibilityPlain(value: number | null | undefined): Readout {
  const base = { question: t(TERMS.reversibility.plain), technical: t(TERMS.reversibility.technical) };
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return { ...base, answer: t("Not known"), detail: t("ORION has no reading on how hard this would be to undo."), tone: "neutral" };
  }
  if (value >= 0.7) return { ...base, answer: t("Easy to undo"), detail: t("If it turns out badly you can change course without losing much."), tone: "success" };
  if (value >= 0.4) return { ...base, answer: t("Awkward to undo"), detail: t("Changing your mind later is possible, but it would cost you time or money."), tone: "info" };
  return { ...base, answer: t("Hard to undo"), detail: t("This one is difficult to walk back, so it is worth more care than the score alone suggests."), tone: "warning" };
}

/**
 * Where a piece of the analysis came from. The spec's distinction between what the person said, what
 * ORION inferred and what it merely assumed is the difference between a reading and a guess, so it is
 * never collapsed into one voice.
 */
export function provenancePlain(provenance: string | null | undefined): string {
  switch (provenance) {
    case "USER_STATED": return t("You told ORION this");
    case "USER_CONFIRMED": return t("You confirmed this");
    case "MODEL_INFERRED": return t("ORION worked this out from what you wrote");
    case "MODEL_ASSUMED": return t("ORION assumed this — correct it if it is wrong");
    default: return "";
  }
}

/** What a score is, said once, in the one place that needs to say it. */
export const SCORE_MEANING = msg(
  "A score is ORION's estimate of how well an option does on what you said matters, from −10 to +10. It is a comparison between your options, not a prediction about how things will turn out.",
);

/** The line that must appear wherever estimates are shown as if they were findings. */
export const ESTIMATE_CAVEAT = msg("These are estimates from what you told ORION, not measurements.");

/**
 * "What would change the answer", in plain words. The sensitivity engine writes its sentence for the analysis
 * page, where the gap in score points is useful; on the result it is noise ("(gap 3.2)"). This keeps the
 * meaning, drops the working and the quotation marks round option names, and says "could come out ahead"
 * rather than "becomes competitive". A sentence it does not recognise is passed through with the working removed.
 */
export function plainFlip(description: string): string {
  const text = description.trim();
  if (text === "") return "";
  // The engine writes these sentences in the current language (src/decision-engine/sensitivity.ts), so both the
  // English and the Korean shapes are recognised; option names are quoted with "…" in English and ‘…’ in Korean.
  const unquote = (s: string) => s.replace(/"([^"]*)"/g, "$1").replace(/‘([^’]*)’/g, "$1");
  const working = (s: string) => s.replace(/\s*\((?:gap|score|차이|점수)[^)]*\)/gi, "").replace(/\s+([.,;])/g, "$1").trim();
  const tied = (options: string) =>
    t("{options} are effectively tied. A small change in any one thing you weighed would separate them.", { options: unquote(options) });
  const wide = (option: string) =>
    t("{option} leads by a wide margin. No single change would close it; several estimates would have to move together.", { option });
  const ahead = (factor: string, option: string) =>
    t("If {factor} favours {option} more than ORION estimated, it could come out ahead.", { factor, option });
  let m = text.match(/^(.+) are effectively tied/) ?? text.match(/^(.+): 사실상 동점이에요/);
  if (m) return tied(m[1]);
  m = text.match(/^"(.+?)" leads by a wide margin/) ?? text.match(/^‘(.+?)’ 쪽이 큰 차이로 앞서요/);
  if (m) return wide(m[1]);
  m = text.match(/^If (.+) favours "(.+)" more strongly, "\2" becomes competitive\.?$/) ??
    text.match(/^(.+) 면에서 ‘(.+)’ 쪽이 더 유리해지면 ‘\2’도 충분히 겨룰 만해져요\.?$/);
  if (m) return ahead(m[1], m[2]);
  return unquote(working(text));
}
