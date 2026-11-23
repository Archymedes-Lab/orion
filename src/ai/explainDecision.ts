// Explanation layer (§24): the LLM explains, never decides.
// Deterministic result in, calm plain-language summary out. No "AI recommends".
import type { ScoredOption } from "../types.ts";

export interface ExplainInput {
  leaderLabel: string;
  leaderJev: number;
  runnerLabel: string;
  runnerJev: number;
  topFactors: { label: string; impact: number }[];
  flipNote: string;
  nextAction: string;
  stability: "high" | "medium" | "low";
}

export function explainLocal(in_: ExplainInput): string {
  if (in_.leaderJev === in_.runnerJev) {
    return `${in_.leaderLabel} and ${in_.runnerLabel} are tied on the current estimates (score ${in_.leaderJev}). Consider what matters most or refine your estimates before choosing.`;
  }
  const positives = in_.topFactors.filter((f) => f.impact > 0).slice(0, 3).map((f) => f.label.toLowerCase());
  const negatives = in_.topFactors.filter((f) => f.impact < 0).slice(0, 2).map((f) => f.label.toLowerCase());
  const why =
    positives.length || negatives.length
      ? `Higher expected ${positives.join(", ") || "upside"}` +
        (negatives.length ? ` outweigh ${negatives.join(", ")}` : "") + "."
      : "The options are close on every factor you weighed.";
  return [
    `${in_.leaderLabel} comes out ahead (score ${in_.leaderJev} vs ${in_.runnerJev} for ${in_.runnerLabel}).`,
    why,
    in_.flipNote,
    in_.nextAction,
  ].filter(Boolean).join(" ");
}

export async function explainDecision(
  in_: ExplainInput,
  opts?: { endpoint?: string; token?: string }
): Promise<string> {
  if (opts?.endpoint) {
    const res = await fetch(`${opts.endpoint}/decision/explain`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: JSON.stringify(in_),
    });
    if (!res.ok) throw new Error(`explain failed: ${res.status}`);
    const json = (await res.json()) as { explanation: string };
    return json.explanation;
  }
  void (null as unknown as ScoredOption | null);
  return explainLocal(in_);
}
