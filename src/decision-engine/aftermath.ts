// Aftermath: an approximate picture of what follows from choosing an option, step by step in time.
//
// Everything here is derived from the comparison ORION already has; nothing is invented:
//   - the steps run from the first days to years out (horizonDays); the ones up to a year are moments ORION will
//     check in (followUpPlan), so most of the picture can later be checked, and the years beyond are projections;
//   - each factor's estimated impact plays out in real time along one of five arcs, from a keyword reading of the
//     factor's name: costs and conveniences are felt at once and stay; the strain of a change (moving, effort,
//     disruption) is felt at once and fades; pleasures and novelty are felt at once and settle as you adapt;
//     growth, health and relationships build over months; money, skills and reputation keep compounding for years;
//   - the odds at each step are how likely the net effect so far lands clearly positive, clearly
//     negative, or in between, given the estimates' own uncertainty plus life's noise, which grows with time;
//   - the early sign is the one thing to notice that tells you which path you are on, and it becomes the
//     check-in question.
// Early warning signals and decision-mode awareness (§18, §19) add what to watch for along the way.
// An AI may reword the text (server/decision-ai.ts aftermathWithAI), never the numbers.

import type { DecisionFactor, DecisionOption, Pace, SafetyClass, Stakes, Risk } from "../types.ts";
import { normalizeProbabilities, normalizeWeights } from "./expectedValue.ts";
import { PRIOR_SPREAD } from "./uncertainty.ts";
import { followUpPlan, type FollowUpStep } from "./followUp.ts";
import type { DecisionMode } from "./mode.ts";
import type { DecisionModeType } from "../types.ts";
import { getLocale, listPhrase, msg, t } from "../i18n/index.ts";

export type { Pace };

export interface AftermathFactor {
  factorId: string;
  label: string;
  /** Estimated impact once fully felt, −10..10. */
  value: number;
  /** Share of that impact felt by this step, 0..1. */
  felt: number;
  pace: Pace;
}

export interface AftermathStep {
  days: number;
  /** ORION will check in at this moment (up to a year); later steps are projections. */
  checkIn: boolean;
  /** "near" up to six months, "far" from a year out: further out, the picture is a projection with wider odds. */
  horizon: "near" | "far";
  /** "Right away", "First week", "One month"… */
  when: string;
  /** Factors that newly show up at this step, most noticeable first (at most two). */
  featured: AftermathFactor[];
  /** Weighted net effect felt so far, roughly −10..10. */
  value: number;
  /** The middle half of plausible results by then: value ± 0.674σ. */
  range: [number, number];
  /** Every factor's weighted contribution felt so far (weight × value × felt), for the factor timeline. */
  contributions: (AftermathFactor & { weight: number; contribution: number })[];
  /** Rounded to 5%, and summing to 1. */
  odds: { well: number; mixed: number; hard: number };
  likely: string;
  goodTurn: string;
  hardTurn: string;
  /** What to notice, phrased as a question; also what the check-in asks. */
  sign: string;
  /** Early warning signals specific to this step */
  warningSignals: string[];
}

export interface Aftermath {
  optionId: string;
  optionLabel: string;
  steps: AftermathStep[];
  /** Shown above the timeline for high-stakes domains. */
  caution: string | null;
  /** Early warning signals to watch for across the timeline */
  earlyWarningSignals: string[];
  /** Decision mode for context */
  decisionMode?: DecisionModeType;
}

