// Home (§3): the launch poster's opening screen, laid out for a wide window.
//
// The first screen has one job: get the person to describe their decision. So the fold holds the wordmark,
// one question, one input and one named button, and nothing else competes with it. The things that used to
// sit here — how ORION works, what it is good at — are still reachable, a line lower, behind a disclosure.
// Nothing was deleted; it was ordered.
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Platform, Pressable, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useRouter } from "expo-router";
import { profileSummary, useBusiness } from "../business/profile";
import { colors, elevation, layout, radius, spacing } from "../theme/tokens";
import { DecisionInput } from "./DecisionInput";
import { Illustration, type IllustrationName } from "./illustrations";
import type { SavedDecision } from "../db/decisions";
import { AppButton, Card, Chip, Disclosure, Eyebrow, Icon, Reveal, Small, Text, Wordmark, blur, ease, useLayout, type IconName } from "./ui";
import { areaLabel, examplePool, shuffleExamples } from "./examples";
import { msg, t } from "../i18n";

const AREAS: [string, IconName][] = [
  ["Career", "briefcase"],
  ["Money", "stats-chart"],
  ["Relationships", "people"],
  ["Everyday", "sunny"],
  ["More", "ellipsis-horizontal"],
];
const BUSINESS_AREAS: [string, IconName][] = [
  ["Team", "people"],
  ["Pricing", "pricetag"],
  ["Growth", "trending-up"],
  ["Finance", "cash"],
  ["Operations", "construct"],
  ["More", "ellipsis-horizontal"],
];
const STEPS: [string, string][] = [
  [msg("Ask in your own words"), msg("A choice you are stuck on, big or small. Vague is fine: “not sure what to do about my job” works.")],
  [msg("ORION lays it out"), msg("It names the options and what matters, then scores each option on each. You can correct anything it got wrong.")],
  [msg("You see why, then you decide"), msg("Which option comes out ahead, what drives that, and what would change it. The choice stays yours.")],
];
const STEP_ART: IllustrationName[] = ["ask", "weigh", "decide"];
const caps = { fontSize: 12, fontWeight: "400" as const, textTransform: "uppercase" as const, color: colors.white };

