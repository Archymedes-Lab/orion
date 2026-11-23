import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ORION — Make better decisions",
    short_name: "ORION",
    description: "Describe a decision; ORION weighs the options and tells you which comes out ahead on what matters to you.",
    start_url: "/app",
    display: "standalone",
    background_color: "#05080f",
    theme_color: "#05080f",
    icons: [{ src: "/icon.png", sizes: "any", type: "image/png" }],
  };
}