// The keywords are English and Korean, so a factor named in either language finds its pace.
// Felt at once and fading: the friction of making a change.
const FADING = /moving|move|relocat|transition|disrupt|adjust|upheaval|setup|set-up|onboard|learning curve|effort|hassle|logistic|paperwork|switching|이사|이주|전환|적응|혼란|준비|번거|수고|노력|서류|절차|갈아타/i;
// Felt at once and settling: pleasure and novelty, which people adapt to.
const ADAPTING = /fun|enjoy|excit|novel|mood|comfort|taste|craving|treat|luxur|status|happiness|style|look|feel|재미|즐거|흥미|설렘|새로움|기분|편안|맛|사치|지위|행복|스타일|외모|느낌/i;
// Compounding: what grows on itself for years.
const COMPOUNDING = /income|salary|earn|saving|wealth|invest|revenue|profit|equity|skill|expertise|network|reputation|brand|moat|compound|수입|소득|연봉|급여|저축|자산|재산|투자|매출|수익|이익|지분|기술|역량|전문성|인맥|네트워크|평판|명성|브랜드|복리/i;
// Builds over months: what the choice changes about a life or a company.
const SLOW = /growth|career|health|fitness|relationship|family|friend|partner|social|learn|education|future|long|stabil|secur|opportun|impact|wellbeing|well-being|meaning|purpose|freedom|independ|culture|retention|customer|market|strateg|capabilit|성장|커리어|경력|건강|체력|관계|가족|친구|연인|배우자|사회|배움|교육|학습|미래|장기|안정|기회|영향|의미|목적|자유|독립|문화|고객|시장|전략/i;
// Felt at once and staying: what the choice costs or gives day to day.
const FAST = /cost|price|money|spend|budget|cash|runway|time|convenien|commute|travel|stress|energy|sleep|easy|ease|speed|quick|noise|space|weather|workload|비용|가격|돈|지출|예산|현금|시간|편의|편리|통근|출퇴근|스트레스|에너지|수면|잠|속도|소음|공간|날씨|업무량/i;

export function paceOf(label: string): Pace {
  if (COMPOUNDING.test(label)) return "compounding";
  if (FADING.test(label)) return "fading";
  if (SLOW.test(label)) return "slow";
  if (ADAPTING.test(label)) return "adapting";
  if (FAST.test(label)) return "fast";
  return "steady";
}

/** The pace the AI gave a factor, or else the one its name suggests. */
export const paceFor = (f: { label: string; pace?: Pace }): Pace => f.pace ?? paceOf(f.label);

/** In words, for the "when each effect is felt" grid. English, marked for translation: show it through `t()`. */
export const PACE_LABEL: Record<Pace, string> = {
  fast: msg("felt at once"), fading: msg("felt at once, then fades"), adapting: msg("felt at once, then settles"),
  steady: msg("builds steadily"), slow: msg("builds over months"), compounding: msg("keeps compounding"),
};

/**
 * Share of a factor's full estimated impact felt `days` after choosing. Time constants are judgement calls from how
 * such effects usually behave, not measurements: strain fades over a few months, people adapt to pleasures within
 * about half a year, growth takes most of a year, and compounding effects pass their first estimate after a few years.
 */
export function feltAt(pace: Pace, days: number): number {
  const d = Math.max(0, days);
  switch (pace) {
    case "fast": return 1;
    case "fading": return d <= 30 ? 1 : 0.25 + 0.75 * Math.exp(-(d - 30) / 120);
    case "adapting": return 0.55 + 0.45 * Math.exp(-d / 150);
    case "steady": return 0.6 + 0.4 * (1 - Math.exp(-d / 60));
    case "slow": return 0.2 + 0.8 * (1 - Math.exp(-d / 150));
    case "compounding": return (0.2 + 0.8 * (1 - Math.exp(-d / 240))) * (1 + 0.12 * Math.log2(1 + d / 365));
  }
}

/** Share felt at step `i` of `n` evenly spaced steps over a year. Kept for callers that think in steps. */
export function feltBy(pace: Pace, i: number, n: number): number {
  return n <= 1 ? 1 : feltAt(pace, (i / (n - 1)) * 365);
}

/**
 * The moments the aftermath pictures. Serious choices look years ahead; ordinary ones a season; small ones a
 * couple of days. Up to a year these are the check-in moments, so the picture can be checked.
 */
export function horizonDays(input: { mode: DecisionMode; stakes: Stakes; reversibility?: number }): number[] {
  const { mode, stakes } = input;
  if (mode === "playful") return [];
  if (mode === "everyday") return stakes === "tiny" ? [0, 2] : [0, 2, 30, 180];
  const checks = followUpPlan({ mode, stakes, decided: true, reversibility: input.reversibility }).filter((s) => s.kind === "outcome").map((s) => s.days);
  const days = [...checks, 90, 1095, ...(stakes === "major" ? [1825] : [])];
  return [...new Set(days)].sort((a, b) => a - b);
}

/** The moment's name, in the current language: "Right away", "First week", "One year"… */
export function whenLabel(days: number): string {
  if (days <= 0) return t("Right away");
  if (days <= 3) return t("First few days");
  if (days <= 10) return t("First week");
  if (days <= 45) return t("One month");
  if (days <= 120) return t("Three months");
  if (days <= 270) return t("Six months");
  if (days <= 500) return t("One year");
  if (days <= 1300) return t("Three years");
  return t("Five years");
}

