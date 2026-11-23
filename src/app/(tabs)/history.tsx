// §15 history: past decisions, outcome review, and calibration over time.
// Ratings are the user's, and nothing feeds back into the model automatically.
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { db } from "../../db/database";
import { deleteDecision, listDecisions, matchesQuery, type SavedDecision } from "../../db/decisions";
import { calibrationSummary, ratingToImpact, type OutcomeRating, type OutcomeRecord } from "../../decision-engine/calibration";
import { RATINGS, recordRating } from "../../db/followups";
import { linkFor, stopSharing } from "../../share/client";
import { useSession } from "../../store/session";
import { useAccount } from "../../account/store";
import { categoryLabel, ratingLabel, stakesLabel, statusLabel } from "../../account/labels";
import { getLocale, intlLocale, msg, t } from "../../i18n";
import { AppButton, Card, Chip, ConfirmButton, Divider, EmptyState, Field, IconButton, Notice, PageHeader, Reveal, Screen, Skeleton, Small, Tag, Text, useLayout } from "../../components/ui";
import { colors, spacing, type } from "../../theme/tokens";

const FILTERS = ["All", "Open", "Decided", "To rate"] as const;
type Filter = (typeof FILTERS)[number];
/** What each filter is called on screen; the filter itself is the English id. */
const FILTER_LABEL: Record<Filter, string> = { All: msg("All"), Open: msg("Open"), Decided: msg("Decided"), "To rate": msg("To rate") };
const head = { fontSize: type.metadata, fontWeight: "500" as const, letterSpacing: 2.2, textTransform: "uppercase" as const, color: colors.muted };
// Actions leave room for the armed "Delete?" button beside the arrow.
const COLS = { status: 150, outcome: 340, actions: 150 };

/** The five-point rating read as the engine's −10..+10 vocabulary, for calibration. */
const TO_OUTCOME: Record<string, OutcomeRating> = {
  Great: "much-better",
  Good: "better",
  Neutral: "as-expected",
  Bad: "worse",
  "Very bad": "much-worse",
};

function day(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(getLocale() === "en" ? undefined : intlLocale(), { year: "numeric", month: "short", day: "numeric" });
}

type Row = Record<string, unknown>;

