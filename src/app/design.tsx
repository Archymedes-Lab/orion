// Living style guide: every token and primitive the app uses, rendered from the same source.
import { Illustration } from "../components/illustrations";
import { useState } from "react";
import { View } from "react-native";
import { DuelCard } from "../components/DuelCard";
import { Gate } from "../components/Gate";
import { OptionRanking } from "../components/OptionRanking";
import { ChoiceCheck } from "../components/ChoiceCheck";
import { ProbabilityBar } from "../components/ProbabilityBar";
import {
  AppButton, ArrowButton, Body, Card, CheckRow, Chip, ConfirmButton, Disclosure, EmptyState, IconButton, LabeledField, Eyebrow, Field, Notice, PageHeader, Reveal, Screen, SectionTitle,
  Skeleton, Small, Stat, Tag, Text, Title, Wordmark, ease, useLayout,
} from "../components/ui";
import { colors, elevation, motion, radius, spacing, tracking, type } from "../theme/tokens";
import { HomeBento } from "../components/HomeBento";
import { msg, t } from "../i18n";

const SWATCHES: [string, string, string][] = [
  ["accent", colors.accent, msg("The one signal colour: send, primary action, active dot.")],
  ["accentBright", colors.accentBright, msg("Blue as text or a bar on glass.")],
  ["ink", colors.ink, msg("Titles and figures.")],
  ["body", colors.body, msg("Running text.")],
  ["muted", colors.muted, msg("Supporting text, labels.")],
  ["success", colors.success, msg("Positive impact, saved.")],
  ["warning", colors.warning, msg("Medium stability, caution.")],
  ["danger", colors.danger, msg("Negative impact, errors.")],
];
const SURFACES: [string, string][] = [
  ["glass", colors.glass], ["glassStrong", colors.glassStrong], ["frost", colors.frost], ["sunken", colors.sunken], ["line", colors.line],
];
const TYPE: [string, number, string, string][] = [
  ["hero", type.hero, "200", msg("Clear questions.")],
  ["pageTitle", type.pageTitle, "200", msg("History")],
  ["display", type.display, "200", msg("A clearer you")],
  ["screenTitle", type.screenTitle, "300", msg("Take the job in Berlin")],
  ["section", type.section, "500", msg("Why it leads")],
  ["body", type.body, "300", msg("Higher expected cost, time.")],
  ["supporting", type.supporting, "300", msg("Patterns across the decisions saved here.")],
  ["metadata", type.metadata, "500", msg("QUESTION 1 OF 4")],
];

function Section({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.md }}>
      <View style={{ gap: spacing.xs }}>
        <Eyebrow color={colors.accentBright}>{title}</Eyebrow>
        <Small>{note}</Small>
      </View>
      {children}
    </View>
  );
}

export default function DesignRoute() {
  return <Gate><DesignScreen /></Gate>;
}

