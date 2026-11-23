import path from "node:path";
import type { NextConfig } from "next";

// The web app shares the decision engine and AI contracts with the Expo app (../src), so the
// bundler's root is the repository, not this folder.
const root = path.join(__dirname, "..");

const config: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  images: { formats: ["image/avif", "image/webp"], qualities: [70, 78, 85] },
  poweredByHeader: false,
  async headers() {
    const security = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
    ];
    return [
      { source: "/:path*", headers: security },
      { source: "/images/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default config;