export default function HistoryScreen() {
  const [rows, setRows] = useState<SavedDecision[] | null>(null);
  // Outcome rows merged per decision: predicted value, latest rating, and note.
  const [outcomes, setOutcomes] = useState<Record<string, Row>>({});
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { split } = useLayout();

  const refresh = useCallback(async () => {
    try {
      const [decisions, outcomeRows] = await Promise.all([listDecisions(), db.list("decision_outcomes")]);
      const merged: Record<string, Row> = {};
      // Oldest first, so the newest rating a user gave is the one kept.
      for (const row of [...outcomeRows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
        const id = String(row.decision_id);
        merged[id] = { ...(merged[id] ?? {}), ...row };
      }
      setRows(decisions);
      setOutcomes(merged);
      setError(null);
    } catch {
      setRows((old) => old ?? []);
      setError(t("Could not read your saved decisions."));
    }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // Latest recorded rating per decision, so the chosen chip stays selected.
  const rated = useMemo(() => Object.fromEntries(
    Object.entries(outcomes)
      .filter(([, o]) => o.rating !== null && o.rating !== undefined)
      .map(([id, o]) => [id, String(o.rating)])
  ), [outcomes]);

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    matchesQuery(r, query) &&
    (filter === "All" || (filter === "Open" && r.status === "open") || (filter === "Decided" && r.status === "decided") ||
      (filter === "To rate" && r.status === "decided" && !rated[r.id]))
  ), [rows, query, filter, rated]);
  const counts: Record<Filter, number> = {
    All: rows?.length ?? 0,
    Open: rows?.filter((r) => r.status === "open").length ?? 0,
    Decided: rows?.filter((r) => r.status === "decided").length ?? 0,
    "To rate": rows?.filter((r) => r.status === "decided" && !rated[r.id]).length ?? 0,
  };

  const open = (r: SavedDecision) => router.push(`/decision/${r.id}/analysis`);
  const resume = async (r: SavedDecision) => {
    if (await useSession.getState().loadDecision(r.id)) router.navigate("/");
    else setError(t("Could not open that decision."));
  };
  const remove = async (r: SavedDecision) => {
    try {
      // A shared link would outlive the decision; take it down too.
      const link = await linkFor(r.id).catch(() => null);
      if (link) await stopSharing(r.id, link).catch(() => false);
      await deleteDecision(r.id);
      // The decision on screen at Home may be the one just deleted.
      if (useSession.getState().decisionId === r.id) useSession.getState().reset();
      await refresh();
      useAccount.getState().backupSoon();
    } catch { setError(t("Could not delete that decision.")); }
  };
  const rate = async (r: SavedDecision, rating: string) => {
    try {
      await recordRating(r.id, rating);
      await refresh();
      useAccount.getState().backupSoon();
    } catch { setError(t("Could not save that rating.")); }
  };
  const saveNote = async (r: SavedDecision) => {
    try {
      const now = new Date().toISOString();
      // The session's own outcome row carries the predicted value; the note joins it.
      const existing = await db.get("decision_outcomes", `out_${r.id}`);
      await db.upsert("decision_outcomes", {
        ...(existing ?? {}),
        id: `out_${r.id}`,
        decision_id: r.id,
        notes: notes[r.id] ?? "",
        status: String(existing?.status ?? "pending"),
        created_at: String(existing?.created_at ?? now),
        updated_at: now,
      });
      await refresh();
      setOpenNotes(null);
    } catch { setError(t("Could not save that note.")); }
  };

  // Only a decision that was made has an outcome to rate; an open one is offered to continue instead.
  const outcome = (r: SavedDecision, compact: boolean) => {
    const expected = outcomes[r.id]?.expected_outcome;
    const mapped = rated[r.id] ? TO_OUTCOME[rated[r.id]] : undefined;
    return r.status === "open" ? (
      <AppButton variant="secondary" icon="play-outline" title={t("Continue deciding")} onPress={() => void resume(r)} style={{ alignSelf: "flex-start", minHeight: compact ? 36 : 44 }} />
    ) : (
      <View style={{ gap: compact ? 6 : spacing.sm }}>
        <View accessibilityRole="radiogroup" accessibilityLabel={t('How did "{title}" turn out?', { title: r.title })} style={{ flexDirection: "row", flexWrap: "wrap", gap: compact ? 6 : spacing.sm }}>
          {RATINGS.map((rating) => (
            <Chip key={rating} compact={compact} label={ratingLabel(rating)} selected={rated[r.id] === rating} onPress={() => void rate(r, rating)} />
          ))}
        </View>
        {!compact && (
          <>
            {expected != null && mapped && (
              <Small>
                {t("ORION predicted {expected} on a −10 to +10 scale. You reported “{rating}”, about {actual}.", { expected: Number(expected).toFixed(1), rating: ratingLabel(rated[r.id]), actual: ratingToImpact(mapped) })}
              </Small>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOpenNotes(openNotes === r.id ? null : r.id);
                setNotes((old) => ({ ...old, [r.id]: String(outcomes[r.id]?.notes ?? "") }));
              }}
            >
              <Small style={{ color: colors.accentBright }}>{openNotes === r.id ? t("Hide note") : t("Add a note")}</Small>
            </Pressable>
            {openNotes === r.id && (
              <View style={{ gap: spacing.xs }}>
                <Field
                  accessibilityLabel={t("Outcome note")}
                  placeholder={t("What actually happened?")}
                  value={notes[r.id] ?? ""}
                  onChangeText={(value) => setNotes((old) => ({ ...old, [r.id]: value }))}
                />
                <AppButton variant="secondary" title={t("Save note")} onPress={() => void saveNote(r)} style={{ alignSelf: "flex-start" }} />
              </View>
            )}
          </>
        )}
      </View>
    );
  };
  const status = (r: SavedDecision) => (
    <View style={{ gap: 4, alignItems: "flex-start" }}>
      <Tag label={statusLabel(r.status)} tone={r.status === "decided" ? "success" : "info"} />
      {r.againstComparison && <Tag label={t("Against the comparison")} tone="warning" />}
    </View>
  );
  const meta = (r: SavedDecision) => [day(r.createdAt), categoryLabel(r.category), r.chosen ? t("Chose: {option}", { option: r.chosen }) : ""].filter(Boolean).join(" · ");

  const record = (r: SavedDecision): OutcomeRecord => {
    const o = outcomes[r.id];
    const expected = o?.expected_outcome;
    return {
      decisionId: r.id,
      expectedOutcome: expected === null || expected === undefined ? null : Number(expected),
      rating: o?.rating === null || o?.rating === undefined ? null : TO_OUTCOME[String(o.rating)] ?? null,
    };
  };

  const summary = calibrationSummary((rows ?? []).map(record));

  return (
    <Screen title={t("My decisions")}>
      <PageHeader title={t("My decisions")}>
        <Small>{t("Past decisions and how they turned out. Stored on this device only.")}</Small>
      </PageHeader>
      {error && <Notice tone="danger" alert>{error}</Notice>}
      {rows === null && (
        <Card><Skeleton width="40%" height={20} /><Skeleton height={14} /><Skeleton width="70%" height={14} /></Card>
      )}
      {/* With nothing saved the empty state below says it all; this card waits for the first decision. */}
      {rows !== null && rows.length > 0 && (
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{t("How ORION's predictions have held up")}</Text>
          <Text style={{ fontSize: type.supporting, fontWeight: "300", color: colors.body }}>{summary.message}</Text>
          {summary.bias !== null && (
            <Small>
              {summary.bias > 0
                ? t("{reviewed} reviewed · {pending} waiting · ORION was too cautious by {points} points on a −10 to +10 scale", { reviewed: summary.reviewed, pending: summary.pending, points: Math.abs(summary.bias).toFixed(1) })
                : summary.bias < 0
                  ? t("{reviewed} reviewed · {pending} waiting · ORION was too optimistic by {points} points on a −10 to +10 scale", { reviewed: summary.reviewed, pending: summary.pending, points: Math.abs(summary.bias).toFixed(1) })
                  : t("{reviewed} reviewed · {pending} waiting · predictions matched results by {points} points on a −10 to +10 scale", { reviewed: summary.reviewed, pending: summary.pending, points: Math.abs(summary.bias).toFixed(1) })}
            </Small>
          )}
          {summary.buckets.filter((b) => b.count > 0).map((b) => (
            <Small key={b.from}>
              {b.count === 1
                ? t("Predicted {predicted} → came out {actual} · 1 decision", { predicted: b.predicted.toFixed(1), actual: (b.actual ?? 0).toFixed(1) })
                : t("Predicted {predicted} → came out {actual} · {n} decisions", { predicted: b.predicted.toFixed(1), actual: (b.actual ?? 0).toFixed(1), n: b.count })}
            </Small>
          ))}
        </Card>
      )}
      {rows?.length === 0 && (
        <EmptyState icon="time-outline" title={t("No decisions yet")} action={<AppButton title={t("Ask ORION")} iconRight="arrow-forward" onPress={() => router.navigate("/")} />}>
          {t("Decisions you save show up here, so you can come back and record how they turned out.")}
        </EmptyState>
      )}
      {rows !== null && rows.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }}>
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder={t("Search decisions")}
            accessibilityLabel={t("Search decisions")}
            style={{ flexGrow: 1, flexBasis: 240, maxWidth: 380 }}
          />
          <View accessibilityRole="radiogroup" accessibilityLabel={t("Filter decisions")} style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {FILTERS.map((f) => (
              <Chip key={f} label={`${t(FILTER_LABEL[f])} ${counts[f]}`} accessibilityLabel={`${t(FILTER_LABEL[f])}: ${counts[f]}`} selected={filter === f} onPress={() => setFilter(f)} />
            ))}
          </View>
        </View>
      )}
      {rows !== null && rows.length > 0 && shown.length === 0 && (
        <EmptyState icon="search-outline" title={t("Nothing matches")} action={<AppButton variant="secondary" title={t("Clear search and filter")} onPress={() => { setQuery(""); setFilter("All"); }} />}>
          {t("No saved decision fits that search or filter.")}
        </EmptyState>
      )}
      {split && shown.length > 0 && (
        <Card style={{ padding: 0, gap: 0, overflow: "hidden" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, backgroundColor: colors.sunken }}>
            <Text style={[head, { flex: 1 }]}>{t("Decision")}</Text>
            <Text style={[head, { width: COLS.status }]}>{t("Status")}</Text>
            <Text style={[head, { width: COLS.outcome }]}>{t("How did it turn out?")}</Text>
            <View style={{ width: COLS.actions }} />
          </View>
          {shown.map((r, i) => (
            <Reveal key={r.id} index={Math.min(i, 6) + 1}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 14, borderTopWidth: 1, borderColor: colors.line }}>
              <Pressable onPress={() => open(r)} accessibilityRole="link" accessibilityLabel={t("View analysis: {title}", { title: r.title })} style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "400", color: colors.ink }}>{r.title}</Text>
                <Small>{meta(r)}</Small>
              </Pressable>
              <View style={{ width: COLS.status }}>{status(r)}</View>
              <View style={{ width: COLS.outcome }}>{outcome(r, true)}</View>
              <View style={{ width: COLS.actions, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs }}>
                <ConfirmButton compact title={t("Delete {title}", { title: r.title })} confirmTitle={t("Delete?")} onConfirm={() => void remove(r)} />
                <IconButton icon="arrow-forward" tone="accent" size={32} accessibilityLabel={t("View analysis: {title}", { title: r.title })} onPress={() => open(r)} />
              </View>
            </View>
            </Reveal>
          ))}
        </Card>
      )}
      {!split && shown.map((r, i) => (
        <Reveal key={r.id} index={Math.min(i, 6) + 1}>
        <Card>
          <Pressable onPress={() => open(r)} accessibilityRole="link" style={{ gap: spacing.sm }}>
            <Text style={{ fontSize: type.section, fontWeight: "400", color: colors.ink }}>{r.title}</Text>
            <Small>{meta(r)}</Small>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }}>
              <Tag label={stakesLabel(r.stakes)} />
              {status(r)}
              <Text style={{ fontSize: type.supporting, fontWeight: "400", color: colors.accentBright }}>{t("View analysis →")}</Text>
            </View>
          </Pressable>
          <Divider />
          {r.status === "decided" && <Small>{t("How did it turn out?")}</Small>}
          {outcome(r, false)}
          <View style={{ alignSelf: "flex-start", marginLeft: -18 }}>
            <ConfirmButton title={t("Delete")} confirmTitle={t("Delete this decision?")} onConfirm={() => void remove(r)} />
          </View>
        </Card>
        </Reveal>
      ))}
    </Screen>
  );
}
