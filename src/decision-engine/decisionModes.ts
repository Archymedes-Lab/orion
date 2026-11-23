// Decision mode classification (§17).
// Recognizes different decision structures that affect option generation,
// questions, criteria, scoring, sensitivity, and aftermath.

import type { DecisionModeType, DecisionOption, DecisionFactor, Stakes } from "../types.ts";
import type { Obligation } from "./optionGeneration.ts";
import { t } from "../i18n/index.ts";

export type { DecisionModeType } from "../types.ts";

export interface ModeProfile {
  type: DecisionModeType;
  /** Human-readable name */
  name: string;
  /** Description of when this mode applies */
  description: string;
  /** Typical option generation strategy */
  optionStrategy: "explicit" | "binary" | "resource_allocation" | "prioritization" | "sequence" | "go_no_go" | "tradeoff" | "experiment";
  /** Question budget multiplier */
  questionBudgetMultiplier: number;
  /** Whether to include "do nothing / wait" options */
  includeWaitOption: boolean;
  /** Whether to include compromise options */
  includeCompromise: boolean;
  /** Whether to include experiment options */
  includeExperiment: boolean;
  /** Scoring emphasis */
  scoringEmphasis: "expected_value" | "downside" | "constraint_satisfaction" | "tradeoff";
  /** Sensitivity focus */
  sensitivityFocus: "flip_thresholds" | "dominant_factors" | "assumption_sensitivity";
  /** Aftermath time horizons */
  aftermathHorizons: string[];
  /** Early warning signal types to watch for */
  warningSignals: string[];
}

