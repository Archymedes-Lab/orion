// Prioritisation matrices for business decisions: "what's urgent? what has the highest leverage? what first?"
//
// A judge (Jev) gives a belief over five levels for seven dimensions of every option. Code turns them into the
// standard matrices operators use, and then into one consensus order:
//
//   Eisenhower      urgent × important → do now · schedule · delegate · drop              (urgency, impact)
//   Impact/Effort   quick win · big bet · fill-in · money pit                             (impact, effort)
//   RICE            Reach × Impact × Confidence ÷ Effort                       (Intercom; RICE's own scales)
//   ICE             Impact × Confidence × Ease, 1–10 each                                 (Sean Ellis)
//   WSJF            Cost of Delay ÷ Job Size; CoD = value + time criticality + risk reduction/opportunity
//                   enablement, Fibonacci-scaled                                             (Reinertsen, SAFe)
//   Leverage        Impact × (1 + enablement) ÷ Effort: output per unit of input, counting what it unlocks
//   Door            one-way (hard to undo: decide carefully) or two-way (cheap to undo: decide fast)  (Bezos)
//
// The consensus is a Borda count over the five scored frameworks; Kendall's W says how far they agree. Because the
// inputs are distributions, WSJF is computed as an exact lottery per option (src/decision-engine/creative.ts), which
// gives P(this should come first) without sampling — the honest answer to "how sure is the top pick?".
import { Lottery, pBest } from "./creative.ts";

export const PRIORITY_DIMENSIONS = ["impact", "urgency", "reach", "confidence", "effort", "leverage", "reversibility"] as const;
export type PriorityDimension = (typeof PRIORITY_DIMENSIONS)[number];

/** The question and the five levels (worst/least → most) Jev is asked for each dimension. */
export const PRIORITY_QUESTIONS: Record<PriorityDimension, { question: string; levels: string[] }> = {
  impact: { question: "How much would `option` move the company's most important goal if it works?", levels: ["Barely at all", "A little", "Noticeably", "Substantially", "Transformatively"] },
  urgency: { question: "How much value is lost for every month `option` is delayed (deadlines, closing windows, compounding damage)?", levels: ["Nothing is lost by waiting", "Little is lost", "Some value is lost", "A lot is lost", "Waiting is very costly or a deadline is imminent"] },
  reach: { question: "How many customers, people or parts of the business would `option` affect in the next quarter?", levels: ["Almost none", "A few", "A meaningful share", "Most", "Nearly all"] },
  confidence: { question: "How strong is the evidence that `option` will deliver what it promises?", levels: ["A guess", "Weak signals", "Some evidence", "Good evidence", "Proven here or very close to it"] },
  effort: { question: "How much time, money and people would `option` take to deliver?", levels: ["Hours", "Days", "Weeks", "Months", "Quarters or more"] },
  leverage: { question: "Does `option` unlock other work, reduce a major risk, or compound over time?", levels: ["Not at all", "Slightly", "Somewhat", "Clearly", "It is a foundation much else depends on"] },
  reversibility: { question: "If `option` turns out wrong, how easily could the company undo it?", levels: ["Practically irreversible", "Hard and costly to undo", "Undoable with real cost", "Easy to undo", "Trivially reversible"] },
};

export interface PriorityJudgment {
  optionId: string;
  /** dimension → distribution over its five levels */
  dims: Record<PriorityDimension, number[]>;
}

export type EisenhowerQuadrant = "do" | "schedule" | "delegate" | "drop";
export type EffortQuadrant = "quick_win" | "big_bet" | "fill_in" | "money_pit";
export type Framework = "rice" | "ice" | "wsjf" | "leverage" | "eisenhower";

export interface PriorityRow {
  optionId: string;
  /** Expected level, 0..1, per dimension. */
  level: Record<PriorityDimension, number>;
  eisenhower: EisenhowerQuadrant;
  effortMatrix: EffortQuadrant;
  rice: number;
  ice: number;
  wsjf: number;
  leverage: number;
  door: "one_way" | "two_way";
  /** 1 = first, per framework. */
  ranks: Record<Framework, number>;
  /** Consensus position, 1 = do first. */
  rank: number;
  /** P(highest WSJF), exact over the beliefs, ties split. */
  pFirst: number;
}

export interface Priorities {
  rows: PriorityRow[];
  /** Kendall's W over the five frameworks, 0 (no agreement) … 1 (identical orders). */
  agreement: number;
  first: string | null;
  /** Urgent and important: the Eisenhower "do now" items, in consensus order. */
  urgent: string[];
  /** Highest leverage option. */
  highestLeverage: string | null;
  /** Quick wins, in consensus order. */
  quickWins: string[];
}

// Scales. Fibonacci for WSJF as SAFe prescribes; RICE's published impact and confidence steps; ICE 1–10.
const FIB = [1, 2, 3, 5, 8];
const RICE_IMPACT = [0.25, 0.5, 1, 2, 3];
const RICE_CONFIDENCE = [0.5, 0.65, 0.8, 0.9, 1];
const TEN = [2, 4, 6, 8, 10];
/** A level of 3 of 5 or more ("noticeably", "some value lost") counts as high on a 2×2. */
const HIGH = 0.5;

