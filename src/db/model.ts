// A saved decision's options and factors, rebuilt from their rows. One outcome per option, as it was scored.
import { uid } from "../decision-engine/normalize.ts";
import { PACES, type DecisionFactor, type DecisionOption, type Pace } from "../types.ts";

type Row = Record<string, unknown>;

export function modelFromRows(id: string, optionRows: Row[], factorRows: Row[], valueRows: Row[]): { options: DecisionOption[]; factors: DecisionFactor[] } {
  const factors: DecisionFactor[] = factorRows.filter((r) => r.decision_id === id).map((r) => ({
    id: String(r.id),
    label: String(r.label),
    weight: Number(r.weight),
    // Saved before paces were stored, or not set by the AI: the label's keywords stand in.
    ...((PACES as readonly unknown[]).includes(r.pace) ? { pace: r.pace as Pace } : {}),
  }));
  const options: DecisionOption[] = optionRows.filter((r) => r.decision_id === id).map((r) => {
    const mine = valueRows.filter((v) => v.option_id === r.id);
    const conf = mine.length ? mine.reduce((a: number, v) => a + Number(v.confidence), 0) / mine.length : 0.5;
    return {
      id: String(r.id),
      label: String(r.label),
      reversibility: Number(r.reversibility ?? 0.5),
      outcomes: [{
        id: uid("out"),
        label: "Choose " + String(r.label),
        probability: 1,
        probabilityConfidence: conf,
        factors: mine.map((v) => ({ factorId: String(v.factor_id), value: Number(v.value) })),
      }],
    };
  });
  return { options, factors };
}
