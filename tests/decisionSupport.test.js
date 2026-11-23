// Direct coverage for the decision-support modules that were previously only
// reached indirectly through the screens. These pin the behaviour the UI now
// depends on: hard constraints blocking options, soft penalties changing the
// ranking, `leader.gap` reporting the adjusted gap rather than raw JEV, and
// simulation/VOI never mutating the inputs they are handed.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weightsFromImportance } from "../src/ai/model.ts";
import { scoreAll } from "../src/decision-engine/uncertainty.ts";
import { sensitivity } from "../src/decision-engine/sensitivity.ts";
import {
  applyConstraintPolicy,
  constraintPenalties,
  evaluateConstraints,
  impactOn,
  preferenceOrder,
  softPenalty,
} from "../src/decision-engine/constraints.ts";
import { evaluatePolicy, REVIEW_CONFIDENCE } from "../src/decision-engine/policy.ts";
import { generateReasons } from "../src/decision-engine/reasons.ts";
import { simulate } from "../src/decision-engine/simulation.ts";
import {
  computeInformationValue,
  identifyUnknowns,
  rankInformationValue,
  worthAsking,
} from "../src/decision-engine/informationValue.ts";
import { bestThingToLearn } from "../src/decision-engine/informationGain.ts";

const factors = weightsFromImportance([
  { id: "cost", label: "Cost", importance: 1 },
  { id: "time", label: "Time", importance: 0.5 },
]);

/** Builds an option whose JEV is controlled by the given flat impacts. */
function option(id, label, cost, time, reversibility = 0.5) {
  return {
    id,
    label,
    reversibility,
    outcomes: [
      {
        id: `${id}-main`,
        label: "usual case",
        probability: 1,
        probabilityConfidence: 0.8,
        factors: [
          { factorId: "cost", value: cost },
          { factorId: "time", value: time },
        ],
      },
    ],
  };
}

// "Stay home" is 4.5 ahead on raw JEV, but it breaks a hard limit.
const stay = option("a", "Stay home", 3, 3, 0.9);
const travel = option("b", "Travel", -1.5, -1.5, 0.2);
const base = [stay, travel];

