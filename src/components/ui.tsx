// Shared presentational primitives in the ORION brand language. No decision logic lives here.
import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  useWindowDimensions,
  type PressableStateCallbackType,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, elevation, layout, motion, radius, spacing, tracking, type } from "../theme/tokens";
import { getLocale, t } from "../i18n";
import { useScrolled } from "./scroll";
import { SiteFooter } from "./SiteFooter";
// AccountMenu builds on the primitives below; it is only used at render time, so the cycle is harmless.
import { AccountMenu } from "./AccountMenu";
import { LanguageSwitch } from "./LanguageSwitch";
import { Backdrop, type Scene } from "./brand";
import { Illustration, type IllustrationName } from "./illustrations";

export type IconName = ComponentProps<typeof Ionicons>["name"];
type PressState = PressableStateCallbackType & { hovered?: boolean };

const web = Platform.OS === "web";
/** Web-only styles React Native's types do not know about. */
export const css = (style: Record<string, string | number>) => (web ? style : {}) as ViewStyle;

/** Outfit is loaded by theme/webFont on web and by expo-font on native. */
export const sans = web ? 'Outfit, "Noto Sans KR", "Segoe UI", system-ui, -apple-system, sans-serif' : undefined;
export const tabular: TextStyle = { fontVariant: ["tabular-nums"] };
export const noOutline = css({ outlineStyle: "none" }) as TextStyle;
export const focusRing = css({ boxShadow: `0 0 0 3px ${colors.accentSoft}` });
export const blur = css({ backdropFilter: "blur(22px)" });
export const ease = css({
  transitionProperty: "background-color, border-color, transform, box-shadow, opacity",
  transitionDuration: `${motion.fast}ms`,
  transitionTimingFunction: motion.easing,
});
/** Tactile press: buttons sink a little under the pointer. */
export const sink = (pressed: boolean) => (pressed ? css({ transform: "scale(0.97)" }) : null);

/** True when the person asked the system for less motion; entrances then just appear. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduced(v)).catch(() => {});
    return () => { live = false; };
  }, []);
  return reduced;
}

/** Fades and lifts its children into place. `index` staggers siblings; changing `replay` plays it again without remounting. */
export function Reveal({ children, index = 0, style, replay }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle>; replay?: number }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { progress.setValue(1); return; }
    progress.setValue(0);
    const run = Animated.timing(progress, { toValue: 1, duration: motion.slow, delay: index * motion.stagger, easing: (t) => 1 - Math.pow(1 - t, 4), useNativeDriver: !web });
    run.start();
    return () => run.stop();
  }, [index, progress, reduced, replay]);
  return (
    <Animated.View style={[{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [motion.rise, 0] }) }] }, style]}>
      {children}
    </Animated.View>
  );
}

/** Placeholder block that pulses while content loads. */
export function Skeleton({ width = "100%", height = 16, radius: r = radius.sm, style }: { width?: number | `${number}%`; height?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: !web }),
      Animated.timing(pulse, { toValue: 0.5, duration: 900, useNativeDriver: !web }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no" style={[{ width, height, borderRadius: r, backgroundColor: colors.frost, opacity: pulse }, style]} />;
}
/** Keeps a side panel in view while the main column scrolls (web only). */
export const sticky = css({ position: "sticky", top: layout.nav + spacing.lg });

export function useLayout() {
  const { width } = useWindowDimensions();
  return { tablet: width >= layout.tablet, shell: width >= layout.shell, split: width >= layout.split };
}
export const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Text in the brand face. Use this instead of React Native's Text. */
// Native builds load each Outfit weight as its own family (see app/_layout), so a weight picks a family there.
const NATIVE_FACES: Record<string, string> = { "100": "Outfit_200ExtraLight", "200": "Outfit_200ExtraLight", "300": "Outfit_300Light", "400": "Outfit_400Regular", "500": "Outfit_500Medium", "600": "Outfit_600SemiBold", "700": "Outfit_600SemiBold", bold: "Outfit_600SemiBold" };
// Outfit has no Hangul. In Korean, native text keeps the system face (Apple SD Gothic Neo, Noto Sans CJK), which has
// every weight, rather than mixing Outfit Latin with fallback Hangul. Screens remount when the language changes.
export function Text({ style, ...props }: TextProps) {
  if (web) return <RNText {...props} style={[{ fontFamily: sans, color: colors.body }, style]} />;
  if (getLocale() === "ko") return <RNText {...props} style={[{ color: colors.body }, style]} />;
  const weight = String(StyleSheet.flatten(style)?.fontWeight ?? "400");
  return <RNText {...props} style={[{ color: colors.body }, style, { fontFamily: NATIVE_FACES[weight] ?? "Outfit_400Regular", fontWeight: undefined }]} />;
}

