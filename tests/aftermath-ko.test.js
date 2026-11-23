// The Aftermath and the check-ins in Korean: every sentence the engine writes reads in Korean under "ko", whatever
// language the factor and option names are in, and English stays the default.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aftermath, takeaways, withSigns, whenLabel } from "../src/decision-engine/aftermath.ts";
import { followUpPlan } from "../src/decision-engine/followUp.ts";
import { generateReflectionPrompt, scoreDecisionQuality } from "../src/decision-engine/checkIns.ts";
import { withLocale } from "../src/i18n/index.ts";

const factors = [
  { id: "inc", label: "수입", weight: 0.4 },
  { id: "fr", label: "친구", weight: 0.3 },
  { id: "cost", label: "이사 비용", weight: 0.2 },
  { id: "gr", label: "커리어 성장", weight: 0.3 },
];
const option = (id, label, values) => ({
  id, label, reversibility: 0.3, risks: ["번아웃"],
  outcomes: [{ id: `${id}-o`, label: "base", probability: 1, probabilityConfidence: 0.7, factors: Object.entries(values).map(([factorId, value]) => ({ factorId, value })) }],
});
const options = [
  option("berlin", "베를린 일자리 잡기", { inc: 6, fr: -5, cost: -6, gr: 7 }),
  option("stay", "지금 자리에 남기", { inc: 0, fr: 3, cost: 0, gr: -2 }),
];
const base = { options, factors, optionId: "berlin", mode: "serious", stakes: "major", safety: "financial-high-stakes", signal: true, decisionMode: "TRADEOFF", risks: [{ description: "예산 초과", likelihood: "medium" }] };
// Hangul, digits, punctuation and the person's own words only: no English left in ORION's text.
const korean = (text) => {
  const stripped = text.replace(/수입|친구|이사 비용|커리어 성장|베를린 일자리 잡기|지금 자리에 남기/g, "");
  assert.match(stripped, /[가-힣]/, text);
  assert.doesNotMatch(stripped, /[A-Za-z]{2,}/, text);
};

describe("aftermath in Korean", () => {
  it("writes every step, turn, sign, warning and horizon in Korean", () => {
    const picture = withLocale("ko", () => aftermath(base));
    assert.deepEqual(picture.steps.map((s) => s.when), ["처음 며칠", "한 달 뒤", "석 달 뒤", "6개월 뒤", "1년 뒤", "3년 뒤", "5년 뒤"]);
    for (const s of picture.steps) {
      for (const text of [s.when, s.likely, s.goodTurn, s.hardTurn, s.sign, ...s.warningSignals]) korean(text);
      assert.match(s.sign, /\?$/);
    }
    for (const text of [picture.caution, ...picture.earlyWarningSignals]) korean(text);
    assert.match(picture.steps[2].likely, /^가장 그럴듯한 모습: /);
  });

  it("says the takeaways and the check-in questions in Korean", () => {
    const [berlin, stay] = withLocale("ko", () => [aftermath(base), aftermath({ ...base, optionId: "stay" })]);
    const said = withLocale("ko", () => takeaways(berlin, stay));
    assert.match(said.path, /^“베를린 일자리 잡기”: .*5년 차에는 확실히 나아져요\. .*“지금 자리에 남기”보다 앞서 나가요\.$/);
    for (const text of [said.path, said.odds, said.timing]) korean(text);
    assert.match(said.timing, /몇 달에 걸쳐 쌓여요: 친구 및 커리어 성장\./);
    const plan = withLocale("ko", () => withSigns(followUpPlan({ mode: "serious", stakes: "major", decided: true, reversibility: 0.3 }), berlin));
    plan.forEach((step, i) => {
      assert.ok(step.prompt.startsWith(`${berlin.steps[i].when}: ${berlin.steps[i].sign}`));
      korean(step.prompt);
    });
  });

  it("reads the language at call time, so English stays the default", () => {
    assert.equal(whenLabel(30), "One month");
    assert.equal(withLocale("ko", () => whenLabel(30)), "한 달 뒤");
    assert.match(aftermath(base).steps[0].likely, /^Most likely: /);
  });

  it("writes the reflection and the decision-quality criteria in Korean", () => {
    const record = {
      extraction: { options: [{ id: "a", label: "베를린 일자리 잡기" }, { id: "b", label: "지금 자리에 남기" }] }, chosenOptionId: "a", recommendedOptionId: "b",
      againstRecommendation: true, assumptions: [], earlyWarningSignals: [], evidence: [], constraints: [],
      scores: [{ optionId: "a", jev: 5, confidence: 0.8 }, { optionId: "b", jev: 4.5, confidence: 0.8 }], outcomeRating: { overall: "worse", surprises: [], factors: [] },
    };
    const reflection = withLocale("ko", () => generateReflectionPrompt(record));
    assert.match(reflection, /결과: 예상보다 나빴어요\./);
    korean(reflection.replace(/ORION|JEV/g, ""));
    for (const c of withLocale("ko", () => scoreDecisionQuality(record)).criteria) { korean(c.name); korean(c.detail.replace("JEV", "")); }
  });
});
