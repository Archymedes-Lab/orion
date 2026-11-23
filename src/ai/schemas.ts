// §25 structured AI output. Validate every model response; never let
// free-form text drive app state.
import { z } from "zod";
import { PACES } from "../types.ts";

export const ProvenanceSchema = z.enum(["USER_STATED", "MODEL_INFERRED", "MODEL_ASSUMED", "USER_CONFIRMED"]);

export const ReversibilityLevelSchema = z.enum(["easy", "somewhat", "hard", "very_hard"]);

export const ConfidenceLevelSchema = z.enum(["high", "moderate", "low"]);

export const RobustnessLevelSchema = z.enum(["robust", "fragile", "tossup"]);

export const DecisionModeTypeSchema = z.enum([
  "BINARY", "MULTI_OPTION", "TRADEOFF", "RESOURCE_ALLOCATION",
  "PRIORITIZATION", "TIMING", "GO_NO_GO", "SEQUENCE",
  "REVERSIBLE_EXPERIMENT", "UNCERTAINTY", "VALUE_CONFLICT"
]);

export const GeneratedOptionSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(80),
  rationale: z.string().max(500),
  assumptions: z.array(z.string().max(200)),
  risks: z.array(z.string().max(200)),
  reversibility: ReversibilityLevelSchema,
  requiredResources: z.string().max(200),
});

export const ObligationSchema = z.object({
  id: z.string(),
  description: z.string().min(1).max(200),
  type: z.enum(["need", "constraint", "preference"]),
  provenance: ProvenanceSchema,
});

export const EvidenceSchema = z.object({
  id: z.string(),
  type: z.enum(["USER_PROVIDED", "DOCUMENT", "LINK", "NOTE", "CALCULATION", "FACT", "ASSUMPTION"]),
  title: z.string().max(100).optional(),
  content: z.string().max(500),
  source: z.string().max(200).optional(),
  reliability: z.number().min(0).max(1).default(0.8),
  relevance: z.number().min(0).max(1).default(0.8),
  createdAt: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});

export const AssumptionSchema = z.object({
  id: z.string(),
  statement: z.string().max(300),
  confidence: z.number().min(0).max(1).default(0.7),
  source: z.string().max(200).optional(),
  provenance: ProvenanceSchema.optional(),
  userValidated: z.boolean().default(false),
});

export const ConstraintSchema = z.object({
  id: z.string(),
  name: z.string().max(100),
  description: z.string().max(300).optional(),
  type: z.enum(["HARD", "SOFT", "PREFERENCE"]),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  value: z.string().optional(),
  unit: z.string().max(50).optional(),
  optionIds: z.array(z.string()).optional(),
  subject: z.string().optional(),
  operator: z.enum(["LT", "LTE", "GT", "GTE", "EQ", "NEQ"]).optional(),
  numericValue: z.number().min(-10).max(10).optional(),
  penalty: z.number().min(0).optional(),
  provenance: ProvenanceSchema.optional(),
});

export const UnknownSchema = z.object({
  id: z.string(),
  question: z.string().max(200),
  importance: z.enum(["low", "medium", "high"]).optional(),
  estimatedImpact: z.number().optional(),
  resolved: z.boolean().default(false),
  resolution: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});

export const RiskSchema = z.object({
  id: z.string(),
  optionId: z.string().optional(),
  description: z.string().max(300),
  likelihood: z.enum(["low", "medium", "high"]),
  impact: z.enum(["low", "medium", "high"]),
  mitigation: z.string().max(300).optional(),
  warningSignal: z.string().max(300).optional(),
  provenance: ProvenanceSchema.optional(),
});

export const DecisionExtractionSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.array(z.string()).min(1).max(3),
  options: z
    .array(z.object({ 
      id: z.string(), 
      label: z.string().min(1).max(80), 
      description: z.string().max(280).optional(),
      /** ORION suggested this option; the question did not name it. */
      generated: z.boolean().optional(),
    }))
    .min(2)
    .max(4),
  factors: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().min(1).max(40),
        importance: z.number().min(0).max(1),
        reason: z.string().max(200),
        provenance: ProvenanceSchema.optional(),
        source: z.string().optional(),
        pace: z.enum(PACES).optional().catch(undefined),
      })
    )
    .min(1)
    .max(8),
  missingInformation: z
    .array(z.object({ question: z.string().min(1).max(200), expectedInformationGain: z.number().min(0).max(1) }))
    .max(5),
  stakes: z.enum(["tiny", "normal", "significant", "major"]),
  provenance: z.object({
    options: z.record(ProvenanceSchema).optional(),
    factors: z.record(ProvenanceSchema).optional(),
    stakes: ProvenanceSchema.optional(),
    category: ProvenanceSchema.optional(),
  }).optional(),
  obligations: z.array(ObligationSchema).optional(),
  generatedOptions: z.array(GeneratedOptionSchema).optional(),
});

export type DecisionExtractionValidated = z.infer<typeof DecisionExtractionSchema>;