export { Backdrop, Glass, Star, Wordmark } from "./brand";

/** Marks a View for the cursor-lit glass edge (global CSS in theme/webFont). */
export const spot = (web ? { dataSet: { spot: "1" } } : {}) as object;

/** Scrolling page over the sky: a wide workspace under the top bar, one column on phones. */
export function Screen({ children, scene = "night", title, footer = true }: {
  children: ReactNode; scene?: Scene; /** Browser tab title, after "ORION". */ title?: string; /** The site footer under the page. */ footer?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { shell } = useLayout();
  // Scroll drives the sky's parallax and tells the top bar when content is passing under it.
  const scrollY = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const setScrolled = useScrolled((s) => s.set);
  const onScroll = useRef(Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
    useNativeDriver: false,
    listener: (e: { nativeEvent: { contentOffset: { y: number } } }) => setScrolled(e.nativeEvent.contentOffset.y > 12),
  })).current;
  // Tabs stay mounted, so replay the entrance each time a screen is focused again.
  const [visit, setVisit] = useState(0);
  useFocusEffect(useCallback(() => {
    setVisit((v) => v + 1);
    setScrolled(false);
    if (web && typeof document !== "undefined") document.title = title ? `${title} · ORION` : t("ORION — Make better decisions");
  }, [title, setScrolled]));
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Backdrop scene={scene} scrollY={scrollY} drift={!reduced} />
      <Animated.ScrollView
        style={{ flex: 1 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          paddingHorizontal: shell ? 40 : spacing.lg,
          paddingTop: shell ? layout.nav + spacing.xl : insets.top + spacing.xl,
          paddingBottom: spacing.xxl,
        }}
      >
        <Reveal replay={visit} style={{ width: "100%", maxWidth: shell ? layout.page : layout.column, flexGrow: 1 }}>
          {/* Phones have no top bar, so the language, the account and its sign-out sit at the top of every page. */}
          {!shell && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 10, marginTop: -spacing.md, marginBottom: spacing.sm }}>
              <LanguageSwitch compact />
              <AccountMenu compact />
            </View>
          )}
          <View style={{ gap: spacing.lg, flexGrow: 1 }}>{children}</View>
          {footer && <SiteFooter />}
        </Reveal>
      </Animated.ScrollView>
    </View>
  );
}

/** Page title on the left, page-level actions on the right. */
export function PageHeader({ eyebrow, title, children, actions }: { eyebrow?: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  const { shell } = useLayout();
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.md }}>
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 320, gap: spacing.sm }}>
        {eyebrow && <Eyebrow color={colors.accentBright}>{eyebrow}</Eyebrow>}
        <Title size={!shell ? (title.length > 50 ? 26 : type.screenTitle) : title.length > 60 ? 32 : title.length > 32 ? 38 : type.pageTitle} weight="200">{title}</Title>
        {/* The posters' short blue rule under the headline. */}
        <View style={{ width: 44, height: 2, borderRadius: 1, backgroundColor: colors.accent, marginTop: 2, marginBottom: 2 }} />
        {children}
      </View>
      {actions && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, flexShrink: 1, maxWidth: "100%" }}>{actions}</View>}
    </View>
  );
}

/** Frosted glass panel. Pass `onPress` and it lifts on hover like the example cards on Home. */
export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const base: ViewStyle = { backgroundColor: colors.glass, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: spacing.lg, gap: spacing.md };
  const shadow = css({ boxShadow: elevation.rest });
  if (!onPress) return <View {...spot} style={[base, shadow, blur, style]}>{children}</View>;
  return (
    <Pressable
      {...spot}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={(state) => {
        const hot = state.pressed || (state as PressState).hovered;
        return [base, blur, ease, css({ boxShadow: hot ? elevation.raised : elevation.rest }), hot && { borderColor: colors.lineStrong, ...css({ transform: state.pressed ? "scale(0.99)" : "translateY(-2px)" }) }, style];
      }}
    >
      {children}
    </Pressable>
  );
}

