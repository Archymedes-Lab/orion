// The Archymedes brand marks as plain SVG: the hairline ORION wordmark, its blue four-point star, and a small icon set
// drawn on one 24px grid with a 1.5px stroke so every glyph shares the wordmark's thin geometric line.
import type { CSSProperties, SVGProps } from "react";

// Letters on a 100-unit cap height: circle Os, an R whose leg leaves the bowl open, a plain I and N (same as the app).
const LETTERS = "M98 50A48 48 0 1 1 2 50A48 48 0 1 1 98 50ZM136 98V2H166A24 24 0 0 1 166 50H136M158 50L194 98M232 98V2M364 50A48 48 0 1 1 268 50A48 48 0 1 1 364 50ZM402 98V2L478 98V2";
export const starPath = (cx: number, cy: number, r: number) =>
  `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;

/** ORION in hairline capitals. `height` is the rendered cap-to-baseline height in px; the stroke stays ~1.2px+ at any size. */
export function Wordmark({ height = 22, star = true, draw = false, className, style }: {
  height?: number; star?: boolean; draw?: boolean; className?: string; style?: CSSProperties;
}) {
  const stroke = Math.max(4.2, 130 / height);
  return (
    <span className={`o-wordmark ${className ?? ""}`} style={{ height: height * 1.46, ...style }} role="img" aria-label="ORION">
      <svg viewBox="-4 -44 548 146" aria-hidden>
        <defs>
          <radialGradient id="o-star-glow" cx="512" cy="-12" r="54" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#1C66FE" stopOpacity="0.55" />
            <stop offset="1" stopColor="#1C66FE" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          d={LETTERS} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="butt"
          pathLength={draw ? 1 : undefined}
          style={draw ? { strokeDasharray: 1, strokeDashoffset: 1, animation: "o-draw 2.2s var(--ease) 0.15s forwards" } : undefined}
        />
        {star && (
          <g style={draw ? { opacity: 0, animation: "fade 900ms var(--ease) 1.5s forwards" } : undefined}>
            <circle cx="512" cy="-12" r="44" fill="url(#o-star-glow)" />
            <path d={starPath(512, -12, 23)} fill="#1C66FE" />
          </g>
        )}
      </svg>
      <style>{`@keyframes o-draw { to { stroke-dashoffset: 0; } }`}</style>
    </span>
  );
}

export function Star({ size = 16, pulse = false, className }: { size?: number; pulse?: boolean; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={`o-star ${pulse ? "o-star--pulse" : ""} ${className ?? ""}`} aria-hidden>
      <path d={starPath(10, 10, 10)} fill="currentColor" />
    </svg>
  );
}

/** The Archymedes mark: a hairline triangle with a cut and a blue tick. */
export function Archymedes({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 21 20H3L9.5 8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M17 20h4" stroke="#1C66FE" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

type IconName =
  | "arrow" | "arrow-left" | "career" | "health" | "money" | "people" | "travel" | "more" | "home" | "history"
  | "insights" | "profile" | "building" | "spark" | "check" | "close" | "plus" | "minus" | "edit" | "shield"
  | "chat" | "bulb" | "clock" | "coffee" | "chart" | "grid" | "lock" | "logout" | "search" | "copy" | "flip"
  | "pin" | "trash" | "download" | "upload" | "sidebar" | "note" | "redo" | "link";

const PATHS: Record<IconName, string> = {
  arrow: "M5 12h14M13 6l6 6-6 6",
  "arrow-left": "M19 12H5M11 6l-6 6 6 6",
  career: "M4 8h16v11H4zM9 8V5h6v3M4 13h16",
  health: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z",
  money: "M5 19V13M10 19V9M15 19V11M20 19V5",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6",
  travel: "M3 13l18-7-5 15-4-6-6-1zM12 15l4-5",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z",
  history: "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4M12 8v4l3 2",
  insights: "M5 20V12M12 20V6M19 20v-9",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  building: "M4 21V5l8-3v19M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M2 21h20",
  spark: "M12 3v6M12 15v6M3 12h6M15 12h6",
  check: "M5 12.5l4.5 4.5L19 7",
  close: "M6 6l12 12M18 6 6 18",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  shield: "M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z",
  chat: "M4 5h16v11H9l-5 4z",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  coffee: "M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M12 3v3",
  chart: "M4 4v16h16M8 15l3-4 3 2 5-6",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  lock: "M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  copy: "M8 8h12v12H8zM4 16V4h12",
  flip: "M4 9h13l-3-3M20 15H7l3 3",
  pin: "M9 4h6l-1 6 3 3H7l3-3zM12 13v8",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  upload: "M12 20V9M7 14l5-5 5 5M5 4h14",
  sidebar: "M4 5h16v14H4zM9 5v14",
  note: "M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h4",
  redo: "M20 12a8 8 0 1 1-2.4-5.7M20 4v4h-4",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
};

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
export type { IconName };
