// The graphs that go with Aftermath.
//  - FanChart: net effect over time for the pictured option, with its likely range as a wash, against the strongest
//    alternative. One axis, 2px lines, end labels plus a legend, a crosshair tooltip on hover or tap, and a table view.
//  - FeltGrid: factor × moment. Colour says whether a factor helps or hurts, strength says how much of it is felt by
//    then, and a + / − glyph carries the sign for anyone who cannot rely on colour.
import { useId, useMemo, useRef, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from "react-native-svg";
import { animate, stagger, svg as animeSvg } from "animejs";
import { mark, tag, useAnime } from "./motion";
import { CLEAR, PACE_LABEL, paceFor, shortWhenLabel, type AftermathStep } from "../decision-engine/aftermath";
import { msg, t } from "../i18n";
import { chart, colors, radius, spacing, type } from "../theme/tokens";
import { Small, Text, sans, tabular, useLayout } from "./ui";

export interface FanSeries {
  id: string;
  label: string;
  color: string;
  steps: AftermathStep[];
  /** Draw the likely-range wash (the pictured option only, so the chart stays readable). */
  band?: boolean;
}

/** Below this width the charts drop end labels (the legend carries identity) and use short time labels. */
const COMPACT = 520;
/** A moment's axis label: its full name, or the short one ("Wk 1", "1 yr") when space is tight. `null` is the moment of choosing. */
const short = (moment: { days: number | null; when: string }, compact: boolean) =>
  compact ? (moment.days === null ? t("Now") : shortWhenLabel(moment.days)) : moment.when;

const H = 230;
const WIDE_PAD = { top: 18, right: 136, bottom: 30, left: 66 };
const NARROW_PAD = { top: 18, right: 16, bottom: 30, left: 50 };
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;

/** Clean tick step (1, 2 or 5 × 10ⁿ) for roughly four ticks. */
function niceStep(span: number) {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw;
}

export function FanChart({ series, headline, crossing = null }: {
  series: FanSeries[];
  /** The takeaway in words, shown above the chart. */
  headline?: string;
  /** Step index where the two lines cross, marked on the chart. */
  crossing?: number | null;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const root = useRef<View>(null);
  const compact = width > 0 && width < COMPACT;
  const PAD = compact ? NARROW_PAD : WIDE_PAD;
  // Every series starts at "Now", the moment of choosing, with nothing felt yet, unless its first step is that moment.
  const startsNow = series[0]?.steps[0]?.days === 0;
  const moments = [...(startsNow ? [] : [{ days: null, when: t("Now") }]), ...(series[0]?.steps ?? []).map((s) => ({ days: s.days as number | null, when: s.when }))];
  const labels = moments.map((m) => m.when);
  const points = series.map((s) => (startsNow ? s.steps : [{ value: 0, range: [0, 0] as [number, number] }, ...s.steps]).map((p) => ({ value: p.value, range: p.range })));

  const { y, x, lo, hi } = useMemo(() => {
    const values = points.flatMap((ps, i) => ps.flatMap((p) => (series[i].band ? [p.range[0], p.range[1], p.value] : [p.value])));
    let lo = Math.min(0, ...values);
    let hi = Math.max(0, ...values);
    // Always show the "clearly better" line, so the zones read even when everything is small.
    hi = Math.max(hi, CLEAR + 0.5);
    lo = Math.min(lo, -0.5);
    const step = niceStep(hi - lo);
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    const plotH = H - PAD.top - PAD.bottom;
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const n = labels.length;
    return {
      y: (v: number) => PAD.top + ((hi - v) / (hi - lo)) * plotH,
      x: (i: number) => PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW),
      lo, hi,
      ticks: Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => Math.round((lo + i * step) * 100) / 100),
    };
  }, [points, series, width, labels.length, PAD]);

  const line = (ps: { value: number }[]) => ps.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.value)}`).join(" ");
  const band = (ps: { range: [number, number] }[]) =>
    `${ps.map((p, i) => `${i ? "L" : "M"}${x(i)} ${y(p.range[1])}`).join(" ")} ${ps.slice().reverse().map((p, j) => `L${x(ps.length - 1 - j)} ${y(p.range[0])}`).join(" ")} Z`;

  // End labels: nudge apart only by a few pixels; if they still collide, the legend carries identity.
  const ends = series.map((s, i) => ({ s, yEnd: y(points[i][points[i].length - 1].value) }));
  if (ends.length === 2 && Math.abs(ends[0].yEnd - ends[1].yEnd) < 14) {
    const [a, b] = ends[0].yEnd <= ends[1].yEnd ? [ends[0], ends[1]] : [ends[1], ends[0]];
    a.yEnd -= 7; b.yEnd += 7;
  }

  // Draw the lines from "Now" outward, then let the likely range and the end points settle in.
  const dataKey = JSON.stringify(points);
  useAnime(root, () => {
    animate(animeSvg.createDrawable(".am-line"), { draw: ["0 0", "0 1"], duration: 1300, delay: stagger(220), ease: "inOutQuad" });
    animate(".am-band", { opacity: [0, 1], duration: 900, delay: 500, ease: "outQuad" });
    animate(".am-dot", { opacity: [0, 1], duration: 400, delay: stagger(120, { start: 1100 }), ease: "outQuad" });
  }, [dataKey, width, table]);

  const summary = series.map((s, i) => `${s.label}: ${labels.map((l, j) => `${l} ${signed(points[i][j].value)}`).join(", ")}`).join(". ");

  return (
    <View ref={root} style={{ gap: spacing.sm }}>
      {headline && <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: "400", color: colors.white }}>{headline}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
        <View accessibilityRole="none" style={{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.md }}>
          {series.map((s) => (
            <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 16, height: 2, borderRadius: 1, backgroundColor: s.color }} />
              <Text style={{ fontSize: type.metadata, color: colors.body }}>{s.label}</Text>
            </View>
          ))}
          {series.some((s) => s.band) && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 16, height: 10, borderRadius: 2, backgroundColor: chart.pictured, opacity: 0.18 }} />
              <Text style={{ fontSize: type.metadata, color: colors.muted }}>{t("Likely range")}</Text>
            </View>
          )}
        </View>
        <Pressable accessibilityRole="button" onPress={() => setTable(!table)}>
          <Text style={{ fontSize: type.metadata, color: colors.accentBright, textDecorationLine: "underline" }}>{table ? t("Show the graph") : t("Show as a table")}</Text>
        </Pressable>
      </View>

      {table ? (
        <View accessibilityRole="list" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, overflow: "hidden" }}>
          <Row cells={["", ...series.map((s) => s.label)]} head />
          {labels.map((l, j) => (
            <Row key={l} cells={[l, ...series.map((s, i) => {
              const p = points[i][j];
              return s.band && p.range[0] !== p.range[1] ? t("{value}  ({low} to {high})", { value: signed(p.value), low: signed(p.range[0]), high: signed(p.range[1]) }) : signed(p.value);
            })]} />
          ))}
        </View>
      ) : (
        <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} accessible accessibilityLabel={t("Net effect over time. {summary}", { summary })} style={{ height: H }}>
          {width > 0 && (
            <Svg width={width} height={H}>
              {/* Zones in words, on the same thresholds as the odds: clearly better, about the same, clearly worse. */}
              <Rect x={PAD.left} y={y(hi)} width={width - PAD.left - PAD.right} height={y(CLEAR) - y(hi)} fill={chart.helps} fillOpacity={0.07} />
              {lo < -CLEAR && <Rect x={PAD.left} y={y(-CLEAR)} width={width - PAD.left - PAD.right} height={y(lo) - y(-CLEAR)} fill={chart.hurts} fillOpacity={0.08} />}
              {/* Hairlines only at zero and at the "clearly" thresholds the zones and the odds share. */}
              {[CLEAR, 0, ...(lo < -CLEAR ? [-CLEAR] : [])].map((t) => (
                <Line key={t} x1={PAD.left} x2={width - PAD.right + 8} y1={y(t)} y2={y(t)} stroke={t === 0 ? chart.zero : chart.grid} strokeWidth={1} />
              ))}
              {/* The axis speaks in words; exact values live in the tooltip and the table. */}
              <SvgText x={PAD.left - 10} y={(y(hi) + y(CLEAR)) / 2 + 4} fontSize={11} fill={colors.body} textAnchor="end" fontFamily={sans}>{t("Better")}</SvgText>
              <SvgText x={PAD.left - 10} y={y(0) + 4} fontSize={11} fill={colors.muted} textAnchor="end" fontFamily={sans}>{t("Same")}</SvgText>
              {lo < -CLEAR && <SvgText x={PAD.left - 10} y={(y(lo) + y(-CLEAR)) / 2 + 4} fontSize={11} fill={colors.body} textAnchor="end" fontFamily={sans}>{t("Worse")}</SvgText>}
              {crossing !== null && (() => {
                const ci = crossing + (startsNow ? 0 : 1);
                const cy = y(points[0][ci].value);
                return (
                  <>
                    <Line x1={x(ci)} x2={x(ci)} y1={PAD.top} y2={H - PAD.bottom} stroke={colors.white} strokeOpacity={0.35} strokeWidth={1} />
                    <SvgText x={x(ci) + (x(ci) > width - 110 ? -6 : 6)} y={PAD.top + 10} fontSize={11} fill={colors.white} textAnchor={x(ci) > width - 110 ? "end" : "start"} fontFamily={sans}>{t("The lines cross")}</SvgText>
                    <Circle cx={x(ci)} cy={cy} r={7} fill="none" stroke={colors.white} strokeOpacity={0.6} strokeWidth={1} />
                  </>
                );
              })()}
              {labels.map((l, i) => (
                <SvgText key={l} x={x(i)} y={H - PAD.bottom + 18} fontSize={11} fill={active === i ? colors.white : colors.muted} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} fontFamily={sans}>{short(moments[i], compact)}</SvgText>
              ))}
              {series.map((s, i) => s.band && <Path key={`b${s.id}`} {...tag("am-band")} d={band(points[i])} fill={s.color} fillOpacity={0.14} />)}
              {active !== null && <Line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke={colors.lineStrong} strokeWidth={1} />}
              {series.map((s, i) => (
                <Path key={s.id} {...tag("am-line")} d={line(points[i])} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {series.map((s, i) => points[i].map((p, j) => (j === points[i].length - 1 || j === active) && (
                <Circle key={`${s.id}${j}`} {...(j === points[i].length - 1 ? tag("am-dot") : {})} cx={x(j)} cy={y(p.value)} r={4.5} fill={s.color} stroke={chart.surface} strokeWidth={2} />
              )))}
              {!compact && ends.map(({ s, yEnd }) => (
                <SvgText key={`e${s.id}`} x={width - PAD.right + 12} y={yEnd + 4} fontSize={11} fill={colors.body} fontFamily={sans}>
                  {`${s.label.length > 20 ? `${s.label.slice(0, 19)}…` : s.label}`}
                </SvgText>
              ))}
            </Svg>
          )}
          {/* Hit columns wider than the marks: hover on web, tap anywhere. */}
          {width > 0 && labels.map((l, i) => {
            const w = (width - PAD.left - PAD.right) / Math.max(1, labels.length - 1);
            return (
              <Pressable
                key={l}
                accessibilityLabel={`${l}: ${series.map((s, k) => `${s.label} ${signed(points[k][i].value)}`).join(", ")}`}
                onPress={() => setActive(active === i ? null : i)}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive(null)}
                style={{ position: "absolute", top: 0, bottom: 0, left: Math.max(0, x(i) - w / 2), width: w }}
              />
            );
          })}
          {active !== null && width > 0 && (
            <View pointerEvents="none" style={[{
              position: "absolute", top: 4, minWidth: 170, padding: 10, gap: 4, borderRadius: radius.sm,
              backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.lineStrong,
            }, x(active) > width / 2 ? { right: width - x(active) + 10 } : { left: x(active) + 10 }]}>
              <Text style={{ fontSize: type.metadata, fontWeight: "500", color: colors.white }}>{labels[active]}</Text>
              {series.map((s, i) => (
                <View key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color }} />
                  <Text style={[{ flex: 1, fontSize: type.metadata, color: colors.body }, tabular]} numberOfLines={1}>{s.label}</Text>
                  <Text style={[{ fontSize: type.metadata, color: colors.white }, tabular]}>{signed(points[i][active].value)}</Text>
                </View>
              ))}
              {series[0].band && points[0][active].range[0] !== points[0][active].range[1] && (
                <Text style={[{ fontSize: 11, color: colors.muted }, tabular]}>{t("Likely {low} to {high}", { low: signed(points[0][active].range[0]), high: signed(points[0][active].range[1]) })}</Text>
              )}
            </View>
          )}
        </View>
      )}
      <Small>{t("How much better or worse off you are so far, counting everything that matters to you (ORION's −10 to +10 scale). The shaded wash around the blue line is where half of plausible outcomes land.")}</Small>
    </View>
  );
}

function Row({ cells, head }: { cells: string[]; head?: boolean }) {
  return (
    <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: colors.line, backgroundColor: head ? colors.sunken : "transparent" }}>
      {cells.map((c, i) => (
        <Text key={i} style={[{ flex: i === 0 ? 0.8 : 1, padding: 8, fontSize: type.metadata, fontWeight: head ? "500" : "300", color: head || i === 0 ? colors.white : colors.body }, tabular]}>{c}</Text>
      ))}
    </View>
  );
}

/** Factor × moment grid: which effects arrive at once and which build slowly. */
export function FeltGrid({ steps, headline }: { steps: AftermathStep[]; headline?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const { tablet } = useLayout();
  const root = useRef<View>(null);
  const shape = JSON.stringify(steps.map((s) => s.contributions.map((c) => c.contribution)));
  // Cells fill in moment by moment, the way the effects arrive.
  useAnime(root, () => {
    animate('[data-am="cell"]', { opacity: [0, 1], scale: [0.7, 1], duration: 500, delay: stagger(45, { grid: [steps.length, steps[0]?.contributions.length ?? 1], from: "first", axis: "x" }), ease: "outBack(1.4)" });
  }, [shape]);
  const factors = steps[0]?.contributions.slice().sort((a, b) => b.weight - a.weight) ?? [];
  const max = Math.max(0.01, ...steps.flatMap((s) => s.contributions.map((c) => Math.abs(c.contribution))));
  const cellVars = (c: { label: string; felt: number }, s: AftermathStep) => ({ factor: c.label, when: s.when, felt: Math.round(c.felt * 100) });
  const at = (stepIndex: number, factorId: string) => steps[stepIndex].contributions.find((c) => c.factorId === factorId)!;
  const detail = active ? (() => {
    const [i, id] = active.split("|");
    const c = at(Number(i), id);
    const vars = { factor: c.label, when: steps[Number(i)].when, felt: Math.round(c.felt * 100), value: signed(c.contribution) };
    return c.value > 0.5 ? t("{factor} · {when}: helps, about {felt}% of it felt by then ({value}).", vars)
      : c.value < -0.5 ? t("{factor} · {when}: hurts, about {felt}% of it felt by then ({value}).", vars)
      : t("{factor} · {when}: little effect, about {felt}% of it felt by then ({value}).", vars);
  })() : null;

  return (
    <View ref={root} style={{ gap: spacing.sm }}>
      {headline && <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: "400", color: colors.white }}>{headline}</Text>}
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 104 }} />
        {steps.map((s) => (
          <Text key={s.days} style={{ flex: 1, textAlign: "center", fontSize: 11, letterSpacing: 0.6, color: colors.muted }} numberOfLines={1}>{short(s, !tablet)}</Text>
        ))}
      </View>
      {factors.map((f) => (
        <View key={f.factorId} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <View style={{ width: 102 }}>
            <Text style={{ fontSize: type.metadata, color: colors.body }} numberOfLines={1}>{f.label}</Text>
            <Text style={{ fontSize: 10.5, color: colors.faint }}>{t(PACE_LABEL[paceFor(f)])}</Text>
          </View>
          {steps.map((s, i) => {
            const c = at(i, f.factorId);
            const strength = Math.abs(c.contribution) / max;
            const tone = c.value > 0.5 ? chart.helps : c.value < -0.5 ? chart.hurts : null;
            const key = `${i}|${f.factorId}`;
            return (
              <Pressable
                key={key}
                {...mark("cell")}
                accessibilityLabel={(tone === chart.helps ? t("{factor} at {when}: helps, {felt}% felt", cellVars(c, s)) : tone ? t("{factor} at {when}: hurts, {felt}% felt", cellVars(c, s)) : t("{factor} at {when}: little effect, {felt}% felt", cellVars(c, s)))}
                onPress={() => setActive(active === key ? null : key)}
                onHoverIn={() => setActive(key)}
                onHoverOut={() => setActive(null)}
                style={{ flex: 1, height: 34, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: colors.sunken, overflow: "hidden" }}
              >
                {tone && <View style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: tone, opacity: 0.15 + 0.75 * strength }} />}
                <Text style={[{ fontSize: 12, fontWeight: "500", color: tone && strength > 0.45 ? colors.white : colors.muted }, tabular]}>{tone ? `${tone === chart.helps ? "+" : "−"} ${Math.round(c.felt * 100)}%` : "·"}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, marginTop: 2 }}>
        {([["helps", t("Helps"), chart.helps, "+"], ["hurts", t("Hurts"), chart.hurts, "−"]] as const).map(([id, l, c, g]) => (
          <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: c, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 10, color: colors.white }}>{g}</Text>
            </View>
            <Text style={{ fontSize: type.metadata, color: colors.body }}>{l}</Text>
          </View>
        ))}
        <Small>{t("The % is how much of that effect you feel by then; stronger colour means a bigger effect.")}</Small>
      </View>
      <Small style={{ minHeight: 20, color: detail ? colors.white : colors.faint }}>{detail ?? t("Hover or tap a square for the detail.")}</Small>
    </View>
  );
}

/** "One month: goes well 30%, mixed 50%, hard 20%", for screen readers. */
const oddsLabel = (when: string, odds: AftermathStep["odds"]) =>
  t("{when}: goes well {well}%, mixed {mixed}%, hard {hard}%", { when, well: Math.round(odds.well * 100), mixed: Math.round(odds.mixed * 100), hard: Math.round(odds.hard * 100) });

const RIVER_H = 210;
const RIVER_WIDE = { top: 14, right: 118, bottom: 30, left: 8 };
const RIVER_NARROW = { top: 14, right: 92, bottom: 30, left: 8 };
// Labels are English marked for translation; `short` is the compact end label ("30% well").
const BANDS = [
  { key: "well", label: msg("Goes well"), short: msg("{n}% well"), color: chart.helps },
  { key: "mixed", label: msg("Mixed"), short: msg("{n}% mixed"), color: "#8A94A6" },
  { key: "hard", label: msg("Hard"), short: msg("{n}% hard"), color: chart.hurts },
] as const;

/**
 * "Where the futures go": from the moment of choosing, the possible futures fan out into goes-well / mixed / hard,
 * each band as thick as its odds at that moment. Ribbons join the same band from one moment to the next.
 */
export function FuturesRiver({ steps, headline, height = RIVER_H, caption = true }: {
  steps: AftermathStep[];
  headline?: string;
  /** Drawing height; the welcome demo uses a short one. */
  height?: number;
  caption?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const root = useRef<View>(null);
  const compact = width > 0 && width < COMPACT;
  const RIVER_PAD = compact ? RIVER_NARROW : RIVER_WIDE;
  // SVG ids are page-wide; two rivers on one page must not share a clip.
  const clipId = `river-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const cols = [{ days: null as number | null, when: t("Now"), odds: null as AftermathStep["odds"] | null }, ...steps.map((s) => ({ days: s.days as number | null, when: s.when, odds: s.odds }))];
  const plotW = Math.max(1, width - RIVER_PAD.left - RIVER_PAD.right);
  const plotH = height - RIVER_PAD.top - RIVER_PAD.bottom;
  const x = (i: number) => RIVER_PAD.left + (i / (cols.length - 1)) * plotW;
  const GAP = 3;
  // Segment extents per column: the "Now" column is one narrow knot in the middle.
  const segments = cols.map((c) => {
    if (!c.odds) {
      const mid = RIVER_PAD.top + plotH / 2;
      return BANDS.map((_, k) => ({ top: mid - 9 + k * 6, bottom: mid - 9 + k * 6 + 6 }));
    }
    const shares = [c.odds.well, c.odds.mixed, c.odds.hard];
    const usable = plotH - GAP * 2;
    let y = RIVER_PAD.top;
    return shares.map((v) => { const top = y; y += v * usable + GAP; return { top, bottom: top + v * usable }; });
  });
  const ribbon = (k: number, i: number) => {
    const a = segments[i][k];
    const b = segments[i + 1][k];
    const x0 = x(i) + (i === 0 ? 0 : 5);
    const x1 = x(i + 1) - 5;
    const mx = (x0 + x1) / 2;
    return `M${x0} ${a.top} C${mx} ${a.top} ${mx} ${b.top} ${x1} ${b.top} L${x1} ${b.bottom} C${mx} ${b.bottom} ${mx} ${a.bottom} ${x0} ${a.bottom} Z`;
  };
  const key = JSON.stringify(steps.map((s) => s.odds));
  useAnime(root, () => {
    animate(".am-reveal", { width: [0, width], duration: 1600, ease: "inOutQuart" });
    animate(".am-knot", { scale: [0, 1], opacity: [0, 1], duration: 600, ease: "outBack(2)" });
  }, [key, width]);
  const last = cols[cols.length - 1].odds;
  const lastSeg = segments[segments.length - 1];

  return (
    <View ref={root} style={{ gap: spacing.sm }}>
      {headline && <Text style={{ fontSize: 16, lineHeight: 24, fontWeight: "400", color: colors.white }}>{headline}</Text>}
      <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} style={{ height: height }}
        accessible accessibilityLabel={t("Where the futures go. {moments}", { moments: steps.map((s) => oddsLabel(s.when, s.odds)).join(". ") })}>
        {width > 0 && (
          <Svg width={width} height={height}>
            <Defs>
              <ClipPath id={clipId}><Rect {...tag("am-reveal")} x={0} y={0} width={width} height={height} /></ClipPath>
            </Defs>
            <G clipPath={`url(#${clipId})`}>
              {BANDS.map((b, k) => cols.slice(0, -1).map((_, i) => (
                <Path key={`${b.key}${i}`} d={ribbon(k, i)} fill={b.color} fillOpacity={active === null || active === i + 1 || active === i ? 0.32 : 0.16} />
              )))}
              {cols.map((c, i) => i > 0 && BANDS.map((b, k) => {
                const seg = segments[i][k];
                return seg.bottom - seg.top > 0.5 && <Rect key={`${b.key}bar${i}`} x={x(i) - 5} y={seg.top} width={10} height={seg.bottom - seg.top} rx={3} fill={b.color} />;
              }))}
            </G>
            <Circle {...tag("am-knot")} cx={x(0)} cy={RIVER_PAD.top + plotH / 2} r={6} fill={colors.white} stroke={chart.surface} strokeWidth={2} />
            {cols.map((c, i) => (
              <SvgText key={c.when} x={x(i)} y={height - 8} fontSize={11} fill={active === i ? colors.white : colors.muted} textAnchor={i === 0 ? "start" : i === cols.length - 1 ? "end" : "middle"} fontFamily={sans}>{short(c, compact)}</SvgText>
            ))}
            {last && BANDS.map((b, k) => {
              const seg = lastSeg[k];
              const share = [last.well, last.mixed, last.hard][k];
              return (
                <SvgText key={`end${b.key}`} x={x(cols.length - 1) + 14} y={(seg.top + seg.bottom) / 2 + 4} fontSize={11} fill={colors.body} fontFamily={sans}>
                  {compact ? t(b.short, { n: Math.round(share * 100) }) : `${t(b.label)} ${Math.round(share * 100)}%`}
                </SvgText>
              );
            })}
          </Svg>
        )}
        {width > 0 && cols.map((c, i) => i > 0 && (
          <Pressable
            key={c.when}
            accessibilityLabel={c.odds ? oddsLabel(c.when, c.odds) : c.when}
            onPress={() => setActive(active === i ? null : i)}
            onHoverIn={() => setActive(i)}
            onHoverOut={() => setActive(null)}
            style={{ position: "absolute", top: 0, bottom: 0, left: x(i) - plotW / (cols.length - 1) / 2, width: plotW / (cols.length - 1) }}
          />
        ))}
        {active !== null && active > 0 && cols[active].odds && (
          <View pointerEvents="none" style={[{ position: "absolute", top: 4, padding: 10, gap: 4, borderRadius: radius.sm, backgroundColor: colors.glassStrong, borderWidth: 1, borderColor: colors.lineStrong },
            x(active) > width / 2 ? { right: width - x(active) + 12 } : { left: x(active) + 12 }]}>
            <Text style={{ fontSize: type.metadata, fontWeight: "500", color: colors.white }}>{cols[active].when}</Text>
            {BANDS.map((b, k) => (
              <View key={b.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: b.color }} />
                <Text style={[{ fontSize: type.metadata, color: colors.body }, tabular]}>{`${t(b.label)} ${Math.round([cols[active].odds!.well, cols[active].odds!.mixed, cols[active].odds!.hard][k] * 100)}%`}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      {caption && <Small>{t("Each band is as thick as its odds at that moment. From the moment you choose, the futures spread out; how they spread is the picture.")}</Small>}
    </View>
  );
}
