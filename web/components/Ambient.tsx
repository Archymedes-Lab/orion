"use client";
// Living light, drawn on the GPU with `shaders` (WebGPU). Two quiet scenes, both made to sit over a static layer that is
// already complete on its own: if the browser has no WebGPU, the person prefers reduced motion, or the section is off
// screen, nothing mounts and the photo or gradient underneath is the design. Telemetry to shaders.com is switched off.
//
//   dawn   cool light over Earth's limb and slow drifting stars over the hero photograph
//   night  a slow brand-palette mesh gradient (deep navy, ORION blue, a trace of dawn) with fine stars and grain
import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from "react";

// Loaded on first use: see AmbientScene.tsx.
const AmbientScene = lazy(() => import("./AmbientScene"));

export type Scene = "dawn" | "night";

export function Ambient({ scene, className, style, intensity = 1 }: { scene: Scene; className?: string; style?: CSSProperties; intensity?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
    const update = () => setAllowed(gpu && !motion.matches);
    update();
    motion.addEventListener("change", update);
    const el = ref.current;
    const io = el ? new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" }) : null;
    if (el && io) io.observe(el);
    return () => { motion.removeEventListener("change", update); io?.disconnect(); };
  }, []);

  return (
    <div ref={ref} aria-hidden className={className}
      style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: ready ? 1 : 0, transition: "opacity 1.6s var(--ease)", ...style }}>
      {allowed && visible && (
        <Suspense fallback={null}>
          <AmbientScene scene={scene} intensity={intensity} onReady={() => setReady(true)} onUnavailable={() => setAllowed(false)} />
        </Suspense>
      )}
    </div>
  );
}
