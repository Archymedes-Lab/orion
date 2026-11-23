// ORION — shared types (§25, §26 spec).
export type Stakes = "tiny" | "normal" | "significant" | "major";
export type SafetyClass =
  | "normal"
  | "financial-high-stakes"
  | "health-high-stakes"
  | "legal-high-stakes"
  | "crisis"
  | "dangerous";

export type DecisionCategory =
  | "Everyday" | "Food" | "Health" | "Fitness" | "Time" | "Money"
  | "Purchase" | "Work" | "Career" | "Business" | "Education"
  | "Relationships" | "Family" | "Social" | "Travel" | "Home"
  | "Transportation" | "Technology" | "Lifestyle" | "Personal growth"
  | "Major life decision" | "Custom";

export type Provenance = "USER_STATED" | "MODEL_INFERRED" | "MODEL_ASSUMED" | "USER_CONFIRMED";

export type DecisionModeType =
  | "BINARY"
  | "MULTI_OPTION"
  | "TRADEOFF"
  | "RESOURCE_ALLOCATION"
  | "PRIORITIZATION"
  | "TIMING"
  | "GO_NO_GO"
  | "SEQUENCE"
  | "REVERSIBLE_EXPERIMENT"
  | "UNCERTAINTY"
  | "VALUE_CONFLICT";

export type ReversibilityLevel = "easy" | "somewhat" | "hard" | "very_hard";

export type ConfidenceLevel = "high" | "moderate" | "low";

export type RobustnessLevel = "robust" | "fragile" | "tossup";

export interface DecisionExtraction {
  title: string;
  category: DecisionCategory[];
  options: { id: string; label: string; description?: string; /** ORION suggested this option; the question did not name it. */ generated?: boolean }[];
  factors: { id: string; label: string; importance: number; reason: string }[];
  missingInformation: { question: string; expectedInformationGain: number }[];
  stakes: Stakes;
  /** Provenance of each extracted element */
  provenance?: {
    options?: Record<string, Provenance>;
    factors?: Record<string, Provenance>;
    stakes?: Provenance;
    category?: Provenance;
  };
  /** Competing needs/obligations identified but not necessarily options */
  obligations?: { id: string; description: string; type: "need" | "constraint" | "preference"; provenance: Provenance }[];
  /** Model-generated options when user didn't specify alternatives */
  generatedOptions?: { id: string; label: string; rationale: string; assumptions: string[]; risks: string[]; reversibility: ReversibilityLevel; requiredResources: string }[];
}

/** How a factor's effect plays out over time. See decision-engine/aftermath.ts feltAt. */
export type Pace = "fast" | "fading" | "adapting" | "steady" | "slow" | "compounding";
export const PACES = ["fast", "fading", "adapting", "steady", "slow", "compounding"] as const;

export interface DecisionFactor {
  id: string;
  label: string;
  /** 0..1 normalized weight */
  weight: number;
  /** Set by the AI that read the question; when missing, the pace is read from the label's keywords. */
  pace?: Pace;
  /** Provenance of this factor */
  provenance?: Provenance;
  /** Source of the factor */
  source?: string;
}

export interface FactorValue {
  factorId: string;
  /** -10..+10 impact of this outcome on the factor */
  value: number;
}

export interface Outcome {
  id: string;
  label: string;
  /** 0..1 */
  probability: number;
  /** 0..1 confidence in the probability estimate (§7) */
  probabilityConfidence: number;
  factors: FactorValue[];
  /** Provenance of probability and factor values */
  provenance?: Provenance;
  /** Evidence supporting this outcome */
  evidenceIds?: string[];
}

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  outcomes: Outcome[];
  /** 0..1 (§8) */
  reversibility: number;
  /** Human-readable reversibility assessment */
  reversibilityLevel?: ReversibilityLevel;
  /** Rationale for this option (for generated options) */
  rationale?: string;
  /** Assumptions this option depends on */
  assumptions?: string[];
  /** Risks specific to this option */
  risks?: string[];
  /** Resources required to execute this option */
  requiredResources?: string;
  /** Opportunity cost: what you give up by choosing this */
  opportunityCost?: string;
  /** Whether this option was model-generated */
  generated?: boolean;
  /** Provenance of this option */
  provenance?: Provenance;
}

