// Outfit: the thin geometric face closest to the ORION posters, with Noto Sans KR for Hangul (Outfit has none). Web only; it is
// requested from Google Fonts at startup and the system face shows until it arrives.
const HREF = "https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400;500;600&family=Noto+Sans+KR:wght@200;300;400;500;600&display=block";

export function loadWebFont() {
  if (typeof document === "undefined" || document.querySelector(`link[href="${HREF}"]`)) return;
  for (const [rel, href] of [["preconnect", "https://fonts.gstatic.com"], ["stylesheet", HREF]]) {
    const link = document.createElement("link");
    link.rel = rel;
    link.href = href;
    if (rel === "preconnect") link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
}

const STYLE_ID = "orion-global";
// Film grain over everything: an SVG noise tile, so the sky and the glass read as material rather than flat colour.
const GRAIN = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>'
);
// Global rules React Native styles cannot express: keyboard focus ring, selection, scrollbars, grain, the cursor-lit
// glass edge on cards ([data-spot], see trackSpotlight), balanced headings, reduced motion.
const CSS = `
html, body { background: #0B1015; color-scheme: dark; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
body { font-feature-settings: "ss01", "kern"; }
body::after { content: ""; position: fixed; inset: 0; z-index: 9999; pointer-events: none; opacity: 0.045; mix-blend-mode: overlay; background-image: url("${GRAIN}"); background-size: 160px 160px; }
::selection { background: rgba(28,102,254,0.55); color: #fff; }
[role="heading"] { text-wrap: balance; }
html:lang(ko) body { word-break: keep-all; overflow-wrap: break-word; }
[role="button"]:focus-visible, [role="tab"]:focus-visible, [role="link"]:focus-visible, [role="checkbox"]:focus-visible, [role="radio"]:focus-visible, input:focus-visible, textarea:focus-visible {
  outline: 2px solid #7FAAFF; outline-offset: 3px; border-radius: 12px;
}
[data-spot] { --mx: 50%; --my: 0%; }
[data-spot]::before { content: ""; position: absolute; inset: -1px; border-radius: inherit; padding: 1px; pointer-events: none; opacity: 0; transition: opacity 320ms cubic-bezier(0.22,1,0.36,1);
  background: radial-gradient(340px circle at var(--mx) var(--my), rgba(185,210,255,1), rgba(127,170,255,0.45) 30%, transparent 70%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; }
[data-spot]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; opacity: 0; transition: opacity 320ms cubic-bezier(0.22,1,0.36,1);
  background: radial-gradient(520px circle at var(--mx) var(--my), rgba(127,170,255,0.10), transparent 60%); }
[data-spot]:hover::before, [data-spot]:hover::after { opacity: 1; }
* { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.22) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.22); border-radius: 10px; border: 2px solid transparent; background-clip: padding-box; }
@media (hover: none) { [data-spot]::before, [data-spot]::after { display: none; } }
@media (prefers-reduced-motion: reduce) { * { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; scroll-behavior: auto !important; } }
`;

/** Feeds the pointer position to the card under it, for the lit edge in CSS. One listener for the whole page. */
function trackSpotlight() {
  let frame = 0;
  let last: PointerEvent | null = null;
  document.addEventListener("pointermove", (event) => {
    last = event;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const target = (last?.target as Element | null)?.closest?.("[data-spot]") as HTMLElement | null;
      if (!target || !last) return;
      const box = target.getBoundingClientRect();
      target.style.setProperty("--mx", `${last.clientX - box.left}px`);
      target.style.setProperty("--my", `${last.clientY - box.top}px`);
    });
  }, { passive: true });
}

const META: Record<string, string> = {
  description: "ORION helps you make better decisions: describe a choice in your own words and see the trade-offs, what matters most, and what could change the outcome.",
  "theme-color": "#0B1015",
  "color-scheme": "dark",
};

export function loadWebStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  document.documentElement.lang = "en";
  // public/favicon.png is copied to the site root by the web export.
  for (const rel of ["icon", "apple-touch-icon"]) {
    if (!document.querySelector(`link[rel="${rel}"]`)) document.head.appendChild(Object.assign(document.createElement("link"), { rel, href: "/favicon.png" }));
  }
  for (const [name, content] of Object.entries(META)) {
    const meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`) ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name }));
    meta.content = content;
  }
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  trackSpotlight();
}
