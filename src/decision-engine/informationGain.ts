// §9 information value: what single fact would most help?
import type { DecisionOption } from "../types.ts";
import { t } from "../i18n/index.ts";
import { sensitivity } from "./sensitivity.ts";
import type { DecisionFactor } from "../types.ts";

export function bestThingToLearn(
  options: DecisionOption[],
  factors: DecisionFactor[]
): string {
  const s = sensitivity(options, factors);
  const top = s.dominantFactors[0];
  if (!top || s.stable) return t("You probably know enough to decide.");
  // The dominant swing factor is the highest-VOI question.
  return t("Check \"{factor}\": it drives the difference between options. One concrete observation there is worth more than refining anything else.", { factor: top.label });
}
