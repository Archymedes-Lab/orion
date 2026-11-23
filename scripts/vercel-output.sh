#!/usr/bin/env bash
# Assembles .vercel/output (Vercel's Build Output API) from the exported web app and the bundled API.
# Usage: bun run build:web && scripts/vercel-output.sh && vercel deploy --prebuilt --prod
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/index.html ] || { echo "dist/ is missing: run 'bun run build:web' first" >&2; exit 1; }
out=.vercel/output
rm -rf "$out"
mkdir -p "$out/static" "$out/functions/api.func"
cp -R dist/. "$out/static/"
bun build server/vercel.ts --target=node --format=cjs --outfile "$out/functions/api.func/index.js" >/dev/null
cat > "$out/functions/api.func/.vc-config.json" <<'JSON'
{ "runtime": "nodejs22.x", "handler": "index.js", "launcherType": "Nodejs", "shouldAddHelpers": false, "maxDuration": 60 }
JSON
csp=$(bun -e 'import { contentSecurityPolicy } from "./server/http.ts"; process.stdout.write(contentSecurityPolicy())')
cat > "$out/config.json" <<JSON
{
  "version": 3,
  "routes": [
    { "src": "/(.*)", "headers": {
        "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Strict-Transport-Security": "max-age=63072000; includeSubDomains", "Cross-Origin-Opener-Policy": "same-origin", "Content-Security-Policy": "$csp" }, "continue": true },
    { "src": "/(_expo|assets)/(.*)", "headers": { "Cache-Control": "public, max-age=31536000, immutable" }, "continue": true },
    { "src": "/(health|decision/(?:parse|score-factors|triage|explain|aftermath|creative|prioritize|downside)|billing/(?:plan|checkout|activate|refresh|portal|stripe-webhook|paypack/(?:start|status|webhook))|tasks/(?:score|split)|boards/(?:list|read|create|ops|invite|join|leave|delete)|auth/(?:config|me|signup|login|logout|recover|delete)|account/(?:backup|web-backup)|admin/stats|feedback|client-error|share(?:/[A-Za-z0-9_-]+(?:/(?:respond|results|delete))?)?)", "dest": "/api?__path=/\$1" },
    { "handle": "filesystem" },
    { "src": "/.*", "dest": "/index.html" }
  ]
}
JSON
echo "wrote $out ($(du -sh "$out" | cut -f1))"
