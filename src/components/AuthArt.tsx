// Animated abstract sky for the sign-in page: soft drifting orbs, thin orbit
// rings and twinkling stars in the ORION dusk palette. Decorative only and
// static when the person asks for less motion.
import { useEffect, useRef } from "react";
import { Animated, Platform, View, useWindowDimensions } from "react-native";
import { Star, css, useReducedMotion } from "./ui";
import { colors } from "../theme/tokens";

const web = Platform.OS === "web";

function useDrift(spanX: number, spanY: number, duration: number, offset = 0) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      t.setValue(0.5);
      return;
    }
    t.setValue(offset);
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, useNativeDriver: !web }),
        Animated.timing(t, { toValue: 0, duration, useNativeDriver: !web }),
      ])
    );
    run.start();
    return () => run.stop();
  }, [duration, offset, reduced, t]);
  return {
    transform: [
      { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-spanX, spanX] }) },
      { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [spanY, -spanY] }) },
    ],
  } as const;
}

function useTwinkle(duration: number, offset = 0) {
  const reduced = useReducedMotion();
  const t = useRef(new Animated.Value(0.6)).current;
  useEffect(() => {
    if (reduced) {
      t.setValue(0.8);
      return;
    }
    t.setValue(offset);
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration, useNativeDriver: !web }),
        Animated.timing(t, { toValue: 0.25, duration, useNativeDriver: !web }),
      ])
    );
    run.start();
    return () => run.stop();
  }, [duration, offset, reduced, t]);
  return { opacity: t } as const;
}

export function AuthArt() {
  const { width } = useWindowDimensions();
  const wide = width >= 1200;
  const orbA = useDrift(18, 22, 9000);
  const orbB = useDrift(26, 16, 12000, 0.4);
  const orbC = useDrift(14, 26, 14000, 0.7);
  const ringA = useDrift(10, 14, 11000, 0.2);
  const ringB = useDrift(16, 10, 15000, 0.6);
  const tw1 = useTwinkle(2600);
  const tw2 = useTwinkle(3400, 0.5);
  const tw3 = useTwinkle(4200, 0.8);

  const blurSoft = css(web ? { filter: "blur(70px)" } : {});
  const blurHard = css(web ? { filter: "blur(90px)" } : {});

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={{ position: "absolute", top: -120, right: -80, bottom: -80, left: -80, overflow: "hidden" }}
    >
      {/* Warm horizon glow, echoing the home sky. */}
      <Animated.View
        style={[
          { position: "absolute", left: "4%", top: "30%", width: 420, height: 300, borderRadius: 200, opacity: 0.55 },
          css({
            backgroundImage:
              "radial-gradient(ellipse at center, rgba(255,236,206,0.85) 0%, rgba(255,198,146,0.35) 45%, rgba(255,198,146,0) 72%)",
          }),
          blurSoft,
          orbA,
        ]}
      />
      {/* Electric-blue signal orb. */}
      <Animated.View
        style={[
          { position: "absolute", right: wide ? "6%" : "-10%", top: "6%", width: 360, height: 360, borderRadius: 180, opacity: 0.5 },
          css({
            backgroundImage:
              "radial-gradient(circle at center, rgba(28,102,254,0.55) 0%, rgba(63,127,255,0.22) 48%, rgba(28,102,254,0) 72%)",
          }),
          blurHard,
          orbB,
        ]}
      />
      {/* Cool violet depth orb. */}
      <Animated.View
        style={[
          { position: "absolute", left: wide ? "38%" : "20%", bottom: "2%", width: 380, height: 260, borderRadius: 160, opacity: 0.4 },
          css({
            backgroundImage:
              "radial-gradient(ellipse at center, rgba(127,170,255,0.4) 0%, rgba(74,106,155,0.22) 50%, rgba(74,106,155,0) 72%)",
          }),
          blurSoft,
          orbC,
        ]}
      />
      {/* Thin orbit rings, tilted like the planet's lit edge. */}
      <Animated.View
        style={[
          {
            position: "absolute", right: wide ? "10%" : "2%", top: "12%", width: 220, height: 220, borderRadius: 110,
            borderWidth: 1, borderColor: colors.lineStrong, opacity: 0.5,
          },
          css({ transform: "rotate(-18deg) scaleY(0.62)" }),
          ringA,
        ]}
      />
      <Animated.View
        style={[
          {
            position: "absolute", right: wide ? "8%" : "-4%", top: "9%", width: 280, height: 280, borderRadius: 140,
            borderWidth: 1, borderColor: colors.accentLine, opacity: 0.35,
          },
          css({ transform: "rotate(-18deg) scaleY(0.62)" }),
          ringB,
        ]}
      />
      {/* Twinkling four-point stars from the wordmark. */}
      <Animated.View style={[{ position: "absolute", left: "12%", top: "12%" }, tw1]}>
        <Star size={14} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", left: "44%", top: "6%" }, tw2]}>
        <Star size={10} />
      </Animated.View>
      <Animated.View style={[{ position: "absolute", right: "22%", top: "38%" }, tw3]}>
        <Star size={12} />
      </Animated.View>
    </View>
  );
}