/** Large figure over a tracked caption. */
export function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 180, gap: spacing.xs }}>
      <Text style={[{ fontSize: type.display, lineHeight: 50, fontWeight: "200", letterSpacing: tracking(type.display), color: colors.white }, tabular]}>{value}</Text>
      <Eyebrow>{label}</Eyebrow>
    </Card>
  );
}

/** Quiet panel for "nothing here yet" that points at what to do next. */
// Empty states get a spot illustration chosen by their icon; any other icon keeps the plain round badge.
const EMPTY_ART: Partial<Record<IconName, IllustrationName>> = {
  "time-outline": "history", "stats-chart-outline": "insights", "search-outline": "search", "compass-outline": "lost", "link-outline": "link",
};
export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm }}>
      {EMPTY_ART[icon] ? (
        <View style={{ marginBottom: spacing.sm }}><Illustration name={EMPTY_ART[icon]!} width={220} /></View>
      ) : (
        <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: colors.frost, marginBottom: spacing.xs }}>
          <Ionicons name={icon} size={24} color={colors.white} />
        </View>
      )}
      <SectionTitle>{title}</SectionTitle>
      {children && <Small style={{ textAlign: "center", maxWidth: 380 }}>{children}</Small>}
      {action && <View style={{ marginTop: spacing.sm }}>{action}</View>}
    </Card>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.line }} />;
}

/**
 * A detail someone can open when they want it, and ignore when they do not. The default screen answers
 * the question; this is where the working goes. Closed, it is one line with a chevron; open, it reveals
 * its children. The whole row is the control, so it is one tab stop and one large touch target.
 */
export function Disclosure({ summary, children, hint, tone = "quiet", defaultOpen = false, onOpen }: {
  /** The question the detail answers, in the person's words — not the name of a technique. */
  summary: string;
  children: ReactNode;
  /** One short line under the summary while it is closed. */
  hint?: string;
  /** `accent` is for the one disclosure a screen most wants opened. */
  tone?: "quiet" | "accent";
  defaultOpen?: boolean;
  /** Called the first time it is opened, for screens that load the detail lazily. */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const opened = useRef(defaultOpen);
  const colour = tone === "accent" ? colors.accentBright : colors.body;
  const toggle = () => {
    if (!open && !opened.current) { opened.current = true; onOpen?.(); }
    setOpen(!open);
  };
  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.line }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        accessibilityLabel={summary}
        onPress={toggle}
        style={(state) => [
          { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 14, minHeight: 48 },
          ((state as PressState).hovered || state.pressed) && css({ opacity: 0.78 }),
          ease,
        ]}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: type.supporting, fontWeight: "400", color: colour }}>{summary}</Text>
          {hint && !open && <Small>{hint}</Small>}
        </View>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colour} />
      </Pressable>
      {open && <View style={{ paddingBottom: spacing.md, gap: spacing.md }}>{children}</View>}
    </View>
  );
}

export function Eyebrow({ children, color = colors.muted }: { children: ReactNode; color?: string }) {
  return (
    <Text style={{ fontSize: type.metadata, fontWeight: "500", letterSpacing: getLocale() === "ko" ? 0.6 : 2.4, textTransform: "uppercase", color }}>
      {children}
    </Text>
  );
}

export function Title({ children, size = type.screenTitle, color = colors.ink, weight = "300" }: { children: ReactNode; size?: number; color?: string; weight?: "200" | "300" | "400" }) {
  return (
    <Text accessibilityRole="header" style={{ fontSize: size, lineHeight: Math.round(size * (size >= 40 ? 1.08 : 1.2)), fontWeight: weight, letterSpacing: tracking(size), color }}>
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={{ fontSize: type.section, fontWeight: "500", letterSpacing: 0.2, color: colors.ink }}>
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ fontSize: type.body, lineHeight: 25, fontWeight: "300", color: colors.body }, style]}>{children}</Text>;
}

export function Small({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[{ fontSize: type.supporting, lineHeight: 21, fontWeight: "300", color: colors.muted }, style]}>{children}</Text>;
}

