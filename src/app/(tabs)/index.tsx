// Home tab (§14): input → 0–3 questions → trade-offs → choose.
// Data lives in the session store; math stays in decision-engine.
//
// The result answers first and explains on request. The first screen is ORION's call, two reasons, what would
// change the answer, and the choice; everything that explains *how* (the score, how sure ORION is, the bars,
// the questions, the estimates table) waits behind one "Show me the full analysis" button. A fun decision keeps
// its even shorter form, the call alone, until "Show me why".
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Home } from "../../components/Home";
import { DecisionResult } from "../../components/DecisionResult";
import { Aftermath } from "../../components/Aftermath";
import { WhatMatters } from "../../components/WhatMatters";
import { DuelCard } from "../../components/DuelCard";
import { OfflineForm } from "../../components/OfflineForm";
import { OptionRanking } from "../../components/OptionRanking";
import { Understood, understoodLine } from "../../components/Understood";
import { ChoiceCheck } from "../../components/ChoiceCheck";
import { divergence } from "../../decision-engine/divergence";
import { AppButton, Body, Card, CheckRow, Icon, Reveal, Skeleton, Tag, Chip, Eyebrow, Notice, PageHeader, Screen, SectionTitle, Small, Text, Title, sentenceCase, sticky, useLayout } from "../../components/ui";
import { usePlan } from "../../billing/plan";
import { useAccount } from "../../account/store";
import { listDecisions, type SavedDecision } from "../../db/decisions";
import { explainLocal } from "../../ai/explainDecision";
import { scoreAll } from "../../decision-engine/uncertainty";
import { runScenarios } from "../../decision-engine/scenarios";
import { sensitivity } from "../../decision-engine/sensitivity";
import { nextDuel } from "../../decision-engine/duel";
import { bestThingToLearn } from "../../decision-engine/informationGain";
import { questionBudgetFor, shouldStop } from "../../decision-engine/stoppingRule";
import { safetyNotice } from "../../decision-engine/safety";
import { useSession, isGenericFallback } from "../../store/session";
import { apiEnabled, fetchExplanation } from "../../ai/client";
import { plainFlip } from "../../copy/plain";
import { businessContext, useBusiness } from "../../business/profile";
import { colors, layout, spacing } from "../../theme/tokens";
import { makeTheCall } from "../../decision-engine/call";
import { QuickCall, TooCloseToCall } from "../../components/QuickCall";
import { CheckIns } from "../../components/CheckIns";
import { TemplatePicker } from "../../components/TemplatePicker";
import { FriendsPanel } from "../../components/FriendsPanel";
import { ExportPanel } from "../../components/ExportPanel";
import { DecisionInput } from "../../components/DecisionInput";
import { dueFollowUps, nextFollowUp, recordRating, resolveFollowUp, snoozeFollowUp, type DueFollowUp } from "../../db/followups";
import { buildReport, checkInEvent } from "../../export/report";
import { saveFile } from "../../export/download";
import type { Tally } from "../../share/client";
import { Platform } from "react-native";
import { intlLocale, msg, t } from "../../i18n";
import { areaLabel } from "../../components/examples";

const MODE_LABEL = { playful: msg("Just for fun"), everyday: msg("Everyday"), serious: msg("Big decision") } as const;
const STAKES_LABEL: Record<string, string> = { tiny: msg("tiny stakes"), normal: msg("normal stakes"), significant: msg("significant stakes"), major: msg("major stakes") };

