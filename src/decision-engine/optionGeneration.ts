// Option generation from needs/obligations (§3, §4).
// When the user describes a problem without explicit alternatives, generate a small set
// of reasonable action classes. Never pretend the competing needs themselves are choices.

import type {
  DecisionOption,
  DecisionFactor,
  ReversibilityLevel,
  Provenance,
} from "../types.ts";
import { t } from "../i18n/index.ts";
import { uid } from "./normalize.ts";

export interface Obligation {
  id: string;
  description: string;
  type: "need" | "constraint" | "preference";
  provenance: Provenance;
}

export interface GeneratedOption {
  id: string;
  label: string;
  description: string;
  rationale: string;
  assumptions: string[];
  risks: string[];
  reversibility: ReversibilityLevel;
  requiredResources: string;
  opportunityCost: string;
}

/** Generate plausible options from competing obligations/needs. */
export function generateOptionsFromObligations(
  obligations: Obligation[],
  factors: DecisionFactor[],
  stakes: "tiny" | "normal" | "significant" | "major",
  reversibilityHint?: number
): GeneratedOption[] {
  if (obligations.length === 0) return [];

  const needs = obligations.filter((o) => o.type === "need" || o.type === "constraint");

  if (needs.length === 1) {
    // Single need: generate do it / don't do it + gather info
    const need = needs[0];
    return [
      makeOption(
        t("Address {need}", { need: need.description }),
        t("Take action to fulfill: {need}", { need: need.description }),
        [t("You have the means to address this"), t("{need} is the priority", { need: need.description })],
        [t("May not be feasible"), t("Could create new obligations")],
        assessReversibility(stakes, reversibilityHint),
        t("Time, money, or effort depending on the need"),
        t("Not addressing {need}", { need: need.description })
      ),
      makeOption(
        t("Defer {need}", { need: need.description }),
        t("Delay action on: {need}", { need: need.description }),
        [t("Buys time to gather resources"), t("May allow better options to emerge")],
        [t("Urgency may increase"), t("Opportunity cost of delay")],
        "easy",
        t("Minimal"),
        t("Immediate progress on {need}", { need: need.description })
      ),
      makeOption(
        t("Gather more information first"),
        t("Research options before committing to {need}", { need: need.description }),
        [t("Reduces uncertainty"), t("May reveal better approaches")],
        [t("Delays action"), t("Situation may worsen while waiting")],
        "easy",
        t("Time for research"),
        t("Immediate progress on {need}", { need: need.description })
      ),
    ];
  }

  if (needs.length === 2) {
    // Two competing needs: resource allocation pattern
    const [needA, needB] = needs;
    return [
      makeOption(
        t("Prioritize {a}", { a: needA.description }),
        t("Allocate resources primarily to: {a}", { a: needA.description }),
        [t("{a} is more urgent/important", { a: needA.description }), t("{b} can wait", { b: needB.description })],
        [t("{b} worsens", { b: needB.description }), t("May create guilt/regret")],
        assessReversibility(stakes, reversibilityHint),
        t("Focus resources on A"),
        t("Progress on {b}", { b: needB.description })
      ),
      makeOption(
        t("Prioritize {b}", { b: needB.description }),
        t("Allocate resources primarily to: {b}", { b: needB.description }),
        [t("{b} is more urgent/important", { b: needB.description }), t("{a} can wait", { a: needA.description })],
        [t("{a} worsens", { a: needA.description }), t("May create guilt/regret")],
        assessReversibility(stakes, reversibilityHint),
        t("Focus resources on B"),
        t("Progress on {a}", { a: needA.description })
      ),
      makeOption(
        t("Split resources between both"),
        t("Partially address: {a} AND {b}", { a: needA.description, b: needB.description }),
        [t("Makes progress on both"), t("Reduces risk of total neglect")],
        [t("Neither gets fully resolved"), t("May be insufficient for both")],
        "somewhat",
        t("Divided resources"),
        t("Full resolution of either {a} or {b}", { a: needA.description, b: needB.description })
      ),
      makeOption(
        t("Seek additional resources"),
        t("Find more money/time/help to address both: {a} and {b}", { a: needA.description, b: needB.description }),
        [t("Potentially resolves both fully"), t("Expands the pie")],
        [t("May not be possible"), t("Takes time and effort")],
        "easy",
        t("Time, network, creativity"),
        t("Immediate partial progress on both")
      ),
    ];
  }

  // Three or more needs: prioritization/sequence pattern
  const topNeeds = needs.slice(0, 3);
  return [
    makeOption(
      t("Focus on most urgent: {first}", { first: topNeeds[0].description }),
      t("Sequence: {steps}", { steps: topNeeds.map((n) => n.description).join(" → ") }),
      [t("Tackles highest priority first"), t("Creates momentum")],
      [t("Lower priorities delayed"), t("May miss windows of opportunity")],
      assessReversibility(stakes, reversibilityHint),
      t("Sequential resource allocation"),
      t("Simultaneous progress on all")
    ),
    makeOption(
      t("Distribute across all: {needs}", { needs: topNeeds.map((n) => n.description).join(", ") }),
      t("Partial progress on each need simultaneously"),
      [t("No need completely neglected"), t("Balanced approach")],
      [t("May be too thin to matter"), t("Complex to manage")],
      "somewhat",
      t("Divided attention and resources"),
      t("Deep progress on any single need")
    ),
    makeOption(
      t("Get help to handle all"),
      t("Delegate/outsource: {others} while focusing on {first}", { others: topNeeds.slice(1).map((n) => n.description).join(", "), first: topNeeds[0].description }),
      [t("Leverages others' capacity"), t("Can address multiple in parallel")],
      [t("Requires trust/coordination"), t("May cost more")],
      "easy",
      t("Network, money, management time"),
      t("Solo progress on all")
    ),
  ];
}

