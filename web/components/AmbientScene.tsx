"use client";
// The shader scenes behind Ambient. Their own module, so the `shaders` library (about 2.5 MB) downloads only when a
// scene is about to be drawn, not with every page that has an Ambient in it.
import { FilmGrain, FloatingParticles, Godrays, MeshGradient, Shader } from "shaders/react";
import type { Scene } from "./Ambient";

export default function AmbientScene({ scene, intensity, onReady, onUnavailable }: { scene: Scene; intensity: number; onReady: () => void; onUnavailable: () => void }) {
  return (
    <Shader disableTelemetry colorSpace="srgb" toneMapping="neutral" style={{ width: "100%", height: "100%" }} onReady={onReady} onUnavailable={onUnavailable}>
      {scene === "dawn" ? <Dawn k={intensity} /> : <Night k={intensity} />}
    </Shader>
  );
}

function Dawn({ k }: { k: number }) {
  return (
    <>
      {/* Sunlight breaking over Earth's limb, cool and faint, so the orbit photograph stays the hero. */}
      <Godrays center={{ x: 0.5, y: 0.86 }} rayColor="#cfe0ff" backgroundColor="transparent"
        density={0.14} intensity={0.4} spotty={0.2} speed={0.1} blendMode="screen" opacity={0.16 * k} />
      <FloatingParticles count={160} particleSize={0.55} speed={0.05} angle={95} angleVariance={25} randomness={0.35}
        twinkle={0.9} softness={0.15} particleColor="#ffffff" opacity={0.4 * k} />
    </>
  );
}

function Night({ k }: { k: number }) {
  return (
    <>
      <MeshGradient count={5} smoothness={2.4} variation={0.25} swirl={0.18} drift={0.35} speed={0.35} seed={7} colorSpace="oklab"
        stops={[
          { color: "#05080f", position: 0 },
          { color: "#0a1430", position: 0.3 },
          { color: "#123a9c", position: 0.62 },
          { color: "#1c66fe", position: 0.82 },
          { color: "#3a2a3a", position: 1 },
        ]} opacity={k} />
      <Godrays center={{ x: 0.82, y: -0.1 }} rayColor="#7faaff" backgroundColor="transparent"
        density={0.18} intensity={0.45} spotty={0.2} speed={0.12} blendMode="screen" opacity={0.18 * k} />
      <FloatingParticles count={420} particleSize={0.8} speed={0.03} angle={90} angleVariance={180} randomness={0.2}
        twinkle={1} softness={0.3} particleColor="#dfe8ff" opacity={0.55 * k} />
      <FilmGrain strength={0.22} bias={2} />
    </>
  );
}