/** The same moment, short, for chart axes on narrow screens: "Now", "Wk 1", "1 yr"… */
export function shortWhenLabel(days: number): string {
  if (days <= 0) return t("Now");
  if (days <= 3) return t("Days");
  if (days <= 10) return t("Wk 1");
  if (days <= 45) return t("1 mo");
  if (days <= 120) return t("3 mo");
  if (days <= 270) return t("6 mo");
  if (days <= 500) return t("1 yr");
  if (days <= 1300) return t("3 yrs");
  return t("5 yrs");
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26). */
function phi(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Net effect that counts as clearly good or clearly bad, in −10..10 units. */
export const CLEAR = 1;
/**
 * Life's own noise: 0.8 right after choosing, growing towards 3 with a one-year time constant. This is the variance
 * of a mean-reverting (Ornstein–Uhlenbeck) process, σ²(t) = σ₀² + σ∞²(1 − e^(−t/τ)): luck accumulates, but a life
 * does not drift without bound, so the spread levels off instead of growing for ever. Up to a year it matches the
 * old log-growth curve to within 0.15.
 */
const NOISE = 0.8;
const NOISE_LONG = 3;
const NOISE_DAYS = 365;
/** How much less sure an estimate is per tenfold increase in months ahead: nobody sees year three as clearly as week one. */
const DRIFT = 0.5;
/**
 * How much the factor estimates' errors move together. They come from one model reading one question, so an
 * optimistic reading lifts every factor at once; treating them as independent understates the spread.
 * Var = (1 − ρ)·Σσᵢ² + ρ·(Σσᵢ)².
 */
const CORRELATION = 0.35;
/**
 * Long-range humility. An estimate whose doubt grows with distance should be pulled towards "no difference" in
 * proportion: with a prior N(0, τ²) on the true effect and estimate noise s², the posterior mean is
 * x·τ²/(τ² + s²). Normalised to leave the near term as estimated, a factor's shrink at day d is
 * (τ² + s₀²)/(τ² + s₀²·drift(d)²), where s₀ = (1 − confidence)·τ. Confident estimates barely move; guesses fade.
 */
export const shrink = (confidence: number, drift: number) => {
  const s0 = (1 - confidence) ** 2;
  return (1 + s0) / (1 + s0 * drift * drift);
};
/**
 * The option to undo. Once there has been time to see how it is going (the first month), someone with a reversible
 * choice that is clearly going badly tends to back out, so the bad tail is cut in proportion to `reversibility`,
 * phasing in over about half a year. The cut mass moves to "mixed", not "well": backing out costs something too.
 * People back out less often than they could (sunk costs, inertia), so at most 60% of the reversible share is cut.
 */
const EXIT_RATE = 0.6;
const SWITCH_AFTER = 30;
const SWITCH_DAYS = 180;
const exitShare = (reversibility: number, days: number) =>
  days <= SWITCH_AFTER ? 0 : EXIT_RATE * Math.max(0, Math.min(1, reversibility)) * (1 - Math.exp(-(days - SWITCH_AFTER) / SWITCH_DAYS));
const driftAt = (days: number) => 1 + DRIFT * Math.log10(1 + days / 30);

/**
 * Three-way odds rounded to 5% that still sum to exactly 1. Going well and going hard never round down to 0%: the
 * normal curve's thin tails understate how often a life choice surprises, and "0% chance it goes well" claims a
 * certainty no estimate here has.
 */
const ODDS_FLOOR = 0.05;
function roundOdds(well: number, hard: number) {
  const w = Math.max(ODDS_FLOOR, Math.round(well * 20) / 20);
  const h = Math.max(ODDS_FLOOR, Math.round(hard * 20) / 20);
  const m = Math.max(0, Math.round((1 - w - h) * 20) / 20);
  const total = w + h + m;
  return { well: w / total, mixed: m / total, hard: h / total };
}

const lower = (label: string) => (label.length > 1 && label === label.toUpperCase() ? label : label.toLowerCase());
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A factor's name inside a sentence: lower case in English ("career growth"), as written in Korean. */
const inline = (label: string) => (getLocale() === "en" ? lower(label) : label);
/** The same at the start of an English sentence. */
const opening = (label: string) => (getLocale() === "en" ? sentence(lower(label)) : label);

// Phrases avoid verb agreement with the label ("Friends", "Cost"), which a template cannot know. In Korean they are
// noun phrases built on "{name} 면", which reads the same whatever the label ends in, so no particle depends on it.
// Each returns the template and the name apart, so two factors in the same shape can share one phrase.
function phrase(f: AftermathFactor): { key: string; name: string } {
  const v = f.value * f.felt;
  const name = inline(f.label);
  // A local `t` that defers translation: every template stays a literal call to `t` that the language coverage test can find.
  const t = (key: string, _: { name: string }) => ({ key, name });
  const full = f.felt >= 0.95;
  const pace = f.pace;
  // Long-range shapes first: compounding past the first estimate, strain behind you, novelty worn off.
  if (pace === "compounding" && f.felt > 1.25 && f.value >= 1.5) return t("{name} well past the first estimate", { name });
  if (pace === "compounding" && f.felt > 1.05 && Math.abs(f.value) >= 1.5) return f.value > 0 ? t("{name} compounding beyond the first estimate", { name }) : t("the cost to {name} compounding", { name });
  if (pace === "fading" && f.felt < 0.5 && f.value <= -1.5) return t("the early strain on {name} mostly behind you", { name });
  if (pace === "fading" && f.felt < 0.95 && f.value <= -1.5) return t("the strain on {name} starting to ease", { name });
  if (pace === "adapting" && f.felt < 0.7 && f.value >= 1.5) return t("the lift in {name} settling into normal", { name });
  if (v >= 1.5) {
    if (pace !== "slow" && pace !== "compounding") return t("a lift in {name}", { name });
    return full ? t("the gain in {name} becoming clear", { name }) : f.felt < 0.5 ? t("early signs of better {name}", { name }) : t("{name} keeping on improving", { name });
  }
  if (v <= -1.5) {
    if (pace === "fast" || pace === "fading") return t("{name} as the price you pay", { name });
    return full ? t("the full cost to {name}", { name }) : t("some strain on {name}", { name });
  }
  if (Math.abs(f.value) >= 1.5) return t("{name} only beginning to shift", { name });
  return t("little change in {name}", { name });
}

/** "Most likely: …", from one or two featured factors; two in the same shape share it ("A and B as the price you pay"). */
function likelyText(featured: AftermathFactor[]): string {
  const [pa, pb] = featured.map(phrase);
  if (pb !== undefined && pa.key === pb.key) return t("Most likely: {a}.", { a: t(pa.key, { name: t("{a} and {b}", { a: pa.name, b: pb.name }) }) });
  const a = t(pa.key, { name: pa.name });
  return pb === undefined ? t("Most likely: {a}.", { a }) : t("Most likely: {a}, with {b}.", { a, b: t(pb.key, { name: pb.name }) });
}

function signFor(f: AftermathFactor): string {
  const name = inline(f.label);
  if (f.value >= 1) return t("Do you notice a real improvement in {name}?", { name });
  if (f.value <= -1) return t("Does {name} still feel like a strain?", { name });
  return t("Any change in {name}?", { name });
}

const CAUTION: Partial<Record<SafetyClass, string>> = {
  "health-high-stakes": msg("This touches on your health. Treat this picture as a prompt for questions, and ask a medical professional what to expect."),
  "financial-high-stakes": msg("Real money is at stake. Treat this picture as a prompt for questions, and check the numbers with someone qualified."),
  "legal-high-stakes": msg("There is a legal side to this. Treat this picture as a prompt for questions, and ask a lawyer what to expect."),
};

/**
 * The offline good and hard turns, written for how far out the moment is: early on it is about friction, later about
 * the routine that forms, a year on about what lasted, years on about direction and the doors each path closed.
 */
function turns(days: number, best: AftermathFactor, worst: AftermathFactor): { goodTurn: string; hardTurn: string } {
  const up = inline(best.label);
  const Up = opening(best.label);
  const down = inline(worst.label);
  const gains = best.value > 0;
  const costs = worst.value < 0;
  if (days <= 10) return {
    goodTurn: gains ? t("Settling in goes smoother than expected, and {up} shows up early.", { up }) : t("{Up} turns out easier than expected.", { Up }),
    hardTurn: costs ? t("The first days are rougher than expected: {down} weighs more than you planned for.", { down }) : t("The early days feel flat; {down} has not moved yet.", { down }),
  };
  if (days <= 45) return {
    goodTurn: gains ? t("The improvement in {up} comes sooner and bigger than expected.", { up }) : t("{Up} settles faster than expected.", { Up }),
    hardTurn: costs ? t("The strain on {down} takes longer to settle than hoped.", { down }) : t("The gain in {down} is slower to show than hoped.", { down }),
  };
  if (days <= 270) return {
    goodTurn: gains ? t("A routine forms around the choice, and {up} keeps improving within it.", { up }) : t("The new routine makes {up} a non-issue.", { up }),
    hardTurn: costs ? t("The routine settles, but {down} lingers instead of fading.", { down }) : t("The new normal arrives, but {down} has plateaued early.", { down }),
  };
  if (days <= 500) return {
    goodTurn: gains ? t("A year in, {up} has become part of normal life and is still growing.", { up }) : t("A year in, {up} barely registers any more.", { up }),
    hardTurn: costs ? t("A year in, {down} turns out to be the lasting price, not a phase.", { down }) : t("A year in, {down} has stalled where it was.", { down }),
  };
  return {
    goodTurn: gains
      ? best.pace === "compounding" ? t("Years on, {up} has grown on itself well past the first estimate.", { up }) : t("Years on, {up} has shaped the life or work you now have.", { up })
      : t("Years on, {up} is simply how things are.", { up }),
    hardTurn: costs ? t("Years on, {down} has quietly grown, and some doors the other path offered have closed.", { down }) : t("Years on, the gain in {down} never fully arrived.", { down }),
  };
}

/** Generate early warning signals for an option based on its risks and mode. */
function generateEarlyWarningSignals(
  option: DecisionOption,
  factors: DecisionFactor[],
  risks: Risk[],
  mode?: DecisionModeType
): string[] {
  const signals: string[] = [];

  // Risk-based signals
  for (const risk of risks) {
    if (risk.warningSignal) {
      signals.push(risk.warningSignal);
    } else if (risk.likelihood !== "low") {
      // Generate default signal from risk description
      signals.push(t("Watch for signs that \"{risk}\" is developing", { risk: risk.description }));
    }
  }

  // Factor-based signals
  const negativeFactors = factors.filter(f => {
    const outcome = option.outcomes[0]?.factors.find(of => of.factorId === f.id);
    return outcome && outcome.value < -2;
  });
  for (const f of negativeFactors.slice(0, 2)) {
    signals.push(t("Monitor {factor} — if it worsens beyond expectations, reconsider", { factor: getLocale() === "en" ? f.label.toLowerCase() : f.label }));
  }

  // Mode-specific signals
  if (mode) {
    switch (mode) {
      case "RESOURCE_ALLOCATION":
        signals.push(t("Track spending against allocated budget for each need"));
        signals.push(t("Watch for one need escalating unexpectedly"));
        break;
      case "REVERSIBLE_EXPERIMENT":
        signals.push(t("Track trial results against success criteria"));
        signals.push(t("Check if assumptions hold in the small-scale test"));
        break;
      case "GO_NO_GO":
        signals.push(t("Watch for red flags that would change go/no-go decision"));
        signals.push(t("Monitor conditions that would make proceeding unwise"));
        break;
      case "PRIORITIZATION":
        signals.push(t("Track progress on the top priority — is it moving forward?"));
        signals.push(t("Watch for lower priorities becoming urgent"));
        break;
      case "SEQUENCE":
        signals.push(t("Verify each step completes before starting the next"));
        signals.push(t("Watch for dependencies blocking the sequence"));
        break;
      case "TRADEOFF":
        signals.push(t("Check if the trade-off balance is shifting"));
        signals.push(t("Monitor whether the minimized value is becoming too costly"));
        break;
      case "VALUE_CONFLICT":
        signals.push(t("Notice which value feels more compromised over time"));
        signals.push(t("Watch for regret signals about the chosen path"));
        break;
    }
  }

  // Option-specific signals
  if (option.risks) {
    for (const risk of option.risks.slice(0, 2)) {
      signals.push(t("Watch for: {risk}", { risk }));
    }
  }

  // Deduplicate and limit
  const unique = [...new Set(signals)];
  return unique.slice(0, 5);
}

/** Generate per-step warning signals. */
function generateStepWarningSignals(
  stepIndex: number,
  stepDays: number,
  featured: AftermathFactor[]
): string[] {
  const signals: string[] = [];

  // Featured factor signals
  for (const f of featured.slice(0, 2)) {
    if (f.value < -1) {
      signals.push(t("At {when}: if {factor} feels worse than expected, reassess", { when: whenLabel(stepDays), factor: getLocale() === "en" ? f.label.toLowerCase() : f.label }));
    } else if (f.value > 1) {
      signals.push(t("At {when}: check if {factor} is improving as expected", { when: whenLabel(stepDays), factor: getLocale() === "en" ? f.label.toLowerCase() : f.label }));
    }
  }

  // Time-based signals
  if (stepDays <= 3) {
    signals.push(t("Early days: notice immediate friction or surprise"));
  } else if (stepDays <= 14) {
    signals.push(t("First weeks: patterns should be emerging"));
  } else if (stepDays <= 45) {
    signals.push(t("One month: early outcomes should be visible"));
  } else if (stepDays <= 120) {
    signals.push(t("Three months: trajectory should be clear"));
  } else if (stepDays <= 270) {
    signals.push(t("Six months: the new normal is forming; compare it with what you expected"));
  } else if (stepDays <= 500) {
    signals.push(t("A year on: judge it on the slow effects, not the early friction"));
  } else {
    signals.push(t("Years out: the alternative you gave up has moved on too; compare with where it would be now"));
  }

  return signals.slice(0, 3);
}

/**
 * The aftermath of choosing `optionId`, or null when there is nothing honest to show:
 * a fun decision, a crisis or dangerous situation, or no estimates yet.
 */
export function aftermath(input: {
  options: DecisionOption[];
  factors: DecisionFactor[];
  optionId: string;
  mode: DecisionMode;
  stakes: Stakes;
  safety: SafetyClass;
  signal: boolean;
  risks?: Risk[];
  decisionMode?: DecisionModeType;
  /** Calibration: how much wider (above 1) or narrower the spread should be, fitted to this person's outcomes. */
  spread?: number;
}): Aftermath | null {
  const { mode, stakes, safety, signal, risks = [], decisionMode, spread: scale = 1 } = input;
  const option = input.options.find((o) => o.id === input.optionId);
  if (!option || !signal || mode === "playful" || safety === "crisis" || safety === "dangerous" || input.factors.length === 0) return null;

  const checks = new Set(followUpPlan({ mode, stakes, decided: true, reversibility: option.reversibility }).filter((s) => s.kind === "outcome").map((s) => s.days));
  const days = horizonDays({ mode, stakes, reversibility: option.reversibility });

  const weights = normalizeWeights(input.factors);
  const outs = normalizeProbabilities(option.outcomes);
  const perFactor = weights.map((f) => {
    let value = 0;
    let confidence = 0;
    for (const o of outs) {
      value += o.probability * (o.factors.find((fv) => fv.factorId === f.id)?.value ?? 0);
      confidence += o.probability * o.probabilityConfidence;
    }
    return { factorId: f.id, label: f.label, weight: f.weight, value, confidence, pace: paceFor(f) };
  });

  let asked = "";
  let previous: string[] = [];
  const steps: AftermathStep[] = days.map((d, i) => {
    let value = 0;
    let squares = 0;
    let spread = 0;
    // Further out, every estimate is shakier: its own doubt grows with the log of the months ahead, and an unsure
    // estimate is pulled towards "no difference" by as much.
    const drift = driftAt(d);
    const rows = perFactor.map((f) => {
      const felt = feltAt(f.pace, d) * shrink(f.confidence, drift);
      const before = i === 0 ? 0 : feltAt(f.pace, days[i - 1]) * shrink(f.confidence, driftAt(days[i - 1]));
      value += f.weight * f.value * felt;
      const doubt = f.weight * felt * (1 - f.confidence) * PRIOR_SPREAD * drift;
      squares += doubt ** 2;
      spread += doubt;
      // What is new at this step: the part of the impact that arrives now.
      return { factor: { factorId: f.factorId, label: f.label, value: f.value, felt, pace: f.pace }, weight: f.weight, arriving: Math.abs(f.weight * f.value * (felt - before)) };
    });
    // Estimate doubt and life's noise are independent, so they add as variances, not as spreads.
    const estimate = (1 - CORRELATION) * squares + CORRELATION * spread ** 2;
    const noise = NOISE ** 2 + NOISE_LONG ** 2 * (1 - Math.exp(-d / NOISE_DAYS));
    const sigma = Math.sqrt(estimate + noise) * scale;
    const hard = phi((-CLEAR - value) / sigma) * (1 - exitShare(option.reversibility, d));
    const odds = roundOdds(1 - phi((CLEAR - value) / sigma), hard);
    // Near term: what newly arrives. Far out little is new, so say where things stand: the biggest gain and the
    // biggest cost, so a long-range picture never hides what the choice gave up.
    let featured: AftermathFactor[];
    if (d > 270) {
      const standing = rows.slice().sort((a, b) => Math.abs(b.weight * b.factor.value * b.factor.felt) - Math.abs(a.weight * a.factor.value * a.factor.felt));
      const gain = standing.find((r) => r.factor.value >= 1.5);
      const cost = standing.find((r) => r.factor.value <= -1.5 && r.factor.felt >= 0.5);
      featured = [gain, cost].filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => r.factor);
      if (featured.length === 0) featured = standing.slice(0, 1).map((r) => r.factor);
    } else {
      const arriving = rows.filter((r) => r.arriving > 0.01).sort((a, b) => b.arriving - a.arriving);
      featured = arriving.slice(0, 2).map((r) => r.factor);
      // Do not repeat the last step's pair when something else is also arriving in earnest.
      const same = featured.length === 2 && featured.every((f) => previous.includes(f.factorId));
      const fresh = arriving.find((r) => !previous.includes(r.factor.factorId) && r.arriving >= 0.4 * arriving[0].arriving);
      if (same && fresh) featured = [featured[0], fresh.factor];
    }
    // Nothing new arrives (all factors flat): talk about the biggest one anyway.
    if (featured.length === 0) featured.push(rows.slice().sort((a, b) => Math.abs(b.factor.value) - Math.abs(a.factor.value))[0].factor);
    previous = featured.map((f) => f.factorId);

    const signed = featured.find((f) => f.factorId !== asked) ?? featured[0];
    asked = signed.factorId;
    const best = featured.slice().sort((a, b) => b.value - a.value)[0];
    const worst = featured.slice().sort((a, b) => a.value - b.value)[0];

    // Generate warning signals for this step
    const warningSignals = generateStepWarningSignals(i, d, featured);

    return {
      days: d,
      checkIn: checks.has(d),
      horizon: d > 270 ? "far" : "near",
      when: whenLabel(d),
      featured,
      value: Math.round(value * 100) / 100,
      range: [Math.round((value - 0.674 * sigma) * 100) / 100, Math.round((value + 0.674 * sigma) * 100) / 100],
      contributions: rows.map((r) => ({ ...r.factor, weight: r.weight, contribution: Math.round(r.weight * r.factor.value * r.factor.felt * 100) / 100 })),
      odds,
      likely: likelyText(featured),
      ...turns(d, best, worst),
      sign: signFor(signed),
      warningSignals,
    };
  });

  const earlyWarningSignals = generateEarlyWarningSignals(option, input.factors, risks, decisionMode);

  return { optionId: option.id, optionLabel: option.label, steps, caution: CAUTION[safety] ? t(CAUTION[safety]) : null, earlyWarningSignals, decisionMode };
}

