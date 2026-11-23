// The Archymedes poster artwork, drawn with react-native-svg and expo-linear-gradient so web and native match:
// the hairline ORION wordmark, its blue star, the dawn-over-water sky, deep space with a planet's lit limb, and frosted glass.
import { useMemo, useRef, type ReactNode } from "react";
import { Animated, Platform, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinear, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { animate, stagger, svg as animeSvg, utils } from "animejs";
import { tag, useAnime } from "./motion";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { colors } from "../theme/tokens";

// Letters on a 100-unit cap height: circle Os, an R whose leg leaves the bowl open, a plain I and N.
const LETTERS = "M98 50A48 48 0 1 1 2 50A48 48 0 1 1 98 50ZM136 98V2H166A24 24 0 0 1 166 50H136M158 50L194 98M232 98V2M364 50A48 48 0 1 1 268 50A48 48 0 1 1 364 50ZM402 98V2L478 98V2";
// A four-point star with concave sides, as on the posters.
const starPath = (cx: number, cy: number, r: number) => `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
const VIEW = { x: -4, y: -44, w: 548, h: 146 };

/** The blue four-point star from the wordmark. */
export function Star({ size = 16, color = colors.accent }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20">
      <Path d={starPath(10, 10, 10)} fill={color} />
    </Svg>
  );
}

/** ORION in hairline geometric capitals with the star at its upper right. `size` is roughly the equivalent font size. */
export function Wordmark({ size = 26, color = colors.white }: { size?: number; color?: string }) {
  const cap = size * 0.72;
  const height = (cap * VIEW.h) / 100;
  // Thicken the stroke at small sizes so it never drops below about 1.3px.
  const stroke = Math.max(3.6, 130 / cap);
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="ORION">
      <Svg width={(height * VIEW.w) / VIEW.h} height={height} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
        <Defs>
          <RadialGradient id="starGlow" cx="512" cy="-12" r="44" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={0.45} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Path d={LETTERS} fill="none" stroke={color} strokeWidth={stroke} />
        <Circle cx={512} cy={-12} r={44} fill="url(#starGlow)" />
        <Path d={starPath(512, -12, 28)} fill={colors.accent} />
      </Svg>
    </View>
  );
}

/** Frosted glass: a real backdrop blur (expo-blur) under a translucent tint and a thin light border. */
export function Glass({ children, style, intensity = 40, tint = colors.glass }: { children?: ReactNode; style?: StyleProp<ViewStyle>; intensity?: number; tint?: string }) {
  return (
    <View style={[{ overflow: "hidden", borderWidth: 1, borderColor: colors.line }, style]}>
      <BlurView intensity={intensity} tint="dark" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
      <View pointerEvents="none" style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: tint }} />
      {children}
    </View>
  );
}

export type Scene = "sky" | "night";
const fill: ViewStyle = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 };

/**
 * Fixed atmosphere behind a screen. "sky" is the dawn poster; "night" is the deep-space poster.
 * With `scrollY` the sky drifts up at a fraction of the page's speed, so the page feels layered over a real distance.
 */
export function Backdrop({ scene, scrollY, drift = true }: { scene: Scene; scrollY?: Animated.Value; /** False under reduced motion: the sky stays put (it still dims). */ drift?: boolean }) {
  const { width: W, height: H } = useWindowDimensions();
  const root = useRef<View>(null);
  // Slow, quiet motion (anime.js, web only): nothing here should pull the eye from the page.
  useAnime(root, () => {
    const loop = { loop: true, alternate: true, ease: "inOutSine" } as const;
    if (scene === "night") {
      animate(".am-star", { opacity: [1, 0.2], duration: () => utils.random(1800, 4600), delay: stagger(60, { from: "random" }), ...loop });
      animate(".am-halo", { opacity: [1, 0.7], duration: 5200, ...loop });
      animate(animeSvg.createDrawable(".am-meteor"), { draw: ["0 0", "0 1", "1 1"], opacity: [0, 1, 0], duration: 1400, ease: "inOutQuad", loop: true, loopDelay: 9000, delay: 2500 });
    } else {
      animate(".am-sun", { opacity: [1, 0.82], duration: 6400, ...loop });
      animate(".am-core", { opacity: [1, 0.65], duration: 3200, ...loop });
      animate(".am-path", { opacity: [1, 0.55], duration: 2200, ...loop });
      animate(".am-mote", {
        translateY: () => [0, -utils.random(50, 120)], translateX: () => [0, utils.random(-20, 20)],
        opacity: [0, 0.8, 0], duration: () => utils.random(7000, 13000), delay: stagger(700, { from: "random" }), loop: true, ease: "linear",
      });
      animate(".am-rim", { opacity: [1, 0.6], duration: 4800, ...loop });
    }
  }, [scene, W, H]);
  return (
    // The sky's last colour, so whatever the drifting layer uncovers below it is seamless.
    <View ref={root} pointerEvents="none" style={[fill, { overflow: "hidden", backgroundColor: scene === "sky" ? "#0B1015" : "#05080F" }]}>
      <Animated.View style={[fill, scrollY && drift && { transform: [{ translateY: scrollY.interpolate({ inputRange: [0, H * 2], outputRange: [0, -H * (scene === "sky" ? 0.32 : 0.18)], extrapolate: "clamp" }) }] }]}>
        {scene === "sky" ? <Dawn W={W} H={H} /> : <Space W={W} H={H} canvas={scrollY && drift ? H * 1.25 : H} />}
        {/* The water fades into the page colour, so when the sky drifts up there is no edge where it ends. */}
        {scrollY && scene === "sky" && (
          <LinearGradient style={[fill, { top: H * 0.78 }]} colors={["rgba(11,16,21,0)", "#0B1015"]} />
        )}
      </Animated.View>
      {/* Dusk falls as you read: the dawn sky dims under scrolled content so text over it stays legible. */}
      {scrollY && scene === "sky" && (
        <Animated.View style={[fill, { backgroundColor: "#070B12", opacity: scrollY.interpolate({ inputRange: [H * 0.15, H * 1.1], outputRange: [0, 0.72], extrapolate: "clamp" }) }]} />
      )}
    </View>
  );
}

function Dawn({ W, H }: { W: number; H: number }) {
  const wide = W >= 900;
  // On phones the input sits lower relative to the sky, so the horizon rises to keep the sun clear of it.
  const horizon = H * (wide ? 0.6 : 0.55);
  const sunX = W * 0.22;
  const planet = Math.max(420, Math.min(H * 1.05, W * 0.7));
  const pr = planet / 2;
  const pcx = W - planet * (wide ? 0.04 : 0.2);
  const pcy = -planet * (wide ? 0.2 : 0.14) + pr;
  // Ridges along the far shore, as fractions of the width and of a band just above the horizon.
  const ridge = (pts: [number, number][], band: number) =>
    `M0 ${horizon} ` + pts.map(([x, y]) => `L${x * W} ${horizon - y * band}`).join(" ") + ` L${W} ${horizon} Z`;
  const far = ridge([[0, 0.3], [0.07, 0.55], [0.13, 0.35], [0.21, 0.8], [0.29, 0.38], [0.37, 0.6], [0.46, 0.2], [0.55, 0.52], [0.63, 0.3], [0.72, 0.85], [0.81, 0.4], [0.89, 0.65], [1, 0.3]], H * 0.06);
  const motes = useMemo(() => Array.from({ length: 16 }, (_, i) => {
    const h = (n: number) => { const v = Math.sin(i * 91.7 + n * 47.3) * 43758.5453; return v - Math.floor(v); };
    return { x: sunX + (h(1) - 0.5) * W * 0.5, y: horizon - h(2) * H * 0.25, r: 0.8 + h(3) * 1.4 };
  }), [sunX, horizon, W, H]);
  const island = `M${W * 0.46} ${horizon + 2} C${W * 0.55} ${horizon - H * 0.01}, ${W * 0.6} ${horizon - H * 0.055}, ${W * 0.66} ${horizon - H * 0.06} C${W * 0.72} ${horizon - H * 0.055}, ${W * 0.8} ${horizon - H * 0.015}, ${W * 0.92} ${horizon + 2} Z`;
  return (
    <>
      <LinearGradient
        style={fill}
        colors={["#2B4877", "#4A6A9B", "#869EC1", "#C9BBBB", "#EFC8A0", "#7C8698", "#3A475D", "#18202D", "#0B1015"]}
        locations={[0, 0.2, 0.4, horizon / H - 0.08, horizon / H - 0.002, horizon / H + 0.005, horizon / H + 0.12, 0.88, 1]}
      />
      <Svg width={W} height={H} style={fill}>
        <Defs>
          <RadialGradient id="sun" cx={sunX} cy={horizon - 4} rx={W * 0.34} ry={H * 0.14} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFF1DC" stopOpacity={0.95} />
            <Stop offset="0.35" stopColor="#FFC892" stopOpacity={0.5} />
            <Stop offset="1" stopColor="#FFB482" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="sunCore" cx={sunX} cy={horizon - 2} r={H * 0.03} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
            <Stop offset="1" stopColor="#FFF1DC" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="path" cx={sunX} cy={horizon + H * 0.08} rx={W * 0.022} ry={H * 0.09} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFE2BE" stopOpacity={0.3} />
            <Stop offset="1" stopColor="#FFE2BE" stopOpacity={0} />
          </RadialGradient>
          {/* The planet: a pale translucent body, lit hardest on the side facing the low sun. */}
          <RadialGradient id="planetBody" cx={pcx + pr * 0.35} cy={pcy + pr * 0.45} r={pr * 1.15} gradientUnits="userSpaceOnUse">
            <Stop offset="0.45" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="0.8" stopColor="#DCE6F7" stopOpacity={0.05} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.24} />
          </RadialGradient>
          <SvgLinear id="planetRim" x1={pcx - pr} y1={pcy - pr * 0.2} x2={pcx + pr * 0.4} y2={pcy + pr} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFF6EA" stopOpacity={0.95} />
            <Stop offset="0.5" stopColor="#E6EEFB" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
          </SvgLinear>
          <SvgLinear id="ridge" x1="0" y1={horizon - H * 0.06} x2="0" y2={horizon} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#6E7D99" stopOpacity={0.85} />
            <Stop offset="1" stopColor="#4F5D78" stopOpacity={0.9} />
          </SvgLinear>
          <SvgLinear id="shore" x1="0" y1={horizon} x2="0" y2={horizon + 2} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFEBD2" stopOpacity={0.7} />
            <Stop offset="1" stopColor="#FFEBD2" stopOpacity={0} />
          </SvgLinear>
        </Defs>
        <Rect {...tag("am-sun")} x={0} y={0} width={W} height={horizon + H * 0.025} fill="url(#sun)" />
        <Circle cx={pcx} cy={pcy} r={pr} fill="url(#planetBody)" />
        <Circle {...tag("am-rim")} cx={pcx} cy={pcy} r={pr - 1} fill="none" stroke="url(#planetRim)" strokeWidth={2} />
        <Circle cx={pcx} cy={pcy} r={pr + 6} fill="none" stroke="url(#planetRim)" strokeOpacity={0.18} strokeWidth={14} />
        <Path d={far} fill="url(#ridge)" />
        <Path d={island} fill="#2C384D" fillOpacity={0.95} />
        <Rect x={0} y={horizon} width={W} height={2} fill="url(#shore)" />
        <Circle {...tag("am-core")} cx={sunX} cy={horizon - 2} r={H * 0.03} fill="url(#sunCore)" />
        <Rect {...tag("am-path")} x={0} y={horizon} width={W} height={H - horizon} fill="url(#path)" />
        {/* Light motes drifting up from the sun's glow; still unless animated. */}
        {motes.map((m, i) => <Circle key={i} {...tag("am-mote")} cx={m.x} cy={m.y} r={m.r} fill="#FFF1DC" opacity={0} />)}
      </Svg>
    </>
  );
}

/** `canvas`: drawn height. Taller than the screen when the sky drifts, so its lower edge never comes into view. */
function Space({ W, H, canvas = H }: { W: number; H: number; canvas?: number }) {
  // The planet is huge and low, so only its lit limb sweeps across the screen from lower left to upper right.
  const r = Math.max(W, H) * 0.95;
  const cx = W * 0.26 + r;
  const cy = H * 0.3 + r;
  // Stars, placed by a fixed hash so they never jump between renders.
  const stars = useMemo(() => Array.from({ length: 70 }, (_, i) => {
    const h = (n: number) => { const s = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s); };
    return { x: h(1) * W, y: h(2) * H * 0.7, r: 0.4 + h(3) * 0.9, o: 0.15 + h(4) * 0.5 };
  }), [W, H]);
  return (
    <>
      <LinearGradient style={[fill, { bottom: H - canvas }]} colors={["#0B1322", "#070C16", "#05080F"]} locations={[0, 0.55 * H / canvas, 1]} />
      <Svg width={W} height={canvas} style={[fill, { bottom: H - canvas }]}>
        <Defs>
          <RadialGradient id="body" cx={cx - r * 0.3} cy={cy - r * 0.3} r={r * 1.05} gradientUnits="userSpaceOnUse">
            <Stop offset="0.6" stopColor="#03060C" stopOpacity={1} />
            <Stop offset="0.85" stopColor="#0A1426" stopOpacity={1} />
            <Stop offset="0.97" stopColor="#1B3466" stopOpacity={1} />
            <Stop offset="1" stopColor="#6F95E2" stopOpacity={1} />
          </RadialGradient>
          {/* The lit limb is brightest at the top of the arc and fades toward the lower left. */}
          <SvgLinear id="limb" x1={cx - r} y1={cy} x2={cx} y2={cy - r} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#8DB2FF" stopOpacity={0.15} />
            <Stop offset="0.55" stopColor="#B9D0FF" stopOpacity={0.7} />
            <Stop offset="1" stopColor="#F2F7FF" stopOpacity={1} />
          </SvgLinear>
          <SvgLinear id="meteor" x1={W * 0.18} y1={H * 0.08} x2={W * 0.34} y2={H * 0.2} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
            <Stop offset="1" stopColor="#E6EEFF" stopOpacity={0.9} />
          </SvgLinear>
          <RadialGradient id="halo" cx={cx} cy={cy} r={r + 120} gradientUnits="userSpaceOnUse">
            <Stop offset={r / (r + 120)} stopColor="#9DBBFF" stopOpacity={0.42} />
            <Stop offset={(r + 14) / (r + 120)} stopColor="#6F95E2" stopOpacity={0.14} />
            <Stop offset={(r + 50) / (r + 120)} stopColor="#3D63B8" stopOpacity={0.05} />
            <Stop offset="1" stopColor="#3D63B8" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="floor" cx={W / 2} cy={canvas * 1.04} rx={W * 0.8} ry={H * 0.14} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#7AA0F0" stopOpacity={0.3} />
            <Stop offset="1" stopColor="#7AA0F0" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="haze" cx={W * 0.1} cy={0} rx={W * 0.6} ry={H * 0.4} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#284682" stopOpacity={0.35} />
            <Stop offset="1" stopColor="#284682" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={W} height={canvas} fill="url(#haze)" />
        {stars.map((s, i) => <Circle key={i} {...tag("am-star")} cx={s.x} cy={s.y} r={s.r} fill="#FFFFFF" fillOpacity={s.o} />)}
        {/* A shooting star, drawn now and then across the upper sky. */}
        <Line {...tag("am-meteor")} x1={W * 0.18} y1={H * 0.08} x2={W * 0.34} y2={H * 0.2} stroke="url(#meteor)" strokeWidth={1.4} strokeLinecap="round" opacity={0} />
        {/* Atmosphere: a smooth halo hugging the limb, under the planet's body. */}
        <Circle {...tag("am-halo")} cx={cx} cy={cy} r={r + 120} fill="url(#halo)" />
        <Circle cx={cx} cy={cy} r={r} fill="url(#body)" />
        <Circle cx={cx} cy={cy} r={r} fill="none" stroke="url(#limb)" strokeWidth={Platform.OS === "web" ? 1.6 : 1.2} />
        <Rect x={0} y={0} width={W} height={canvas} fill="url(#floor)" />
      </Svg>
    </>
  );
}
