import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { db } from "../../db/database";
import { getCalibration, latestRatings, type Calibration, type Tally } from "../../db/insights";
import { getAffinities } from "../../db/preferences";
import { ProbabilityBar } from "../../components/ProbabilityBar";
import { Paywall } from "../../components/Paywall";
import { usePlan } from "../../billing/plan";
import { AppButton, Card, EmptyState, Notice, PageHeader, Screen, SectionTitle, Skeleton, Small, Stat, Tag, sentenceCase, useLayout } from "../../components/ui";
import { colors, spacing } from "../../theme/tokens";
import { ratingLabel } from "../../account/labels";
import { msg, t } from "../../i18n";

const RATINGS = ["Great", "Good", "Neutral", "Bad", "Very bad"];
/** "4 of 5 turned out well". */
const wellOf = (well: number, total: number) => t("{well} of {total} turned out well", { well, total });

/** Patterns across saved decisions: how many, how they turned out, what tends to matter. */
export default function InsightsScreen() {
  const [stats, setStats] = useState({ total: 0, decided: 0, rated: {} as Record<string, number> });
  const [affinities, setAffinities] = useState<Record<string, number>>({});
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { split } = useLayout();
  const fullInsights = usePlan((p) => p.can("full_insights"));
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      (async () => {
        setLoading(true);
        setLoadError(null);
        try {
          await db.init();
          const decisions = await db.list("decisions");
          const ids = new Set(decisions.map((d) => String(d.id)));
          // Only the latest rating per decision counts.
          const rated: Record<string, number> = {};
          for (const [id, rating] of Object.entries(await latestRatings())) if (ids.has(id)) rated[rating] = (rated[rating] ?? 0) + 1;
          setStats({ total: decisions.length, decided: decisions.filter((d) => d.status === "decided").length, rated });
          setAffinities(await getAffinities().catch(() => ({})));
          setCalibration(await getCalibration().catch(() => null));
        } catch {
          setLoadError(t("Could not load Insights. Try again in a moment."));
        } finally {
          setLoading(false);
        }
      })();
    }, [])
  );

  const ratedTotal = Object.values(stats.rated).reduce((a, n) => a + n, 0);
  const affinityTotal = Object.values(affinities).reduce((a, n) => a + n, 0);
  const ranked = Object.entries(affinities).sort((a, b) => b[1] - a[1]);
  const tiles: [string, number][] = [
    [t("Decisions saved"), stats.total],
    [t("Decided"), stats.decided],
    [t("Still open"), stats.total - stats.decided],
    [t("Outcomes recorded"), ratedTotal],
  ];

  const count = (tally: Tally) => tally.well + tally.neutral + tally.badly;
  const compared = calibration ? count(calibration.followed) + count(calibration.tossup) + count(calibration.diverged) : 0;
  const REASONS: Record<string, string> = {
    priority: msg("Something mattered more than you first said"),
    missing: msg("Something was missing from the list"),
    scores: msg("You did not agree with the scores"),
    deliberate: msg("You chose it anyway"),
    unsaid: msg("No reason given"),
  };
  const held = (label: string, tally: Tally) => count(tally) > 0 && (
    <View style={{ gap: spacing.xs }}>
      <ProbabilityBar label={label} value={tally.well / count(tally)} display={wellOf(tally.well, count(tally))} />
      <Small>{t("{neutral} neutral · {badly} badly", { neutral: tally.neutral, badly: tally.badly })}</Small>
    </View>
  );

  return (
    <Screen title={t("Insights")}>
      <PageHeader title={t("Insights")}>
        <Small>{t("Patterns across the decisions saved on this device.")}</Small>
      </PageHeader>
      {loadError && <Notice tone="danger" alert>{loadError}</Notice>}
      {loading && (
        <Card>
          <Skeleton height={22} width="40%" />
          <Skeleton height={16} />
          <Skeleton height={16} width="75%" />
        </Card>
      )}
      {stats.total > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
          {tiles.map(([label, value]) => <Stat key={label} label={label} value={value} />)}
        </View>
      )}
      {!loading && stats.total === 0 && (
        <EmptyState icon="stats-chart-outline" title={t("Insights build as you decide")} action={<AppButton title={t("Start a decision")} iconRight="arrow-forward" onPress={() => router.navigate("/")} />}>
          {t("Save a decision and rate how it went. ORION then shows what tends to matter to you and whether the analysis held up.")}
        </EmptyState>
      )}
      {!loading && stats.total === 0 && (
        <Card style={{ borderStyle: "dashed" }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }}>
            <SectionTitle>{t("What you will see here")}</SectionTitle>
            <Tag label={t("Example, not your data")} tone="info" />
          </View>
          <Small>{t("After a few decisions, and a rating of how each turned out, this page answers two questions.")}</Small>
          <View style={{ gap: spacing.xs }}>
            <Small style={{ color: colors.body }}>{t("Did the analysis hold up?")}</Small>
            <ProbabilityBar label={t("When you went with the leading option")} value={0.8} display={wellOf(4, 5)} />
            <ProbabilityBar label={t("When you chose against the comparison")} value={0.5} display={wellOf(1, 2)} />
          </View>
          <View style={{ gap: spacing.xs }}>
            <Small style={{ color: colors.body }}>{t("What matters most to you")}</Small>
            <ProbabilityBar label={t("Growth")} value={0.5} display="3×" />
            <ProbabilityBar label={t("Cost")} value={0.33} display="2×" />
          </View>
        </Card>
      )}
      {/* A handful of outcomes is a story, not a pattern. Say so rather than letting a bar imply otherwise. */}
      {!loading && stats.total > 0 && fullInsights && compared > 0 && compared < 5 && (
        <Notice tone="neutral" icon="information-circle-outline">
          {compared === 1
            ? t("Based on 1 recorded outcome. That is too few to read as a pattern — treat what follows as a record of what happened, not a trend.")
            : t("Based on {n} recorded outcomes. That is too few to read as a pattern — treat what follows as a record of what happened, not a trend.", { n: compared })}
        </Notice>
      )}
      {!loading && stats.total > 0 && !fullInsights && <Paywall feature="full_insights" />}
      {!loading && stats.total > 0 && (
        <>
      <Card style={fullInsights ? undefined : { display: "none" }}>
        <View style={{ gap: spacing.xs }}>
          <SectionTitle>{t("Did the analysis hold up?")}</SectionTitle>
          <Small>{t("Rated decisions, split by whether you chose the option the comparison ranked first. “Against the comparison” means the gap was bigger than the estimates’ own uncertainty; closer than that is a toss-up.")}</Small>
        </View>
        {compared === 0 && <Small>{t("Nothing to compare yet. Choose an option, then rate how it turned out in History.")}</Small>}
        {calibration && held(t("When you went with the leading option"), calibration.followed)}
        {calibration && held(t("When it was too close to call and you picked the other one"), calibration.tossup)}
        {calibration && held(t("When you chose against the comparison"), calibration.diverged)}
        {calibration && count(calibration.diverged) > 0 && (
          <View style={{ gap: spacing.xs }}>
            <Small>{t("Your choices against the comparison, by what was behind them:")}</Small>
            {Object.entries(calibration.reasons).map(([reason, tally]) => (
              <Small key={reason}>{t("{reason}: {well} of {total} turned out well", { reason: REASONS[reason] ? t(REASONS[reason]) : reason, well: tally.well, total: count(tally) })}</Small>
            ))}
          </View>
        )}
        {compared > 0 && compared < 5 && <Small>{t("Only {n} rated so far — too few to read much into.", { n: compared })}</Small>}
      </Card>
      <View style={split ? { flexDirection: "row", alignItems: "flex-start", gap: 28 } : { gap: spacing.lg }}>
        <Card style={split && { flex: 1 }}>
          <SectionTitle>{t("How your decisions turned out")}</SectionTitle>
          {ratedTotal === 0 && <Small>{t("No outcomes recorded yet. Rate a decision in History once you know how it went.")}</Small>}
          {ratedTotal > 0 && RATINGS.map((rating) => (
            <ProbabilityBar key={rating} label={ratingLabel(rating)} value={(stats.rated[rating] ?? 0) / ratedTotal} display={`${stats.rated[rating] ?? 0}`} />
          ))}
        </Card>
        <Card style={split && { flex: 1 }}>
          <SectionTitle>{t("What matters most to you")}</SectionTitle>
          {ranked.length === 0 && <Small>{t("Nothing yet. Answer a question on the Home tab and it will show up here.")}</Small>}
          {ranked.map(([label, n]) => (
            <ProbabilityBar key={label} label={sentenceCase(label)} value={affinityTotal > 0 ? n / affinityTotal : 0} display={`${n}×`} />
          ))}
        </Card>
      </View>
        </>
      )}
    </Screen>
  );
}