export function AppButton({
  title,
  onPress,
  variant = "primary",
  disabled,
  selected,
  icon,
  iconRight,
  accessibilityLabel,
  expanded,
  style,
}: {
  title: string;
  onPress: () => void;
  /** `danger` is for the confirming step of something that cannot be undone. */
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  selected?: boolean;
  icon?: IconName;
  iconRight?: IconName;
  accessibilityLabel?: string;
  /** For a button that shows or hides a region: announced as expanded or collapsed. */
  expanded?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = variant === "danger" ? colors.danger : variant === "ghost" && !selected ? colors.muted : colors.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected, ...(expanded === undefined ? {} : { expanded }) }}
      // Web reads aria-expanded; react-native-web does not derive it from accessibilityState.
      aria-expanded={expanded}
      style={(state) => {
        const active = state.pressed || (state as PressState).hovered;
        return [
          { minHeight: 44, paddingHorizontal: 22, borderRadius: radius.pill, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
          variant === "primary" && { backgroundColor: active ? colors.accentHover : colors.accent, borderColor: active ? colors.accentHover : colors.accent },
          variant === "secondary" && { backgroundColor: active ? colors.frostHover : colors.frost, borderColor: colors.lineStrong },
          variant === "ghost" && { backgroundColor: active ? colors.sunken : "transparent", borderColor: "transparent" },
          variant === "danger" && { backgroundColor: active ? colors.dangerLine : colors.dangerSoft, borderColor: colors.dangerLine },
          selected && { backgroundColor: colors.accentSoft, borderColor: colors.accentLine },
          variant === "primary" && !disabled && css({ boxShadow: active ? elevation.glow : "none" }),
          disabled && { opacity: 0.45 },
          ease,
          !disabled && sink(state.pressed),
          style,
        ];
      }}
    >
      {icon && <Ionicons name={icon} size={16} color={fg} />}
      <Text style={{ color: fg, fontSize: 15, fontWeight: "500", letterSpacing: 0.3, flexShrink: 1 }}>{title}</Text>
      {iconRight && <Ionicons name={iconRight} size={16} color={fg} />}
    </Pressable>
  );
}

