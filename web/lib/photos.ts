// Space photography from Unsplash (Unsplash License: free for commercial use; credit is given in the footer). NASA and
// ISS images are NASA's. Files are in public/images at 2400px wide; next/image serves the right size.

const P = {
  orbit_horizon: { src: "/images/orbit-horizon.jpg", width: 2400, height: 1350, author: "ActionVance", page: "https://unsplash.com/photos/outer-space-photography-of-earth-t7EL2iG3jMc" },
  earth_lights_limb: { src: "/images/earth-lights-limb.jpg", width: 2400, height: 1350, author: "Carl Wang", page: "https://unsplash.com/photos/a-view-of-the-earth-from-space-lsxADNRNmc8" },
  night_lights: { src: "/images/night-lights.jpg", width: 2400, height: 1597, author: "NASA", page: "https://unsplash.com/photos/photo-of-outer-space-Q1p7bh3SHj8" },
  crescent_earth: { src: "/images/crescent-earth.jpg", width: 2400, height: 1600, author: "NASA", page: "https://unsplash.com/photos/crescent-earth-seen-from-space-against-blackness-GkpYlUpUOIY" },
  milky_way: { src: "/images/milky-way.jpg", width: 2400, height: 1600, author: "Andy Holmes", page: "https://unsplash.com/photos/milky-way-galaxy-in-night-sky-rCbdp8VCYhQ" },
  crescent_clouds: { src: "/images/crescent-clouds.jpg", width: 2400, height: 1600, author: "NASA", page: "https://unsplash.com/photos/a-crescent-earth-viewed-from-space-with-clouds-pTmVTB45Rko" },
  orion_nebula: { src: "/images/orion-nebula.jpg", width: 2400, height: 1600, author: "Bryan Goff", page: "https://unsplash.com/photos/orion-nebula-astrophotography-f7YQo-eYHdM" },
  iss_clouds: { src: "/images/iss-clouds.jpg", width: 2400, height: 1597, author: "NASA", page: "https://unsplash.com/photos/view-of-earth-and-satellite-yZygONrUBe8" },
  moon_craters: { src: "/images/moon-craters.jpg", width: 2400, height: 1600, author: "NASA", page: "https://unsplash.com/photos/close-up-view-of-the-moons-cratered-surface-eHTBf7286Xw" },
  spiral_galaxy: { src: "/images/spiral-galaxy.jpg", width: 2400, height: 1613, author: "NASA Hubble Space Telescope", page: "https://unsplash.com/photos/a-spiral-galaxy-with-stars-in-the-background-kXfko5O5DrM" },
  half_earth: { src: "/images/half-earth.jpg", width: 2400, height: 1600, author: "NASA", page: "https://unsplash.com/photos/view-of-earth-from-space-with-clouds-ErjNGXc9mqA" },
  earth_asia: { src: "/images/earth-asia.jpg", width: 2400, height: 1350, author: "Carl Wang", page: "https://unsplash.com/photos/a-view-of-the-earth-from-space-OCe8cTGymSQ" },
  blue_limb: { src: "/images/blue-limb.jpg", width: 2400, height: 1350, author: "Javier Miranda", page: "https://unsplash.com/photos/a-view-of-the-earth-from-space-DH5ukXKhx4M" },
  night_europe: { src: "/images/night-europe.jpg", width: 2400, height: 1000, author: "Kamran Abdullayev", page: "https://unsplash.com/photos/a-view-of-the-earth-from-space-okkwqpKX2qw" },
} as const;

/** Photos by the job they do, so a page asks for “the hero” rather than a file. */
export const PHOTOS = {
  hero: P.orbit_horizon,
  ask: P.earth_lights_limb,
  business: P.night_lights,
  businessClose: P.night_europe,
  closing: P.crescent_earth,
  stage: P.blue_limb,
  verdict: P.milky_way,
  signin: P.crescent_clouds,
  orion: P.orion_nebula,
  iss: P.iss_clouds,
  moon: P.moon_craters,
  galaxy: P.spiral_galaxy,
  halfEarth: P.half_earth,
  earthAsia: P.earth_asia,
} as const;
export type PhotoKey = keyof typeof PHOTOS;
/** Every distinct photo, for credits. */
export const CREDITS = Object.values(P);
