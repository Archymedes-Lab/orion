// §21 advanced mode behind "See analysis" — keeps default UX calm.
// Loads the live session if it matches, else the persisted decision.
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { scoreAll } from "../../../decision-engine/uncertainty";
import { runScenarios } from "../../../decision-engine/scenarios";
import { sensitivity } from "../../../decision-engine/sensitivity";
import { useSession } from "../../../store/session";
import { safetyNotice } from "../../../decision-engine/safety";
import { ProbabilityBar } from "../../../components/ProbabilityBar";
import { OptionRanking } from "../../../components/OptionRanking";
import { ChoiceCheck } from "../../../components/ChoiceCheck";
import { Paywall } from "../../../components/Paywall";
import { usePlan } from "../../../billing/plan";
import { divergence } from "../../../decision-engine/divergence";
import { DecisionAnatomy } from "../../../components/DecisionAnatomy";
import { AppButton, Body, Card, Divider, EmptyState, Eyebrow, Notice, PageHeader, Reveal, Screen, SectionTitle, Skeleton, Small, Tag, Text, tabular, useLayout, type Tone } from "../../../components/ui";
import { colors, spacing, type } from "../../../theme/tokens";
import { msg, t } from "../../../i18n";

const STABILITY_TONE: Record<string, Tone> = { high: "success", medium: "warning", low: "danger" };
const STABILITY_LABEL: Record<string, string> = { high: msg("high"), medium: msg("medium"), low: msg("low") };
const SCENARIO = { conservative: msg("Conservative"), expected: msg("Expected"), optimistic: msg("Optimistic") } as const;
const cell = [{ fontSize: type.supporting, color: colors.body, textAlign: "right" as const }, tabular];
const head = { fontSize: type.metadata, fontWeight: "500" as const, letterSpacing: 1.2, textTransform: "uppercase" as const, color: colors.muted, textAlign: "right" as const };