/** The check-in plan with each outcome check-in asking about the early sign due at that moment. */
export function withSigns(plan: FollowUpStep[], picture: Aftermath | null): FollowUpStep[] {
  if (!picture) return plan;
  return plan.map((step) => {
    const at = picture.steps.find((s) => s.days === step.days);
    if (step.kind !== "outcome" || !at) return step;
    const sign = getLocale() === "en" ? `${at.sign.charAt(0).toLowerCase()}${at.sign.slice(1)}` : at.sign;
    return { ...step, prompt: t("{when} on: {sign} How has it turned out so far?", { when: at.when, sign }) };
  });
}

/** Plain-language headlines for the aftermath diagrams, computed from the same numbers the diagrams draw. */
export interface AftermathTakeaways {
  /** How the pictured option's net effect moves over time, and how it compares with the alternative. */
  path: string;
  /** The step (index into `steps`) where it overtakes or falls behind the alternative, if it does. */
  crossing: number | null;
  /** Where the odds end up. */
  odds: string;
  /** Which factors are felt at once and which build slowly. */
  timing: string;
}

/** "by year three", "around six months": how a moment reads inside a sentence, from its days (as `whenLabel`). */
function at(days: number): string {
  if (days <= 0) return t("the start");
  if (days <= 3) return t("the first few days");
  if (days <= 10) return t("the first week");
  if (days <= 45) return t("one month");
  if (days <= 120) return t("three months");
  if (days <= 270) return t("six months");
  if (days <= 500) return t("the end of year one");
  if (days <= 1300) return t("year three");
  return t("year five");
}

