// ORION brand theme (§31–32), taken from the Archymedes launch posters in public/:
// dusk sky, frosted glass, thin geometric type, one electric-blue signal colour.
export const colors = {
  bg: "#0B1015",
  /** Frosted panel over the sky. */
  glass: "rgba(17,24,36,0.52)",
  glassStrong: "rgba(13,19,29,0.74)",
  /** Lighter frost for the hero input and chips. */
  frost: "rgba(255,255,255,0.14)",
  frostHover: "rgba(255,255,255,0.22)",
  sunken: "rgba(255,255,255,0.08)",
  ink: "#FFFFFF",
  body: "rgba(255,255,255,0.84)",
  muted: "rgba(255,255,255,0.64)",
  faint: "rgba(255,255,255,0.44)",
  line: "rgba(255,255,255,0.16)",
  lineStrong: "rgba(255,255,255,0.32)",
  accent: "#1C66FE",
  accentHover: "#3F7FFF",
  /** Blue that stays legible as text or a bar on dark glass. */
  accentBright: "#7FAAFF",
  accentSoft: "rgba(28,102,254,0.24)",
  accentLine: "rgba(127,170,255,0.75)",
  white: "#FFFFFF",
  success: "#6FE3B4",
  successSoft: "rgba(52,211,153,0.16)",
  warning: "#FFD591",
  warningSoft: "rgba(251,191,36,0.16)",
  warningLine: "rgba(255,213,145,0.45)",
  danger: "#FF9F96",
  dangerSoft: "rgba(248,113,113,0.18)",
  dangerLine: "rgba(255,159,150,0.55)",
} as const;

/**
 * Chart colours, validated with the dataviz palette checker against the dark glass surface (#101827): lightness band,
 * chroma floor, colour-blind separation (ΔE 27+) and contrast all pass. The blue is the option being pictured, the dawn
 * amber the alternative; the same pair is the diverging "helps / hurts" scale. Text never wears these.
 */
export const chart = {
  pictured: "#4A84FB",
  alternative: "#C47A34",
  helps: "#4A84FB",
  hurts: "#C47A34",
  grid: "rgba(255,255,255,0.10)",
  zero: "rgba(255,255,255,0.32)",
  surface: "#101827",
} as const;

export const type = {
  /** Editorial headline on wide screens (Home sections, page heroes). */
  hero: 64,
  display: 44,
  /** Page title on wide screens; phones use screenTitle. */
  pageTitle: 46,
  screenTitle: 30,
  section: 18,
  body: 16,
  supporting: 14,
  metadata: 12,
} as const;

/** Motion: one duration scale and one easing so every transition feels related. */
/**
 * Letter spacing scales with size: big light headlines are tightened so they read as one shape (the Linear/Vercel
 * habit), small capitals are opened up like the posters' tracked labels.
 */
export const tracking = (size: number) => (size >= 40 ? -0.02 * size : size >= 24 ? -0.01 * size : 0.2);

export const motion = {
  fast: 140,
  base: 240,
  slow: 480,
  /** Delay between siblings in a staggered entrance. */
  stagger: 70,
  /** Rise distance, in px, of an entering element. */
  rise: 14,
  easing: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/** Elevation, as web box-shadows. Glass panels sit on the sky, so shadows are soft and deep. */
export const elevation = {
  rest: "0 1px 0 rgba(255,255,255,0.06) inset, 0 10px 30px rgba(5,10,20,0.22)",
  raised: "0 1px 0 rgba(255,255,255,0.10) inset, 0 18px 44px rgba(5,10,20,0.34)",
  glow: "0 0 0 1px rgba(127,170,255,0.35), 0 10px 34px rgba(28,102,254,0.38)",
} as const;

export const z = { page: 0, sticky: 5, nav: 10, overlay: 20 } as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 56 } as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

/**
 * Window-width breakpoints: `tablet` fits a four-column table, `shell` shows the
 * top navigation, `split` puts panels side by side. Below `shell` it is a phone layout.
 */
export const layout = { column: 720, page: 1160, nav: 72, side: 340, tablet: 720, shell: 900, split: 1200 } as const;