function makeOption(
  label: string,
  description: string,
  rationale: string[],
  risks: string[],
  reversibility: ReversibilityLevel,
  requiredResources: string,
  opportunityCost: string
): GeneratedOption {
  return {
    id: uid("opt"),
    label: clip(label, 80),
    description: clip(description, 200),
    rationale: rationale.join("; "),
    assumptions: [],
    risks,
    reversibility,
    requiredResources,
    opportunityCost,
  };
}

function assessReversibility(
  stakes: "tiny" | "normal" | "significant" | "major",
  reversibilityHint?: number
): ReversibilityLevel {
  if (reversibilityHint !== undefined) {
    if (reversibilityHint >= 0.8) return "easy";
    if (reversibilityHint >= 0.6) return "somewhat";
    if (reversibilityHint >= 0.3) return "hard";
    return "very_hard";
  }
  switch (stakes) {
    case "tiny":
      return "easy";
    case "normal":
      return "somewhat";
    case "significant":
      return "hard";
    case "major":
      return "very_hard";
  }
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return (space > max / 2 ? cut.slice(0, space) : cut) + "…";
}

/** Convert generated options to DecisionOption format for the engine. */
export function toDecisionOptions(
  generated: GeneratedOption[],
  factors: DecisionFactor[]
): DecisionOption[] {
  return generated.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    outcomes: [
      {
        id: uid("out"),
        label: t("Expected outcome"),
        probability: 1,
        probabilityConfidence: 0.5,
        factors: factors.map((f) => ({
          factorId: f.id,
          value: 0, // Will be scored later
        })),
        provenance: "MODEL_ASSUMED" as Provenance,
      },
    ],
    reversibility: reversibilityLevelToNumber(g.reversibility),
    reversibilityLevel: g.reversibility,
    rationale: g.rationale,
    assumptions: g.assumptions,
    risks: g.risks,
    requiredResources: g.requiredResources,
    opportunityCost: g.opportunityCost,
    generated: true,
    provenance: "MODEL_INFERRED" as Provenance,
  }));
}

function reversibilityLevelToNumber(level: ReversibilityLevel): number {
  switch (level) {
    case "easy":
      return 0.9;
    case "somewhat":
      return 0.6;
    case "hard":
      return 0.3;
    case "very_hard":
      return 0.1;
  }
}