/**
 * A weighted way an option can play out. This is the multi-outcome extension of
 * the flat option×factor Score: several outcomes per option, each carrying a
 * value for every factor, make scenarios, sensitivity and uncertainty bands
 * mean something instead of being decorative.
 */
export interface ScenarioScore {
  optionId: string;
  label: string;
  /** 0..1 likelihood of this outcome relative to its siblings. */
  probability: number;
  /** 0..1 confidence in this outcome's likelihood and values (§7). */
  probabilityConfidence: number;
  /** factorId → -10..+10 impact in this outcome. */
  values: Record<string, number>;
}

export interface ScoredOption {
  optionId: string;
  jev: number;
  confidence: number;
  uncertaintyWidth: number;
  low: number;
  high: number;
}

/**
 * One exact "what would have to be true" for a single factor, solved from the
 * linear model rather than estimated: JEV is linear in each factor value, so
 * the change that exactly closes the leader/runner gap is gap / weight.
 */
export interface FlipThreshold {
  factorId: string;
  label: string;
  /** Points of impact change on the runner-up that exactly closes the gap. */
  deltaNeeded: number;
  /** The runner-up's current impact for this factor. */
  currentValue: number;
  /** Resulting impact value if the change were applied. */
  targetValue: number;
  /** False when the change would push impact outside the model's -10..+10 range. */
  reachable: boolean;
  /** Short human phrasing of the exact threshold. */
  threshold: string;
}

export interface SensitivityResult {
  /** Human-readable "what would have to be true" (§10) */
  flips: { description: string; threshold: string }[];
  dominantFactors: { factorId: string; label: string; impact: number }[];
  stable: boolean;
  /** Exact per-factor thresholds, strongest swing first. */
  thresholds?: FlipThreshold[];
  /** Leader-minus-runner JEV gap the thresholds are solving for. */
  gap?: number;
}

export interface ScenarioResult {
  conservative: ScoredOption[];
  expected: ScoredOption[];
  optimistic: ScoredOption[];
  stability: "high" | "medium" | "low";
}

export type ConstraintType = "HARD" | "SOFT" | "PREFERENCE";
export type ConstraintSeverity = "low" | "medium" | "high" | "critical";

/**
 * Comparison operators for structured constraints. Operands are always in the
 * same units as the model: a -10..+10 expected impact on `subject`.
 */
export type ConstraintOperator = "LT" | "LTE" | "GT" | "GTE" | "EQ" | "NEQ";

export interface Constraint {
  id: string;
  decisionId?: string;
  name: string;
  description?: string;
  type: ConstraintType;
  severity?: ConstraintSeverity;
  value?: string;
  /** Human-readable unit label for the bound, e.g. "impact points". */
  unit?: string;
  /** Exclusion list: these option ids are ruled out (HARD only). */
  optionIds?: string[];
  /** Factor id or label the bound applies to. */
  subject?: string;
  operator?: ConstraintOperator;
  /** Threshold on the option's expected impact for `subject`, -10..+10. */
  numericValue?: number;
  /** JEV subtracted per SOFT violation. Defaults by severity. */
  penalty?: number;
  /** Provenance of this constraint */
  provenance?: Provenance;
}

export type EvidenceType = "USER_PROVIDED" | "DOCUMENT" | "LINK" | "NOTE" | "CALCULATION" | "FACT" | "ASSUMPTION";

export interface Evidence {
  id: string;
  decisionId?: string;
  type: EvidenceType;
  title?: string;
  content: string;
  source?: string;
  /** 0..1 reliability of this evidence */
  reliability?: number;
  /** 0..1 relevance to the decision */
  relevance?: number;
  /** When this evidence was gathered */
  createdAt?: string;
  /** Provenance of this evidence */
  provenance?: Provenance;
}