/** The round blue arrow that sends a decision. */
export function ArrowButton({ onPress, accessibilityLabel, disabled, size = 44 }: { onPress: () => void; accessibilityLabel: string; disabled?: boolean; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={(state) => [
        { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" },
        { backgroundColor: state.pressed || (state as PressState).hovered ? colors.accentHover : colors.accent },
        css({ boxShadow: (state as PressState).hovered && !disabled ? elevation.glow : "none" }),
        disabled && { opacity: 0.4 },
        ease,
        !disabled && sink(state.pressed),
      ]}
    >
      <Ionicons name="arrow-forward" size={size * 0.46} color={colors.white} />
    </Pressable>
  );
}

/** Round icon-only button for row actions. The label is what screen readers announce. */
export function IconButton({ icon, onPress, accessibilityLabel, tone = "quiet", disabled, size = 36 }: { icon: IconName; onPress: () => void; accessibilityLabel: string; tone?: "quiet" | "accent"; disabled?: boolean; size?: number }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={(state) => {
        const hot = state.pressed || (state as PressState).hovered;
        return [
          { width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" },
          { backgroundColor: tone === "accent" ? (hot ? colors.accentHover : colors.accent) : hot ? colors.frostHover : "transparent" },
          disabled && { opacity: 0.4 },
          ease,
          !disabled && sink(state.pressed),
        ];
      }}
    >
      <Ionicons name={icon} size={size * 0.47} color={tone === "accent" ? colors.white : colors.body} />
    </Pressable>
  );
}

/**
 * Two-step button for things that cannot be undone: the first press arms it and it asks again in words;
 * it disarms by itself after a few seconds. `compact` starts as an icon for table rows.
 */
export function ConfirmButton({ title, confirmTitle, icon = "trash-outline", onConfirm, compact, disabled }: { title: string; confirmTitle: string; icon?: IconName; onConfirm: () => void; compact?: boolean; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (armed) return <AppButton variant="danger" icon="alert-circle-outline" title={confirmTitle} onPress={() => { setArmed(false); onConfirm(); }} style={compact ? { minHeight: 36, paddingHorizontal: 14 } : undefined} />;
  return compact
    ? <IconButton icon={icon} accessibilityLabel={title} onPress={() => setArmed(true)} disabled={disabled} />
    : <AppButton variant="ghost" icon={icon} title={title} onPress={() => setArmed(true)} disabled={disabled} />;
}

/** Frosted rounded tag for one-of-many choices. `quiet` is the low-emphasis escape hatch (skip). */
export function Chip({
  label,
  onPress,
  selected,
  quiet,
  compact,
  icon,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  quiet?: boolean;
  /** Denser chip for table cells. */
  compact?: boolean;
  icon?: IconName;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      style={(state) => {
        const active = state.pressed || (state as PressState).hovered;
        return [
          { minHeight: compact ? 32 : 40, paddingHorizontal: compact ? (selected ? 8 : 11) : 16, borderRadius: radius.sm, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8 },
          quiet
            ? { borderColor: "transparent", backgroundColor: active ? colors.sunken : "transparent" }
            : { borderColor: selected ? colors.accentLine : "transparent", backgroundColor: selected ? colors.accentSoft : active ? colors.frostHover : colors.frost },
          ease,
          sink(state.pressed),
        ];
      }}
    >
      {selected && <Ionicons name="checkmark" size={compact ? 12 : 14} color={colors.white} />}
      {icon && !selected && <Ionicons name={icon} size={15} color={colors.white} />}
      <Text style={{ fontSize: compact ? 13 : type.supporting, fontWeight: "400", color: quiet ? colors.muted : colors.white }}>{label}</Text>
    </Pressable>
  );
}

const TONES = {
  neutral: { bg: colors.sunken, fg: colors.muted, icon: "information-circle-outline" },
  info: { bg: colors.accentSoft, fg: colors.accentBright, icon: "information-circle-outline" },
  success: { bg: colors.successSoft, fg: colors.success, icon: "checkmark-circle-outline" },
  warning: { bg: colors.warningSoft, fg: colors.warning, icon: "warning-outline" },
  danger: { bg: colors.dangerSoft, fg: colors.danger, icon: "alert-circle-outline" },
} as const;
export type Tone = keyof typeof TONES;

/** Small non-interactive label. Text carries the meaning; colour only supports it. */
export function Tag({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <View style={{ alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: TONES[tone].bg }}>
      <Text style={{ fontSize: type.metadata, fontWeight: "500", color: TONES[tone].fg }}>{sentenceCase(label)}</Text>
    </View>
  );
}

export function Notice({ children, tone = "neutral", alert, icon }: { children: ReactNode; tone?: Tone; alert?: boolean; icon?: IconName }) {
  return (
    <View
      accessibilityRole={alert ? "alert" : undefined}
      style={{ flexDirection: "row", gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: TONES[tone].bg }}
    >
      <Ionicons name={icon ?? TONES[tone].icon} size={17} color={TONES[tone].fg} style={{ marginTop: 2 }} />
      <Text style={{ flex: 1, fontSize: type.supporting, lineHeight: 21, fontWeight: "300", color: colors.body }}>{children}</Text>
    </View>
  );
}

/** Single-line input with a visible focus state. */
export function Field({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.faint}
      {...props}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[
        { minHeight: 44, borderWidth: 1, borderColor: focused ? colors.accentLine : colors.line, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontFamily: sans, fontSize: type.body, color: colors.ink, backgroundColor: colors.sunken },
        noOutline,
        focused && focusRing,
        style,
      ]}
    />
  );
}

/** A field with its label above it and its hint or error below. Errors are announced, not just coloured. */
export function LabeledField({ label, hint, error, ...props }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: type.supporting, fontWeight: "500", color: colors.ink }}>{label}</Text>
      <Field accessibilityLabel={label} {...props} style={[error ? { borderColor: colors.dangerLine } : null, props.style]} />
      {error
        ? <Text accessibilityRole="alert" style={{ fontSize: 13, lineHeight: 19, color: colors.danger }}>{error}</Text>
        : hint ? <Small style={{ fontSize: 13, lineHeight: 19 }}>{hint}</Small> : null}
    </View>
  );
}

export function CheckRow({
  checked,
  onPress,
  label,
  icon,
  disabled,
}: {
  checked: boolean;
  onPress: () => void;
  label: string;
  icon?: IconName;
  /** Announced only; the handler decides whether the press applies. */
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, flexShrink: 1 }}
    >
      <View
        style={{
          width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, alignItems: "center", justifyContent: "center",
          borderColor: checked ? colors.accent : colors.lineStrong, backgroundColor: checked ? colors.accent : "transparent",
        }}
      >
        {checked && <Ionicons name="checkmark" size={12} color={colors.white} />}
      </View>
      {icon && <Ionicons name={icon} size={14} color={colors.muted} />}
      <Text style={{ fontSize: type.supporting, fontWeight: "300", color: colors.body, flexShrink: 1 }}>{label}</Text>
    </Pressable>
  );
}

export { Ionicons as Icon };
