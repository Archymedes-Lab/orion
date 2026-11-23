import { View } from "react-native";
import { useEffect } from "react";
import { useSession } from "../store/session";
import { useDecisionStore } from "../store/decisionStore";
import { scoreAll } from "../decision-engine/uncertainty";
import { sensitivity } from "../decision-engine/sensitivity";
import { calculateDecisionConfidenceCached } from "../decision-engine/confidence";
import { analyzeRobustnessCached } from "../decision-engine/robustness";
import { detectDecisionMode } from "../decision-engine/decisionModes";
import { aftermath } from "../decision-engine/aftermath";
import { scoreDecisionQuality, type DecisionRecord } from "../decision-engine/checkIns";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { RobustnessBadge } from "./RobustnessBadge";
import { DecisionModeBadge } from "./DecisionModeBadge";
import { AftermathTimeline } from "./AftermathTimeline";
import { DecisionQuality } from "./DecisionQuality";
import { t } from "../i18n";
import { Reveal } from "./ui";

/** The deep-dive block behind "See analysis": confidence, robustness, decision mode, aftermath, quality. */
export function DecisionAnatomy() {
  const s = useSession();
  const bundle = useDecisionStore();
  const loadForDecision = bundle.loadForDecision;

  useEffect(() => {
    if (s.decisionId && bundle.decisionId !== s.decisionId) {
      void loadForDecision(s.decisionId);
    }
  }, [s.decisionId, bundle.decisionId, loadForDecision]);

  if (s.options.length < 2) return null;
  const scored = scoreAll(s.options, s.factors).sort((a, b) => b.jev - a.jev);
  const leader = scored[0];
  const runner = scored[1];
  if (!leader || !runner) return null;

  const sens = sensitivity(s.options, s.factors);
  const stakes = s.extraction?.stakes ?? "normal";
  const obligations = s.extraction?.obligations ?? [];

  const confidenceResult = calculateDecisionConfidenceCached(
    s.options, s.factors, scored, sens,
    bundle.evidence, bundle.assumptions, bundle.constraints, bundle.unknowns,
    bundle.criteria, stakes, s.mode
  );

  const robustnessResult = analyzeRobustnessCached(
    s.options, s.factors, scored, sens, bundle.assumptions, stakes, s.mode
  );

  const decisionMode = detectDecisionMode({
    text: s.rawInput,
    obligations,
    options: s.options,
    factors: s.factors,
    stakes,
  });

  const leaderAftermath = aftermath({
    options: s.options,
    factors: s.factors,
    optionId: leader.optionId,
    mode: s.mode,
    stakes,
    safety: s.safety,
    signal: true,
    risks: [],
    decisionMode,
  });

  const labelOf = (optionId: string) => s.options.find((o) => o.id === optionId)?.label ?? optionId;

  const record: DecisionRecord = {
    id: s.decisionId ?? "local",
    rawInput: s.rawInput,
    extraction: {
      title: s.extraction?.title ?? t("Decision"),
      category: s.extraction?.category ?? ["Everyday"],
      options: s.extraction?.options ?? s.options.map((o) => ({ id: o.id, label: o.label })),
      factors: (s.extraction?.factors ?? s.factors.map((f) => ({ id: f.id, label: f.label, importance: f.weight, reason: "" }))).map((f) => ({
        id: f.id,
        label: f.label,
        weight: "weight" in f ? Number(f.weight) : Number(f.importance),
      })),
      stakes,
      mode: decisionMode,
    },
    chosenOptionId: s.committedOptionId ?? "",
    recommendedOptionId: leader.optionId,
    againstRecommendation: Boolean(s.committedOptionId) && s.committedOptionId !== leader.optionId,
    scores: scored.map((o) => ({ optionId: o.optionId, jev: o.jev, confidence: o.confidence })),
    assumptions: bundle.assumptions.map((a) => ({ id: a.id, statement: a.statement, confidence: a.confidence ?? 0.7 })),
    evidence: bundle.evidence.map((e) => ({ id: e.id, content: e.content, reliability: e.reliability ?? 0.8 })),
    constraints: bundle.constraints.map((c) => ({ id: c.id, name: c.name, type: c.type })),
    earlyWarningSignals: leaderAftermath?.earlyWarningSignals ?? [],
    decidedAt: new Date().toISOString(),
    checkIns: [],
    status: s.committedOptionId ? "decided" : "open",
  };
  const quality = scoreDecisionQuality(record);

  return (
    <View style={{ gap: 0 }}>
      <Reveal index={1}>
        <ConfidenceBadge level={confidenceResult.level} score={confidenceResult.score} factors={confidenceResult.factors} reasons={confidenceResult.reasons} />
      </Reveal>

      <Reveal index={2}>
        <RobustnessBadge result={robustnessResult} />
      </Reveal>

      <Reveal index={3}>
        <DecisionModeBadge mode={decisionMode} obligationsCount={obligations.length} optionsCount={s.options.length} />
      </Reveal>

      {leaderAftermath && (
        <Reveal index={4}>
          <AftermathTimeline aftermath={leaderAftermath} label={labelOf(leader.optionId)} detailed />
        </Reveal>
      )}

      <Reveal index={5}>
        <DecisionQuality record={record} scores={quality} />
      </Reveal>
    </View>
  );
}