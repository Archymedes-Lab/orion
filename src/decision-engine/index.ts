// Barrel: deterministic math only. No network, no LLM here.
export * from "./expectedValue.ts";
export * from "./uncertainty.ts";
export * from "./scenarios.ts";
export * from "./sensitivity.ts";
export * from "./informationGain.ts";
export * from "./normalize.ts";
export * from "./stoppingRule.ts";
export * from "./safety.ts";
export * from "./constraints.ts";
export * from "./policy.ts";
export * from "./simulation.ts";
export * from "./informationValue.ts";
export * from "./reasons.ts";
export * from "./calibration.ts";
export * from "./duel.ts";
export * from "./optionGeneration.ts";
export * from "./confidence.ts";
export * from "./robustness.ts";
export * from "./decisionModes.ts";
export * from "./aftermath.ts";
// checkIns' OutcomeRating would collide with calibration's star export; re-export it under an alias.
export {
  createDecisionRecord,
  recordCheckIn,
  recordOutcome,
  generateReflectionPrompt,
  aggregateLessons,
  scoreDecisionQuality,
} from "./checkIns.ts";
export type {
  DecisionRecord,
  CheckInSchedule,
  CheckInRating,
  OutcomeRating as CheckInOutcomeRating,
} from "./checkIns.ts";
export * from "./creative.ts";
export * from "./prioritize.ts";
