// The Futures scene, in plain three.js. Time runs away from the viewer (half log-time, half even spacing), height is the
// net effect felt so far, and every option is a path of light. The pictured option carries its likely range as a glass
// ribbon and a fan of faint filaments (possible futures sampled from that range); the others run beside it.
//
// What it must say without hovering: which path comes out ahead (a badge at the horizon), how likely each path is to
// go well (printed at the cursor and at the horizon), and when the lead changes hands (a marker on the floor).
// Interaction: drag to orbit, ⌘/Ctrl + scroll or pinch to zoom, double-click to reset, click a path to picture it,
// click a gate to read that moment. Imperative by design: one renderer, one loop, paused off screen, disposed with
// the component. Labels are DOM elements positioned each frame, so text stays crisp and selectable by assistive tech.
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
// Text drawn in the scene uses the module language, which the page keeps current; a language change re-sends data.
import { t } from "@orion/i18n/index.ts";
import type { Futures } from "@/lib/futures";

const C = {
  blue: new THREE.Color("#4a84fb"),
  blueHot: new THREE.Color("#a9c6ff"),
  amber: new THREE.Color("#c98a4b"),
  well: new THREE.Color("#7faaff"),
  mixed: new THREE.Color("#8a93a6"),
  hard: new THREE.Color("#d08a4a"),
  grid: new THREE.Color("#18233a"),
  win: new THREE.Color("#6fe3b4"),
  bg: new THREE.Color("#05080f"),
};
const LENGTH = 12;   // world units from the first moment to the last
const START = 1.6;   // where the first moment sits after "now"
const Y = 0.42;      // world units per point of net effect (−10..10)
const FLOOR = -2.5;
const MID = START + LENGTH / 2;

export type ViewMode = "depth" | "side";
export interface SceneHandle {
  setData(f: Futures): void;
  setMoment(i: number): void;
  setView(v: ViewMode): void;
  zoom(step: number): void;
  resetView(): void;
  dispose(): void;
}

interface PathRec { id: string; core: Line2; glow: Line2 | null; hit: THREE.Mesh; base: number; z: number; color: THREE.Color }