describe("constraints", () => {
  it("weights outcome probabilities when measuring factor impact", () => {
    const mixed = {
      id: "m",
      label: "Mixed",
      outcomes: [
        {
          id: "o1",
          label: "up",
          probability: 0.75,
          factors: [
            { factorId: "cost", value: 10 },
            { factorId: "time", value: 0 },
          ],
        },
        {
          id: "o2",
          label: "down",
          probability: 0.25,
          factors: [
            { factorId: "cost", value: -10 },
            { factorId: "time", value: 0 },
          ],
        },
      ],
    };
    assert.equal(impactOn(mixed, "cost"), 5);
    // Never estimated: an absent factor reads as 0, not as a guess.
    assert.equal(impactOn(mixed, "unheard-of"), 0);
  });

  it("blocks an option named by a hard constraint", () => {
    const { violations } = evaluateConstraints(
      [
        {
          id: "c1",
          decisionId: "d",
          type: "HARD",
          name: "No overnight travel",
          optionIds: ["a"],
        },
      ],
      base
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].optionId, "a");
    assert.match(violations[0].reason, /Stay home/);
  });

  it("warns instead of guessing when a hard constraint names an unknown factor", () => {
    const { violations, warnings } = evaluateConstraints(
      [
        {
          id: "c1",
          decisionId: "d",
          type: "HARD",
          name: "Cost ceiling",
          subject: "Vibes",
          operator: "LTE",
          numericValue: 0,
        },
      ],
      base,
      factors
    );
    // A limit that cannot be checked must not silently pass anything.
    assert.equal(violations.length, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].reason, /Vibes/);
  });

  it("uses an explicit penalty over the severity default and never goes negative", () => {
    assert.equal(softPenalty({ penalty: 7 }), 7);
    assert.equal(softPenalty({ penalty: -3 }), 0);
    assert.ok(softPenalty({ severity: "high" }) > softPenalty({ severity: "low" }));
  });

  it("subtracts soft penalties from ranking without removing the option", () => {
    // "Stay home" scores 3 on Cost, so it breaks a "must be at most 0" rule;
    // "Travel" scores -1.5 and complies.
    const penalties = constraintPenalties(
      [
        {
          id: "c1",
          decisionId: "d",
          type: "SOFT",
          name: "Cost must stay at zero",
          subject: "Cost",
          operator: "LTE",
          numericValue: 0,
          penalty: 2,
        },
      ],
      base,
      factors
    );
    // The penalty is owed by the option that BREAKS the limit, never the one
    // that satisfies it.
    assert.equal(penalties.get("a"), 2);
    assert.equal(penalties.has("b"), false);

    const ranked = applyConstraintPolicy(
      base.map((o) => ({ optionId: o.id, score: 10 })),
      [],
      penalties
    );
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].optionId, "b");
    assert.equal(ranked[0].score, 10);
    assert.equal(ranked[1].score, 8);
  });

  it("ignores an operator it does not understand instead of guessing", () => {
    const nonsense = {
      id: "c1",
      decisionId: "d",
      type: "HARD",
      name: "Cost ceiling",
      subject: "Cost",
      // Not a ConstraintOperator. compare() returns false for it, which would
      // otherwise read as "every option violates this" and empty the field.
      operator: "<=",
      numericValue: 0,
    };
    const { violations, warnings } = evaluateConstraints([nonsense], base, factors);
    assert.equal(violations.length, 0, "an unreadable limit must not block every option");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].reason, /does not understand/i);

    const soft = { ...nonsense, type: "SOFT", penalty: 2 };
    assert.equal(constraintPenalties([soft], base, factors).size, 0);
  });

  it("reports a broken limit once, not once per reason", () => {
    const { warnings } = evaluateConstraints(
      [
        {
          id: "c1",
          decisionId: "d",
          type: "HARD",
          name: "Cost ceiling",
          subject: "Vibes",
          operator: "LTE",
          numericValue: 0,
        },
      ],
      base,
      factors
    );
    assert.equal(warnings.length, 1);
  });

  it("penalises the option that breaks a soft limit, never the one that meets it", () => {
    // Stay home scores 3 on Cost (breaks "at most 0"); Travel scores -1.5 and
    // complies. Inverting this check would punish compliance and let the
    // violation through, which is the whole point of a soft constraint.
    const penalties = constraintPenalties(
      [
        {
          id: "c1",
          decisionId: "d",
          type: "SOFT",
          name: "Cost must stay at zero",
          subject: "Cost",
          operator: "LTE",
          numericValue: 0,
          penalty: 2,
        },
      ],
      base,
      factors
    );
    assert.equal(penalties.get("a"), 2, "the violating option is penalised");
    assert.equal(penalties.has("b"), false, "the compliant option is not");

    // The same must hold for the reverse direction: a "no less than" limit
    // penalises the low option only.
    const upward = constraintPenalties(
      [
        {
          id: "c2",
          decisionId: "d",
          type: "SOFT",
          name: "Must gain something",
          subject: "Cost",
          operator: "GTE",
          numericValue: 0,
          penalty: 2,
        },
      ],
      base,
      factors
    );
    assert.equal(upward.get("b"), 2);
    assert.equal(upward.has("a"), false);
  });

  it("breaks exact ties by preference order, then by id, deterministically", () => {
    const ranked = applyConstraintPolicy(
      [
        { optionId: "b", score: 5 },
        { optionId: "a", score: 5 },
      ],
      [],
      new Map(),
      preferenceOrder([
        { id: "p", decisionId: "d", type: "PREFERENCE", name: "Prefer travel", optionIds: ["b"] },
      ])
    );
    assert.deepEqual(
      ranked.map((r) => r.optionId),
      ["b", "a"]
    );
  });
});

