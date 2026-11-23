// Business priorities in the web app: Jev's ratings are fetched once (/decision/prioritize); the matrices are
// recomputed here from them (src/decision-engine/prioritize.ts).
import { t } from "@orion/i18n/index.ts";
import type { PriorityJudgment } from "@orion/decision-engine/prioritize.ts";
import type { BusinessProfile } from "@orion/business/schema.ts";
import { api, ApiError } from "./api";
import type { DecisionRun } from "./decide";

export interface PriorityData { judgments: PriorityJudgment[]; judge: "typesafe" | "ai" }

export async function findPriorities(run: DecisionRun, company: BusinessProfile, signal?: AbortSignal): Promise<PriorityData> {
  try {
    return await api<PriorityData>("decision/prioritize", {
      context: run.question.slice(0, 4000),
      options: run.options.slice(0, 8).map(({ id, label }) => ({ id, label })),
      business: company,
    }, { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 402) throw new Error(t("Today’s free scored decisions are used up. Priorities come back tomorrow."));
    if ((error as Error).name === "AbortError") throw error;
    throw new Error(t("Priorities are unavailable right now. Try again in a moment."));
  }
}
