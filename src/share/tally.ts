// Counting friends' answers. Kept apart from the network client so it runs anywhere, tests included.

export interface FriendAnswer { optionId: string; factorId: string | null; name: string; note: string; at: string }

export interface Tally {
  total: number;
  /** Votes per option id, in option order. */
  votes: { optionId: string; label: string; count: number }[];
  /** Most-named factor, if any friend picked one. */
  topFactor: { label: string; count: number } | null;
  notes: { name: string; note: string; label: string }[];
  /** Answers about options that are no longer on screen (the options were edited after sharing). */
  stale: number;
}

/** Counts answers against the options and factors on screen; answers about ones since removed are left out. */
export function tally(answers: FriendAnswer[], options: { id: string; label: string }[], factors: { id: string; label: string }[]): Tally {
  const known = answers.filter((a) => options.some((o) => o.id === a.optionId));
  const votes = options.map((o) => ({ optionId: o.id, label: o.label, count: known.filter((a) => a.optionId === o.id).length }));
  const factorCounts = factors.map((f) => ({ label: f.label, count: known.filter((a) => a.factorId === f.id).length })).filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);
  return {
    total: known.length,
    votes,
    topFactor: factorCounts[0] ?? null,
    notes: known.filter((a) => a.note).map((a) => ({ name: a.name || "A friend", note: a.note, label: options.find((o) => o.id === a.optionId)!.label })),
    stale: answers.length - known.length,
  };
}
