// A short, looping demo of ORION for the welcome page: a fun question settled in seconds, a big one worked through,
// its aftermath pictured, and the check-in afterwards. Scripted, not live — nothing is sent anywhere.
//
// Steady by design: every block has a fixed slot and only fades in place, so nothing on the page moves while it
// plays, and every scene has the same height. It can be paused (and is still under reduced motion), and each scene
// can be chosen by hand.
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View, type ViewStyle } from "react-native";
import { colors, radius, spacing, type } from "../theme/tokens";
import { Eyebrow, Icon, Small, Text, css, tabular, useReducedMotion, type IconName } from "./ui";
import { FuturesRiver } from "./FuturesChart";
import { demoPicture } from "./AftermathDemo";
import { t } from "../i18n";

interface Scene {
  name: string;
  /** Tab label on narrow screens, where four full names do not fit. */
  short: string;
  caption: string;
  question: string;
  options: string[];
  factors: string[];
  scores: number[];
  /** The middle step: what ORION does between reading and answering. */
  step: { icon: IconName; title: string; body: string; chips?: string[]; pick?: string };
  /** Picture the aftermath (the futures river) in place of the middle step and the scores. */
  aftermath?: boolean;
  /** The payoff card at the bottom. */
  result: { icon: IconName; eyebrow: string; headline: string; line: string; chips?: string[]; pick?: string };
}

// Built when shown, so the scripted words are in the language picked.
const scenes = (): Scene[] => [
  {
    name: t("Quick call"),
    short: t("Quick"),
    caption: t("Small choices get a clear answer in seconds — no interview."),
    question: t("Pizza or tacos tonight?"),
    options: [t("Pizza"), t("Tacos")],
    factors: [t("Craving"), t("Effort"), t("Cost")],
    scores: [3.1, 5.4],
    step: { icon: "flash-outline", title: t("No questions needed"), body: t("It's small and easy to undo, so ORION skips straight to the answer.") },
    result: { icon: "sparkles-outline", eyebrow: t("Quick call"), headline: t("Go with Tacos."), line: t("It wins on craving. Done deciding — enjoy it.") },
  },
  {
    name: t("Big decision"),
    short: t("Big one"),
    caption: t("Big decisions get only the questions that could change the answer."),
    question: t("Take the job in Berlin or stay?"),
    options: [t("Berlin job"), t("Stay")],
    factors: [t("Pay"), t("Growth"), t("Friends"), t("Balance")],
    scores: [4.2, 2.6],
    step: { icon: "help-circle-outline", title: t("Which matters most to you?"), body: "", chips: [t("Pay"), t("Growth"), t("Friends"), t("Balance")], pick: t("Growth") },
    result: { icon: "compass-outline", eyebrow: t("ORION's call"), headline: t("Go with the Berlin job."), line: t("It leads on growth and pay, by more than the estimates' uncertainty.") },
  },
  {
    name: t("Aftermath"),
    short: t("Aftermath"),
    caption: t("Before you commit, it pictures what follows — and what to watch for."),
    question: t("Take the job in Berlin or stay?"),
    options: [t("Berlin job"), t("Stay")],
    factors: [t("Income"), t("Friends"), t("Moving cost"), t("Growth")],
    scores: [4.2, 2.6],
    aftermath: true,
    step: { icon: "git-branch-outline", title: t("Where the futures go"), body: "" },
    result: { icon: "eye-outline", eyebrow: t("Aftermath"), headline: "", line: "" },
  },
  {
    name: t("Follow-up"),
    short: t("Follow-up"),
    caption: t("Then it checks in, so you can see how its calls turn out."),
    question: t("Take the job in Berlin or stay?"),
    options: [t("Berlin job"), t("Stay")],
    factors: [t("Pay"), t("Growth"), t("Friends"), t("Balance")],
    scores: [4.2, 2.6],
    step: { icon: "checkmark-circle-outline", title: t("Decided: Berlin job"), body: t("ORION plans a check-in for next week and again in a month.") },
    result: { icon: "chatbubble-ellipses-outline", eyebrow: t("One week later"), headline: t("How is it going?"), line: "", chips: [t("Great"), t("Good"), t("Neutral"), t("Bad")], pick: t("Good") },
  },
];