export interface Assumption {
  id: string;
  decisionId?: string;
  statement: string;
  /** 0..1 confidence in this assumption */
  confidence?: number;
  source?: string;
  /** Provenance of this assumption */
  provenance?: Provenance;
  /** Whether this assumption has been validated by user */
  userValidated?: boolean;
}

export type CriterionDirection = "MAXIMIZE" | "MINIMIZE" | "NEUTRAL";

export interface Criterion {
  id: string;
  decisionId?: string;
  name: string;
  description?: string;
  importance: number;
  weight: number;
  direction: CriterionDirection;
  /** Provenance of this criterion */
  provenance?: Provenance;
}

export type UnknownImpact = "low" | "medium" | "high";

export interface Unknown {
  id: string;
  decisionId?: string;
  question: string;
  importance?: UnknownImpact;
  estimatedImpact?: number;
  resolved?: boolean;
  resolution?: string;
  /** Provenance of this unknown */
  provenance?: Provenance;
}

export interface Risk {
  id: string;
  decisionId?: string;
  optionId?: string;
  description: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  /** Mitigation or safeguard */
  mitigation?: string;
  /** Early warning signal */
  warningSignal?: string;
  provenance?: Provenance;
}

export interface DecisionScenario {
  id: string;
  decisionId?: string;
  name: string;
  description?: string;
  changes: string;
  leaderOptionId?: string | null;
  explanation?: string | null;
}

/** Extended ScoredOption with decision-quality fields */
export interface ScoredOption {
  optionId: string;
  jev: number;
  confidence: number;
  uncertaintyWidth: number;
  low: number;
  high: number;
  /** Decision confidence (separate from score confidence) */
  decisionConfidence?: ConfidenceLevel;
  /** What would change the result */
  flipConditions?: string[];
  /** Opportunity cost summary */
  opportunityCost?: string;
  /** Reversibility assessment */
  reversibilityLevel?: ReversibilityLevel;
}

/** Extended SensitivityResult with robustness and assumption sensitivity */
export interface SensitivityResult {
  /** Human-readable "what would have to be true" (§10) */
  flips: { description: string; threshold: string }[];
  dominantFactors: { factorId: string; label: string; impact: number }[];
  stable: boolean;
  /** Exact per-factor thresholds, strongest swing first. */
  thresholds?: FlipThreshold[];
  /** Leader-minus-runner JEV gap the thresholds are solving for. */
  gap?: number;
  /** Robustness assessment */
  robustness?: RobustnessLevel;
  /** How much each assumption would need to change to flip the decision */
  assumptionSensitivity?: { assumption: string; deltaNeeded: number; reachable: boolean }[];
}

/** Why the engine landed where it did. Every field is derived, never generated. */
export type ReasonType =
  | "CRITERION"
  | "CONSTRAINT"
  | "EVIDENCE"
  | "UNCERTAINTY"
  | "SAFETY"
  | "INFORMATION";

export interface Reason {
  type: ReasonType;
  text: string;
  /** Optional factor/option/evidence id this reason came from. */
  ref?: string;
}

/** A constraint that could not be evaluated against the model. */
export interface ConstraintWarning {
  constraint: Constraint;
  reason: string;
}

/**
 * The deterministic verdict. `recommendation` is null whenever the engine
 * genuinely cannot pick — no signal, everything blocked, or a dead tie. The
 * honest failure modes are first-class results, not silent guesses.
 */
export type PolicyVerdict =
  | "recommend"
  | "tie"
  | "no-viable-option"
  | "insufficient-information"
  /** Crisis/dangerous: never modelled, never a leader. */
  | "support-path";

export interface BlockedOption {
  optionId: string;
  label: string;
  reason: string;
  constraintId: string;
}
