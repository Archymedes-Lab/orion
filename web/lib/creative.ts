// New paths in the web app: ask the server for beliefs once (/decision/creative), then decide here, so the factor
// weights the person nudges re-rank the paths too. See server/creative.ts and src/decision-engine/creative.ts.
import { creativeDecide, toFactorScore, NULL_BASELINE, type CreativeJudgment, type GateStatus } from "@orion/decision-engine/creative.ts";
import { msg, t } from "@orion/i18n/index.ts";
import type { BusinessProfile } from "@orion/business/schema.ts";
import { api, ApiError } from "./api";
import type { DecisionRun, FactorScore } from "./decide";

export interface CreativeData {
  paths: { id: string; label: string; description: string; check: string; niche: string }[];
  niches: Record<string, string>;
  limits: { id: string; label: string; hard: boolean; checkOnly?: boolean }[];
  baselineId: string | null;
  judgments: CreativeJudgment[];
  judge: "typesafe" | "ai";
  divergeFailed?: boolean;
}

/** The built-in limits, worded in the reader's language; the decision's own limits arrive already worded. */
const LIMIT_LABEL: Record<string, string> = {
  harm: msg("Serious harm that can’t be undone"),
  law: msg("Breaking the law or misleading someone"),
  stretch: msg("More than you can give"),
};
/** Approach types by id (server/creative.ts APPROACHES), short enough for a tag. */
const NICHE_LABEL: Record<string, string> = {
  direct: msg("Head on"),
  staged: msg("Small trial first"),
  borrow: msg("With others’ help"),
  reorder: msg("Change the order"),
  reframe: msg("Change the goal"),
  combine: msg("Combine"),
  other: msg("Another way"),
};

export const limitLabel = (data: CreativeData, limitId: string) =>
  LIMIT_LABEL[limitId] ? t(LIMIT_LABEL[limitId]) : data.limits.find((l) => l.id === limitId)?.label ?? limitId;

export async function findPaths(run: DecisionRun, company: BusinessProfile, signal?: AbortSignal): Promise<CreativeData> {
  try {
    return await api<CreativeData>("decision/creative", {
      context: run.question.slice(0, 4000),
      stakes: run.stakes,
      options: run.options.filter((o) => !o.path).slice(0, 4).map(({ id, label }) => ({ id, label })),
      factors: run.factors.map(({ id, label }) => ({ id, label: label.slice(0, 40) })),
      business: run.lens === "business" ? company : undefined,
    }, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 402) throw new Error(t("Today’s free scored decisions are used up. New paths come back tomorrow."));
    if ((error as Error).name === "AbortError") throw error;
    throw new Error(t("New paths are unavailable right now. Try again in a moment."));
  }
}

export interface PathRow {
  id: string;
  label: string;
  description?: string;
  check?: string;
  /** Listed by the person (or the reader), as opposed to written as a new path. */
  listed: boolean;
  baseline: boolean;
  status: GateStatus;
  checks: string[];
  /** 0–100 */
  score: number;
  /** Chance it comes out best, ties split fairly. */
  pBest: number;
  novelty: number;
  niche: string;
  /** Already added to the comparison. */
  added: boolean;
}

export interface CreativeView {
  rows: PathRow[];
  commit: string | null;
  innovation: string | null;
  /** Expected value of perfect information, in 0–100 points: what learning more could still be worth. */
  evpi: number;
  escalate: string[];
}

/** Decide on the current weights. Expected utility 0..1 is shown as 0–100. */
export function creativeView(run: DecisionRun, data: CreativeData): CreativeView {
  const problem = {
    dimensions: run.factors.filter((f) => data.judgments.every((j) => j.dims[f.id])).map((f) => ({ id: f.id, weight: Math.max(1e-6, f.weight), levels: 5 })),
    limits: data.limits.map(({ id, hard, checkOnly }) => ({ id, hard, checkOnly })),
  };
  const d = creativeDecide(problem, data.judgments);
  const rows: PathRow[] = d.stats.filter((s) => s.id !== NULL_BASELINE).map((s) => {
    const path = data.paths.find((p) => p.id === s.id);
    const listed = run.options.find((o) => o.id === s.id && !o.path);
    return {
      id: s.id, label: path?.label ?? listed?.label ?? s.id, description: path?.description, check: path?.check,
      listed: !path, baseline: s.baseline, status: s.status, checks: s.checks,
      score: Math.round(s.mean * 100), pBest: s.pBest, novelty: s.novelty, niche: NICHE_LABEL[s.niche] ? t(NICHE_LABEL[s.niche]) : data.niches[s.niche] ?? s.niche,
      added: !!path && run.options.some((o) => o.id === s.id),
    };
  }).sort((a, b) => b.score - a.score);
  return {
    rows,
    commit: d.commit === NULL_BASELINE ? null : d.commit,
    innovation: d.innovation,
    evpi: Math.round(d.evpi * 1000) / 10,
    escalate: d.escalate.filter((e) => e !== NULL_BASELINE),
  };
}

/** Put a new path into the main comparison, scored from the same beliefs (expected level → −10..+10). */
export function addPath(run: DecisionRun, data: CreativeData, pathId: string): DecisionRun {
  const path = data.paths.find((p) => p.id === pathId);
  const j = data.judgments.find((x) => x.optionId === pathId);
  if (!path || !j || run.options.some((o) => o.id === pathId) || !run.scores) return run;
  const scores: FactorScore[] = run.factors.filter((f) => j.dims[f.id]).map((f) => ({ optionId: pathId, factorId: f.id, ...toFactorScore(j.dims[f.id]) }));
  return { ...run, options: [...run.options, { id: pathId, label: path.label, generated: true, path: true }], scores: [...run.scores, ...scores] };
}