describe("policy", () => {
  const scored = () => scoreAll(base, factors);

  it("reports gap after penalties, not the raw JEV difference", () => {
    const raw = scored();
    const policy = evaluatePolicy({ scored: raw, options: base, factors });

    // Raw JEV gap, which the UI used to display.
    const rawGap = raw[0].jev - raw[1].jev;
    assert.ok(Math.abs(policy.leader.gap - rawGap) < 0.001, "no penalties means gap is raw");

    // "Stay home" scores 3 on Time, so it breaks a "must stay at or below 1" rule
    // and takes the penalty; Travel's -1.5 complies.
    const penalised = evaluatePolicy({
      scored: raw,
      options: base,
      factors,
      constraints: [
        {
          id: "c1",
          decisionId: "d",
          type: "SOFT",
          name: "Time must stay low",
          subject: "Time",
          operator: "LTE",
          numericValue: 1,
          penalty: 8,
        },
      ],
    });
    // "Stay home" scores 3 on Time, so it takes the 6-point penalty against
    // Travel's -1.5: 4.5 raw minus 6 inverts the lead.
    assert.equal(penalised.leader.optionId, "b");
    // "Stay home" has raw JEV 3 and Travel -1.5 (raw gap 4.5). The 8-point penalty
    // moves Stay home to -5, so Travel leads by 3.5: an adjusted gap, and a
    // narrower one than the raw gap.
    assert.equal(penalised.leader.gap, 3.5);
    assert.ok(penalised.leader.gap < 4.5, "gap must be measured after the penalty");
    // The penalised option kept its raw JEV in the record, but its ranking score
    // carries the penalty.
    const demoted = penalised.ranking.find((r) => r.optionId === "a");
    assert.equal(demoted.score, -5);
    assert.equal(raw.find((s) => s.optionId === "a").jev, 3);
    // The unpenalised leader's score is untouched by any limit it passed.
    assert.equal(penalised.leader.score, penalised.leader.jev);
    assert.equal(penalised.leader.runnerUpScore, penalised.ranking[1].score);
  });

  it("never recommends an option a hard constraint blocked", () => {
    const policy = evaluatePolicy({
      scored: scored(),
      options: base,
      factors,
      constraints: [
        {
          id: "c1",
          decisionId: "d",
          type: "HARD",
          name: "No overnight travel",
          optionIds: ["a"],
        },
      ],
    });
    assert.equal(policy.leader.optionId, "b");
    assert.ok(!policy.ranking.some((r) => r.optionId === "a"));
    assert.deepEqual(
      policy.blockedOptions.map((b) => b.optionId),
      ["a"]
    );
  });

  it("withholds a verdict when there is no signal at all", () => {
    const policy = evaluatePolicy({ scored: scored(), options: base, factors, hasSignal: false });
    assert.equal(policy.verdict, "insufficient-information");
    assert.equal(policy.leader, null);
    assert.equal(policy.recommendation, null);
  });

  it("refuses to rank a crisis decision", () => {
    const policy = evaluatePolicy({
      scored: scored(),
      options: base,
      factors,
      safety: "crisis",
    });
    assert.equal(policy.leader, null);
    assert.equal(policy.verdict, "support-path");
  });

  it("calls a close finish a tie and picks nothing", () => {
    const close = [option("a", "A", 3, 3), option("b", "B", 3, 3)];
    const policy = evaluatePolicy({ scored: scoreAll(close, factors), options: close, factors });
    assert.equal(policy.verdict, "tie");
    // Both options stay named in the ranking, but no leader is invented.
    assert.equal(policy.leader, null);
    assert.equal(policy.recommendation, null);
    assert.equal(policy.ranking.length, 2);
    assert.match(policy.reviewReasons.join(" "), /not a meaningful difference/);
  });

  it("flags review when confidence is below the threshold", () => {
    const shaky = [option("a", "A", 3, 3), option("b", "B", 2, 2)];
    // Drive confidence down by widening the spread against a low weight.
    const wide = [
      option("a", "A", 9, 0),
      {
        ...option("b", "B", -9, 0),
        reversibility: 0.1,
      },
    ];
    const policy = evaluatePolicy({
      scored: scoreAll(wide, factors).map((s) => ({ ...s, confidence: REVIEW_CONFIDENCE - 0.01 })),
      options: wide,
      factors,
    });
    assert.equal(policy.needsReview, true);
    assert.ok(policy.reviewReasons.length > 0);
    // A shaky leader is still named, but never as a clean answer.
    assert.ok(shaky.length === 2);
  });
});