export function createFuturesScene(host: HTMLElement, overlay: HTMLElement, opts: {
  reducedMotion: boolean;
  onMoment: (i: number) => void;
  onPickPath: (id: string) => void;
  onHoverPath: (id: string | null) => void;
  onInteract: () => void;
}): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.touchAction = "pan-y"; // vertical swipes still scroll the page; horizontal drags orbit
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(C.bg, 16, 34);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);

  // Orbit state, in spherical coordinates around a target. `goal` is where the camera is easing towards.
  const HOME = { yaw: -0.62, pitch: 0.17, dist: 14.2, target: new THREE.Vector3(MID + 0.2, -0.75, 0) };
  const SIDE = { yaw: 0, pitch: 0.02, dist: 15.8, target: new THREE.Vector3(MID + 0.6, -0.7, 0) };
  const cam = { yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist, target: HOME.target.clone() };
  const goal = { yaw: HOME.yaw, pitch: HOME.pitch, dist: HOME.dist, target: HOME.target.clone() };
  let mode: ViewMode = "depth";
  let lastInteraction = -1e9;

  // Reveal: everything right of this plane is hidden, and the plane sweeps from now to the horizon.
  const reveal = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const clip = [reveal];

  const world = new THREE.Group();
  scene.add(world);
  const content = new THREE.Group();
  world.add(content);

  // ── Static furniture: floor grid, neutral line, the "now" star, dust ───────
  const gridMat = new THREE.LineBasicMaterial({ color: C.grid, transparent: true, opacity: 0.9 });
  const gridPts: number[] = [];
  for (let x = 0; x <= START + LENGTH + 1.01; x += 1) gridPts.push(x, FLOOR, -4, x, FLOOR, 4);
  for (let z = -4; z <= 4.01; z += 1) gridPts.push(0, FLOOR, z, START + LENGTH + 1, FLOOR, z);
  const gridGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(gridPts, 3));
  world.add(new THREE.LineSegments(gridGeo, gridMat));

  const zeroGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(START + LENGTH + 0.8, 0, 0)]);
  const zeroMat = new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, dashSize: 0.12, gapSize: 0.14 });
  const zero = new THREE.Line(zeroGeo, zeroMat);
  zero.computeLineDistances();
  world.add(zero);

  const glowTex = radialTexture();
  const starTex = starTexture();
  const now = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: 0x6f9bff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  now.scale.setScalar(0.9);
  world.add(now);
  const nowHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.blue, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
  nowHalo.scale.setScalar(2.4);
  world.add(nowHalo);

  const dustGeo = new THREE.BufferGeometry();
  const dust = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) { dust[i * 3] = Math.random() * 22 - 4; dust[i * 3 + 1] = Math.random() * 10 - 4; dust[i * 3 + 2] = Math.random() * 16 - 10; }
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dust, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9fb6e8, size: 0.025, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  world.add(dustPts);

  // Time cursor: a pale vertical sheet through the chosen moment, with a bright edge.
  const cursorMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: C.blue } },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 uColor; varying vec2 vUv;
      void main() { float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(0.0, 0.12, 1.0 - vUv.x);
        float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));
        gl_FragColor = vec4(uColor, 0.07 * edge * fade); }`,
  });
  const cursor = new THREE.Mesh(new THREE.PlaneGeometry(7, 7.5), cursorMat);
  cursor.rotation.y = Math.PI / 2;
  cursor.position.set(START, FLOOR + 3.75, 0);
  world.add(cursor);
  const cursorLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, FLOOR, 0), new THREE.Vector3(0, 4.2, 0)]),
    new THREE.LineBasicMaterial({ color: C.blueHot, transparent: true, opacity: 0.35 }),
  );
  world.add(cursorLine);

  // ── Per-decision content ────────────────────────────────────────────────────
  let data: Futures | null = null;
  let paths: PathRec[] = [];
  let gates: { ring: THREE.Mesh; hit: THREE.Mesh; x: number }[] = [];
  let markers: { id: string; sprite: THREE.Sprite; el: HTMLElement; pos: THREE.Vector3; goalY: number }[] = [];
  let lineMats: LineMaterial[] = [];
  let labels: { el: HTMLElement; at: THREE.Vector3; always?: boolean }[] = [];
  let axis: number[] = [];
  let moment = 0;
  let cursorX = START;
  let hoveredPath: string | null = null;
  let revealStart: number | null = null;
  let maxX = START + LENGTH;

  // Time axis: half log-time (early days get room), half even spacing (late years don't pile up).
  const xOf = (days: number) => {
    const maxDays = Math.max(1, axis[axis.length - 1] ?? 1);
    const log = Math.log1p(Math.max(0, days)) / Math.log1p(maxDays);
    if (axis.length < 2) return START + LENGTH * log;
    let j = axis.findIndex((d) => d >= days);
    if (j === -1) j = axis.length - 1;
    const prev = Math.max(0, j - 1);
    const span = axis[j] - axis[prev];
    const rank = (span > 0 ? prev + (days - axis[prev]) / span : j) / (axis.length - 1);
    return START + LENGTH * (0.5 * log + 0.5 * Math.min(1, Math.max(0, rank)));
  };

  function clear() {
    content.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose?.();
    });
    content.clear();
    overlay.replaceChildren();
    labels = []; paths = []; gates = []; markers = []; lineMats = [];
  }

  function label(html: string, at: THREE.Vector3, cls: string, always = false) {
    const el = document.createElement("div");
    el.className = cls;
    el.innerHTML = html;
    overlay.appendChild(el);
    labels.push({ el, at, always });
    return el;
  }

  function fatLine(points: THREE.Vector3[], color: THREE.Color, width: number, opacity: number) {
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const pts = curve.getPoints(Math.max(48, points.length * 28));
    const geo = new LineGeometry().setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false, clippingPlanes: clip, worldUnits: false });
    mat.resolution.set(host.clientWidth, host.clientHeight);
    lineMats.push(mat);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    content.add(line);
    return { line, curve };
  }

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  function setData(f: Futures) {
    clear();
    data = f;
    axis = f.moments.map((m) => m.days);
    maxX = xOf(f.maxDays);
    const pictured = f.paths.find((p) => p.pictured)!;
    const others = f.paths.filter((p) => !p.pictured);
    const zFor = (i: number) => (i % 2 === 0 ? -1 : 1) * (1.4 + Math.floor(i / 2) * 1.1);

    const pathPoints = (pts: { days: number; value: number }[], z: number) =>
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.7, 0, z * 0.55), ...pts.map((s) => new THREE.Vector3(xOf(s.days), s.value * Y, z))];

    const addHit = (curve: THREE.Curve<THREE.Vector3>, id: string) => {
      const hit = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.16, 6, false), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.pathId = id;
      content.add(hit);
      return hit;
    };

    // Alternatives: amber paths set back in depth; each can be clicked to picture it.
    others.forEach((p, i) => {
      const z = zFor(i);
      const pts = pathPoints(p.points, z);
      const { line, curve } = fatLine(pts, C.amber, 1.6, 0.8);
      paths.push({ id: p.id, core: line, glow: null, hit: addHit(curve, p.id), base: 0.8, z, color: C.amber });
    });

    // Possible futures: faint additive filaments sampled from the pictured option's spread.
    const strandMat = (tone: "well" | "mixed" | "hard") => new THREE.LineBasicMaterial({ color: C[tone], transparent: true, opacity: tone === "well" ? 0.15 : 0.1, blending: THREE.AdditiveBlending, depthWrite: false, clippingPlanes: clip });
    const mats = { well: strandMat("well"), mixed: strandMat("mixed"), hard: strandMat("hard") };
    f.strands.forEach((s, k) => {
      const spreadZ = ((k / f.strands.length) - 0.5) * 0.5;
      const pts = [new THREE.Vector3(0, 0, 0), ...pictured.points.map((p, i) => new THREE.Vector3(xOf(p.days), s.values[i] * Y, spreadZ * (i + 1) / pictured.points.length))];
      const geo = new THREE.BufferGeometry().setFromPoints(new THREE.CatmullRomCurve3(pts, false, "centripetal").getPoints(120));
      content.add(new THREE.Line(geo, mats[s.tone]));
    });

    // The likely range as a glass ribbon, brighter near now and fading into the projection.
    const ribbonMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, clipping: true, clippingPlanes: clip,
      uniforms: { uColor: { value: C.blue }, uMax: { value: maxX } },
      vertexShader: `varying float vX; varying float vV;
        #include <clipping_planes_pars_vertex>
        attribute float edge; void main() { vX = position.x; vV = edge;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <clipping_planes_vertex>
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uMax; varying float vX; varying float vV;
        #include <clipping_planes_pars_fragment>
        void main() {
          #include <clipping_planes_fragment>
          float along = 1.0 - smoothstep(0.0, uMax * 1.05, vX) * 0.6;
          float rim = smoothstep(0.0, 0.08, vV) * smoothstep(0.0, 0.08, 1.0 - vV);
          gl_FragColor = vec4(uColor, (0.13 * rim + (1.0 - rim) * 0.5) * along);
        }`,
    });
    content.add(new THREE.Mesh(ribbonGeometry(pictured.points.map((p) => ({ x: xOf(p.days), lo: p.low * Y, hi: p.high * Y }))), ribbonMat));

    // The pictured path: a soft wide glow under a bright core.
    const main = pathPoints(pictured.points, 0);
    const glow = fatLine(main, C.blue, 10, 0.2).line;
    const core = fatLine(main, C.blueHot, 2.4, 1);
    paths.push({ id: pictured.id, core: core.line, glow, hit: addHit(core.curve, pictured.id), base: 1, z: 0, color: C.blueHot });

    // Gates: a glass ring at each of the pictured option's moments, sized to its range there.
    pictured.points.forEach((p) => {
      const x = xOf(p.days), y = p.value * Y;
      const r = Math.max(0.22, ((p.high - p.low) / 2) * Y + 0.16);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, p.checkIn ? 0.008 : 0.005, 8, 96),
        new THREE.MeshBasicMaterial({ color: p.far ? C.mixed : C.blueHot, transparent: true, opacity: 0.3, depthWrite: false, clippingPlanes: clip }));
      ring.position.set(x, y, 0);
      ring.rotation.y = Math.PI / 2;
      content.add(ring);
      const node = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: C.blueHot, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
      node.position.set(x, y, 0);
      node.scale.setScalar(0.3);
      content.add(node);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.42, r), 12, 12), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.copy(ring.position);
      hit.userData.days = p.days;
      content.add(hit);
      gates.push({ ring, hit, x });
    });

    // Moment names on the floor, Swiss-chart style, with hairline drops from the pictured path.
    f.moments.forEach((m) => {
      const x = xOf(m.days);
      const own = pictured.points.find((p) => p.days === m.days);
      if (own) {
        const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, own.value * Y - 0.3, 0), new THREE.Vector3(x, FLOOR, 0)]),
          new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06, clippingPlanes: clip }));
        content.add(drop);
      }
      label(esc(m.when), new THREE.Vector3(x, FLOOR, 0), `fx-when${m.far ? " fx-when--far" : ""}`);
    });

    // The horizon: each path's name and its chance of going well; the winner wears the badge.
    const last = f.moments[f.moments.length - 1];
    f.paths.forEach((p) => {
      const rec = paths.find((r) => r.id === p.id)!;
      const end = p.points[p.points.length - 1];
      const r = last.readings.find((x) => x.id === p.id)!;
      const isWin = f.winner.id === p.id && !f.winner.close;
      const badge = isWin ? `<span class="fx-badge">${esc(t("Comes out ahead"))}</span>` : f.winner.close && f.winner.id === p.id ? `<span class="fx-badge fx-badge--close">${esc(t("Too close to call"))}</span>` : "";
      label(`${badge}<span class="fx-end__name">${esc(p.label)}</span><span class="fx-end__pct">${esc(t("{well} goes well · {score}", { well: pct(r.odds.well), score: r.score }))}</span>`,
        new THREE.Vector3(xOf(end.days) + 0.3, end.value * Y, rec.z), `fx-end${p.pictured ? "" : " fx-end--alt"}${isWin ? " fx-end--win" : ""}`, true).dataset.path = p.id;
      if (isWin) {
        const crown = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: C.win, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, clippingPlanes: clip }));
        crown.position.set(xOf(end.days), end.value * Y, rec.z);
        crown.scale.setScalar(0.42);
        content.add(crown);
      }
    });

    // Where the lead changes hands: a small diamond on the floor and a note.
    if (f.leadChange) {
      const m = f.moments[f.leadChange.index];
      const x = xOf(m.days);
      const to = f.paths.find((p) => p.id === f.leadChange!.toId)!;
      const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshBasicMaterial({ color: C.win, transparent: true, opacity: 0.9, clippingPlanes: clip }));
      diamond.position.set(x, FLOOR + 0.12, 0);
      content.add(diamond);
      label(`<span>${esc(t("Lead changes"))}</span><b>${esc(t("{option} takes over", { option: to.label }))}</b>`, new THREE.Vector3(x, FLOOR + 0.12, 0), "fx-cross");
    }

    // Cursor markers: one glowing dot per path, with a readout that follows it.
    f.paths.forEach((p) => {
      const rec = paths.find((r) => r.id === p.id)!;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: p.pictured ? C.blueHot : C.amber, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sprite.scale.setScalar(0.55);
      content.add(sprite);
      const el = document.createElement("div");
      el.className = `fx-read${p.pictured ? "" : " fx-read--alt"}`;
      overlay.appendChild(el);
      markers.push({ id: p.id, sprite, el, pos: new THREE.Vector3(START, 0, rec.z), goalY: 0 });
    });

    revealStart = null;
    setMoment(Math.min(moment, f.moments.length - 1));
  }

  function setMoment(i: number) {
    if (!data) return;
    moment = Math.max(0, Math.min(data.moments.length - 1, i));
    const m = data.moments[moment];
    for (const mk of markers) {
      const r = m.readings.find((x) => x.id === mk.id)!;
      mk.goalY = r.value * Y;
      const lead = m.leaderId === mk.id && !m.close;
      mk.el.innerHTML = `<b>${r.score}</b><span>${esc(t("{well} goes well", { well: pct(r.odds.well) }))}</span>${lead ? `<i>${esc(t("Ahead"))}</i>` : ""}`;
      mk.el.classList.toggle("fx-read--lead", lead);
    }
  }

  // ── Interaction ─────────────────────────────────────────────────────────────
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  const pointers = new Map<number, { x: number; y: number }>();
  let drag: { x: number; y: number; moved: number } | null = null;
  let pinch = 0;
  // `framed` while the camera is still where a view preset put it; a resize then re-fits it.
  let framed = true;
  const touch = () => { lastInteraction = performance.now(); framed = false; opts.onInteract(); };

  const onDown = (e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) goal.dist = clampDist(goal.dist * (pinch / d));
      pinch = d;
      touch();
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.moved > 4) {
        goal.yaw -= dx * 0.005;
        goal.pitch = Math.max(-0.05, Math.min(1.1, goal.pitch + dy * 0.004));
        canvas.style.cursor = "grabbing";
        touch();
      }
    }
  };
  const onUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
    const clicked = drag && drag.moved <= 4;
    drag = null;
    canvas.style.cursor = "";
    if (!clicked) return;
    ray.setFromCamera(pointer, camera);
    const gate = ray.intersectObjects(gates.map((g) => g.hit))[0];
    if (gate && data) { opts.onMoment(data.moments.findIndex((m) => m.days === gate.object.userData.days)); return; }
    const hit = ray.intersectObjects(paths.map((p) => p.hit))[0];
    if (hit) opts.onPickPath(hit.object.userData.pathId as string);
  };
  const onLeave = () => { pointer.set(9, 9); };
  const onWheel = (e: WheelEvent) => {
    // Zoom only on purpose (⌘/Ctrl + scroll, or a trackpad pinch, which arrives with ctrlKey): the page keeps scrolling.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    goal.dist = clampDist(goal.dist * Math.exp(e.deltaY * 0.0025));
    touch();
  };
  const onDbl = () => resetView();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDbl);
  const clampDist = (d: number) => Math.max(6.5, Math.min(26, d));

  // Narrow stages pull the camera back until the whole run from now to the horizon fits across.
  const fitDist = (d: number) => {
    const across = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect;
    return clampDist(Math.max(d, (mode === "side" ? 9 : 8) / Math.max(0.01, across)));
  };
  function setView(v: ViewMode) {
    mode = v;
    const p = v === "side" ? SIDE : HOME;
    goal.yaw = p.yaw; goal.pitch = p.pitch; goal.dist = fitDist(p.dist); goal.target.copy(p.target);
    framed = true;
    // Not `touch()`: the page sets the view on load, and that must not count as the visitor's first interaction.
    lastInteraction = performance.now();
  }
  function resetView() { setView(mode); }

  // ── Size & visibility ───────────────────────────────────────────────────────
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    camera.aspect = w / Math.max(1, h);
    camera.fov = w < 640 ? 50 : 34; // narrow screens pull back so the whole horizon fits
    camera.updateProjectionMatrix();
    lineMats.forEach((m) => m.resolution.set(w, h));
    if (framed) goal.dist = fitDist((mode === "side" ? SIDE : HOME).dist);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();
  let onScreen = true;
  const io = new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; });
  io.observe(host);

  // ── Loop ────────────────────────────────────────────────────────────────────
  const tmp = new THREE.Vector3();
  let raf = 0;
  const ease = (from: number, to: number, k: number) => from + (to - from) * k;
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    if (!onScreen || document.hidden) return;
    const time = t / 1000;

    // Draw-in: starts the first time the scene is on screen, sweeps from now to the horizon (expo-out).
    revealStart ??= t;
    const k = opts.reducedMotion ? 1 : Math.min(1, (t - revealStart) / 2200);
    reveal.constant = -0.2 + (maxX + 1.6) * (k >= 1 ? 1 : 1 - Math.pow(2, -10 * k));

    // Camera: ease towards the goal; a slow breathing drift only while nobody is touching it.
    const idle = !opts.reducedMotion && mode === "depth" && t - lastInteraction > 5000;
    const damp = opts.reducedMotion ? 1 : 0.08;
    cam.yaw = ease(cam.yaw, goal.yaw + (idle ? Math.sin(time * 0.12) * 0.05 : 0), damp);
    cam.pitch = ease(cam.pitch, goal.pitch + (idle ? Math.cos(time * 0.1) * 0.02 : 0), damp);
    cam.dist = ease(cam.dist, goal.dist, damp);
    cam.target.lerp(goal.target, damp);
    camera.position.set(
      cam.target.x + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw),
      cam.target.y + cam.dist * Math.sin(cam.pitch),
      cam.target.z + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw),
    );
    camera.lookAt(cam.target);

    // Hover a path: it brightens, the others step back.
    if (!drag) {
      ray.setFromCamera(pointer, camera);
      const hit = ray.intersectObjects(paths.map((p) => p.hit))[0];
      const h = hit ? (hit.object.userData.pathId as string) : null;
      if (h !== hoveredPath) { hoveredPath = h; opts.onHoverPath(h); canvas.style.cursor = h ? "pointer" : ""; }
    }
    for (const p of paths) {
      const target = hoveredPath && hoveredPath !== p.id ? p.base * 0.35 : hoveredPath === p.id ? 1 : p.base;
      const m = p.core.material as LineMaterial;
      m.opacity = ease(m.opacity, target, 0.15);
      if (p.glow) (p.glow.material as LineMaterial).opacity = ease((p.glow.material as LineMaterial).opacity, hoveredPath && hoveredPath !== p.id ? 0.06 : 0.2, 0.15);
    }

    // Cursor and markers glide to the chosen moment.
    if (data) {
      const goalX = xOf(data.moments[moment].days);
      cursorX = ease(cursorX, goalX, opts.reducedMotion ? 1 : 0.12);
      cursor.position.x = cursorX;
      cursorLine.position.x = cursorX;
      const shown = cursorX <= reveal.constant;
      cursor.visible = cursorLine.visible = shown;
      for (const mk of markers) {
        mk.pos.set(cursorX, ease(mk.pos.y, mk.goalY, opts.reducedMotion ? 1 : 0.12), mk.pos.z);
        mk.sprite.position.copy(mk.pos);
        mk.sprite.visible = shown;
      }
      gates.forEach((g) => {
        const mat = g.ring.material as THREE.MeshBasicMaterial;
        const active = Math.abs(g.x - goalX) < 0.01;
        mat.opacity = ease(mat.opacity, active ? 0.95 : 0.28, 0.12);
        g.ring.scale.setScalar(active && !opts.reducedMotion ? 1 + Math.sin(time * 3) * 0.04 : 1);
      });
    }

    nowHalo.material.opacity = 0.45 + (opts.reducedMotion ? 0 : Math.sin(time * 1.6) * 0.12);
    now.material.rotation = opts.reducedMotion ? 0 : time * 0.15;

    renderer.render(scene, camera);

    // DOM labels follow their anchors; anything not yet revealed, or behind the camera, is hidden.
    // Labels that would overlap (path names at the horizon, readouts at the cursor) are stacked apart vertically.
    const w = host.clientWidth, hh = host.clientHeight;
    const project = (at: THREE.Vector3) => { tmp.copy(at).project(camera); return { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * hh, front: tmp.z < 1 }; };
    const stack = (items: { el: HTMLElement; x: number; y: number; visible: boolean }[], gap: number) => {
      const shown = items.filter((i) => i.visible).sort((a, b) => a.y - b.y);
      for (let i = 1; i < shown.length; i++) {
        const prev = shown[i - 1], cur = shown[i];
        const need = gap < 0 ? prev.el.offsetHeight + 6 : gap; // gap < 0: use the label's own height
        if (Math.abs(cur.x - prev.x) < 220 && cur.y - prev.y < need) cur.y = prev.y + need;
      }
      for (const i of items) {
        i.el.style.opacity = i.visible ? "" : "0";
        // Keep labels inside the stage; near the right edge they slide left rather than get cut off.
        const x = Math.min(i.x, w - i.el.offsetWidth - 16);
        i.el.style.transform = `translate3d(${x}px, ${i.y}px, 0)`;
      }
    };
    const box = (el: HTMLElement) => el.getBoundingClientRect();
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const plain: { el: HTMLElement; x: number; y: number; visible: boolean }[] = [];
    const ends: typeof plain = [];
    for (const l of labels) {
      const p = project(l.at);
      (l.el.dataset.path ? ends : plain).push({ el: l.el, x: p.x, y: p.y, visible: l.at.x <= reveal.constant && p.front });
      if (l.el.dataset.path) l.el.classList.toggle("fx-dim", !!hoveredPath && hoveredPath !== l.el.dataset.path);
    }
    // Floor names that would run into each other (narrow screens, side view) give way left to right; the timeline
    // under the scene names every moment anyway.
    let lastX = -Infinity;
    for (const i of plain.filter((x) => x.el.classList.contains("fx-when") && x.visible).sort((a, b) => a.x - b.x)) {
      if (i.x - lastX < 100) i.visible = false; else lastX = i.x;
    }
    stack(plain, 0);
    // At the horizon the path labels already carry each option's numbers, so the cursor readouts step aside.
    // On a narrow stage there is no room for both at once: the horizon labels wait for the horizon.
    const atHorizon = !!data && moment === data.moments.length - 1;
    if (w < 640 && !atHorizon) for (const e of ends) e.visible = false;
    stack(ends, -1);
    const endBoxes = ends.filter((e) => e.visible).map((e) => box(e.el));
    for (const p of plain) if (p.visible && p.el.classList.contains("fx-when") && endBoxes.some((b) => overlaps(box(p.el), b))) p.el.style.opacity = "0";
    const reads = markers.map((mk) => { const p = project(mk.pos); return { el: mk.el, x: p.x, y: p.y, visible: atHorizon ? false : mk.pos.x <= reveal.constant && p.front && (!hoveredPath || hoveredPath === mk.id) }; });
    stack(reads, 26);
    // The lead-change note gives way to the readouts and horizon labels when they meet (the timeline marks that moment with ◆ as well).
    const cross = overlay.querySelector<HTMLElement>(".fx-cross");
    if (cross && cross.style.opacity !== "0") {
      const c = box(cross);
      if (reads.some((r) => r.visible && overlaps(c, box(r.el))) || endBoxes.some((b) => overlaps(c, b))) cross.style.opacity = "0";
    }
  };
  raf = requestAnimationFrame(tick);

  return {
    setData,
    setMoment,
    setView,
    zoom(step) { goal.dist = clampDist(goal.dist * (step > 0 ? 0.82 : 1.22)); touch(); },
    resetView,
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
      clear();
      [gridGeo, zeroGeo, dustGeo, cursor.geometry, cursorLine.geometry].forEach((g) => g.dispose());
      [gridMat, zeroMat, now.material, nowHalo.material, dustPts.material, cursorMat, cursorLine.material].forEach((m) => m.dispose());
      glowTex.dispose(); starTex.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}

/** A vertical strip from low to high along the path; `edge` is 0 at the low edge and 1 at the high edge. */
function ribbonGeometry(cols: { x: number; lo: number; hi: number }[]) {
  const n = 96, rows = 6;
  const lo = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), ...cols.map((c) => new THREE.Vector3(c.x, c.lo, 0))], false, "centripetal").getPoints(n);
  const hi = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), ...cols.map((c) => new THREE.Vector3(c.x, c.hi, 0))], false, "centripetal").getPoints(n);
  const pos: number[] = [], edge: number[] = [], idx: number[] = [];
  for (let i = 0; i <= n; i++) for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    pos.push(lo[i].x + (hi[i].x - lo[i].x) * t, lo[i].y + (hi[i].y - lo[i].y) * t, 0);
    edge.push(t);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) {
    const a = i * (rows + 1) + j, b = a + rows + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("edge", new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  return g;
}

function radialTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The brand's four-point star with concave sides, as a texture. */
function starTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const r = 110, m = 128;
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(m, m - r); g.quadraticCurveTo(m, m, m + r, m); g.quadraticCurveTo(m, m, m, m + r);
  g.quadraticCurveTo(m, m, m - r, m); g.quadraticCurveTo(m, m, m, m - r);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