export default function DecideScreen() {
  const router = useRouter();
  const s = useSession();
  const lens = useBusiness((b) => b.lens);
  const { shell, split } = useLayout();
  const [detail, setDetail] = useState<{ key: string; text: string; fallback: boolean } | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);
  const [fine, setFine] = useState(false);
  const [editSignal, setEditSignal] = useState(0);
  const quotaReached = usePlan((p) => p.enabled && !p.pro && p.quotaReached);
  const canJustify = usePlan((p) => p.can("choice_justification", s.decisionId));
  const [open, setOpen] = useState<SavedDecision[]>([]);
  const [returning, setReturning] = useState(false);
  const [checkIns, setCheckIns] = useState<DueFollowUp[]>([]);
  // A fun decision shows only the call until the person asks why.
  const [showWhy, setShowWhy] = useState(false);
  // Everyone else gets the answer first; the full analysis opens on request and stays open for this decision.
  const [full, setFull] = useState(false);
  // An everyday decision with nothing scored offers "just pick for me".
  const [picked, setPicked] = useState<string | null>(null);
  const [friends, setFriends] = useState<Tally | null>(null);
  const [nextCheck, setNextCheck] = useState<{ dueAt: string; prompt: string } | null>(null);
  const account = useAccount();
  const [nudged, setNudged] = useState(() => { try { return typeof localStorage !== "undefined" && localStorage.getItem("orion.signup-nudge") === "dismissed"; } catch { return false; } });
  const dismissNudge = () => { setNudged(true); try { localStorage.setItem("orion.signup-nudge", "dismissed"); } catch { /* not remembered; harmless */ } };
  const idle = s.status === "idle";
  // Unfinished decisions, offered on Home so they are one click away.
  useFocusEffect(useCallback(() => {
    if (!idle) return;
    let live = true;
    void listDecisions().then((rows) => { if (live) { setOpen(rows.filter((r) => r.status === "open")); setReturning(rows.length > 0); } }).catch(() => {});
    void dueFollowUps().then((due) => { if (live) setCheckIns(due); }).catch(() => {});
    return () => { live = false; };
  }, [idle]));
  const reloadCheckIns = () => void dueFollowUps().then(setCheckIns).catch(() => {});
  // A new decision starts with the short view again.
  useEffect(() => { setShowWhy(false); setFull(false); setPicked(null); setFriends(null); }, [s.decisionId]);
  // When ORION will follow up, said right where the choice was saved.
  useEffect(() => {
    if (!s.saved || s.privateMode || !s.decisionId) { setNextCheck(null); return; }
    let live = true;
    void nextFollowUp(s.decisionId).then((next) => { if (live) setNextCheck(next); }).catch(() => {});
    return () => { live = false; };
  }, [s.saved, s.privateMode, s.decisionId, s.committedOptionId]);
  const explanationKey = JSON.stringify([s.decisionId, s.options, s.factors, s.safety]);

  const analysis = useMemo(() => {
    if (s.status !== "ready" || !s.extraction) return null;
    if (s.options.length === 0 || s.safety === "crisis" || s.safety === "dangerous") return null;
    // Every tap counts as a question asked.
    const asked = Object.keys(s.answers).length + Object.keys(s.duels).length;
    const scored = scoreAll(s.options, s.factors).sort((a, b) => b.jev - a.jev);
    const scen = runScenarios(s.options, s.factors);
    const sens = sensitivity(s.options, s.factors);
    const gap = scored.length > 1 ? scored[0].jev - scored[1].jev : 99;
    // A wide JEV lead settles it with no questions at all; otherwise the usual stopping rule decides.
    const stop = gap >= 3 && s.scoringSource !== "none" ? { stop: true, reason: "Strong leader; more questions unlikely to change it." } : shouldStop({
      gap,
      stakes: s.extraction.stakes,
      reversibility: s.options.find((o) => o.id === scored[0].optionId)?.reversibility ?? 0.5,
      questionsAsked: asked,
      maxQuestions: questionBudgetFor(s.extraction.stakes),
    });
    const leaderOpt = s.options.find((o) => o.id === scored[0].optionId)!;
    const runnerOpt = s.options.find((o) => o.id === (scored[1]?.optionId ?? scored[0].optionId))!;
    const signal = s.scoringSource !== "none";
    // What would change the answer, in plain words: the engine's sentence carries its working ("(gap 3.2)").
    const change = plainFlip(sens.flips[0]?.description ?? "");
    const expl = explainLocal({
      leaderLabel: leaderOpt.label,
      leaderJev: scored[0].jev,
      runnerLabel: runnerOpt.label,
      runnerJev: scored[1]?.jev ?? scored[0].jev,
      topFactors: sens.dominantFactors,
      flipNote: change,
      nextAction: signal ? bestThingToLearn(s.options, s.factors) : "",
      stability: scen.stability,
    });
    return { asked, scored, scen, sens, stop, expl, leaderOpt, runnerOpt, signal, change };
  }, [s]);

  // JEV runs the interview: with no scores yet (offline), one tap per factor builds them, most important first,
  // and it stops as soon as the factors left could not overturn the lead.
  const duelMode = s.scoringSource === "none" || (s.scoringSource === "manual" && Object.keys(s.duels).length > 0);
  const duelStep = useMemo(
    () => (duelMode && s.status === "ready" && s.extraction && s.options.length > 1 ? nextDuel(s.options, s.factors, s.duels, s.extraction.stakes) : null),
    [duelMode, s.status, s.extraction, s.options, s.factors, s.duels]
  );
  const pendingDuel = duelStep?.factor ?? null;

  // Private mode only governs saving; say plainly where the text itself goes.
  const privacy = (
    <View style={{ gap: 2, alignItems: s.status === "idle" ? "center" : "flex-start" }}>
      <CheckRow
        checked={s.privateMode}
        onPress={s.togglePrivate}
        icon="lock-closed-outline"
        label={s.privateMode ? t("Private mode — nothing is saved") : t("Private mode")}
        disabled={s.status === "idle" ? undefined : s.saving}
      />
      <Small style={{ fontSize: 13, lineHeight: 19, maxWidth: 460, textAlign: s.status === "idle" ? "center" : "left" }}>
        {apiEnabled()
          ? t("Your decision text is sent to the ORION server, which may pass it to an AI provider to analyse it. Private mode only stops it being saved on this device.")
          : t("Your decision text is analysed on this device and is not sent anywhere. Private mode also keeps it out of History.")}
      </Small>
    </View>
  );

  if (s.status === "idle") {
    const checkInList = (
      <CheckIns
        items={checkIns}
        onRate={(item, rating) => void recordRating(item.decisionId, rating).then(() => { useAccount.getState().backupSoon(); reloadCheckIns(); })}
        onSnooze={(item) => void snoozeFollowUp(item.id, 3).then(reloadCheckIns)}
        onResume={(item) => void resolveFollowUp(item.id).then(() => s.loadDecision(item.decisionId))}
        onDrop={(item) => void resolveFollowUp(item.id).then(reloadCheckIns)}
      />
    );
    return (
      <Screen scene="sky">
        <Home
          onSubmit={(text) => void s.submit(text)} privacy={privacy} draft={s.draft} open={open} returning={returning} onResume={(id) => void s.loadDecision(id)}
          checkIns={checkIns.length > 0 ? checkInList : null}
          templates={<TemplatePicker key={lens} onStart={(id, names, details) => void s.startTemplate(id, names, details)} />}
        />
      </Screen>
    );
  }

  // The input did not read as a decision. Say so kindly, keep what they typed, and let them insist.
  if (s.status === "clarify") {
    return (
      <Screen title={t("What are you deciding?")}>
        <View style={{ width: "100%", maxWidth: 780, alignSelf: "center", gap: spacing.lg }}>
          <PageHeader eyebrow={s.clarify?.kind === "greeting" ? t("Hello") : t("One thing first")} title={s.clarify?.kind === "greeting" ? t("What are you deciding?") : t("That doesn't look like a choice yet")}>
            <Body>{s.clarify?.message}</Body>
          </PageHeader>
          <DecisionInput key={s.rawInput} initial={s.clarify?.kind === "greeting" ? "" : s.rawInput} onSubmit={(text) => void s.submit(text)} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {[t("Pizza or tacos tonight?"), t("Take the job offer or stay?"), t("Gym now or after work?")].map((q) => <Chip key={q} label={q} onPress={() => void s.submit(q)} />)}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {s.clarify?.kind !== "greeting" && <AppButton variant="secondary" title={t("It is a decision — compare anyway")} iconRight="arrow-forward" onPress={() => void s.submit(s.rawInput, true)} />}
            <AppButton variant="ghost" icon="arrow-back" title={t("Back")} onPress={s.reset} />
          </View>
        </View>
      </Screen>
    );
  }

  if (s.status === "loading") {
    const steps: [typeof s.stage, string][] = [
      ["reading", t("Reading your question")],
      ["scoring", apiEnabled() ? t("Comparing your options") : t("Setting up the comparison")],
      ["questions", t("Checking what could change the result")],
    ];
    const current = steps.findIndex(([stage]) => stage === s.stage);
    return (
      <Screen title={t("Thinking")}>
        <View style={{ gap: spacing.lg }}>
          <View style={{ gap: spacing.sm }}>
            <Eyebrow color={colors.accentBright}>{t("Working on it")}</Eyebrow>
            <Title size={s.rawInput.length > 60 ? 26 : 32}>{s.rawInput}</Title>
          </View>
          {/* As soon as the question is read, what ORION understood is on screen; the comparison follows. */}
          {s.extraction && (
            <Reveal>
              <Card style={{ gap: spacing.xs }}>
                <Eyebrow>{t("What ORION understood")}</Eyebrow>
                <Body>{sentenceCase(understoodLine(s.extraction.options.map((o) => o.label), [...s.extraction.factors].sort((a, b) => b.importance - a.importance)))}</Body>
                <Small>{t("You can correct this once the comparison is ready.")}</Small>
              </Card>
            </Reveal>
          )}
          <Card style={{ gap: spacing.md }}>
            <View accessibilityRole="progressbar" accessibilityLabel={steps[current]?.[1] ?? t("Working")} style={{ gap: 12 }}>
              {steps.map(([stage, label], i) => (
                <View key={stage} style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: i > current ? 0.45 : 1 }}>
                  <View style={{ width: 22, alignItems: "center" }}>
                    {i < current ? <Icon name="checkmark-circle" size={20} color={colors.success} /> : i === current ? <ActivityIndicator size="small" color={colors.accentBright} /> : <Icon name="ellipse-outline" size={18} color={colors.faint} />}
                  </View>
                  <Body style={i === current ? { color: colors.white } : undefined}>{label}{i === current ? "…" : ""}</Body>
                </View>
              ))}
            </View>
            {/* The options arrive before the scores do: show them, so the wait already says something. */}
            {s.preview ? (
              <View style={{ gap: spacing.sm }}>
                <Small>{s.preview.suggested ? t("Your question did not name options, so ORION suggested these:") : t("Comparing:")}</Small>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {s.preview.options.map((label, i) => (
                    <Reveal key={`${label}|${i}`}><Tag label={label} tone="info" /></Reveal>
                  ))}
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <Skeleton width="48%" height={84} radius={20} />
                <Skeleton width="48%" height={84} radius={20} />
              </View>
            )}
          </Card>
          <AppButton variant="ghost" icon="close" title={t("Cancel")} onPress={s.editQuestion} style={{ alignSelf: "flex-start" }} />
        </View>
      </Screen>
    );
  }

  if (s.status === "error" || !s.extraction) {
    return (
      <Screen title={t("Something went wrong")}>
        <Notice tone="danger" alert>{s.error ? t("ORION could not analyse that: {error} Nothing was saved.", { error: s.error }) : t("ORION could not analyse that. Nothing was saved.")}</Notice>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {s.rawInput !== "" && <AppButton title={t("Try again")} icon="refresh" onPress={() => void s.submit(s.rawInput)} />}
          <AppButton title={s.rawInput ? t("Reword the question") : t("Start over")} icon="create-outline" variant="secondary" onPress={s.rawInput ? s.editQuestion : s.reset} />
        </View>
      </Screen>
    );
  }

  const notice = s.safety === "normal" ? null : safetyNotice(s.safety);

  // Crisis / dangerous: support path, never JEV theater (§42 + guardrails).
  if (s.safety === "crisis" || s.safety === "dangerous") {
    return (
      <Screen>
        <Title>{s.extraction.title}</Title>
        <Card>
          <Body style={{ color: colors.ink }}>{notice}</Body>
        </Card>
        <AppButton title={t("Start over")} icon="refresh" variant="secondary" onPress={s.reset} style={{ alignSelf: "flex-start" }} />
      </Screen>
    );
  }

  if (!analysis) {
    return (
      <Screen>
        <Body>{t("No options available. Start a new decision.")}</Body>
        <AppButton title={t("Start over")} icon="refresh" variant="secondary" onPress={s.reset} style={{ alignSelf: "flex-start" }} />
      </Screen>
    );
  }

  const pending = s.questions.filter((q) => !(q.question in s.answers));
  const playful = s.mode === "playful";
  // A fun decision is the call and nothing else, until the person asks why.
  const brief = playful && !showWhy;
  const assessment = divergence(s.options, s.factors, s.committedOptionId, analysis.signal);
  // The local parser's fallback when a question names no options. Ask for them instead of comparing "do it / don't".
  const guessed = isGenericFallback(s.options);
  const understood = (
    <Understood
      key={s.decisionId}
      options={s.options.map((o) => o.label)}
      factors={[...s.factors].sort((a, b) => b.weight - a.weight)}
      guessed={guessed}
      suggested={s.extraction.options.some((o) => o.generated)}
      startOpen={guessed}
      openSignal={editSignal}
      disabled={s.saving}
      onApply={s.refine}
    />
  );
  const tied = analysis.scored.length > 1 && analysis.scored[0].jev === analysis.scored[1].jev;
  const call = guessed ? null : makeTheCall({
    options: s.options, factors: s.factors, mode: s.mode, signal: analysis.signal,
    seed: `${s.decisionId}:${s.flips}`, drivers: analysis.sens.dominantFactors,
  });
  // A coin is offered, not imposed, outside fun decisions; and no call interrupts the quick questions.
  const showCall = call !== null && (playful || (call.kind === "coin" ? picked !== null : !pendingDuel));
  // The simple result: the call with two reasons and what would change it, the choice, and one button for the
  // rest. A fun decision keeps its own short form; the quick questions run first while nothing is scored.
  const simple = !playful && !guessed && analysis.signal && !pendingDuel;
  const runnerLabel = analysis.scored.length > 1 ? analysis.runnerOpt.label : null;
  const reasons = simple && !tied
    ? analysis.sens.dominantFactors.filter((w) => w.impact > 0).slice(0, 2).map((w) => runnerLabel
      ? t("It does better on {factor} than {runner}.", { factor: w.label.toLowerCase(), runner: runnerLabel })
      : t("It does better on {factor}.", { factor: w.label.toLowerCase() }))
    : [];
  const tiedLabels = tied ? analysis.scored.filter((o) => o.jev === analysis.scored[0].jev).map((o) => s.options.find((x) => x.id === o.optionId)?.label ?? "") : [];
  const quickCall = call && showCall && (
    <QuickCall
      call={call}
      mode={s.mode}
      chosen={s.committedOptionId}
      disabled={s.saving}
      replay={s.flips}
      onGo={(id) => void s.commit(id)}
      onFlip={call.kind === "coin" ? s.flip : undefined}
      onCompare={playful ? () => setShowWhy(!showWhy) : undefined}
      comparing={showWhy}
      reasons={simple ? reasons : undefined}
      change={simple && analysis.change ? analysis.change : undefined}
    />
  );
  const pickForMe = call?.kind === "coin" && !playful && picked === null && (
    <AppButton variant="ghost" icon="sync-outline" title={t("Can't decide? Let ORION pick")} onPress={() => setPicked(String(s.flips))} style={{ alignSelf: "flex-start" }} />
  );
  // Nothing separates the options: say so where the call would be. A winner is never invented.
  const tooClose = simple && tied && !showCall && (
    <TooCloseToCall labels={tiedLabels} change={analysis.change}>{pickForMe}</TooCloseToCall>
  );
  // Whether the first screen has an answer to lead with; without one the working opens by itself.
  const answered = showCall || Boolean(tooClose);
  const expanded = playful ? showWhy : full || !answered;
  const analysisVisible = !guessed && analysis.signal && !pendingDuel && expanded;
  const report = () => buildReport({
    title: s.extraction!.title, question: s.rawInput, options: s.options, factors: s.factors, signal: analysis.signal,
    chosenId: s.committedOptionId, call: showCall ? call : null, friends, nextCheckIn: nextCheck?.dueAt ?? null,
  });
  const result = (
    <DecisionResult
      leaderLabel={analysis.leaderOpt.label}
      leaderJev={analysis.scored[0].jev}
      explanation={analysis.signal ? (pendingDuel ? analysis.expl.replace(` ${t("You probably know enough to decide.")}`, "") : analysis.expl) : t("Answer the question above and ORION will rank the options.")}
      signal={analysis.signal}
      tied={tied}
      confidence={analysis.scored[0].confidence}
      reversibility={analysis.leaderOpt.reversibility}
      stability={analysis.scen.stability}
      whyItLeads={analysis.sens.dominantFactors}
      runnerUpLabel={runnerLabel ?? undefined}
      flipNote={analysis.change}
      nextAction={
        analysis.signal
          ? pendingDuel ? t("Answer the question above to firm this up.") : bestThingToLearn(s.options, s.factors)
          : t("Answer the question above, or choose with your own judgment.")
      }
      compact={simple}
      reasoningOpen={simple}
    />
  );

  // One at a time: the questions share a list of factors and read as a wall when stacked.
  const questions = !pendingDuel && !analysis.stop.stop && pending.slice(0, 1).map((q) => (
    <Reveal key={q.question}>
    <Card>
      <Eyebrow>{s.questions.length > 1 ? t("Question {n} of {total}", { n: s.questions.length - pending.length + 1, total: s.questions.length }) : t("Quick question")}</Eyebrow>
      <Text style={{ fontSize: 18, lineHeight: 26, fontWeight: "400", color: colors.ink }}>{q.question}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {s.factors.map((f) => (
          <Chip key={f.id} label={f.label} accessibilityLabel={t("{factor} matters most", { factor: f.label })} onPress={() => s.answer(q.question, f.id)} />
        ))}
        <Chip quiet label={t("Skip →")} onPress={() => s.answer(q.question, null)} />
      </View>
    </Card>
    </Reveal>
  ));
  const enough = !pendingDuel && analysis.stop.stop && analysis.signal && <Notice tone="success">{t("You probably know enough.")}</Notice>;

  // One button between the answer and everything that explains it.
  const expandButton = simple && answered && (
    <View style={{ gap: spacing.xs }}>
      <AppButton
        variant="secondary"
        icon={full ? "chevron-up" : "stats-chart-outline"}
        title={full ? t("Hide the full analysis") : t("Show me the full analysis")}
        expanded={full}
        onPress={() => setFull(!full)}
        style={{ alignSelf: "flex-start" }}
      />
      {!full && <Small>{t("The score, how sure ORION is, what matters most, every option side by side, and the estimates.")}</Small>}
    </View>
  );

  // Page actions shrink on a phone so the row costs one line, not two, above the answer.
  const compactAction = shell ? undefined : { minHeight: 36, paddingHorizontal: 12 };
  // The choice. On a phone it sits right under the answer; beside it on a wide screen.
  const decide = (
    <Card style={guessed ? { display: "none" } : undefined}>
      <View style={{ gap: spacing.xs }}>
        <Eyebrow>{t("Decide")}</Eyebrow>
        <SectionTitle>{t("What will you do?")}</SectionTitle>
        <Small>{t("The analysis informs the decision. It does not make it.")}</Small>
      </View>
      <View style={split ? { gap: spacing.sm } : { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {s.options.map((o) => (
          <AppButton
            key={o.id}
            variant="secondary"
            title={o.label}
            icon={s.committedOptionId === o.id ? "checkmark" : undefined}
            selected={s.committedOptionId === o.id}
            onPress={() => void s.commit(o.id)}
            disabled={s.saving}
            // A long option name wraps inside the button rather than running off a phone screen.
            style={{ maxWidth: "100%" }}
          />
        ))}
        <AppButton variant="ghost" title={t("Not yet")} onPress={() => void s.commit(null)} disabled={s.saving} />
      </View>
      {s.committedOptionId && (
        <ChoiceCheck
          assessment={assessment}
          chosenLabel={s.options.find((o) => o.id === s.committedOptionId)?.label ?? ""}
          leaderLabel={s.options.find((o) => o.id === assessment.leaderId)?.label ?? ""}
          reason={s.choiceReason}
          hardToUndo={(s.extraction.stakes === "significant" || s.extraction.stakes === "major") && (s.options.find((o) => o.id === s.committedOptionId)?.reversibility ?? 1) < 0.4}
          disabled={s.saving}
          locked={!canJustify}
          onUnlock={() => s.decisionId && router.push(`/decision/${s.decisionId}/analysis`)}
          onReason={(reason) => {
            // The two "fix the comparison" answers open the place where it is fixed.
            if (reason === "missing") setEditSignal((n) => n + 1);
            if (reason === "scores") { setFull(true); setFine(true); }
            void s.explainChoice(reason);
          }}
        />
      )}
      {/* The moment an account is worth something: there is now a saved decision to keep. */}
      {s.saved && !s.privateMode && account.enabled && account.ready && !account.user && !nudged && (
        <View style={{ gap: spacing.xs }}>
          <Small>{t("Create a free account to keep this on any device. Without one it stays in this browser.")}</Small>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginLeft: -14 }}>
            <AppButton variant="ghost" icon="person-add-outline" title={t("Create account")} onPress={() => router.navigate("/account?mode=signup")} style={{ minHeight: 36, paddingHorizontal: 14 }} />
            <AppButton variant="ghost" title={t("Not now")} onPress={dismissNudge} style={{ minHeight: 36, paddingHorizontal: 14 }} />
          </View>
        </View>
      )}
      {s.error && <Notice tone="danger" alert>{t("Could not save: {error}", { error: s.error })}</Notice>}
      {s.saved && (
        <Notice tone="success">
          {s.privateMode ? t("Choice recorded for this session — not saved (private mode).") : s.committedOptionId ? t("Decided — saved to History. Come back there to record how it turned out.") : t("Saved to History. You can pick it up again from Home.")}
        </Notice>
      )}
      {nextCheck && s.committedOptionId && (
        <View style={{ gap: spacing.xs }}>
          <Small>
            {t("ORION will check in on {date} to ask how it went — look for it on Home.", { date: new Date(nextCheck.dueAt).toLocaleDateString(intlLocale(), { weekday: "short", month: "short", day: "numeric" }) })}
          </Small>
          {Platform.OS === "web" && (
            <AppButton
              variant="ghost" icon="calendar-outline" title={t("Add the check-in to my calendar")}
              onPress={() => saveFile("orion-check-in.ics", checkInEvent({
                title: s.extraction!.title, prompt: nextCheck.prompt, dueAt: nextCheck.dueAt,
                url: typeof window !== "undefined" ? window.location.origin : undefined,
              }), "text/calendar;charset=utf-8")}
              style={{ alignSelf: "flex-start", marginLeft: -14, minHeight: 36, paddingHorizontal: 14 }}
            />
          )}
        </View>
      )}
    </Card>
  );

  return (
    <Screen title={s.extraction.title}>
      <PageHeader
        eyebrow={`${t(MODE_LABEL[s.mode])} · ${areaLabel(s.extraction.category[0])} · ${t(STAKES_LABEL[s.extraction.stakes] ?? s.extraction.stakes)}`}
        title={s.extraction.title}
        actions={
          <>
            {/* On a phone the three fit one row only when they are compact; they wrap rather than overflow either way. */}
            <AppButton variant="ghost" icon="create-outline" title={t("Reword")} accessibilityLabel={t("Reword the question")} onPress={s.editQuestion} disabled={s.saving} style={compactAction} />
            <AppButton variant="ghost" icon="refresh" title={t("Start over")} onPress={s.reset} disabled={s.saving} style={compactAction} />
            <AppButton
              variant="secondary"
              iconRight="stats-chart"
              title={t("See analysis")}
              disabled={guessed}
              onPress={() => s.decisionId && router.push(`/decision/${s.decisionId}/analysis`)}
              style={compactAction}
            />
          </>
        }
      >
        {s.offline && s.scoringSource !== "api" && <Small>{t("You can compare options using your own estimates, even offline.")}</Small>}
        {guessed && <Small>{t("One more thing before ORION can compare anything.")}</Small>}
        {!guessed && duelMode && !quotaReached && <Small>{t("No AI scoring available, so ORION asks a few quick questions instead.")}</Small>}
        {!guessed && s.scoringSource === "manual" && <Small>{duelMode ? t("Comparison based on your answers.") : t("Comparison based on your estimates.")}</Small>}
        {s.scoringSource === "api" && <Small>{t("Comparison based on AI estimates. Refine them if you know more about your situation.")}</Small>}
        {!guessed && !analysis.signal && <Small>{t("Tap the option that comes out ahead on each factor and ORION will rank them.")}</Small>}
      </PageHeader>
      {understood}
      {notice && <Notice tone="warning">{notice}</Notice>}
      {s.scenarioNotice && <Notice tone="info">{s.scenarioNotice}</Notice>}
      {quotaReached && duelMode && (
        <View style={{ gap: spacing.sm }}>
          <Notice tone="info">{t("You have used today's free scored decisions, so ORION is asking its quick questions instead. Everything else works as usual.")}</Notice>
          <AppButton variant="secondary" title={t("See ORION Pro")} iconRight="arrow-forward" onPress={() => router.navigate("/you")} style={{ alignSelf: "flex-start" }} />
        </View>
      )}
      {/* One tree for both widths, so typed estimates survive a window resize. */}
      <View style={split ? { flexDirection: "row", alignItems: "flex-start", gap: 28 } : { gap: spacing.lg }}>
        <View style={[{ gap: spacing.lg }, split && { flex: 1 }]}>
          {quickCall}
          {tooClose}
          {!tooClose && pickForMe}
          {!brief && !guessed && pendingDuel && duelStep && (
            <DuelCard
              key={pendingDuel.id}
              factor={pendingDuel.label}
              options={s.options}
              step={Object.keys(s.duels).length + 1}
              total={Math.min(s.factors.length, 4)}
              onPick={(optionId) => s.duel(pendingDuel.id, optionId)}
              onUndo={Object.keys(s.duels).length > 0 ? s.undoDuel : undefined}
            />
          )}
          {!split && simple && decide}
          {expandButton}
          {/* The full analysis stays mounted while hidden, so what was opened, tapped or typed survives a toggle. */}
          <View style={analysisVisible ? { gap: spacing.lg } : { display: "none" }}>
            {questions}
            {enough}
            {analysis.signal && result}
            {analysis.signal && s.options.length > 1 && s.factors.length > 1 && (
              <WhatMatters
                key={s.decisionId}
                factors={s.factors}
                leaderLabel={analysis.leaderOpt.label}
                tied={tied}
                disabled={s.saving}
                onNudge={s.nudgeWeight}
              />
            )}
            {analysis.signal && s.options.length > 1 && (
              <OptionRanking scored={analysis.scored} labels={Object.fromEntries(s.options.map((o) => [o.id, o.label]))} chosenId={s.committedOptionId} />
            )}
            {/* What happens after you choose: depth, so it lives with the rest of the analysis. */}
            {analysis.signal && (
              <Aftermath
                title={s.extraction.title}
                options={s.options}
                factors={s.factors}
                mode={s.mode}
                stakes={s.extraction.stakes}
                safety={s.safety}
                signal={analysis.signal}
                leaderId={analysis.leaderOpt.id}
                chosenId={s.committedOptionId}
                checkIns={s.saved && !s.privateMode}
                active={analysisVisible}
              />
            )}
            {/* The AI's explanation is asked for here and nowhere earlier: never on render or on a weight change. */}
            {analysis.signal && apiEnabled() && (
              <View style={{ gap: 12 }}>
                <AppButton
                  variant="secondary"
                  icon="chatbubble-outline"
                  style={{ alignSelf: "flex-start" }}
                  title={explaining === explanationKey ? t("Explaining…") : t("Explain the trade-offs")}
                  disabled={explaining === explanationKey || detail?.key === explanationKey}
                  onPress={async () => {
                    const key = explanationKey;
                    setExplaining(key);
                    const result = await fetchExplanation({ options: s.options, factors: s.factors, safety: s.safety, business: businessContext(s.extraction?.category) });
                    setDetail({ key, text: result?.explanation ?? t("More context is unavailable. You can still use the comparison above."), fallback: result?.fallback ?? true });
                    setExplaining((current) => current === key ? null : current);
                  }}
                />
                {detail?.key === explanationKey && (
                  <Card>
                    <Body>{detail.text}</Body>
                    {detail.fallback && <Small>{t("Using the local explanation.")}</Small>}
                  </Card>
                )}
              </View>
            )}
          </View>
          {/* The table is the manual route. It stays mounted while hidden so typed estimates survive. */}
          <View style={guessed || brief || (analysis.signal && !analysisVisible) ? { display: "none" } : { gap: spacing.md }}>
            <AppButton
              variant="ghost"
              icon={fine ? "chevron-up" : "options-outline"}
              title={fine ? t("Hide the estimates table") : analysis.signal ? t("Fine-tune the estimates") : t("Rate every option myself")}
              expanded={fine}
              onPress={() => setFine(!fine)}
              style={{ alignSelf: "flex-start" }}
            />
            <View style={fine ? undefined : { display: "none" }}>
              <OfflineForm key={s.decisionId} options={s.options} factors={s.factors} onDone={s.setManualScores} />
            </View>
          </View>
        </View>
        <View style={[{ gap: spacing.lg }, split && { width: layout.side }, split && sticky]}>
          {(split || !simple) && decide}
          {!guessed && s.decisionId && (
            <Card style={{ gap: spacing.lg }}>
              <FriendsPanel
                decisionId={s.decisionId}
                title={s.extraction.title}
                options={s.options.map((o) => ({ id: o.id, label: o.label }))}
                factors={s.factors.map((f) => ({ id: f.id, label: f.label }))}
                privateMode={s.privateMode}
                ensureSaved={async () => {
                  if (!useSession.getState().saved) await useSession.getState().commit(useSession.getState().committedOptionId);
                  return useSession.getState().saved && !useSession.getState().privateMode;
                }}
                onTally={setFriends}
              />
              <ExportPanel build={report} />
            </Card>
          )}
          {privacy}
        </View>
      </View>
    </Screen>
  );
}
