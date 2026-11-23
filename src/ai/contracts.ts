import { z } from "zod";
import { PACES } from "../types.ts";
import { BusinessProfileSchema } from "../business/schema.ts";

export const SafetySchema = z.enum(["normal", "financial-high-stakes", "health-high-stakes", "legal-high-stakes", "crisis", "dangerous"]);
export const StakesSchema = z.enum(["tiny", "normal", "significant", "major"]);
export const ProvenanceSchema = z.enum(["USER_STATED", "MODEL_INFERRED", "MODEL_ASSUMED", "USER_CONFIRMED"]);
export const ReversibilityLevelSchema = z.enum(["easy", "somewhat", "hard", "very_hard"]);

const id = z.string().min(1).max(100);
const label = z.string().trim().min(1).max(80);
const unit = z.number().finite().min(0).max(1);
const impact = z.number().finite().min(-10).max(10);
const unique = (rows: { id: string }[]) => new Set(rows.map((row) => row.id)).size === rows.length;

/** Present when the decision is made for a company: switches on the business playbook (server/business.ts). */
const business = BusinessProfileSchema.optional();

export const ParseRequestSchema = z.object({ input: z.string().trim().min(1).max(4000), business });
export const ScoreRequestSchema = z.object({
  context: z.string().trim().min(1).max(4000),
  stakes: StakesSchema.default("normal"),
  options: z.array(z.object({ id, label })).min(2).max(4).refine(unique, "Duplicate option ids"),
  factors: z.array(z.object({ id, label: label.max(40) })).min(1).max(8).refine(unique, "Duplicate factor ids"),
  business,
});
export const FactorScoreSchema = z.object({ optionId: id, factorId: id, value: impact, probabilityConfidence: unit });
export const TriageRequestSchema = z.object({
  context: z.string().trim().min(1).max(4000),
  candidates: z.array(z.string().trim().min(1).max(200)).max(8),
  budget: z.number().int().min(0).max(3).default(3),
  business,
});

const FactorSchema = z.object({ 
  id, 
  label: label.max(40), 
  weight: unit,
  provenance: ProvenanceSchema.optional(),
  source: z.string().optional(),
  pace: z.enum(PACES).optional().catch(undefined),
});
const OutcomeSchema = z.object({
  id, 
  label: z.string().min(1).max(200), 
  probability: unit, 
  probabilityConfidence: unit,
  factors: z.array(z.object({ factorId: id, value: impact })).min(1).max(8),
  provenance: ProvenanceSchema.optional(),
  evidenceIds: z.array(z.string()).optional(),
});
const OptionSchema = z.object({
  id, 
  label, 
  description: z.string().max(280).optional(),
  reversibility: unit,
  reversibilityLevel: ReversibilityLevelSchema.optional(),
  rationale: z.string().max(500).optional(),
  risks: z.array(z.string().max(200)).optional(),
  requiredResources: z.string().max(200).optional(),
  opportunityCost: z.string().max(200).optional(),
  generated: z.boolean().optional(),
  provenance: ProvenanceSchema.optional(),
  outcomes: z.array(OutcomeSchema).min(1).max(4).refine((outcomes) => outcomes.reduce((sum, o) => sum + o.probability, 0) > 0),
});
const ModelShape = {
  options: z.array(OptionSchema).min(2).max(4).refine(unique),
  factors: z.array(FactorSchema).min(1).max(8).refine(unique)
    .refine((factors) => factors.reduce((sum, f) => sum + f.weight, 0) > 0),
  safety: SafetySchema,
  business,
};
const completeModel = (model: { options: z.infer<typeof OptionSchema>[]; factors: z.infer<typeof FactorSchema>[] }, ctx: z.RefinementCtx) => {
  const ids = new Set(model.factors.map((factor) => factor.id));
  if (model.options.some((option) => option.outcomes.some((outcome) =>
    outcome.factors.length !== ids.size || new Set(outcome.factors.map((f) => f.factorId)).size !== ids.size ||
    outcome.factors.some((factor) => !ids.has(factor.factorId))))) {
    ctx.addIssue({ code: "custom", message: "Every outcome must reference each known factor exactly once" });
  }
};
export const ExplanationRequestSchema = z.object(ModelShape).superRefine(completeModel);
export type ExplanationRequest = z.infer<typeof ExplanationRequestSchema>;

/** The model plus which option to picture; the server recomputes the aftermath itself and only asks AI for wording. */
export const AftermathRequestSchema = z.object({
  ...ModelShape,
  title: z.string().trim().min(1).max(120),
  optionId: id,
  mode: z.enum(["playful", "everyday", "serious"]),
  stakes: StakesSchema,
}).superRefine((model, ctx) => {
  completeModel(model, ctx);
  if (!model.options.some((o) => o.id === model.optionId)) ctx.addIssue({ code: "custom", message: "Unknown option" });
});
export type AftermathRequest = z.infer<typeof AftermathRequestSchema>;
const line = z.string().trim().min(1).max(360);
export const AftermathWordingSchema = z.object({ steps: z.array(z.object({ likely: line, goodTurn: line, hardTurn: line })).min(1).max(8) });
export type AftermathWording = z.infer<typeof AftermathWordingSchema>;
