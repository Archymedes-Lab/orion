// Spot illustrations in the poster language: a pocket of deep space with a planet's lit limb,
// hairline white drawing on top, and the blue four-point star as the one point of colour.
import { useMemo, type ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, ClipPath, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { colors } from "../theme/tokens";

export type IllustrationName = "history" | "insights" | "search" | "lost" | "link" | "ask" | "weigh" | "decide";

const W = 240;
const H = 150;
const INK = "#FFFFFF";
const BLUE = colors.accent;
const star = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;

/** The blue star with a soft glow behind it. */
function Spark({ x, y, r = 7 }: { x: number; y: number; r?: number }) {
  return (
    <G>
      <Circle cx={x} cy={y} r={r * 2.6} fill="url(#spark)" />
      <Path d={star(x, y, r)} fill={BLUE} />
    </G>
  );
}

/** The shared frame: night sky, a few stars, and a planet limb rising from the bottom edge. */
function Frame({ id, limb = "bottom", children }: { id: string; limb?: "bottom" | "right" | "none"; children: ReactNode }) {
  const stars = useMemo(() => Array.from({ length: 22 }, (_, i) => {
    const h = (n: number) => { const s = Math.sin((i + id.length * 7) * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s); };
    return { x: h(1) * W, y: h(2) * H * 0.75, r: 0.35 + h(3) * 0.7, o: 0.2 + h(4) * 0.5 };
  }), [id]);
  const planet = limb === "bottom" ? { cx: W * 0.62, cy: H + 150, r: 190 } : { cx: W + 120, cy: H * 0.2, r: 150 };
  return (
    <>
      <Defs>
        <ClipPath id={`${id}-clip`}><Rect x={0} y={0} width={W} height={H} rx={18} /></ClipPath>
        <LinearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#13213C" />
          <Stop offset="1" stopColor="#060A13" />
        </LinearGradient>
        <RadialGradient id={`${id}-body`} cx={planet.cx - planet.r * 0.25} cy={planet.cy - planet.r * 0.25} r={planet.r * 1.05} gradientUnits="userSpaceOnUse">
          <Stop offset="0.7" stopColor="#04070E" />
          <Stop offset="0.95" stopColor="#1B3466" />
          <Stop offset="1" stopColor="#7FA6F5" />
        </RadialGradient>
        <LinearGradient id={`${id}-limb`} x1={planet.cx - planet.r} y1={planet.cy} x2={planet.cx} y2={planet.cy - planet.r} gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#8DB2FF" stopOpacity={0.1} />
          <Stop offset="1" stopColor="#F2F7FF" stopOpacity={1} />
        </LinearGradient>
        <RadialGradient id={`${id}-halo`} cx={planet.cx} cy={planet.cy} r={planet.r + 30} gradientUnits="userSpaceOnUse">
          <Stop offset={planet.r / (planet.r + 30)} stopColor="#9DBBFF" stopOpacity={0.45} />
          <Stop offset={(planet.r + 8) / (planet.r + 30)} stopColor="#6F95E2" stopOpacity={0.12} />
          <Stop offset="1" stopColor="#3D63B8" stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="spark" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={BLUE} stopOpacity={0.55} />
          <Stop offset="1" stopColor={BLUE} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <G clipPath={`url(#${id}-clip)`}>
        <Rect x={0} y={0} width={W} height={H} fill={`url(#${id}-sky)`} />
        {stars.map((s, i) => <Circle key={i} cx={s.x} cy={s.y} r={s.r} fill={INK} fillOpacity={s.o} />)}
        {limb !== "none" && (
          <G>
            <Circle cx={planet.cx} cy={planet.cy} r={planet.r + 30} fill={`url(#${id}-halo)`} />
            <Circle cx={planet.cx} cy={planet.cy} r={planet.r} fill={`url(#${id}-body)`} />
            <Circle cx={planet.cx} cy={planet.cy} r={planet.r} fill="none" stroke={`url(#${id}-limb)`} strokeWidth={1.2} />
          </G>
        )}
        {children}
      </G>
      <Rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={17.5} fill="none" stroke={INK} strokeOpacity={0.14} />
    </>
  );
}

const line = { stroke: INK, strokeWidth: 1.2, fill: "none", strokeLinecap: "round" as const };
const faint = { ...line, strokeOpacity: 0.35 };

const SCENES: Record<IllustrationName, () => ReactNode> = {
  // Past decisions as stars set along an orbit; the newest one is blue.
  history: () => (
    <Frame id="history">
      <Path d="M18 110 C 70 40, 160 30, 222 60" {...faint} strokeDasharray="2 5" />
      {[[40, 82], [78, 56], [118, 43]].map(([x, y], i) => (
        <G key={i}>
          <Circle cx={x} cy={y} r={5} {...line} />
          <Circle cx={x} cy={y} r={1.6} fill={INK} />
        </G>
      ))}
      <Spark x={160} y={42} r={8} />
      <Circle cx={198} cy={52} r={4} {...faint} />
    </Frame>
  ),
  // A constellation that climbs: outcomes adding up into a pattern.
  insights: () => (
    <Frame id="insights">
      <Path d="M36 104 L76 86 L108 92 L144 60 L184 40" {...line} strokeOpacity={0.7} />
      {[[36, 104], [76, 86], [108, 92], [144, 60]].map(([x, y]) => <Circle key={x} cx={x} cy={y} r={2.6} fill={INK} />)}
      {[36, 76, 108, 144].map((x, i) => <Line key={x} x1={x} y1={[112, 94, 100, 68][i]} x2={x} y2={124} {...faint} strokeDasharray="1.5 4" />)}
      <Spark x={184} y={40} r={9} />
    </Frame>
  ),
  // A lens sweeping an empty patch of sky.
  search: () => (
    <Frame id="search" limb="right">
      <Circle cx={104} cy={70} r={34} {...line} />
      <Circle cx={104} cy={70} r={34} fill={INK} fillOpacity={0.04} />
      <Line x1={129} y1={95} x2={158} y2={124} {...line} strokeWidth={2.4} />
      <Path d="M86 58 A22 22 0 0 1 104 48" {...line} strokeOpacity={0.6} />
      <Circle cx={112} cy={78} r={1.4} fill={INK} fillOpacity={0.5} />
    </Frame>
  ),
  // A star drifted off its orbit.
  lost: () => (
    <Frame id="lost">
      <Circle cx={100} cy={66} r={16} {...line} />
      <Path d="M54 74 A50 18 -12 0 1 146 56" {...line} strokeOpacity={0.6} />
      <Path d="M146 56 A50 18 -12 0 1 54 74" {...faint} strokeDasharray="2 5" />
      <Path d="M150 52 C 170 40, 182 36, 196 30" {...faint} strokeDasharray="2 5" />
      <Spark x={200} y={28} r={7} />
    </Frame>
  ),
  // Two worlds with the thread between them cut.
  link: () => (
    <Frame id="link" limb="none">
      <Circle cx={60} cy={78} r={22} {...line} />
      <Circle cx={180} cy={70} r={18} {...line} />
      <Path d="M82 74 C 100 58, 108 56, 114 58" {...line} strokeOpacity={0.6} />
      <Path d="M128 58 C 136 56, 148 58, 162 66" {...line} strokeOpacity={0.6} />
      <Spark x={121} y={57} r={5} />
    </Frame>
  ),
  // Step 1: a question typed into the glass bar over the horizon.
  ask: () => (
    <Frame id="ask">
      <Rect x={26} y={52} width={188} height={36} rx={18} fill={INK} fillOpacity={0.1} stroke={INK} strokeOpacity={0.4} />
      <Line x1={44} y1={70} x2={124} y2={70} {...line} strokeOpacity={0.55} strokeWidth={2} />
      <Line x1={130} y1={63} x2={130} y2={77} {...line} />
      <Circle cx={196} cy={70} r={13} fill={BLUE} />
      <Path d="M190 70 H202 M197 65 L202 70 L197 75" stroke={INK} strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  ),
  // Step 2: two options weighed on a fine balance, factors hanging under each pan.
  weigh: () => (
    <Frame id="weigh">
      <Line x1={120} y1={30} x2={120} y2={112} {...line} />
      <Path d="M110 112 H130" {...line} />
      <Line x1={62} y1={46} x2={178} y2={34} {...line} />
      <Spark x={120} y={40} r={5} />
      <Path d="M62 46 L48 78 H76 Z" {...line} strokeOpacity={0.8} />
      <Path d="M178 34 L164 66 H192 Z" {...line} strokeOpacity={0.8} />
      {[[54, 72], [62, 70], [70, 72]].map(([x, y]) => <Circle key={x} cx={x} cy={y} r={2.2} fill={INK} />)}
      {[[172, 60], [184, 60]].map(([x, y]) => <Circle key={x} cx={x} cy={y} r={2.2} fill={INK} fillOpacity={0.6} />)}
    </Frame>
  ),
  // Step 3: the road forks; one branch runs on toward the lit horizon and the star.
  decide: () => (
    <Frame id="decide">
      <Path d="M120 140 C 120 112, 116 100, 104 86 C 92 72, 70 62, 46 56" {...faint} />
      <Path d="M120 140 C 120 110, 130 92, 150 74 C 166 60, 180 48, 188 38" {...line} strokeWidth={1.6} />
      <Spark x={190} y={34} r={9} />
      <Circle cx={46} cy={56} r={2} fill={INK} fillOpacity={0.4} />
    </Frame>
  ),
};

/** A spot illustration, `width` wide (150:240 aspect). Decorative: screen readers skip it. */
export function Illustration({ name, width = W }: { name: IllustrationName; width?: number }) {
  const Scene = SCENES[name];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height: (width * H) / W }}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`}>
        <Scene />
      </Svg>
    </View>
  );
}