export default function AnalysisScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const s = useSession();
  const [loaded, setLoaded] = useState(s.status === "ready" && s.decisionId === id);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadDecision = s.loadDecision;
  const { tablet, split } = useLayout();
  const plan = usePlan();
  const deep = plan.can("deep_analysis", id);

  useEffect(() => {
    let active = true;
    setMissing(false);
    setError(null);
    setLoaded(false);
    const current = useSession.getState();
    if (current.status === "ready" && current.decisionId === id) {
      setLoaded(true);
      return;
    }
    if (typeof id === "string") {
      void loadDecision(id).then((ok) => {
        if (active) { setLoaded(ok); setMissing(!ok); }
      }).catch(() => { if (active) setError(t("Could not load this decision.")); });
    }
    return () => { active = false; };
  }, [id, loadDecision]);

  // A reloaded or shared URL has no history to go back to.
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  const page = (children: ReactNode) => (
    <Screen title={loaded && s.extraction && s.decisionId === id ? t("Analysis: {title}", { title: s.extraction.title }) : t("Analysis")}>
      <AppButton variant="ghost" icon="arrow-back" title={t("Back")} onPress={back} style={{ alignSelf: "flex-start", marginLeft: -18 }} />
      {children}
    </Screen>
  );

  if (error) return page(<Notice tone="danger" alert>{error}</Notice>);
  if (missing) return page(<EmptyState icon="search-outline" title={t("Decision not found")} action={<AppButton title={t("Go to Home")} iconRight="arrow-forward" onPress={() => router.replace("/")} />}>{t("It may have been deleted, or this link is from another device.")}</EmptyState>);
  if (!loaded || s.status !== "ready" || s.decisionId !== id) return page(
    <View accessibilityRole="progressbar" accessibilityLabel={t("Loading analysis")} style={{ gap: spacing.lg }}>
      <View style={{ gap: spacing.sm }}><Skeleton width={110} height={12} /><Skeleton width="55%" height={34} radius={10} /></View>
      <Card><Skeleton width="30%" height={22} /><Skeleton height={14} /><Skeleton height={14} /><Skeleton width="70%" height={14} /></Card>
    </View>
  );

  if (s.safety === "crisis" || s.safety === "dangerous") {
    return page(<Card><Body style={{ color: colors.ink }}>{safetyNotice(s.safety)}</Body></Card>);
  }
  const scen = runScenarios(s.options, s.factors);
  const sens = sensitivity(s.options, s.factors);
  const label = (optionId: string) => s.options.find((o) => o.id === optionId)?.label ?? optionId;

  // Phones have no room for four columns: label on one line, figures beneath it.
  const table = (rows: ReturnType<typeof scoreAll>, title: string) => !tablet ? (
    <View style={{ gap: 12 }}>
      <Eyebrow>{title}</Eyebrow>
      {rows.map((r) => (
        <View key={r.optionId} style={{ gap: 2 }}>
          <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{label(r.optionId)}</Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: spacing.sm }}>
            <Text style={[cell, { fontWeight: "500", color: colors.ink }]}>{t("Score {score}", { score: r.jev })}</Text>
            <Text style={cell}>{t("range [{low}, {high}]", { low: r.low, high: r.high })}</Text>
            <Text style={cell}>{t("conf {confidence}", { confidence: r.confidence })}</Text>
          </View>
        </View>
      ))}
    </View>
  ) : (
    <View style={{ gap: spacing.sm }}>
      <Eyebrow>{title}</Eyebrow>
      <View style={{ flexDirection: "row", gap: 12, paddingBottom: 6, borderBottomWidth: 1, borderColor: colors.line }}>
        <Text style={[head, { flex: 1, textAlign: "left" }]}>{t("Option")}</Text>
        <Text style={[head, { width: 56 }]}>{t("Score")}</Text>
        <Text style={[head, { width: 104 }]}>{t("Range")}</Text>
        <Text style={[head, { width: 48 }]}>{t("Conf.")}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.optionId} style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
          <Text style={{ flex: 1, fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{label(r.optionId)}</Text>
          <Text style={[cell, { width: 48, fontWeight: "500", color: colors.ink }]}>{r.jev}</Text>
          <Text style={[cell, { width: 104 }]}>[{r.low}, {r.high}]</Text>
          <Text style={[cell, { width: 48 }]}>{r.confidence}</Text>
        </View>
      ))}
    </View>
  );

  // Desktop: one comparison table, an option per row and a scenario per column group.
  const figures = (r?: ReturnType<typeof scoreAll>[number]) => (
    <Text style={[{ width: 176, fontSize: type.supporting, color: colors.muted }, tabular]}>
      <Text style={{ fontWeight: "500", color: colors.ink }}>{r?.jev ?? "–"}</Text>
      {r ? `   [${r.low}, ${r.high}]` : ""}
    </Text>
  );
  const comparison = (
    <View>
      <View style={{ flexDirection: "row", gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderColor: colors.line }}>
        <Text style={[head, { flex: 1, textAlign: "left" }]}>{t("Option")}</Text>
        {[SCENARIO.conservative, SCENARIO.expected, SCENARIO.optimistic].map((name) => (
          <Text key={name} style={[head, { width: 176, textAlign: "left" }]}>{t(name)}</Text>
        ))}
        <Text style={[head, { width: 112 }]}>{t("Confidence")}</Text>
      </View>
      {[...scen.expected].sort((a, b) => b.jev - a.jev).map((r, i) => (
        <View key={r.optionId} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderColor: colors.line }}>
          <Text style={{ flex: 1, fontSize: 15, fontWeight: "500", color: i === 0 ? colors.accentBright : colors.ink }}>{label(r.optionId)}{i === 0 ? "  ✦" : ""}</Text>
          {figures(scen.conservative.find((c) => c.optionId === r.optionId))}
          {figures(r)}
          {figures(scen.optimistic.find((o) => o.optionId === r.optionId))}
          <Text style={[cell, { width: 112 }]}>{r.confidence}</Text>
        </View>
      ))}
    </View>
  );
  // The raw estimates behind every figure above: one row per factor, one column per option.
  const valueOf = (optionId: string, factorId: string) =>
    s.options.find((o) => o.id === optionId)?.outcomes.reduce((sum, oc) => sum + oc.probability * (oc.factors.find((f) => f.factorId === factorId)?.value ?? 0), 0) ?? 0;
  const show = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${Math.abs(Math.round(n * 10) / 10)}`;
  const estimates = (
    <Reveal index={2}>
    <Card>
      <View style={{ gap: spacing.xs }}>
        <SectionTitle>{t("What helps or hurts each option")}</SectionTitle>
        <Small>{t("How each option is expected to affect each factor, from −10 (much worse) to +10 (much better).")} {s.scoringSource === "api" ? t("Scored by ORION.") : s.scoringSource === "manual" ? t("From your own answers.") : t("Not estimated yet.")}</Small>
      </View>
      {tablet ? (
        <View>
          <View style={{ flexDirection: "row", gap: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderColor: colors.line }}>
            <Text style={[head, { flex: 1.2, textAlign: "left" }]}>{t("Factor")}</Text>
            {s.options.map((o) => <Text key={o.id} numberOfLines={2} style={[head, { flex: 1 }]}>{o.label}</Text>)}
          </View>
          {s.factors.map((f, i) => (
            <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: colors.line }}>
              <Text style={{ flex: 1.2, fontSize: type.supporting, color: colors.body }}>{f.label}</Text>
              {s.options.map((o) => {
                const v = valueOf(o.id, f.id);
                return <Text key={o.id} style={[cell, { flex: 1, fontWeight: "500", color: v > 0 ? colors.success : v < 0 ? colors.danger : colors.muted }]}>{show(v)}</Text>;
              })}
            </View>
          ))}
        </View>
      ) : s.options.map((o) => (
        <View key={o.id} style={{ gap: 4 }}>
          <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{o.label}</Text>
          <Small>{s.factors.map((f) => `${f.label} ${show(valueOf(o.id, f.id))}`).join("  ·  ")}</Small>
        </View>
      ))}
    </Card>
    </Reveal>
  );
  const scored = [...scen.expected].sort((a, b) => b.jev - a.jev);
  const flips = (
    <Reveal index={2} style={split ? { flex: 1 } : undefined}>
    <Card>
      <SectionTitle>{t("What would have to be true")}</SectionTitle>
      {sens.flips.map((f) => (
        <View key={f.description} style={{ gap: 2 }}>
          <Body>{f.description}</Body>
          <Small>{f.threshold}</Small>
        </View>
      ))}
    </Card>
    </Reveal>
  );
  const weights = (
    <Reveal index={3}>
    <Card>
      <SectionTitle>{t("What matters most to you")}</SectionTitle>
      {s.factors.map((f) => (
        <ProbabilityBar key={f.id} label={f.label} value={f.weight} />
      ))}
    </Card>
    </Reveal>
  );
  const answers = (
    <Reveal index={4}>
    <Card>
      <SectionTitle>{t("Questions answered")}</SectionTitle>
      {Object.entries(s.answers).map(([q, a]) => (
        <View key={q} style={{ gap: 2 }}>
          <Small>{q}</Small>
          <Text style={{ fontSize: type.body, fontWeight: "400", color: colors.ink }}>
            → {a === null ? t("skipped") : s.factors.find((f) => f.id === a)?.label ?? a}
          </Text>
        </View>
      ))}
      {Object.keys(s.answers).length === 0 && <Small>{t("None yet.")}</Small>}
    </Card>
    </Reveal>
  );

  return page(
    <>
      <PageHeader
        eyebrow={t("Analysis")}
        title={s.extraction ? s.extraction.title : t("Analysis")}
        actions={<AppButton variant="secondary" icon={s.committedOptionId ? "swap-horizontal" : "play-outline"} title={s.committedOptionId ? t("Review my choice") : t("Continue deciding")} onPress={() => router.navigate("/")} />}
      >
        {s.committedOptionId && <Small>{t("You chose: {option}", { option: label(s.committedOptionId) })}</Small>}
      </PageHeader>
      {s.options.length > 1 && s.scoringSource !== "none" && (
        <Reveal index={1}>
          <OptionRanking scored={scored} labels={Object.fromEntries(s.options.map((o) => [o.id, o.label]))} chosenId={s.committedOptionId} />
        </Reveal>
      )}
      {s.committedOptionId && (() => {
        const assessment = divergence(s.options, s.factors, s.committedOptionId, s.scoringSource !== "none");
        return <ChoiceCheck readOnly locked={!plan.can("choice_justification", id)} assessment={assessment} chosenLabel={label(s.committedOptionId)} leaderLabel={assessment.leaderId ? label(assessment.leaderId) : ""} reason={s.choiceReason} />;
      })()}
      {s.scoringSource === "none" && <Notice>{t("These options have not been compared yet. Continue deciding to answer a few quick questions.")}</Notice>}
{deep ? (
        <>
          <DecisionAnatomy />
          <Reveal index={1}>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <SectionTitle>{t("What if things turn out differently?")}</SectionTitle>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Small>{t("Stability:")}</Small>
                <Tag label={STABILITY_LABEL[scen.stability] ? t(STABILITY_LABEL[scen.stability]) : scen.stability} tone={STABILITY_TONE[scen.stability] ?? "neutral"} />
              </View>
            </View>
            {split ? comparison : (
              <>
                {table(scen.conservative, t(SCENARIO.conservative))}
                <Divider />
                {table(scen.expected, t(SCENARIO.expected))}
                <Divider />
                {table(scen.optimistic, t(SCENARIO.optimistic))}
              </>
            )}
          </Card>
          </Reveal>
          {estimates}
              {split ? (
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 28 }}>
                  {flips}
                  <View style={{ flex: 1, gap: spacing.lg }}>
                    {weights}
                    {answers}
                  </View>
                </View>
              ) : (
                <>
                  {flips}
                  {weights}
                  {answers}
                </>
              )}
            </>
          ) : (
            <>
              <Paywall feature="deep_analysis" decisionId={id} />
          {weights}
          {answers}
        </>
      )}
    </>
  );
}