const zone = (v: number) => (v >= CLEAR ? "better" : v <= -CLEAR ? "worse" : "same");

export function takeaways(picture: Aftermath, alternative: Aftermath | null): AftermathTakeaways {
  const steps = picture.steps;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const a = zone(first.value);
  const b = zone(last.value);
  const option = picture.optionLabel;
  const start = at(first.days);
  const end = at(last.days);
  // The arc and the comparison are each a whole clause (in Korean, a whole sentence), joined as written.
  const arc =
    a === "worse" && b === "better" ? t("“{option}” starts harder ({start}), then leaves you clearly better off by {end}", { option, start, end })
    : a === "worse" && b !== "better" ? (b === "worse" ? t("“{option}” starts harder and is still a strain by {end}", { option, end }) : t("“{option}” starts harder and is still only about even by {end}", { option, end }))
    : a === "better" && b === "better" ? (last.value > first.value + 0.5 ? t("“{option}” leaves you better off from the start, and keeps improving", { option }) : t("“{option}” leaves you better off from the start", { option }))
    : a === "same" && b === "better" ? (first.value < -0.25 ? t("“{option}” dips a little at first, then leaves you clearly better off by {end}", { option, end }) : t("“{option}” feels about the same at first, then leaves you clearly better off by {end}", { option, end }))
    : a !== "worse" && b === "worse" ? t("“{option}” feels fine at first, then gets harder by {end}", { option, end })
    : t("“{option}” changes little either way", { option });

  let crossing: number | null = null;
  let versus = "";
  if (alternative && alternative.steps.length === steps.length) {
    const diff = steps.map((s, i) => s.value - alternative.steps[i].value);
    const flip = diff.findIndex((d, i) => i > 0 && Math.sign(d) !== Math.sign(diff[i - 1]) && Math.abs(d) > 0.05);
    const alt = alternative.optionLabel;
    if (flip > 0) {
      crossing = flip;
      versus = diff[flip] > 0 ? t("; it overtakes “{alt}” around {at}", { alt, at: at(steps[flip].days) }) : t("; “{alt}” pulls ahead around {at}", { alt, at: at(steps[flip].days) });
    } else if (diff.every((d) => d > 0.05)) versus = t(", ahead of “{alt}” throughout", { alt });
    else if (diff.every((d) => d < -0.05)) versus = t(", behind “{alt}” throughout", { alt });
    else versus = t(", close to “{alt}” throughout", { alt });
  }

  const o = last.odds;
  const odds = t("By {at}: {well}% chance it is clearly going well, {hard}% that it is clearly hard, and {mixed}% somewhere in between.", {
    at: end, well: Math.round(o.well * 100), hard: Math.round(o.hard * 100), mixed: Math.round(o.mixed * 100),
  });

  const contributions = last.contributions.filter((c) => Math.abs(c.value) >= 0.5);
  const named = (paces: Pace[]) => contributions.filter((c) => paces.includes(c.pace)).map((c) => inline(c.label));
  const timing = ([
    [["fast"], msg("Felt at once and stays: {list}.")], [["fading"], msg("Felt at once, then fades: {list}.")], [["adapting"], msg("Felt at once, then you get used to it: {list}.")],
    [["slow", "steady"], msg("Builds over months: {list}.")], [["compounding"], msg("Keeps compounding for years: {list}.")],
  ] as [Pace[], string][]).map(([p, line]) => { const n = named(p); return n.length ? t(line, { list: listPhrase(n) }) : ""; }).filter(Boolean).join(" ")
    || t("Each effect builds steadily over time.");

  return { path: `${arc}${versus}.`, crossing, odds, timing };
}