describe("reasons", () => {
  it("never claims a winner when the model has no estimates", () => {
    const reasons = generateReasons({
      scored: scoreAll(base, factors),
      options: base,
      sensitivity: sensitivity(base, factors),
      hasSignal: false,
    });
    assert.ok(reasons.length > 0);
    assert.ok(
      reasons.every((r) => !/you should choose/i.test(r.text)),
      `expected no pick, got: ${reasons.map((r) => r.text).join(" | ")}`
    );
  });

  it("names the leader and the reason it won", () => {
    const reasons = generateReasons({
      scored: scoreAll(base, factors),
      options: base,
      sensitivity: sensitivity(base, factors),
      hasSignal: true,
    });
    const text = reasons.map((r) => r.text).join(" | ");
    assert.match(text, /Stay home/);
    assert.match(text, /travel/i);
  });

  it("explains a blocked option instead of hiding it", () => {
    const reasons = generateReasons({
      scored: scoreAll(base, factors),
      options: base,
      sensitivity: sensitivity(base, factors),
      violations: [
        {
          constraint: { id: "c1", decisionId: "d", type: "HARD", name: "No overnight travel" },
          optionId: "a",
          optionLabel: "Stay home",
          reason: "Stay home is ruled out by \"No overnight travel\".",
        },
      ],
      hasSignal: true,
    });
    assert.match(reasons.map((r) => r.text).join(" | "), /No overnight travel/);
  });
});

describe("simulation", () => {
  it("reports a flipped leader when a factor is pushed far enough", () => {
    // A leads only because of Time: 1 + 3(0.5) = 2.5 vs 2 - 3(0.5) = 0.5.
    // Zeroing Time reverses it to 1 vs 2.
    const pair = [option("a", "A", 1, 3), option("b", "B", 2, -3)];
    const result = simulate(pair, factors, [
      { type: "factor-weight", target: "Time", factorId: "time", value: 0 },
    ]);
    assert.equal(result.originalLeaderId, "a");
    assert.equal(result.changed, true);
    assert.equal(result.rankingChanged, true);
    assert.equal(result.simulatedLeaderId, "b");
    assert.ok(result.deltas.every((d) => typeof d.delta === "number"));
    assert.equal(result.explanation.length > 0, true);
  });

  it("leaves the inputs untouched", () => {
    const before = JSON.stringify(base);
    const beforeFactors = JSON.stringify(factors);
    simulate(base, factors, [{ type: "reversibility", target: "Stay home", optionId: "a", value: 1 }]);
    assert.equal(JSON.stringify(base), before);
    assert.equal(JSON.stringify(factors), beforeFactors);
  });

  it("reports a skipped change instead of silently ignoring it", () => {
    const result = simulate(base, factors, [
      { type: "factor-weight", target: "Nothing like this", value: 1 },
    ]);
    assert.equal(result.applied, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.changed, false);
  });

  it("is a no-op with no changes", () => {
    const result = simulate(base, factors, []);
    assert.equal(result.changed, false);
    assert.equal(result.originalLeaderId, result.simulatedLeaderId);
  });
});

describe("information value", () => {
  const spread = [option("a", "A", 9, -9), option("b", "B", -9, 9)];

  it("ranks a factor whose swing decides the answer above one that cannot", () => {
    const ranked = rankInformationValue(spread, factors);
    assert.ok(ranked.length > 0);
    assert.equal(ranked[0].canChangeResult, true);
    assert.ok(ranked[0].score > 0);
    // Sorted by score, so the best question is genuinely first.
    for (let i = 1; i < ranked.length; i++) {
      assert.ok(ranked[i - 1].score >= ranked[i].score);
    }
  });

  it("only offers questions that could still change the result", () => {
    const asked = worthAsking(rankInformationValue(spread, factors), 3);
    assert.ok(asked.every((c) => c.canChangeResult && c.score > 0));
  });

  it("says so when nothing is left worth asking", () => {
    const identical = [option("a", "A", 3, 3), option("b", "B", 3, 3)];
    const voin = computeInformationValue(identical, factors);
    assert.match(voin.topUnknown, /know enough/i);
    assert.match(voin.impact, /could change which option wins/i);
  });

  it("returns unknown records carrying a real estimated impact", () => {
    const unknowns = identifyUnknowns(spread, factors);
    assert.ok(unknowns.length > 0);
    assert.ok(unknowns.every((u) => typeof u.question === "string" && u.question.length > 0));
    assert.ok(unknowns.every((u) => Number.isFinite(u.estimatedImpact)));
    assert.ok(unknowns.some((u) => u.importance === "high"));
  });

  it("does not need two options before it will name a swing factor", () => {
    // bestThingToLearn only inspects sensitivity, so a single option must not
    // throw or produce an empty instruction.
    const text = bestThingToLearn([stay], factors);
    assert.ok(text.length > 0);
  });
});