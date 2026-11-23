// Reads every rated, decided choice back as an observation for the aftermath's spread calibration.
import { db } from "./database.ts";
import { modelFromRows } from "./model.ts";
import { aftermath } from "../decision-engine/aftermath.ts";
import { isMode } from "../decision-engine/mode.ts";
import { calibrate, RATING_ZONE, type Calibration, type Observation } from "../decision-engine/spreadCalibration.ts";
import type { SafetyClass, Stakes } from "../types.ts";

const DAY = 86_400_000;

export async function loadSpreadCalibration(): Promise<Calibration> {
  await db.init();
  const [decisions, metadata, options, factors, values, outcomes] = await Promise.all(
    ["decisions", "decision_metadata", "options", "factors", "option_factor_values", "decision_outcomes"].map((t) => db.list(t))
  );
  const observations: Observation[] = [];
  for (const d of decisions) {
    const chosen = d.selected_option_id ? String(d.selected_option_id) : null;
    const decidedAt = Date.parse(String(d.decided_at ?? ""));
    if (!chosen || Number.isNaN(decidedAt)) continue;
    const meta = metadata.find((m) => m.decision_id === d.id || m.id === d.id);
    const mode = isMode(meta?.mode) ? meta?.mode : null;
    if (!mode) continue;
    const model = modelFromRows(String(d.id), options, factors, values);
    for (const o of outcomes.filter((r) => r.decision_id === d.id && RATING_ZONE[String(r.rating)])) {
      const days = (Date.parse(String(o.created_at)) - decidedAt) / DAY;
      if (!(days >= 0)) continue;
      observations.push({
        zone: RATING_ZONE[String(o.rating)],
        predict: (spread) => {
          const picture = aftermath({
            ...model, optionId: chosen, mode, stakes: d.stakes as Stakes, safety: (meta?.safety as SafetyClass) ?? "normal", signal: true, spread,
          });
          if (!picture || picture.steps.length === 0) return null;
          // The moment nearest the rating, on a log scale: day 20 is closer to a month than to a week.
          const near = picture.steps.reduce((a, b) => Math.abs(Math.log1p(b.days) - Math.log1p(days)) < Math.abs(Math.log1p(a.days) - Math.log1p(days)) ? b : a);
          return near.odds;
        },
      });
    }
  }
  return calibrate(observations);
}