export function Home({ onSubmit, privacy, draft = "", open = [], onResume, returning = false, checkIns, templates }: {
  onSubmit: (text: string) => void;
  privacy: ReactNode;
  /** Question to put back in the input for rewording. */
  draft?: string;
  /** Saved decisions that have no choice yet. */
  open?: SavedDecision[];
  onResume?: (id: string) => void;
  /** The person has made a decision here before: the how-it-works steps start collapsed. */
  returning?: boolean;
  /** Due check-ins, shown first: ORION following up. */
  checkIns?: ReactElement | null;
  /** The template picker. */
  templates?: ReactElement | null;
}) {
  const { shell } = useLayout();
  const { height } = useWindowDimensions();
  const [area, setArea] = useState<string | null>(null);
  const router = useRouter();
  const { lens, profile, setLens } = useBusiness();
  const business = lens === "business";
  const summary = profileSummary(profile);
  // Shuffled after the first render, not during it, so the static web export and the browser agree.
  const [shuffle, setShuffle] = useState(0);
  // Korean visitors get Korean examples, written for Korean life rather than translated.
  const pool = examplePool(business);
  const cards = useMemo(() => (shuffle === 0 ? pool : shuffleExamples(pool)), [pool, shuffle]);
  useEffect(() => { setShuffle(1); }, []);
  const areas = business ? BUSINESS_AREAS : AREAS;
  const shown = area === null ? cards.slice(0, 3) : area === "More" ? cards : cards.filter((c) => c.areas.includes(area));
  // The tagline floats in the sky; the input lands just under the horizon, 60% down the backdrop.
  // On phones the tab bar (about 64px) shortens the backdrop and there is no top bar above the page.
  const sky = Math.max(200, (shell ? height : height - 64) * 0.605 + 30 - (shell ? layout.nav : 0) - spacing.xl * 2);

  const steps = (
    <View accessibilityLabel={t("How ORION works")} style={{ width: "100%", flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
      {STEPS.map(([name, text], i) => (
        <Card key={name} style={{ flexGrow: 1, flexBasis: 220, gap: spacing.sm, padding: 18 }}>
          <View style={{ alignItems: "center", marginBottom: spacing.xs }}><Illustration name={STEP_ART[i]} width={240} /></View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accentLine }}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: colors.white }}>{i + 1}</Text>
            </View>
            <Text style={{ flex: 1, fontSize: 16, fontWeight: "500", color: colors.white }}>{t(name)}</Text>
          </View>
          <Small>{t(text)}</Small>
        </Card>
      ))}
    </View>
  );

  return (
    <View style={{ alignItems: "center", gap: spacing.xl }}>
      <Reveal style={{ alignSelf: "stretch" }}>
      <View style={{ height: sky, alignSelf: "stretch", alignItems: "center", justifyContent: "center", gap: spacing.lg }}>
        {!shell && <Wordmark size={34} />}
        <Text style={[caps, { letterSpacing: 5, color: colors.body, textAlign: "center" }]}>{t("Make better decisions. Live a better life.")}</Text>
        <Text
          accessibilityRole="header"
          style={{
            fontSize: shell ? 50 : 30, lineHeight: shell ? 64 : 40, fontWeight: "200", letterSpacing: 0.6, textAlign: "center", color: colors.white,
            textShadowColor: "rgba(18,32,58,0.35)", textShadowRadius: 22,
          }}
        >
          {t("What’s on your mind?")}
        </Text>
        <Text style={{ fontSize: shell ? 17 : 15, lineHeight: 25, fontWeight: "300", textAlign: "center", color: colors.body, maxWidth: 520 }}>
          {t("Describe a decision, problem or situation you want help thinking through.")}
        </Text>
      </View>
      </Reveal>

      <Reveal index={2} style={{ width: "100%", alignItems: "center" }}>
      <View style={{ width: "100%", maxWidth: 780, gap: spacing.md }}>
        {/* Who the decision is for. Business mode sends the company profile and ORION's business playbook with it. */}
        <View accessibilityRole="radiogroup" accessibilityLabel={t("Who is this decision for?")} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <Chip label={t("For me")} icon="person-outline" selected={!business} onPress={() => { setArea(null); void setLens("personal"); }} />
          <Chip label={t("For a business")} icon="business-outline" selected={business} onPress={() => { setArea(null); void setLens("business"); }} />
        </View>
        <DecisionInput key={`${draft}|${lens}`} initial={draft} onSubmit={onSubmit} placeholder={business ? t("Build or buy our booking system? Or describe the situation…") : t("Stay in my job or take the offer? Or describe what’s going on…")} />
        {/* Both ways in, said up front: name the options, or describe the situation and ORION finds them. */}
        <Text style={{ fontSize: 14, lineHeight: 21, fontWeight: "300", textAlign: "center", color: colors.body }}>
          {business
            ? t("Name the options (“build or buy?”) or just describe the situation. If you don’t name any, ORION suggests them.")
            : t("Name your options (“stay or move?”) or just describe what’s going on. If you don’t name any, ORION suggests them.")}
        </Text>
        {business && (
          <Text style={{ fontSize: 14, lineHeight: 21, fontWeight: "300", textAlign: "center", color: colors.body }}>
            {summary ? `${t("Weighing it for {company}.", { company: summary })} ` : `${t("Tell ORION about the company (stage, team, runway, appetite for risk) and options are scored for its situation.")} `}
            <Text onPress={() => router.push("/you")} style={{ fontSize: 14, color: colors.accentBright, textDecorationLine: "underline" }}>{summary ? t("Edit company") : t("Add company details")}</Text>
          </Text>
        )}
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
          {areas.map(([name, icon]) => (
            <Chip key={name} label={areaLabel(name)} icon={icon} selected={area === name} onPress={() => setArea(area === name ? null : name)} />
          ))}
        </View>
        <View style={{ alignItems: "center" }}>{privacy}</View>
      </View>
      </Reveal>

      {checkIns && <Reveal index={3} style={{ width: "100%", alignItems: "center" }}>{checkIns}</Reveal>}

      <View style={{ width: "100%", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.md }}>
        {shown.map((c, i) => (
          <Reveal key={c.question} index={3 + i} style={{ flexGrow: 1, flexBasis: 280, maxWidth: 360 }}>
          <Pressable
            onPress={() => onSubmit(c.question)}
            accessibilityRole="button"
            accessibilityLabel={t("Try this example: {question}", { question: c.question })}
            style={(state) => [
              {
                gap: 10, padding: 16, borderRadius: radius.lg, borderWidth: 1,
                borderColor: (state as { hovered?: boolean }).hovered || state.pressed ? "rgba(255,255,255,0.55)" : colors.lineStrong,
                backgroundColor: (state as { hovered?: boolean }).hovered ? colors.glassStrong : colors.glass,
                ...(Platform.OS === "web" && (state as { hovered?: boolean }).hovered ? { transform: "translateY(-3px)", boxShadow: elevation.raised } : {}),
              } as ViewStyle,
              blur,
              ease,
            ]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Icon name={c.icon} size={24} color={colors.white} />
              <Text style={{ flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "400", color: colors.white }}>{c.question}</Text>
              <Icon name="arrow-forward" size={17} color={colors.accentBright} />
            </View>
            {/* What pressing it would do: compare the options it names, or suggest some when it names none. */}
            <Small style={{ paddingLeft: 38 }}>
              <Text style={{ fontSize: 13, color: c.named ? colors.muted : colors.accentBright }}>{c.named ? t("Compares ") : t("ORION suggests ")}</Text>
              {c.options.join(" · ")}
            </Small>
          </Pressable>
          </Reveal>
        ))}
      </View>
      <AppButton variant="ghost" icon="shuffle-outline" title={t("Show other examples")} onPress={() => { setArea(null); setShuffle(shuffle + 1); }} />

      {open.length > 0 && onResume && (
        <Reveal index={3} style={{ width: "100%", alignItems: "center" }}>
          <View style={{ width: "100%", maxWidth: 780, gap: spacing.sm }}>
            <Eyebrow color={colors.body}>{t("Still open")}</Eyebrow>
            {open.slice(0, 3).map((d) => (
              <Card key={d.id} onPress={() => onResume(d.id)} accessibilityLabel={t("Continue deciding: {title}", { title: d.title })} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: spacing.md }}>
                <Icon name="time-outline" size={20} color={colors.white} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: "400", color: colors.white }}>{d.title}</Text>
                  <Small>{t("{category} · not decided yet", { category: areaLabel(d.category) })}</Small>
                </View>
                <Text style={{ fontSize: 14, fontWeight: "400", color: colors.accentBright }}>{t("Continue")}</Text>
                <Icon name="arrow-forward" size={16} color={colors.accentBright} />
              </Card>
            ))}
          </View>
        </Reveal>
      )}

      {templates && <View style={{ width: "100%", alignItems: "center" }}>{templates}</View>}

      {/* Everything explanatory, one line down. Open on a first visit, closed once they have decided here. */}
      <View style={{ width: "100%", maxWidth: 780 }}>
        <Disclosure summary={t("How ORION works")} hint={t("Three steps, about two minutes.")} defaultOpen={!returning}>
          {steps}
        </Disclosure>
      </View>

      <Text style={[caps, { letterSpacing: 5, color: colors.faint }]}>Archymedes</Text>
    </View>
  );
}
