// Entry point when ORION runs as a Vercel function: the same handler as `bun run serve`, minus static files
// (Vercel serves those itself). Memory here lasts only as long as a function instance, so the model-health
// record, the rate limit and the daily free quota are per instance rather than global.
import type { IncomingMessage, ServerResponse } from "node:http";
import { handler } from "./index.ts";
import { storeKind } from "./store.ts";

// A memory store on Vercel lives in one function instance: accounts would vanish between requests.
if (storeKind(process.env) !== "upstash") {
  console.error(JSON.stringify({ warning: "No Upstash Redis configured: accounts, backups and shared links are off (or lost between requests). Add the Upstash integration or set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN." }));
}

// Vercel's edge is the one proxy in front of the function and writes X-Forwarded-For itself. Without this every
// visitor would share one address, and a handful of wrong passwords from anyone would lock sign-in for everyone.
process.env.ORION_TRUST_PROXY ||= "1";
// Requests here mostly wait on model providers, not the CPU, and one instance takes many at once; 8 (the default for a
// single self-hosted process) would turn a launch-day burst into "server busy".
process.env.ORION_MAX_CONCURRENT ||= "48";

const handle = handler({ log: (entry) => console.log(JSON.stringify(entry)) });

export default function orion(req: IncomingMessage, res: ServerResponse) {
  // The routing rule passes the original path along, in case the platform rewrites req.url to the function's own.
  const url = new URL(req.url ?? "/", "http://localhost");
  const original = url.searchParams.get("__path");
  if (original) {
    url.searchParams.delete("__path");
    const rest = url.searchParams.toString();
    req.url = `${original}${rest ? `?${rest}` : ""}`;
  }
  return handle(req, res);
}
