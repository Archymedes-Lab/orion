// `bun run build:web`: exports the web app to dist/ for the same-origin server. A script rather than shell syntax,
// because `${VAR:-/}` is not expanded by Bun's shell on Windows and Git Bash rewrites a bare "/" into a Windows path.
import { spawnSync } from "node:child_process";
import { rmSync, readdirSync } from "node:fs";

const env = { ...process.env, EXPO_NO_TYPESCRIPT_SETUP: "1", EXPO_PUBLIC_ORION_API: process.env.EXPO_PUBLIC_ORION_API || "/" };
// --clear: Metro otherwise reuses a bundle built with a different EXPO_PUBLIC_ORION_API.
const run = spawnSync("bunx", ["expo", "export", "--clear", "--platform", "web", "--output-dir", "dist"], { env, stdio: "inherit", shell: process.platform === "win32" });
if (run.status !== 0) process.exit(run.status ?? 1);
// The posters in public/ are the design reference, not part of the site.
for (const name of readdirSync("dist")) if (name.startsWith("Orion")) rmSync(`dist/${name}`);