const expect = (dist: number[], scale: number[]) => dist.reduce((a, p, i) => a + p * scale[i], 0);
const unit = (dist: number[]) => expect(dist, [0, 0.25, 0.5, 0.75, 1]);

function wsjfLottery(j: PriorityJudgment): Lottery {
  const cod = Lottery.of(FIB, j.dims.impact).add(Lottery.of(FIB, j.dims.urgency)).add(Lottery.of(FIB, j.dims.leverage));
  return cod.combine(Lottery.of(FIB, j.dims.effort), (c, size) => c / size);
}

/** 1-based ranks, highest value first; equal values share the better rank. */
function ranksOf(values: number[]): number[] {
  return values.map((v) => 1 + values.filter((w) => w > v + 1e-9).length);
}

export function prioritize(judgments: PriorityJudgment[]): Priorities {
  if (!judgments.length) return { rows: [], agreement: 1, first: null, urgent: [], highestLeverage: null, quickWins: [] };
  const base = judgments.map((j) => {
    const level = Object.fromEntries(PRIORITY_DIMENSIONS.map((d) => [d, unit(j.dims[d])])) as Record<PriorityDimension, number>;
    const urgent = level.urgency >= HIGH, important = level.impact >= HIGH, heavy = level.effort >= HIGH;
    const eisenhower: EisenhowerQuadrant = urgent && important ? "do" : important ? "schedule" : urgent ? "delegate" : "drop";
    const effortMatrix: EffortQuadrant = important ? (heavy ? "big_bet" : "quick_win") : heavy ? "money_pit" : "fill_in";
    const effortFib = expect(j.dims.effort, FIB);
    return {
      optionId: j.optionId, level, eisenhower, effortMatrix,
      rice: (expect(j.dims.reach, FIB) * expect(j.dims.impact, RICE_IMPACT) * expect(j.dims.confidence, RICE_CONFIDENCE)) / effortFib,
      ice: expect(j.dims.impact, TEN) * expect(j.dims.confidence, TEN) * expect(j.dims.effort, [...TEN].reverse()),
      wsjf: wsjfLottery(j).mean(),
      leverage: (expect(j.dims.impact, FIB) * (1 + level.leverage)) / effortFib,
      door: (level.reversibility < HIGH ? "one_way" : "two_way") as PriorityRow["door"],
    };
  });
  // Eisenhower orders by quadrant, then by how urgent-and-important it is within the quadrant.
  const QUAD = { do: 3, schedule: 2, delegate: 1, drop: 0 };
  const scores: Record<Framework, number[]> = {
    rice: base.map((b) => b.rice),
    ice: base.map((b) => b.ice),
    wsjf: base.map((b) => b.wsjf),
    leverage: base.map((b) => b.leverage),
    eisenhower: base.map((b) => QUAD[b.eisenhower] + (b.level.urgency * b.level.impact) / 2),
  };
  const frameworks = Object.keys(scores) as Framework[];
  const ranks = Object.fromEntries(frameworks.map((f) => [f, ranksOf(scores[f])])) as Record<Framework, number[]>;
  const n = judgments.length, m = frameworks.length;
  const borda = base.map((_, i) => frameworks.reduce((a, f) => a + (n - ranks[f][i]), 0));
  // Ties on the Borda count go to WSJF, the framework built for sequencing.
  const order = base.map((_, i) => i).sort((a, b) => borda[b] - borda[a] || scores.wsjf[b] - scores.wsjf[a]);
  const first = pBest(judgments.map((j) => ({ value: wsjfLottery(j), fail: 0 })));

  const rows: PriorityRow[] = order.map((i, k) => ({
    ...base[i], ranks: Object.fromEntries(frameworks.map((f) => [f, ranks[f][i]])) as Record<Framework, number>, rank: k + 1, pFirst: first[i],
  }));
  // Kendall's W from the rank sums (ties are rare on continuous scores; no correction).
  const sums = base.map((_, i) => frameworks.reduce((a, f) => a + ranks[f][i], 0));
  const meanSum = (m * (n + 1)) / 2;
  const S = sums.reduce((a, r) => a + (r - meanSum) ** 2, 0);
  const agreement = n < 2 ? 1 : Math.max(0, Math.min(1, (12 * S) / (m * m * (n ** 3 - n))));
  const byLeverage = [...rows].sort((a, b) => b.leverage - a.leverage);
  return {
    rows,
    agreement: Math.round(agreement * 100) / 100,
    first: rows[0]?.optionId ?? null,
    urgent: rows.filter((r) => r.eisenhower === "do").map((r) => r.optionId),
    highestLeverage: byLeverage[0]?.optionId ?? null,
    quickWins: rows.filter((r) => r.effortMatrix === "quick_win").map((r) => r.optionId),
  };
}