function DesignScreen() {
  const { split } = useLayout();
  const [checked, setChecked] = useState(true);
  const [chip, setChip] = useState("cost");
  const [demo, setDemo] = useState(0);
  const row = { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md } as const;
  /** A row of cards: equal heights. */
  const grid = { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: spacing.md } as const;

  return (
    <Screen title={t("Design system")}>
      <PageHeader eyebrow={t("Design system")} title={t("ORION, in parts")}>
        <Small>{t("Dusk sky, frosted glass, thin geometric type and a single electric blue. Taken from the Archymedes posters.")}</Small>
      </PageHeader>

      <Section title={t("Principles")} note={t("Rules every screen follows.")}>
        <View style={grid}>
          {[
            [t("One signal"), t("Blue marks the next step and nothing else.")],
            [t("Glass over sky"), t("Panels are frosted and thinly bordered, never opaque.")],
            [t("Light type"), t("Weights 200–300 for display, 500 only for emphasis.")],
            [t("Quiet motion"), t("Fast, eased, and off for anyone who asks.")],
          ].map(([name, text]) => (
            <Card key={name} style={{ flexGrow: 1, flexBasis: 220, gap: spacing.xs }}>
              <SectionTitle>{name}</SectionTitle>
              <Small>{text}</Small>
            </Card>
          ))}
        </View>
      </Section>

      <Section title={t("Colour")} note={t("Tokens in src/theme/tokens.ts. Text always carries meaning; colour only supports it.")}>
        <View style={grid}>
          {SWATCHES.map(([name, value, use]) => (
            <Card key={name} style={{ flexGrow: 1, flexBasis: 240, flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: value, borderWidth: 1, borderColor: colors.line }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "500", color: colors.ink }}>{name}</Text>
                <Small>{t(use)}</Small>
              </View>
            </Card>
          ))}
        </View>
        <View style={row}>
          {SURFACES.map(([name, value]) => (
            <View key={name} style={{ alignItems: "center", gap: 6 }}>
              <View style={{ width: 96, height: 56, borderRadius: radius.md, backgroundColor: value, borderWidth: 1, borderColor: colors.line }} />
              <Small style={{ fontSize: 12 }}>{name}</Small>
            </View>
          ))}
        </View>
      </Section>

      <Section title={t("Typography")} note={t("Outfit on web. Display and titles are light; labels are tracked capitals.")}>
        <Card>
          {TYPE.map(([name, size, weight, sample]) => (
            <View key={name} style={{ flexDirection: "row", alignItems: "baseline", gap: spacing.md, flexWrap: "wrap" }}>
              <Text style={{ width: 110, fontSize: 12, color: colors.faint }}>{`${name} · ${size}`}</Text>
              <Text style={{ fontSize: size, fontWeight: weight as "200", color: colors.white, letterSpacing: name === "metadata" ? 2.4 : tracking(size) }}>{t(sample)}</Text>
            </View>
          ))}
          <View style={{ paddingTop: spacing.sm }}><Wordmark size={34} /></View>
        </Card>
      </Section>

      <Section title={t("Space, radius, elevation, motion")} note={t("One scale each, so nothing is a one-off number.")}>
        <View style={grid}>
          <Card style={{ flexGrow: 1, flexBasis: 260 }}>
            <Eyebrow>{t("Spacing")}</Eyebrow>
            {Object.entries(spacing).map(([name, value]) => (
              <View key={name} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Text style={{ width: 40, fontSize: 12, color: colors.faint }}>{name}</Text>
                <View style={{ width: value, height: 8, borderRadius: 4, backgroundColor: colors.accentBright }} />
                <Small style={{ fontSize: 12 }}>{value}</Small>
              </View>
            ))}
          </Card>
          <Card style={{ flexGrow: 1, flexBasis: 260 }}>
            <Eyebrow>{t("Radius")}</Eyebrow>
            <View style={{ flexDirection: "row", gap: spacing.md, flexWrap: "wrap" }}>
              {Object.entries(radius).map(([name, value]) => (
                <View key={name} style={{ alignItems: "center", gap: 6 }}>
                  <View style={{ width: 56, height: 56, borderRadius: Math.min(value, 28), borderWidth: 1.5, borderColor: colors.accentLine, backgroundColor: colors.accentSoft }} />
                  <Small style={{ fontSize: 12 }}>{name}</Small>
                </View>
              ))}
            </View>
          </Card>
          <Card style={{ flexGrow: 1, flexBasis: 260 }}>
            <Eyebrow>{t("Motion")}</Eyebrow>
            <Small>{`fast ${motion.fast}ms · base ${motion.base}ms · slow ${motion.slow}ms · stagger ${motion.stagger}ms`}</Small>
            <Reveal key={demo}>
              <View style={[{ height: 56, borderRadius: radius.md, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine, alignItems: "center", justifyContent: "center" }, ease]}>
                <Text style={{ color: colors.white }}>{t("Reveal")}</Text>
              </View>
            </Reveal>
            <AppButton variant="secondary" icon="refresh" title={t("Replay")} onPress={() => setDemo(demo + 1)} style={{ alignSelf: "flex-start" }} />
          </Card>
        </View>
        <Small>{t("Elevation — rest: {value}", { value: elevation.rest })}</Small>
      </Section>

      <Section title={t("Actions")} note={t("Primary is the only filled-blue button on a screen. Everything else is glass or ghost.")}>
        <View style={row}>
          <AppButton title={t("Primary")} iconRight="arrow-forward" onPress={() => {}} />
          <AppButton variant="secondary" title={t("Secondary")} onPress={() => {}} />
          <AppButton variant="ghost" icon="refresh" title={t("Ghost")} onPress={() => {}} />
          <AppButton title={t("Disabled")} disabled onPress={() => {}} />
          <ArrowButton accessibilityLabel={t("Send")} onPress={() => {}} />
        </View>
        <View style={row}>
          <IconButton icon="arrow-forward" tone="accent" accessibilityLabel={t("Open")} onPress={() => {}} />
          <IconButton icon="trash-outline" accessibilityLabel={t("Delete")} onPress={() => {}} />
          <ConfirmButton title={t("Erase everything")} confirmTitle={t("Erase all data?")} onConfirm={() => {}} />
          <ConfirmButton compact title={t("Delete")} confirmTitle={t("Delete?")} onConfirm={() => {}} />
          <AppButton variant="danger" icon="alert-circle-outline" title={t("Danger (confirm step)")} onPress={() => {}} />
        </View>
        <Small>{t("Anything that cannot be undone uses ConfirmButton: one press arms it, a second confirms, and it disarms after four seconds.")}</Small>
        <View style={row}>
          {([["cost", msg("Cost")], ["time", msg("Time")], ["energy", msg("Energy")]] as const).map(([id, label]) => <Chip key={id} label={t(label)} selected={chip === id} onPress={() => setChip(id)} />)}
          <Chip quiet label={t("Skip →")} onPress={() => {}} />
          <CheckRow checked={checked} onPress={() => setChecked(!checked)} icon="lock-closed-outline" label={t("Private mode")} />
        </View>
      </Section>

      <Section title={t("Feedback & form")} note={t("Status is written out; colour and icon are secondary.")}>
        <View style={row}>
          <Tag label={t("decided")} tone="success" /><Tag label={t("open")} tone="info" /><Tag label={t("medium")} tone="warning" /><Tag label={t("low")} tone="danger" /><Tag label={t("tiny stakes")} />
        </View>
        <View style={{ gap: spacing.sm }}>
          <Notice tone="success">{t("You probably know enough.")}</Notice>
          <Notice tone="warning">{t("This looks like a health decision. ORION can help you think, not advise.")}</Notice>
          <Notice tone="danger" alert>{t("Could not save: storage is full.")}</Notice>
        </View>
        <Field placeholder={t("Add context, e.g. I prefer walking when I have time.")} accessibilityLabel={t("Example field")} />
        <View style={grid}>
          <View style={{ flexGrow: 1, flexBasis: 260 }}><LabeledField label={t("Email")} placeholder="name@example.com" hint={t("LabeledField: label above, hint below.")} /></View>
          <View style={{ flexGrow: 1, flexBasis: 260 }}><LabeledField label={t("Password")} secureTextEntry error={t("Use at least 10 characters. A few unrelated words work well.")} /></View>
        </View>
      </Section>

      <Section title={t("Progressive disclosure")} note={t("The default screen answers the question; the working goes behind a Disclosure. Summaries are the question someone has, never the name of a technique.")}>
        <Card>
          <Disclosure summary={t("See the reasoning")} hint={t("The score, how sure ORION is, and what would change the answer.")} tone="accent">
            <Body>{t("Opened, a disclosure holds the detail: numbers, per-factor arithmetic, the model’s own vocabulary.")}</Body>
          </Disclosure>
          <Disclosure summary={t("What would tell you it is going wrong")} hint={t("Signs worth checking before they become expensive.")}>
            <Small>{t("A quiet disclosure. Use `accent` only for the one a screen most wants opened.")}</Small>
          </Disclosure>
        </Card>
      </Section>

      <Section title={t("Data")} note={t("Figures are tabular; bars always print their value.")}>
        <View style={grid}>
          <Stat label={t("Decisions saved")} value={12} />
          <Stat label={t("Outcomes recorded")} value={7} />
        </View>
        <Card>
          <ProbabilityBar label={t("Confidence")} value={0.7} display="7/10" />
          <ProbabilityBar label={t("Reversibility")} value={0.6} display="6/10" />
        </Card>
        <OptionRanking
          labels={{ a: t("Take the bus"), b: t("Call a taxi"), c: t("Walk") }}
          chosenId="a"
          scored={[
            { optionId: "a", jev: 3.2, confidence: 0.7, uncertaintyWidth: 3, low: 1.7, high: 4.7 },
            { optionId: "b", jev: 0.8, confidence: 0.5, uncertaintyWidth: 5, low: -1.7, high: 3.3 },
            { optionId: "c", jev: -1.4, confidence: 0.6, uncertaintyWidth: 4, low: -3.4, high: 0.6 },
          ]}
        />
      </Section>

      <Section title={t("Flow")} note={t("The decision interview: one factor, one tap. JEV picks the order and when to stop.")}>
        <View style={split ? { maxWidth: 780 } : undefined}>
          <DuelCard factor={t("Cost")} options={[{ id: "a", label: t("Take the bus") }, { id: "b", label: t("Call a taxi") }]} step={1} total={3} onPick={() => {}} />
        </View>
      </Section>

      <Section title={t("Choosing against the comparison")} note={t("No scolding: the price, what would make it the better choice, and a question. Toss-ups get one quiet line.")}>
        <View style={split ? { maxWidth: 520 } : undefined}>
          <ChoiceCheck
            chosenLabel={t("Stay at my current company")}
            leaderLabel={t("Take the job in Berlin")}
            reason={null}
            onReason={() => {}}
            assessment={{ level: "strongly_against", chosenId: "b", leaderId: "a", tied: false, gap: 2.8, certainty: 1.5, dominated: false, implied: { factorId: "c", label: t("Comfort"), from: 0.2, to: 0.395 } }}
          />
        </View>
      </Section>

      <Section title={t("Illustrations")} note={t("Spot art in the poster language: deep space, a lit planet limb, hairline drawing, one blue star. Empty states pick theirs from the icon.")}>
        <View style={grid}>
          {(["history", "insights", "search", "lost", "link", "ask", "weigh", "decide"] as const).map((n) => (
            <View key={n} style={{ gap: spacing.xs }}>
              <Illustration name={n} width={220} />
              <Small>{n}</Small>
            </View>
          ))}
        </View>
      </Section>

      <Section title={t("Loading & empty")} note={t("Skeletons keep the page shape while content arrives; empty states say what to do next.")}>
        <View style={grid}>
          <Card style={{ flexGrow: 1, flexBasis: 280 }}>
            <Skeleton width="50%" height={26} radius={10} />
            <Skeleton height={14} />
            <Skeleton width="80%" height={14} />
          </Card>
          <View style={{ flexGrow: 1, flexBasis: 280 }}>
            <EmptyState icon="time-outline" title={t("No decisions yet")}>{t("Decisions you save show up here.")}</EmptyState>
          </View>
        </View>
      </Section>

      <Section title={t("Depth & surface")} note={t("Glass cards light their edge under the cursor (web; off on touch). Film grain sits over every page. The sky drifts at a third of the scroll speed and dims to dusk under content; the top bar turns solid once content passes beneath it.")}>
        <View style={grid}>
          <Card style={{ flexGrow: 1, flexBasis: 280, minHeight: 140 }}><SectionTitle>{t("Hover me")}</SectionTitle><Small>{t("Any Card gets the lit edge. Mark other glass with the `spot` props from ui.tsx.")}</Small></Card>
          <Card onPress={() => {}} style={{ flexGrow: 1, flexBasis: 280, minHeight: 140 }}><SectionTitle>{t("Pressable card")}</SectionTitle><Small>{t("Lifts on hover, sinks on press, plus the lit edge.")}</Small></Card>
        </View>
      </Section>

      <Section title={t("Editorial sections")} note={t("Home's bento: tiles of different sizes, each showing a real piece of the product. Headlines use the hero size with tightened tracking. Every page ends with the site footer.")}>
        <HomeBento />
        <Title size={type.section}>{t("That is the whole kit.")}</Title>
        <Body>{t("Add a primitive to src/components/ui.tsx and show it here in the same change.")}</Body>
      </Section>
    </Screen>
  );
}