const TYPE_MS = 55;
// When each slot appears, in ms after the question is typed.
const AT = { understood: 400, step: 1200, pick: 2100, bars: 2500, result: 3400, resultPick: 4300, end: 7000 };
const length = (s: Scene) => s.question.length * TYPE_MS + AT.end;

const fade = css({ transitionProperty: "opacity, transform", transitionDuration: "450ms", transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" });
const slide = css({ transitionProperty: "width", transitionDuration: "900ms", transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" });
const shown = (on: boolean): ViewStyle => ({ opacity: on ? 1 : 0, transform: [{ translateY: on ? 0 : 4 }] });

export function HowItWorksDemo({ compact = false }: { compact?: boolean }) {
  const reduced = useReducedMotion();
  // Built once per mount: the app remounts when the language changes.
  const [SCENES] = useState(scenes);
  // The Aftermath scene is drawn by the real engine from the home page demo's scripted decision.
  const [PICTURED] = useState(demoPicture);
  const LAST = PICTURED.picture.steps[PICTURED.picture.steps.length - 1];
  const [scene, setScene] = useState(0);
  const [clock, setClock] = useState(0);
  const [paused, setPaused] = useState(false);
  const s = SCENES[scene];
  const still = paused || reduced;
  // Paused, the scene shows finished.
  const time = still ? length(s) : clock;

  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setClock((old) => old + 100), 100);
    return () => clearInterval(timer);
  }, [still]);
  useEffect(() => {
    if (!still && clock >= length(s)) { setScene((n) => (n + 1) % SCENES.length); setClock(0); }
  }, [clock, still, s, SCENES.length]);

  const typed = Math.min(s.question.length, Math.floor(time / TYPE_MS));
  const after = time - s.question.length * TYPE_MS;
  const on = (key: keyof typeof AT) => after >= AT[key];
  const progress = Math.min(1, time / length(s));
  const best = s.scores.indexOf(Math.max(...s.scores));
  const go = (n: number) => { setScene(n); setClock(0); };

  return (
    <View accessibilityLabel={t("Demo of how ORION works")} style={{ gap: compact ? 14 : 18 }}>
      {/* Scene picker: a segmented control, fixed width per segment. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View accessibilityRole="tablist" style={{ flex: 1, flexDirection: "row", padding: 3, borderRadius: radius.pill, backgroundColor: colors.sunken }}>
          {SCENES.map((x, i) => (
            <Pressable key={x.name} accessibilityRole="tab" accessibilityState={{ selected: i === scene }} onPress={() => go(i)}
              style={[{ flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: radius.pill, backgroundColor: i === scene ? colors.frost : "transparent" }, fade]}>
              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: i === scene ? "500" : "400", color: i === scene ? colors.white : colors.muted }}>{compact ? x.short : x.name}</Text>
            </Pressable>
          ))}
        </View>
        {!reduced && (
          <Pressable accessibilityRole="button" accessibilityLabel={paused ? t("Play the demo") : t("Pause the demo")} onPress={() => setPaused(!paused)} hitSlop={8}
            style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.sunken }}>
            <Icon name={paused ? "play" : "pause"} size={13} color={colors.body} />
          </Pressable>
        )}
      </View>
      <View style={{ height: 2, borderRadius: 1, backgroundColor: colors.sunken, overflow: "hidden" }}>
        <View style={{ width: `${progress * 100}%`, height: 2, backgroundColor: colors.accentBright }} />
      </View>

      <Text numberOfLines={2} style={{ height: compact ? 40 : 44, fontSize: compact ? 14 : 15, lineHeight: compact ? 20 : 22, color: colors.body }}>{s.caption}</Text>

      {/* 1. The question, being typed. */}
      <View style={{ height: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingLeft: 16, paddingRight: 8, borderRadius: radius.md, backgroundColor: colors.frost, borderWidth: 1, borderColor: colors.lineStrong }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: colors.white }}>
          {s.question.slice(0, typed)}
          <Text style={{ color: typed < s.question.length ? colors.accentBright : "transparent" }}>|</Text>
        </Text>
        <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent }}>
          <Icon name="arrow-forward" size={15} color={colors.white} />
        </View>
      </View>

      {/* 2. What ORION read: options, then what matters. */}
      <View style={[{ height: 52, gap: 8 }, shown(on("understood")), fade]}>
        <Eyebrow>{t("ORION understood")}</Eyebrow>
        <View style={{ flexDirection: "row", gap: 6, overflow: "hidden" }}>
          {s.options.map((o) => <Pill key={o} label={o} strong />)}
          <View style={{ width: 1, marginHorizontal: 2, backgroundColor: colors.line }} />
          {s.factors.map((f) => <Pill key={f} label={f} />)}
        </View>
      </View>

      {s.aftermath ? (
        // 3–4. The futures river fills the middle step's and the scores' slots, so the scene keeps its height.
        <View style={[{ height: compact ? 98 : 98 + 18 + 76 }, shown(on("step")), fade]}>
          {on("step") && <FuturesRiver steps={PICTURED.picture.steps} height={compact ? 98 : 192} caption={false} />}
        </View>
      ) : (
        <>
          {/* 3. The middle step. */}
          <Panel style={[shown(on("step")), fade]}>
            <Row icon={s.step.icon} title={s.step.title} />
            {s.step.chips ? (
              <View style={{ flexDirection: "row", gap: 6 }}>
                {s.step.chips.map((c) => <Pill key={c} label={c} strong={on("pick") && c === s.step.pick} />)}
              </View>
            ) : <Line lines={2}>{s.step.body}</Line>}
          </Panel>

          {/* 4. The scores. */}
          {!compact && (
            <View style={[{ height: 76, gap: 10 }, shown(on("bars")), fade]}>
              {s.options.map((o, i) => (
                <View key={o} style={{ gap: 5 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Small style={{ color: colors.body }}>{o}</Small>
                    <Text style={[{ fontSize: 13, color: i === best ? colors.white : colors.muted }, tabular]}>{s.scores[i].toFixed(1)}</Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.sunken, overflow: "hidden" }}>
                    <View style={[{ width: on("bars") ? `${s.scores[i] * 10}%` : "0%", height: 5, borderRadius: 3, backgroundColor: i === best ? colors.accent : colors.lineStrong }, slide]} />
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* 5. The payoff. */}
      <Panel accent style={[shown(on("result")), fade, { height: 122 }]}>
        <Row icon={s.result.icon} title={s.result.eyebrow} eyebrow />
        <Text numberOfLines={1} style={{ fontSize: compact ? 20 : 22, fontWeight: "300", color: colors.white }}>
          {s.aftermath ? t("{pct}% chance it's going well by {when}.", { pct: Math.round(LAST.odds.well * 100), when: LAST.when.toLowerCase() }) : s.result.headline}
        </Text>
        {s.aftermath ? <Line lines={2} color={colors.ink}>{t("Watch for: {sign}", { sign: PICTURED.picture.steps[0].sign })}</Line> : s.result.chips ? (
          <View style={{ flexDirection: "row", gap: 6 }}>
            {s.result.chips.map((c) => <Pill key={c} label={c} strong={on("resultPick") && c === s.result.pick} />)}
          </View>
        ) : <Line lines={1} color={colors.ink}>{s.result.line}</Line>}
      </Panel>

      <Text style={{ fontSize: type.metadata, color: colors.faint }}>{t("A scripted example. Your own questions get their own answers.")}</Text>
    </View>
  );
}

function Line({ children, lines, color = colors.muted }: { children: ReactNode; lines: number; color?: string }) {
  return <Text numberOfLines={lines} style={{ fontSize: 13, lineHeight: 19, fontWeight: "300", color }}>{children}</Text>;
}

function Panel({ children, style, accent }: { children: ReactNode; style?: object; accent?: boolean }) {
  return (
    <View style={[{
      height: 98, gap: 8, paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.md, borderWidth: 1,
      backgroundColor: accent ? colors.accentSoft : colors.glass, borderColor: accent ? colors.accentLine : colors.line,
    }, style]}>
      {children}
    </View>
  );
}

function Row({ icon, title, eyebrow }: { icon: IconName; title: string; eyebrow?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={icon} size={15} color={eyebrow ? colors.white : colors.accentBright} />
      {eyebrow ? <Eyebrow color={colors.white}>{title}</Eyebrow> : <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: "500", color: colors.white }}>{title}</Text>}
    </View>
  );
}

function Pill({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <View style={[{ paddingHorizontal: 10, height: 26, justifyContent: "center", borderRadius: radius.sm, borderWidth: 1, backgroundColor: strong ? colors.accentSoft : colors.frost, borderColor: strong ? colors.accentLine : "transparent" }, fade]}>
      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.white }}>{label}</Text>
    </View>
  );
}