/** Detect the decision mode from context, obligations, and options. */
export function detectDecisionMode(input: {
  text: string;
  obligations: Obligation[];
  options: DecisionOption[];
  factors: DecisionFactor[];
  stakes: Stakes;
}): DecisionModeType {
  const { text, obligations, options } = input;

  // Count needs/obligations
  const needs = obligations.filter(o => o.type === "need" || o.type === "constraint");
  const needCount = needs.length;

  // Explicit option count
  const optionCount = options.length;

  // RESOURCE_ALLOCATION: limited resource split across competing needs
  // "I have X but need A and B" pattern
  if (needCount >= 2 && /\b(have|budget|limited|allocate|split|divide)\b/i.test(text)) {
    return "RESOURCE_ALLOCATION";
  }

  // PRIORITIZATION: what should happen first?
  if (/\b(first|priority|prioritize|order|sequence|which.*first|before|after)\b/i.test(text)) {
    return "PRIORITIZATION";
  }

  // SEQUENCE: what should I do first, then what?
  if (/\b(step|phase|stage|then|next|after that)\b/i.test(text) && needCount >= 2) {
    return "SEQUENCE";
  }

  // TIMING: when should I act?
  if (/\b(when|timing|wait|delay|now|later|time)\b/i.test(text) && !/\b(should i|what|which)\b/i.test(text)) {
    return "TIMING";
  }

  // GO_NO_GO: should I proceed?
  if (/\b(proceed|go ahead|go ahead with|move forward|greenlight|approve)\b/i.test(text)) {
    return "GO_NO_GO";
  }

  // REVERSIBLE_EXPERIMENT: try a small version first
  if (/\b(try|test|pilot|experiment|sample|small|see how)\b/i.test(text) && /\b(reversible|undo|stop if)\b/i.test(text)) {
    return "REVERSIBLE_EXPERIMENT";
  }

  // UNCERTAINTY: decision depends on unknown information
  if (/\b(don't know|uncertain|unsure|depends on|if.*then)\b/i.test(text) && optionCount <= 2) {
    return "UNCERTAINTY";
  }

  // VALUE_CONFLICT: two important values conflict
  if (/\b(conflict|torn|values|principle|compromise|both matter)\b/i.test(text)) {
    return "VALUE_CONFLICT";
  }

  // TRADEOFF: maximize X while minimizing Y
  if (/\b(trade.?off|balance|weigh|maximize|minimize|versus|vs\.)\b/i.test(text) && optionCount === 2) {
    return "TRADEOFF";
  }

  // MULTI_OPTION: 3+ explicit options
  if (optionCount >= 3) {
    return "MULTI_OPTION";
  }

  // BINARY: 2 explicit options
  if (optionCount === 2) {
    return "BINARY";
  }

  // Default based on obligations
  if (needCount >= 3) return "RESOURCE_ALLOCATION";
  if (needCount === 2) return "PRIORITIZATION";
  if (needCount === 1) return "GO_NO_GO";

  return "BINARY";
}

/** Get the mode profile for a decision type. */
export function getModeProfile(mode: DecisionModeType): ModeProfile {
  const profiles: Record<DecisionModeType, ModeProfile> = {
    BINARY: {
      type: "BINARY",
      name: t("Binary Choice"),
      description: t("Choose between two clear alternatives"),
      optionStrategy: "binary",
      questionBudgetMultiplier: 1.0,
      includeWaitOption: false,
      includeCompromise: false,
      includeExperiment: false,
      scoringEmphasis: "expected_value",
      sensitivityFocus: "flip_thresholds",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH"],
      warningSignals: [t("Regret signals"), t("Unexpected outcomes")],
    },
    MULTI_OPTION: {
      type: "MULTI_OPTION",
      name: t("Multiple Options"),
      description: t("Choose among three or more alternatives"),
      optionStrategy: "explicit",
      questionBudgetMultiplier: 1.2,
      includeWaitOption: true,
      includeCompromise: true,
      includeExperiment: false,
      scoringEmphasis: "expected_value",
      sensitivityFocus: "dominant_factors",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS"],
      warningSignals: [t("Regret signals"), t("Unexpected outcomes"), t("New information")],
    },
    TRADEOFF: {
      type: "TRADEOFF",
      name: t("Trade-off Decision"),
      description: t("Maximize one value while minimizing another"),
      optionStrategy: "tradeoff",
      questionBudgetMultiplier: 1.0,
      includeWaitOption: true,
      includeCompromise: true,
      includeExperiment: true,
      scoringEmphasis: "tradeoff",
      sensitivityFocus: "dominant_factors",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS"],
      warningSignals: [t("Value drift"), t("Unexpected costs"), t("Changing priorities")],
    },
    RESOURCE_ALLOCATION: {
      type: "RESOURCE_ALLOCATION",
      name: t("Resource Allocation"),
      description: t("Distribute limited resources across competing needs"),
      optionStrategy: "resource_allocation",
      questionBudgetMultiplier: 1.5,
      includeWaitOption: true,
      includeCompromise: true,
      includeExperiment: false,
      scoringEmphasis: "constraint_satisfaction",
      sensitivityFocus: "flip_thresholds",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS", "SIX MONTHS"],
      warningSignals: [t("Resource shortfall"), t("Need escalation"), t("Opportunity cost realization")],
    },
    PRIORITIZATION: {
      type: "PRIORITIZATION",
      name: t("Prioritization"),
      description: t("Determine what should happen first"),
      optionStrategy: "prioritization",
      questionBudgetMultiplier: 1.2,
      includeWaitOption: true,
      includeCompromise: true,
      includeExperiment: true,
      scoringEmphasis: "expected_value",
      sensitivityFocus: "assumption_sensitivity",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS"],
      warningSignals: [t("Priority inversion"), t("Deadline pressure"), t("Resource starvation")],
    },
    TIMING: {
      type: "TIMING",
      name: t("Timing Decision"),
      description: t("When to act"),
      optionStrategy: "binary",
      questionBudgetMultiplier: 0.8,
      includeWaitOption: true,
      includeCompromise: false,
      includeExperiment: true,
      scoringEmphasis: "expected_value",
      sensitivityFocus: "assumption_sensitivity",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH"],
      warningSignals: [t("Window closing"), t("Conditions changing"), t("New information")],
    },
    GO_NO_GO: {
      type: "GO_NO_GO",
      name: t("Go/No-Go"),
      description: t("Whether to proceed with a course of action"),
      optionStrategy: "go_no_go",
      questionBudgetMultiplier: 1.0,
      includeWaitOption: true,
      includeCompromise: false,
      includeExperiment: true,
      scoringEmphasis: "downside",
      sensitivityFocus: "flip_thresholds",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS"],
      warningSignals: [t("Red flags"), t("Condition deterioration"), t("Assumption violation")],
    },
    SEQUENCE: {
      type: "SEQUENCE",
      name: t("Sequential Decision"),
      description: t("What to do first, then what"),
      optionStrategy: "sequence",
      questionBudgetMultiplier: 1.3,
      includeWaitOption: true,
      includeCompromise: true,
      includeExperiment: true,
      scoringEmphasis: "expected_value",
      sensitivityFocus: "assumption_sensitivity",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS", "SIX MONTHS"],
      warningSignals: [t("Step failure"), t("Dependency delay"), t("Resource exhaustion")],
    },
    REVERSIBLE_EXPERIMENT: {
      type: "REVERSIBLE_EXPERIMENT",
      name: t("Reversible Experiment"),
      description: t("Try a small version first"),
      optionStrategy: "experiment",
      questionBudgetMultiplier: 0.7,
      includeWaitOption: true,
      includeCompromise: false,
      includeExperiment: true,
      scoringEmphasis: "downside",
      sensitivityFocus: "assumption_sensitivity",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE WEEK", "ONE MONTH"],
      warningSignals: [t("Experiment failure"), t("Negative feedback"), t("Cost overrun")],
    },
    UNCERTAINTY: {
      type: "UNCERTAINTY",
      name: t("Uncertainty-Driven"),
      description: t("Decision hinges on unknown information"),
      optionStrategy: "binary",
      questionBudgetMultiplier: 1.5,
      includeWaitOption: true,
      includeCompromise: false,
      includeExperiment: true,
      scoringEmphasis: "expected_value",
      sensitivityFocus: "assumption_sensitivity",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH"],
      warningSignals: [t("Information arrival"), t("Assumption violation"), t("New options")],
    },
    VALUE_CONFLICT: {
      type: "VALUE_CONFLICT",
      name: t("Value Conflict"),
      description: t("Two important values in tension"),
      optionStrategy: "tradeoff",
      questionBudgetMultiplier: 1.2,
      includeWaitOption: true,
      includeCompromise: true,
      includeExperiment: false,
      scoringEmphasis: "tradeoff",
      sensitivityFocus: "dominant_factors",
      aftermathHorizons: ["NOW", "FIRST FEW DAYS", "ONE MONTH", "THREE MONTHS", "SIX MONTHS"],
      warningSignals: [t("Value drift"), t("Identity conflict"), t("Regret")],
    },
  };

  return profiles[mode] || profiles.BINARY;
}

/** Generate options appropriate for the decision mode. */
export function generateModeOptions(
  mode: DecisionModeType,
  baseOptions: DecisionOption[],
  obligations: Obligation[],
  factors: DecisionFactor[]
): DecisionOption[] {
  const profile = getModeProfile(mode);
  const options = [...baseOptions];

  // Add wait/gather info option if appropriate
  if (profile.includeWaitOption && !hasWaitOption(options)) {
    options.push(createWaitOption(factors));
  }

  // Add compromise option for resource allocation / tradeoff
  if (profile.includeCompromise && obligations.length >= 2 && options.length >= 2) {
    options.push(createCompromiseOption(options, obligations, factors));
  }

  // Add experiment option for reversible decisions
  if (profile.includeExperiment && profile.type !== "REVERSIBLE_EXPERIMENT") {
    options.push(createExperimentOption(options[0], factors));
  }

  return options;
}

function hasWaitOption(options: DecisionOption[]): boolean {
  const waitKeywords = ["wait", "delay", "gather", "information", "research", "defer", "postpone", "hold", "기다", "미루", "보류", "정보", "알아보"];
  return options.some(o => waitKeywords.some(k => o.label.toLowerCase().includes(k) || o.description?.toLowerCase().includes(k)));
}

function createWaitOption(factors: DecisionFactor[]): DecisionOption {
  return {
    id: `wait_${Date.now()}`,
    label: t("Wait / Gather more information"),
    description: t("Delay the decision to gather more information or wait for conditions to change"),
    outcomes: [{
      id: `wait_out_${Date.now()}`,
      label: t("Information gathered"),
      probability: 0.5,
      probabilityConfidence: 0.5,
      factors: factors.map(f => ({ factorId: f.id, value: 0 })),
    }],
    reversibility: 0.9,
    reversibilityLevel: "easy",
    rationale: t("Buys time to reduce uncertainty"),
    risks: [t("Window of opportunity may close"), t("Conditions may worsen")],
    generated: true,
  };
}

function createCompromiseOption(
  options: DecisionOption[],
  obligations: Obligation[],
  factors: DecisionFactor[]
): DecisionOption {
  const topOptions = options.slice(0, 2);
  return {
    id: `compromise_${Date.now()}`,
    label: t("Compromise: partially address both"),
    description: t("Split resources/effort between {a} and {b}", { a: topOptions[0].label, b: topOptions[1].label }),
    outcomes: [{
      id: `comp_out_${Date.now()}`,
      label: t("Partial progress on both"),
      probability: 0.6,
      probabilityConfidence: 0.4,
      factors: factors.map(f => ({ factorId: f.id, value: 0 })),
    }],
    reversibility: 0.7,
    reversibilityLevel: "somewhat",
    rationale: t("Makes progress on multiple needs without fully committing to either"),
    risks: [t("Neither need fully resolved"), t("May be insufficient for both")],
    generated: true,
  };
}

function createExperimentOption(baseOption: DecisionOption, factors: DecisionFactor[]): DecisionOption {
  return {
    id: `experiment_${Date.now()}`,
    label: t("Try {option} on a small scale first", { option: baseOption.label }),
    description: t("Run a limited trial of {option} to test assumptions before full commitment", { option: baseOption.label }),
    outcomes: [{
      id: `exp_out_${Date.now()}`,
      label: t("Trial successful"),
      probability: 0.6,
      probabilityConfidence: 0.5,
      factors: factors.map(f => ({ factorId: f.id, value: 0 })),
    }, {
      id: `exp_out2_${Date.now()}`,
      label: t("Trial reveals issues"),
      probability: 0.4,
      probabilityConfidence: 0.5,
      factors: factors.map(f => ({ factorId: f.id, value: 0 })),
    }],
    reversibility: 0.85,
    reversibilityLevel: "easy",
    rationale: t("Tests key assumptions with minimal commitment"),
    risks: [t("Trial may not reveal long-term issues"), t("Delay in full implementation")],
    generated: true,
  };
}

/** Adjust question budget based on mode. */
export function adjustQuestionBudgetForMode(baseBudget: number, mode: DecisionModeType): number {
  const profile = getModeProfile(mode);
  return Math.max(1, Math.round(baseBudget * profile.questionBudgetMultiplier));
}